import type { Metadata } from "next";
import { OrdersDashboard } from "@/components/admin/orders-dashboard";

export const metadata: Metadata = { title: "Live orders" };
export default function Page() { return <OrdersDashboard />; }
