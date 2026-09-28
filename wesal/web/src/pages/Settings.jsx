import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api, getToken } from '../api.js';
import { Avatar, Toggle, Sheet } from '../components/ui.jsx';
import {
  UserIcon, MoonIcon, SunIcon, BellIcon, ClockIcon, ShieldIcon, LockIcon,
  DownloadIcon, LogoutIcon, TrashIcon, ChevronIcon, HeartIcon, EyeOffIcon, SettingsIcon,
} from '../icons.jsx';

export default function Settings() {
  const { user, t, lang, settings, updateSettings, logout, showToast } = useApp();
  const nav = useNavigate();
  const dark = (settings?.theme || 'light') === 'dark';

  const Row = ({ icon: Icon, title, sub, onClick, trailing }) => (
    <button className="settings-row" onClick={onClick}>
      <span className="ic"><Icon size={20} /></span>
      <span className="grow" style={{ flex: 1, textAlign: 'start' }}>
        <span style={{ fontWeight: 700, display: 'block', fontSize: 15.5 }}>{title}</span>
        {sub && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{sub}</span>}
      </span>
      {trailing || <ChevronIcon size={17} style={{ color: 'var(--text-3)' }} />}
    </button>
  );

  return (
    <main className="page">
      <div className="section-title" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 22 }}>{t.settings}</span>
      </div>

      {/* بطاقة الحساب */}
      <div className="card clickable" onClick={() => nav('/settings/account')}>
        <div className="row">
          <Avatar name={user?.name} src={user?.avatar} size="lg" />
          <div className="grow">
            <h3>{user?.name}</h3>
            <div className="sub" dir="ltr" style={{ textAlign: 'end' }}>{user?.email}</div>
            {user?.role === 'admin' && <span className="chip chip-gold" style={{ marginTop: 6 }}>{lang === 'ar' ? 'حساب إدارة' : 'Admin'}</span>}
          </div>
          <ChevronIcon size={18} style={{ color: 'var(--text-3)' }} />
        </div>
      </div>

      <div className="section-title"><span style={{ fontSize: 15 }}>{lang === 'ar' ? 'التفضيلات' : 'Preferences'}</span></div>
      <Row
        icon={dark ? MoonIcon : SunIcon}
        title={lang === 'ar' ? 'المظهر' : 'Appearance'}
        sub={dark ? (lang === 'ar' ? 'الوضع الداكن' : 'Dark') : (lang === 'ar' ? 'الوضع الفاتح' : 'Light')}
        onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
        trailing={<Toggle on={dark} onChange={(v) => updateSettings({ theme: v ? 'dark' : 'light' })} label="theme" />}
      />
      <Row
        icon={SettingsIcon}
        title={lang === 'ar' ? 'اللغة' : 'Language'}
        sub={lang === 'ar' ? 'العربية' : 'English'}
        onClick={() => updateSettings({ language: lang === 'ar' ? 'en' : 'ar' })}
        trailing={<span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>{lang === 'ar' ? 'EN' : 'ع'}</span>}
      />
      <Row
        icon={BellIcon}
        title={t.notifications}
        sub={settings?.notifications_on ? (lang === 'ar' ? 'مفعّلة' : 'On') : (lang === 'ar' ? 'متوقفة' : 'Off')}
        onClick={() => updateSettings({ notificationsOn: !settings?.notifications_on })}
        trailing={<Toggle on={!!settings?.notifications_on} onChange={(v) => updateSettings({ notificationsOn: v })} label="notif" />}
      />
      <Row
        icon={HeartIcon}
        title={lang === 'ar' ? 'تذكيرات صلة الرحم' : 'Kinship nudges'}
        sub={lang === 'ar' ? 'تنبيه لطيف عند طول الغيبة' : 'Gentle nudges'}
        onClick={() => updateSettings({ kinshipNudgesOn: !settings?.kinship_nudges_on })}
        trailing={<Toggle on={!!settings?.kinship_nudges_on} onChange={(v) => updateSettings({ kinshipNudgesOn: v })} label="nudges" />}
      />

      <div className="section-title"><span style={{ fontSize: 15 }}>{lang === 'ar' ? 'الاطمئنان والأمان' : 'Check-in & safety'}</span></div>
      <Row icon={ClockIcon} title={t.checkinSchedule} sub={lang === 'ar' ? 'التكرار والوقت والتدرج' : ''} onClick={() => nav('/settings/schedule')} />
      <Row icon={ShieldIcon} title={t.trustedContacts} sub={lang === 'ar' ? 'من نخبرهم عند الحاجة' : ''} onClick={() => nav('/settings/contacts')} />
      <Row icon={EyeOffIcon} title={lang === 'ar' ? 'الخصوصية' : 'Privacy'} sub={lang === 'ar' ? 'ماذا نعرف وماذا لا نعرف' : ''} onClick={() => nav('/settings/privacy')} />
      <Row icon={LockIcon} title={lang === 'ar' ? 'الأمان' : 'Security'} sub={lang === 'ar' ? 'كلمة المرور' : 'Password'} onClick={() => nav('/settings/security')} />

      <div className="section-title"><span style={{ fontSize: 15 }}>{lang === 'ar' ? 'البيانات' : 'Data'}</span></div>
      <Row
        icon={DownloadIcon}
        title={lang === 'ar' ? 'تصدير بياناتي' : 'Export my data'}
        sub={lang === 'ar' ? 'ملف JSON بكل ما يخصك' : 'JSON file'}
        onClick={async () => {
          const res = await fetch('/api/settings/export', { headers: { Authorization: `Bearer ${getToken()}` } });
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'wesal-export.json';
          a.click();
          showToast(lang === 'ar' ? 'تم تنزيل بياناتك' : 'Downloaded');
        }}
        trailing={<DownloadIcon size={17} style={{ color: 'var(--text-3)' }} />}
      />

      {user?.role === 'admin' && (
        <Row icon={ShieldIcon} title={lang === 'ar' ? 'لوحة الإدارة' : 'Admin dashboard'} onClick={() => nav('/admin')} />
      )}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn btn-ghost btn-block" onClick={() => { logout(); nav('/login'); }}>
          <LogoutIcon size={19} /> {lang === 'ar' ? 'تسجيل الخروج' : 'Log out'}
        </button>
        <DeleteAccount />
      </div>
      <p style={{ textAlign: 'center', marginTop: 26, color: 'var(--text-3)', fontSize: 13 }}>
        {t.slogan}
      </p>
    </main>
  );
}

