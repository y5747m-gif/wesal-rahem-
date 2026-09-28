import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { fmtRelative } from '../i18n.js';
import { Avatar, StatusChip, Sheet, Empty } from '../components/ui.jsx';
import { PeopleIcon, LinkIcon, PlusIcon, TrashIcon } from '../icons.jsx';

export default function Family() {
  const { t, lang, showToast, user } = useApp();
  const [members, setMembers] = useState(null);
  const [myCode, setMyCode] = useState('');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [relation, setRelation] = useState('');

  const load = useCallback(async () => {
    const d = await api('/family');
    setMembers(d.members);
    setMyCode(d.myLinkCode);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const link = async () => {
    try {
      await api('/family/link', { method: 'POST', body: { code, relation } });
      setOpen(false);
      setCode('');
      setRelation('');
      showToast(lang === 'ar' ? 'تم الربط، أصبحتما عائلة واحدة في وصال' : 'Linked successfully');
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const unlink = async (m) => {
    if (!window.confirm(lang === 'ar' ? `فك الارتباط بـ ${m.name}؟` : `Unlink ${m.name}?`)) return;
    await api(`/family/${m.linkId}`, { method: 'DELETE' });
    load();
  };

  const effectiveStatus = (m) => {
    if (m.status === 'unshared') return 'unshared';
    if (m.status === 'awaiting') return 'awaiting';
    if (!m.lastCheckinAt || Date.now() - new Date(m.lastCheckinAt) > 2 * 86400000) return 'notconfirmed';
    return 'ok';
  };

  return (
    <main className="page">
      <div className="section-title" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 22 }}>{lang === 'ar' ? 'لوحة حالة العائلة' : 'Family board'}</span>
      </div>
      <p style={{ color: 'var(--text-2)', margin: '0 2px 16px', fontSize: 14.5 }}>
        {lang === 'ar'
          ? 'أفراد عائلتك الذين يشاركونك الاطمئنان — برضاهم الكامل.'
          : 'Family members who chose to share their reassurance with you.'}
      </p>

      {/* رمز الربط الخاص بي */}
      <div className="card" style={{ background: 'var(--surface-2)', textAlign: 'center' }}>
        <div className="sub" style={{ marginBottom: 6 }}>
          {lang === 'ar' ? 'رمز الربط الخاص بك — شاركه مع من تحب ليرتبط بك' : 'Your link code — share it with family'}
        </div>
        <div
          style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: 'var(--primary)', cursor: 'pointer', direction: 'ltr' }}
          onClick={() => { navigator.clipboard?.writeText(myCode); showToast(lang === 'ar' ? 'نُسخ الرمز' : 'Copied'); }}
          title={lang === 'ar' ? 'اضغط للنسخ' : 'Click to copy'}
        >
          {myCode || '·····'}
        </div>
      </div>

      {members !== null && members.length === 0 && (
        <Empty
          icon={<PeopleIcon size={44} />}
          text={lang === 'ar' ? 'لا أفراد مرتبطين بعد' : 'No linked members yet'}
          sub={lang === 'ar' ? 'اطلب من أهلك رمزهم أو شارك رمزك معهم.' : ''}
        />
      )}

      {(members || []).map((m) => (
        <div key={m.linkId} className="list-item">
          <Avatar name={m.name} src={m.avatar} />
          <div className="grow">
            <div className="name">{m.name}{m.relation && <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-3)' }}> · {m.relation}</span>}</div>
            <div className="meta">
              {m.lastCheckinAt
                ? `${t.lastConfirm}: ${fmtRelative(m.lastCheckinAt, lang)}`
                : lang === 'ar' ? 'لا معلومات حديثة' : 'No recent info'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <StatusChip status={effectiveStatus(m)} t={t} />
            <button className="more" style={{ background: 'none', border: 0, color: 'var(--text-3)', fontSize: 12, cursor: 'pointer' }} onClick={() => unlink(m)}>
              {lang === 'ar' ? 'فك الارتباط' : 'Unlink'}
            </button>
          </div>
        </div>
      ))}

      <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        <LinkIcon size={20} /> {lang === 'ar' ? 'اربط فردًا من العائلة' : 'Link a family member'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={lang === 'ar' ? 'ربط فرد من العائلة' : 'Link family member'}>
        <p className="sub" style={{ marginBottom: 14 }}>
          {lang === 'ar'
            ? 'اطلب من قريبك فتح صفحة "العائلة" في تطبيقه ومشاركة رمزه معك.'
            : 'Ask your relative to share their code from the Family page.'}
        </p>
        <div className="field">
          <label>{lang === 'ar' ? 'رمز الربط' : 'Link code'}</label>
          <input className="input" dir="ltr" style={{ textAlign: 'center', letterSpacing: 4, fontWeight: 700 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="WESAL2" />
        </div>
        <div className="field">
          <label>{lang === 'ar' ? 'صلة القرابة (اختياري)' : 'Relation (optional)'}</label>
          <input className="input" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder={lang === 'ar' ? 'أخي، أمي، صديقي...' : ''} />
        </div>
        <button className="btn btn-primary btn-block" onClick={link} disabled={code.length < 4}>
          <PlusIcon size={19} /> {lang === 'ar' ? 'ربط' : 'Link'}
        </button>
      </Sheet>
    </main>
  );
}
