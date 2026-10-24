import type { Metadata } from "next";
import { AnalyticsPage } from "@/components/dashboard/owner-pages";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return <AnalyticsPage />;
}
