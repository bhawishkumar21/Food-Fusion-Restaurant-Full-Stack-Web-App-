import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/customer/site-header";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Accept Staff Invitation" };

export default function AcceptInvitePage() {
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative w-full max-w-md">
        <Link href="/" aria-label="Back to storefront">
          <Logo />
        </Link>
        <h1 className="font-display mt-10 text-4xl font-medium sm:text-5xl">
          Join <span className="italic text-gold">the Team</span>
        </h1>
        <p className="mb-8 mt-2 text-muted-foreground">
          Set up your password to activate your staff account and access your workspace.
        </p>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-card" />}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </main>
  );
}
