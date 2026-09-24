import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { buildDataSource } from './data-source';
import { runMigrations } from './migrator';
import { DATA_SOURCE, REPOSITORIES } from './repository-tokens';
import {
  SqlConsentRepository,
  SqlDeviceRepository,
  SqlOtpRepository,
  SqlPrivacySettingsRepository,
  SqlSessionRepository,
  SqlUserRepository,
} from './identity.repositories';
import {
  SqlPersonRepository,
  SqlScheduleEntryRepository,
  SqlScheduleExceptionRepository,
  SqlScheduleRepository,
} from './person.repositories';
import { SqlAttemptRepository, SqlCheckInRepository, SqlSyncOperationRepository } from './checkin.repositories';
import {
  SqlContactInvitationRepository,
  SqlTrustedContactRepository,
  SqlWebCheckInLinkRepository,
} from './contact.repositories';
import {
  SqlAuditLogRepository,
  SqlEscalationRepository,
  SqlEscalationRuleRepository,
  SqlNotificationRepository,
  SqlScheduledJobRepository,
} from './escalation.repositories';

/**
 * وحدة التخزين — تُنشئ اتصال PostgreSQL وتوفّر كل المستودعات كمنافذ (Ports).
 *
 * عند الإقلاع في بيئات التطوير والاختبار تُطبَّق الهجرات تلقائيًا (idempotent)،
 * أما في الإنتاج فتُطبَّق عبر `npm run migrate` ضمن خطوة النشر.
 */
export const ALL_REPOSITORY_TOKENS = Object.values(REPOSITORIES);

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [CONFIG],
      useFactory: async (config: AppConfig): Promise<DataSource> => {
        const logger = new Logger('Database');
        const dataSource = buildDataSource({
          url: config.databaseUrl,
          ssl: config.databaseSsl,
          maxConnections: config.databaseMaxConnections,
          logging: config.logLevel === 'debug',
        });

        const startedAt = Date.now();
        await dataSource.initialize();
        const version = await dataSource.query('SHOW server_version');
        logger.log(
          `✅ PostgreSQL ${String(version?.[0]?.server_version ?? '?')} connected in ${Date.now() - startedAt}ms`,
        );

        if (config.databaseAutoMigrate) {
          const result = await runMigrations(dataSource);
          if (result.applied.length > 0) {
            logger.log(`🧱 applied ${result.applied.length} migration(s): ${result.applied.map((m) => m.name).join(', ')}`);
          }
        }
        return dataSource;
      },
    },
    { provide: REPOSITORIES.users, useClass: SqlUserRepository },
    { provide: REPOSITORIES.otp, useClass: SqlOtpRepository },
    { provide: REPOSITORIES.sessions, useClass: SqlSessionRepository },
    { provide: REPOSITORIES.devices, useClass: SqlDeviceRepository },
    { provide: REPOSITORIES.privacySettings, useClass: SqlPrivacySettingsRepository },
    { provide: REPOSITORIES.consents, useClass: SqlConsentRepository },
    { provide: REPOSITORIES.persons, useClass: SqlPersonRepository },
    { provide: REPOSITORIES.schedules, useClass: SqlScheduleRepository },
    { provide: REPOSITORIES.scheduleExceptions, useClass: SqlScheduleExceptionRepository },
    { provide: REPOSITORIES.scheduleEntries, useClass: SqlScheduleEntryRepository },
    { provide: REPOSITORIES.checkIns, useClass: SqlCheckInRepository },
    { provide: REPOSITORIES.attempts, useClass: SqlAttemptRepository },
    { provide: REPOSITORIES.syncOperations, useClass: SqlSyncOperationRepository },
    { provide: REPOSITORIES.contactInvitations, useClass: SqlContactInvitationRepository },
    { provide: REPOSITORIES.trustedContacts, useClass: SqlTrustedContactRepository },
    { provide: REPOSITORIES.webCheckInLinks, useClass: SqlWebCheckInLinkRepository },
    { provide: REPOSITORIES.escalationRules, useClass: SqlEscalationRuleRepository },
    { provide: REPOSITORIES.escalations, useClass: SqlEscalationRepository },
    { provide: REPOSITORIES.notifications, useClass: SqlNotificationRepository },
    { provide: REPOSITORIES.scheduledJobs, useClass: SqlScheduledJobRepository },
    { provide: REPOSITORIES.auditLogs, useClass: SqlAuditLogRepository },
  ],
  exports: [DATA_SOURCE, ...ALL_REPOSITORY_TOKENS],
})
export class PersistenceModule implements OnApplicationShutdown {
  private readonly logger = new Logger(PersistenceModule.name);

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
        this.logger.log('Database connection closed');
      }
    } catch (error) {
      this.logger.error(`Failed to close database connection: ${(error as Error).message}`);
    }
  }
}
