import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreatePersonResponse,
  LocalTime,
  Locale,
  PausePersonResponse,
  PersonDetailResponse,
  PersonDto,
  PersonStatus,
  Relationship,
  RemovePersonResponse,
  ReportDeceasedResponse,
  UpdatePersonRequest,
  UpdatePersonResponse,
  UserId,
  Weekday,
  WhoSeesMeResponse,
} from '@wesal/shared';
import {
  ALL_RELATIONSHIPS,
  LIMITS,
  PauseReason,
  getMessages,
  isLocalTime,
  isRelationship,
} from '@wesal/shared';
import type { PersonRecord, ScheduleEntryRecord, ScheduleExceptionRecord } from '../ports/records';
import type {
  CheckInRepository,
  AttemptRepository,
  EscalationRuleRepository,
  PersonRepository,
  ScheduleEntryRepository,
  ScheduleExceptionRepository,
  ScheduleRepository,
  TrustedContactRepository,
  ContactInvitationRepository,
} from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import {
  SYMBOLS,
  type AuditLogger,
  type FieldEncryptionService,
  type IdGenerator,
} from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { WeeklyPattern } from '../../domain/schedule/weekly-pattern';
import { ConflictError, ValidationError } from '../../domain/shared/errors';
import { assertValidTimezone, toLocalDate } from '../../domain/shared/time';
import { assertValidPhone } from '../../domain/shared/phone';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { DtoMapper } from '../services/dto.mapper';
import { AccessService } from '../services/access.service';
import { ScheduleGenerationService } from '../services/schedule.service';
import { EscalationEngine } from '../services/escalation.service';
import { TrustedContactUseCase } from './trusted-contact.use-case';
import type { RequestContext } from './auth.use-case';

/**
 * حالات استخدام الأشخاص — الكيان المركزي في وصال.
 *
 * هدف المنتج: **إضافة أول شخص في أقل من دقيقة** → الحقول الإلزامية ثلاثة فقط:
 * الاسم، صلة القرابة، الجدول. وكل ما عداها اختياري.
 */
@Injectable()
export class PersonUseCase {
  private readonly logger = new Logger('PersonUseCase');

