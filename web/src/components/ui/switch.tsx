"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors",
        "data-[state=checked]:bg-success data-[state=unchecked]:bg-[#3A3330] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-6 rounded-full bg-cream shadow-lg transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}
