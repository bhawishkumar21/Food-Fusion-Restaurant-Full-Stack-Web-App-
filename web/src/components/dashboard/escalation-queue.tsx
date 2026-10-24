"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, CheckCircle2, Keyboard, Loader2, Siren, Star, TicketPercent } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import type { Feedback } from "@/lib/types";
import { minutesSince, shortId } from "@/lib/utils";

const ago = (iso: string) => {
  const m = minutesSince(iso);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
};

export function EscalationQueue() {
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.feedback.escalations().then(setItems).catch((e: Error) => setError(e.message));
    void realtime.connect();
    return realtime.on("feedback:flagged", (p) => {
      const fb = normalise.feedback(p);
      setItems((list) => [fb, ...(list ?? []).filter((f) => f.id !== fb.id)]);
    });
  }, []);

  const patch = (fb: Feedback) => setItems((list) => list?.map((f) => (f.id === fb.id ? fb : f)) ?? null);

  const run = async (id: string, fn: () => Promise<Feedback>) => {
    setBusy(id);
    setError(null);
    try {
      patch(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const open = items?.filter((f) => f.escalationStatus !== "resolved" || f.discountCode) ?? [];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Feedback escalations
            {open.filter((f) => !f.discountCode).length > 0 && (
              <Badge variant="destructive">{open.filter((f) => !f.discountCode).length} need attention</Badge>
            )}
          </CardTitle>
          <CardDescription>Negative reviews flagged by AI sentiment, newest first.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {error && <p role="alert" className="text-sm text-[#F4A190]">{error}</p>}
        {items === null ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-md)] bg-secondary" />
        ) : open.length === 0 ? (
          <p className="m-auto flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-sage-bright" /> Nothing to resolve. Nice work.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {open.map((f) => (
                <motion.li
                  key={f.id}
                  layout
                  initial={{ opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  className="rounded-[var(--radius-md)] border bg-charcoal/60 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex" aria-label={`${f.rating} of 5 stars`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={n <= f.rating ? "size-3.5 fill-primary text-primary" : "size-3.5 text-cream/15"} />
                      ))}
                    </span>
                    <span>Order {shortId(f.orderId)}</span>
                    <span className="flex items-center gap-1">
                      {f.source === "voice" ? <AudioLines className="size-3" /> : <Keyboard className="size-3" />}
                      {f.source}
                    </span>
                    <span className="ml-auto">{ago(f.createdAt)}</span>
                  </div>
                  {f.aiSummary && <p className="mt-2 font-medium">{f.aiSummary}</p>}
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">“{f.text}”</p>
                  {f.sentimentScore !== null && (
                    <p className="mt-2 text-xs text-muted-foreground">AI sentiment score {f.sentimentScore.toFixed(2)}</p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {f.discountCode ? (
                      <Badge variant="success" className="h-8 px-3 text-xs">
                        <TicketPercent /> Code {f.discountCode} sent · resolved
                      </Badge>
                    ) : (
                      <>
                        <Button size="sm" disabled={busy === f.id} onClick={() => run(f.id, () => api.feedback.issueDiscount(f.id, 15))}>
                          {busy === f.id ? <Loader2 className="animate-spin" /> : <TicketPercent />}
                          Issue 15% code
                        </Button>
                        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
                          <Siren className={f.escalationStatus === "escalated" ? "size-4 text-[#F4A190]" : "size-4 text-muted-foreground"} />
                          Escalated
                          <Switch
                            checked={f.escalationStatus === "escalated"}
                            disabled={busy === f.id}
                            onCheckedChange={(v) => run(f.id, () => api.feedback.setEscalation(f.id, v ? "escalated" : "open"))}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
