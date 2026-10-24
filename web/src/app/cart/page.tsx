import type { Metadata } from "next";
import { CartPage } from "@/components/customer/storefront-pages";

export const metadata: Metadata = { title: "Your order" };

export default function Page() {
  return <CartPage />;
}
