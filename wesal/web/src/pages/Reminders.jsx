import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtDate, fmtTime } from '../i18n.js';
import { Sheet, Empty, Seg } from '../components/ui.jsx';
import { CalendarIcon, PlusIcon, CheckCircleIcon, TrashIcon, PhoneIcon, HeartIcon, StarIcon, ClockIcon } from '../icons.jsx';

const KINDS = [
  { value: 'kinship', label: 'صلة رحم', icon: HeartIcon },
  { value: 'call', label: 'اتصال', icon: PhoneIcon },
  { value: 'visit', label: 'زيارة', icon: CalendarIcon },
  { value: 'occasion', label: 'مناسبة', icon: StarIcon },
];
const REPEATS = [
  { value: 'none', label: 'مرة واحدة' },
  { value: 'daily', label: 'يوميًا' },
  { value: 'weekly', label: 'أسبوعيًا' },
  { value: 'monthly', label: 'شهريًا' },
];

export default function Reminders() {
  const { t, lang, showToast } = useApp();
  const [reminders, setReminders] = useState(null);
  const [relatives, setRelatives] = useState([]);
  const [open, setOpen] = useState(false);
  const now = new Date(Date.now() + 3600000);
  const defaultForm = () => ({
    title: '', personName: '', relativeId: '', kind: 'kinship', repeat: 'none',
    date: now.toISOString().slice(0, 10), time: `${String(now.getHours()).padStart(2, '0')}:00`,
  });
  const [f, setF] = useState(defaultForm());

  const load = useCallback(async () => {
    const [rm, rl] = await Promise.all([api('/reminders'), api('/relatives')]);
    setReminders(rm.reminders);
    setRelatives(rl.relatives);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const save = async () => {
    if (!f.title.trim()) return showToast(lang === 'ar' ? 'اكتب عنوان التذكير' : 'Title required');
    const rel = relatives.find((r) => r.id === f.relativeId);
    try {
      await api('/reminders', {
        method: 'POST',
        body: {
          title: f.title,
          personName: rel ? rel.name : f.personName || undefined,
          relativeId: f.relativeId || undefined,
          kind: f.kind,
          repeat: f.repeat,
          dueAt: new Date(`${f.date}T${f.time}`).toISOString(),
        },
      });
      setOpen(false);
      setF(defaultForm());
      showToast(lang === 'ar' ? 'أُنشئ التذكير' : 'Reminder created');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const toggleDone = async (r) => {
    const d = await api(`/reminders/${r.id}`, { method: 'PATCH', body: { done: !r.done } });
    setReminders(d.reminders);
    if (!r.done) showToast(lang === 'ar' ? 'أحسنت، وُصلت الرحم' : 'Well done');
  };

  const del = async (r) => {
    const d = await api(`/reminders/${r.id}`, { method: 'DELETE' });
    setReminders(d.reminders);
  };

  const openList = (reminders || []).filter((r) => !r.done);
  const doneList = (reminders || []).filter((r) => r.done);

  return (
    <main className="page">
      <div className="section-title" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 22 }}>{t.reminders}</span>
      </div>
      <p style={{ color: 'var(--text-2)', margin: '0 2px 16px', fontSize: 14.5 }}>
        {lang === 'ar' ? '"اتصل بجدتي"، "اطمئن على أخي"... رتّب مواعيد قلبك.' : 'Schedule the calls that matter.'}
      </p>

      {reminders !== null && reminders.length === 0 && (
        <Empty icon={<CalendarIcon size={44} />} text={lang === 'ar' ? 'لا تذكيرات بعد' : 'No reminders yet'} />
      )}

      {openList.map((r) => {
        const overdue = new Date(r.due_at) < new Date();
        const Icon = KINDS.find((k) => k.value === r.kind)?.icon || ClockIcon;
        return (
          <div key={r.id} className="list-item">
            <button
              className="icon-btn"
              style={{ borderRadius: '50%', width: 40, height: 40 }}
              onClick={() => toggleDone(r)}
              aria-label="تم"
            >
              <CheckCircleIcon size={20} />
            </button>
            <div className="grow">
              <div className="name" style={{ fontSize: 15.5 }}>{r.title}</div>
              <div className="meta" style={overdue ? { color: 'var(--wait)', fontWeight: 600 } : undefined}>
                {fmtDate(r.due_at, lang)} · {fmtTime(r.due_at, lang)}
                {r.repeat !== 'none' && ` · ${REPEATS.find((x) => x.value === r.repeat)?.label}`}
              </div>
            </div>
            <div className="avatar sm"><Icon size={18} /></div>
          </div>
        );
      })}

      {doneList.length > 0 && (
        <>
          <div className="section-title"><span style={{ fontSize: 15, color: 'var(--text-3)' }}>{lang === 'ar' ? 'منجزة' : 'Done'}</span></div>
          {doneList.slice(0, 5).map((r) => (
            <div key={r.id} className="list-item" style={{ opacity: 0.6 }}>
              <div className="avatar sm" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}><CheckCircleIcon size={18} /></div>
              <div className="grow">
                <div className="name" style={{ fontSize: 15, textDecoration: 'line-through' }}>{r.title}</div>
              </div>
              <button className="icon-btn" style={{ width: 38, height: 38 }} onClick={() => del(r)} aria-label={t.delete}>
                <TrashIcon size={17} />
              </button>
            </div>
          ))}
        </>
      )}

      <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        <PlusIcon size={20} /> {lang === 'ar' ? 'تذكير جديد' : 'New reminder'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ar' ? 'تذكير جديد' : 'New reminder'}>
        <div className="field">
          <label>{lang === 'ar' ? 'ما الذي تريد تذكّره؟' : 'What to remember?'}</label>
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={lang === 'ar' ? 'مثال: اتصل بجدتي' : 'e.g. Call grandma'} />
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'الشخص (اختياري)' : 'Person (optional)'}</label>
          <select className="input" value={f.relativeId} onChange={(e) => setF({ ...f, relativeId: e.target.value })}>
            <option value="">—</option>
            {relatives.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>{lang === 'ar' ? 'التاريخ' : 'Date'}</label>
            <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div className="field">
            <label>{lang === 'ar' ? 'الوقت' : 'Time'}</label>
            <input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'نوع التذكير' : 'Kind'}</label>
          <Seg options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} />
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'التكرار' : 'Repeat'}</label>
          <Seg options={REPEATS} value={f.repeat} onChange={(v) => setF({ ...f, repeat: v })} />
        </div>
        <button className="btn btn-primary btn-block" onClick={save}>{t.save}</button>
      </Sheet>
    </main>
  );
}
