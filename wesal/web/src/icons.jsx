// أيقونات SVG احترافية متناسقة (خط 1.8، حواف دائرية) — بدون اعتماد على إيموجي
import React from 'react';

const I = ({ children, size = 22, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const HeartIcon = (p) => (
  <I {...p}><path d="M12 20.5C10.5 19.3 4 14.6 4 9.7 4 7 6 5 8.4 5c1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2C18 5 20 7 20 9.7c0 4.9-6.5 9.6-8 10.8z" /></I>
);
export const HeartFilledIcon = (p) => (
  <I {...p}><path d="M12 20.5C10.5 19.3 4 14.6 4 9.7 4 7 6 5 8.4 5c1.5 0 2.8.8 3.6 2 .8-1.2 2.1-2 3.6-2C18 5 20 7 20 9.7c0 4.9-6.5 9.6-8 10.8z" fill="currentColor" stroke="none" /></I>
);
export const HomeIcon = (p) => (
  <I {...p}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></I>
);
export const PeopleIcon = (p) => (
  <I {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" /><path d="M17.5 14.6c1.7.8 2.7 2.3 3 4.4" /></I>
);
export const TimelineIcon = (p) => (
  <I {...p}><path d="M12 8v4l2.5 2.5" /><circle cx="12" cy="12" r="8.5" /></I>
);
export const BellIcon = (p) => (
  <I {...p}><path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10 19a2.2 2.2 0 0 0 4 0" /></I>
);
export const SettingsIcon = (p) => (
  <I {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.4a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V19.5a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H4.5a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 6.15 7.34a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V4.5a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.26.63.88 1.03 1.56 1.03h.09a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.56 1.03z" /></I>
);
export const PhoneIcon = (p) => (
  <I {...p}><path d="M20 16.5v2.6a1.9 1.9 0 0 1-2.1 1.9c-3.2-.35-6.2-1.7-8.6-3.8a18.4 18.4 0 0 1-5.4-8.6A1.9 1.9 0 0 1 5.8 6.5h2.6a1.9 1.9 0 0 1 1.9 1.6c.12.9.35 1.8.67 2.6a1.9 1.9 0 0 1-.43 2L9.4 13.8a15 15 0 0 0 4.8 4.8l1.1-1.1a1.9 1.9 0 0 1 2-.43c.84.32 1.72.55 2.62.67a1.9 1.9 0 0 1 1.63 1.95z" transform="translate(24 0) scale(-1 1)" /></I>
);
export const MessageIcon = (p) => (
  <I {...p}><path d="M20 14.5a2 2 0 0 1-2 2H8l-4 4v-14a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></I>
);
export const WhatsAppIcon = (p) => (
  <I {...p}><path d="M12 3.5a8.4 8.4 0 0 0-7.3 12.7L3.5 20.5l4.4-1.2A8.5 8.5 0 1 0 12 3.5z" /><path d="M9.2 8.7c-.3.1-.8.5-.8 1.4 0 2.1 3.3 5.3 5.6 5.5.9 0 1.4-.5 1.5-.9l.2-.8-2-.9-.8.8c-1-.4-2.3-1.6-2.7-2.6l.8-.8-.9-2z" strokeWidth="1.4" /></I>
);
export const PlusIcon = (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const CheckIcon = (p) => <I {...p}><path d="m4.5 12.5 5 5L19.5 7" /></I>;
export const CheckCircleIcon = (p) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.8-5" /></I>
);
export const ClockIcon = (p) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>
);
export const CalendarIcon = (p) => (
  <I {...p}><rect x="4" y="5.5" width="16" height="15" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10.5h16" /></I>
);
export const ShieldIcon = (p) => (
  <I {...p}><path d="M12 3.5 5 6.2v5.3c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6.2z" /><path d="m9 11.8 2.2 2.2 3.8-4" /></I>
);
export const LockIcon = (p) => (
  <I {...p}><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" /><path d="M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3" /></I>
);
export const EyeOffIcon = (p) => (
  <I {...p}><path d="M4 4.5 20 20" /><path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4 9.5 7-.36 1.1-1.1 2.4-2.2 3.6M6.6 6.9C4.6 8.2 3.2 10.2 2.5 12c1 3 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1" /><path d="M9.6 9.8a3.2 3.2 0 0 0 4.5 4.5" /></I>
);
export const MoonIcon = (p) => (
  <I {...p}><path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z" /></I>
);
export const SunIcon = (p) => (
  <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></I>
);
export const UserIcon = (p) => (
  <I {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.5 3.5-5.4 7-5.4s6.2 1.9 7 5.4" /></I>
);
export const LogoutIcon = (p) => (
  <I {...p}><path d="M15 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h8" /><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5" /></I>
);
export const TrashIcon = (p) => (
  <I {...p}><path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" /><path d="M6.5 7l.8 11.4A2 2 0 0 0 9.3 20.5h5.4a2 2 0 0 0 2-2.1L17.5 7" /></I>
);
export const EditIcon = (p) => (
  <I {...p}><path d="M14.5 5.5 18.5 9.5 9 19l-4.5 1L5.5 15z" /><path d="m12.5 7.5 4 4" /></I>
);
export const ChevronIcon = (p) => <I {...p}><path d="m14.5 6.5-5.5 5.5 5.5 5.5" /></I>;
export const UpIcon = (p) => <I {...p}><path d="m6.5 14.5 5.5-5.5 5.5 5.5" /></I>;
export const DownIcon = (p) => <I {...p}><path d="m6.5 9.5 5.5 5.5 5.5-5.5" /></I>;
export const DownloadIcon = (p) => (
  <I {...p}><path d="M12 4v11M7.5 11.5 12 16l4.5-4.5" /><path d="M5 19.5h14" /></I>
);
export const LinkIcon = (p) => (
  <I {...p}><path d="M10 14a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.5 6.5" /><path d="M14 10a4.5 4.5 0 0 0-6.4-.4L5 12.2a4.5 4.5 0 0 0 6.4 6.4l1.1-1.1" /></I>
);
export const StarIcon = (p) => (
  <I {...p}><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.3 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z" /></I>
);
export const SendIcon = (p) => (
  <I {...p}><path d="M20 4 4 10.5l6 2.5 2.5 6z" /><path d="M20 4 10 13" /></I>
);
export const InfoIcon = (p) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.2" /></I>
);
export const WesalMark = ({ size = 42 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="17" fill="var(--primary)" />
    <path
      d="M32 46c-1 0-9.5-6.2-13.2-11.4C15.6 30.2 16.4 24 21.5 22c3.6-1.4 7.3.2 10.5 4.2C35.2 22.2 38.9 20.6 42.5 22c5.1 2 5.9 8.2 2.7 12.6C41.5 39.8 33 46 32 46z"
      fill="var(--primary-contrast)"
    />
    <circle cx="47" cy="18" r="4" fill="var(--gold)" />
  </svg>
);
