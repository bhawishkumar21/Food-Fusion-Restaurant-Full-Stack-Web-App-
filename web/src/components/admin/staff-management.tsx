"use client";

import { Check, Copy, Loader2, Mail, Plus, Search, ShieldAlert, User, UserCog, UserPlus, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard/owner-pages";
import { StaffShell } from "@/components/shell/staff-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { DEMO_MODE, TENANT_ID } from "@/lib/config";
import type { Role, UserSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLES: { value: Extract<Role, "manager" | "staff" | "user">; label: string; icon: typeof User; hint: string }[] = [
  { value: "manager", label: "Manager", icon: UserCog, hint: "Orders, kitchen, inventory, reservations" },
  { value: "staff", label: "Staff", icon: UtensilsCrossed, hint: "Kitchen queue, chef tickets & availability" },
  { value: "user", label: "User", icon: User, hint: "Customer: menu, own orders & profile" },
];

const INVITABLE_ROLES: { value: Extract<Role, "manager" | "staff">; label: string; description: string }[] = [
  { value: "manager", label: "Operations Manager", description: "Full operational access: Overview, Live Orders, Inventory, and Reservations." },
  { value: "staff", label: "Kitchen Staff / Chef", description: "Direct kitchen queue access (KDS) and portion/availability toggles." },
];

const since = (iso: string | null) => {
  if (!iso) return "Never signed in";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? "Active today" : `Last seen ${days}d ago`;
};

/**
 * Owner-only user management and staff invitations.
 */
export function StaffManagement() {
  const [people, setPeople] = useState<UserSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Extract<Role, "manager" | "staff">>("manager");
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const load = () => {
    return api.users.list().then(setPeople).catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => (people ?? []).filter((p) => !query || (p.email ?? "").toLowerCase().includes(query.toLowerCase())),
    [people, query],
  );
  const counts = useMemo(() => {
    const c: Record<Role, number> = { super_admin: 0, manager: 0, staff: 0, user: 0 };
    (people ?? []).forEach((p) => c[p.role]++);
    return c;
  }, [people]);

  const setRole = async (person: UserSummary, role: Extract<Role, "manager" | "staff" | "user">) => {
    if (person.locked || role === person.role) return;
    setSaving(person.id);
    setError(null);
    try {
      // Managers and staff are scoped to this restaurant
      await api.users.setRole(person.id, role, role === "user" ? null : (person.tenantId ?? TENANT_ID));
      setPeople((list) => list?.map((p) => (p.id === person.id ? { ...p, role, tenantId: role === "user" ? null : (p.tenantId ?? TENANT_ID) } : p)) ?? null);
      setSaved(person.id);
      toast.success(`Role for ${person.email} updated to ${role}`);
      setTimeout(() => setSaved(null), 1600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not change role";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const result = await api.users.invite(inviteEmail.trim(), inviteRole, TENANT_ID);
      toast.success(`Invitation created for ${inviteEmail.trim()}!`);
      if (result.inviteLink) {
        setLastInviteLink(result.inviteLink);
      } else {
        setInviteOpen(false);
        setInviteEmail("");
      }
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to invite staff member.";
      setError(msg);
      toast.error(msg);
    } finally {
      setInviting(false);
    }
  };

  const copyLink = () => {
    if (!lastInviteLink) return;
    navigator.clipboard.writeText(lastInviteLink);
    setCopiedLink(true);
    toast.success("Invitation link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <StaffShell>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader eyebrow="Owner · Staff" title="Staff & access">
            <div className="flex gap-2 text-xs">
              {ROLES.map((r) => (
                <Badge key={r.value} variant="muted" className="h-7 px-3">
                  <r.icon /> {counts[r.value]} {r.label}
                </Badge>
              ))}
            </div>
          </PageHeader>
          <Button onClick={() => { setInviteOpen(true); setLastInviteLink(null); }} className="gap-2 self-start sm:self-auto">
            <UserPlus className="size-4" />
            Invite Staff Member
          </Button>
        </div>

        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border bg-charcoal/50 px-4 py-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold" />
          Role changes take effect on the person&apos;s next sign-in or token refresh.
          {DEMO_MODE && " Demo mode: changes are stored in this browser only."}
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search staff by email" aria-label="Search staff by email" className="pl-11" />
        </div>
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}

        <Card>
          <CardContent className="divide-y p-0">
            {people === null ? (
              <div className="h-64 animate-pulse" />
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No staff members found</div>
            ) : (
              filtered.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{p.email ?? "(no email)"}</p>
                      {p.status === "pending" ? (
                        <Badge variant="warning" className="text-[0.65rem] uppercase">Pending invite</Badge>
                      ) : (
                        <Badge variant="success" className="text-[0.65rem] uppercase">Active</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {p.status === "pending" && p.invitedAt ? `Invited ${new Date(p.invitedAt).toLocaleDateString()}` : since(p.lastSignInAt)}
                    </p>
                  </div>
                  <div role="radiogroup" aria-label={`Role for ${p.email}`} className="flex gap-1 rounded-full bg-secondary p-1">
                    {p.locked ? (
                      <span className="flex h-9 items-center rounded-full bg-gold px-3 text-xs font-medium text-primary-foreground">Super admin · locked</span>
                    ) : ROLES.map((r) => (
                      <button
                        key={r.value}
                        role="radio"
                        aria-checked={p.role === r.value}
                        title={r.hint}
                        disabled={saving === p.id || p.locked}
                        onClick={() => void setRole(p, r.value)}
                        className={cn(
                          "flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-wait",
                          p.role === r.value
                            ? r.value === "manager"
                                ? "bg-sage text-cream"
                                : "bg-velvet text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <r.icon className="size-3.5" />
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <span className="grid w-5 place-items-center" aria-live="polite">
                    {saving === p.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                    {saved === p.id && <Check className="size-4 text-sage-bright" aria-label="Saved" />}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Staff Invitation Modal */}
      <AnimatedDialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setLastInviteLink(null);
            setInviteEmail("");
          }
        }}
        title="Invite Staff Member"
        description="Send an invitation link to grant operational permissions to new restaurant staff."
      >
        {!lastInviteLink ? (
          <form onSubmit={handleInvite} className="flex flex-col gap-5 pt-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email Address
              <Input
                type="email"
                required
                placeholder="colleague@foodfusion.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium mb-1">Assign Role</legend>
              <div className="grid grid-cols-1 gap-2">
                {INVITABLE_ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setInviteRole(r.value)}
                    className={cn(
                      "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                      inviteRole === r.value ? "border-gold bg-gold/10" : "border-white/10 hover:border-white/20"
                    )}
                  >
                    <span className="text-sm font-semibold">{r.label}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">{r.description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <Button type="submit" disabled={inviting || !inviteEmail.trim()} className="mt-2 w-full">
              {inviting ? <Loader2 className="animate-spin size-4" /> : <Mail className="size-4" />}
              {inviting ? "Creating invitation..." : "Send Invitation"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border border-sage/40 bg-sage/10 p-4 text-sm text-sage-bright">
              <p className="font-semibold">Invitation Generated Successfully!</p>
              <p className="mt-1 text-xs text-cream/80">
                A magic signup link has been created for <span className="font-medium text-cream">{inviteEmail}</span> as {inviteRole}. You can copy and share it directly:
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={lastInviteLink}
                className="font-mono text-xs bg-charcoal/80"
              />
              <Button size="icon" onClick={copyLink} title="Copy invitation link">
                {copiedLink ? <Check className="size-4 text-sage-bright" /> : <Copy className="size-4" />}
              </Button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setLastInviteLink(null);
                  setInviteEmail("");
                }}
              >
                Invite Another
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setInviteOpen(false);
                  setLastInviteLink(null);
                  setInviteEmail("");
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </AnimatedDialog>
    </StaffShell>
  );
}
