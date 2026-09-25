import { Inject, Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import type {
  CheckInStatus,
  EntryStatus,
  ExceptionAction,
  LocalTime,
  Locale,
  PersonStatus,
  UserId,
  Weekday,
} from '@wesal/shared';
import { ExceptionAction as Action, inferScheduleKind } from '@wesal/shared';
import type {
  PersonRecord,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  ScheduleRecord,
  ScheduledJobRecord,
} from '../ports/records';
import type {
  CheckInRepository,
  ScheduleEntryRepository,
  ScheduleExceptionRepository,
  ScheduleRepository,
  ScheduledJobRepository,
} from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { SYMBOLS, type IdGenerator } from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { WeeklyPattern } from '../../domain/schedule/weekly-pattern';
import { occurrencesForLocalDate } from '../../domain/schedule/schedule-engine';
import { computeEntryStatus, computeGraceUntil } from '../../domain/schedule/entry-status';
import { ValidationError } from '../../domain/shared/errors';
import {
  addDaysToLocalDate,
  assertValidLocalDate,
  assertValidTimezone,
  localDateRange,
  localToUtcInstant,
  startOfWeek,
  toLocalDate,
  uniqueSortedTimes,
  uniqueSortedWeekdays,
} from '../../domain/shared/time';
import { CONFIG, type AppConfig } from '../../config/configuration';

/**
 * خدمة الجدولة — توليد مواعيد الأسبوع، الاستثناءات، وضع السفر، وعرض الأسبوع.
 *
 * المبادئ:
 *  - **التكرار يُنشئ الأسبوع التالي تلقائيًا بنفس الجدول**، مع إمكانية تعديل أي أسبوع.
 *  - الاستثناء يعدّل يومًا واحدًا ثم يعود الجدول الأساسي تلقائيًا.
 *  - الإيقاف (سفر ✈️ أو يدوي) يُلغي المواعيد القادمة ولا يحذف السجل التاريخي.
 *  - كل الحسابات الزمنية في منطقة الشخص/المستخدم الصحيحة (لا افتراض UTC).
 */

export interface EnsureEntriesResult {
  created: number;
  skippedExisting: number;
  weekStart: string;
  weekEnd: string;
}

export interface WeekDayProjection {
  date: string;
  weekday: Weekday;
  isToday: boolean;
  entries: { entry: ScheduleEntryRecord; person: PersonRecord; status: EntryStatus }[];
}

export interface WeekProjection {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  days: WeekDayProjection[];
}

type NewEntry = Omit<ScheduleEntryRecord, 'createdAt' | 'updatedAt'>;

/** كم يومًا نبحث فيها عن موعد لم يُتحقق منه قبل اعتبار الشخص "منتظمًا" */
export const STATUS_LOOKBACK_DAYS = 14;

@Injectable()
export class ScheduleGenerationService {
  private readonly logger = new Logger('ScheduleGeneration');

  constructor(
    @Inject(REPOSITORIES.schedules) private readonly schedules: ScheduleRepository,
    @Inject(REPOSITORIES.scheduleExceptions) private readonly exceptions: ScheduleExceptionRepository,
    @Inject(REPOSITORIES.scheduleEntries) private readonly entries: ScheduleEntryRepository,
    @Inject(REPOSITORIES.checkIns) private readonly checkIns: CheckInRepository,
    @Inject(REPOSITORIES.scheduledJobs) private readonly jobs: ScheduledJobRepository,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * يضمن وجود مواعيد للشخص لعدد أسابيع قادمة. آمن للتكرار:
   * يتخطى المواعيد الموجودة (مطابقة person_id + scheduled_for في القاعدة).
   */
  async ensureEntriesForPerson(
    person: PersonRecord,
    options: { weeksAhead?: number; fromDate?: string; enqueueReminders?: boolean } = {},
  ): Promise<EnsureEntriesResult> {
    const weeksAhead = Math.max(1, options.weeksAhead ?? this.config.scheduler.weeksAhead);
    const now = this.clock.now();
    const timezone = person.timezone;
    const todayLocal = options.fromDate ?? toLocalDate(now, timezone);
    const days = weeksAhead * 7;
    const endLocalDate = addDaysToLocalDate(todayLocal, days - 1);

    const baseSchedule = await this.schedules.findByPerson(person.id, { activeOnly: true });
    if (!baseSchedule) {
      return { created: 0, skippedExisting: 0, weekStart: todayLocal, weekEnd: endLocalDate };
    }

    const temporarySchedule = await this.schedules.findTemporaryForPerson(person.id, now);
    const exceptions = await this.exceptions.listForPerson(person.id, todayLocal, endLocalDate);
    const existing = await this.entries.list({
      personIds: [person.id],
      fromLocalDate: todayLocal,
      toLocalDate: endLocalDate,
      limit: 5000,
    });
    // المواعيد الملغاة (بسبب إيقاف/سفر سابق) تُعاد للحياة عند إعادة التوليد بدل تجاهلها
    const existingKeys = new Set(
      existing.filter((e) => e.status !== 'cancelled').map((e) => `${e.localDate}|${e.localTime}`),
    );

    const basePattern = toPattern(baseSchedule);
    const tempPattern = temporarySchedule ? toPattern(temporarySchedule) : null;

    const created: NewEntry[] = [];
    let skippedExisting = 0;

    for (const date of localDateRange(todayLocal, days)) {
      const patternForDate = pickPatternForDate(date, basePattern, tempPattern, temporarySchedule);
      if (!patternForDate) continue;

      for (const occurrence of occurrencesForLocalDate(patternForDate, date, exceptions)) {
        const scheduledFor = new Date(occurrence.scheduledFor);

        // إيقاف/سفر أو إبلاغ: لا مواعيد جديدة داخل الفترة
        if (this.isSuppressedAt(person, scheduledFor, now)) continue;

        const key = `${occurrence.localDate}|${occurrence.localTime}`;
        if (existingKeys.has(key)) {
          skippedExisting += 1;
          continue;
        }
        existingKeys.add(key);

        const graceUntil = computeGraceUntil(scheduledFor, person.gracePeriodMinutes);
        created.push({
          id: this.ids.uuid(),
          personId: person.id,
          scheduledFor,
          localDate: occurrence.localDate,
          localTime: occurrence.localTime,
          timezone: occurrence.timezone,
          status: computeEntryStatus({ id: 'pending', scheduledFor, graceUntil }, now, { checkIns: [] }),
          source: occurrence.source,
          exceptionId: occurrence.exceptionId ?? null,
          graceUntil,
          snoozedUntil: null,
          completedAt: null,
          completedBy: null,
          cancelledAt: null,
          lastEvaluatedAt: now,
        });
      }
    }

    if (created.length === 0) {
      return { created: 0, skippedExisting, weekStart: todayLocal, weekEnd: endLocalDate };
    }

    const inserted = await this.entries.insertMany(created);
    if (options.enqueueReminders !== false) await this.enqueueReminderJobs(created);

    this.logger.debug(
      `Generated ${inserted} entries for person ${person.id} (${todayLocal} → ${endLocalDate})`,
    );
    return { created: inserted, skippedExisting, weekStart: todayLocal, weekEnd: endLocalDate };
  }

  /** هل الموعد داخل فترة إيقاف (سفر/يدوي) أو بعد إبلاغ؟ */
  private isSuppressedAt(person: PersonRecord, scheduledFor: Date, now: Date): boolean {
    if (person.deceasedReportedAt) return true;
    if (person.pausedUntil && scheduledFor.getTime() < person.pausedUntil.getTime() && scheduledFor.getTime() >= now.getTime()) {
      return true;
    }
    return false;
  }

  /** طابور تذكيرات الخادم: لكل موعد جديد تذكير عند الموعد وإعادة محاولة بعدها */
  private async enqueueReminderJobs(entries: NewEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.jobs.enqueue(this.reminderJob(entry.id, entry.personId, entry.scheduledFor, 1));
      const retryAt = new Date(entry.scheduledFor.getTime() + 60 * 60_000);
      await this.jobs.enqueue(this.reminderJob(entry.id, entry.personId, retryAt, 2));
    }
  }

  private reminderJob(entryId: string, personId: string, runAt: Date, stage: 1 | 2): Omit<ScheduledJobRecord, 'createdAt' | 'completedAt'> {
    return {
      id: this.ids.uuid(),
      kind: stage === 1 ? 'reminder' : 'retry',
      runAt,
      payloadJson: JSON.stringify({ personId, entryId, stage }),
      status: 'pending',
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      idempotencyKey: `reminder:${entryId}:${stage}`,
    };
  }

  /** إلغاء المواعيد القادمة عند الإيقاف (سفر) أو الإبلاغ أو تغيير الجدول */
  async cancelUpcomingEntries(
    personId: string,
    fromInstant: Date,
    reason: 'paused' | 'deceased' | 'schedule_changed',
  ): Promise<number> {
    const upcoming = await this.entries.list({
      personIds: [personId],
      from: fromInstant,
      statuses: ['upcoming'],
      limit: 5000,
    });
    for (const entry of upcoming) {
      await this.entries.updateStatus(entry.id, {
        status: 'cancelled',
        cancelledAt: fromInstant,
        lastEvaluatedAt: fromInstant,
      });
    }
    await this.jobs.cancelByKindAndPerson('reminder', personId);
    await this.jobs.cancelByKindAndPerson('retry', personId);
    this.logger.log(`Cancelled ${upcoming.length} upcoming entries for ${personId} (${reason})`);
    return upcoming.length;
  }

  /** إنشاء/تحديث الجدول الأساسي — يُطبَّق من الآن فصاعدًا ولا يمس المواعيد الماضية */
  async upsertBaseSchedule(
    person: PersonRecord,
    input: { weekdays: Weekday[]; times: LocalTime[]; timezone: string },
  ): Promise<{ schedule: ScheduleRecord; generated: number }> {
    const weekdays = uniqueSortedWeekdays(input.weekdays);
    const times = uniqueSortedTimes(input.times);
    const timezone = assertValidTimezone(input.timezone);
    const kind = inferScheduleKind({ weekdays, times });
    const now = this.clock.now();
    const today = toLocalDate(now, timezone);

    const existing = await this.schedules.findByPerson(person.id, { activeOnly: false });
    if (existing) {
      const updated = await this.schedules.update(existing.id, { kind, weekdays, times, timezone, active: true });
      await this.cancelUpcomingEntries(person.id, now, 'schedule_changed');
      const generated = await this.ensureEntriesForPerson({ ...person, timezone }, { fromDate: today });
      return { schedule: updated, generated: generated.created };
    }

    const created = await this.schedules.create({
      id: this.ids.uuid(),
      personId: person.id,
      kind,
      weekdays,
      times,
      timezone,
      active: true,
      isTemporary: false,
      effectiveFrom: today,
      effectiveTo: null,
    });
    const generated = await this.ensureEntriesForPerson({ ...person, timezone }, { fromDate: today });
    return { schedule: created, generated: generated.created };
  }

  /** جدول مؤقت أثناء السفر ✈️ — يعمل خلال نافذته ثم يعود الجدول الأساسي تلقائيًا */
  async createTemporarySchedule(
    person: PersonRecord,
    input: { weekdays: Weekday[]; times: LocalTime[]; timezone: string; from: string; until: string | null },
  ): Promise<ScheduleRecord> {
    const weekdays = uniqueSortedWeekdays(input.weekdays);
    const times = uniqueSortedTimes(input.times);
    const timezone = assertValidTimezone(input.timezone);

    const existing = await this.schedules.findTemporaryForPerson(person.id, this.clock.now());
    if (existing) await this.schedules.deactivate(existing.id);

    return this.schedules.create({
      id: this.ids.uuid(),
      personId: person.id,
      kind: inferScheduleKind({ weekdays, times }),
      weekdays,
      times,
      timezone,
      active: true,
      isTemporary: true,
      effectiveFrom: assertValidLocalDate(input.from),
      effectiveTo: input.until ? assertValidLocalDate(input.until) : null,
    });
  }

  /**
   * استثناء ليوم واحد — "هذا الأسبوع فقط اجعل موعد جدتي 6 م بدل 8 م".
   * لا يلمس المواعيد المكتملة، ويعيد بناء مواعيد ذلك اليوم فقط.
   */
  async applyException(
    person: PersonRecord,
    input: { date: string; action: ExceptionAction; times?: LocalTime[]; note?: string | null },
  ): Promise<{ exception: ScheduleExceptionRecord; affectedEntryIds: string[] }> {
    const date = assertValidLocalDate(input.date);
    const action = input.action;
    if (!(Object.values(Action) as string[]).includes(action)) {
      throw new ValidationError(`Unsupported exception action: ${String(action)}`, { field: 'action' });
    }

    const times = action === Action.Skip ? [] : uniqueSortedTimes(input.times ?? []);
    if (action !== Action.Skip && times.length === 0) {
      throw new ValidationError('Choose at least one time for this exception', { field: 'times' });
    }

    const existing = await this.exceptions.findByPersonAndDate(person.id, date, action);
    if (existing) await this.exceptions.remove(existing.id);

    const exception = await this.exceptions.create({
      id: this.ids.uuid(),
      personId: person.id,
      date,
      action,
      times,
      note: input.note ?? null,
    });

    const now = this.clock.now();
    const affected: string[] = [];

    // 1) إلغاء المواعيد غير المكتملة التي لم تعد مطلوبة في هذا اليوم
    const dayEntries = await this.entries.findByPersonAndLocalDate(person.id, date);
    for (const entry of dayEntries) {
      if (entry.status === 'checked' || entry.completedAt) continue;
      const shouldCancel =
        entry.scheduledFor.getTime() >= now.getTime() &&
        (action === Action.Skip || (action === Action.Move && !times.includes(entry.localTime)));
      if (shouldCancel) {
        await this.entries.updateStatus(entry.id, { status: 'cancelled', cancelledAt: now, lastEvaluatedAt: now });
        affected.push(entry.id);
      }
    }

    // 2) إنشاء المواعيد الجديدة (move/add) إن كانت في المستقبل
    for (const time of times) {
      if (action === Action.Move || action === Action.Add) {
        if (await this.entries.hasEntryForLocalDateTime(person.id, date, time)) continue;
      }
      const scheduledFor = localToUtcInstant(date, time, person.timezone).toJSDate();
      if (scheduledFor.getTime() < now.getTime() - 60_000) continue; // لا مواعيد في الماضي

      const graceUntil = computeGraceUntil(scheduledFor, person.gracePeriodMinutes);
      const inserted = await this.entries.insertMany([
        {
          id: this.ids.uuid(),
          personId: person.id,
          scheduledFor,
          localDate: date,
          localTime: time,
          timezone: person.timezone,
          status: computeEntryStatus({ id: 'pending', scheduledFor, graceUntil }, now, { checkIns: [] }),
          source: 'exception',
          exceptionId: exception.id,
          graceUntil,
          snoozedUntil: null,
          completedAt: null,
          completedBy: null,
          cancelledAt: null,
          lastEvaluatedAt: now,
        },
      ]);

      if (inserted > 0) {
        const created = await this.entries.findByPersonAndInstant(person.id, scheduledFor);
        if (created) {
          affected.push(created.id);
          await this.jobs.enqueue(this.reminderJob(created.id, person.id, created.scheduledFor, 1));
          await this.jobs.enqueue(
            this.reminderJob(created.id, person.id, new Date(created.scheduledFor.getTime() + 3_600_000), 2),
          );
        }
      }
    }

    return { exception, affectedEntryIds: affected };
  }

  /**
   * إزالة استثناء يوم → يعود الجدول الأساسي تلقائيًا.
   * تُلغى المواعيد التي أنشأها الاستثناء (ما لم تكتمل) وتُعاد مواعيد الجدول الأساسي.
   */
  async removeException(
    person: PersonRecord,
    date: string,
    action?: ExceptionAction,
  ): Promise<{ removed: boolean; restoredEntryIds: string[] }> {
    const localDate = assertValidLocalDate(date);
    const existing = await this.exceptions.findByPersonAndDate(person.id, localDate, action);
    if (!existing) return { removed: false, restoredEntryIds: [] };

    await this.exceptions.remove(existing.id);
    const now = this.clock.now();

    const dayEntries = await this.entries.findByPersonAndLocalDate(person.id, localDate);
    for (const entry of dayEntries) {
      if (entry.exceptionId !== existing.id) continue;
      if (entry.status === 'checked' || entry.completedAt) continue;
      await this.entries.updateStatus(entry.id, { status: 'cancelled', cancelledAt: now, lastEvaluatedAt: now });
    }

    const restored: string[] = [];
    const baseSchedule = await this.schedules.findByPerson(person.id, { activeOnly: true });
    if (baseSchedule) {
      const pattern = toPattern(baseSchedule);
      for (const occurrence of occurrencesForLocalDate(pattern, localDate, [])) {
        const scheduledFor = new Date(occurrence.scheduledFor);
        if (scheduledFor.getTime() < now.getTime()) continue;
        if (await this.entries.hasEntryForLocalDateTime(person.id, localDate, occurrence.localTime)) continue;

        const graceUntil = computeGraceUntil(scheduledFor, person.gracePeriodMinutes);
        const inserted = await this.entries.insertMany([
          {
            id: this.ids.uuid(),
            personId: person.id,
            scheduledFor,
            localDate: occurrence.localDate,
            localTime: occurrence.localTime,
            timezone: occurrence.timezone,
            status: computeEntryStatus({ id: 'pending', scheduledFor, graceUntil }, now, { checkIns: [] }),
            source: 'schedule',
            exceptionId: null,
            graceUntil,
            snoozedUntil: null,
            completedAt: null,
            completedBy: null,
            cancelledAt: null,
            lastEvaluatedAt: now,
          },
        ]);
        if (inserted > 0) {
          const created = await this.entries.findByPersonAndInstant(person.id, scheduledFor);
          if (created) {
            restored.push(created.id);
            await this.jobs.enqueue(this.reminderJob(created.id, person.id, created.scheduledFor, 1));
            await this.jobs.enqueue(
              this.reminderJob(created.id, person.id, new Date(created.scheduledFor.getTime() + 3_600_000), 2),
            );
          }
        }
      }
    }

    return { removed: true, restoredEntryIds: restored };
  }

  /**
   * عرض الأسبوع (WESAL WEEK).
   * يجمّع المواعيد حسب أيام أسبوع **المستخدم** (لا الشخص) لأن المستخدم هو من يتصرّف،
   * ويحسب الحالات لحظيًا حتى لا تعتمد الشاشة على حالة مخزّنة قديمة.
   */
  async getWeek(input: {
    user: { id: UserId; timezone: string; locale: Locale };
    persons: PersonRecord[];
    startDate?: string;
    viewerTimezone?: string;
  }): Promise<WeekProjection> {
    const viewerTimezone = input.viewerTimezone ?? input.user.timezone;
    const now = this.clock.now();
    const requested = input.startDate ? assertValidLocalDate(input.startDate) : toLocalDate(now, viewerTimezone);
    const weekStart = startOfWeek(requested, viewerTimezone, 6); // الأسبوع يبدأ السبت
    const weekEnd = addDaysToLocalDate(weekStart, 6);

    const windowStart = localToUtcInstant(weekStart, '00:00', viewerTimezone).toJSDate();
    const windowEnd = localToUtcInstant(addDaysToLocalDate(weekEnd, 1), '00:00', viewerTimezone).toJSDate();

    const days: WeekDayProjection[] = localDateRange(weekStart, 7).map((date) => ({
      date,
      weekday: DateTime.fromISO(date, { zone: viewerTimezone }).weekday as Weekday,
      isToday: date === toLocalDate(now, viewerTimezone),
      entries: [],
    }));
    const dayIndex = new Map(days.map((d, i) => [d.date, i] as const));

    const personIds = input.persons.map((p) => p.id);
    if (personIds.length === 0) {
      return { weekStart, weekEnd, timezone: viewerTimezone, days };
    }

    const entries = await this.entries.list({ personIds, from: windowStart, to: windowEnd, limit: 5000 });
    const checkInRows = await this.checkIns.listForEntries(entries.map((e) => e.id));
    const checkInsByEntry = groupCheckIns(checkInRows);
    const personById = new Map(input.persons.map((p) => [p.id, p] as const));

    for (const entry of entries) {
      const person = personById.get(entry.personId);
      if (!person) continue;
      const status = computeEntryStatus(entry, now, {
        checkIns: checkInsByEntry.get(entry.id) ?? [],
        defaultGraceMinutes: person.gracePeriodMinutes,
      });
      const viewerLocalDate = toLocalDate(entry.scheduledFor, viewerTimezone);
      const index = dayIndex.get(viewerLocalDate);
      if (index === undefined) continue;
      const day = days[index];
      if (!day) continue;
      day.entries.push({ entry, person, status });
    }

    for (const day of days) {
      day.entries.sort((a, b) => a.entry.scheduledFor.getTime() - b.entry.scheduledFor.getTime());
    }

    return { weekStart, weekEnd, timezone: viewerTimezone, days };
  }

  /** حالة شخص محسوبة لحظيًا من مواعيده (تُستخدم في الرئيسية وصفحة الشخص) */
  async computeLivePersonStatus(person: PersonRecord, now: Date = this.clock.now()): Promise<{
    status: PersonStatus;
    openEntry: ScheduleEntryRecord | null;
    nextEntry: ScheduleEntryRecord | null;
  }> {
    if (person.deceasedReportedAt) {
      return { status: 'deceased_reported', openEntry: null, nextEntry: null };
    }
    if (person.pausedUntil && person.pausedUntil.getTime() > now.getTime()) {
      return { status: 'paused', openEntry: null, nextEntry: null };
    }

    const lookbackFrom = new Date(now.getTime() - 14 * 24 * 60 * 60_000);
    const entries = await this.entries.list({
      personIds: [person.id],
      from: lookbackFrom,
      to: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      limit: 2000,
    });
    if (entries.length === 0) return { status: 'upcoming', openEntry: null, nextEntry: null };

    const checkInRows = await this.checkIns.listForEntries(entries.map((e) => e.id));
    const checkInsByEntry = groupCheckIns(checkInRows);

    let openEntry: ScheduleEntryRecord | null = null;
    let openStatus: EntryStatus | null = null;
    let nextEntry: ScheduleEntryRecord | null = null;

    const past = entries
      .filter((e) => e.scheduledFor.getTime() <= now.getTime())
      .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());

    for (const entry of past) {
      const status = computeEntryStatus(entry, now, {
        checkIns: checkInsByEntry.get(entry.id) ?? [],
        defaultGraceMinutes: person.gracePeriodMinutes,
      });
      if (status === 'checked' || status === 'cancelled' || status === 'skipped') continue;
      if (!openEntry) {
        openEntry = entry;
        openStatus = status;
        break;
      }
    }

    const future = entries
      .filter((e) => e.scheduledFor.getTime() > now.getTime() && e.status !== 'cancelled')
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
    nextEntry = future[0] ?? null;

    if (openStatus === 'unverified') return { status: 'unverified', openEntry, nextEntry };
    if (openStatus === 'due' || openStatus === 'snoozed') return { status: 'due', openEntry, nextEntry };

    const latestChecked = past.find((e) => {
      const status = computeEntryStatus(e, now, {
        checkIns: checkInsByEntry.get(e.id) ?? [],
        defaultGraceMinutes: person.gracePeriodMinutes,
      });
      return status === 'checked';
    });
    if (latestChecked) return { status: 'checked', openEntry: null, nextEntry };

    return { status: 'upcoming', openEntry: null, nextEntry };
  }

  /**
   * حساب حالات مجموعة أشخاص دفعة واحدة — 3 استعلامات فقط بدل استعلامين لكل شخص.
   * يُستخدم في الرئيسية و"عائلتي" حتى تبقى الواجهة سريعة وخفيفة على البطارية.
   */
  async computeLiveStatuses(
    persons: PersonRecord[],
    now: Date = this.clock.now(),
  ): Promise<Map<string, { status: PersonStatus; openEntry: ScheduleEntryRecord | null; nextEntry: ScheduleEntryRecord | null }>> {
    const result = new Map<string, { status: PersonStatus; openEntry: ScheduleEntryRecord | null; nextEntry: ScheduleEntryRecord | null }>();
    if (persons.length === 0) return result;

    for (const person of persons) {
      result.set(person.id, { status: 'upcoming', openEntry: null, nextEntry: null });
    }

    const lookbackFrom = new Date(now.getTime() - STATUS_LOOKBACK_DAYS * 24 * 60 * 60_000);
    const lookAheadTo = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const entries = await this.entries.list({
      personIds: persons.map((p) => p.id),
      from: lookbackFrom,
      to: lookAheadTo,
      limit: 20_000,
    });
    const checkInRows = await this.checkIns.listForEntries(entries.map((e) => e.id));
    const checkInsByEntry = groupCheckIns(checkInRows);

    const byPerson = new Map<string, ScheduleEntryRecord[]>();
    for (const entry of entries) {
      const list = byPerson.get(entry.personId) ?? [];
      list.push(entry);
      byPerson.set(entry.personId, list);
    }

    for (const person of persons) {
      if (person.deceasedReportedAt) {
        result.set(person.id, { status: 'deceased_reported', openEntry: null, nextEntry: null });
        continue;
      }
      if (person.pausedUntil && person.pausedUntil.getTime() > now.getTime()) {
        result.set(person.id, { status: 'paused', openEntry: null, nextEntry: null });
        continue;
      }

      const personEntries = byPerson.get(person.id) ?? [];
      const statusOf = (entry: ScheduleEntryRecord) =>
        computeEntryStatus(entry, now, {
          checkIns: checkInsByEntry.get(entry.id) ?? [],
          defaultGraceMinutes: person.gracePeriodMinutes,
        });

      const past = personEntries
        .filter((e) => e.scheduledFor.getTime() <= now.getTime())
        .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime());
      const future = personEntries
        .filter((e) => e.scheduledFor.getTime() > now.getTime() && e.status !== 'cancelled' && e.status !== 'skipped')
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());

      const openEntry = past.find((e) => {
        const status = statusOf(e);
        return status !== 'checked' && status !== 'cancelled' && status !== 'skipped';
      }) ?? null;
      const openStatus = openEntry ? statusOf(openEntry) : null;
      const nextEntry = future[0] ?? null;

      let status: PersonStatus = 'upcoming';
      if (openStatus === 'unverified') status = 'unverified';
      else if (openStatus === 'due' || openStatus === 'snoozed') status = 'due';
      else if (past.some((e) => statusOf(e) === 'checked')) status = 'checked';
      else if (nextEntry) status = 'upcoming';

      result.set(person.id, { status, openEntry, nextEntry });
    }

    return result;
  }
}

// ─────────────────────────────── دوال مساعدة ───────────────────────────────

function toPattern(schedule: ScheduleRecord): WeeklyPattern {
  return WeeklyPattern.create({
    weekdays: schedule.weekdays,
    times: schedule.times,
    timezone: schedule.timezone,
  });
}

function pickPatternForDate(
  localDate: string,
  base: WeeklyPattern,
  temporary: WeeklyPattern | null,
  temporarySchedule: ScheduleRecord | null,
): WeeklyPattern | null {
  if (!temporary || !temporarySchedule) return base;
  if (localDate < temporarySchedule.effectiveFrom) return base;
  if (temporarySchedule.effectiveTo && localDate > temporarySchedule.effectiveTo) return base;
  return temporary;
}

function groupCheckIns(
  rows: { entryId: string | null; occurredAt: Date; status: CheckInStatus }[],
): Map<string, { entryId: string | null; occurredAt: Date; status: CheckInStatus }[]> {
  const map = new Map<string, { entryId: string | null; occurredAt: Date; status: CheckInStatus }[]>();
  for (const row of rows) {
    if (!row.entryId) continue;
    const list = map.get(row.entryId) ?? [];
    list.push(row);
    map.set(row.entryId, list);
  }
  return map;
}
