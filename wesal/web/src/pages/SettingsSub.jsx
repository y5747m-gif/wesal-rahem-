import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Avatar, Toggle } from '../components/ui.jsx';
import { ChevronIcon, ShieldIcon, EyeOffIcon, CheckCircleIcon, LockIcon } from '../icons.jsx';

const Back = ({ nav, label }) => (
  <button className="btn btn-ghost btn-sm" onClick={() => nav('/settings')} style={{ marginBottom: 14 }}>
    <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {label}
  </button>
);

export function Account() {
  const { user, t, lang, refreshMe, showToast } = useApp();
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const nav = useNavigate();

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const s = Math.min(img.width, img.height);
        c.width = c.height = 200;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 200, 200);
        setAvatar(c.toDataURL('image/jpeg', 0.78));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    await api('/auth/me', { method: 'PATCH', body: { name, phone, avatar } });
    await refreshMe();
    showToast(lang === 'ar' ? 'حُدّث حسابك' : 'Updated');
    nav('/settings');
  };

  return (
    <main className="page">
      <Back nav={nav} label={t.settings} />
      <div className="section-title" style={{ marginTop: 0 }}><span style={{ fontSize: 22 }}>{lang === 'ar' ? 'الحساب' : 'Account'}</span></div>
      <div className="card" style={{ textAlign: 'center' }}>
        <label style={{ cursor: 'pointer', display: 'inline-block' }}>
          <Avatar name={name} src={avatar} size="lg" />
          <div className="hint" style={{ marginTop: 6 }}>{lang === 'ar' ? 'تغيير الصورة' : 'Change photo'}</div>
          <input type="file" accept="image/*" hidden onChange={pickPhoto} />
        </label>
        <div className="field" style={{ textAlign: 'start', marginTop: 16 }}>
          <label>{lang === 'ar' ? 'الاسم' : 'Name'}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ textAlign: 'start' }}>
          <label>{lang === 'ar' ? 'رقم الهاتف' : 'Phone'}</label>
          <input className="input" dir="ltr" value={phone || ''} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field" style={{ textAlign: 'start' }}>
          <label>{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</label>
          <input className="input" dir="ltr" value={user?.email || ''} disabled style={{ opacity: 0.6 }} />
        </div>
        <button className="btn btn-primary btn-block" onClick={save}>{t.save}</button>
      </div>
    </main>
  );
}

export function Security() {
  const { t, lang, showToast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const nav = useNavigate();

  const save = async () => {
    try {
      await api('/auth/change-password', { method: 'POST', body: { current, next } });
      showToast(lang === 'ar' ? 'غُيّرت كلمة المرور' : 'Password changed');
      nav('/settings');
    } catch (e) {
      showToast(e.message);
    }
  };

  return (
    <main className="page">
      <Back nav={nav} label={t.settings} />
      <div className="section-title" style={{ marginTop: 0 }}><span style={{ fontSize: 22 }}>{lang === 'ar' ? 'الأمان' : 'Security'}</span></div>
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          <div style={{ color: 'var(--primary)' }}><LockIcon size={22} /></div>
          <h3>{lang === 'ar' ? 'تغيير كلمة المرور' : 'Change password'}</h3>
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'كلمة المرور الحالية' : 'Current password'}</label>
          <input className="input" type="password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}</label>
          <input className="input" type="password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} />
          <div className="hint">{lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'}</div>
        </div>
        <button className="btn btn-primary btn-block" onClick={save} disabled={!current || next.length < 8}>{t.save}</button>
      </div>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="sub" style={{ fontSize: 13.5, lineHeight: 1.9 }}>
          <b>{lang === 'ar' ? 'كيف نحمي حسابك؟' : 'How we protect you'}</b>
          <br />{lang === 'ar' ? '· كلمات المرور مشفّرة بخوارزمية bcrypt ولا تُخزن أبدًا كنص.' : '· Passwords hashed with bcrypt.'}
          <br />{lang === 'ar' ? '· الجلسات برموز JWT موقّعة ومحدودة الصلاحية.' : '· Signed, expiring JWT sessions.'}
          <br />{lang === 'ar' ? '· كل طلب يتحقق من هويتك وصلاحياتك قبل عرض أي بيانات.' : '· Every request is authorized.'}
        </div>
      </div>
    </main>
  );
}

export function Privacy() {
  const { t, lang, settings, updateSettings } = useApp();
  const nav = useNavigate();

  const items = lang === 'ar' ? [
    'لا نتتبع موقعك الجغرافي — أبدًا.',
    'لا نقرأ رسائلك ولا نسجل مكالماتك.',
    'لا نراقبك في الخلفية؛ نعرف فقط ما تخبرنا به بنفسك.',
    'لا نرسل أي تنبيه لأي شخص إلا وفق الإعدادات التي وافقت عليها.',
    'رسالة التصعيد لا تذكر أبدًا أنك في خطر — فقط أنك لم تؤكد حالتك.',
    'بياناتك ملكك: صدّرها أو احذفها نهائيًا متى شئت.',
  ] : [
    'No location tracking — ever.',
    'We never read messages or record calls.',
    'No background monitoring; we only know what you tell us.',
    'No alerts to anyone except per your explicit settings.',
    'Escalation messages never claim danger — only that you have not confirmed.',
    'Your data is yours: export or delete it anytime.',
  ];

  return (
    <main className="page">
      <Back nav={nav} label={t.settings} />
      <div className="section-title" style={{ marginTop: 0 }}><span style={{ fontSize: 22 }}>{lang === 'ar' ? 'الخصوصية' : 'Privacy'}</span></div>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <div style={{ color: 'var(--primary)' }}><EyeOffIcon size={22} /></div>
          <h3>{lang === 'ar' ? 'وصال ليس تطبيق مراقبة' : 'Wesal is not surveillance'}</h3>
        </div>
        {items.map((x, i) => (
          <div key={i} className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
            <div style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 3 }}><CheckCircleIcon size={17} /></div>
            <div style={{ fontSize: 14.5 }}>{x}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>{lang === 'ar' ? 'مشاركة حالتي مع عائلتي المرتبطة' : 'Share my status with linked family'}</h3>
            <div className="sub" style={{ fontSize: 13 }}>
              {lang === 'ar' ? 'عند الإيقاف، يرون "لا يشارك حالته" فقط.' : 'When off, they only see "not sharing".'}
            </div>
          </div>
          <Toggle on={!!settings?.share_status} onChange={(v) => updateSettings({ shareStatus: v })} label="share" />
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ gap: 10 }}>
          <div style={{ color: 'var(--primary)' }}><ShieldIcon size={20} /></div>
          <div className="sub" style={{ fontSize: 13.5 }}>
            {lang === 'ar'
              ? 'جميع صلاحيات التطبيق اختيارية وواضحة، ويمكنك التراجع عن أي منها في أي وقت.'
              : 'All permissions are optional, explicit, and revocable.'}
          </div>
        </div>
      </div>
    </main>
  );
}
