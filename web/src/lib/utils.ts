import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Prices are stored in minor units (paisa) and shown as "PKR 1,990".
const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactAmount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const CURRENCY = "PKR";
export const formatPrice = (minor: number) => `${CURRENCY} ${amount.format(minor / 100)}`;
export const formatCompactPrice = (minor: number) => `${CURRENCY} ${compactAmount.format(minor / 100)}`;

export const shortId = (id: string) => `#${id.slice(-4).toUpperCase()}`;

export function minutesSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/**
 * Indolj (Ghalib's media CDN) serves ~1 MB originals with no resizing and no
 * edge cache, which makes Next's optimizer hit its fixed 7s upstream timeout.
 * Those images are loaded straight from the CDN instead (lazily, per card).
 */
export const loadDirect = (url: string | null) => Boolean(url?.includes("assets.indolj.io"));

/** Unsplash images are requested at the size they render. */
export function sizedImage(url: string | null, width: number) {
  if (!url) return null;
  return url.includes("images.unsplash.com")
    ? `${url}?auto=format&fit=crop&w=${width}&q=75`
    : url;
}
