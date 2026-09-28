import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { daysAgoText, fmtDate, fmtRelative } from '../i18n.js';
import { Avatar, Sheet, Empty, Seg } from '../components/ui.jsx';
import {
  HeartIcon, PlusIcon, PhoneIcon, MessageIcon, WhatsAppIcon, CheckIcon,
  EditIcon, TrashIcon, ChevronIcon, TimelineIcon, ClockIcon,
} from '../icons.jsx';

const RELATIONS = ['أمي', 'أبي', 'جدتي', 'جدي', 'أخي', 'أختي', 'خالي', 'خالتي', 'عمي', 'عمتي', 'ابني', 'ابنتي', 'صديقي', 'صديقتي', 'أخرى'];

function RelativeForm({ open, onClose, onSaved, initial }) {
  const { showToast } = useApp();
  const empty = { name: '', relation: 'أمي', phone: '', notes: '', contactEveryDays: 7, avatar: null };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setF(initial ? {
      name: initial.name, relation: initial.relation, phone: initial.phone || '',
      notes: initial.notes || '', contactEveryDays: initial.contact_every_days, avatar: initial.avatar,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // تصغير الصورة إلى 160px للحفاظ على خفة قاعدة البيانات
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const s = Math.min(img.width, img.height);
        c.width = c.height = 160;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
        setF((p) => ({ ...p, avatar: c.toDataURL('image/jpeg', 0.75) }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!f.name.trim()) return showToast('الاسم مطلوب');
    setBusy(true);
    try {
      if (initial) await api(`/relatives/${initial.id}`, { method: 'PATCH', body: f });
      else await api('/relatives', { method: 'POST', body: f });
      onSaved();
      onClose();
      showToast(initial ? 'تم تحديث البيانات' : `أضفنا ${f.name} إلى صلتك`);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={initial ? 'تعديل شخص' : 'إضافة شخص عزيز'}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <label style={{ cursor: 'pointer', textAlign: 'center' }}>
          <Avatar name={f.name || '؟'} src={f.avatar} size="lg" />
          <div className="hint" style={{ marginTop: 6 }}>اختر صورة</div>
          <input type="file" accept="image/*" hidden onChange={pickPhoto} />
        </label>
      </div>
      <div className="field">
        <label>الاسم</label>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: والدتي الحبيبة" />
      </div>
      <div className="field">
        <label>صلة القرابة</label>
        <select className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })}>
          {RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="field">
        <label>رقم الهاتف (اختياري)</label>
        <input className="input" type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+20 ..." />
      </div>
      <div className="field">
        <label>أرغب في التواصل معه كل</label>
        <Seg
          value={Number(f.contactEveryDays)}
          onChange={(v) => setF({ ...f, contactEveryDays: v })}
          options={[
            { value: 1, label: 'يوم' }, { value: 3, label: '3 أيام' }, { value: 7, label: 'أسبوع' },
            { value: 14, label: 'أسبوعين' }, { value: 30, label: 'شهر' },
          ]}
        />
      </div>
      <div className="field">
        <label>ملاحظات</label>
        <textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="ما يحبه، مواعيده المفضلة للاتصال..." />
      </div>
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>حفظ</button>
    </Sheet>
  );
}

export default function Kinship() {
  const { t, lang } = useApp();
  const [relatives, setRelatives] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const d = await api('/relatives');
    setRelatives(d.relatives);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const overdue = (relatives || []).filter((r) => r.overdue);
  const ok = (relatives || []).filter((r) => !r.overdue);

  return (
    <main className="page">
      <div className="section-title" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 22 }}>{t.kinship}</span>
        <Link to="/history" className="more" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <TimelineIcon size={17} /> {t.history}
        </Link>
      </div>
      <p style={{ color: 'var(--text-2)', margin: '0 2px 16px', fontSize: 14.5 }}>
        {lang === 'ar' ? 'من تحب أن تبقى قريبًا منهم مهما انشغلت.' : 'The people you want to stay close to.'}
      </p>

      {relatives === null ? null : relatives.length === 0 ? (
        <Empty
          icon={<HeartIcon size={44} />}
          text={lang === 'ar' ? 'لم تضف أحدًا بعد' : 'No one added yet'}
          sub={lang === 'ar' ? 'ابدأ بوالدتك، جدتك، أو صديق غالٍ.' : 'Start with your mother, grandmother, or a dear friend.'}
        />
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <div className="section-title"><span style={{ color: 'var(--wait)' }}>{lang === 'ar' ? 'طالت الغيبة' : 'Overdue'}</span></div>
              {overdue.map((r) => <Row key={r.id} r={r} nav={nav} lang={lang} highlight />)}
            </>
          )}
          {ok.length > 0 && (
            <>
              {overdue.length > 0 && <div className="section-title"><span>{lang === 'ar' ? 'على تواصل' : 'In touch'}</span></div>}
              {ok.map((r) => <Row key={r.id} r={r} nav={nav} lang={lang} />)}
            </>
          )}
        </>
      )}

      <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={() => setFormOpen(true)}>
        <PlusIcon size={20} /> {lang === 'ar' ? 'أضف شخصًا عزيزًا' : 'Add someone dear'}
      </button>

      <RelativeForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} />
    </main>
  );
}

function Row({ r, nav, lang, highlight }) {
  return (
    <div className="list-item clickable" onClick={() => nav(`/kinship/${r.id}`)}>
      <Avatar name={r.name} src={r.avatar} />
      <div className="grow">
        <div className="name">{r.name} <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-3)' }}>· {r.relation}</span></div>
        <div className="meta" style={highlight ? { color: 'var(--wait)', fontWeight: 600 } : undefined}>
          {daysAgoText(r.daysSince, lang)}
        </div>
      </div>
      <ChevronIcon size={18} style={{ color: 'var(--text-3)' }} />
    </div>
  );
}

