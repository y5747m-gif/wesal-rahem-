# النشر — إصلاح 404 على Vercel

الصفحة `https://wesal-rahem.vercel.app/` كانت تعيد صفحة المنصة `404 NOT_FOUND` لأن النشر الناجح لا يحتوي ملفًا يطابق `/`. المستودع خادم NestJS بلا `index.html`، ومجلد الإخراج الافتراضي (`public` أو `dist`) كان فارغًا، لذلك كل المسارات — بما فيها `/package.json` — تعيد 404.

## ما يُنشر الآن

- `public/index.html` صفحة عربية (RTL) وهي مخرجات Vercel.
- `vercel.json` يفرض `outputDirectory: public` ويتجاوز أمر البناء في لوحة Vercel.
- `scripts/vercel-build.mjs` ينسخ الصفحة أيضًا إلى `dist/` و`apps/api/public/` حتى يعمل النشر إذا كان جذر مشروع Vercel هو المستودع أو `apps/api`.
- `/health` يُعاد كتابته إلى `health.json` ولا يكشف أي سر.

المعاينة المحلية:

```bash
npm run build
npm run preview
```

ثم افتح `/` وتأكد أن الاستجابة `200` وليست `404`.
