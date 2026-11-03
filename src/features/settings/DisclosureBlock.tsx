import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCapabilities } from "./hooks";

export function DisclosureBlock() {
  const disclosures = useQuery({
    queryKey: ["public-disclosures"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_config").select("key,value")
        .in("key", ["broker_of_record_disclosure", "risk_warning", "legal_entity"]);
      if (error || data?.length !== 3) throw new Error("Disclosures unavailable");
      return data.map(row => ({ key: row.key, text: typeof row.value === "string" ? row.value : "" }));
    },
    staleTime: 60_000,
    retry: 1,
  });
  return <aside aria-label="Legal disclosures" className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
    {disclosures.isPending ? <p role="status">Loading disclosures…</p> : disclosures.isError ? <p role="alert">Legal disclosures are temporarily unavailable.</p> :
      <dl className="space-y-2">{disclosures.data.map(row => <div key={row.key}>
        <dt className="font-medium">{row.key === "risk_warning" ? "Risk warning" : row.key === "legal_entity" ? "Legal entity" : "Broker disclosure"}</dt>
        <dd>{row.text}</dd>
      </div>)}</dl>}
  </aside>;
}

export function ModeBanner() {
  const { data, isPending, isError } = useCapabilities();
  return <div role="status" className="border-b border-border bg-muted px-5 py-3 text-xs text-foreground">
    {isPending ? "Checking account mode…" : isError ? "Account mode unavailable. Money actions are disabled." :
      data && !data.mpesaLive && !data.investLive ? "Analyse + Demo · Real payments and real investing are disabled." :
      data?.brokerMode === "mock" ? "Demo trading · Virtual orders only." : "Live services enabled · Check each order or payment before confirming."}
  </div>;
}