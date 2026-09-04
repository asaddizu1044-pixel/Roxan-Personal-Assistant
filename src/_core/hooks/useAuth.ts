import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [userName, setUserName] = useState("");

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data: any) => {
      utils.auth.me.setData(undefined, data);
      setShowLoginModal(false);
      console.log("✅ Login successful:", data?.name);
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      console.log("✅ Logout successful");
    },
  });

  // ✅ Fixed logout function

  const logout = useCallback(async () => {
  try {
    console.log("🔑 Logging out...");
    await logoutMutation.mutateAsync();
  } catch (error) {
    console.error("❌ Logout error:", error);
  } finally {
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
    await utils.auth.me.refetch();
    localStorage.removeItem("manus-runtime-user-info");
    sessionStorage.removeItem("manus-cookie");
    setShowLoginModal(false);
    
    // ✅ THIS FIXES THE ISSUE
    window.location.reload();
  }
}, [logoutMutation, utils]);
  const login = useCallback(async (name: string) => {
    try {
      console.log("🔑 Attempting login with name:", name);
      await loginMutation.mutateAsync({ name });
    } catch (error) {
      console.error("❌ Login error:", error);
    }
  }, [loginMutation]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending || loginMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? loginMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
    loginMutation.error,
    loginMutation.isPending,
  ]);

  // ✅ Auto show login modal if not authenticated
  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (state.loading) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    console.log("🔑 Opening login modal (not authenticated)");
    setShowLoginModal(true);
  }, [redirectOnUnauthenticated, redirectPath, state.loading, state.user]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
    login,
    showLoginModal,
    setShowLoginModal,
    userName,
    setUserName,
  };
}