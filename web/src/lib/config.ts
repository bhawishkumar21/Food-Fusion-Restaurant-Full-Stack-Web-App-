import type { Role } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export const TENANT_ID =
  process.env.NEXT_PUBLIC_TENANT_ID ?? "f00df051-0000-4000-8000-000000000001";
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://caolqtnsttckjojpqotc.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhb2xxdG5zdHRja2pvanBxb3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTA4OTQsImV4cCI6MjEwNjk2Njg5NH0.xGhOYzlZPvwIgx0hJx1IVWJ1-L56trR-UXygd3-3Qqc";

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhb2xxdG5zdHRja2pvanBxb3RjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTM5MDg5NCwiZXhwIjoyMTA2OTY2ODk0fQ.p5iZ_Cg__UglR9V2MMZo7izOIR3m3lx_Pyb-MUuAvsU";

export const DEFAULT_GUEST_CUSTOMER_ID =
  process.env.NEXT_PUBLIC_DEFAULT_GUEST_CUSTOMER_ID ||
  "3d1a33bf-4daa-4070-81ab-41684bea9a1d";

/**
 * Without a backend configured the app runs a fully client-side demo:
 * data lives in localStorage and realtime events travel between tabs over
 * BroadcastChannel, so Customer → Kitchen → Dashboard can be tried end-to-end.
 */
export const DEMO_MODE = false;

/** Demo-mode session (no Supabase): who signed in, and the role they had then. */
export const DEMO_EMAIL_COOKIE = "ff-demo-email";
export const DEMO_ROLE_COOKIE = "ff-demo-role";

/**
 * The one and only super admin. Hardcoded on purpose and mirrored in the API
 * (src/auth/roles.ts) and Postgres (public.super_admin_email()).
 */
export const SUPER_ADMIN_EMAIL = "bhawishk15@gmail.com";

export const isSuperAdminEmail = (email?: string | null) =>
  (email ?? "").trim().toLowerCase() === SUPER_ADMIN_EMAIL;

/**
 * Effective role: the hardcoded email always wins; a stored role counts only
 * if it is assignable (manager / staff / user). Everyone else is a user.
 */
export function resolveRole(email: string | null | undefined, stored: unknown): Role {
  if (isSuperAdminEmail(email)) return "super_admin";
  switch (stored) {
    case "manager":
      return "manager";
    case "staff":
    case "kitchen":
    case "chef":
    case "waiter":
      return "staff";
    default:
      return "user"; // incl. a stored "super_admin" on any other account
  }
}

const SUPER_ADMIN: Role[] = ["super_admin"];
const MANAGERS: Role[] = ["manager", "super_admin"];
const KITCHEN: Role[] = ["staff", "manager", "super_admin"];

/**
 * Route-prefix → roles allowed (the longest matching prefix decides). Mirrors
 * the NestJS guards and Postgres RLS (layer 1 of 3: this only decides which
 * screens render). Storefront routes are open to everyone, guests included.
 */
export const AREA_ACCESS: Record<string, Role[]> = {
  "/admin/overview": MANAGERS,
  "/admin/inventory": MANAGERS,
  "/admin": SUPER_ADMIN, // incl. /admin/users, /admin/staff
  "/analytics": SUPER_ADMIN,
  "/finance": SUPER_ADMIN,
  "/menu-editor": SUPER_ADMIN,
  "/manager": MANAGERS,
  "/inventory": MANAGERS,
  "/table-reservations": MANAGERS,
  "/kitchen": KITCHEN,
};

export function areaFor(pathname: string): string | undefined {
  return Object.keys(AREA_ACCESS)
    .filter((a) => pathname === a || pathname.startsWith(`${a}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function canAccess(role: Role | null, pathname: string): boolean {
  const area = areaFor(pathname);
  return !area || (role !== null && AREA_ACCESS[area].includes(role));
}

export function homeFor(role: Role): string {
  switch (role) {
    case "super_admin":
      return "/admin/orders";
    case "manager":
      return "/manager";
    case "staff":
      return "/kitchen";
    default:
      return "/";
  }
}

/** Only same-site paths are honoured as post-login destinations. */
export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
}

export function destinationFor(role: Role, next: string | null | undefined) {
  const safe = safeNext(next);
  return safe && canAccess(role, safe) ? safe : homeFor(role);
}
