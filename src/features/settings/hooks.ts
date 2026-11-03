import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { capabilitiesSchema } from "./capabilities";

export async function fetchCapabilities() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in required");
  const response = await fetch("/api/capabilities", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Account capabilities unavailable");
  return capabilitiesSchema.parse(await response.json());
}

export function useCapabilities() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["capabilities", user?.id], queryFn: fetchCapabilities, enabled: Boolean(user), staleTime: 30_000, retry: 1 });
}