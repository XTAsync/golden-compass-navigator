import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveLiveGates, type Capabilities } from "./capabilities";

export async function readCapabilities(client: SupabaseClient<Database>, userId: string): Promise<Capabilities> {
  const keys = ["broker_mode", "mpesa_live", "invest_live", "cfd_enabled", "broker_of_record_disclosure", "risk_warning", "legal_entity"];
  const [{ data, error }, role] = await Promise.all([
    client.from("app_config").select("key,value").in("key", keys),
    client.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (error || role.error) throw new Error("Account capabilities unavailable");
  const config: Record<string, unknown> = Object.fromEntries((data ?? []).map(row => [row.key, row.value]));
  const disclosure = (key: string) => {
    const value = config[key];
    if (typeof value !== "string" || !value.trim()) throw new Error("Legal disclosure unavailable");
    return value;
  };
  return {
    ...resolveLiveGates(config),
    isAdmin: role.data === true,
    disclosures: {
      broker_of_record_disclosure: disclosure("broker_of_record_disclosure"),
      risk_warning: disclosure("risk_warning"),
      legal_entity: disclosure("legal_entity"),
    },
  };
}