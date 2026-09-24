import { Global, Module } from '@nestjs/common';
import { buildConfig, CONFIG } from './configuration';

/**
 * إعدادات التطبيق كمزوّد واحد — تُبنى مرة واحدة وتُتحقَّق عند الإقلاع.
 * (فشل الإعدادات غير الصالحة يحدث هنا مبكرًا، لا في منتصف طلب مستخدم.)
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: () => buildConfig(process.env),
    },
  ],
  exports: [CONFIG],
})
export class AppConfigModule {}
