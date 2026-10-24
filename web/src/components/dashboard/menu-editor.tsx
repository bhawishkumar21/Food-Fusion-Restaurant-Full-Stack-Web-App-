"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, MessageSquareText } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, normalise } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import type { MenuItem } from "@/lib/types";
import { loadDirect, sizedImage } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Menu & voice knowledge base: every change is live for customers and the AI host. */
export function MenuEditor() {
  const [items, setItems] = useState<MenuItem[] | null>(null);

  useEffect(() => {
    void api.menu.list().then(setItems);
    void realtime.connect();
    return realtime.on("menu:item-updated", (p) => {
      const item = normalise.menuItem(p);
      setItems((list) => list?.map((i) => (i.id === item.id ? item : i)) ?? null);
    });
  }, []);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Menu & voice knowledge base</CardTitle>
          <CardDescription>Prices, availability and the notes the AI host uses when describing each dish.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-secondary" />
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <EditorRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EditorRow({ item }: { item: MenuItem }) {
  // Drafts are null while not being edited, so remote edits (another manager,
  // the KDS 86 toggle) show through immediately.
  const [priceDraft, setPrice] = useState<string | null>(null);
  const [notesDraft, setNotes] = useState<string | null>(null);
  const price = priceDraft ?? (item.priceCents / 100).toFixed(2);
  const notes = notesDraft ?? item.voiceNotes ?? "";
  const [notesOpen, setNotesOpen] = useState(false);
  const [state, setState] = useState<SaveState>("idle");

  const save = async (patch: Parameters<typeof api.menu.update>[1]) => {
    setState("saving");
    try {
      await api.menu.update(item.id, patch);
      setState("saved");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("error");
    }
  };

  const commitPrice = () => {
    const cents = Math.round(Number(price) * 100);
    setPrice(null);
    if (Number.isFinite(cents) && cents >= 0 && cents !== item.priceCents) void save({ priceCents: cents });
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)]">
          {item.imageUrl && <Image src={sizedImage(item.imageUrl, 160)!} alt="" fill sizes="48px" unoptimized={loadDirect(item.imageUrl)} className="object-cover" />}
        </div>
        <div className="min-w-40 flex-1">
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.category}{item.badge && ` · ${item.badge}`}</p>
        </div>

        <label className="relative w-28">
          <span className="sr-only">Price for {item.name}</span>
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="pl-7 tabular-nums"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={item.isAvailable}
            onCheckedChange={(v) => void save({ isAvailable: v })}
            aria-label={`${item.name} available`}
          />
          <span className="w-16">{item.isAvailable ? "On menu" : "Sold out"}</span>
        </label>

        <Button size="icon-sm" variant="ghost" aria-expanded={notesOpen} aria-label="Edit voice notes" onClick={() => setNotesOpen((o) => !o)}>
          <MessageSquareText className={notesOpen ? "text-primary" : undefined} />
        </Button>

        <span className="grid w-5 place-items-center" aria-live="polite">
          {state === "saving" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {state === "saved" && <Check className="size-4 text-sage-bright" aria-label="Saved" />}
          {state === "error" && <span className="text-xs text-[#F4A190]">!</span>}
        </span>
      </div>

      <AnimatePresence>
        {notesOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-2 pt-3 sm:pl-16">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder="Allergens, protein, spice level, pairings — what the AI host should know."
                aria-label={`Voice notes for ${item.name}`}
              />
              <Button size="sm" variant="secondary" className="self-end" disabled={notes === (item.voiceNotes ?? "")} onClick={() => {
                  void save({ voiceNotes: notes });
                  setNotes(null);
                }}>
                Save notes
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
