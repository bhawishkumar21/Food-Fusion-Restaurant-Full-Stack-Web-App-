import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold tracking-wide [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        muted: "bg-secondary text-muted-foreground",
        success: "bg-success/20 text-[#7FD3AE]",
        warning: "bg-saffron/20 text-[#F2B77A]",
        destructive: "bg-destructive/20 text-[#F4A190]",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