const METHODS = [
  { value: 'call', label: 'اتصال', icon: PhoneIcon },
  { value: 'message', label: 'رسالة', icon: MessageIcon },
  { value: 'whatsapp', label: 'واتساب', icon: WhatsAppIcon },
  { value: 'visit', label: 'زيارة', icon: HeartIcon },
];

export function RelativeDetail() {
  const { id } = useParams();
  const { t, lang, showToast } = useApp();
  const [data, setData] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logMethod, setLogMethod] = useState('call');
  const [logNote, setLogNote] = useState('');
  const nav = useNavigate();

  const load = useCallback(async () => {
    const d = await api(`/relatives/${id}`);
    setData(d);
  }, [id]);
  useEffect(() => { load().catch(() => nav('/kinship')); }, [load, nav]);

  if (!data) return <main className="page" />;
  const r = data.relative;
  const phoneClean = (r.phone || '').replace(/[^\d+]/g, '');

  const logIt = async (method, note) => {
    try {
      await api(`/relatives/${id}/log`, { method: 'POST', body: { method, note } });
      showToast(lang === 'ar' ? 'جزاك الله خيرًا، وُصلت الرحم' : 'Contact logged — well done');
      setLogOpen(false);
      setLogNote('');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const del = async () => {
    if (!window.confirm(lang === 'ar' ? `هل تريد حذف ${r.name} من صلتك؟` : `Remove ${r.name}?`)) return;
    await api(`/relatives/${id}`, { method: 'DELETE' });
    nav('/kinship');
  };

  return (
    <main className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => nav('/kinship')} style={{ marginBottom: 14 }}>
        <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {t.kinship}
      </button>

      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <Avatar name={r.name} src={r.avatar} size="lg" />
        </div>
        <h2 style={{ fontSize: 22 }}>{r.name}</h2>
        <div className="sub">{r.relation}</div>
        <div className="gold-line" />
        <p style={{ color: r.overdue ? 'var(--wait)' : 'var(--text-2)', fontWeight: r.overdue ? 700 : 400 }}>
          {daysAgoText(r.daysSince, lang)}
        </p>
        {!r.overdue && (
          <p className="sub" style={{ fontSize: 13.5 }}>
            {lang === 'ar' ? `موعد التواصل القادم: ${fmtDate(r.nextDue, lang)}` : `Next: ${fmtDate(r.nextDue, lang)}`}
          </p>
        )}
        {r.notes && (
          <p style={{ marginTop: 10, background: 'var(--surface-2)', borderRadius: 12, padding: '10px 14px', fontSize: 14.5 }}>
            {r.notes}
          </p>
        )}

        {/* أزرار التواصل */}
        <div style={{ display: 'grid', gridTemplateColumns: r.phone ? 'repeat(3, 1fr)' : '1fr', gap: 10, marginTop: 18 }}>
          {r.phone && (
            <>
              <a className="btn btn-primary" href={`tel:${phoneClean}`} onClick={() => logIt('call')}>
                <PhoneIcon size={19} /> {t.call}
              </a>
              <a className="btn btn-ghost" href={`sms:${phoneClean}`} onClick={() => logIt('message')}>
                <MessageIcon size={19} /> {t.message}
              </a>
              <a
                className="btn btn-ghost"
                href={`https://wa.me/${phoneClean.replace('+', '')}?text=${encodeURIComponent('السلام عليكم، اشتقت إليك واطمأننت عليك ❤️')}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => logIt('whatsapp')}
              >
                <WhatsAppIcon size={19} /> {t.whatsapp}
              </a>
            </>
          )}
        </div>
        <button className="btn btn-outline btn-block" style={{ marginTop: 10 }} onClick={() => setLogOpen(true)}>
          <CheckIcon size={19} /> {lang === 'ar' ? 'سجّل أنك تواصلت معه' : 'Log that you reached out'}
        </button>
      </div>

      {/* آخر التواصلات */}
      {data.logs.length > 0 && (
        <>
          <div className="section-title"><span>{lang === 'ar' ? 'آخر تواصل معه' : 'Recent contacts'}</span></div>
          <div className="card">
            <div className="timeline">
              {data.logs.slice(0, 6).map((l) => (
                <div key={l.id} className="tl-item">
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {METHODS.find((m) => m.value === l.method)?.label || t.other}
                    {l.note ? ` — ${l.note}` : ''}
                  </div>
                  <div className="when">{fmtRelative(l.happened_at.endsWith('Z') ? l.happened_at : l.happened_at + 'Z', lang)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditOpen(true)}>
          <EditIcon size={18} /> {t.edit}
        </button>
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={del}>
          <TrashIcon size={18} /> {t.delete}
        </button>
      </div>

      <RelativeForm open={editOpen} onClose={() => setEditOpen(false)} onSaved={load} initial={r} />

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title={lang === 'ar' ? 'كيف تواصلت؟' : 'How did you reach out?'}>
        <div className="seg" style={{ marginBottom: 16 }}>
          {METHODS.map((m) => (
            <button key={m.value} className={logMethod === m.value ? 'on' : ''} onClick={() => setLogMethod(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label>
          <input className="input" value={logNote} onChange={(e) => setLogNote(e.target.value)} placeholder={lang === 'ar' ? 'اطمأننت عليه، الحمد لله بخير' : ''} />
        </div>
        <button className="btn btn-primary btn-block" onClick={() => logIt(logMethod, logNote)}>
          <CheckIcon size={19} /> {t.save}
        </button>
      </Sheet>
    </main>
  );
}
