import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AttemptOutcome,
  CheckInMethod,
  CheckInStatus,
  LogsResponse,
  NotificationDto,
  RecordAttemptResponse,
  RecordCheckInResponse,
  SnoozeResponse,
  SyncOperation,
  SyncOperationResult,
  SyncResponse,
  TodayResponse,
  UserId,
  WeekResponse,
} from '@wesal/shared';
import { ALL_CHECK_IN_METHODS, ESCALATION_LIMITS, ErrorCode, LIMITS, formatDate, getMessages } from '@wesal/shared';
import type { CheckInRecord, PersonRecord, ScheduleEntryRecord } from '../ports/records';
import type {
  AttemptRepository,
  CheckInRepository,
  NotificationRepository,
  PersonRepository,
  ScheduleEntryRepository,
  SyncOperationRepository,
  UserRepository,
  WebCheckInLinkRepository,
} from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { SYMBOLS, type AuditLogger, type FieldEncryptionService, type IdGenerator, type UrlBuilder } from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { DomainError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { utcToLocal } from '../../domain/shared/time';
import {
  assertIdempotencyKey,
  assertSnoozeAllowed,
  computeRetryAfter,
  defaultCheckInStatus,
  entriesClosedByCheckIn,
  resolveTargetEntry,
} from '../../domain/checkin/check-in-rules';
import { computeEntryStatus } from '../../domain/schedule/entry-status';
import { buildLowContactSuggestion } from '../../domain/schedule/week-projection';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { DtoMapper } from '../services/dto.mapper';
import { AccessService } from '../services/access.service';
import { ScheduleGenerationService } from '../services/schedule.service';
import { EscalationEngine } from '../services/escalation.service';
import { NotificationService } from '../services/notification.service';
import type { RequestContext } from './auth.use-case';

/**
 * تسجيل الاطمئنان، الرئيسية (اليوم)، أسبوع وصال، سجل الوصال،
 * صندوق الإشعارات، المزامنة دون اتصال، ورابط "أنا بخير" العام.
 *
 * مبدآن: عدم التكرار (idempotencyKey) والإيقاف الفوري لأي تنبيه بعد تأكيد الاطمئنان.
 */
@Injectable()
export class CheckInUseCase {
  private readonly logger = new Logger('CheckInUseCase');

  constructor(
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.users) private readonly users: UserRepository,
    @Inject(REPOSITORIES.scheduleEntries) private readonly entries: ScheduleEntryRepository,
    @Inject(REPOSITORIES.checkIns) private readonly checkIns: CheckInRepository,
    @Inject(REPOSITORIES.attempts) private readonly attempts: AttemptRepository,
    @Inject(REPOSITORIES.notifications) private readonly notifications: NotificationRepository,
    @Inject(REPOSITORIES.syncOperations) private readonly syncOps: SyncOperationRepository,
    @Inject(REPOSITORIES.webCheckInLinks) private readonly webLinks: WebCheckInLinkRepository,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
    @Inject(SYMBOLS.AuditLogger) private readonly audit: AuditLogger,
    @Inject(SYMBOLS.UrlBuilder) private readonly urls: UrlBuilder,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mapper: DtoMapper,
    private readonly access: AccessService,
    private readonly scheduleService: ScheduleGenerationService,
    private readonly escalation: EscalationEngine,
    private readonly notificationService: NotificationService,
  ) {}

  // ─────────────────────────── ❤️ تم الاطمئنان ───────────────────────────

  async record(
    userId: UserId,
    personId: string,
    input: {
      entryId?: string | null;
      method: CheckInMethod;
      status?: CheckInStatus;
      occurredAt?: string;
      notes?: string | null;
      idempotencyKey: string;
      fromOfflineQueue?: boolean;
    },
    ctx: RequestContext = {},
  ): Promise<RecordCheckInResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const key = assertIdempotencyKey(input.idempotencyKey);

    const existing = await this.checkIns.findByIdempotencyKey(userId, key);
    if (existing) {
      return this.toRecordResponse(existing, person, m.notifications.checkInDoneBody(person.displayName), true, false);
    }

    if (!ALL_CHECK_IN_METHODS.includes(input.method)) {
      throw new ValidationError('Choose how you reached out', { field: 'method' });
    }
    const now = this.clock.now();
    const occurredAt = parseOccurredAt(input.occurredAt, now);
    const status = defaultCheckInStatus(input.method, input.status);
    const notes = input.notes ? input.notes.trim().slice(0, LIMITS.notesMax) : null;

    const target = await this.resolveEntry(person, input.entryId ?? null, occurredAt);
    const checkIn = await this.checkIns.create({
      id: this.ids.uuid(),
      personId: person.id,
      entryId: target?.id ?? null,
      occurredAt,
      method: input.method,
      status,
      confirmedByKind: 'owner',
      confirmedById: user.id,
      notes,
      idempotencyKey: key,
      clientOccurredAt: input.occurredAt ? occurredAt : null,
      syncedAt: input.fromOfflineQueue ? now : null,
    });

    let stoppedAlerts = false;
    if (status === 'reassured') {
      await this.closeEntries(person, target, user.id, occurredAt);
      await this.persons.touchLastCheckIn(person.id, { lastCheckInAt: occurredAt, lastCheckInMethod: input.method, lastContactAt: occurredAt });
      const stopped = await this.escalation.resolveOnCheckIn({ personId: person.id, entryId: target?.id ?? null, reason: 'owner_check_in' });
      stoppedAlerts = stopped.resolvedEscalations > 0 || stopped.cancelledNotifications > 0 || stopped.cancelledJobs > 0;
      await this.notificationService.sendCheckInConfirmation({ user, person, occurredAt }).catch((error: Error) => {
        this.logger.warn(`confirmation notification failed: ${error.message}`);
      });
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'check_in.recorded',
      entityType: 'check_in',
      entityId: checkIn.id,
      personId: person.id,
      metadata: { method: input.method, status, offline: Boolean(input.fromOfflineQueue) },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return this.toRecordResponse(checkIn, person, m.notifications.checkInDoneBody(person.displayName), false, stoppedAlerts);
  }

  // ─────────────────────────── 📞 اتصلت ولم يرد ───────────────────────────

  async recordAttempt(
    userId: UserId,
    personId: string,
    input: { entryId?: string | null; outcome: AttemptOutcome; retryAfterMinutes?: number; idempotencyKey: string; occurredAt?: string },
    ctx: RequestContext = {},
  ): Promise<RecordAttemptResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const key = assertIdempotencyKey(input.idempotencyKey);

    const existing = await this.attempts.findByIdempotencyKey(key);
    if (existing) {
      return {
        attemptId: existing.id,
        personId: person.id,
        entryId: existing.entryId,
        retryAt: existing.retryAfter?.toISOString() ?? null,
        message: m.checkInStatus.called_no_answer,
      };
    }

    const now = this.clock.now();
    const occurredAt = parseOccurredAt(input.occurredAt, now);
    const target = await this.resolveEntry(person, input.entryId ?? null, occurredAt);
    const retryAfter = computeRetryAfter(now, input.outcome, {
      requestedRetryMinutes: input.retryAfterMinutes,
      defaultRetryMinutes: 60,
    });

    const attempt = await this.attempts.create({
      id: this.ids.uuid(),
      personId: person.id,
      entryId: target?.id ?? null,
      attemptedAt: occurredAt,
      kind: 'call',
      outcome: input.outcome,
      retryAfter,
      idempotencyKey: key,
      createdBy: user.id,
    });

    if (input.outcome === 'answered') {
      // "رد" = اطمئنان فعلي
      await this.record(
        userId,
        personId,
        { entryId: target?.id ?? null, method: 'call', status: 'reassured', occurredAt: occurredAt.toISOString(), idempotencyKey: `${key}-ok` },
        ctx,
      );
    } else {
      await this.persons.update(person.id, { lastContactAt: occurredAt });
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'attempt.recorded',
      entityType: 'communication_attempt',
      entityId: attempt.id,
      personId: person.id,
      metadata: { outcome: input.outcome },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return {
      attemptId: attempt.id,
      personId: person.id,
      entryId: attempt.entryId,
      retryAt: retryAfter?.toISOString() ?? null,
      message: input.outcome === 'answered' ? m.notifications.checkInDoneBody(person.displayName) : m.notifications.retryBody(person.displayName),
    };
  }

  // ─────────────────────────── ⏰ لاحقًا ───────────────────────────

  async snooze(
    userId: UserId,
    personId: string,
    input: { entryId?: string | null; minutes: number; untilLocalTime?: string; idempotencyKey: string },
    ctx: RequestContext = {},
  ): Promise<SnoozeResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const key = assertIdempotencyKey(input.idempotencyKey);
    const now = this.clock.now();

    const existing = await this.checkIns.findByIdempotencyKey(userId, key);
    const target = await this.resolveEntry(person, input.entryId ?? existing?.entryId ?? null, now);
    if (!target) {
      throw new DomainError(ErrorCode.EntryNotActionable, m.statusHint.upcoming, 409);
    }
    if (existing && target.snoozedUntil) {
      return { personId: person.id, entryId: target.id, snoozedUntil: target.snoozedUntil.toISOString(), message: m.checkInStatus.snoozed };
    }

    const snoozeCount = await this.checkIns.countSnoozesForEntry(target.id);
    assertSnoozeAllowed(snoozeCount, ESCALATION_LIMITS.maxSnoozesPerEntry);

    let snoozedUntil: Date;
    if (input.untilLocalTime) {
      const [h, mm] = input.untilLocalTime.split(':').map(Number);
      const local = utcToLocal(now, person.timezone).set({ hour: h, minute: mm, second: 0, millisecond: 0 });
      snoozedUntil = local <= utcToLocal(now, person.timezone) ? local.plus({ days: 1 }).toJSDate() : local.toJSDate();
    } else {
      const minutes = Number(input.minutes);
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 24 * 60) {
        throw new ValidationError('Choose how long to postpone', { field: 'minutes' });
      }
      snoozedUntil = new Date(now.getTime() + minutes * 60_000);
    }

    await this.checkIns.create({
      id: this.ids.uuid(),
      personId: person.id,
      entryId: target.id,
      occurredAt: now,
      method: 'manual',
      status: 'snoozed',
      confirmedByKind: 'owner',
      confirmedById: user.id,
      notes: null,
      idempotencyKey: key,
      clientOccurredAt: null,
      syncedAt: null,
    });
    await this.entries.updateStatus(target.id, { status: 'snoozed', snoozedUntil });

    await this.audit.log({
      actorUserId: user.id,
      action: 'entry.snoozed',
      entityType: 'schedule_entry',
      entityId: target.id,
      personId: person.id,
      metadata: { snoozedUntil: snoozedUntil.toISOString() },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return { personId: person.id, entryId: target.id, snoozedUntil: snoozedUntil.toISOString(), message: m.checkInStatus.snoozed };
  }

  // ─────────────────────────── الرئيسية (اليوم) ───────────────────────────

  async today(userId: UserId): Promise<TodayResponse> {
    const user = await this.access.requireUser(userId);
    const m = getMessages(user.locale);
    const now = this.clock.now();

    const all = (await this.persons.listAllOwned(userId)).filter((p) => !p.deceasedReportedAt);
    const statuses = await this.scheduleService.computeLiveStatuses(all, now);

    const cards = all
      .map((person) => {
        const live = statuses.get(person.id);
        return this.mapper.toPersonCard({
          person,
          status: live?.status,
          entry: live?.openEntry ?? live?.nextEntry ?? null,
          locale: user.locale,
          now,
        });
      })
      .sort((a, b) => a.priority - b.priority || (a.entryAt ?? '').localeCompare(b.entryAt ?? ''));

    const counts = { dueToday: 0, checked: 0, unverified: 0, needsFollowUp: 0, upcoming: 0, total: cards.length };
    for (const card of cards) {
      if (card.status === 'due') counts.dueToday += 1;
      else if (card.status === 'checked') counts.checked += 1;
      else if (card.status === 'unverified') counts.unverified += 1;
      else if (card.status === 'needs_followup') counts.needsFollowUp += 1;
      else if (card.status === 'upcoming') counts.upcoming += 1;
    }
    const actionable = counts.dueToday + counts.unverified + counts.needsFollowUp;

    const hour = utcToLocal(now, user.timezone).hour;
    const greeting =
      hour >= 5 && hour < 12 ? m.home.morningGreeting(actionable) : hour >= 17 && hour < 23 ? m.home.eveningGreeting(actionable) : m.home.genericGreeting(actionable);

    // اقتراح لطيف: أطول فترة بلا تواصل
    let suggestion: TodayResponse['suggestion'] = null;
    for (const person of all) {
      const last = person.lastContactAt ?? person.lastCheckInAt ?? person.createdAt;
      const days = Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60_000));
      const candidate = buildLowContactSuggestion({ personId: person.id, personName: person.displayName, daysSinceLastContact: days, locale: user.locale });
      if (candidate) {
        suggestion = candidate;
        break;
      }
    }

    return {
      greeting,
      dateLabel: formatDate(now, user.timezone, user.locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      counts,
      cards,
      isEmpty: cards.length === 0,
      emptyState: cards.length === 0 ? this.mapper.emptyTodayState(user.locale) : null,
      suggestion,
    };
  }

  // ─────────────────────────── أسبوع وصال ───────────────────────────

  async week(userId: UserId, query: { start?: string; timezone?: string } = {}): Promise<WeekResponse> {
    const user = await this.access.requireUser(userId);
    const now = this.clock.now();
    const persons = (await this.persons.listAllOwned(userId)).filter((p) => !p.deceasedReportedAt);
    const projection = await this.scheduleService.getWeek({
      user,
      persons,
      ...(query.start ? { startDate: query.start } : {}),
      ...(query.timezone ? { viewerTimezone: query.timezone } : {}),
    });

    const totals = { total: 0, checked: 0, due: 0, unverified: 0, needsFollowUp: 0 };
    const days = projection.days.map((day) => {
      const dto = this.mapper.toWeekDayDto({
        date: day.date,
        weekday: day.weekday,
        isToday: day.isToday,
        entries: day.entries.map(({ entry, person, status }) => ({
          ...this.mapper.toEntryDto(entry, user.locale, status),
          person: this.mapper.toPersonCard({ person, status: entryToPersonStatus(status), entry, locale: user.locale, now }),
        })),
      });
      totals.total += dto.counts.total;
      totals.checked += dto.counts.checked;
      totals.due += dto.counts.due;
      totals.unverified += dto.counts.unverified;
      return dto;
    });

    return { weekStart: projection.weekStart, weekEnd: projection.weekEnd, timezone: projection.timezone, days, totals };
  }

  // ─────────────────────────── سجل الوصال ───────────────────────────

  async logs(userId: UserId, query: { from?: string; to?: string; personId?: string; page?: number; pageSize?: number } = {}): Promise<LogsResponse> {
    const user = await this.access.requireUser(userId);
    const m = getMessages(user.locale);
    const now = this.clock.now();
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 30));

    const persons = query.personId ? [await this.access.requireOwnedPerson(userId, query.personId)] : await this.persons.listAllOwned(userId);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const rows: LogsResponse['items'] = [];
    for (const person of persons) {
      const checkIns = await this.checkIns.listForPerson(person.id, { limit: 200, from, to });
      const attempts = await this.attempts.listForPerson(person.id, { limit: 200, from, to });
      rows.push(...checkIns.filter((c) => c.status !== 'snoozed').map((c) => this.mapper.toLogRow({ checkIn: c, person, locale: user.locale })));
      rows.push(
        ...attempts
          .filter((a) => a.outcome === 'no_answer' || a.outcome === 'unreachable')
          .map((a) => this.mapper.toLogRow({ attempt: a, person, locale: user.locale })),
      );
    }
    rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    const completedThisWeek = rows.filter((r) => r.status === 'reassured' && r.occurredAt >= weekAgo).length;
    const start = (page - 1) * pageSize;

    return {
      items: rows.slice(start, start + pageSize),
      page,
      pageSize,
      total: rows.length,
      hasMore: start + pageSize < rows.length,
      summary: {
        completedThisWeek,
        message: completedThisWeek > 0 ? m.notifications.weeklyReportBody(completedThisWeek) : m.logs.empty,
      },
    };
  }

  // ─────────────────────────── صندوق الإشعارات ───────────────────────────

  async listNotifications(userId: UserId, query: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}): Promise<{
    items: NotificationDto[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const user = await this.access.requireUser(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 30));
    const result = await this.notifications.listForUser(userId, {
      unreadOnly: Boolean(query.unreadOnly),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      items: result.items.map((n) => this.mapper.toNotificationDto(n, user.locale)),
      total: result.total,
      page,
      pageSize,
      hasMore: page * pageSize < result.total,
    };
  }

  async markNotificationsRead(userId: UserId, ids: string[] | 'all'): Promise<{ updated: number }> {
    await this.access.requireUser(userId);
    const now = this.clock.now();
    const updated = ids === 'all' ? await this.notifications.markAllRead(userId, now) : await this.notifications.markRead(ids, now);
    return { updated };
  }

  // ─────────────────────────── المزامنة دون اتصال ───────────────────────────

  async sync(userId: UserId, input: { operations: SyncOperation[] }, ctx: RequestContext = {}): Promise<SyncResponse> {
    const user = await this.access.requireUser(userId);
    const m = getMessages(user.locale);
    const results: SyncOperationResult[] = [];
    const operations = Array.isArray(input.operations) ? input.operations.slice(0, 200) : [];

    for (const op of operations) {
      const base = { idempotencyKey: String(op?.idempotencyKey ?? ''), type: op?.type };
      try {
        assertIdempotencyKey(op.idempotencyKey);
        const previous = await this.syncOps.findByIdempotencyKey(userId, op.idempotencyKey);
        if (previous) {
          results.push({ ...base, status: 'duplicated', entityId: previous.entityId ?? undefined });
          continue;
        }
        const clientOccurredAt = parseOccurredAt(op.clientOccurredAt, this.clock.now());
        const record = await this.syncOps.create({
          id: this.ids.uuid(),
          userId,
          idempotencyKey: op.idempotencyKey,
          opType: op.type,
          payloadJson: JSON.stringify(op.payload ?? {}),
          clientOccurredAt,
          status: 'applied',
          entityId: null,
          errorCode: null,
          messageAr: null,
          resultJson: null,
          appliedAt: this.clock.now(),
        });

        const payload = (op.payload ?? {}) as Record<string, unknown>;
        const personId = String(payload.personId ?? '');
        let entityId: string | null = null;
        let duplicated = false;

        if (op.type === 'record_check_in') {
          const r = await this.record(
            userId,
            personId,
            {
              entryId: (payload.entryId as string | null | undefined) ?? null,
              method: payload.method as CheckInMethod,
              status: payload.status as CheckInStatus | undefined,
              occurredAt: (payload.occurredAt as string | undefined) ?? op.clientOccurredAt,
              notes: (payload.notes as string | null | undefined) ?? null,
              idempotencyKey: String(payload.idempotencyKey ?? op.idempotencyKey),
              fromOfflineQueue: true,
            },
            ctx,
          );
          entityId = r.checkInId;
          duplicated = r.duplicated;
        } else if (op.type === 'record_attempt') {
          const r = await this.recordAttempt(
            userId,
            personId,
            {
              entryId: (payload.entryId as string | null | undefined) ?? null,
              outcome: payload.outcome as AttemptOutcome,
              retryAfterMinutes: payload.retryAfterMinutes as number | undefined,
              idempotencyKey: String(payload.idempotencyKey ?? op.idempotencyKey),
              occurredAt: (payload.occurredAt as string | undefined) ?? op.clientOccurredAt,
            },
            ctx,
          );
          entityId = r.attemptId;
        } else if (op.type === 'snooze') {
          const r = await this.snooze(
            userId,
            personId,
            {
              entryId: (payload.entryId as string | null | undefined) ?? null,
              minutes: Number(payload.minutes ?? 30),
              untilLocalTime: payload.untilLocalTime as string | undefined,
              idempotencyKey: String(payload.idempotencyKey ?? op.idempotencyKey),
            },
            ctx,
          );
          entityId = r.entryId;
        } else {
          throw new ValidationError(`Unsupported sync operation: ${String(op.type)}`, { field: 'type' });
        }

        await this.syncOps.markApplied(record.id, entityId, JSON.stringify({ entityId }), this.clock.now());
        results.push({ ...base, status: duplicated ? 'duplicated' : 'applied', entityId: entityId ?? undefined });
      } catch (error) {
        const domain = error instanceof DomainError ? error : null;
        const code = domain?.code ?? ErrorCode.InternalError;
        const message = domain?.message ?? m.errors.generic;
        const existing = op?.idempotencyKey ? await this.syncOps.findByIdempotencyKey(userId, op.idempotencyKey).catch(() => null) : null;
        if (existing) await this.syncOps.markRejected(existing.id, code, message, this.clock.now()).catch(() => undefined);
        results.push({ ...base, status: 'rejected', errorCode: code, message });
      }
    }

    return {
      results,
      applied: results.filter((r) => r.status === 'applied').length,
      duplicated: results.filter((r) => r.status === 'duplicated').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // ─────────────────────── رابط "أنا بخير" (بدون تطبيق) ───────────────────────

  async createWebCheckInLink(userId: UserId, personId: string): Promise<{ url: string; expiresAt: string }> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const now = this.clock.now();
    const token = this.ids.randomToken(32);
    const live = await this.scheduleService.computeLivePersonStatus(person, now);
    const expiresAt = new Date(now.getTime() + this.config.invites.webCheckInLinkTtlMinutes * 60_000);
    await this.webLinks.create({
      id: this.ids.uuid(),
      personId: person.id,
      entryId: live.openEntry?.id ?? null,
      tokenHash: this.crypto.hmac(token),
      expiresAt,
      usedAt: null,
      createdBy: user.id,
    });
    return { url: this.urls.webCheckInUrl(token), expiresAt: expiresAt.toISOString() };
  }

  async publicWebCheckIn(token: string, locale: 'ar' | 'en' = 'ar'): Promise<{
    personName: string;
    title: string;
    body: string;
    button: string;
    expired: boolean;
    used: boolean;
  }> {
    const m = getMessages(locale);
    const link = await this.webLinks.findByTokenHash(this.crypto.hmac(token || ''));
    if (!link) throw new NotFoundError('Link');
    const person = await this.persons.findById(link.personId);
    if (!person) throw new NotFoundError('Link');
    const expired = link.expiresAt.getTime() <= this.clock.now().getTime();
    return {
      personName: person.displayName,
      title: m.notifications.webCheckInTitle(person.displayName),
      body: expired ? m.notifications.webCheckInExpired : m.notifications.webCheckInBody(person.displayName),
      button: m.notifications.webCheckInButton,
      expired,
      used: Boolean(link.usedAt),
    };
  }

  async confirmWebCheckIn(token: string, locale: 'ar' | 'en' = 'ar'): Promise<{ ok: true; message: string; duplicated: boolean }> {
    const m = getMessages(locale);
    const now = this.clock.now();
    const link = await this.webLinks.findByTokenHash(this.crypto.hmac(token || ''));
    if (!link) throw new NotFoundError('Link');
    const person = await this.persons.findById(link.personId);
    if (!person) throw new NotFoundError('Link');
    if (link.expiresAt.getTime() <= now.getTime()) {
      throw new DomainError(ErrorCode.InviteExpired, m.notifications.webCheckInExpired, 410);
    }
    if (link.usedAt) {
      return { ok: true, message: m.notifications.webCheckInThanks(person.displayName), duplicated: true };
    }

    const target = await this.resolveEntry(person, link.entryId, now);
    await this.checkIns.create({
      id: this.ids.uuid(),
      personId: person.id,
      entryId: target?.id ?? null,
      occurredAt: now,
      method: 'web_link',
      status: 'reassured',
      confirmedByKind: 'person_self',
      confirmedById: null,
      notes: null,
      idempotencyKey: `web:${link.id}`,
      clientOccurredAt: null,
      syncedAt: null,
    });
    await this.webLinks.markUsed(link.id, now);
    await this.closeEntries(person, target, null, now);
    await this.persons.touchLastCheckIn(person.id, { lastCheckInAt: now, lastCheckInMethod: 'web_link', lastContactAt: now });
    await this.escalation.resolveOnCheckIn({ personId: person.id, entryId: target?.id ?? null, reason: 'person_self_web' });

    const owner = await this.users.findById(person.ownerUserId);
    if (owner) {
      await this.notificationService.sendPersonIsFine({ person, recipients: [owner], verifiedAt: now }).catch((error: Error) => {
        this.logger.warn(`person-is-fine notification failed: ${error.message}`);
      });
    }
    await this.audit.log({
      actorKind: 'trusted_contact',
      action: 'check_in.web_confirmed',
      entityType: 'web_check_in_link',
      entityId: link.id,
      personId: person.id,
    });

    return { ok: true, message: m.notifications.webCheckInThanks(person.displayName), duplicated: false };
  }

  // ─────────────────────────────── مساعدات ───────────────────────────────

  private async resolveEntry(person: PersonRecord, requestedEntryId: string | null, at: Date): Promise<ScheduleEntryRecord | null> {
    const entries = await this.entries.list({
      personIds: [person.id],
      from: new Date(at.getTime() - 72 * 60 * 60_000),
      to: new Date(at.getTime() + 6 * 60 * 60_000),
      limit: 500,
    });
    if (requestedEntryId && !entries.some((e) => e.id === requestedEntryId)) {
      const direct = await this.entries.findById(requestedEntryId);
      if (direct && direct.personId === person.id) entries.push(direct);
    }
    const checkInRows = await this.checkIns.listForEntries(entries.map((e) => e.id));
    const candidates = entries.map((e) => ({
      id: e.id,
      scheduledFor: e.scheduledFor,
      status: computeEntryStatus(e, at, {
        checkIns: checkInRows.filter((c) => c.entryId === e.id),
        defaultGraceMinutes: person.gracePeriodMinutes,
      }),
    }));
    const target = resolveTargetEntry(candidates, requestedEntryId, at);
    return target ? (entries.find((e) => e.id === target.id) ?? null) : null;
  }

  private async closeEntries(person: PersonRecord, target: ScheduleEntryRecord | null, by: UserId | null, at: Date): Promise<void> {
    const entries = await this.entries.list({
      personIds: [person.id],
      from: new Date(at.getTime() - 14 * 24 * 60 * 60_000),
      to: new Date(at.getTime() + 6 * 60 * 60_000),
      limit: 500,
    });
    const candidates = entries.map((e) => ({ id: e.id, scheduledFor: e.scheduledFor, status: e.status }));
    const toClose = new Set(entriesClosedByCheckIn(candidates, target?.id ?? null, at));
    if (target && target.status !== 'checked') toClose.add(target.id);
    for (const id of toClose) {
      await this.entries.updateStatus(id, { status: 'checked', completedAt: at, completedBy: by, snoozedUntil: null });
    }
  }

  private toRecordResponse(
    checkIn: CheckInRecord,
    person: PersonRecord,
    confirmationMessage: string,
    duplicated: boolean,
    stoppedAlerts: boolean,
  ): RecordCheckInResponse {
    return {
      checkInId: checkIn.id,
      personId: person.id,
      entryId: checkIn.entryId,
      status: checkIn.status,
      occurredAt: checkIn.occurredAt.toISOString(),
      duplicated,
      confirmationMessage,
      stoppedAlerts,
    };
  }
}

function parseOccurredAt(value: string | undefined, now: Date): Date {
  if (!value) return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError('Invalid date', { field: 'occurredAt' });
  // لا نقبل وقتًا في المستقبل (بهامش دقيقتين لفروق الساعات)
  return parsed.getTime() > now.getTime() + 2 * 60_000 ? now : parsed;
}

function entryToPersonStatus(status: ScheduleEntryRecord['status']): PersonRecord['cachedStatus'] {
  switch (status) {
    case 'checked':
      return 'checked';
    case 'due':
    case 'snoozed':
      return 'due';
    case 'unverified':
      return 'unverified';
    default:
      return 'upcoming';
  }
}
