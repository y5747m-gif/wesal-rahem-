/**
 * المزامنة دون اتصال.
 * التطبيق يخزّن العمليات محليًا ويرسلها دفعة واحدة عند عودة الإنترنت.
 * كل عملية تحمل `idempotencyKey` حتى لا تتكرر عند إعادة الإرسال،
 * و`clientOccurredAt` لحل التعارضات (الأحدث زمنًا يفوز عند تعارض نفس الموعد).
 */
import type { RecordAttemptRequest, RecordCheckInRequest, SnoozeRequest } from './checkins';

export const SyncOperationType = {
  RecordCheckIn: 'record_check_in',
  RecordAttempt: 'record_attempt',
  Snooze: 'snooze',
  CreatePerson: 'create_person',
  UpdatePerson: 'update_person',
  AddException: 'add_exception',
} as const;

export type SyncOperationType = (typeof SyncOperationType)[keyof typeof SyncOperationType];

export interface SyncOperation {
  /** يولّده التطبيق (UUID) — مفتاح عدم التكرار */
  idempotencyKey: string;
  type: SyncOperationType;
  /** لحظة التنفيذ على الجهاز */
  clientOccurredAt: string;
  payload:
    | RecordCheckInRequest
    | RecordAttemptRequest
    | SnoozeRequest
    | Record<string, unknown>;
}

export interface SyncRequest {
  operations: SyncOperation[];
  /** آخر لحظة سحب فيها التطبيق البيانات — تُستخدم لإرجاع التغييرات الأحدث */
  since?: string;
}

export const SyncResultStatus = {
  Applied: 'applied',
  Duplicated: 'duplicated',
  Rejected: 'rejected',
  Conflicted: 'conflicted',
} as const;

export type SyncResultStatus = (typeof SyncResultStatus)[keyof typeof SyncResultStatus];

export interface SyncOperationResult {
  idempotencyKey: string;
  type: SyncOperationType;
  status: SyncResultStatus;
  /** معرّف السجل الناتج عند النجاح */
  entityId?: string;
  errorCode?: string;
  message?: string;
  /** إن حدث تعارض: القيمة المعتمدة على الخادم */
  serverValue?: Record<string, unknown>;
}

export interface SyncResponse {
  results: SyncOperationResult[];
  applied: number;
  duplicated: number;
  rejected: number;
  serverTime: string;
}
