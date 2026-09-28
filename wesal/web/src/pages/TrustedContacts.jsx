import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Avatar, Sheet, Toggle, Empty, Seg } from '../components/ui.jsx';
import { ShieldIcon, PlusIcon, UpIcon, DownIcon, TrashIcon, EditIcon, ChevronIcon } from '../icons.jsx';

const METHODS = [
  { value: 'sms', label: 'رسالة SMS' },
  { value: 'call', label: 'اتصال' },
  { value: 'whatsapp', label: 'واتساب' },
];

export default function TrustedContacts() {
  const { t, lang, showToast } = useApp();
  const [contacts, setContacts] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { name: '', phone: '', relation: '', method: 'sms', alertsAllowed: true };
  const [f, setF] = useState(empty);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const d = await api('/contacts');
    setContacts(d.contacts);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const openForm = (c) => {
    setEditing(c || null);
    setF(c ? { name: c.name, phone: c.phone, relation: c.relation, method: c.method, alertsAllowed: !!c.alerts_allowed } : empty);
    setOpen(true);
  };

  const save = async () => {
    try {
      if (editing) await api(`/contacts/${editing.id}`, { method: 'PATCH', body: f });
      else await api('/contacts', { method: 'POST', body: f });
      setOpen(false);
      showToast(lang === 'ar' ? 'تم الحفظ' : 'Saved');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const move = async (idx, dir) => {
    const order = contacts.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    const d = await api('/contacts/order', { method: 'PUT', body: { order } });
    setContacts(d.contacts);
  };

  const del = async (c) => {
    if (!window.confirm(lang === 'ar' ? `حذف ${c.name}؟` : `Delete ${c.name}?`)) return;
    const d = await api(`/contacts/${c.id}`, { method: 'DELETE' });
    setContacts(d.contacts);
  };

  return (
    <main className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => nav('/settings')} style={{ marginBottom: 14 }}>
        <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {t.settings}
      </button>
      <div className="section-title" style={{ marginTop: 0 }}>
        <span style={{ fontSize: 22 }}>{t.trustedContacts}</span>
      </div>
      <div className="card" style={{ background: 'var(--surface-2)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }}><ShieldIcon size={22} /></div>
        <p className="sub" style={{ fontSize: 13.5 }}>
          {lang === 'ar'
            ? 'إذا لم تؤكد أنك بخير في موعدك، نتواصل مع هؤلاء بالترتيب الذي تحدده — برسالة هادئة تطلب الاطمئنان عليك فقط، دون أي افتراضات.'
            : 'If you miss a check-in, we contact these people in your order — with a calm message only.'}
        </p>
      </div>

      {contacts !== null && contacts.length === 0 && (
        <Empty icon={<ShieldIcon size={44} />} text={lang === 'ar' ? 'لا جهات موثوقة بعد' : 'No trusted contacts yet'} sub={lang === 'ar' ? 'أضف من تثق به ليطمئن عليك عند الحاجة.' : ''} />
      )}

      {(contacts || []).map((c, i) => (
        <div key={c.id} className="list-item">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button className="icon-btn" style={{ width: 30, height: 26, borderRadius: 8 }} onClick={() => move(i, -1)} disabled={i === 0} aria-label="أعلى">
              <UpIcon size={14} />
            </button>
            <button className="icon-btn" style={{ width: 30, height: 26, borderRadius: 8 }} onClick={() => move(i, 1)} disabled={i === contacts.length - 1} aria-label="أسفل">
              <DownIcon size={14} />
            </button>
          </div>
          <div className="avatar" style={{ fontSize: 15 }}>{i + 1}</div>
          <div className="grow">
            <div className="name">{c.name} <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-3)' }}>· {c.relation}</span></div>
            <div className="meta" dir="ltr" style={{ textAlign: 'end' }}>{c.phone}</div>
            <div className="meta" style={{ fontSize: 12.5 }}>
              {METHODS.find((m) => m.value === c.method)?.label}
              {' · '}
              {c.alerts_allowed ? (lang === 'ar' ? 'التنبيهات مسموحة' : 'Alerts on') : (lang === 'ar' ? 'التنبيهات متوقفة' : 'Alerts off')}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => openForm(c)} aria-label={t.edit}><EditIcon size={16} /></button>
            <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => del(c)} aria-label={t.delete}><TrashIcon size={16} /></button>
          </div>
        </div>
      ))}

      <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={() => openForm(null)}>
        <PlusIcon size={20} /> {lang === 'ar' ? 'إضافة جهة موثوقة' : 'Add trusted contact'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={editing ? (lang === 'ar' ? 'تعديل جهة' : 'Edit contact') : (lang === 'ar' ? 'جهة موثوقة جديدة' : 'New trusted contact')}>
        <div className="field">
          <label>الاسم</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label>رقم الهاتف</label>
          <input className="input" type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+20 ..." />
        </div>
        <div className="field">
          <label>صلة القرابة</label>
          <input className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} placeholder="أخي، والدي، صديقي..." />
        </div>
        <div className="field">
          <label>طريقة التواصل</label>
          <Seg options={METHODS} value={f.method} onChange={(v) => setF({ ...f, method: v })} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18, padding: '4px 2px' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{lang === 'ar' ? 'السماح بإرسال التنبيه إليه' : 'Allow alerts'}</div>
            <div className="hint">{lang === 'ar' ? 'يمكن إيقافه مؤقتًا دون حذف الجهة' : ''}</div>
          </div>
          <Toggle on={f.alertsAllowed} onChange={(v) => setF({ ...f, alertsAllowed: v })} label="alerts" />
        </div>
        <button className="btn btn-primary btn-block" onClick={save} disabled={!f.name.trim() || !f.phone.trim() || !f.relation.trim()}>
          {t.save}
        </button>
      </Sheet>
    </main>
  );
}
