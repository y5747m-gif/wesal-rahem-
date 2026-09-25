import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { CONFIG, type AppConfig } from './config/configuration';
import { CoreModule } from './infrastructure/core.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { DtoMapper } from './application/services/dto.mapper';
import { AccessService } from './application/services/access.service';
import { ScheduleGenerationService } from './application/services/schedule.service';
import { EscalationEngine } from './application/services/escalation.service';
import { NotificationService } from './application/services/notification.service';
import { AuthUseCase } from './application/use-cases/auth.use-case';
import { PersonUseCase } from './application/use-cases/person.use-case';
import { TrustedContactUseCase } from './application/use-cases/trusted-contact.use-case';
import { CheckInUseCase } from './application/use-cases/checkin.use-case';
import { HealthController } from './presentation/controllers/health.controller';
import { AuthController } from './presentation/controllers/auth.controller';
import { PersonsController } from './presentation/controllers/persons.controller';
import { HomeController } from './presentation/controllers/home.controller';
import { TrustedContactsController } from './presentation/controllers/trusted-contacts.controller';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';
import { DomainExceptionFilter } from './presentation/filters/domain-exception.filter';
import { EnvelopeInterceptor } from './presentation/interceptors/envelope.interceptor';
import { SchedulerWorker } from './worker/scheduler.worker';

/**
 * الوحدة الجذرية — تربط الطبقات:
 * config → infrastructure (core + persistence) → application (services + use cases) → presentation.
 */
@Module({
  imports: [
    AppConfigModule,
    CoreModule,
    PersistenceModule,
    ThrottlerModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: config.throttle.ttlSeconds * 1000, limit: config.throttle.limit },
          { name: 'auth', ttl: config.throttle.authTtlSeconds * 1000, limit: config.throttle.authLimit },
        ],
      }),
    }),
  ],
  controllers: [HealthController, AuthController, PersonsController, HomeController, TrustedContactsController],
  providers: [
    // application
    DtoMapper,
    AccessService,
    ScheduleGenerationService,
    EscalationEngine,
    NotificationService,
    AuthUseCase,
    PersonUseCase,
    TrustedContactUseCase,
    CheckInUseCase,
    // worker
    SchedulerWorker,
    // presentation (global)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
