"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  ChefHat,
  ClipboardList,
  Gauge,
  LogOut,
  Server,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/customer/site-header";
import { canAccess, DEMO_MODE } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useSignOut, useStaffRole } from "./use-staff-role";

/** Operations first (shared by managers and owners), then owner-only areas. */
const NAV = [
  { href: "/manager", label: "Overview", icon: Gauge },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/inventory", label: "Inventory", icon: ClipboardList },
  { href: "/table-reservations", label: "Reservations", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/finance", label: "Finance", icon: Wallet },
  { href: "/menu-editor", label: "Menu", icon: BookOpen },
  { href: "/staff-management", label: "Staff", icon: Users },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin", label: "System", icon: Server },
  { href: "/", label: "Storefront", icon: Store },
];

const ROLE_LABEL: Record<string, string> = {
  manager: "Manager",
  super_admin: "Super admin · Owner",
  user: "Customer",
};

export function StaffShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();
  const role = useStaffRole();
  const signOut = useSignOut();
  // Only show areas this role can open — no dead-end links.
  const nav = NAV.filter((n) => role && canAccess(role, n.href));

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-espresso/85 backdrop-blur-xl">
        <div className="flex h-16 items-center gap-6 px-4 sm:px-6">
          <Logo className="hidden shrink-0 whitespace-nowrap sm:flex" />
          <nav className="flex min-w-0 gap-1 overflow-x-auto">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  title={label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && <motion.span layoutId="staff-nav" className="absolute inset-0 rounded-full bg-secondary" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                  <Icon className="relative size-4" />
                  {/* Owners see ten areas: keep labels to the widest screens (icons keep tooltips). */}
                  <span className={cn("relative hidden", nav.length > 6 ? "2xl:inline" : "xl:inline")}>{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {actions}
            {role && (
              <span className="hidden whitespace-nowrap text-xs text-muted-foreground lg:block">
                {ROLE_LABEL[role] ?? role}
                {DEMO_MODE && " · demo"}
              </span>
            )}
            <button onClick={() => void signOut()} aria-label="Sign out" className="grid size-10 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
