import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  /** While true (e.g. waiting for M-Pesa) Esc and tapping outside do nothing, so a payment is never abandoned by accident. */
  locked?: boolean;
  /** Pinned under the scrolling content so the main button stays reachable on small phones. */
  footer?: ReactNode;
  /** Spoken politely to screen readers when it changes (results, errors). */
  liveMessage?: string;
  children: ReactNode;
}

/** Shared shell for every money sheet (design D15, D17): dialog semantics, focus, Esc, live region. */
export function MoneySheet({ title, eyebrow, onClose, locked, footer, liveMessage, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = ref.current?.querySelector<HTMLElement>("input, button, [tabindex]");
    first?.focus();
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>("button, input, select, a[href], [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  // Rendered on document.body: a transformed ancestor (the page's fade-up animation) would otherwise
  // become the containing block of `fixed` and push the sheet and its button off the screen.
  const node = (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex: 1000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
      onClick={() => { if (!locked) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-gold w-full max-w-[430px] rounded-t-3xl anim-fade-up flex flex-col"
        style={{ maxHeight: "92vh", background: "linear-gradient(180deg, #1c1709 0%, #110e06 100%)", border: "1px solid rgba(212,175,55,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-3">
          <div>
            {eyebrow && <p className="t-label">{eyebrow}</p>}
            <h2 className="t-display t-gold mt-1" style={{ fontSize: 18 }}>{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={locked}
            aria-label="Close"
            className="t-gold tap44 flex items-center justify-center"
            style={{ fontSize: 24, opacity: locked ? 0.35 : 1 }}
          >
            ×
          </button>
        </div>
        <div className="px-6 overflow-y-auto" style={{ flex: "1 1 auto" }}>{children}</div>
        {footer && <div className="px-6 pt-3" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>{footer}</div>}
        <div role="status" aria-live="polite" className="sr-only">{liveMessage}</div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}
