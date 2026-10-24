import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-[var(--radius-md)] border border-input bg-charcoal/60 px-4 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn(field, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(field, "min-h-24 resize-none py-3", className)} {...props} />;
}
