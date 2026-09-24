import type { NotificationId, PersonId, UserId } from '../domain/ids';
import type { EscalationStage } from '../domain/escalation';
import type { DeviceRegistration } from './auth';

export const NotificationChannel = {
  Push: 'push',
  Sms: 'sms',
  InApp: 'in_app',
  Email: 'email',
  WhatsApp: 'whatsapp',
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationAudience = {
  Owner: 'owner',
  FamilyMember: 'family_member',
  TrustedContact: 'trusted_contact',
  TrackedPerson: 'tracked_person',
} as const;

export type NotificationAudience = (typeof NotificationAudience)[keyof typeof NotificationAudience];

export const NotificationStatus = {
  Queued: 'queued',
  Sent: 'sent',
  Delivered: 'delivered',
  Failed: 'failed',
  Cancelled: 'cancelled',
  SuppressedQuietHours: 'suppressed_quiet_hours',
  SuppressedNoConsent: 'suppressed_no_consent',
} as const;

export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/** مفاتيح القوالب — النصوص نفسها في `i18n` حتى تتطابق بين الخادم والتطبيق */
export const NotificationTemplate = {
  ReminderDue: 'reminder.due',
  ReminderRetry: 'reminder.retry',
  CheckInDone: 'check_in.done',
  UnverifiedOwnerOnly: 'unverified.owner_only',
  TrustedContactAlert: 'trusted_contact.alert',
  PersonIsFine: 'person.is_fine',
  WebCheckInLink: 'web.check_in_link',
  WeeklyReport: 'report.weekly',
} as const;

export type NotificationTemplate = (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

export interface NotificationDto {
  id: NotificationId;
  userId: UserId | null;
  personId: PersonId | null;
  entryId: string | null;
  channel: NotificationChannel;
  audience: NotificationAudience;
  templateKey: NotificationTemplate;
  title: string;
  body: string;
  stage: EscalationStage | null;
  status: NotificationStatus;
  scheduledFor: string;
  sentAt: string | null;
  deliveredAt: string | null;
  attempts: number;
  /** أزرار الإجراء داخل الإشعار */
  actions: NotificationAction[];
  createdAt: string;
}

export interface NotificationAction {
  /** رمز الإجراء — يفهمه التطبيق */
  key: 'reassured' | 'call_now' | 'snooze' | 'called_no_answer' | 'open_person' | 'confirm_fine';
  label: string;
  /** مسار داخلي أو رابط عام (مثل رابط "أنا بخير") */
  target?: string;
  personId?: PersonId;
  entryId?: string;
}

export interface RegisterDeviceRequest extends DeviceRegistration {}

export interface RegisterDeviceResponse {
  deviceId: string;
  registered: boolean;
}

export interface ListNotificationsQuery {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MarkNotificationsReadRequest {
  ids?: string[];
  all?: boolean;
}
