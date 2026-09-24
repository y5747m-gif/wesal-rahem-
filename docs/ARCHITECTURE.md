# المعمارية — وصال

## الطبقات (Clean Architecture)

```
presentation/  ← HTTP: Controllers · DTO validation · Guards · فلاتر الأخطاء · Swagger
      ↓ يعتمد على
application/   ← حالات الاستخدام · المنافذ (Ports) · خدمات التطبيق
      ↓ يعتمد على
domain/        ← منطق نقي: الجدولة · الحالات · التصعيد · ساعات الهدوء · القوالب
                 (لا NestJS، لا TypeORM، لا شبكة، لا ساعة نظام — كل شيء يُمرَّر صراحةً)
      ↑ تنفّذه
infrastructure/← TypeORM/pg · المستودعات · التشفير · JWT/OTP · الإشعارات · العامل · الهجرات
```

القاعدة: **الاعتماد يتجه للداخل دائمًا**. `domain` لا يعرف شيئًا عن `application`،
و`application` يعرف المنافذ فقط (رموز حقن) ولا يعرف TypeORM. هذا ما يجعل منطق الجدولة
والتصعيد قابلًا للاختبار بزمن ثابت وقاعدة بيانات وهمية.

`packages/shared` هو العقد بين الخادم والتطبيق: الأنواع، ألوان الحالة، نصوص ar/en، وتنسيق الوقت.

## تدفق يوم عادي

```
1. توليد المواعيد     : ScheduleGenerationService.ensureEntriesForPerson()
                        → schedule_entries (+ job تذكير عند الموعد + job إعادة محاولة)
2. عند الموعد          : Worker يستخرج المهام (FOR UPDATE SKIP LOCKED)
                        → EscalationEngine.processJob() → decideEscalation() [نقي]
                        → NotificationService.sendDueReminder() → حفظ ثم تسليم
3. المستخدم يضغط ❤️     : CheckInUseCase → check_ins (idempotency_key)
                        → الموعد becomes checked + إغلاق المواعيد الأقدم المفتوحة
                        → EscalationEngine.resolveOnCheckIn() → إلغاء كل التنبيهات المعلّقة فورًا
4. فات الموعد + المهلة  : evaluateOpenEntries() → status = unverified
                        → إشعار للمستخدم فقط (لا طرف ثالث في هذه الحالة أبدًا)
```

## تدفق "لم يرد" (السبب الثاني فقط هو ما قد يُصعَّد)

```
📞 اتصلت ولم يرد → communication_attempts (outcome=no_answer) + job إعادة محاولة
   → مهلة السماح تنتهي → unverified
   → (بموافقة مسبقة + جهة قبلت الدعوة + خارج ساعات الهدوء + ضمن الحدود)
       المرحلة 3: تنبيه الجهة الأولى → المرحلة 4: الثانية + إرشاد الطوارئ
   → أي تأكيد "تم الاطمئنان عليه ❤️" يوقف كل شيء فورًا ويعيد الحالة إلى 🟢
```

## المخطط (ملخّص)

```
users ──< devices
  │   └─< auth_sessions           (refresh_token_hash فريد، revocable)
  ├──── privacy_settings (1:1)
  └──< persons (owner_user_id) ──< schedules (1 أساسي نشط + 1 مؤقت نشط)
                │                └─< schedule_exceptions (person_id, date, action) UNIQUE
                ├──< schedule_entries (person_id, scheduled_for) UNIQUE
                │        └─< escalations (entry_id, stage) UNIQUE
                ├──< check_ins (idempotency_key UNIQUE)
                ├──< communication_attempts (idempotency_key UNIQUE)
                ├──< contact_invitations (token_hash UNIQUE) ──> trusted_contacts
                ├──< web_check_in_links (token_hash UNIQUE)
                ├──< escalation_rules (person_id PK)
                └──< notifications (idempotency_key UNIQUE)
users ──< sync_operations (user_id, idempotency_key) UNIQUE
families ──< family_members (family_id, user_id) UNIQUE · مالك واحد نشط
scheduled_jobs (idempotency_key UNIQUE) · consents (موضوع+نطاق ساري واحد) · audit_logs
```

## مسارات الـ API (v1)

```
POST   /auth/otp/request            POST /auth/otp/verify        POST /auth/refresh
POST   /auth/logout                 GET  /me                     PATCH /me
DELETE /me                          POST /devices

POST   /persons                     GET  /persons                GET /persons/:id
PATCH  /persons/:id                 DELETE /persons/:id
POST   /persons/:id/pause           POST /persons/:id/resume
POST   /persons/:id/deceased-report GET  /persons/:id/who-sees-me
POST   /persons/:id/exceptions      DELETE /persons/:id/exceptions/:date
POST   /persons/:id/check-ins       POST /persons/:id/attempts   POST /persons/:id/snooze

GET    /today                       GET  /week                   GET /logs
POST   /sync                        GET  /notifications         POST /notifications/read

POST   /persons/:id/trusted-contacts          GET /persons/:id/trusted-contacts
DELETE /trusted-contacts/invitations/:id
GET    /public/invites/:token       POST /public/invites/:token/accept
POST   /public/invites/:token/decline        POST /public/invites/:token/withdraw
GET    /public/fine/:token          POST /public/fine/:token     (بلا تطبيق ولا تسجيل دخول)

GET    /health                      GET /docs (Swagger)
```

`/public/*` لا يتطلب مصادقة: يكشف الحد الأدنى (اسم أول + صلة قرابة + أزرار)،
ورموزه عالية العشوائية وتنتهي خلال وقت قصير.

## الموثوقية

- **Idempotency** في كل كتابة حساسة: `check_ins`, `communication_attempts`, `notifications`,
  `scheduled_jobs`, `sync_operations` — إعادة الإرسال لا تُكرِّر الأثر.
- **Backoff أُسّي** للإشعارات (1 → 2 → 4 دقائق، 3 محاولات كحد أقصى) مع تتبع حالة التسليم.
- **طابور بمزاحمة آمنة**: `FOR UPDATE SKIP LOCKED` يسمح بأكثر من عامل دون تكرار التنفيذ.
- **المؤقتات على الخادم** لأن هاتف المستخدم قد يكون مغلقًا أو بلا شبكة.
- **دون اتصال**: التطبيق يخزّن العمليات ويزامنها دفعة واحدة، والخادم يحل التعارضات بوقت الجهاز.
