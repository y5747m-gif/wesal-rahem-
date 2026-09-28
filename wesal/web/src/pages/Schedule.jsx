import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Toggle, Seg } from '../components/ui.jsx';
import { ChevronIcon, ClockIcon, ShieldIcon } from '../icons.jsx';

export default function Schedule() {
  const { t, lang, schedule, setSchedule, showToast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState(() => ({
    enabled: !!schedule?.enabled,
    frequency: schedule?.frequency || 'daily',
    customDays: schedule?.custom_days || 5,
    timeOfDay: schedule?.time_of_day || '20:00',
    graceMinutes: schedule?.grace_minutes || 60,
    reminderGapMinutes: schedule?.reminder_gap_minutes || 30,
  }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const d = await api('/checkins/schedule', {
        method: 'PUT',
        body: { ...f, timezoneOffset: new Date().getTimezoneOffset() },
      });
      setSchedule(d.schedule);
      showToast(lang === 'ar' ? 'حُفظ جدول الاطمئنان' : 'Schedule saved');
      nav(-1);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)} style={{ marginBottom: 14 }}>
        <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {lang === 'ar' ? 'رجوع' : 'Back'}
      </button>
      <div className="section-title" style={{ marginTop: 0 }}>
        <span style={{ fontSize: 22 }}>{t.checkinSchedule}</span>
      </div>
      <p style={{ color: 'var(--text-2)', margin: '0 2px 16px', fontSize: 14.5 }}>
        {lang === 'ar'
          ? 'حدد متى يسألك وصال: "حان وقت الاطمئنان عليك" — وأنت تجيب بضغطة واحدة.'
          : 'Choose when Wesal asks you to check in.'}
      </p>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>{lang === 'ar' ? 'تفعيل نظام الاطمئنان' : 'Enable check-ins'}</h3>
            <div className="sub" style={{ fontSize: 13.5 }}>
              {lang === 'ar' ? 'اختياري تمامًا، ويمكن إيقافه في أي وقت.' : 'Optional — turn off anytime.'}
            </div>
          </div>
          <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="enabled" />
        </div>
      </div>

      {f.enabled && (
        <>
          <div className="card">
            <div className="field">
              <label>{lang === 'ar' ? 'التكرار' : 'Frequency'}</label>
              <Seg
                value={f.frequency}
                onChange={(v) => setF({ ...f, frequency: v })}
                options={[
                  { value: 'daily', label: t.daily },
                  { value: 'every2', label: t.every2 },
                  { value: 'every3', label: t.every3 },
                  { value: 'weekly', label: t.weekly },
                  { value: 'custom', label: t.custom },
                ]}
              />
            </div>
            {f.frequency === 'custom' && (
              <div className="field">
                <label>{lang === 'ar' ? 'كل كم يومًا؟' : 'Every how many days?'}</label>
                <input className="input" type="number" min="1" max="90" value={f.customDays} onChange={(e) => setF({ ...f, customDays: Number(e.target.value) })} />
              </div>
            )}
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{lang === 'ar' ? 'وقت التذكير' : 'Reminder time'}</label>
              <input className="input" type="time" value={f.timeOfDay} onChange={(e) => setF({ ...f, timeOfDay: e.target.value })} />
              <div className="hint">
                {lang === 'ar' ? `مثال: كل يوم الساعة ${f.timeOfDay} — "حان وقت الاطمئنان عليك"` : ''}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ gap: 10, marginBottom: 12 }}>
              <div style={{ color: 'var(--primary)' }}><ClockIcon size={20} /></div>
              <h3 style={{ fontSize: 16 }}>{lang === 'ar' ? 'التدرج قبل إبلاغ أي أحد' : 'Gentle escalation'}</h3>
            </div>
            <div className="field">
              <label>{lang === 'ar' ? 'مهلة السماح قبل أول تذكير (دقائق)' : 'Grace period (minutes)'}</label>
              <Seg
                value={f.graceMinutes}
                onChange={(v) => setF({ ...f, graceMinutes: v })}
                options={[{ value: 15, label: '15' }, { value: 30, label: '30' }, { value: 60, label: '60' }, { value: 120, label: '120' }]}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{lang === 'ar' ? 'الفاصل بين مراحل التصعيد (دقائق)' : 'Gap between stages (minutes)'}</label>
              <Seg
                value={f.reminderGapMinutes}
                onChange={(v) => setF({ ...f, reminderGapMinutes: v })}
                options={[{ value: 15, label: '15' }, { value: 30, label: '30' }, { value: 60, label: '60' }, { value: 120, label: '120' }]}
              />
            </div>
          </div>

          <div className="card" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }}><ShieldIcon size={20} /></div>
              <div className="sub" style={{ fontSize: 13.5, lineHeight: 1.8 }}>
                {lang === 'ar' ? (
                  <>
                    <b>كيف يعمل التدرج؟</b>
                    <br />1· تذكير لطيف لك أنت فقط
                    <br />2· تذكير إضافي بعد المهلة
                    <br />3· تتحول حالتك إلى "بانتظار التأكيد"
                    <br />4· نبلغ جهتك الموثوقة الأولى برسالة هادئة
                    <br />5· ثم الجهات التالية بالترتيب الذي حددته
                    <br />
                    <span style={{ color: 'var(--gold)' }}>لا نقول أبدًا أنك في خطر — فقط أنك لم تؤكد حالتك.</span>
                  </>
                ) : (
                  'Reminders first, then your trusted contacts — in your order, with calm wording only.'
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>{t.save}</button>
    </main>
  );
}