  constructor(
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.schedules) private readonly schedules: ScheduleRepository,
    @Inject(REPOSITORIES.scheduleEntries) private readonly entries: ScheduleEntryRepository,
    @Inject(REPOSITORIES.scheduleExceptions) private readonly exceptions: ScheduleExceptionRepository,
    @Inject(REPOSITORIES.checkIns) private readonly checkIns: CheckInRepository,
    @Inject(REPOSITORIES.attempts) private readonly attempts: AttemptRepository,
    @Inject(REPOSITORIES.escalationRules) private readonly rules: EscalationRuleRepository,
    @Inject(REPOSITORIES.trustedContacts) private readonly trustedContacts: TrustedContactRepository,
    @Inject(REPOSITORIES.contactInvitations) private readonly invitations: ContactInvitationRepository,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
    @Inject(SYMBOLS.AuditLogger) private readonly audit: AuditLogger,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly mapper: DtoMapper,
    private readonly scheduleService: ScheduleGenerationService,
    private readonly escalation: EscalationEngine,
    private readonly trustedContactsUseCase: TrustedContactUseCase,
  ) {}

  // ─────────────────────────────── إنشاء ───────────────────────────────

  async create(
    userId: UserId,
    input: {
      displayName: string;
      relationship: Relationship;
      schedule: { weekdays: Weekday[]; times: LocalTime[]; timezone?: string };
      phone?: string | null;
      notes?: string | null;
      photoUrl?: string | null;
      isAppUser?: boolean;
      seniorMode?: boolean;
      gracePeriodMinutes?: number;
      quietHours?: { start: LocalTime; end: LocalTime } | null;
      trustedContact?: { fullName: string; phone: string; relationship?: Relationship | null } | null;
    },
    ctx: RequestContext = {},
  ): Promise<CreatePersonResponse> {
    const user = await this.access.requireUser(userId);
    const m = getMessages(user.locale);

    const ownedCount = await this.persons.countOwned(userId);
    if (ownedCount >= LIMITS.maxPersonsPerUser) {
      throw new ValidationError(`You can follow up to ${LIMITS.maxPersonsPerUser} people`, { field: 'displayName' });
    }

    const displayName = sanitizeName(input.displayName);
    if (!isRelationship(input.relationship) || !(ALL_RELATIONSHIPS as readonly string[]).includes(input.relationship)) {
      throw new ValidationError('Choose a relationship from the list', { field: 'relationship' });
    }

    const timezone = assertValidTimezone(input.schedule?.timezone ?? user.timezone);
    const pattern = WeeklyPattern.create({
      weekdays: input.schedule?.weekdays ?? [],
      times: input.schedule?.times ?? [],
      timezone,
    });

    const phone = input.phone ? assertValidPhone(input.phone) : null;
    const notes = sanitizeNotes(input.notes);
    const gracePeriodMinutes = clampGrace(
      input.gracePeriodMinutes ?? this.config.scheduler.defaultGracePeriodMinutes,
    );
    const quietHours = normalizeQuietHours(input.quietHours);
    const now = this.clock.now();

    const person = await this.persons.create({
      id: this.ids.uuid(),
      ownerUserId: userId,
      familyId: null,
      displayName,
      relationship: input.relationship,
      phone,
      phoneHash: phone ? this.crypto.hmac(phone) : null,
      photoUrl: input.photoUrl ?? null,
      notes,
      timezone,
      seniorMode: Boolean(input.seniorMode),
      isAppUser: Boolean(input.isAppUser),
      linkedUserId: null,
      gracePeriodMinutes,
      quietHoursStart: quietHours?.start ?? null,
      quietHoursEnd: quietHours?.end ?? null,
      pausedUntil: null,
      pauseReason: null,
      pauseNote: null,
      deceasedReportedAt: null,
      deceasedReportedBy: null,
      consentStatus: 'not_required',
      lastCheckInAt: null,
      lastCheckInMethod: null,
      lastContactAt: null,
      cachedStatus: 'upcoming',
    });

    // قواعد التصعيد: قيم افتراضية إنسانية + **بدون** تصعيد تلقائي (لا موافقة بعد)
    await this.rules.upsert({
      personId: person.id,
      enabled: true,
      autoEscalationEnabled: false,
      reminderDelayMinutes: 0,
      secondReminderDelayMinutes: 60,
      trustedContactDelayMinutes: 180,
      nextContactDelayMinutes: 240,
      maxContacts: input.trustedContact ? 1 : 0,
      gracePeriodMinutes,
      quietHoursStart: quietHours?.start ?? '22:00',
      quietHoursEnd: quietHours?.end ?? '08:00',
      quietHoursTimezone: timezone,
      emergencyGuidance: true,
      autoEscalationConsentGrantedAt: null,
      autoEscalationConsentRevokedAt: null,
      consentVersion: null,
    });

    const { schedule, generated } = await this.scheduleService.upsertBaseSchedule(person, {
      weekdays: [...pattern.weekdays] as Weekday[],
      times: [...pattern.times] as LocalTime[],
      timezone,
    });

    let invitation: CreatePersonResponse['invitation'] = null;
    if (input.trustedContact) {
      invitation = await this.trustedContactsUseCase.invite(
        userId,
        {
          personId: person.id,
          fullName: input.trustedContact.fullName,
          phone: input.trustedContact.phone,
          relationship: input.trustedContact.relationship ?? null,
        },
        ctx,
      );
    }

    await this.audit.log({
      actorUserId: userId,
      action: 'person.created',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { relationship: person.relationship, scheduleKind: schedule.kind, generatedEntries: generated },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const live = await this.escalation.refreshPersonStatus(person);
    const stored = await this.persons.findById(person.id);
    const dto = this.mapper.toPersonDto({
      person: stored ?? { ...person, cachedStatus: live },
      status: live,
      schedule,
      trustedContacts: [],
      invitations: [],
      locale: user.locale,
    });

    return {
      person: dto,
      confirmationMessage: getMessages(user.locale).person.addedConfirmation(
        displayName,
        getMessages(user.locale).relationship[input.relationship],
      ),
      invitation,
      generatedEntries: generated,
    };
  }

  // ─────────────────────────────── القراءة ───────────────────────────────

  async list(
    userId: UserId,
    query: { q?: string; status?: PersonStatus | 'needs_check_in'; page?: number; pageSize?: number } = {},
  ): Promise<{
    items: import('@wesal/shared').PersonCardDto[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    filters: { key: string; label: string; count: number }[];
  }> {
    const user = await this.access.requireUser(userId);
    const m = getMessages(user.locale);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50));
    const now = this.clock.now();

    // نحمّل كل الأشخاص (الحد الأقصى 200) ثم نحسب الحالات لحظيًا دفعة واحدة
    const all = await this.persons.listAllOwned(userId);
    const statuses = await this.scheduleService.computeLiveStatuses(all, now);

    const term = query.q?.trim().toLowerCase();
    const filtered = all.filter((person) => {
      if (term) {
        const phone = person.phone ?? '';
        const haystack = [
          person.displayName.toLowerCase(),
          person.relationship,
          m.relationship[person.relationship] ?? '',
          phone,
          statuses.get(person.id)?.status ?? person.cachedStatus,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (query.status) {
        const status = statuses.get(person.id)?.status ?? person.cachedStatus;
        if (query.status === 'needs_check_in') {
          if (!['due', 'unverified', 'needs_followup'].includes(status)) return false;
        } else if (status !== query.status) return false;
      }
      return true;
    });

    const cards = filtered
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

    const start = (page - 1) * pageSize;
    const items = cards.slice(start, start + pageSize);

    const counts = countByStatus(all.map((p) => statuses.get(p.id)?.status ?? p.cachedStatus));
    const filters = [
      { key: 'all', label: user.locale === 'ar' ? 'الكل' : 'All', count: all.length },
      {
        key: 'needs_check_in',
        label: user.locale === 'ar' ? 'يحتاجون الاطمئنان' : 'Need check-in',
        count: counts.due + counts.unverified + counts.needs_followup,
      },
      { key: 'checked', label: m.status.checked, count: counts.checked },
      { key: 'unverified', label: m.status.unverified, count: counts.unverified },
      { key: 'needs_followup', label: m.status.needs_followup, count: counts.needs_followup },
    ];

    return {
      items,
      page,
      pageSize,
      total: cards.length,
      hasMore: start + pageSize < cards.length,
      filters,
    };
  }

  async get(userId: UserId, personId: string): Promise<PersonDetailResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const now = this.clock.now();

    const live = await this.scheduleService.computeLiveStatuses([person], now);
    const liveStatus = live.get(person.id)?.status ?? person.cachedStatus;
    const openEntry = live.get(person.id)?.openEntry ?? null;
    const nextEntry = live.get(person.id)?.nextEntry ?? null;

    const schedule = await this.schedules.findByPerson(person.id, { activeOnly: true });
    const contacts = await this.trustedContacts.listForPerson(person.id, { acceptedOnly: true });
    const invitations = await this.invitations.listForPerson(person.id);
    const week = await this.scheduleService.getWeek({ user, persons: [person] });
    const exceptions = await this.exceptions.listForPerson(person.id, week.weekStart, week.weekEnd);

    const checkInRows = await this.checkIns.listForPerson(person.id, { limit: 20 });
    const attemptRows = await this.attempts.listForPerson(person.id, { limit: 20 });
    const logs = [
      ...checkInRows.map((c) => this.mapper.toLogRow({ checkIn: c, person, locale: user.locale })),
      ...attemptRows
        .filter((a) => a.outcome === 'no_answer' || a.outcome === 'unreachable')
        .map((a) => this.mapper.toLogRow({ attempt: a, person, locale: user.locale })),
    ]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 20);

    const timeline = openEntry
      ? await this.escalation.timelineForEntry(openEntry, person)
      : { steps: [], autoEscalationEnabled: false };

    const dto: PersonDto = this.mapper.toPersonDto({
      person,
      status: liveStatus,
      schedule,
      trustedContacts: contacts,
      invitations,
      locale: user.locale,
    });

    return {
      person: { ...dto, nextEntryAt: nextEntry?.scheduledFor.toISOString() ?? null },
      week: week.days.map((day) =>
        this.mapper.toWeekDayDto({
          date: day.date,
          weekday: day.weekday,
          isToday: day.isToday,
          entries: day.entries.map(({ entry, person: p, status }) => ({
            ...this.mapper.toEntryDto(entry, user.locale, status),
            person: this.mapper.toPersonCard({ person: p, status: entryToPersonStatus(status), entry, locale: user.locale, now }),
          })),
        }),
      ),
      recentLogs: logs,
      exceptions: exceptions.map((e) => this.mapper.toExceptionDto(e)),
      timeline,
      messages: {
        reassured: m.actions.reassured,
        calledNoAnswer: m.actions.calledNoAnswer,
        snooze: m.actions.snooze,
        callNow: m.actions.callNow,
        sendMessage: m.actions.sendMessage,
        statusHint: m.statusHint[liveStatus] ?? '',
      },
    };
  }

  // ─────────────────────────────── التعديل ───────────────────────────────

  async update(userId: UserId, personId: string, patch: UpdatePersonRequest, ctx: RequestContext = {}): Promise<UpdatePersonResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);

    const update: Partial<PersonRecord> = {};
    if (patch.displayName !== undefined) update.displayName = sanitizeName(patch.displayName);
    if (patch.relationship !== undefined) {
      if (!isRelationship(patch.relationship)) throw new ValidationError('Choose a relationship from the list', { field: 'relationship' });
      update.relationship = patch.relationship;
    }
    if (patch.phone !== undefined) {
      const phone = patch.phone ? assertValidPhone(patch.phone) : null;
      update.phone = phone;
      update.phoneHash = phone ? this.crypto.hmac(phone) : null;
    }
    if (patch.notes !== undefined) update.notes = sanitizeNotes(patch.notes);
    if (patch.photoUrl !== undefined) update.photoUrl = patch.photoUrl;
    if (patch.seniorMode !== undefined) update.seniorMode = patch.seniorMode;
    if (patch.gracePeriodMinutes !== undefined) update.gracePeriodMinutes = clampGrace(patch.gracePeriodMinutes);
    if (patch.quietHours !== undefined) {
      const quiet = normalizeQuietHours(patch.quietHours);
      update.quietHoursStart = quiet?.start ?? null;
      update.quietHoursEnd = quiet?.end ?? null;
    }

    let regenerated = 0;
    let updatedPerson = Object.keys(update).length > 0 ? await this.persons.update(person.id, update) : person;

    if (patch.schedule) {
      const timezone = assertValidTimezone(patch.schedule.timezone ?? updatedPerson.timezone);
      const pattern = WeeklyPattern.create({
        weekdays: patch.schedule.weekdays ?? [],
        times: patch.schedule.times ?? [],
        timezone,
      });
      updatedPerson = await this.persons.update(updatedPerson.id, { timezone });
      const result = await this.scheduleService.upsertBaseSchedule(updatedPerson, {
        weekdays: [...pattern.weekdays] as Weekday[],
        times: [...pattern.times] as LocalTime[],
        timezone,
      });
      regenerated = result.generated;
    }

    if (patch.gracePeriodMinutes !== undefined || patch.quietHours !== undefined) {
      const rule = await this.rules.findByPerson(person.id);
      if (rule) {
        await this.rules.upsert({
          ...rule,
          gracePeriodMinutes: updatedPerson.gracePeriodMinutes,
          quietHoursStart: updatedPerson.quietHoursStart ?? rule.quietHoursStart,
          quietHoursEnd: updatedPerson.quietHoursEnd ?? rule.quietHoursEnd,
          quietHoursTimezone: updatedPerson.timezone,
        });
      }
    }

    await this.audit.log({
      actorUserId: userId,
      action: 'person.updated',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { fields: Object.keys(patch) },
      ip: ctx.ip ?? null,
    });

    const live = await this.escalation.refreshPersonStatus(updatedPerson);
    const schedule = await this.schedules.findByPerson(person.id, { activeOnly: true });
    const contacts = await this.trustedContacts.listForPerson(person.id, { acceptedOnly: true });
    const invitations = await this.invitations.listForPerson(person.id);

    return {
      person: this.mapper.toPersonDto({
        person: updatedPerson,
        status: live,
        schedule,
        trustedContacts: contacts,
        invitations,
        locale: user.locale,
      }),
      regeneratedEntries: regenerated,
      message: user.locale === 'ar' ? 'تم الحفظ ❤️' : 'Saved ❤️',
    };
  }

  // ─────────────────────── الإيقاف المؤقت ووضع السفر ───────────────────────

  async pause(
    userId: UserId,
    personId: string,
    input: { until?: string | null; reason?: PauseReason; note?: string | null; temporarySchedule?: { weekdays: Weekday[]; times: LocalTime[]; timezone?: string; from?: string } | null },
    ctx: RequestContext = {},
  ): Promise<PausePersonResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const now = this.clock.now();

    const until = input.until ? new Date(input.until) : null;
    if (until && Number.isNaN(until.getTime())) {
      throw new ValidationError('Enter a valid date to pause until', { field: 'until' });
    }
    if (until && until.getTime() <= now.getTime()) {
      throw new ValidationError('The pause date must be in the future', { field: 'until' });
    }

    const reason = input.reason ?? PauseReason.Manual;
    const updated = await this.persons.update(person.id, {
      pausedUntil: until,
      pauseReason: reason,
      pauseNote: sanitizeNotes(input.note ?? null),
      cachedStatus: 'paused',
    });

    // إلغاء المواعيد القادمة داخل فترة الإيقاف (السجل التاريخي يبقى كما هو)
    const cancelled = await this.scheduleService.cancelUpcomingEntries(person.id, now, 'paused');

    let temporarySchedule: PausePersonResponse['temporarySchedule'] = null;
    if (input.temporarySchedule) {
      const timezone = assertValidTimezone(input.temporarySchedule.timezone ?? person.timezone);
      const created = await this.scheduleService.createTemporarySchedule(updated, {
        weekdays: input.temporarySchedule.weekdays ?? [],
        times: input.temporarySchedule.times ?? [],
        timezone,
        from: input.temporarySchedule.from ? toLocalDate(new Date(input.temporarySchedule.from), timezone) : toLocalDate(now, timezone),
        until: until ? toLocalDate(until, timezone) : null,
      });
      temporarySchedule = this.mapper.toScheduleDto(created);
      await this.scheduleService.ensureEntriesForPerson(updated, { fromDate: toLocalDate(now, timezone) });
    }

    await this.audit.log({
      actorUserId: userId,
      action: `person.paused.${reason}`,
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { until: until?.toISOString() ?? null, cancelledEntries: cancelled },
      ip: ctx.ip ?? null,
    });

    return {
      personId: person.id,
      pausedUntil: until?.toISOString() ?? null,
      cancelledEntries: cancelled,
      temporarySchedule,
      message:
        reason === PauseReason.Travel
          ? user.locale === 'ar'
            ? '✈️ وضع السفر مفعّل. سنوقف المواعيد حتى تعود، ثم يعود الجدول تلقائيًا.'
            : '✈️ Travel mode is on. Appointments are paused until you return, then the schedule resumes automatically.'
          : user.locale === 'ar'
            ? 'أوقفنا التذكيرات مؤقتًا. تعود تلقائيًا في الموعد المحدد.'
            : 'Reminders are paused for now. They resume automatically at the date you set.',
    };
  }

  async resume(userId: UserId, personId: string, ctx: RequestContext = {}): Promise<PausePersonResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const now = this.clock.now();

    const updated = await this.persons.update(person.id, {
      pausedUntil: null,
      pauseReason: null,
      pauseNote: null,
    });

    const generated = await this.scheduleService.ensureEntriesForPerson(updated, { fromDate: toLocalDate(now, updated.timezone) });
    await this.escalation.refreshPersonStatus(updated);

    await this.audit.log({
      actorUserId: userId,
      action: 'person.resumed',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { generatedEntries: generated.created },
      ip: ctx.ip ?? null,
    });

    return {
      personId: person.id,
      pausedUntil: null,
      cancelledEntries: 0,
      temporarySchedule: null,
      message:
        user.locale === 'ar'
          ? `عاد الجدول للعمل ❤️ أنشأنا ${generated.created} موعدًا قادمًا.`
          : `The schedule is back ❤️ We created ${generated.created} upcoming appointments.`,
    };
  }

  // ─────────────────────────────── الإزالة ───────────────────────────────

  async remove(userId: UserId, personId: string, ctx: RequestContext = {}): Promise<RemovePersonResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);
    const now = this.clock.now();

    await this.scheduleService.cancelUpcomingEntries(person.id, now, 'paused');
    await this.persons.softDelete(person.id);
    await this.escalation.resolveOnCheckIn({ personId, reason: 'person_removed' });

    await this.audit.log({
      actorUserId: userId,
      action: 'person.deleted',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      ip: ctx.ip ?? null,
    });

    return { personId, message: m.person.deletedConfirmation(person.displayName) };
  }

  /**
   * ⚫ "تم الإبلاغ عن الوفاة" — إدخال يدوي من شخص مخوّل فقط، وبعده تتوقف التذكيرات.
   *
   * ضمانات:
   *  - لا يُستنتج تلقائيًا أبدًا (لا من غياب رد ولا من أي إشارة أخرى).
   *  - يتطلب مالك الشخص + تأكيد صريح (`confirm: true`).
   *  - يُسجَّل في سجل التدقيق مع من ومتى.
   */
  async reportDeceased(
    userId: UserId,
    personId: string,
    input: { confirm: boolean; note?: string | null },
    ctx: RequestContext = {},
  ): Promise<ReportDeceasedResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    this.access.assertCanReportDeceased(user, person);

    if (input.confirm !== true) {
      throw new ValidationError(
        user.locale === 'ar'
          ? 'هذا إجراء حساس. أكِّد أنك تريد إيقاف التذكيرات نهائيًا.'
          : 'This is a sensitive action. Confirm that you want to stop reminders permanently.',
        { field: 'confirm' },
      );
    }
    if (person.deceasedReportedAt) {
      throw new ConflictError('This status was already recorded');
    }

    const now = this.clock.now();
    await this.persons.update(person.id, {
      deceasedReportedAt: now,
      deceasedReportedBy: userId,
      cachedStatus: 'deceased_reported',
      pausedUntil: null,
      pauseReason: null,
    });

    const cancelled = await this.scheduleService.cancelUpcomingEntries(person.id, now, 'deceased');
    await this.escalation.resolveOnCheckIn({ personId, reason: 'deceased_reported' });

    await this.audit.log({
      actorUserId: userId,
      action: 'person.deceased_reported',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { confirmed: true, cancelledEntries: cancelled, note: sanitizeNotes(input.note ?? null) },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    this.logger.warn(`Deceased reported for person ${person.id} by user ${userId} — all reminders stopped`);

    return {
      personId,
      stoppedReminders: true,
      cancelledEntries: cancelled,
      message:
        user.locale === 'ar'
          ? 'توقفت كل التذكيرات. رحمه الله وغفر له.'
          : 'All reminders have stopped. May they rest in peace.',
      warning: getMessages(user.locale).escalation.notADangerStatement,
    };
  }

  // ─────────────────────── الشفافية: من يراني؟ ───────────────────────

  async whoSeesMe(userId: UserId, personId: string): Promise<WhoSeesMeResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);

    const contacts = await this.trustedContacts.listForPerson(person.id);
    const invitations = await this.invitations.listForPerson(person.id);
    const rule = await this.rules.findByPerson(person.id);

    return {
      personId: person.id,
      familyMembers: [{ id: user.id, displayName: user.displayName ?? m.auth.phoneTitle, role: 'owner' }],
      trustedContacts: contacts.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        scopes: c.scopes,
        status: c.status === 'accepted' ? 'accepted' : 'revoked',
      })),
      pendingInvitations: invitations
        .filter((i) => i.status === 'invited')
        .map((i) => ({ id: i.id, fullName: i.fullName, status: 'invited' as const, expiresAt: i.expiresAt.toISOString() })),
      autoEscalationConsent: {
        granted: Boolean(rule?.autoEscalationConsentGrantedAt && !rule?.autoEscalationConsentRevokedAt),
        grantedAt: rule?.autoEscalationConsentGrantedAt?.toISOString() ?? null,
        revocable: true,
        promptTitle: m.escalation.autoConsentTitle,
        promptBody: m.escalation.autoConsentBody,
        acceptLabel: m.escalation.autoConsentAccept,
        declineLabel: m.escalation.autoConsentDecline,
      },
      canStopEverything: true,
    };
  }

  // ─────────────────────── الاستثناءات (يوم واحد) ───────────────────────

  async addException(
    userId: UserId,
    personId: string,
    input: { date: string; action: 'move' | 'skip' | 'add'; times?: LocalTime[]; note?: string | null },
    ctx: RequestContext = {},
  ): Promise<{ exception: ScheduleExceptionRecord; affectedEntryIds: string[]; message: string }> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const m = getMessages(user.locale);

    for (const time of input.times ?? []) {
      if (!isLocalTime(time)) throw new ValidationError(`Invalid time: ${time}`, { field: 'times' });
    }

    const result = await this.scheduleService.applyException(person, input);

    await this.audit.log({
      actorUserId: userId,
      action: `schedule.exception.${input.action}`,
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { date: input.date, times: input.times ?? [], affected: result.affectedEntryIds.length },
      ip: ctx.ip ?? null,
    });

    const timeLabel = input.times?.[0] ?? '';
    return {
      exception: result.exception,
      affectedEntryIds: result.affectedEntryIds,
      message:
        input.action === 'skip'
          ? user.locale === 'ar'
            ? `ألغينا مواعيد ${person.displayName} في ${input.date}. يعود الجدول الأساسي بعدها تلقائيًا.`
            : `We cancelled ${person.displayName}’s appointments on ${input.date}. The base schedule returns automatically.`
          : m.schedule.exceptionThisWeekOnly(person.displayName, timeLabel),
    };
  }

  async removeException(userId: UserId, personId: string, date: string): Promise<{ removed: boolean; restoredEntryIds: string[] }> {
    await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const result = await this.scheduleService.removeException(person, date);
    await this.audit.log({
      actorUserId: userId,
      action: 'schedule.exception_removed',
      entityType: 'person',
      entityId: person.id,
      personId: person.id,
      metadata: { date },
    });
    return result;
  }

  /** مواعيد يوم محدد — تُستخدم في التقويم اليومي داخل صفحة الشخص */
  async dayEntries(userId: UserId, personId: string, date: string): Promise<ScheduleEntryRecord[]> {
    await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, personId);
    const localDate = date ?? toLocalDate(this.clock.now(), person.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      throw new ValidationError('Invalid date', { field: 'date' });
    }
    return this.entries.findByPersonAndLocalDate(person.id, localDate);
  }
}

