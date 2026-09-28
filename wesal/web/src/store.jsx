import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, getToken, setToken } from './api.js';
import { STRINGS } from './i18n.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [booted, setBooted] = useState(false);
  const [toast, setToastMsg] = useState(null);
  const [unread, setUnread] = useState(0);
  const toastTimer = useRef(null);

  const lang = settings?.language || 'ar';
  const t = STRINGS[lang] || STRINGS.ar;
  const theme = settings?.theme || 'light';

  useEffect(() => {
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('dir', t.dir);
    document.documentElement.setAttribute('lang', lang);
  }, [theme, lang, t.dir]);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const refreshMe = useCallback(async () => {
    const data = await api('/auth/me', { silent: true });
    setUser(data.user);
    setSettings(data.settings);
    setSchedule(data.schedule);
    return data;
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const d = await api('/notifications', { silent: true });
      setUnread(d.unread);
    } catch {
      /* تجاهل */
    }
  }, []);

  // الإقلاع
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          await refreshMe();
          await refreshUnread();
        } catch {
          setToken(null);
        }
      }
      setBooted(true);
    })();
    const onLogout = () => {
      setUser(null);
      setSettings(null);
    };
    window.addEventListener('wesal:logout', onLogout);
    return () => window.removeEventListener('wesal:logout', onLogout);
  }, [refreshMe, refreshUnread]);

  // فحص الإشعارات دوريًا (كل 25 ثانية)
  useEffect(() => {
    if (!user) return;
    const iv = setInterval(refreshUnread, 25000);
    return () => clearInterval(iv);
  }, [user, refreshUnread]);

  const login = useCallback(
    async (email, password) => {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      await refreshMe();
      await refreshUnread();
      return d.user;
    },
    [refreshMe, refreshUnread]
  );

  const register = useCallback(
    async (payload) => {
      const d = await api('/auth/register', { method: 'POST', body: payload });
      setToken(d.token);
      await refreshMe();
      return d.user;
    },
    [refreshMe]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setSettings(null);
    setSchedule(null);
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const d = await api('/settings', { method: 'PATCH', body: patch });
    setSettings(d.settings);
    return d.settings;
  }, []);

  return (
    <Ctx.Provider
      value={{
        user, setUser, settings, schedule, setSchedule, booted, lang, t,
        login, register, logout, refreshMe, updateSettings,
        toast, showToast, unread, refreshUnread,
      }}
    >
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
