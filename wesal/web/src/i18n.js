// النصوص — العربية أولًا مع دعم الإنجليزية
export const STRINGS = {
  ar: {
    dir: 'rtl',
    appName: 'وصال',
    appTag: 'صلة الرحم',
    slogan: 'وصال... لأن من نحب يستحق أن نطمئن عليه.',
    goodMorning: 'صباح الخير',
    goodEvening: 'مساء الخير',
    reassure: 'طمّن أهلك عليك',
    imOk: 'أنا بخير',
    remindLater: 'تذكيري لاحقًا',
    lastConfirm: 'آخر تأكيد',
    noConfirmYet: 'لم تؤكد حالتك بعد',
    statusOk: 'أكد أنه بخير',
    statusAwaiting: 'بانتظار التأكيد',
    statusNotConfirmed: 'لم يتم التأكيد',
    statusUnshared: 'لا يشارك حالته',
    checkinTime: 'حان وقت الاطمئنان عليك',
    home: 'الرئيسية',
    kinship: 'صلة الرحم',
    family: 'العائلة',
    reminders: 'التذكيرات',
    settings: 'الإعدادات',
    history: 'سجل التواصل',
    trustedContacts: 'جهات الاتصال الموثوقة',
    checkinSchedule: 'جدول الاطمئنان',
    notifications: 'الإشعارات',
    contactNow: 'تواصل الآن',
    call: 'اتصال',
    message: 'رسالة',
    whatsapp: 'واتساب',
    visit: 'زيارة',
    other: 'أخرى',
    logContact: 'سجّل تواصلًا',
    upcoming: 'مواعيد التواصل القادمة',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة',
    daily: 'يوميًا',
    every2: 'كل يومين',
    every3: 'كل 3 أيام',
    weekly: 'أسبوعيًا',
    custom: 'مخصص',
  },
  en: {
    dir: 'ltr',
    appName: 'Wesal',
    appTag: 'Family Connection',
    slogan: 'Wesal… because the ones we love deserve our care.',
    goodMorning: 'Good morning',
    goodEvening: 'Good evening',
    reassure: 'Let your family know you are okay',
    imOk: "I'm okay",
    remindLater: 'Remind me later',
    lastConfirm: 'Last confirmation',
    noConfirmYet: 'No confirmation yet',
    statusOk: 'Confirmed okay',
    statusAwaiting: 'Awaiting confirmation',
    statusNotConfirmed: 'Not confirmed',
    statusUnshared: 'Status not shared',
    checkinTime: 'Time to check in',
    home: 'Home',
    kinship: 'Kinship',
    family: 'Family',
    reminders: 'Reminders',
    settings: 'Settings',
    history: 'Contact history',
    trustedContacts: 'Trusted contacts',
    checkinSchedule: 'Check-in schedule',
    notifications: 'Notifications',
    contactNow: 'Reach out now',
    call: 'Call',
    message: 'Message',
    whatsapp: 'WhatsApp',
    visit: 'Visit',
    other: 'Other',
    logContact: 'Log a contact',
    upcoming: 'Upcoming connections',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    daily: 'Daily',
    every2: 'Every 2 days',
    every3: 'Every 3 days',
    weekly: 'Weekly',
    custom: 'Custom',
  },
};

// تنسيق التاريخ والوقت بالعربية بأرقام لاتينية (8:42 م)
export function fmtTime(iso, lang = 'ar') {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDate(iso, lang = 'ar') {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "اليوم 8:42 م" / "أمس" / "منذ 3 أيام" */
export function fmtRelative(iso, lang = 'ar') {
  if (!iso) return lang === 'ar' ? '—' : '—';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const t = fmtTime(iso, lang);
  if (lang === 'ar') {
    if (diffDays <= 0) return `اليوم ${t}`;
    if (diffDays === 1) return `أمس ${t}`;
    if (diffDays === 2) return `منذ يومين`;
    if (diffDays <= 10) return `منذ ${diffDays} أيام`;
    return `منذ ${diffDays} يومًا`;
  }
  if (diffDays <= 0) return `Today ${t}`;
  if (diffDays === 1) return `Yesterday ${t}`;
  return `${diffDays} days ago`;
}

export function daysAgoText(days, lang = 'ar') {
  if (days === null || days === undefined) return lang === 'ar' ? 'لم يُسجَّل تواصل بعد' : 'No contact logged yet';
  if (lang === 'ar') {
    if (days === 0) return 'تواصلت معه اليوم';
    if (days === 1) return 'آخر تواصل أمس';
    if (days === 2) return 'آخر تواصل منذ يومين';
    if (days <= 10) return `آخر تواصل منذ ${days} أيام`;
    return `آخر تواصل منذ ${days} يومًا`;
  }
  if (days === 0) return 'Contacted today';
  if (days === 1) return 'Last contact yesterday';
  return `Last contact ${days} days ago`;
}
