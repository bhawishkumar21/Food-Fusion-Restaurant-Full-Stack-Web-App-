import type { Metadata } from "next";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

export const metadata: Metadata = { title: "Kitchen Display" };

export default function KitchenPage() {
  return <KitchenBoard />;
}
