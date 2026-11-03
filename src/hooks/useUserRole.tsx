import { useCapabilities } from "@/features/settings/hooks";
import { useAuth } from "./useAuth";

// Presentation only; route guards, server actions and RLS authorize independently.
export function useUserRole() {
  const { loading, user } = useAuth();
  const capabilities = useCapabilities();
  return {
    loading: loading || Boolean(user && capabilities.isPending),
    isAdmin: capabilities.data?.isAdmin === true,
  };
}
