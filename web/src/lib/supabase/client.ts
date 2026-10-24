"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DEMO_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  if (DEMO_MODE) return null;
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

/**
 * Returns a bearer token for the NestJS API. Guests are signed in
 * anonymously the first time they need one (checkout, feedback), so ordering
 * never requires creating an account.
 */
export async function getAccessToken({ allowAnonymous = false } = {}) {
  const sb = supabaseBrowser();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.access_token;
  if (!allowAnonymous) return null;
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return anon.session?.access_token ?? null;
}

/** Keeps contact data used by orders, reviews and dispatch in one RLS-owned row. */
export async function syncProfile(user: User, extra?: { phone_number?: string; delivery_address?: string }) {
  const sb = supabaseBrowser();
  if (!sb || user.is_anonymous) return;
  const name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? "").trim();
  const phone = String(extra?.phone_number ?? user.user_metadata?.phone_number ?? user.user_metadata?.phone ?? user.phone ?? "").trim();
  const address = String(extra?.delivery_address ?? user.user_metadata?.delivery_address ?? "").trim();
  const email = String(user.email ?? user.user_metadata?.email ?? "").trim();

  const payload: Record<string, unknown> = {
    id: user.id,
    email: email || null,
    display_name: name || null,
    full_name: name || null,
    phone: phone || null,
    phone_number: phone || null,
  };
  if (address) {
    payload.delivery_address = address;
  }

  const { error } = await sb.from("profiles").upsert(payload);
  if (error) {
    // Fallback if some schema columns are missing
    await sb.from("profiles").upsert({
      id: user.id,
      display_name: name || null,
      phone: phone || null,
    });
  }
}
