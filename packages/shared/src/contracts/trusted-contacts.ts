import type { Relationship } from '../domain/relationships';
import type { PersonId } from '../domain/ids';
import type { InviteStatus } from '../domain/trusted-contact';

export interface InviteTrustedContactRequest {
  personId: PersonId;
  fullName: string;
  phone: string;
  relationship?: Relationship | null;
  /** رسالة اختيارية تُرفق مع الدعوة */
  personalNote?: string | null;
}

export interface InviteTrustedContactResponse {
  invitationId: string;
  status: InviteStatus;
  expiresAt: string;
  /** رابط القبول العام — يُرسل عبر القناة المختارة */
  acceptUrl: string;
  message: string;
}

/** ما تراه الجهة المدعوة قبل القبول — لا بيانات حساسة */
export interface PublicInviteDto {
  token: string;
  inviterDisplayName: string;
  personDisplayName: string;
  personRelationship: string;
  status: InviteStatus;
  expiresAt: string;
  whatIsShared: string[];
  whatIsNotShared: string[];
  withdrawAnytime: string;
  messages: {
    title: string;
    body: string;
    accept: string;
    decline: string;
    withdrawn: string;
    expired: string;
    thanks: string;
  };
}

export interface AcceptInviteRequest {
  token: string;
  /** اختياري: تربط الجهة الموثوقة بحساب وصال إن أرادت */
  phone?: string;
  locale?: 'ar' | 'en';
}

export interface AcceptInviteResponse {
  status: InviteStatus;
  trustedContactId: string | null;
  message: string;
}

export interface DeclineInviteResponse {
  status: InviteStatus;
  message: string;
}

export interface RevokeInviteResponse {
  invitationId: string;
  status: InviteStatus;
  message: string;
}

/** استجابة "من يراني؟ ومن يصله تنبيه؟" */
export interface WhoSeesMeResponse {
  personId: PersonId;
  familyMembers: { id: string; displayName: string; role: string }[];
  trustedContacts: { id: string; fullName: string; scopes: string[]; status: InviteStatus }[];
  pendingInvitations: { id: string; fullName: string; status: InviteStatus; expiresAt: string }[];
  autoEscalationConsent: {
    granted: boolean;
    grantedAt: string | null;
    revocable: boolean;
    promptTitle: string;
    promptBody: string;
    acceptLabel: string;
    declineLabel: string;
  };
  canStopEverything: boolean;
}
