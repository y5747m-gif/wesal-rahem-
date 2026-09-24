import { Global, Inject, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/configuration';
import { SYMBOLS } from '../application/ports/services';
import { SystemClock } from '../domain/shared/clock';
import { CryptoIdGenerator } from './auth/id-generator';
import { AesFieldEncryption } from './crypto/field-encryption';
import { JwtTokenService } from './auth/jwt-token.service';
import { DatabaseOtpService } from './auth/otp.service';
import { HttpUrlBuilder } from './core/url-builder';
import { DatabaseAuditLogger } from './core/audit-logger';
import { WesalNotificationDispatcher } from './notifications/notification-dispatcher';
import { LoggingMessageChannel } from './notifications/message-channel';

/**
 * الوحدة الأساسية — توفّر كل المنافذ التقنية (Ports) كحقن واحد في كل التطبيق.
 *
 * لماذا رموز (Symbols) وليس أنواعًا؟ حتى تبقى طبقة التطبيق خالية تمامًا من أي
 * اعتماد على NestJS أو TypeORM أو مزوّد خارجي — وهذا ما يجعلها قابلة للاختبار
 * باستبدالات بسيطة (Fakes).
 */
export const OTP_SERVICE = Symbol('OTP_SERVICE');

@Global()
@Module({
  providers: [
    { provide: SYMBOLS.Clock, useClass: SystemClock },
    { provide: SYMBOLS.IdGenerator, useClass: CryptoIdGenerator },
    {
      provide: SYMBOLS.FieldEncryption,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => new AesFieldEncryption(config.crypto.fieldEncryptionKey),
    },
    { provide: SYMBOLS.TokenService, useClass: JwtTokenService },
    { provide: OTP_SERVICE, useClass: DatabaseOtpService },
    { provide: SYMBOLS.UrlBuilder, useClass: HttpUrlBuilder },
    { provide: SYMBOLS.AuditLogger, useClass: DatabaseAuditLogger },
    { provide: SYMBOLS.NotificationDispatcher, useClass: WesalNotificationDispatcher },
    { provide: SYMBOLS.MessageChannel, useClass: LoggingMessageChannel },
  ],
  exports: [
    SYMBOLS.Clock,
    SYMBOLS.IdGenerator,
    SYMBOLS.FieldEncryption,
    SYMBOLS.TokenService,
    OTP_SERVICE,
    SYMBOLS.UrlBuilder,
    SYMBOLS.AuditLogger,
    SYMBOLS.NotificationDispatcher,
    SYMBOLS.MessageChannel,
  ],
})
export class CoreModule {
  constructor(@Inject(CONFIG) config: AppConfig) {
    // رسالة إقلاع واضحة تساعد في تشخيص الإعدادات
    process.stdout.write(
      `[wesal] env=${config.env} port=${config.port} otpDev=${config.otp.devMode} ` +
        `notifications=${config.notifications.driver} scheduler=${config.scheduler.enabled}\n`,
    );
  }
}
