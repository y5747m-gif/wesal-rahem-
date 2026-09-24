import { Inject, Injectable } from '@nestjs/common';
import type { UserId } from '@wesal/shared';
import type { PersonRecord, UserRecord } from '../ports/records';
import type { PersonRepository, UserRepository } from '../ports/repositories';
import { REPOSITORIES } from '../../infrastructure/persistence/repository-tokens';
import { ForbiddenError, NotFoundError } from '../../domain/shared/errors';

/**
 * خدمة الصلاحيات — **التحقق يحدث دائمًا على الخادم**، ولا يُكتفى بإخفاء العناصر في الواجهة.
 *
 * سياسة الإفصاح: عند طلب مورد لا يملكه المستخدم نُعيد 404 (وليس 403) حتى لا
 * نستكشف وجود معرّفات الآخرين.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(REPOSITORIES.persons) private readonly persons: PersonRepository,
    @Inject(REPOSITORIES.users) private readonly users: UserRepository,
  ) {}

  async requireUser(userId: UserId): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) throw new NotFoundError('Account');
    return user;
  }

  async requireOwnedPerson(userId: UserId, personId: string): Promise<PersonRecord> {
    const person = await this.persons.findByIdForUser(personId, userId);
    if (!person) throw new NotFoundError('Person');
    return person;
  }

  /**
   * هل يجوز لهذا المستخدم رؤية رقم الشخص كاملًا؟
   * MVP: المالك فقط. في المرحلة الثانية: أدوار العائلة (owner/admin) وفق إعدادات المشاركة.
   */
  canSeePersonPhone(user: UserRecord, person: PersonRecord): boolean {
    return user.id === person.ownerUserId;
  }

  /**
   * الإبلاغ عن الوفاة إجراء حساس جدًا — يتطلب مالك الشخص وتأكيدًا صريحًا.
   * (سؤال مفتوح في الوثيقة: من يملك الحق؟ نعتمد المالك + تأكيد صريح + سجل تدقيق،
   *  وفي المرحلة الثانية يُضاف تحقق ثانٍ من مدير العائلة.)
   */
  assertCanReportDeceased(user: UserRecord, person: PersonRecord): void {
    if (user.id !== person.ownerUserId) {
      throw new ForbiddenError('Only the person’s owner can record this status');
    }
  }

  /** من يُسمح له بإرسال دعوة جهة موثوقة؟ المالك فقط في المرحلة الأولى */
  assertCanManageTrustedContacts(user: UserRecord, person: PersonRecord): void {
    if (user.id !== person.ownerUserId) {
      throw new ForbiddenError('Only the person’s owner can manage trusted contacts');
    }
  }
}
