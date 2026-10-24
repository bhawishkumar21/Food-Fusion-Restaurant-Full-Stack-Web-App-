import type { Metadata } from "next";
import { FinancePage } from "@/components/dashboard/owner-pages";

export const metadata: Metadata = { title: "Finance" };

export default function Page() {
  return <FinancePage />;
}
