import type { Metadata } from "next";
import { MenuEditorPage } from "@/components/dashboard/owner-pages";

export const metadata: Metadata = { title: "Menu editor" };

export default function Page() {
  return <MenuEditorPage />;
}
