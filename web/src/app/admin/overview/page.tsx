import type { Metadata } from "next";
import { ManagerOverview } from "@/components/manager/manager-pages";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return <ManagerOverview />;
}
