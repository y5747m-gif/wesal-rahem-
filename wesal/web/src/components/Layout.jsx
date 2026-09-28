import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtRelative } from '../i18n.js';
import { Sheet, Empty } from './ui.jsx';
import {
  HomeIcon, PeopleIcon, HeartIcon, BellIcon, SettingsIcon, CalendarIcon, WesalMark,
  CheckCircleIcon, ClockIcon, ShieldIcon, InfoIcon,
} from '../icons.jsx';

const KIND_ICON = {
  checkin: CheckCircleIcon,
  reminder: ClockIcon,
  kinship: HeartIcon,
  escalation: ShieldIcon,
  family: PeopleIcon,
  info: InfoIcon,
};

export function Layout({ children }) {
  const { t, unread, refreshUnread, lang } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [items, setItems] = useState([]);
  const nav = useNavigate();

  const openNotifs = async () => {
    setNotifOpen(true);
    try {
      const d = await api('/notifications');
      setItems(d.notifications);
      await api('/notifications/read-all', { method: 'POST' });
      refreshUnread();
    } catch {
      /* تجاهل */
    }
  };

  const tabs = [
    { to: '/', label: t.home, icon: HomeIcon, end: true },
    { to: '/kinship', label: t.kinship, icon: HeartIcon },
    { to: '/family', label: t.family, icon: PeopleIcon },
    { to: '/reminders', label: t.reminders, icon: CalendarIcon },
    { to: '/settings', label: t.settings, icon: SettingsIcon },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <WesalMark size={40} />
          <div>
            {t.appName}
            <small>{t.appTag}</small>
          </div>
        </div>
        <button className="icon-btn" onClick={openNotifs} aria-label={t.notifications}>
          <BellIcon />
          {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </header>

      {children}

      <nav className="bottomnav">
        <div className="inner">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `navitem ${isActive ? 'active' : ''}`}>
              <Icon size={23} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Sheet open={notifOpen} onClose={() => setNotifOpen(false)} title={t.notifications}>
        {items.length === 0 ? (
          <Empty icon={<BellIcon size={40} />} text={lang === 'ar' ? 'لا إشعارات بعد' : 'No notifications yet'} sub={lang === 'ar' ? 'رسالة صغيرة منك قد تسعد شخصًا تحبه.' : 'A small message can brighten someone’s day.'} />
        ) : (
          items.map((n) => {
            const Icon = KIND_ICON[n.kind] || InfoIcon;
            return (
              <div
                key={n.id}
                className="list-item clickable"
                onClick={() => {
                  setNotifOpen(false);
                  if (n.action) nav(n.action);
                }}
              >
                <div className="avatar sm"><Icon size={19} /></div>
                <div className="grow">
                  <div className="name" style={{ fontSize: 15 }}>{n.title}</div>
                  {n.body && <div className="meta">{n.body}</div>}
                  <div className="meta" style={{ fontSize: 12, marginTop: 2 }}>{fmtRelative(n.created_at + (n.created_at.endsWith('Z') ? '' : 'Z'), lang)}</div>
                </div>
              </div>
            );
          })
        )}
      </Sheet>
    </div>
  );
}
