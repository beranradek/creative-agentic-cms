import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string | undefined;
}

interface PushToastInput {
  kind: ToastKind;
  title: string;
  message?: string | undefined;
  ttlMs?: number;
}

interface ToastContextValue {
  push: (toast: PushToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function createToastId(): string {
  return `toast_${crypto.randomUUID()}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: PushToastInput) => {
      const id = createToastId();
      const toast: Toast = { id, kind: input.kind, title: input.title, message: input.message };
      setToasts((prev) => {
        const next = [toast, ...prev];
        const trimmed = next.slice(0, 5);
        const removed = next.slice(5);
        for (const r of removed) {
          const timer = timersRef.current.get(r.id);
          if (timer !== undefined) window.clearTimeout(timer);
          timersRef.current.delete(r.id);
        }
        return trimmed;
      });

      const ttlMs = input.ttlMs ?? 4500;
      const timer = window.setTimeout(() => remove(id), ttlMs);
      timersRef.current.set(id, timer);
    },
    [remove]
  );

  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toastRegion" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <div className="toastHeader">
              <div className="toastTitle">{t.title}</div>
              <button type="button" className="toastClose" onClick={() => remove(t.id)} aria-label="Dismiss">
                ×
              </button>
            </div>
            {t.message ? <div className="toastMessage">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider />");

  return useMemo(() => {
    return {
      info: (title: string, message?: string) => ctx.push({ kind: "info", title, message }),
      success: (title: string, message?: string) => ctx.push({ kind: "success", title, message }),
      error: (title: string, message?: string) => ctx.push({ kind: "error", title, message, ttlMs: 7000 }),
    };
  }, [ctx]);
}
