/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Modal } from './Modal';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

interface FeedbackContextValue {
  toast: (message: ReactNode, tone?: ToastTone, action?: ToastItem['action']) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
};

/** Toasts de retorno e diálogo de confirmação próprio (substitui window.confirm). */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(previous => previous.filter(item => item.id !== id));
  }, []);

  const schedule = useCallback((id: number, ms: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
  }, [dismiss]);

  const toast = useCallback<FeedbackContextValue['toast']>((message, tone = 'success', action) => {
    const id = nextId.current++;
    setToasts(previous => [...previous.slice(-3), { id, message, tone, action }]);
    schedule(id, action ? 8000 : 4200);
  }, [schedule]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setPending({ ...options, resolve });
  }), []);

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map(item => (
          // Com o mouse em cima a notificação não some: dá tempo de ler e clicar na ação.
          <div key={item.id} className={`toast toast-${item.tone}`}
            onMouseEnter={() => window.clearTimeout(timers.current.get(item.id))}
            onMouseLeave={() => schedule(item.id, item.action ? 4000 : 2000)}>
            <span className="toast-icon">{TOAST_ICONS[item.tone]}</span>
            <div className="toast-body">
              <span className="toast-message">{item.message}</span>
              {item.action ? (
                <button type="button" className="toast-action" onClick={() => { item.action?.onClick(); dismiss(item.id); }}>{item.action.label}</button>
              ) : null}
            </div>
            <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="Fechar"><X size={14} /></button>
          </div>
        ))}
      </div>
      {pending ? (
        <Modal
          size="sm"
          title={pending.title}
          icon={pending.tone === 'danger' ? <AlertTriangle size={20} /> : <Info size={20} />}
          onClose={() => close(false)}
          footer={(
            <>
              <button type="button" className="secondary-button" onClick={() => close(false)}>{pending.cancelLabel || 'Cancelar'}</button>
              <button type="button" className={pending.tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={() => close(true)} autoFocus>
                {pending.confirmLabel || 'Confirmar'}
              </button>
            </>
          )}
        >
          <div className="confirm-message">{pending.message}</div>
        </Modal>
      ) : null}
    </FeedbackContext.Provider>
  );
}

export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used within FeedbackProvider');
  return context;
};
