import type { CheckInMethod, CheckInStatus, AttemptOutcome } from '../domain/checkin';
import type { PersonId } from '../domain/ids';
import type { LocalTime } from '../domain/schedule';

export interface RecordCheckInRequest {
  personId?: PersonId;
  /** الموعد المرتبط — إن تُرك فارغًا يُربط بأقرب موعد مفتوح */
  entryId?: string | null;
  method: CheckInMethod;
  status?: CheckInStatus;
  /** لحظة الاطمئنان الفعلية — قد تسبق المزامنة (عمل دون اتصال) */
  occurredAt?: string;
  notes?: string | null;
  /** مفتاح عدم التكرار — يجعل إعادة الإرسال آمنة */
  idempotencyKey: string;
  /** هل هذا من مزامنة دون اتصال؟ */
  fromOfflineQueue?: boolean;
}

export interface RecordCheckInResponse {
  checkInId: string;
  personId: PersonId;
  entryId: string | null;
  status: CheckInStatus;
  occurredAt: string;
  /** هل كان الطلب مكررًا (نفس مفتاح عدم التكرار)؟ */
  duplicated: boolean;
  /** رسالة جاهزة للعرض */
  confirmationMessage: string;
  /** رسالة العائلة إن كان الشخص يستخدم التطبيق/زر "أنا بخير" */
  familyMessage?: string;
  /** هل توقفت تنبيهات بسبب هذا التأكيد؟ */
  stoppedAlerts: boolean;
}

export interface RecordAttemptRequest {
  entryId?: string | null;
  outcome: AttemptOutcome;
  /** إعادة المحاولة بعد كم دقيقة — افتراضيًا من إعدادات الشخص */
  retryAfterMinutes?: number;
  idempotencyKey: string;
  occurredAt?: string;
}

export interface RecordAttemptResponse {
  attemptId: string;
  personId: PersonId;
  entryId: string | null;
  retryAt: string | null;
  message: string;
}

export interface SnoozeRequest {
  entryId?: string | null;
  /** دقائق التأجيل القصير */
  minutes: number;
  /** أو وقت محدد بدل الدقائق */
  untilLocalTime?: LocalTime;
  idempotencyKey: string;
}

export interface SnoozeResponse {
  personId: PersonId;
  entryId: string | null;
  snoozedUntil: string;
  message: string;
}

/** الرد على سؤال "هل تم الاطمئنان؟" بعد العودة من تطبيق الاتصال */
export interface PostCallPromptResponse {
  shouldAsk: boolean;
  questionAr: string;
  questionEn: string;
  yesAction: string;
  noAction: string;
}

export interface LogsResponse {
  items: import('./persons').CheckInLogRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  /** ملخص لطيف غير مؤنِّب */
  summary: { completedThisWeek: number; message: string };
}

export interface PersonCheckInsResponse {
  personId: PersonId;
  items: import('./persons').CheckInLogRow[];
}
