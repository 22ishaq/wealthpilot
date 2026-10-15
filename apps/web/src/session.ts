import { can, type Me, type Permission } from "@wealthpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: api.me, retry: false, staleTime: 60_000 });
}

/** UI-only gate: hides controls the API would refuse anyway. The API is the authority. */
export function useCan(permission: Permission): boolean {
  const { data } = useMe();
  return data ? can(data.user.role, permission) : false;
}

/** After signing in, signing up or accepting an invitation: start from a clean cache. */
export function useSignedIn() {
  const queryClient = useQueryClient();
  return (me: Me) => {
    queryClient.clear();
    queryClient.setQueryData(ME_KEY, me);
  };
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, undefined);
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}
