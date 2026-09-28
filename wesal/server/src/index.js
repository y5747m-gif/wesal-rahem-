import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { seed } from './seed.js';
import { startScheduler } from './services/scheduler.js';
import { authRouter } from './routes/auth.js';
import { checkinsRouter } from './routes/checkins.js';
import { contactsRouter } from './routes/contacts.js';
import { relativesRouter } from './routes/relatives.js';
import { historyRouter } from './routes/history.js';
import { remindersRouter } from './routes/reminders.js';
import { familyRouter } from './routes/family.js';
import { notificationsRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { adminRouter } from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
  })
);

// رؤوس أمان أساسية
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'wesal', time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/relatives', relativesRouter);
app.use('/api/history', historyRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/family', familyRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/admin', adminRouter);

// في الإنتاج: تقديم واجهة الويب المبنية من نفس الخادم
if (config.serveWebDist) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'المسار غير موجود.' }));

// معالج أخطاء موحد — لا يكشف تفاصيل داخلية
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('خطأ غير متوقع:', err);
  res.status(500).json({ error: 'server_error', message: 'حدث خطأ غير متوقع، حاول مرة أخرى.' });
});

seed();
startScheduler();

app.listen(config.port, config.host, () => {
  console.log(`💚 وصال API يعمل على http://${config.host}:${config.port}`);
});
