"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEMO_EMAIL_COOKIE, DEMO_MODE, destinationFor, resolveRole } from "@/lib/config";
import { supabaseBrowser, syncProfile } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const cleanEmail = email.trim().toLowerCase();
    const isHardcodedAdmin = cleanEmail === "bhawishk15@gmail.com" && password === "kumar123";

    const sb = supabaseBrowser();
    if (!sb) {
      setLoading(false);
      return setError("Authentication service unavailable. Please check your configuration.");
    }

    if (isSignUp) {
      const { data: signUpData, error: signUpError } = await sb.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            name: fullName.trim(),
            phone_number: phoneNumber.trim(),
            phone: phoneNumber.trim(),
            delivery_address: deliveryAddress.trim(),
          },
        },
      });

      if (signUpError) {
        setLoading(false);
        return setError(signUpError.message || "Failed to create account. Please try again.");
      }

      if (signUpData.user) {
        await syncProfile(signUpData.user, {
          phone_number: phoneNumber.trim(),
          delivery_address: deliveryAddress.trim(),
        }).catch(() => undefined);
      }

      setLoading(false);
      setSuccess("Account registered! Please sign in with your credentials.");
      setIsSignUp(false);
      return;
    }

    // Sign in flow
    const { data, error: authError } = await sb.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (authError) {
      if (isHardcodedAdmin) {
        // Attempt automatic sign-up for hardcoded super admin if not yet provisioned in Supabase Auth
        const { data: signUpData, error: signUpError } = await sb.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: "Super Admin", role: "super_admin" },
          },
        });
        if (!signUpError && signUpData.user) {
          await syncProfile(signUpData.user).catch(() => undefined);
          setLoading(false);
          router.push("/admin/orders");
          router.refresh();
          return;
        }
      }
      setLoading(false);
      return setError(authError.message === "Invalid login credentials" ? "Invalid email or password" : authError.message);
    }

    setEmail("");
    setPassword("");
    await syncProfile(data.user).catch(() => undefined);

    if (isHardcodedAdmin || cleanEmail === "bhawishk15@gmail.com") {
      setLoading(false);
      router.push("/admin/orders");
      router.refresh();
      return;
    }

    const role = resolveRole(data.user.email, data.user.app_metadata?.role);
    setLoading(false);
    router.push(destinationFor(role, next));
    router.refresh();
  };

  const signInWithGoogle = async () => {
    if (DEMO_MODE) return;
    setLoading(true);
    setError(null);
    const sb = supabaseBrowser();
    if (!sb) {
      setLoading(false);
      return setError("Authentication service unavailable.");
    }
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${next ?? "/"}` },
    });
    if (error) {
      setLoading(false);
      setError(error.message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-lg bg-card p-1 border border-white/10">
        <button
          type="button"
          onClick={() => { setIsSignUp(false); setError(null); setSuccess(null); }}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${!isSignUp ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => { setIsSignUp(true); setError(null); setSuccess(null); }}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${isSignUp ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {isSignUp && (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Full Name
              <Input
                type="text"
                autoComplete="name"
                required
                placeholder="e.g. Bhawish Kumar"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Phone Number
              <Input
                type="tel"
                autoComplete="tel"
                required
                placeholder="e.g. +92 300 1234567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Delivery Address
              <Input
                type="text"
                autoComplete="street-address"
                placeholder="e.g. Flat 4B, Clifton Block 2, Karachi"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <Input type="password" autoComplete={isSignUp ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}
        {success && <p role="status" className="text-sm text-sage-bright">{success}</p>}

        <Button size="lg" type="submit" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />} {isSignUp ? "Register" : "Sign in"}
        </Button>

        {!DEMO_MODE && !isSignUp && (
          <Button size="lg" type="button" variant="secondary" disabled={loading} onClick={signInWithGoogle}>
            Continue with Google
          </Button>
        )}
      </form>

      <div className="mt-4 rounded-lg border border-border/50 bg-secondary/30 p-3 text-xs text-muted-foreground leading-relaxed">
        <p className="font-semibold text-foreground/80 mb-1">💡 Multi-Account Testing Tip:</p>
        <p>
          Browsers share cookies &amp; storage across tabs on <code className="text-foreground/90 font-mono">localhost</code>.
          To test Super Admin and Customer simultaneously without session conflicts, open a separate <strong>Incognito Window</strong> or use a distinct <strong>Browser Profile</strong>.
        </p>
      </div>
    </div>
  );
}
