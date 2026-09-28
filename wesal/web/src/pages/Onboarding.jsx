import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WesalMark, HeartFilledIcon, PeopleIcon, ShieldIcon } from '../icons.jsx';

const SLIDES = [
  {
    big: 'وصال',
    text: 'لأن السؤال عن من نحب لا يحتاج سببًا.',
    icon: <WesalMark size={110} />,
  },
  {
    big: 'طمن أهلك عليك',
    text: 'ضغطة واحدة كل يوم تُخبر من يحبك أنك بخير.',
    icon: <div style={{ color: 'var(--primary)' }}><HeartFilledIcon size={96} /></div>,
  },
  {
    big: 'وحافظ على صلة الرحم',
    text: 'تذكيرات لطيفة بالتواصل مع أهلك وأحبابك، قبل أن تطول الغيبة.',
    icon: <div style={{ color: 'var(--primary)' }}><PeopleIcon size={96} /></div>,
  },
  {
    big: 'اطمئنان يحترم خصوصيتك',
    text: 'أنشئ نظام الاطمئنان المناسب لك ولعائلتك. لا مراقبة، لا تتبع — أنت من يقرر كل شيء.',
    icon: <div style={{ color: 'var(--primary)' }}><ShieldIcon size={96} /></div>,
  },
];

export default function Onboarding({ onDone }) {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;

  const finish = () => {
    localStorage.setItem('wesal_onboarded', '1');
    if (onDone) onDone();
    else nav('/register');
  };

  return (
    <div className="onboard">
      <div className="mark" key={i}>{s.icon}</div>
      {i === 0 ? <h1>{s.big}</h1> : <h2>{s.big}</h2>}
      <div className="gold-line" />
      <p>{s.text}</p>
      <div className="dots">
        {SLIDES.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 340 }}>
        {!last && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={finish}>تخطي</button>
        )}
        <button
          className="btn btn-primary"
          style={{ flex: 2 }}
          onClick={() => (last ? finish() : setI(i + 1))}
        >
          {last ? 'ابدأ الآن' : 'التالي'}
        </button>
      </div>
    </div>
  );
}
