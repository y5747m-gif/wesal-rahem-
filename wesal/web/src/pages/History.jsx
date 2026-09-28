import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtRelative } from '../i18n.js';
import { Sheet, Empty } from '../components/ui.jsx';
import { TimelineIcon, PlusIcon, ChevronIcon, CheckIcon } from '../icons.jsx';

const METHOD_LABEL = { call: 'اتصلت بـ', message: 'أرسلت رسالة إلى', whatsapp: 'راسلت عبر واتساب', visit: 'زرت', other: 'تواصلت مع' };
const METHOD_LABEL_EN = { call: 'Called', message: 'Messaged', whatsapp: 'WhatsApp with', visit: 'Visited', other: 'Contacted' };

export default function History() {
  const { t, lang, showToast } = useApp();
  const [logs, setLogs] = useState(null);
  const [relatives, setRelatives] = useState([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ personName: '', relativeId: '', method: 'call', note: '' });
  const nav = useNavigate();

  const load = useCallback(async () => {
    const [h, r] = await Promise.all([api('/history'), api('/relatives')]);
    setLogs(h.logs);
    setRelatives(r.relatives);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const save = async () => {
    if (!f.personName.trim() && !f.relativeId) return showToast(lang === 'ar' ? 'اختر شخصًا أو اكتب اسمه' : 'Pick or type a name');
    try {
      await api('/history', { method: 'POST', body: { ...f, relativeId: f.relativeId || undefined } });
      setOpen(false);
      setF({ personName: '', relativeId: '', method: 'call', note: '' });
      showToast(lang === 'ar' ? 'سُجّل التواصل' : 'Logged');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  // تجميع حسب اليوم
  const groups = [];
  if (logs) {
    let currentDay = null;
    for (const l of logs) {
      const iso = l.happened_at.endsWith('Z') ? l.happened_at : l.happened_at + 'Z';
      const day = new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      if (day !== currentDay) {
        groups.push({ day, items: [] });
        currentDay = day;
      }
      groups[groups.length - 1].items.push({ ...l, iso });
    }
  }

  return (
    <main className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => nav('/kinship')} style={{ marginBottom: 14 }}>
        <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {t.kinship}
      </button>
      <div className="section-title" style={{ marginTop: 0 }}>
        <span style={{ fontSize: 22 }}>{t.history}</span>
        <button className="more" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <PlusIcon size={16} /> {t.logContact}
        </button>
      </div>

      {logs !== null && logs.length === 0 && (
        <Empty icon={<TimelineIcon size={44} />} text={lang === 'ar' ? 'لا سجلات بعد' : 'No records yet'} sub={lang === 'ar' ? 'كل تواصل تسجله يُبنى هنا كذكرى جميلة.' : ''} />
      )}

      {groups.map((g) => (
        <div key={g.day}>
          <div className="section-title"><span style={{ fontSize: 14.5, color: 'var(--text-3)' }}>{g.day}</span></div>
          <div className="card">
            <div className="timeline">
              {g.items.map((l) => (
                <div key={l.id} className="tl-item">
                  <div style={{ fontWeight: 600, fontSize: 15.5 }}>
                    {(lang === 'ar' ? METHOD_LABEL : METHOD_LABEL_EN)[l.method] || ''} {l.person_name}
                  </div>
                  {l.note && <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{l.note}</div>}
                  <div className="when">{fmtRelative(l.iso, lang)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <Sheet open={open} onClose={() => setOpen(false)} title={t.logContact}>
        <div className="field">
          <label>{lang === 'ar' ? 'الشخص' : 'Person'}</label>
          <select
            className="input"
            value={f.relativeId}
            onChange={(e) => setF({ ...f, relativeId: e.target.value, personName: '' })}
          >
            <option value="">{lang === 'ar' ? '— شخص من خارج القائمة —' : '— someone else —'}</option>
            {relatives.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {!f.relativeId && (
          <div className="field">
            <label>{lang === 'ar' ? 'اسم الشخص' : 'Name'}</label>
            <input className="input" value={f.personName} onChange={(e) => setF({ ...f, personName: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label>{lang === 'ar' ? 'طريقة التواصل' : 'Method'}</label>
          <div className="seg">
            {[['call', t.call], ['message', t.message], ['whatsapp', t.whatsapp], ['visit', t.visit]].map(([v, l]) => (
              <button key={v} className={f.method === v ? 'on' : ''} onClick={() => setF({ ...f, method: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label>
          <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <button className="btn btn-primary btn-block" onClick={save}><CheckIcon size={19} /> {t.save}</button>
      </Sheet>
    </main>
  );
}
