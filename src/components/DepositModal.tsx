import { useRef, useState } from "react";
import { MoneySheet } from "@/components/MoneySheet";
import { useMoneyConfig } from "@/hooks/useMoneyConfig";
import { newRequestId, postMoney } from "@/lib/money-client";

interface Props {
  pool: {
    id: string;
    name: string;
    min_investment: number | null;
    holding_period_days?: number | null;
    exit_fee_percent?: number | null;
  };
  onClose: () => void;
  onSuccess?: () => void;
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

// "Invest from wallet into a pool" (design D5, D9, D12): the sheet says what the lock is before the
// tap, the button names it, and a repeat tap shows "Already invested" instead of a second charge.
// M-Pesa top-ups are handled by WalletDepositModal.
export function DepositModal({ pool, onClose, onSuccess }: Props) {
  const min = pool.min_investment ?? 1;
  const lockDays = Number(pool.holding_period_days ?? 0);
  const [amount, setAmount] = useState(String(Math.ceil(min)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ amount: number; balance: number | null; replayed: boolean } | null>(null);
  const requestId = useRef(newRequestId());
  const cfg = useMoneyConfig({}, !done);

  const amt = amount === "" ? 0 : Number(amount);
  const wallet = cfg.data?.wallet_balance ?? null;
  const paused = cfg.data?.paused.investing ?? false;

  let blocker = "";
  if (paused) blocker = "Investing is paused for a moment. Your money is safe. Try again later.";
  else if (amt > 0 && amt < min) blocker = `The minimum is ${kes(min)}.`;
  else if (wallet !== null && amt > wallet) blocker = `Your wallet has ${kes(wallet)}. Top up first.`;
  const canSubmit = !busy && amt >= min && !blocker && !cfg.error && wallet !== null;
  const lockText = lockDays > 0 ? `Locked for ${lockDays} days` : "No lock period";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError("");
    const r = await postMoney("/api/wallet-invest", { pool_id: pool.id, amount: amt, request_id: requestId.current });
    setBusy(false);
    if (r.ok) {
      setDone({ amount: Number(r.data.amount ?? amt), balance: typeof r.data.new_balance === "number" ? r.data.new_balance : null, replayed: !!r.data.replayed });
      onSuccess?.();
    } else {
      setError(String(r.data.error ?? "That didn't go through. Try again."));
    }
  };

  if (done) {
    return (
      <MoneySheet title={done.replayed ? "Already invested" : "Invested"} eyebrow={pool.name.toUpperCase()} onClose={onClose}
        liveMessage={`${kes(done.amount)} invested in ${pool.name}.`}
        footer={<button onClick={onClose} className="btn-brass w-full tap44" style={{ padding: "14px 16px", fontSize: 14 }}>Done</button>}>
        <p className="t-display t-gold" style={{ fontSize: 30 }}>{kes(done.amount)}</p>
        <p className="t-label mt-1">{done.replayed ? "This investment was already made. Nothing was charged twice." : `is now in ${pool.name}.`}</p>
        {done.balance !== null && <p className="t-label mt-3">Wallet balance: {kes(done.balance)}</p>}
      </MoneySheet>
    );
  }

  return (
    <MoneySheet title={`Invest in ${pool.name}`} eyebrow="FROM YOUR WALLET" onClose={onClose} locked={busy}
      liveMessage={blocker || error}
      footer={
        <>
          {(blocker || error) && <p className="money-error mb-2" role="alert">{error || blocker}</p>}
          {cfg.error && <button onClick={cfg.retry} className="t-gold tap44 mb-2 underline" style={{ fontSize: 14 }}>Can't load your balance. Try again</button>}
          <button onClick={submit} disabled={!canSubmit} className="btn-brass w-full tap44"
            style={{ padding: "14px 16px", fontSize: 14, opacity: canSubmit ? 1 : 0.5 }}>
            {busy ? "Investing…" : `Invest ${amt > 0 ? kes(amt) : ""}${lockDays > 0 ? ` for ${lockDays} days` : ""}`.trim()}
          </button>
        </>
      }>
      <div className="glass rounded-lg p-3 mb-3 flex items-center justify-between">
        <span className="t-label">Wallet balance</span>
        <span className="t-display t-gold" style={{ fontSize: 16 }}>{wallet === null ? "…" : kes(wallet)}</span>
      </div>

      <label htmlFor="inv-amount" className="t-label block mb-1">Amount (whole shillings)</label>
      <input id="inv-amount" inputMode="numeric" autoComplete="off" value={amount}
        onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 9)); requestId.current = newRequestId(); setError(""); }}
        className="w-full glass rounded-lg px-3 py-3 t-display t-parch mb-3" style={{ fontSize: 20 }} />

      <div className="glass rounded-lg p-3 mb-3">
        <p className="t-label">What to expect</p>
        <ul className="t-serif t-parch mt-1 space-y-1" style={{ fontSize: 14 }}>
          <li>{lockText}{lockDays > 0 ? ", counted from your first investment in this pool." : "."}</li>
          {lockDays > 0 && <li>Adding more later does not restart the lock.</li>}
          {pool.exit_fee_percent != null && <li>Exit fee when you withdraw: {pool.exit_fee_percent}%.</li>}
          <li>Minimum {kes(min)}.</li>
        </ul>
      </div>
    </MoneySheet>
  );
}
