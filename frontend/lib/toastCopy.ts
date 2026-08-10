export type ToastTone = 'success' | 'error' | 'warning' | 'info';
export type ToastLocale = 'en' | 'th';

interface ToastCopy {
  title: string;
  dismissLabel: string;
  regionLabel: string;
}

const TOAST_COPY: Record<ToastLocale, Record<ToastTone, ToastCopy>> = {
  en: {
    success: { title: 'Completed', dismissLabel: 'Dismiss notification', regionLabel: 'Notifications' },
    error: { title: 'Something went wrong', dismissLabel: 'Dismiss notification', regionLabel: 'Notifications' },
    warning: { title: 'Attention needed', dismissLabel: 'Dismiss notification', regionLabel: 'Notifications' },
    info: { title: 'Notice', dismissLabel: 'Dismiss notification', regionLabel: 'Notifications' },
  },
  th: {
    success: { title: 'ดำเนินการแล้ว', dismissLabel: 'ปิดการแจ้งเตือน', regionLabel: 'การแจ้งเตือน' },
    error: { title: 'เกิดข้อผิดพลาด', dismissLabel: 'ปิดการแจ้งเตือน', regionLabel: 'การแจ้งเตือน' },
    warning: { title: 'ควรตรวจสอบ', dismissLabel: 'ปิดการแจ้งเตือน', regionLabel: 'การแจ้งเตือน' },
    info: { title: 'แจ้งเตือน', dismissLabel: 'ปิดการแจ้งเตือน', regionLabel: 'การแจ้งเตือน' },
  },
};

export function getToastCopy(tone: ToastTone, locale: ToastLocale = 'en'): ToastCopy {
  return TOAST_COPY[locale][tone];
}
