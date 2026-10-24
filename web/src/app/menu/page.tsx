import type { Metadata } from "next";
import { MenuPage } from "@/components/customer/storefront-pages";

export const metadata: Metadata = { title: "Menu" };

export default function Page() {
  return <MenuPage />;
}
