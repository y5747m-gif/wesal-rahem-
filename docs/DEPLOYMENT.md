# النشر على Vercel ونقل المتغيرات من GitHub

هذا الملف يشرح حل مشكلة 404 في Vercel وطريقة نقل متغيرات البيئة من GitHub Actions إلى Vercel بدون كشف القيم السرية.

## ما تم تغييره لمنع 404

- أُضيفت صفحة ثابتة في `public/index.html`، لذلك المسار `/` لم يعد فارغًا على Vercel.
- أُضيف `vercel.json` حتى يبني Vercel المشروع كصفحة ثابتة ويعيد أي مسار واجهة إلى `index.html`.
- أُضيفت دوال Vercel آمنة:
  - `/api` يعرض المسارات المتاحة.
  - `/api/health` يعرض حالة الإعدادات بدون طباعة أي قيمة سرية.
- أُضيف خادم معاينة محلي عبر `npm run preview`.

## GitHub → Vercel

أُضيف Workflow يدوي في:

```text
.github/workflows/vercel-sync-and-deploy.yml
```

وظيفته:

1. يقرأ القيم من GitHub Secrets و GitHub Variables.
2. يرسلها إلى Vercel Environment Variables عبر `scripts/sync-vercel-env.mjs`.
3. يبني وينشر المشروع على Vercel.

> ملاحظة مهمة: GitHub لا يسمح للبوت أو لأي Workflow بقراءة قيم الأسرار بعد حفظها. يمكن فقط تمريرها أثناء التشغيل. لذلك لا تُطبع القيم في السجلات ولا في `/api/health`.

## أسرار GitHub المطلوبة للنشر

ضع هذه كـ **GitHub Actions Secrets**:

| الاسم | أين يُستخدم | ملاحظة |
|---|---|---|
| `VERCEL_TOKEN` | GitHub فقط | Token من Vercel لتشغيل النشر. لا يُرسل كمتغير Runtime للتطبيق. |
| `VERCEL_ORG_ID` | GitHub فقط | معرّف الفريق/الحساب في Vercel. |
| `VERCEL_PROJECT_ID` | GitHub فقط | معرّف مشروع Vercel. |
| `DATABASE_URL` | Vercel Runtime | رابط PostgreSQL الإنتاجي. |
| `JWT_ACCESS_SECRET` | Vercel Runtime | سر عشوائي قوي، 32 حرفًا على الأقل. |
| `JWT_REFRESH_SECRET` | Vercel Runtime | سر عشوائي مختلف عن access. |
| `FIELD_ENCRYPTION_KEY` | Vercel Runtime | 32 بايت hex = 64 رمزًا hex. |
| `OTP_FIXED_DEV_CODE` | اختياري | اتركه فارغًا في الإنتاج. |
| `FCM_PROJECT_ID` | اختياري | مطلوب فقط عند تفعيل FCM. |
| `FCM_CLIENT_EMAIL` | اختياري | مطلوب فقط عند تفعيل FCM. |
| `FCM_PRIVATE_KEY` | اختياري | مطلوب فقط عند تفعيل FCM. يمكن حفظه مع `\n`. |

توليد أسرار آمنة محليًا:

```bash
openssl rand -base64 48     # JWT_ACCESS_SECRET أو JWT_REFRESH_SECRET
openssl rand -hex 32        # FIELD_ENCRYPTION_KEY
```

## متغيرات GitHub غير السرية

ضع هذه كـ **GitHub Actions Variables**، وسيتم إرسالها إلى Vercel أيضًا:

| الاسم | قيمة إنتاج مقترحة |
|---|---|
| `NODE_ENV` | `production` |
| `API_PREFIX` | `v1` |
| `PUBLIC_BASE_URL` | رابط Vercel أو الدومين النهائي، مثل `https://example.vercel.app` |
| `CORS_ORIGINS` | نفس رابط الواجهة أو قائمة روابط مفصولة بفواصل |
| `DATABASE_SSL` | `true` |
| `DATABASE_MAX_CONNECTIONS` | `10` |
| `JWT_ACCESS_TTL_SECONDS` | `900` |
| `JWT_REFRESH_TTL_DAYS` | `30` |
| `OTP_TTL_MINUTES` | `10` |
| `OTP_MAX_ATTEMPTS` | `5` |
| `OTP_LENGTH` | `6` |
| `OTP_RESEND_COOLDOWN_SECONDS` | `60` |
| `OTP_DEV_MODE` | `false` |
| `INVITE_TTL_DAYS` | `14` |
| `WEB_CHECKIN_LINK_TTL_MINUTES` | `45` |
| `SCHEDULER_ENABLED` | `true` |
| `SCHEDULER_TICK_SECONDS` | `30` |
| `SCHEDULE_GENERATION_WEEKS_AHEAD` | `3` |
| `DEFAULT_GRACE_PERIOD_MINUTES` | `90` |
| `NOTIFICATION_DRIVER` | `log` مؤقتًا، ثم `push` عند تفعيل FCM |
| `SMS_DRIVER` | `log` مؤقتًا |
| `SMS_MAX_PER_DAY_PER_CONTACT` | `2` |
| `THROTTLE_TTL_SECONDS` | `60` |
| `THROTTLE_LIMIT` | `120` |
| `THROTTLE_AUTH_TTL_SECONDS` | `60` |
| `THROTTLE_AUTH_LIMIT` | `10` |
| `AUDIT_ENABLED` | `true` |
| `LOG_LEVEL` | `log` |

## التشغيل اليدوي للـ Workflow

بعد إضافة الأسرار والمتغيرات في GitHub:

1. افتح GitHub → Actions.
2. اختر **Sync environment to Vercel and deploy**.
3. اضغط **Run workflow**.
4. اختر:
   - `environment = production`
   - `sync_env = true`
   - `deploy = true`

## أوامر مفيدة

فحص البناء المحلي الخاص بـ Vercel:

```bash
npm run build
```

معاينة الصفحة محليًا:

```bash
npm run preview
```

فحص الصحة بعد النشر:

```bash
curl https://YOUR_DOMAIN/api/health
```

الاستجابة تعرض أسماء المتغيرات الناقصة فقط، ولا تعرض أي قيمة سرية.
