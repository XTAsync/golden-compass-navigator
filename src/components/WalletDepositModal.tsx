import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MoneySheet } from "@/components/MoneySheet";
import { postMoney } from "@/lib/money-client";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  phone?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

type Phase =
  | { kind: "form" }
  | { kind: "waiting"; slow: boolean; received: boolean }
  | { kind: "confirmed"; receipt: string | null; balance: number | null }
  | { kind: "failed"; cancelled: boolean; reason: string };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

// M-Pesa top-up (design D7, D12): the sheet stays open and cannot be dismissed by a stray tap
// while waiting; there are explicit end states (still waiting, payment received and being checked,
// failed) and a success view with the receipt, the new balance and what to do next.
export function WalletDepositModal({ phone: savedPhone = "", onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState("100");
  const [phone, setPhone] = useState(savedPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const amt = amount === "" ? 0 : Number(amount);
  const phoneOk = /^(?:\+?254|0)?[71]\d{8}$/.test(phone.replace(/\s/g, ""));
  const canSend = !busy && amt >= 1 && phoneOk && phase.kind === "form";

  // One status check against our own API (the source of truth for the receipt). Returns true when the
  // sheet reached an end state. Called by the slow poll and by the realtime nudge.
  const checkOnce = async (transactionId: string, i: number): Promise<boolean> => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return false;
    try {
      const res = await fetch("/api/mpesa-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transaction_id: transactionId }),
      });
      const d = (await res.json()) as { status?: string; result_desc?: string; receipt?: string | null };
      if (!alive.current) return true;
      if (d.status === "confirmed") {
        let balance: number | null = null;
        const uid = sess.session?.user?.id;
        if (uid) {
          const { data } = await supabase.from("profiles").select("wallet_balance").eq("id", uid).maybeSingle();
          balance = data ? Number(data.wallet_balance ?? 0) : null;
        }
        setPhase({ kind: "confirmed", receipt: d.receipt ?? null, balance });
        onSuccess?.();
        return true;
      }
      if (d.status === "failed" || d.status === "cancelled") {
        setPhase({ kind: "failed", cancelled: d.status === "cancelled", reason: d.result_desc ?? "" });
        return true;
      }
      setPhase({ kind: "waiting", slow: i >= 14, received: /received/i.test(d.result_desc ?? "") });
    } catch {
      // keep waiting: a dropped request is not a failed payment
    }
    return false;
  };

  // Realtime tells us the moment our transaction row changes (E3); polling is the fallback, every 4 s
  // until the realtime channel is subscribed and every 12 s after, so a dead socket never strands the sheet.
  const poll = async (transactionId: string) => {
    setPhase({ kind: "waiting", slow: false, received: false });
    let live = false;
    let done = false;
    const channel = supabase
      .channel(`deposit-${transactionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${transactionId}` },
        () => { if (!done) void checkOnce(transactionId, 0).then((d) => { if (d) done = true; }); })
      .subscribe((st: string) => { live = st === "SUBSCRIBED"; });
    try {
      let elapsed = 0;
      for (let i = 0; i < 45 && alive.current && !done; i++) {
        const wait = live ? 12000 : 4000;
        await new Promise((r) => setTimeout(r, wait));
        elapsed += wait;
        if (!alive.current || done) return;
        if (await checkOnce(transactionId, Math.floor(elapsed / 4000))) { done = true; return; }
        if (elapsed >= 180000) break;
      }
      if (alive.current && !done) setPhase({ kind: "waiting", slow: true, received: false });
    } finally {
      void supabase.removeChannel(channel);
    }
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true); setError("");
    const r = await postMoney("/api/mpesa-stk", { amount: amt, phone, pool_id: null });
    setBusy(false);
    if (!r.ok || !r.data.transaction_id) {
      setError(String(r.data.error ?? "We couldn't start the payment. Try again."));
      return;
    }
    void poll(String(r.data.transaction_id));
  };

  const waiting = phase.kind === "waiting" && !phase.slow;

  if (phase.kind === "confirmed") {
    return (
      <MoneySheet title="Money received" eyebrow="M-PESA TOP-UP" onClose={onClose}
        liveMessage={`${kes(amt)} added to your wallet.`}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} className="glass rounded-[10px] t-gold tap44" style={{ fontSize: 14 }}>Done</button>
            <Link to="/pools" onClick={onClose} className="btn-brass tap44 flex items-center justify-center" style={{ fontSize: 14, textDecoration: "none" }}>Invest now</Link>
          </div>
        }>
        <p className="t-display t-gold" style={{ fontSize: 30 }}>{kes(amt)}</p>
        <p className="t-label mt-1">added to your wallet.</p>
        {phase.balance !== null && <p className="t-label mt-3">Wallet balance: {kes(phase.balance)}</p>}
        {phase.receipt && <p className="t-label mt-1">M-Pesa receipt: {phase.receipt}</p>}
      </MoneySheet>
    );
  }

  return (
    <MoneySheet title="M-Pesa top-up" eyebrow="DEPOSIT TO WALLET" onClose={onClose} locked={waiting || busy}
      liveMessage={error || (phase.kind === "waiting" ? "Waiting for M-Pesa" : phase.kind === "failed" ? "Payment did not go through" : "")}
      footer={
        phase.kind === "failed" ? (
          <button onClick={() => setPhase({ kind: "form" })} className="btn-brass w-full tap44" style={{ padding: "14px 16px", fontSize: 14 }}>Try again</button>
        ) : phase.kind === "waiting" ? (
          phase.slow ? <button onClick={onClose} className="btn-brass w-full tap44" style={{ padding: "14px 16px", fontSize: 14 }}>Close, we'll keep checking</button> : null
        ) : (
          <>
            {error && <p className="money-error mb-2" role="alert">{error}</p>}
            <button onClick={send} disabled={!canSend} className="btn-brass w-full tap44" style={{ padding: "14px 16px", fontSize: 14, opacity: canSend ? 1 : 0.5 }}>
              {busy ? "Sending…" : "Send M-Pesa request"}
            </button>
          </>
        )
      }>
      {phase.kind === "form" && (
        <>
          <label htmlFor="dep-amount" className="t-label block mb-1">Amount (whole shillings)</label>
          <input id="dep-amount" inputMode="numeric" autoComplete="off" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))}
            className="w-full glass rounded-lg px-3 py-3 t-display t-parch mb-3" style={{ fontSize: 20 }} />
          <label htmlFor="dep-phone" className="t-label block mb-1">M-Pesa phone</label>
          <input id="dep-phone" type="tel" inputMode="numeric" placeholder="07XX XXX XXX" value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full glass rounded-lg px-3 py-3 t-mono t-parch mb-2" style={{ fontSize: 16 }} />
          <p className="t-label mb-4">The money goes to your wallet. Invest it in a pool whenever you like.</p>
        </>
      )}
      {phase.kind === "waiting" && !phase.slow && (
        <div className="glass rounded-lg p-4 mb-4">
          <p className="t-status t-gold">{phase.received ? "Payment received. We are confirming it." : "Check your phone and enter your M-Pesa PIN."}</p>
          <p className="t-label mt-1">Keep this open. It closes when your money arrives.</p>
        </div>
      )}
      {phase.kind === "waiting" && phase.slow && (
        <div className="glass rounded-lg p-4 mb-4">
          <p className="t-status" style={{ color: "#85C1E9" }}>{phase.received ? "Payment received. Under review." : "Still waiting for M-Pesa."}</p>
          <p className="t-label mt-1">
            {phase.received
              ? "Your payment went through but we are still matching it. It shows as pending in Recent Activity and we will update your wallet when it is confirmed."
              : "If you paid, your wallet updates as soon as M-Pesa tells us. If you did not pay, nothing was taken."}
          </p>
        </div>
      )}
      {phase.kind === "failed" && (
        <div className="glass rounded-lg p-4 mb-4">
          <p className="t-status" style={{ color: "#FF8A73" }}>{phase.cancelled ? "You cancelled the payment." : "The payment did not go through."}</p>
          <p className="t-label mt-1">{phase.reason ? `${phase.reason}. ` : ""}Nothing was taken from your M-Pesa.</p>
        </div>
      )}
    </MoneySheet>
  );
}
