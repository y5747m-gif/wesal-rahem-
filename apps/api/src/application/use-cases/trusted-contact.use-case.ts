import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AcceptInviteResponse,
  DeclineInviteResponse,
  InviteTrustedContactResponse,
  Locale,
  PublicInviteDto,
  Relationship,
  RevokeInviteResponse,
  UserId,
} from '@wesal/shared';
import { DEFAULT_TRUSTED_CONTACT_SCOPES, ErrorCode, LIMITS, getMessages, isRelationship } from '@wesal/shared';
import type { ContactInvitationRecord, PersonRecord, TrustedContactRecord } from '../ports/records';
import type {
  ContactInvitationRepository,
  PersonRepository,
  TrustedContactRepository,
  UserRepository,
} from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import {
  SYMBOLS,
  type AuditLogger,
  type FieldEncryptionService,
  type IdGenerator,
  type MessageChannel,
  type UrlBuilder,
} from '../ports/services';
import { Clock } from '../../domain/shared/clock';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import { assertValidPhone } from '../../domain/shared/phone';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { AccessService } from '../services/access.service';
import type { RequestContext } from './auth.use-case';

/**
 * الجهات الموثوقة — المبدأ الحاكم: **الموافقة أولًا**.
 *
 *  - الدعوة تُرسل برابط يحمل رمزًا عشوائيًا (يُخزَّن كبصمة فقط).
 *  - رقم الجهة يُخزَّن مشفّرًا في الدعوة فقط، ولا يُنشأ صف `trusted_contacts`
 *    إلا بعد القبول. عند الرفض/الإلغاء/الانتهاء يُحذف الرقم.
 *  - يمكن للجهة الانسحاب في أي وقت بضغطة واحدة.
 */
@Injectable()
export class TrustedContactUseCase {
  private readonly logger = new Logger('TrustedContactUseCase');

