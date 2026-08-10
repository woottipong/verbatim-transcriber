import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { getToastCopy, type ToastLocale, type ToastTone } from '../lib/toastCopy';

export interface ToastNotice {
  id: string;
  message: string;
  title?: string;
  tone: ToastTone;
  duration?: number;
  onDismiss?: () => void;
}

interface ToastViewportProps {
  notices: Array<ToastNotice | null | false | undefined>;
  locale?: ToastLocale;
}

const toneIcons = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

function ToastItem({ notice, locale }: { notice: ToastNotice; locale: ToastLocale }) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(notice.onDismiss);
  const presentation = getToastCopy(notice.tone, locale);
  const Icon = toneIcons[notice.tone];

  onDismissRef.current = notice.onDismiss;

  useEffect(() => {
    const duration = notice.duration ?? (notice.tone === 'error' ? 8000 : 4200);
    if (duration <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current?.();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [notice.duration, notice.id, notice.tone]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    onDismissRef.current?.();
  };

  return (
    <div
      className={`app-toast app-toast--${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <Icon className="app-toast__icon" size={18} aria-hidden="true" />
      <div className="app-toast__content">
        <p className="app-toast__title">{notice.title ?? presentation.title}</p>
        <p className="app-toast__message">{notice.message}</p>
      </div>
      <button type="button" className="app-toast__dismiss" onClick={dismiss} aria-label={presentation.dismissLabel}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ToastViewport({ notices, locale = 'en' }: ToastViewportProps) {
  const visibleNotices = notices.filter((notice): notice is ToastNotice => Boolean(notice));
  if (visibleNotices.length === 0) return null;

  return (
    <div className="app-toast-viewport" role="region" aria-label={getToastCopy('info', locale).regionLabel}>
      {visibleNotices.map(notice => (
        <div key={notice.id}>
          <ToastItem notice={notice} locale={locale} />
        </div>
      ))}
    </div>
  );
}
