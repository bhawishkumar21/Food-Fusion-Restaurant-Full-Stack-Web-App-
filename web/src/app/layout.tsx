import type { Metadata, Viewport } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Food Fusion", template: "%s · Food Fusion" },
  description:
    "Chef-driven fusion dining, ordered in a sentence. Talk to our AI host or browse the menu.",
};

export const viewport: Viewport = {
  themeColor: "#0B0908",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${playfair.variable} h-full antialiased`}>
      <body className="min-h-full tracking-tight">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
