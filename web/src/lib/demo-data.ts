import ghalibMenu from "@/data/food_fusion_menu.json";
import type {
  AnalyticsSummary,
  ApiLog,
  ApiUsage,
  Feedback,
  MenuItem,
  Reservation,
  UserSummary,
  Order,
  Tenant,
} from "./types";

// Storefront menu: Ghalib Restaurant, scraped by scripts/scrape-ghalib-menu.mjs.
// Re-run `npm run scrape:ghalib` at the repo root to refresh it.
const toMenuItem = (i: (typeof ghalibMenu.items)[number]): MenuItem => ({
  id: i.id,
  name: i.name,
  description: i.description ?? "",
  priceCents: Math.round(i.price * 100), // rupees → paisa
  imageUrl: i.image_url,
  category: i.category,
  badge: "tag" in i && typeof i.tag === "string" ? i.tag : null,
  tags: [], // the source menu carries no dietary tags; none are inferred
  isAvailable: true,
  dailyStock: null,
  voiceNotes: "sizes" in i && Array.isArray(i.sizes)
    ? `Sizes: ${i.sizes.map((s) => `${s.size} PKR ${s.price}`).join(", ")}.`
    : null,
});

export const DEMO_MENU: MenuItem[] = ghalibMenu.items.map(toMenuItem);
/** Category order as it appears on the source menu. */
export const MENU_CATEGORIES: string[] = ghalibMenu.categories.map((c) => c.name);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const line = (name: string, quantity: number) => {
  const m = DEMO_MENU.find((x) => x.name === name) ?? DEMO_MENU[0];
  return { menuItemId: m.id, name: m.name, quantity, unitPriceCents: m.priceCents };
};
const order = (
  id: string,
  status: Order["status"],
  age: number,
  items: Order["items"],
  extra: Partial<Order> = {},
): Order => ({
  id,
  trackingCode: `ORD-${id.slice(-4).toUpperCase()}`,
  completedAt: status === "completed" ? minutesAgo(age) : null,
  status,
  fulfilment: "pickup",
  channel: "web",
  notes: null,
  totalCents: items.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
  createdAt: minutesAgo(age),
  items,
  ...extra,
});

export function seedOrders(): Order[] {
  return [
    order("0d3e0000-0000-4000-8000-00000000a1b2", "new", 2, [line("Chicken Peshawari Karahi", 1), line("Garlic Naan", 2)], { channel: "voice" }),
    order("0d3e0000-0000-4000-8000-00000000c3d4", "preparing", 9, [line("Mix Kabab Platter", 1), line("Mint Lemonade", 2)], { fulfilment: "delivery", notes: "Extra raita, mild spice please" }),
    order("0d3e0000-0000-4000-8000-00000000e5f6", "preparing", 23, [line("Chicken Makhni Handi", 2)], { fulfilment: "dine_in" }),
    order("0d3e0000-0000-4000-8000-00000000a7b8", "ready", 4, [line("Chicken Corn Soup", 1), line("Dynamite Chicken (New)", 1)]),
  ];
}

export function seedFeedback(): Feedback[] {
  return [
    {
      id: "fb000000-0000-4000-8000-000000000001",
      orderId: "0d3e0000-0000-4000-8000-00000000c3d4",
      rating: 2,
      text: "The kabab platter arrived lukewarm and the delivery took almost an hour. Flavour was great but I was disappointed.",
      source: "voice",
      sentiment: "negative",
      sentimentScore: -0.71,
      aiSummary: "Late delivery, food arrived cold.",
      escalationStatus: "open",
      discountCode: null,
      createdAt: minutesAgo(38),
    },
    {
      id: "fb000000-0000-4000-8000-000000000002",
      orderId: "0d3e0000-0000-4000-8000-00000000e5f6",
      rating: 1,
      text: "Asked for the palak paneer without cream because I am lactose intolerant, but it came with cream on top.",
      source: "text",
      sentiment: "negative",
      sentimentScore: -0.92,
      aiSummary: "Dietary request ignored: cream added despite intolerance.",
      escalationStatus: "escalated",
      discountCode: null,
      createdAt: minutesAgo(130),
    },
  ];
}

export function demoAnalytics(): AnalyticsSummary {
  // Deterministic pseudo-random so the chart doesn't jump between renders.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const revenueByDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const weekend = [5, 6].includes(d.getDay());
    const orders = Math.round((weekend ? 120 : 82) + rand() * 30 + i * 0.9);
    return {
      day: d.toISOString().slice(0, 10),
      orders,
      revenueCents: Math.round(orders * (310_000 + rand() * 90_000)) // PKR 3,100–4,000 tickets, in paisa,
    };
  });
  const revenueCents = revenueByDay.reduce((s, d) => s + d.revenueCents, 0);
  const orders = revenueByDay.reduce((s, d) => s + d.orders, 0);
  return {
    siteVisits: Math.round(orders * 2.6),
    revenueCents,
    orders,
    cancelled: 41,
    voiceOrders: Math.round(orders * 0.34),
    avgTicketCents: Math.round(revenueCents / orders),
    revenueByDay,
    funnel: { menu_view: Math.round(orders * 2.6), cart_add: Math.round(orders * 1.55), checkout_open: Math.round(orders * 1.18), order_placed: orders },
    sentiment: { positive: 412, neutral: 96, negative: 38 },
  };
}

