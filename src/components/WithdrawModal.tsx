import { useMemo, useRef, useState } from "react";
import { MoneySheet } from "@/components/MoneySheet";
import { StatusChip } from "@/components/StatusChip";
import { useMoneyConfig } from "@/hooks/useMoneyConfig";
import { newRequestId, postMoney } from "@/lib/money-client";
import type { PoolHolding } from "@/hooks/useAccountSummary";

interface Props {
  wallet: number;
  phone: string;
  holdings: PoolHolding[];
  /** "wallet" or a pool_id to start on. */
  initialSource?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });

type Done = { net: number; fee: number; replayed: boolean; status: string };

// One Withdraw sheet for both sources (design D2, D4, D18, D19): wallet first, locked pools muted
// with their unlock date, a big live "You receive" from the server quote, phone prefilled.
export function WithdrawModal({ wallet, phone: savedPhone, holdings, initialSource, onClose, onSuccess }: Props) {
  const pools = useMemo(() => holdings.filter((h) => h.value > 0), [holdings]);
  const isLocked = (h: PoolHolding) => !!h.unlocks_at && new Date(h.unlocks_at).getTime() > Date.now();

  const firstOpen = pools.find((h) => !isLocked(h));
  const [source, setSource] = useState<string>(initialSource ?? (wallet >= 1 ? "wallet" : (firstOpen?.pool_id ?? "wallet")));
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState(savedPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const requestId = useRef(newRequestId());

  const pool = pools.find((h) => h.pool_id === source) ?? null;
  const available = source === "wallet" ? wallet : (pool?.value ?? 0);
  const amt = amount === "" ? 0 : Number(amount);

  const cfg = useMoneyConfig(
    { source: source === "wallet" ? "wallet" : "pool", poolId: pool?.pool_id, amount: amt > 0 ? amt : undefined },
    !done,
  );
  const quote = cfg.data?.quote ?? null;
  const quoteOk = !cfg.stale && quote?.result === "ok";
  const paused = cfg.data?.paused.withdrawals ?? false;
  const capLeft = cfg.data?.caps.user_left;
  const overBalance = amt > available;
  const overCap = capLeft != null && amt > capLeft;
  const phoneOk = /^(?:\+?254|0)?[71]\d{8}$/.test(phone.replace(/\s/g, ""));

  const reset = () => { requestId.current = newRequestId(); setError(""); setChanged(""); };

  let blocker = "";
  if (paused) blocker = "Withdrawals are paused for a moment. Your money is safe. Try again later.";
  else if (cfg.error) blocker = "Can't check the fee right now.";
  else if (amt > 0 && overBalance) blocker = `You can withdraw up to ${kes(available)} from here.`;
  else if (amt > 0 && overCap) blocker = `You can withdraw ${kes(capLeft ?? 0)} more today.`;
  else if (amt > 0 && !cfg.stale && quote && quote.result !== "ok") {
    blocker = quote.result === "below_min" ? `The minimum is ${kes(quote.min ?? 0)}.` : "Enter a whole number of shillings.";
  }
  const canSubmit = !busy && quoteOk && !blocker && phoneOk && amt > 0;

  const submit = async () => {
    if (!canSubmit || !quote) return;
    setBusy(true); setError(""); setChanged("");
    const r = await postMoney("/api/withdraw-request", {
      source: source === "wallet" ? "wallet" : "pool",
      pool_id: pool?.pool_id,
      amount: amt,
      phone,
      request_id: requestId.current,
      expected_net: quote.net,
    });
    setBusy(false);
    if (r.ok) {
      setDone({ net: Number(r.data.net), fee: Number(r.data.fee), replayed: !!r.data.replayed, status: String(r.data.status ?? "pending") });
      onSuccess();
    } else if (r.data.code === "quote_changed") {
      setChanged(String(r.data.error));
      cfg.retry();
    } else {
      setError(String(r.data.error ?? "That didn't go through. Try again."));
    }
  };

  if (done) {
    return (
      <MoneySheet title={done.replayed ? "Already requested" : "Withdrawal requested"} eyebrow="WITHDRAW" onClose={onClose}
        liveMessage={`${kes(done.net)} requested. Usually within 24 hours.`}
        footer={<button onClick={onClose} className="btn-brass w-full tap44" style={{ padding: "14px 16px", fontSize: 14 }}>Done</button>}>
        <p className="t-display t-gold" style={{ fontSize: 30 }}>{kes(done.net)}</p>
        <p className="t-label mt-1">{done.fee > 0 ? `After a fee of ${kes(done.fee)}.` : "No fee."} Sent to {phone}.</p>
        <ol className="mt-5 space-y-3" aria-label="Withdrawal progress">
          <Step label="Requested" state="done" />
          <Step label="Approved by us" state={done.status === "pending" ? "next" : "done"} />
          <Step label="Paid to your M-Pesa" state="todo" />
        </ol>
        <p className="t-label mt-4">Usually within 24 hours. We will tell you when it is paid or if it fails.</p>
        {done.replayed && <p className="mt-3"><StatusChip status={done.status} /></p>}
      </MoneySheet>
    );
  }

  return (
    <MoneySheet title="Withdraw" eyebrow="MONEY OUT" onClose={onClose} locked={busy}
      liveMessage={blocker || changed || error}
      footer={
        <>
          <div className="glass rounded-lg px-4 py-2 mb-2 flex items-center justify-between" aria-live="polite">
            <div>
              <p className="t-label">You receive</p>
              <p className="t-label">
                {amt <= 0 ? "Enter an amount." : cfg.stale && !cfg.error ? "Updating…" : quote?.fee != null ? (quote.fee > 0 ? `Fee ${kes(quote.fee)}` : "No fee") : ""}
              </p>
            </div>
            <p className="t-display t-gold" style={{ fontSize: 28, opacity: cfg.stale ? 0.5 : 1 }}>
              {quote?.net != null && amt > 0 ? kes(quote.net) : "KES 0"}
            </p>
          </div>
          {(blocker || error) && <p className="money-error mb-2" role="alert">{error || blocker}</p>}
          {cfg.error && <button onClick={cfg.retry} className="t-gold tap44 mb-2 underline" style={{ fontSize: 14 }}>Try again</button>}
          <button onClick={submit} disabled={!canSubmit} className="btn-brass w-full tap44"
            style={{ padding: "14px 16px", fontSize: 14, opacity: canSubmit ? 1 : 0.5 }}>
            {busy ? "Requesting…" : quoteOk && quote?.net != null ? `Withdraw ${kes(quote.net)}` : "Withdraw"}
          </button>
        </>
      }>
      <fieldset className="mb-4">
        <legend className="t-label mb-2">Take it from</legend>
        <div className="flex flex-col gap-2">
          <SourceRow active={source === "wallet"} onPick={() => { setSource("wallet"); reset(); }} name="Wallet" detail={`${kes(wallet)} · available now`} />
          {pools.map((h) => {
            const locked = isLocked(h);
            return (
              <SourceRow key={h.pool_id} active={source === h.pool_id} disabled={locked}
                onPick={() => { setSource(h.pool_id); reset(); }}
                name={h.name}
                detail={locked ? `${kes(h.value)} · locked until ${shortDate(h.unlocks_at!)}` : `${kes(h.value)} · fee ${h.exit_fee_percent}%`} />
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="wd-amount" className="t-label block mb-1">Amount (whole shillings)</label>
      <input id="wd-amount" inputMode="numeric" autoComplete="off" value={amount}
        onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 9)); reset(); }}
        className="w-full glass rounded-lg px-3 py-3 t-display t-parch mb-1" style={{ fontSize: 20 }} />
      <button type="button" className="t-gold underline tap44" style={{ fontSize: 14 }}
        onClick={() => { setAmount(String(Math.floor(available))); reset(); }}>
        Use all {kes(available)}
      </button>

      {changed && <p className="money-error mb-2" role="alert">{changed}</p>}

      <label htmlFor="wd-phone" className="t-label block mb-1">M-Pesa phone for the payout</label>
      <input id="wd-phone" type="tel" inputMode="numeric" placeholder="07XX XXX XXX" value={phone}
        onChange={(e) => { setPhone(e.target.value); reset(); }}
        className="w-full glass rounded-lg px-3 py-3 t-mono t-parch mb-4" style={{ fontSize: 16 }} />
      <p className="t-label mb-3">Usually within 24 hours.</p>
    </MoneySheet>
  );
}

function SourceRow({ active, disabled, onPick, name, detail }: { active: boolean; disabled?: boolean; onPick: () => void; name: string; detail: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} aria-disabled={disabled} disabled={disabled} onClick={onPick}
      className="glass rounded-lg text-left tap44"
      style={{ padding: "10px 12px", opacity: disabled ? 0.55 : 1, outline: active ? "2px solid #D4AF37" : "none" }}>
      <span className="t-serif t-parch block" style={{ fontSize: 15 }}>{name}</span>
      <span className="t-label">{detail}</span>
    </button>
  );
}

function Step({ label, state }: { label: string; state: "done" | "next" | "todo" }) {
  const color = state === "done" ? "#58D68D" : state === "next" ? "#F5B041" : "rgba(232,215,180,0.5)";
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden style={{ width: 14, height: 14, borderRadius: 7, background: state === "todo" ? "transparent" : color, border: `2px solid ${color}` }} />
      <span className="t-status" style={{ color }}>{label}{state === "done" ? " (done)" : state === "next" ? " (next)" : ""}</span>
    </li>
  );
}
