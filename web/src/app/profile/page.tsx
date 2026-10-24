"use client";

import { useEffect, useState } from "react";
import { StorefrontShell } from "@/components/customer/customer-app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ProfilePage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = supabaseBrowser();
    if (!client) {
      queueMicrotask(() => setReady(true));
      return;
    }
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setReady(true);
      setEmail(data.user.email ?? "");
      setName(String(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? ""));
      const { data: profile } = await client
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .maybeSingle<Record<string, unknown>>();

      if (profile) {
        setPhone(String(profile.phone_number ?? profile.phone ?? data.user.user_metadata?.phone_number ?? data.user.user_metadata?.phone ?? ""));
        setAddress(String(profile.delivery_address ?? profile.address ?? data.user.user_metadata?.delivery_address ?? ""));
      } else {
        setPhone(String(data.user.user_metadata?.phone_number ?? data.user.user_metadata?.phone ?? ""));
        setAddress(String(data.user.user_metadata?.delivery_address ?? ""));
      }
      setReady(true);
    });
  }, []);

  const save = async () => {
    const client = supabaseBrowser();
    if (!client) return;
    const { data } = await client.auth.getUser();
    if (!data.user) return setMessage("Please sign in first.");

    const { error: authError } = await client.auth.updateUser({
      data: {
        full_name: name.trim(),
        phone_number: phone.trim(),
        phone: phone.trim(),
        delivery_address: address.trim(),
      },
    });

    let profileError: { message: string } | null = null;
    const { error: extendedErr } = await client.from("profiles").upsert({
      id: data.user.id,
      email: (data.user.email ?? email.trim()) || null,
      display_name: name.trim() || null,
      full_name: name.trim() || null,
      phone: phone.trim() || null,
      phone_number: phone.trim() || null,
      delivery_address: address.trim() || null,
    });
    if (extendedErr) {
      // Fallback: write only the columns that definitely exist in the schema
      const { error: fallbackErr } = await client.from("profiles").upsert({
        id: data.user.id,
        display_name: name.trim() || null,
        phone: phone.trim() || null,
      });
      profileError = fallbackErr;
    }

    setMessage(authError?.message ?? profileError?.message ?? "Profile saved successfully.");
  };

  return (
    <StorefrontShell>
      <main className="mx-auto max-w-lg px-6 pb-24 pt-32">
        <div className="glass rounded-[var(--radius-xl)] p-6">
          <p className="eyebrow">Account</p>
          <h1 className="font-display mt-2 text-4xl">Profile settings</h1>
          {ready ? (
            <div className="mt-6 flex flex-col gap-4">
              <label className="text-sm">
                Email
                <Input value={email} disabled className="opacity-70" />
              </label>
              <label className="text-sm">
                Full Name
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bhawish Kumar" />
              </label>
              <label className="text-sm">
                Phone Number
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +92 300 1234567" />
              </label>
              <label className="text-sm">
                Delivery Address
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Flat 4B, Clifton Block 2, Karachi" />
              </label>
              {message && <p className="text-sm text-gold">{message}</p>}
              <Button onClick={() => void save()}>Save profile</Button>
            </div>
          ) : (
            <div className="mt-6 h-32 animate-pulse rounded bg-secondary" />
          )}
        </div>
      </main>
    </StorefrontShell>
  );
}
