import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "sweep inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-tight transition-[background-color,color,box-shadow,transform,border-color] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_rgb(229_169_60/0.6)] hover:bg-[#EDB653]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[#2E2926]",
        outline: "border border-input bg-transparent text-foreground hover:border-primary/60 hover:text-primary",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        success: "bg-success text-cream hover:bg-[#359068]",
        destructive: "bg-destructive/15 text-[#F0A08F] hover:bg-destructive/25",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        default: "h-11 px-5 text-sm",
        lg: "h-14 px-7 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
