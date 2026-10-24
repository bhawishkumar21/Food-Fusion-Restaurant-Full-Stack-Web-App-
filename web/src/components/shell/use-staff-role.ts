"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DEMO_EMAIL_COOKIE, DEMO_MODE, DEMO_ROLE_COOKIE, resolveRole } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

const noopSubscribe = () => () => {};
const cookie = (name: string) => {
  const raw = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
  return raw ? decodeURIComponent(raw) : null;
};
const readDemoSession = () => `${cookie(DEMO_EMAIL_COOKIE) ?? ""}|${cookie(DEMO_ROLE_COOKIE) ?? ""}`;

export interface Viewer {
  email: string | null;
  role: Role;
}

/**
 * Who is signed in and their effective role, for UI only. Access itself is
 * enforced by proxy.ts, the NestJS guards and Postgres RLS.
 */
export function useViewer(): Viewer | null {
  const demo = useSyncExternalStore(noopSubscribe, readDemoSession, () => null);
  const [live, setLive] = useState<Viewer | null>(null);

  useEffect(() => {
    if (DEMO_MODE) return;
    void supabaseBrowser()
      ?.auth.getUser()
      .then(({ data }) =>
        setLive(data.user ? { email: data.user.email ?? null, role: resolveRole(data.user.email, data.user.app_metadata?.role) } : null),
      );
  }, []);

  if (!DEMO_MODE) return live;
  if (!demo) return null;
  const [email, role] = demo.split("|");
  return email ? { email, role: resolveRole(email, role) } : null;
}

/** Back-compat helper for components that only need the role. */
export function useStaffRole(): Role | null {
  return useViewer()?.role ?? null;
}

export function useSignOut() {
  const router = useRouter();
  return async () => {
    if (DEMO_MODE) {
      document.cookie = `${DEMO_EMAIL_COOKIE}=; path=/; max-age=0`;
      document.cookie = `${DEMO_ROLE_COOKIE}=; path=/; max-age=0`;
    } else {
      await supabaseBrowser()?.auth.signOut();
    }
    router.replace("/login");
    router.refresh();
  };
}