// ─────────────────────────────── مساعدات التحقق ───────────────────────────────

export function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('Name is required', { field: 'displayName' });
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length < LIMITS.personNameMin) {
    throw new ValidationError('Enter a name (it can be like “My grandmother”)', { field: 'displayName' });
  }
  if (trimmed.length > LIMITS.personNameMax) {
    throw new ValidationError(`Name is too long (max ${LIMITS.personNameMax})`, { field: 'displayName' });
  }
  return trimmed;
}

function sanitizeNotes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > LIMITS.notesMax) {
    throw new ValidationError(`Notes are too long (max ${LIMITS.notesMax})`, { field: 'notes' });
  }
  return trimmed;
}

export function clampGrace(minutes: number): number {
  if (!Number.isFinite(minutes)) throw new ValidationError('Invalid grace period', { field: 'gracePeriodMinutes' });
  if (minutes < 0 || minutes > 10080) {
    throw new ValidationError('Grace period must be between 0 minutes and 7 days', { field: 'gracePeriodMinutes' });
  }
  return Math.round(minutes);
}

function normalizeQuietHours(input: { start: LocalTime; end: LocalTime } | null | undefined): { start: LocalTime; end: LocalTime } | null {
  if (!input) return null;
  if (!isLocalTime(input.start) || !isLocalTime(input.end)) {
    throw new ValidationError('Quiet hours must use HH:mm format', { field: 'quietHours' });
  }
  return { start: input.start, end: input.end };
}

function countByStatus(statuses: PersonStatus[]): Record<string, number> {
  const out: Record<string, number> = {
    checked: 0,
    upcoming: 0,
    due: 0,
    unverified: 0,
    needs_followup: 0,
    paused: 0,
    deceased_reported: 0,
  };
  for (const status of statuses) out[status] = (out[status] ?? 0) + 1;
  return out;
}

/** تحويل حالة موعد إلى حالة شخص للعرض في بطاقة اليوم */
function entryToPersonStatus(status: import('@wesal/shared').EntryStatus): PersonStatus {
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
