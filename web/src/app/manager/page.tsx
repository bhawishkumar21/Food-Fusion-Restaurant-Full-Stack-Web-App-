import type { Metadata } from "next";
import { ManagerOverview } from "@/components/manager/manager-pages";

export const metadata: Metadata = { title: "Floor overview" };

export default function Page() {
  return <ManagerOverview />;
}
