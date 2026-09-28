import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { WesalMark } from '../icons.jsx';

export function Login() {
  const { login, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const user = await login(email, password);
      showToast(`أهلًا بعودتك يا ${user.name.split(' ')[0]}`);
      nav(user.role === 'admin' ? '/admin' : '/');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-head">
        <div style={{ marginBottom: 14 }}><WesalMark size={70} /></div>
        <h1>وصال</h1>
        <p>لأن من نحب يستحق أن نطمئن عليه.</p>
      </div>
      {err && <div className="error-msg">{err}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input className="input" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '...' : 'تسجيل الدخول'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--text-2)' }}>
        ليس لديك حساب؟ <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 700 }}>أنشئ حسابك</Link>
      </p>
      <div className="card" style={{ marginTop: 26, background: 'var(--surface-2)' }}>
        <div className="sub" style={{ fontSize: 13.5 }}>
          <b>حساب تجريبي:</b> demo@wesal.app · Demo@1234
          <br />
          <b>الإدارة:</b> admin@wesal.app · Admin@Wesal2026
        </div>
      </div>
    </div>
  );
}

export function Register() {
  const { register, showToast } = useApp();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await register(form);
      showToast('أهلًا بك في وصال');
      nav('/');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-head">
        <div style={{ marginBottom: 14 }}><WesalMark size={70} /></div>
        <h1>حساب جديد</h1>
        <p>دقيقة واحدة تفصلك عن الاطمئنان الدائم.</p>
      </div>
      {err && <div className="error-msg">{err}</div>}
      <form onSubmit={submit}>
        <div className="field">
          <label>الاسم</label>
          <input className="input" value={form.name} onChange={set('name')} required placeholder="اسمك كما يعرفه أهلك" />
        </div>
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input className="input" type="email" dir="ltr" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label>رقم الهاتف (اختياري)</label>
          <input className="input" type="tel" dir="ltr" value={form.phone} onChange={set('phone')} placeholder="+20 ..." />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input className="input" type="password" dir="ltr" value={form.password} onChange={set('password')} required minLength={8} />
          <div className="hint">8 أحرف على الأقل</div>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '...' : 'إنشاء الحساب'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--text-2)' }}>
        لديك حساب؟ <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 700 }}>سجّل الدخول</Link>
      </p>
    </div>
  );
}
