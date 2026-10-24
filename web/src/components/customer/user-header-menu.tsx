"use client";

import { LogOut, Package, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser, syncProfile } from "@/lib/supabase/client";
import { useCartStore } from "@/store/cart-store";

export function UserHeaderMenu() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  // ✅ Must be called BEFORE any early returns to satisfy Rules of Hooks
  const lastOrder = useCartStore((s) => s.lastOrder);
  const hasOrder = Boolean(lastOrder && !["cancelled", "completed"].includes(lastOrder.status));

  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) return;
    void client.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) void syncProfile(session.user).catch(() => undefined);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!user || user.is_anonymous) {
    return <Link href="/login" className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Sign in"><UserRound className="size-5" /></Link>;
  }

  const name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Guest");
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
  const logout = async () => {
    await supabaseBrowser()?.auth.signOut();
    useCartStore.getState().clear();
    useCartStore.getState().setLastOrder(null);
    setOpen(false);
    router.replace("/");
    router.refresh();
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((value) => !value)} className="grid size-11 cursor-pointer place-items-center rounded-full bg-gold/15 text-sm font-semibold text-gold hover:bg-gold/25" aria-expanded={open} aria-label="Open account menu">{initials}</button>
      {open && <div className="glass absolute right-0 top-13 z-50 w-64 rounded-[var(--radius-md)] border p-2 shadow-xl">
        <div className="border-b px-3 py-2"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{user.email}</p></div>
        {hasOrder && (
          <Link href="/orders/track" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-white/5"><Package className="size-4" />My orders</Link>
        )}
        <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-white/5"><Settings className="size-4" />Profile settings</Link>
        <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-[#F4A190] hover:bg-white/5"><LogOut className="size-4" />Logout</button>
      </div>}
    </div>
  );
}
