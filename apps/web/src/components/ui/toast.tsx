import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error';
export interface ToastAction {
  label: string;
  href: string;
}
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction | undefined;
}
interface ToastApi {
  success: (message: string, action?: ToastAction) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback(
    (kind: ToastKind, message: string, action?: ToastAction) => {
      const id = nextId++;
      setItems((current) => [...current, { id, kind, message, action }]);
      setTimeout(
        () => setItems((current) => current.filter((item) => item.id !== id)),
        action ? 12000 : 5000,
      );
    },
    [],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (m, action) => push('success', m, action),
      error: (m) => push('error', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'rounded-md border border-border px-4 py-2 text-sm shadow-md',
              item.kind === 'success'
                ? 'bg-success text-success-foreground'
                : 'bg-destructive text-destructive-foreground',
            )}
          >
            {item.message}
            {item.action ? (
              <a
                href={item.action.href}
                target="_blank"
                rel="noreferrer"
                className="ml-2 font-medium underline"
              >
                {item.action.label}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