function DeleteAccount() {
  const { lang, logout, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const nav = useNavigate();
  const word = lang === 'ar' ? 'حذف' : 'DELETE';

  const doDelete = async () => {
    try {
      await api('/auth/me', { method: 'DELETE' });
      logout();
      showToast(lang === 'ar' ? 'حُذف حسابك وكل بياناتك. في أمان الله.' : 'Account deleted.');
      nav('/login');
    } catch (e) {
      showToast(e.message);
    }
  };

  return (
    <>
      <button className="btn btn-danger btn-block" onClick={() => setOpen(true)}>
        <TrashIcon size={18} /> {lang === 'ar' ? 'حذف الحساب' : 'Delete account'}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ar' ? 'حذف الحساب نهائيًا' : 'Delete account'}>
        <p className="sub" style={{ marginBottom: 14 }}>
          {lang === 'ar'
            ? 'سيُحذف كل شيء: أقاربك، سجلاتك، جهاتك الموثوقة، وإشعاراتك. لا يمكن التراجع. اكتب "حذف" للتأكيد.'
            : 'Everything will be permanently removed. Type DELETE to confirm.'}
        </p>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} style={{ marginBottom: 14, textAlign: 'center' }} />
        <button className="btn btn-danger btn-block" disabled={text.trim() !== word} onClick={doDelete}>
          {lang === 'ar' ? 'حذف نهائي' : 'Delete forever'}
        </button>
      </Sheet>
    </>
  );
}
