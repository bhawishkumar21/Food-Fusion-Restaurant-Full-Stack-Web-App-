import type { Metadata } from "next";
import { ReservationsPage } from "@/components/manager/manager-pages";

export const metadata: Metadata = { title: "Reservations" };

export default function Page() {
  return <ReservationsPage />;
}
