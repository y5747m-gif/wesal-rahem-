import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './store.jsx';
import { Layout } from './components/Layout.jsx';
import Onboarding from './pages/Onboarding.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Kinship, { RelativeDetail } from './pages/Kinship.jsx';
import History from './pages/History.jsx';
import Reminders from './pages/Reminders.jsx';
import Family from './pages/Family.jsx';
import TrustedContacts from './pages/TrustedContacts.jsx';
import Schedule from './pages/Schedule.jsx';
import Settings from './pages/Settings.jsx';
import { Account, Security, Privacy } from './pages/SettingsSub.jsx';
import Admin from './pages/Admin.jsx';
import './styles.css';

function Protected({ children }) {
  const { user, booted } = useApp();
  const loc = useLocation();
  if (!booted) return null;
  if (!user) {
    const onboarded = localStorage.getItem('wesal_onboarded');
    return <Navigate to={onboarded ? '/login' : '/welcome'} state={{ from: loc }} replace />;
  }
  return <Layout>{children}</Layout>;
}

function PublicOnly({ children }) {
  const { user, booted } = useApp();
  if (!booted) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<PublicOnly><Onboarding /></PublicOnly>} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/kinship" element={<Protected><Kinship /></Protected>} />
      <Route path="/kinship/:id" element={<Protected><RelativeDetail /></Protected>} />
      <Route path="/history" element={<Protected><History /></Protected>} />
      <Route path="/reminders" element={<Protected><Reminders /></Protected>} />
      <Route path="/family" element={<Protected><Family /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/settings/schedule" element={<Protected><Schedule /></Protected>} />
      <Route path="/settings/contacts" element={<Protected><TrustedContacts /></Protected>} />
      <Route path="/settings/account" element={<Protected><Account /></Protected>} />
      <Route path="/settings/security" element={<Protected><Security /></Protected>} />
      <Route path="/settings/privacy" element={<Protected><Privacy /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>
);
