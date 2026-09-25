import type { PersonId, UserId } from '../domain/ids';
import type { Relationship } from '../domain/relationships';
import type { PersonStatus } from '../domain/status';
import type { InviteStatus } from '../domain/trusted-contact';
import type {
  EntrySource,
  EntryStatus,
  ExceptionAction,
  LocalTime,
  PauseReason,
  ScheduleKind,
  Weekday,
} from '../domain/schedule';

/** القاعدة الأسبوعية كما تُرسل من التطبيق */
export interface ScheduleInput {
  kind?: ScheduleKind;
  weekdays: Weekday[];
  /** أوقات محلية HH:mm */
  times: LocalTime[];
  /** منطقة الشخص الزمنية — تُخزَّن لكل شخص (افتراضيًا منطقة المستخدم/الشخص) */
  timezone?: string;
}

export interface ScheduleDto {
  id: string;
  personId: PersonId;
  kind: ScheduleKind;
  weekdays: Weekday[];
  times: LocalTime[];
  timezone: string;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface CreatePersonRequest {
  /** الاسم — الحقل الإلزامي الأول (قد يكون "جدتي") */
  displayName: string;
  /** صلة القرابة من القائمة الجاهزة — إلزامي */
  relationship: Relationship;
  /** الجدول — إلزامي. الهدف: أول شخص في أقل من دقيقة */
  schedule: ScheduleInput;
  /** كل ما يلي اختياري */
  phone?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  /** هل يستخدم التطبيق بنفسه؟ (يرتبط لاحقًا بحساب مستخدم) */
  isAppUser?: boolean;
  seniorMode?: boolean;
  /** مهلة السماح بالدقائق قبل أن يتحول الموعد إلى "لم يتم التحقق" */
  gracePeriodMinutes?: number;
  /** ساعات الهدوء */
  quietHours?: { start: LocalTime; end: LocalTime } | null;
  /** جهة موثوقة واحدة اختيارية — تُرسل لها دعوة ولا يُخزَّن رقمها دائمًا قبل القبول */
  trustedContact?: {
    fullName: string;
    phone: string;
    relationship?: Relationship | null;
  } | null;
}

export interface UpdatePersonRequest {
  displayName?: string;
  relationship?: Relationship;
  phone?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  seniorMode?: boolean;
  gracePeriodMinutes?: number;
  quietHours?: { start: LocalTime; end: LocalTime } | null;
  /** تعديل الجدول الأساسي — يُطبَّق من اليوم فصاعدًا ولا يمس المواعيد الماضية */
  schedule?: ScheduleInput;
}

export interface PausePersonRequest {
  /** إيقاف حتى تاريخ/وقت (ISO). إن تُركت فارغة فالإيقاف مفتوح */
  until?: string | null;
  reason?: PauseReason;
  note?: string | null;
  /** وضع السفر: إنشاء جدول مؤقت أثناء السفر بدل الإيقاف الكامل */
  temporarySchedule?: ScheduleInput | null;
}

export interface PersonDto {
  id: PersonId;
  ownerUserId: UserId;
  displayName: string;
  relationship: Relationship;
  phone: string | null;
  photoUrl: string | null;
  notes: string | null;
  timezone: string;
  status: PersonStatus;
  seniorMode: boolean;
  isAppUser: boolean;
  linkedUserId: UserId | null;
  gracePeriodMinutes: number;
  quietHours: { start: LocalTime; end: LocalTime } | null;
  pausedUntil: string | null;
  pauseReason: PauseReason | null;
  lastCheckInAt: string | null;
  lastCheckInMethod: string | null;
  lastContactAt: string | null;
  nextEntryAt: string | null;
  schedule: ScheduleDto | null;
  trustedContacts: TrustedContactDto[];
  pendingInvitations: ContactInvitationDto[];
  createdAt: string;
  updatedAt: string;
}

/** بطاقة مختصرة للشاشة الرئيسية — كل ما يحتاجه المستخدم خلال 5 ثوانٍ */
export interface PersonCardDto {
  id: PersonId;
  displayName: string;
  relationship: Relationship;
  photoUrl: string | null;
  status: PersonStatus;
  /** وقت الموعد الحالي أو التالي (ISO) */
  entryAt: string | null;
  entryId: string | null;
  /** الوقت المحلي المنسّق جاهز للعرض */
  entryTimeLabel: string | null;
  lastCheckInAt: string | null;
  phone: string | null;
  seniorMode: boolean;
  /** ترتيب الأولوية (الأصغر = الأعلى أولوية) */
  priority: number;
}

export interface TrustedContactDto {
  id: string;
  fullName: string;
  relationship: Relationship | null;
  /** يُعرض مقنّعًا في الواجهة: ‎+20•••••3456 */
  phoneMasked: string;
  phone: string | null;
  status: InviteStatus;
  scopes: string[];
  acceptedAt: string | null;
}

export interface ContactInvitationDto {
  id: string;
  fullName: string;
  phoneMasked: string;
  status: 'invited' | 'declined' | 'revoked' | 'expired';
  invitedAt: string;
  expiresAt: string;
}

export interface ListPersonsQuery {
  /** بحث: اسم، صلة قرابة، رقم، حالة */
  q?: string;
  status?: PersonStatus | 'needs_check_in';
  page?: number;
  pageSize?: number;
}

export interface ScheduleExceptionRequest {
  /** تاريخ محلي YYYY-MM-DD في منطقة الشخص الزمنية */
  date: string;
  action: ExceptionAction;
  times?: LocalTime[];
  note?: string | null;
}

export interface ScheduleExceptionDto {
  id: string;
  personId: PersonId;
  date: string;
  action: ExceptionAction;
  times: LocalTime[];
  note: string | null;
  createdAt: string;
}

export interface ScheduleEntryDto {
  id: string;
  personId: PersonId;
  /** لحظة UTC */
  scheduledFor: string;
  localDate: string;
  localTime: LocalTime;
  timezone: string;
  status: EntryStatus;
  source: EntrySource;
  graceUntil: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  /** جاهز للعرض */
  timeLabel: string;
}

export interface WeekDayDto {
  /** YYYY-MM-DD محلي في منطقة المستخدم */
  date: string;
  weekday: Weekday;
  isToday: boolean;
  entries: (ScheduleEntryDto & { person: PersonCardDto })[];
  counts: { total: number; checked: number; due: number; unverified: number; upcoming: number };
}

export interface WeekResponse {
  /** بداية الأسبوع المعروض (YYYY-MM-DD) */
  weekStart: string;
  weekEnd: string;
  timezone: string;
  days: WeekDayDto[];
  totals: { total: number; checked: number; due: number; unverified: number; needsFollowUp: number };
}

export interface TodayResponse {
  greeting: string;
  /** نص جاهز للعرض */
  dateLabel: string;
  counts: {
    dueToday: number;
    checked: number;
    unverified: number;
    needsFollowUp: number;
    upcoming: number;
    total: number;
  };
  cards: PersonCardDto[];
  isEmpty: boolean;
  emptyState: { title: string; body: string } | null;
  /** اقتراح لطيف (حساب بسيط لا يحتاج AI): انخفاض التواصل */
  suggestion: { personId: PersonId; text: string } | null;
}

export interface CheckInLogRow {
  id: string;
  personId: PersonId;
  personName: string;
  relationship: Relationship;
  day: string;
  time: string;
  occurredAt: string;
  method: string;
  methodLabel: string;
  status: string;
  statusLabel: string;
  notes: string | null;
  /** هل كان من عمل دون اتصال ثم زُامن؟ */
  syncedOffline: boolean;
}

export interface LogsQuery {
  from?: string;
  to?: string;
  personId?: PersonId;
  page?: number;
  pageSize?: number;
}

// ─────────────────────── استجابات مركّبة (صفحات كاملة) ───────────────────────

export interface PersonDetailResponse {
  person: PersonDto;
  /** مواعيد هذا الأسبوع مع حالاتها */
  week: WeekDayDto[];
  /** آخر سجلات التواصل (سجل الوصال) */
  recentLogs: CheckInLogRow[];
  /** الاستثناءات الحالية */
  exceptions: ScheduleExceptionDto[];
  /** الخطة الزمنية للموعد الحالي — شفافية كاملة عن ما سيحدث ومتى */
  timeline: {
    steps: { stage: number; label: string; dueAt: string; action: string }[];
    autoEscalationEnabled: boolean;
  };
  /** نصوص الأزرار بلغة المستخدم (تُستخدم كما هي في الواجهة) */
  messages: {
    reassured: string;
    calledNoAnswer: string;
    snooze: string;
    callNow: string;
    sendMessage: string;
    statusHint: string;
  };
}

export interface CreatePersonResponse {
  person: PersonDto;
  /** "جميل ❤️ تمت إضافة جدتك إلى وصال…" */
  confirmationMessage: string;
  /** إن أُضيفت جهة موثوقة اختيارية أثناء الإنشاء */
  invitation: import('./trusted-contacts').InviteTrustedContactResponse | null;
  /** عدد المواعيد المولّدة للأسابيع القادمة */
  generatedEntries: number;
}

export interface UpdatePersonResponse {
  person: PersonDto;
  regeneratedEntries: number;
  message: string;
}

export interface PausePersonResponse {
  personId: PersonId;
  pausedUntil: string | null;
  cancelledEntries: number;
  temporarySchedule: ScheduleDto | null;
  message: string;
}

export interface RemovePersonResponse {
  personId: PersonId;
  message: string;
}

export interface ListPersonsResponse {
  items: PersonCardDto[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  /** مرشحات جاهزة للعرض */
  filters: { key: string; label: string; count: number }[];
}

export interface ReportDeceasedResponse {
  personId: PersonId;
  stoppedReminders: boolean;
  cancelledEntries: number;
  message: string;
  /** تحذير واضح: هذا إجراء يدوي حساس ولا يُستنتج تلقائيًا أبدًا */
  warning: string;
}
