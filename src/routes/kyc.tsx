import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/kyc")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { title: "KYC Verification — Golden Compass" },
      { name: "description", content: "Verify your identity with Golden Compass to unlock deposits and pool investing." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "KYC Verification — Golden Compass" },
      { property: "og:description", content: "Verify your identity to start investing." },
      { property: "og:url", content: "/kyc" },
    ],
    links: [{ rel: "canonical", href: "/kyc" }],
  }),
  component: KycPage,
});

function KycPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [nationalId, setNationalId] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [employment, setEmployment] = useState("employed");
  const [income, setIncome] = useState("under_500k");
  const [source, setSource] = useState("salary");
  const [accept, setAccept] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("kyc_records")
        .select("status")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.status) setExisting(data.status);
    })();
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!nationalId || !dob || !address) {
      setError("Please complete all required fields.");
      return;
    }
    if (!accept) {
      setError("You must accept the risk disclosure to continue.");
      return;
    }
    setLoading(true);
    try {
      const { error: kycErr } = await supabase.from("kyc_records").insert({
        user_id: user!.id,
        national_id: nationalId,
        date_of_birth: dob,
        address,
        employment_status: employment,
        annual_income_range: income,
        source_of_funds: source,
        risk_disclosure_accepted: accept,
        status: "pending",
      });
      if (kycErr) throw kycErr;
      await supabase.from("profiles").update({ kyc_status: "pending" }).eq("id", user!.id);
      setSuccess(true);
      setTimeout(() => navigate({ to: "/profile" }), 1200);
    } catch (err: any) {
      setError(err.message || "Submission failed");
      setLoading(false);
    }
  };

  if (existing === "approved") {
    return (
      <div className="flex flex-col gap-5 px-5 pt-6 pb-28">
        <h1 className="t-display t-gold" style={{ fontSize: 22 }}>KYC Verified</h1>
        <div className="glass rounded-2xl p-6 text-center">
          <p className="text-3xl mb-3">✓</p>
          <p className="t-serif t-parch" style={{ fontSize: 15 }}>
            Your identity has been verified.
          </p>
        </div>
      </div>
    );
  }

  if (existing === "pending") {
    return (
      <div className="flex flex-col gap-5 px-5 pt-6 pb-28">
        <h1 className="t-display t-gold" style={{ fontSize: 22 }}>KYC Under Review</h1>
        <div className="glass rounded-2xl p-6 text-center">
          <p className="text-3xl mb-3">⏳</p>
          <p className="t-serif t-parch" style={{ fontSize: 15 }}>
            Your submission is being reviewed.
          </p>
          <p className="t-mono t-muted mt-2" style={{ fontSize: 10 }}>
            We'll notify you when complete.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-28 anim-fade-up">
      <header>
        <p className="t-mono t-sec" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
          IDENTITY INFORMATION
        </p>
        <h1 className="t-display t-gold mt-1" style={{ fontSize: 22 }}>
          KYC Verification
        </h1>
        <p className="t-serif t-sec mt-2" style={{ fontSize: 13, fontStyle: "italic" }}>
          Identity review does not confirm regulatory authorization or enable live services.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="glass rounded-2xl p-5 space-y-4">
        <Field label="National ID Number" value={nationalId} onChange={setNationalId} />
        <Field label="Date of Birth" type="date" value={dob} onChange={setDob} />
        <Field label="Residential Address" value={address} onChange={setAddress} />

        <Select label="Employment Status" value={employment} onChange={setEmployment} options={[
          ["employed", "Employed"],
          ["self_employed", "Self-employed"],
          ["unemployed", "Unemployed"],
          ["student", "Student"],
          ["retired", "Retired"],
        ]} />

        <Select label="Annual Income (KES)" value={income} onChange={setIncome} options={[
          ["under_500k", "Under 500,000"],
          ["500k_1m", "500,000 – 1,000,000"],
          ["1m_5m", "1,000,000 – 5,000,000"],
          ["over_5m", "Over 5,000,000"],
        ]} />

        <Select label="Source of Funds" value={source} onChange={setSource} options={[
          ["salary", "Salary"],
          ["business", "Business Income"],
          ["savings", "Savings"],
          ["inheritance", "Inheritance"],
          ["other", "Other"],
        ]} />

        <label
          className="flex items-start gap-3 cursor-pointer"
          style={{ padding: "12px", borderRadius: 10, background: "rgba(0,0,0,0.25)" }}
        >
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span className="t-mono t-sec" style={{ fontSize: 10, lineHeight: 1.5 }}>
            I understand investments carry risk and the value of my holdings may fall as well as rise.
            I have read the{" "}
            <Link to="/legal/risk-disclosure" className="t-gold" style={{ textDecoration: "underline" }}>
              Risk Disclosure
            </Link>
            ,{" "}
            <Link to="/legal/terms" className="t-gold" style={{ textDecoration: "underline" }}>
              Terms
            </Link>{" "}
            and{" "}
            <Link to="/legal/privacy" className="t-gold" style={{ textDecoration: "underline" }}>
              Privacy Policy
            </Link>
            .
          </span>

        </label>

        {error && (
          <p className="t-mono" style={{ fontSize: 11, color: "var(--gc-danger)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || success}
          className="btn-brass w-full"
          style={{ height: 52, fontSize: 12 }}
        >
          {success ? "✓ Submitted" : loading ? "Submitting…" : "Submit for Review"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="gc-input-wrap">
      <label className="gc-input-label">{label}</label>
      <input
        type={type}
        className="gc-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="gc-input-wrap">
      <label className="gc-input-label">{label}</label>
      <select
        className="gc-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none" }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} style={{ background: "var(--ocean-1)" }}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
