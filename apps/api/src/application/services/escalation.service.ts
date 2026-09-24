import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EscalationStage, PersonStatus } from '@wesal/shared';
import { getMessages } from '@wesal/shared';
import type {
  EscalationRuleRecord,
  PersonRecord,
  ScheduleEntryRecord,
  ScheduledJobRecord,
} from '../ports/records';
import type {
  EscalationRepository,
  EscalationRuleRepository,
  PersonRepository,
  ScheduleEntryRepository,
  ScheduledJobRepository,
  TrustedContactRepository,
  UserRepository,
} from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { SYMBOLS, type AuditLogger, type IdGenerator, type UrlBuilder } from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { computeEntryStatus } from '../../domain/schedule/entry-status';
import {
  decideEscalation,
  planEntryTimeline,
  withDefaults,
  type EscalationContext,
} from '../../domain/escalation/escalation-policy';
import type { QuietHours } from '../../domain/escalation/quiet-hours';
import { ScheduleGenerationService } from './schedule.service';
import { NotificationService } from './notification.service';
import { CONFIG, type AppConfig } from '../../config/configuration';

/**
 * محرّك الحالات والتصعيد — يعمل من الخادم (وليس على هاتف المستخدم) لأن الهاتف
 * قد يكون مغلقًا أو بلا شبكة.
 *
 * الضمانات المطبَّقة:
 *  - لا تصعيد بدون موافقة صريحة وإعدادات مكتملة.
 *  - ساعات هدوء: التنبيه يُؤجَّل ولا يُلغى.
 *  - حدود واضحة (Rate limits) ولا إعادة اتصال بلا نهاية.
 *  - الإيقاف الفوري عند أي تأكيد اطمئنان (حتى من جهة موثوقة).
 *  - سجل تدقيق لكل مرحلة وكل رسالة.
 *  - لا استنتاج وفاة أو خطر: "لم يتم التحقق" هي أقصى ما يُقال.
 */
@Injectable()
export class EscalationEngine {
  private readonly logger = new Logger('EscalationEngine');

