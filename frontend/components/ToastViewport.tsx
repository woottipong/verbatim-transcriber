import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

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
}

const tonePresentation = {
  success: { icon: CheckCircle2, title: 'Completed' },
  error: { icon: CircleAlert, title: 'Something went wrong' },
  warning: { icon: TriangleAlert, title: 'Attention needed' },
  info: { icon: Info, title: 'Notice' },
} as const;

function ToastItem({ notice }: { notice: ToastNotice }) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(notice.onDismiss);
  const presentation = tonePresentation[notice.tone];
  const Icon = presentation.icon;

  onDismissRef.current = notice.onDismiss;

  useEffect(() => {
    setVisible(true);
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
      <button type="button" className="app-toast__dismiss" onClick={dismiss} aria-label="Dismiss notification">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ToastViewport({ notices }: ToastViewportProps) {
  const visibleNotices = notices.filter((notice): notice is ToastNotice => Boolean(notice));
  if (visibleNotices.length === 0) return null;

  return (
    <div className="app-toast-viewport" aria-label="Notifications">
      {visibleNotices.map(notice => (
        <div key={notice.id}>
          <ToastItem notice={notice} />
        </div>
      ))}
    </div>
  );
}
