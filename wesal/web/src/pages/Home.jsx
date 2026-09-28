import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtRelative, daysAgoText, fmtDate } from '../i18n.js';
import { Avatar, StatusChip } from '../components/ui.jsx';
import { HeartFilledIcon, ClockIcon, CheckCircleIcon, ChevronIcon, HeartIcon, PeopleIcon } from '../icons.jsx';

export default function Home() {
  const { user, t, lang, showToast, refreshMe, refreshUnread } = useApp();
  const [status, setStatus] = useState(null);
  const [relatives, setRelatives] = useState([]);
  const [members, setMembers] = useState([]);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const [st, rel, fam] = await Promise.all([
        api('/checkins/status'),
        api('/relatives'),
        api('/family'),
      ]);
      setStatus(st);
      setRelatives(rel.relatives);
      setMembers(fam.members);
    } catch {
      /* تجاهل */
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 17 ? t.goodMorning : t.goodEvening;
  const firstName = (user?.name || '').split(' ')[0];

  const confirm = async () => {
    try {
      await api('/checkins/confirm', { method: 'POST' });
      setJustConfirmed(true);
      showToast(lang === 'ar' ? 'الحمد لله على سلامتك، تم إبلاغ من يحبك' : 'Confirmed — your loved ones can rest easy');
      await Promise.all([refreshMe(), load(), refreshUnread()]);
      setTimeout(() => setJustConfirmed(false), 3500);
    } catch (e) {
      showToast(e.message);
    }
  };

  const snooze = async () => {
    try {
      await api('/checkins/snooze', { method: 'POST', body: { minutes: 30 } });
      showToast(lang === 'ar' ? 'سنذكرك بعد 30 دقيقة' : 'We will remind you in 30 minutes');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const hasOpen = status?.open && status.open.status === 'pending';
  const overdue = relatives.filter((r) => r.overdue).slice(0, 3);
  const upcoming = relatives
    .filter((r) => !r.overdue)
    .sort((a, b) => new Date(a.nextDue) - new Date(b.nextDue))
    .slice(0, 3);

  return (
    <main className="page">
      {/* التحية */}
      <div style={{ margin: '6px 2px 18px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>
          {greeting}{firstName ? `، ${firstName}` : ''}
        </h1>
        <p style={{ color: 'var(--text-2)' }}>{t.reassure}</p>
      </div>

      {/* بطاقة أنا بخير */}
      <div className="card" style={{ textAlign: 'center', padding: 26 }}>
        {hasOpen && !justConfirmed && (
          <p style={{ marginBottom: 14, fontWeight: 600, color: 'var(--wait)' }}>
            {t.checkinTime}
          </p>
        )}
        <button className={`imok ${justConfirmed ? 'confirmed' : hasOpen ? 'attention' : ''}`} onClick={confirm}>
          {justConfirmed ? <CheckCircleIcon size={28} /> : <HeartFilledIcon size={26} />}
          {justConfirmed ? (lang === 'ar' ? 'تم التأكيد' : 'Confirmed') : t.imOk}
        </button>
        {hasOpen && !justConfirmed && (
          <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={snooze}>
            <ClockIcon size={19} /> {t.remindLater}
          </button>
        )}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-2)', fontSize: 14.5 }}>
          <ClockIcon size={17} />
          {user?.lastCheckinAt || status?.lastCheckinAt
            ? `${t.lastConfirm}: ${fmtRelative(status?.lastCheckinAt || user?.lastCheckinAt, lang)}`
            : t.noConfirmYet}
        </div>
        {status?.schedule && !status.schedule.enabled && (
          <Link to="/settings/schedule" style={{ display: 'block', marginTop: 12, fontSize: 13.5, color: 'var(--gold)', fontWeight: 600 }}>
            {lang === 'ar' ? 'نظام الاطمئنان الدوري غير مفعّل — فعّله من هنا' : 'Periodic check-in is off — enable it here'}
          </Link>
        )}
      </div>

      {/* من يحتاج تواصلك */}
      {overdue.length > 0 && (
        <>
          <div className="section-title">
            <span>{lang === 'ar' ? 'يشتاقون إليك' : 'They miss you'}</span>
            <button className="more" onClick={() => nav('/kinship')}>{lang === 'ar' ? 'الكل' : 'All'}</button>
          </div>
          {overdue.map((r) => (
            <div key={r.id} className="list-item clickable" onClick={() => nav(`/kinship/${r.id}`)}>
              <Avatar name={r.name} src={r.avatar} />
              <div className="grow">
                <div className="name">{r.name}</div>
                <div className="meta">{daysAgoText(r.daysSince, lang)}</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); nav(`/kinship/${r.id}`); }}>
                {t.contactNow}
              </button>
            </div>
          ))}
        </>
      )}

      {/* مواعيد قادمة */}
      {upcoming.length > 0 && (
        <>
          <div className="section-title"><span>{t.upcoming}</span></div>
          {upcoming.map((r) => (
            <div key={r.id} className="list-item clickable" onClick={() => nav(`/kinship/${r.id}`)}>
              <Avatar name={r.name} src={r.avatar} />
              <div className="grow">
                <div className="name">{r.name}</div>
                <div className="meta">{lang === 'ar' ? `الموعد القادم: ${fmtDate(r.nextDue, lang)}` : `Next: ${fmtDate(r.nextDue, lang)}`}</div>
              </div>
              <ChevronIcon size={18} style={{ color: 'var(--text-3)' }} />
            </div>
          ))}
        </>
      )}

      {relatives.length === 0 && (
        <div className="card clickable" onClick={() => nav('/kinship')} style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--primary)', marginBottom: 8 }}><HeartIcon size={34} /></div>
          <h3>{lang === 'ar' ? 'ابدأ صلة الرحم' : 'Start your kinship circle'}</h3>
          <p className="sub">{lang === 'ar' ? 'أضف من تحب ليساعدك وصال على البقاء قريبًا منهم.' : 'Add your loved ones and Wesal will keep you close.'}</p>
        </div>
      )}

      {/* حالة العائلة */}
      {members.length > 0 && (
        <>
          <div className="section-title">
            <span>{lang === 'ar' ? 'اطمئن على عائلتك' : 'Your family'}</span>
            <button className="more" onClick={() => nav('/family')}>{lang === 'ar' ? 'الكل' : 'All'}</button>
          </div>
          {members.slice(0, 3).map((m) => (
            <div key={m.linkId} className="list-item">
              <Avatar name={m.name} src={m.avatar} />
              <div className="grow">
                <div className="name">{m.name}</div>
                {m.relation && <div className="meta">{m.relation}</div>}
              </div>
              <StatusChip status={m.status === 'ok' && m.lastCheckinAt && Date.now() - new Date(m.lastCheckinAt) > 2 * 86400000 ? 'notconfirmed' : m.status} t={t} />
            </div>
          ))}
        </>
      )}
    </main>
  );
}
