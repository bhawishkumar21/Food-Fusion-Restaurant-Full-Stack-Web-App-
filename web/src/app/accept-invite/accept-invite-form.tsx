"use client";

import { CheckCircle2, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { destinationFor, resolveRole } from "@/lib/config";
import { supabaseBrowser, syncProfile } from "@/lib/supabase/client";

export function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      setVerifying(false);
      return;
    }

    // Check if session is already established from the invite token redirect
    void sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUserEmail(data.session.user.email ?? null);
        const name = (data.session.user.user_metadata?.full_name as string) || "";
        if (name && name !== "STAFF" && name !== "MANAGER") {
          setFullName(name);
        }
        setVerifying(false);
      } else {
        // Also listen for auth state change if the token is parsed asynchronously from the URL hash
        const { data: authListener } = sb.auth.onAuthStateChange((event, session) => {
          if (session?.user) {
            setUserEmail(session.user.email ?? null);
            setVerifying(false);
          }
        });

        // Timeout fallback
        const timer = setTimeout(() => {
          setVerifying(false);
        }, 1500);

        return () => {
          authListener.subscription.unsubscribe();
          clearTimeout(timer);
        };
      }
    });
  }, [searchParams]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      return setError("Password must be at least 6 characters.");
    }
    if (password !== confirmPassword) {
      return setError("Passwords do not match.");
    }

    setLoading(true);
    setError(null);

    const sb = supabaseBrowser();
    if (!sb) {
      setLoading(false);
      return setError("Authentication service unavailable.");
    }

    try {
      const { data, error: updateError } = await sb.auth.updateUser({
        password,
        data: {
          ...(fullName.trim() ? { full_name: fullName.trim(), name: fullName.trim() } : {}),
        },
      });

      if (updateError) {
        setLoading(false);
        return setError(updateError.message || "Failed to set password. Please try again.");
      }

      if (data.user) {
        await syncProfile(data.user).catch(() => undefined);
        setSuccess(true);

        const assignedRole = resolveRole(data.user.email, data.user.app_metadata?.role);
        const targetPath = destinationFor(assignedRole, null);

        setTimeout(() => {
          router.push(targetPath);
          router.refresh();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-gold" />
        <p className="text-sm">Verifying invitation credentials...</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-sage/40 bg-card p-8 text-center shadow-velvet">
        <div className="grid size-12 place-items-center rounded-full bg-success text-cream">
          <CheckCircle2 className="size-6" />
        </div>
        <h2 className="text-xl font-semibold">Account Activated!</h2>
        <p className="text-sm text-muted-foreground">
          Your credentials have been confirmed. Redirecting you to your workspace...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {userEmail && (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-secondary/50 px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-gold" />
          <span>Invited as: <strong className="text-foreground">{userEmail}</strong></span>
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Full Name
        <Input
          type="text"
          autoComplete="name"
          placeholder="e.g. Chef John Doe"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Create Password
        <Input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Minimum 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Confirm Password
        <Input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Re-enter password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>

      {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

      <Button size="lg" type="submit" disabled={loading} className="mt-2">
        {loading ? <Loader2 className="animate-spin" /> : <Lock className="size-4" />}
        {loading ? "Activating account..." : "Activate & Open Workspace"}
      </Button>
    </form>
  );
}
