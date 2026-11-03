import { z } from "zod";

export const capabilitiesSchema = z.object({
  brokerMode: z.enum(["mock", "live"]),
  mpesaLive: z.boolean(),
  investLive: z.boolean(),
  cfdEnabled: z.literal(false),
  isAdmin: z.boolean(),
  disclosures: z.object({
    broker_of_record_disclosure: z.string(),
    risk_warning: z.string(),
    legal_entity: z.string(),
  }),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

// Only explicit boolean true enables a live service; strings and absent rows fail closed.
export function resolveLiveGates(config: Record<string, unknown>) {
  return {
    brokerMode: config['broker_mode'] === "live" ? "live" as const : "mock" as const,
    mpesaLive: config['mpesa_live'] === true,
    investLive: config['invest_live'] === true && config['broker_mode'] === "live",
    cfdEnabled: false as const,
  };
}