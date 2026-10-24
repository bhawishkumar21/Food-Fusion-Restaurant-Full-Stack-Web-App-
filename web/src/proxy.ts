import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  AREA_ACCESS,
  areaFor,
  DEMO_EMAIL_COOKIE,
  DEMO_MODE,
  DEMO_ROLE_COOKIE,
  homeFor,
  resolveRole,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/config";
import type { Role } from "@/lib/types";

/** Old routes that moved. */
const MOVED: Record<string, string> = {
  "/staff-management": "/admin/users",
};

/**
 * Route-level RBAC (layer 1 of 3). This only decides which *screens* render;
 * the NestJS RolesGuard and Postgres RLS independently enforce every read and
 * write, so a forged cookie can never reach data it shouldn't.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.search = "";

  const moved = Object.keys(MOVED).find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (moved) {
    url.pathname = MOVED[moved];
    return NextResponse.redirect(url);
  }
  const legacyDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const area = areaFor(pathname);
  if (!area && !legacyDashboard) return NextResponse.next();

  let response = NextResponse.next({ request });
  let role: Role | null = null;

  if (DEMO_MODE) {
    const email = request.cookies.get(DEMO_EMAIL_COOKIE)?.value;
    // The super-admin email is decided here, not trusted from the role cookie.
    if (email) role = resolveRole(decodeURIComponent(email), request.cookies.get(DEMO_ROLE_COOKIE)?.value);
  } else {
    // Refreshes the Supabase session cookie as a side effect.
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user) role = resolveRole(data.user.email, data.user.app_metadata?.role);
  }

  if (legacyDashboard) {
    url.pathname = role ? homeFor(role) : "/login";
    return NextResponse.redirect(url);
  }

  if (role && AREA_ACCESS[area!].includes(role)) return response;

  if (!role) {
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
  } else {
    url.pathname = homeFor(role); // signed in, but not allowed here
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/analytics/:path*",
    "/finance/:path*",
    "/menu-editor/:path*",
    "/manager/:path*",
    "/kitchen/:path*",
    "/inventory/:path*",
    "/table-reservations/:path*",
    "/dashboard/:path*",
    "/staff-management/:path*",
  ],
};
