import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtRelative } from '../i18n.js';
import { StatusChip } from '../components/ui.jsx';
import { ShieldIcon, ChevronIcon } from '../icons.jsx';

export default function Admin() {
  const { user, t, lang } = useApp();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    if (user?.role !== 'admin') {
      nav('/');
      return;
    }
    Promise.all([api('/admin/stats'), api('/admin/users')])
      .then(([s, u]) => {
        setData(s);
        setUsers(u.users);
      })
      .catch(() => nav('/'));
  }, [user, nav]);

  if (!data) return <main className="page" />;
  const s = data.stats;
  const maxDay = Math.max(1, ...data.dailyConfirmations.map((d) => d.c));

  const stats = [
    [s.users, lang === 'ar' ? 'إجمالي المستخدمين' : 'Users'],
    [s.activeToday, lang === 'ar' ? 'نشطون اليوم' : 'Active today'],
    [s.activeWeek, lang === 'ar' ? 'نشطون هذا الأسبوع' : 'Active this week'],
    [s.checkinsConfirmed, lang === 'ar' ? 'تأكيدات "أنا بخير"' : 'Confirmations'],
    [s.schedulesEnabled, lang === 'ar' ? 'جداول اطمئنان مفعّلة' : 'Enabled schedules'],
    [s.notificationsSent, lang === 'ar' ? 'إشعارات مُرسلة' : 'Notifications'],
    [s.remindersOpen, lang === 'ar' ? 'تذكيرات مفتوحة' : 'Open reminders'],
    [s.escalationAlerts, lang === 'ar' ? 'تنبيهات تصعيد' : 'Escalation alerts'],
    [s.relatives, lang === 'ar' ? 'أقارب مسجلون' : 'Relatives'],
    [s.contactLogs, lang === 'ar' ? 'تواصلات مسجلة' : 'Contact logs'],
    [s.trustedContacts, lang === 'ar' ? 'جهات موثوقة' : 'Trusted contacts'],
    [s.familyLinks, lang === 'ar' ? 'روابط عائلية' : 'Family links'],
  ];

  return (
    <main className="page">
      <button className="btn btn-ghost btn-sm" onClick={() => nav('/settings')} style={{ marginBottom: 14 }}>
        <ChevronIcon size={16} style={{ transform: 'scaleX(-1)' }} /> {t.settings}
      </button>
      <div className="section-title" style={{ marginTop: 0 }}>
        <span style={{ fontSize: 22, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ShieldIcon size={22} /> {lang === 'ar' ? 'لوحة الإدارة' : 'Admin dashboard'}
        </span>
      </div>
      <p style={{ color: 'var(--text-2)', margin: '0 2px 16px', fontSize: 13.5 }}>
        {lang === 'ar'
          ? 'إحصائيات مجمّعة فقط — لا تعرض هذه اللوحة أي محتوى خاص بالمستخدمين.'
          : 'Aggregated statistics only — no private user content.'}
      </p>

      <div className="stat-grid">
        {stats.map(([num, lbl]) => (
          <div key={lbl} className="stat">
            <div className="num">{num}</div>
            <div className="lbl">{lbl}</div>
          </div>
        ))}
      </div>

      {data.dailyConfirmations.length > 0 && (
        <>
          <div className="section-title"><span>{lang === 'ar' ? 'تأكيدات آخر 14 يومًا' : 'Confirmations — last 14 days'}</span></div>
          <div className="card" style={{ paddingBottom: 34 }}>
            <div className="bar-chart">
              {data.dailyConfirmations.map((d) => (
                <div key={d.day} className="bar" style={{ height: `${(d.c / maxDay) * 100}%` }} title={`${d.day}: ${d.c}`}>
                  <span>{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="section-title"><span>{lang === 'ar' ? 'المستخدمون' : 'Users'}</span></div>
      {users.map((u) => (
        <div key={u.id} className="list-item">
          <div className="grow">
            <div className="name" style={{ fontSize: 15 }}>{u.name} {u.role === 'admin' && <span className="chip chip-gold" style={{ fontSize: 11 }}>{lang === 'ar' ? 'إدارة' : 'admin'}</span>}</div>
            <div className="meta" dir="ltr" style={{ textAlign: 'end' }}>{u.email}</div>
            <div className="meta" style={{ fontSize: 12 }}>
              {u.last_checkin_at ? `${t.lastConfirm}: ${fmtRelative(u.last_checkin_at, lang)}` : t.noConfirmYet}
            </div>
          </div>
          <StatusChip status={u.status === 'awaiting' ? 'awaiting' : u.last_checkin_at ? 'ok' : 'notconfirmed'} t={t} />
        </div>
      ))}
    </main>
  );
}