export const DEMO_TENANTS: Tenant[] = [
  { id: "f00df051-0000-4000-8000-000000000001", name: "Food Fusion — Downtown", slug: "food-fusion-downtown", plan: "enterprise", status: "active", menuItems: ghalibMenu.item_count, orders30d: 3204, revenue30dCents: 1_153_440_000, createdAt: "2026-02-11T10:00:00Z" },
  { id: "f00df051-0000-4000-8000-000000000002", name: "Food Fusion — Harbourside", slug: "food-fusion-harbour", plan: "growth", status: "active", menuItems: 18, orders30d: 2140, revenue30dCents: 748_000_000, createdAt: "2026-04-02T10:00:00Z" },
  { id: "f00df051-0000-4000-8000-000000000003", name: "Saffron & Smoke", slug: "saffron-smoke", plan: "growth", status: "active", menuItems: 24, orders30d: 1488, revenue30dCents: 520_800_000, createdAt: "2026-06-19T10:00:00Z" },
  { id: "f00df051-0000-4000-8000-000000000004", name: "Noodle Atelier", slug: "noodle-atelier", plan: "starter", status: "suspended", menuItems: 9, orders30d: 0, revenue30dCents: 0, createdAt: "2026-08-30T10:00:00Z" },
];

export function demoUsage(): ApiUsage {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    byDay: Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const requests = Math.round(38_000 + rand() * 14_000 + i * 600);
      return { day: d.toISOString().slice(0, 10), requests, errors: Math.round(requests * (0.002 + rand() * 0.004)) };
    }),
    byTenant: DEMO_TENANTS.map((t, i) => ({
      tenantId: t.id,
      requests: [312_000, 201_400, 148_900, 2_100][i],
      p95Ms: [142, 168, 189, 95][i],
      errorRate: [0.0021, 0.0034, 0.0061, 0][i],
    })),
  };
}

const ROUTES = ["/api/t/:tenantId/menu", "/api/t/:tenantId/orders", "/api/t/:tenantId/orders/:id/status", "/api/t/:tenantId/voice/session", "/api/t/:tenantId/feedback", "/api/webhooks/n8n/sentiment"];
export function demoLogs(count = 60): ApiLog[] {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, (_, i) => {
    const r = rand();
    const status = r > 0.97 ? 502 : r > 0.9 ? 403 : r > 0.86 ? 400 : 200;
    return {
      id: 10_000 - i,
      tenantId: DEMO_TENANTS[Math.floor(rand() * 3)].id,
      method: rand() > 0.6 ? "PATCH" : rand() > 0.5 ? "POST" : "GET",
      route: ROUTES[Math.floor(rand() * ROUTES.length)],
      status,
      durationMs: Math.round(20 + rand() * (status === 502 ? 4800 : 220)),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      createdAt: new Date(Date.now() - i * 47_000).toISOString(),
    } satisfies ApiLog;
  });
}

export function seedReservations(): Reservation[] {
  const at = (dayOffset: number, hh: number, mm = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };
  const r = (id: number, reservedFor: string, partySize: number, guestName: string, status: Reservation["status"], extra: Partial<Reservation> = {}): Reservation => ({
    id: `5e5e0000-0000-4000-8000-0000000000${String(id).padStart(2, "0")}`,
    reservedFor,
    partySize,
    guestName,
    phone: "+92 300 0000000",
    notes: null,
    status,
    tableLabel: null,
    createdAt: new Date().toISOString(),
    ...extra,
  });
  return [
    r(1, at(0, 19), 4, "Ayesha Khan", "confirmed", { tableLabel: "T4" }),
    r(2, at(0, 19, 30), 2, "Bilal Ahmed", "requested", { notes: "Window seat if possible" }),
    r(3, at(0, 20), 6, "Sana Malik", "requested", { notes: "Birthday — cake at 9pm" }),
    r(4, at(0, 20, 30), 3, "Omar Farooq", "seated", { tableLabel: "T7" }),
    r(5, at(0, 21, 15), 8, "Hamza Sheikh", "confirmed", { tableLabel: "T12" }),
    r(6, at(1, 19), 2, "Zara Hussain", "requested"),
    r(7, at(1, 20), 5, "Usman Tariq", "requested", { notes: "One high chair" }),
  ];
}

export function seedStaff(): UserSummary[] {
  const t = "f00df051-0000-4000-8000-000000000001";
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  return [
    { id: "51af0000-0000-4000-8000-000000000001", email: "bhawishk15@gmail.com", role: "super_admin", tenantId: t, lastSignInAt: ago(0), createdAt: ago(240), locked: true },
    { id: "51af0000-0000-4000-8000-000000000002", email: "nadia.ops@ghalib.pk", role: "manager", tenantId: t, lastSignInAt: ago(0), createdAt: ago(180), locked: false },
    { id: "51af0000-0000-4000-8000-000000000003", email: "kamran.floor@ghalib.pk", role: "manager", tenantId: t, lastSignInAt: ago(2), createdAt: ago(95), locked: false },
    { id: "51af0000-0000-4000-8000-000000000004", email: "fatima.chef@ghalib.pk", role: "staff", tenantId: t, lastSignInAt: ago(1), createdAt: ago(12), locked: false },
    { id: "51af0000-0000-4000-8000-000000000005", email: "ali.r@gmail.com", role: "user", tenantId: null, lastSignInAt: ago(3), createdAt: ago(40), locked: false },
    { id: "51af0000-0000-4000-8000-000000000006", email: "hira.s@outlook.com", role: "user", tenantId: null, lastSignInAt: null, createdAt: ago(1), locked: false },
  ];
}