  constructor(
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.users) private readonly users: UserRepository,
    @Inject(REPOSITORIES.contactInvitations) private readonly invitations: ContactInvitationRepository,
    @Inject(REPOSITORIES.trustedContacts) private readonly trustedContacts: TrustedContactRepository,
    @Inject(SYMBOLS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(SYMBOLS.FieldEncryption) private readonly crypto: FieldEncryptionService,
    @Inject(SYMBOLS.AuditLogger) private readonly audit: AuditLogger,
    @Inject(SYMBOLS.UrlBuilder) private readonly urls: UrlBuilder,
    @Inject(SYMBOLS.MessageChannel) private readonly channel: MessageChannel,
    @Inject(SYMBOLS.Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly access: AccessService,
  ) {}

  // ─────────────────────────────── الدعوة ───────────────────────────────

  async invite(
    userId: UserId,
    input: { personId: string; fullName: string; phone: string; relationship?: Relationship | null; personalNote?: string | null },
    ctx: RequestContext = {},
  ): Promise<InviteTrustedContactResponse> {
    const user = await this.access.requireUser(userId);
    const person = await this.access.requireOwnedPerson(userId, input.personId);
    this.access.assertCanManageTrustedContacts(user, person);
    const m = getMessages(user.locale);

    const fullName = (input.fullName ?? '').trim();
    if (fullName.length < 1 || fullName.length > LIMITS.trustedContactNameMax) {
      throw new ValidationError('Enter the contact’s name', { field: 'fullName' });
    }
    const phone = assertValidPhone(input.phone);
    const phoneHash = this.crypto.hmac(phone);
    const relationship = input.relationship && isRelationship(input.relationship) ? input.relationship : null;
    const personalNote = input.personalNote ? input.personalNote.trim().slice(0, LIMITS.notesMax) : null;

    // دعوة سارية واحدة لنفس الرقم (منع الإزعاج)
    const existing = await this.invitations.findActiveByPhoneHash(person.id, phoneHash);
    if (existing) {
      throw new ConflictError('An invitation was already sent to this number', { invitationId: existing.id });
    }

    const now = this.clock.now();
    const token = this.ids.randomToken(32);
    const invitation = await this.invitations.create({
      id: this.ids.uuid(),
      personId: person.id,
      invitedByUserId: user.id,
      fullName,
      phoneEncrypted: this.crypto.encrypt(phone),
      phoneHash,
      relationship,
      tokenHash: this.crypto.hmac(token),
      status: 'invited',
      scopes: [...DEFAULT_TRUSTED_CONTACT_SCOPES],
      personalNote,
      invitedAt: now,
      expiresAt: new Date(now.getTime() + this.config.invites.ttlDays * 24 * 60 * 60_000),
      respondedAt: null,
    });

    const acceptUrl = this.urls.inviteAcceptUrl(token);
    const delivery = await this.channel.sendInviteLink({
      toPhoneEncrypted: invitation.phoneEncrypted,
      fullName: person.displayName,
      acceptUrl,
      locale: user.locale,
    });
    if (delivery.status === 'failed') {
      this.logger.warn(`Invite ${invitation.id} not delivered: ${delivery.error ?? 'unknown'}`);
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'trusted_contact.invited',
      entityType: 'contact_invitation',
      entityId: invitation.id,
      personId: person.id,
      metadata: { delivery: delivery.status },
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return {
      invitationId: invitation.id,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptUrl,
      message: m.trustedContacts.inviteSent(fullName),
    };
  }

  async revoke(userId: UserId, invitationId: string, ctx: RequestContext = {}): Promise<RevokeInviteResponse> {
    const user = await this.access.requireUser(userId);
    const invitation = await this.invitations.findById(invitationId);
    if (!invitation) throw new NotFoundError('Invitation');
    const person = await this.access.requireOwnedPerson(userId, invitation.personId);
    this.access.assertCanManageTrustedContacts(user, person);
    const m = getMessages(user.locale);

    if (invitation.status === 'invited' || invitation.status === 'accepted') {
      await this.invitations.updateStatus(invitation.id, 'revoked', this.clock.now());
      await this.invitations.purgePhone(invitation.id);
      await this.trustedContacts.removeForInvitation(invitation.id);
    }

    await this.audit.log({
      actorUserId: user.id,
      action: 'trusted_contact.invite_revoked',
      entityType: 'contact_invitation',
      entityId: invitation.id,
      personId: person.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return { invitationId: invitation.id, status: 'revoked', message: m.trustedContacts.withdrawn };
  }

  /** حذف جهة موثوقة مقبولة (من جهة المالك) */
  async remove(userId: UserId, trustedContactId: string, ctx: RequestContext = {}): Promise<{ removed: boolean; message: string }> {
    const user = await this.access.requireUser(userId);
    const contact = await this.trustedContacts.findById(trustedContactId);
    if (!contact) throw new NotFoundError('Trusted contact');
    const person = await this.access.requireOwnedPerson(userId, contact.personId);
    this.access.assertCanManageTrustedContacts(user, person);
    const m = getMessages(user.locale);

    await this.trustedContacts.withdraw(contact.id, this.clock.now());
    if (contact.invitationId) {
      await this.invitations.updateStatus(contact.invitationId, 'revoked', this.clock.now()).catch(() => undefined);
      await this.invitations.purgePhone(contact.invitationId).catch(() => undefined);
    }
    await this.audit.log({
      actorUserId: user.id,
      action: 'trusted_contact.removed',
      entityType: 'trusted_contact',
      entityId: contact.id,
      personId: person.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { removed: true, message: m.trustedContacts.withdrawn };
  }

  // ───────────────────── صفحة القبول العامة (بدون حساب) ─────────────────────

  async publicInvite(token: string, locale: Locale = 'ar'): Promise<PublicInviteDto> {
    const { invitation, person, inviter } = await this.loadByToken(token);
    const m = getMessages(locale);
    const status = this.effectiveStatus(invitation);
    const inviterName = inviter?.displayName ?? (locale === 'ar' ? 'عائلتك' : 'your family');
    const relationshipLabel = m.relationship[person.relationship] ?? person.relationship;

    return {
      token,
      inviterDisplayName: inviterName,
      personDisplayName: person.displayName,
      personRelationship: relationshipLabel,
      status,
      expiresAt: invitation.expiresAt.toISOString(),
      whatIsShared: [...m.trustedContacts.acceptPageWhatIsShared],
      whatIsNotShared: [...m.trustedContacts.acceptPageWhatIsNotShared],
      withdrawAnytime: m.trustedContacts.withdrawAnytime,
      messages: {
        title: m.trustedContacts.acceptPageTitle(inviterName, person.displayName),
        body: m.trustedContacts.acceptPageBody(person.displayName),
        accept: m.trustedContacts.accept,
        decline: m.trustedContacts.decline,
        withdrawn: m.trustedContacts.withdrawn,
        expired: m.notifications.webCheckInExpired,
        thanks: m.trustedContacts.inviteAccepted(invitation.fullName),
      },
    };
  }

  async accept(token: string, input: { phone?: string; locale?: Locale } = {}): Promise<AcceptInviteResponse> {
    const { invitation, person, inviter } = await this.loadByToken(token);
    const locale = input.locale ?? inviter?.locale ?? 'ar';
    const m = getMessages(locale);
    const status = this.effectiveStatus(invitation);
    const now = this.clock.now();

    if (status === 'accepted') {
      const existing = (await this.trustedContacts.listForPerson(person.id, { acceptedOnly: true })).find(
        (c) => c.invitationId === invitation.id,
      );
      return { status: 'accepted', trustedContactId: existing?.id ?? null, message: m.trustedContacts.inviteAccepted(invitation.fullName) };
    }
    if (status === 'expired') {
      await this.invitations.updateStatus(invitation.id, 'expired', now);
      await this.invitations.purgePhone(invitation.id);
      throw new DomainError(ErrorCode.InviteExpired, m.notifications.webCheckInExpired, 410);
    }
    if (status !== 'invited') {
      throw new DomainError(ErrorCode.InviteNotAcceptable, m.trustedContacts.withdrawn, 409);
    }

    const phone = this.crypto.decrypt(invitation.phoneEncrypted);
    if (!phone) throw new DomainError(ErrorCode.InviteNotAcceptable, m.trustedContacts.withdrawn, 409);

    // ربط اختياري بحساب وصال إن كانت الجهة مستخدمة للتطبيق بنفس الرقم
    const linkedUser = await this.users.findByPhoneHash(invitation.phoneHash);

    const contact: Omit<TrustedContactRecord, 'createdAt'> = {
      id: this.ids.uuid(),
      personId: person.id,
      invitationId: invitation.id,
      userId: linkedUser && !linkedUser.deletedAt ? linkedUser.id : null,
      fullName: invitation.fullName,
      phone: invitation.phoneEncrypted,
      phoneHash: invitation.phoneHash,
      relationship: invitation.relationship,
      scopes: invitation.scopes,
      status: 'accepted',
      acceptedAt: now,
      withdrawnAt: null,
    };
    const created = await this.trustedContacts.create(contact);
    await this.invitations.updateStatus(invitation.id, 'accepted', now);

    await this.audit.log({
      actorKind: 'trusted_contact',
      action: 'trusted_contact.invite_accepted',
      entityType: 'trusted_contact',
      entityId: created.id,
      personId: person.id,
    });

    return { status: 'accepted', trustedContactId: created.id, message: m.trustedContacts.inviteAccepted(invitation.fullName) };
  }

  async decline(token: string, locale: Locale = 'ar'): Promise<DeclineInviteResponse> {
    const { invitation, person } = await this.loadByToken(token);
    const m = getMessages(locale);
    const status = this.effectiveStatus(invitation);
    const now = this.clock.now();

    if (status === 'invited' || status === 'accepted') {
      await this.invitations.updateStatus(invitation.id, 'declined', now);
      await this.invitations.purgePhone(invitation.id);
      await this.trustedContacts.removeForInvitation(invitation.id);
      await this.audit.log({
        actorKind: 'trusted_contact',
        action: status === 'accepted' ? 'trusted_contact.withdrew' : 'trusted_contact.invite_declined',
        entityType: 'contact_invitation',
        entityId: invitation.id,
        personId: person.id,
      });
    }
    return { status: 'declined', message: m.trustedContacts.withdrawn };
  }

  /** إنهاء الدعوات المنتهية (يستدعيه العامل) — يحذف الأرقام المشفّرة */
  async expireStale(limit = 100): Promise<number> {
    const now = this.clock.now();
    const stale = await this.invitations.listExpirable(now, limit);
    for (const invitation of stale) {
      await this.invitations.updateStatus(invitation.id, 'expired', now);
      await this.invitations.purgePhone(invitation.id);
    }
    return stale.length;
  }

  // ─────────────────────────────── مساعدات ───────────────────────────────

  private async loadByToken(token: string): Promise<{
    invitation: ContactInvitationRecord;
    person: PersonRecord;
    inviter: Awaited<ReturnType<UserRepository['findById']>>;
  }> {
    if (!token || token.length < 16 || token.length > 256) {
      throw new DomainError(ErrorCode.InviteNotFound, 'Invitation not found', 404);
    }
    const invitation = await this.invitations.findByTokenHash(this.crypto.hmac(token));
    if (!invitation) throw new DomainError(ErrorCode.InviteNotFound, 'Invitation not found', 404);
    const person = await this.persons.findById(invitation.personId);
    if (!person || person.deletedAt) throw new DomainError(ErrorCode.InviteNotFound, 'Invitation not found', 404);
    const inviter = await this.users.findById(invitation.invitedByUserId);
    return { invitation, person, inviter };
  }

  private effectiveStatus(invitation: ContactInvitationRecord): ContactInvitationRecord['status'] {
    if (invitation.status === 'invited' && invitation.expiresAt.getTime() <= this.clock.now().getTime()) return 'expired';
    return invitation.status;
  }
}