  constructor(
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.users) private readonly users: UserRepository,
    @Inject(REPOSITORIES.scheduleEntries) private readonly entries: ScheduleEntryRepository,
    @Inject(REPOSITORIES.escalationRules) private readonly rules: EscalationRuleRepository,
    @Inject(REPOSITORIES.escalations) private readonly escalations: EscalationRepository,
    @Inject(REPOSITORIES.trustedContacts) private readonly trustedContacts: TrustedContactRepository,
    @Inject(REPOSITORIES.scheduledJobs) private readonly jobs: ScheduledJobRepository,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.AuditLogger) private readonly audit: AuditLogger,
    @Inject(SYMBOLS.UrlBuilder) private readonly urls: UrlBuilder,
    private readonly notifications: NotificationService,
    private readonly schedule: ScheduleGenerationService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * تقييم المواعيد المفتوحة: تحديث الحالات، وإشعار المستخدم **فقط** عند تحوّل
   * الموعد إلى "لم يتم التحقق".
   */
  async evaluateOpenEntries(limit = 200): Promise<{ evaluated: number; changed: number; becameUnverified: number }> {
    const now = this.clock.now();
    const open = await this.entries.list({
      statuses: ['upcoming', 'due', 'snoozed'],
      to: now,
      limit,
    });

    let changed = 0;
    let becameUnverified = 0;
    const touchedPersons = new Set<string>();

    for (const entry of open) {
      const person = await this.persons.findById(entry.personId);
      if (!person || person.deletedAt) continue;
      if (person.deceasedReportedAt) continue;

      const status = computeEntryStatus(entry, now, { defaultGraceMinutes: person.gracePeriodMinutes });
      touchedPersons.add(person.id);

      if (status === entry.status) {
        await this.entries.markEvaluated([entry.id], now);
        continue;
      }

      await this.entries.updateStatus(entry.id, { status, lastEvaluatedAt: now });
      changed += 1;

      if (status === 'unverified') {
        becameUnverified += 1;
        // السبب الأول: المستخدم لم يسجّل → تذكيره فقط، ولا شيء لأي طرف ثالث
        const owner = await this.users.findById(person.ownerUserId);
        if (owner) {
          await this.notifications.sendUnverifiedToOwner({ user: owner, person, entry });
          await this.audit.log({
            actorKind: 'worker',
            action: 'entry.marked_unverified',
            entityType: 'schedule_entry',
            entityId: entry.id,
            personId: person.id,
            metadata: { stage: 'owner_only_notification' },
          });
        }
      }
    }

    for (const personId of touchedPersons) {
      const person = await this.persons.findById(personId);
      if (person) await this.refreshPersonStatus(person);
    }

    return { evaluated: open.length, changed, becameUnverified };
  }

  /** معالجة مهمة تذكير/إعادة محاولة/تصعيد من طابور الخادم */
  async processJob(job: ScheduledJobRecord): Promise<{ action: string; stage: EscalationStage | null }> {
    const payload = safeParse<{ personId?: string; entryId?: string; stage?: number }>(job.payloadJson);
    if (!payload.personId || !payload.entryId) {
      this.logger.warn(`Job ${job.id} has no personId/entryId — marking done`);
      return { action: 'invalid_payload', stage: null };
    }

    const person = await this.persons.findById(payload.personId);
    if (!person || person.deletedAt) return { action: 'person_gone', stage: null };

    const entry = await this.entries.findById(payload.entryId);
    if (!entry) return { action: 'entry_gone', stage: null };

    if (person.deceasedReportedAt) {
      await this.entries.updateStatus(entry.id, { status: 'cancelled', cancelledAt: this.clock.now() });
      return { action: 'stopped_deceased_reported', stage: null };
    }
    if (entry.status === 'checked' || entry.status === 'cancelled' || entry.status === 'skipped') {
      return { action: 'already_resolved', stage: null };
    }

    const owner = await this.users.findById(person.ownerUserId);
    if (!owner) return { action: 'owner_gone', stage: null };

    const rule = await this.loadRule(person);
    const now = this.clock.now();
    const liveStatus = computeEntryStatus(entry, now, { defaultGraceMinutes: person.gracePeriodMinutes });
    const ctx = await this.buildContext({ person, entry, rule, now, liveStatus });

    const decision = decideEscalation(ctx);

    if (decision.action === 'none') {
      if (decision.reason === 'quiet_hours' && decision.deferUntil) {
        await this.rescheduleJob(job, decision.deferUntil);
        return { action: 'deferred_quiet_hours', stage: null };
      }
      this.logger.debug(`No action for entry ${entry.id}: ${decision.reason} (${decision.explanation})`);
      return { action: decision.reason, stage: null };
    }

    if (decision.reason === 'quiet_hours' && decision.deferUntil) {
      await this.rescheduleJob(job, decision.deferUntil);
      return { action: 'deferred_quiet_hours', stage: decision.stage };
    }

    const relationshipLabel = getMessages(owner.locale).relationship[person.relationship];

    switch (decision.action) {
      case 'remind_user': {
        if (decision.stage === 1) {
          await this.notifications.sendDueReminder({ user: owner, person, entry, relationshipLabel });
        } else {
          await this.notifications.sendRetryReminder({ user: owner, person, entry });
        }
        await this.recordEscalation({ person, entry, stage: decision.stage ?? 1, action: 'remind_user', reason: decision.explanation });
        await this.audit.log({
          actorKind: 'worker',
          action: `escalation.stage_${decision.stage}`,
          entityType: 'schedule_entry',
          entityId: entry.id,
          personId: person.id,
          metadata: { stage: decision.stage, audience: 'owner' },
        });
        return { action: 'remind_user', stage: decision.stage };
      }

      case 'alert_trusted_contact':
      case 'show_emergency_guidance': {
        const contactIndex = decision.targetContactIndex ?? 1;
        const contacts = await this.trustedContacts.listForPerson(person.id, { acceptedOnly: true });
        const contact = contacts[contactIndex - 1];

        if (!contact) {
          this.logger.warn(`Escalation stage ${decision.stage} requested contact #${contactIndex} but none accepted`);
          return { action: 'no_trusted_contact', stage: decision.stage };
        }

        await this.notifications.sendTrustedContactAlert({
          person,
          entry,
          contact: { id: contact.id, userId: contact.userId, fullName: contact.fullName, phone: contact.phone },
          stage: decision.stage ?? 3,
          locale: owner.locale,
          confirmUrl: this.urls.webCheckInUrl(contact.id),
        });

        await this.recordEscalation({
          person,
          entry,
          stage: decision.stage ?? 3,
          action: 'alert_trusted_contact',
          reason: decision.explanation,
        });

        if (decision.withEmergencyGuidance) {
          await this.notifications.sendEmergencyGuidance({ user: owner, person, entry });
          await this.recordEscalation({
            person,
            entry,
            stage: 4 as EscalationStage,
            action: 'show_emergency_guidance',
            reason: 'إرشاد الطوارئ عند وجود قلق حقيقي',
          });
        }

        await this.audit.log({
          actorKind: 'worker',
          action: `escalation.stage_${decision.stage}`,
          entityType: 'schedule_entry',
          entityId: entry.id,
          personId: person.id,
          metadata: { stage: decision.stage, audience: 'trusted_contact', contactId: contact.id },
        });

        return { action: decision.action, stage: decision.stage };
      }

      default:
        return { action: 'none', stage: null };
    }
  }

  /**
   * الإيقاف الفوري — إذا أكّد أي شخص "تم الاطمئنان عليه ❤️" تتوقف كل التنبيهات
   * فورًا وتعود الحالة إلى 🟢.
   */
  async resolveOnCheckIn(input: { personId: string; entryId?: string | null; reason: string }): Promise<{
    cancelledNotifications: number;
    resolvedEscalations: number;
    cancelledJobs: number;
  }> {
    const now = this.clock.now();
    const cancelledNotifications = await this.notifications.cancelPendingForPerson(input.personId, input.reason);
    const resolvedEscalations = await this.escalations.resolveForPerson(input.personId, now, input.reason);
    const cancelledJobs = input.entryId ? await this.jobs.cancelByEntry(input.entryId) : 0;

    const person = await this.persons.findById(input.personId);
    if (person) await this.refreshPersonStatus(person);

    if (resolvedEscalations > 0 || cancelledNotifications > 0) {
      await this.audit.log({
        actorKind: 'system',
        action: 'escalation.stopped_after_check_in',
        entityType: 'person',
        entityId: input.personId,
        personId: input.personId,
        metadata: { cancelledNotifications, resolvedEscalations, cancelledJobs, reason: input.reason },
      });
    }

    return { cancelledNotifications, resolvedEscalations, cancelledJobs };
  }

  /** تحديث الحالة المخزّنة لشخص (تُستخدم في القوائم لتفادي حساب مكلف لكل طلب) */
  async refreshPersonStatus(person: PersonRecord): Promise<PersonStatus> {
    const live = await this.schedule.computeLivePersonStatus(person, this.clock.now());
    let status: PersonStatus = live.status;

    if (status === 'unverified') {
      const activeStages = live.openEntry ? await this.escalations.completedStagesForEntry(live.openEntry.id) : [];
      const reachedThirdParty = activeStages.some((s) => Number(s) >= 3);
      if (reachedThirdParty) status = 'needs_followup';
    }

    if (status !== person.cachedStatus) {
      await this.persons.updateStatusCache(person.id, status, this.clock.now());
    }
    return status;
  }

  /** الخطة الزمنية لموعد (للعرض في صفحة الشخص — شفافية كاملة) */
  async timelineForEntry(
    entry: ScheduleEntryRecord,
    person: PersonRecord,
  ): Promise<{
    steps: { stage: EscalationStage; label: string; dueAt: string; action: string }[];
    autoEscalationEnabled: boolean;
  }> {
    const rule = await this.loadRule(person);
    const graceUntil = entry.graceUntil ?? computeGraceFromRule(entry.scheduledFor, rule.gracePeriodMinutes);
    const steps = planEntryTimeline({
      scheduledFor: entry.scheduledFor,
      graceUntil,
      rule,
      maxContacts: rule.maxContacts,
    });
    return {
      steps: steps.map((s) => ({ stage: s.stage, label: s.label, dueAt: s.dueAt.toISOString(), action: s.action })),
      autoEscalationEnabled: rule.autoEscalationEnabled,
    };
  }

  private async loadRule(person: PersonRecord): Promise<EscalationRuleRecord> {
    const stored = await this.rules.findByPerson(person.id);
    const defaults = withDefaults({});
    if (stored) return stored;

    // إنشاء قاعدة افتراضية (بلا تصعيد تلقائي) حتى تكون الإعدادات مكتملة وشفافة
    return this.rules.upsert({
      personId: person.id,
      enabled: true,
      autoEscalationEnabled: false,
      reminderDelayMinutes: defaults.reminderDelayMinutes,
      secondReminderDelayMinutes: defaults.secondReminderDelayMinutes,
      trustedContactDelayMinutes: defaults.trustedContactDelayMinutes,
      nextContactDelayMinutes: defaults.nextContactDelayMinutes,
      maxContacts: defaults.maxContacts,
      gracePeriodMinutes: person.gracePeriodMinutes,
      quietHoursStart: person.quietHoursStart ?? defaults.quietHoursStart,
      quietHoursEnd: person.quietHoursEnd ?? defaults.quietHoursEnd,
      quietHoursTimezone: person.timezone,
      emergencyGuidance: defaults.emergencyGuidance,
      autoEscalationConsentGrantedAt: null,
      autoEscalationConsentRevokedAt: null,
      consentVersion: null,
    });
  }

  private async buildContext(input: {
    person: PersonRecord;
    entry: ScheduleEntryRecord;
    rule: EscalationRuleRecord;
    now: Date;
    liveStatus: ReturnType<typeof computeEntryStatus>;
  }): Promise<EscalationContext> {
    const { person, entry, rule, now, liveStatus } = input;

    const quietHours: QuietHours | null =
      person.quietHoursStart && person.quietHoursEnd
        ? { start: person.quietHoursStart, end: person.quietHoursEnd, timezone: person.timezone }
        : { start: rule.quietHoursStart, end: rule.quietHoursEnd, timezone: rule.quietHoursTimezone };

    const completedStages = await this.escalations.completedStagesForEntry(entry.id);
    const acceptedTrustedContacts = await this.trustedContacts.countAcceptedForPerson(person.id);
    const dayStartUtc = startOfUtcDay(now);
    const thirdPartyAlertsToday = await this.escalations.countThirdPartyAlertsToday(person.id, dayStartUtc);
    const lastThirdPartyAlertAt = await this.escalations.lastThirdPartyAlertAt(person.id);

    return {
      entryId: entry.id,
      entryStatus: liveStatus,
      scheduledFor: entry.scheduledFor,
      graceUntil: entry.graceUntil ?? computeGraceFromRule(entry.scheduledFor, rule.gracePeriodMinutes),
      now,
      rule: {
        reminderDelayMinutes: rule.reminderDelayMinutes,
        secondReminderDelayMinutes: rule.secondReminderDelayMinutes,
        trustedContactDelayMinutes: rule.trustedContactDelayMinutes,
        nextContactDelayMinutes: rule.nextContactDelayMinutes,
        maxContacts: rule.maxContacts,
        gracePeriodMinutes: rule.gracePeriodMinutes,
        quietHoursStart: rule.quietHoursStart,
        quietHoursEnd: rule.quietHoursEnd,
        emergencyGuidance: rule.emergencyGuidance,
      },
      quietHours,
      consent: {
        autoEscalationGranted: Boolean(
          rule.autoEscalationConsentGrantedAt && !rule.autoEscalationConsentRevokedAt,
        ),
        ...(rule.autoEscalationConsentRevokedAt ? { revokedAt: rule.autoEscalationConsentRevokedAt } : {}),
      },
      acceptedTrustedContacts,
      completedStages,
      remindersSentForEntry: completedStages.filter((s) => Number(s) <= 2).length,
      thirdPartyAlertsToday,
      lastThirdPartyAlertAt,
      personPaused: Boolean(person.pausedUntil && person.pausedUntil.getTime() > now.getTime()),
      deceasedReported: Boolean(person.deceasedReportedAt),
      // في المرحلة الأولى (MVP) يبقى false في القاعدة: لا تصعيد تلقائي بلا موافقة صريحة
      autoEscalationEnabled: rule.autoEscalationEnabled,
      maxContacts: rule.maxContacts,
    };
  }

  private async recordEscalation(input: {
    person: PersonRecord;
    entry: ScheduleEntryRecord;
    stage: EscalationStage;
    action: string;
    reason: string;
  }): Promise<void> {
    await this.escalations.create({
      id: this.ids.uuid(),
      personId: input.person.id,
      entryId: input.entry.id,
      stage: input.stage,
      action: input.action,
      reason: input.reason,
      triggeredAt: this.clock.now(),
      resolvedAt: null,
      status: 'active',
      deferUntil: null,
    });
  }

  private async rescheduleJob(job: ScheduledJobRecord, runAt: Date): Promise<void> {
    await this.jobs.markFailed(job.id, 'deferred by quiet hours', runAt);
  }
}

function computeGraceFromRule(scheduledFor: Date, graceMinutes: number): Date {
  return new Date(scheduledFor.getTime() + Math.max(0, graceMinutes) * 60_000);
}

function startOfUtcDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function safeParse<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return {} as T;
  }
}
