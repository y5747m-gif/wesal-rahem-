import { Inject, Injectable } from '@nestjs/common';
import type {
  CheckInLogRow,
  ContactInvitationDto,
  Locale,
  NotificationDto,
  PersonCardDto,
  PersonDto,
  ScheduleDto,
  ScheduleEntryDto,
  ScheduleExceptionDto,
  TodayResponse,
  TrustedContactDto,
  UserProfile,
  WeekDayDto,
  WeekResponse,
} from '@wesal/shared';
import {
  ALL_PERSON_STATUSES,
  STATUS_PRIORITY,
  formatTime,
  formatDate,
  getMessages,
} from '@wesal/shared';
import type { EntryStatus } from '@wesal/shared';
import type {
  CheckInRecord,
  CommunicationAttemptRecord,
  ContactInvitationRecord,
  NotificationRecord,
  PersonRecord,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  ScheduleRecord,
  TrustedContactRecord,
  UserRecord,
} from '../ports/records';
import { SYMBOLS, type FieldEncryptionService } from '../ports/services';

/**
 * تحويل سجلات القاعدة إلى عقود الواجهة (DTOs).
 *
 * قواعد صارمة هنا:
 *  - أرقام الهواتف لا تخرج كاملة إلا لصاحبها؛ وللجهات الموثوقة تُعرض مقنّعة.
 *  - كل التسميات (الحالات، العلاقات، الطرق) من ملف الترجمة — لا نصوص مبعثرة.
 *  - الأوقات تُنسَّق في منطقة الشخص الزمنية.
 */
@Injectable()
export class DtoMapper {
  constructor(@Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService) {}

  toUserProfile(user: UserRecord): UserProfile {
    return {
      id: user.id,
      phone: user.phone,
      displayName: user.displayName,
      email: user.email,
      locale: user.locale,
      timezone: user.timezone,
      theme: user.theme,
      fontScale: user.fontScale,
      reducedMotion: user.reducedMotion,
      seniorMode: user.seniorMode,
      hapticsEnabled: user.hapticsEnabled,
      onboardingCompleted: user.onboardingCompleted,
      createdAt: user.createdAt.toISOString(),
    };
  }

  toScheduleDto(schedule: ScheduleRecord): ScheduleDto {
    return {
      id: schedule.id,
      personId: schedule.personId,
      kind: schedule.kind,
      weekdays: schedule.weekdays,
      times: schedule.times,
      timezone: schedule.timezone,
      active: schedule.active,
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
      updatedAt: schedule.updatedAt.toISOString(),
    };
  }

  toTrustedContactDto(contact: TrustedContactRecord): TrustedContactDto {
    return {
      id: contact.id,
      fullName: contact.fullName,
      relationship: contact.relationship,
      phoneMasked: this.crypto.mask(contact.phone),
      phone: null,
      status: 'accepted',
      scopes: contact.scopes,
      acceptedAt: contact.acceptedAt.toISOString(),
    };
  }

