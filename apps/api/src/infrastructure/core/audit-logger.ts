import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditContext, AuditLogger } from '../../application/ports/services';
import type { AuditLogRepository } from '../../application/ports/repositories';
import { REPOSITORIES } from '../persistence/repository-tokens';
import { CONFIG, type AppConfig } from '../../config/configuration';

/**
 * سجل التدقيق — لكل عملية حساسة: موافقة، دعوة، قبول، إبلاغ، تغيير جدول، حذف.
 *
 * لا يُخزَّن في السجل أي رقم هاتف أو نص رسالة؛ فقط معرّفات ووصف للإجراء.
 */
@Injectable()
export class DatabaseAuditLogger implements AuditLogger {
  private readonly logger = new Logger('Audit');

  constructor(
    @Inject(REPOSITORIES.auditLogs) private readonly auditLogs: AuditLogRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async log(ctx: AuditContext): Promise<void> {
    if (!this.config.auditEnabled) return;

    await this.auditLogs.append({
      actorUserId: ctx.actorUserId ?? null,
      actorKind: ctx.actorKind ?? 'user',
      action: ctx.action,
      entityType: ctx.entityType,
      entityId: ctx.entityId ?? null,
      personId: ctx.personId ?? null,
      familyId: ctx.familyId ?? null,
      metadataJson: ctx.metadata ? safeMetadata(ctx.metadata) : null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
    });

    if (this.config.logLevel === 'debug') {
      this.logger.debug(`${ctx.actorKind ?? 'user'} ${ctx.action} ${ctx.entityType} ${ctx.entityId ?? ''}`.trim());
    }
  }
}

/** ينزع أي قيمة قد تكون حساسة من البيانات الوصفية قبل التخزين */
function safeMetadata(metadata: Record<string, unknown>): string {
  const blocked = ['phone', 'code', 'token', 'password', 'secret', 'email', 'address'];
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.some((b) => key.toLowerCase().includes(b))) {
      clean[key] = '[redacted]';
      continue;
    }
    clean[key] = value;
  }
  return JSON.stringify(clean).slice(0, 4000);
}
