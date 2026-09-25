import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { CONFIG, type AppConfig } from './config/configuration';
import { loadEnvFile } from './config/load-env';

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(CONFIG);

  app.set('trust proxy', 1);
  app.use(
    helmet({
      // صفحات الويب العامة (الدعوة / أنا بخير / المعاينة) تُحمَّل داخل iframe في بيئات المعاينة
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    }),
  );
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Requested-With'],
  });
  app.setGlobalPrefix(config.apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidUnknownValues: false,
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  // Swagger / OpenAPI
  const swagger = new DocumentBuilder()
    .setTitle('وصال — WESAL API')
    .setDescription('صلة الرحم والاطمئنان على الأحباب بانتظام. كل الاستجابات بصيغة { ok, data | error }.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger), {
    customSiteTitle: 'WESAL API Docs',
  });

  // واجهة الويب (معاينة) — ملفات ثابتة + صفحات عامة للدعوة و"أنا بخير"
  const webDir = resolveWebDir();
  if (webDir) {
    const server = app.getHttpAdapter().getInstance() as express.Express;
    server.use(express.static(webDir, { index: 'index.html', maxAge: '5m' }));
    const spa = (_req: express.Request, res: express.Response) => res.sendFile(path.join(webDir, 'index.html'));
    server.get(['/', '/app', '/app/*splat', '/invite/*splat', '/fine/*splat', '/persons/*splat'], spa);
    logger.log(`Web UI served from ${webDir}`);
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`❤️ وصال يعمل على http://0.0.0.0:${config.port}/${config.apiPrefix} · Swagger: /docs · Web: /`);
}

function resolveWebDir(): string | null {
  const candidates = [
    path.resolve(__dirname, 'presentation', 'web'), // dist
    path.resolve(__dirname, '..', 'src', 'presentation', 'web'), // dist → src (assets غير منسوخة)
    path.resolve(process.cwd(), 'src', 'presentation', 'web'),
    path.resolve(process.cwd(), 'apps', 'api', 'src', 'presentation', 'web'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null;
}

bootstrap().catch((error: Error) => {
  // فشل مبكر برسالة واضحة (إعدادات/قاعدة بيانات)
  process.stderr.write(`\n❌ فشل إقلاع الخادم:\n${error.stack ?? error.message}\n`);
  process.exit(1);
});