  toInvitationDto(invitation: ContactInvitationRecord): ContactInvitationDto {
    const phone = this.crypto.decrypt(invitation.phoneEncrypted);
    return {
      id: invitation.id,
      fullName: invitation.fullName,
      phoneMasked: this.crypto.mask(phone),
      status: invitation.status === 'accepted' ? 'invited' : (invitation.status as ContactInvitationDto['status']),
      invitedAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  toEntryDto(entry: ScheduleEntryRecord, locale: Locale, liveStatus?: EntryStatus): ScheduleEntryDto {
    return {
      id: entry.id,
      personId: entry.personId,
      scheduledFor: entry.scheduledFor.toISOString(),
      localDate: entry.localDate,
      localTime: entry.localTime,
      timezone: entry.timezone,
      status: liveStatus ?? entry.status,
      source: entry.source,
      graceUntil: entry.graceUntil?.toISOString() ?? null,
      snoozedUntil: entry.snoozedUntil?.toISOString() ?? null,
      completedAt: entry.completedAt?.toISOString() ?? null,
      timeLabel: formatTime(entry.scheduledFor, entry.timezone, locale),
    };
  }

  toExceptionDto(exception: ScheduleExceptionRecord): ScheduleExceptionDto {
    return {
      id: exception.id,
      personId: exception.personId,
      date: exception.date,
      action: exception.action,
      times: exception.times,
      note: exception.note,
      createdAt: exception.createdAt.toISOString(),
    };
  }

  /** بطاقة مختصرة: الصورة، الاسم، الحالة، الوقت، وزر إجراء واحد واضح */
  toPersonCard(input: {
    person: PersonRecord;
    status?: import('@wesal/shared').PersonStatus;
    entry?: ScheduleEntryRecord | null;
    locale: Locale;
    now: Date;
  }): PersonCardDto {
    const { person, locale, now } = input;
    const status = input.status ?? person.cachedStatus;
    const entry = input.entry ?? null;
    const priority = STATUS_PRIORITY[status] ?? 4;

    // ترتيب أدق داخل نفس الحالة: الأقدم موعدًا أولًا
    const entryAt = entry ? entry.scheduledFor.toISOString() : null;

    return {
      id: person.id,
      displayName: person.displayName,
      relationship: person.relationship,
      photoUrl: person.photoUrl,
      status,
      entryAt,
      entryId: entry?.id ?? null,
      entryTimeLabel: entry ? formatTime(entry.scheduledFor, person.timezone, locale) : null,
      lastCheckInAt: person.lastCheckInAt?.toISOString() ?? null,
      // لا نُخرج رقم الشخص في البطاقات — فقط داخل صفحته ولمالكه
      phone: null,
      seniorMode: person.seniorMode,
      priority: priority * 1_000_000 + (entryAt ? minutesFrom(now, entryAt) : 0),
    };
  }

  toPersonDto(input: {
    person: PersonRecord;
    status?: import('@wesal/shared').PersonStatus;
    schedule: ScheduleRecord | null;
    trustedContacts: TrustedContactRecord[];
    invitations: ContactInvitationRecord[];
    locale: Locale;
  }): PersonDto {
    const { person } = input;
    return {
      id: person.id,
      ownerUserId: person.ownerUserId,
      displayName: person.displayName,
      relationship: person.relationship,
      phone: person.phone,
      photoUrl: person.photoUrl,
      notes: person.notes,
      timezone: person.timezone,
      status: input.status ?? person.cachedStatus,
      seniorMode: person.seniorMode,
      isAppUser: person.isAppUser,
      linkedUserId: person.linkedUserId,
      gracePeriodMinutes: person.gracePeriodMinutes,
      quietHours:
        person.quietHoursStart && person.quietHoursEnd
          ? { start: person.quietHoursStart, end: person.quietHoursEnd }
          : null,
      pausedUntil: person.pausedUntil?.toISOString() ?? null,
      pauseReason: person.pauseReason,
      lastCheckInAt: person.lastCheckInAt?.toISOString() ?? null,
      lastCheckInMethod: person.lastCheckInMethod,
      lastContactAt: person.lastContactAt?.toISOString() ?? null,
      nextEntryAt: null,
      schedule: input.schedule ? this.toScheduleDto(input.schedule) : null,
      trustedContacts: input.trustedContacts.map((c) => this.toTrustedContactDto(c)),
      pendingInvitations: input.invitations
        .filter((i) => i.status === 'invited')
        .map((i) => this.toInvitationDto(i)),
      createdAt: person.createdAt.toISOString(),
      updatedAt: person.updatedAt.toISOString(),
    };
  }

  toWeekDayDto(input: {
    date: string;
    weekday: number;
    isToday: boolean;
    entries: (ScheduleEntryDto & { person: PersonCardDto })[];
  }): WeekDayDto {
    const counts = { total: input.entries.length, checked: 0, due: 0, unverified: 0, upcoming: 0 };
    for (const entry of input.entries) {
      if (entry.status === 'checked') counts.checked += 1;
      else if (entry.status === 'due' || entry.status === 'snoozed') counts.due += 1;
      else if (entry.status === 'unverified') counts.unverified += 1;
      else if (entry.status === 'upcoming') counts.upcoming += 1;
    }
    return { date: input.date, weekday: input.weekday as WeekDayDto['weekday'], isToday: input.isToday, entries: input.entries, counts };
  }

  toWeekResponse(input: {
    weekStart: string;
    weekEnd: string;
    timezone: string;
    days: WeekDayDto[];
  }): WeekResponse {
    const totals = { total: 0, checked: 0, due: 0, unverified: 0, needsFollowUp: 0 };
    for (const day of input.days) {
      totals.total += day.counts.total;
      totals.checked += day.counts.checked;
      totals.due += day.counts.due;
      totals.unverified += day.counts.unverified;
    }
    return { ...input, totals };
  }

  toLogRow(input: {
    checkIn?: CheckInRecord;
    attempt?: CommunicationAttemptRecord;
    person: PersonRecord;
    locale: Locale;
  }): CheckInLogRow {
    const m = getMessages(input.locale);
    const record = input.checkIn;
    const attempt = input.attempt;
    const occurredAt = record?.occurredAt ?? attempt?.attemptedAt ?? new Date();
    const method = record?.method ?? 'call';
    const status = record?.status ?? (attempt?.outcome === 'no_answer' ? 'called_no_answer' : 'reassured');

    return {
      id: (record?.id ?? attempt?.id ?? '') as string,
      personId: input.person.id,
      personName: input.person.displayName,
      relationship: input.person.relationship,
      day: formatDate(occurredAt, input.person.timezone, input.locale, { weekday: 'long', day: 'numeric', month: 'long' }),
      time: formatTime(occurredAt, input.person.timezone, input.locale),
      occurredAt: occurredAt.toISOString(),
      method,
      methodLabel: m.checkInMethod[method as keyof typeof m.checkInMethod] ?? method,
      status: status as string,
      statusLabel: m.checkInStatus[status as keyof typeof m.checkInStatus] ?? status,
      notes: record?.notes ?? null,
      syncedOffline: Boolean(record?.clientOccurredAt && record?.syncedAt),
    };
  }

  toNotificationDto(record: NotificationRecord, locale: Locale): NotificationDto {
    return {
      id: record.id,
      userId: record.userId,
      personId: record.personId,
      entryId: record.entryId,
      channel: record.channel,
      audience: record.audience,
      templateKey: record.templateKey,
      title: record.title,
      body: record.body,
      stage: record.stage,
      status: record.status,
      scheduledFor: record.scheduledFor.toISOString(),
      sentAt: record.sentAt?.toISOString() ?? null,
      deliveredAt: record.deliveredAt?.toISOString() ?? null,
      attempts: record.attempts,
      actions: safeParse(record.actionsJson, []),
      createdAt: record.createdAt.toISOString(),
    };
  }

  /** حالة فارغة إنسانية: لا تأنيب ولا فراغ مخيف */
  emptyTodayState(locale: Locale): TodayResponse['emptyState'] {
    const m = getMessages(locale);
    return { title: m.home.emptyTitle, body: m.home.emptyBody };
  }
}

function minutesFrom(now: Date, iso: string): number {
  const diff = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  // نقيّد القيمة حتى لا يطغى ترتيب الوقت على ترتيب الحالة
  return Math.max(-10_000, Math.min(diff, 10_000));
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const KNOWN_STATUSES = ALL_PERSON_STATUSES;
