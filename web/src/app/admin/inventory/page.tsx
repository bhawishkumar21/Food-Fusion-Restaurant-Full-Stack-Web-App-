import type { Metadata } from "next";
import { InventoryPage } from "@/components/manager/manager-pages";

export const metadata: Metadata = { title: "Inventory" };

export default function AdminInventoryPage() {
  return <InventoryPage />;
}
