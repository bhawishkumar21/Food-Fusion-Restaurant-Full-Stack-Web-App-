// Mirrors the NestJS DTOs / Supabase rows (snake_case from Postgres is mapped
// to camelCase at the API boundary in lib/api.ts).

/** Strict 3-tier RBAC: owner, operations manager, customer. */
export type Role = "super_admin" | "manager" | "staff" | "user";

export type MenuTag = "vegan" | "high_protein" | "chef_special" | "quick_bite";
/** "all" or a category name, e.g. "BBQ". */
export type MenuFilter = "all" | (string & {});

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  /** Minor units (paisa for PKR), matching `price_cents` in Postgres. */
  priceCents: number;
  imageUrl: string | null;
  category: string;
  /** Merchandising label from the source menu, e.g. "Best Seller". */
  badge: string | null;
  tags: MenuTag[];
  isAvailable: boolean;
  voiceNotes: string | null;
  /** Portions left today (manager inventory); null = not tracked. */
  dailyStock: number | null;
}

export type OrderStatus = "new" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled";
export type Fulfilment = "pickup" | "delivery" | "dine_in";

export interface OrderLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  trackingCode: string;
  completedAt: string | null;
  status: OrderStatus;
  fulfilment: Fulfilment;
  channel: "web" | "voice";
  notes: string | null;
  phone?: string | null;
  deliveryAddress?: string | null;
  totalCents: number;
  /** Promo discount already taken off totalCents. */
  discountCents?: number;
  promoCode?: string | null;
  createdAt: string;
  items: OrderLine[];
}

export interface AdminOrder extends Order {
  customerName: string | null;
  customerEmail: string | null;
  customerPhone?: string | null;
}

export type Sentiment = "pending" | "positive" | "neutral" | "negative";
export type EscalationStatus = "open" | "escalated" | "resolved";

export interface Feedback {
  id: string;
  orderId: string;
  rating: number;
  text: string;
  source: "text" | "voice";
  sentiment: Sentiment;
  sentimentScore: number | null;
  aiSummary: string | null;
  escalationStatus: EscalationStatus | null;
  discountCode: string | null;
  createdAt: string;
}

export interface AnalyticsSummary {
  siteVisits: number;
  revenueCents: number;
  orders: number;
  cancelled: number;
  voiceOrders: number;
  avgTicketCents: number;
  revenueByDay: { day: string; revenueCents: number; orders: number }[];
  funnel: Partial<Record<"menu_view" | "cart_add" | "checkout_open" | "order_placed", number>>;
  sentiment: Partial<Record<"positive" | "neutral" | "negative", number>>;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: "starter" | "growth" | "enterprise";
  status: "active" | "suspended";
  menuItems: number;
  orders30d: number;
  revenue30dCents: number;
  createdAt: string;
}

export interface ApiLog {
  id: number;
  tenantId: string | null;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  level: "info" | "warn" | "error";
  createdAt: string;
}

export interface ApiUsage {
  byDay: { day: string; requests: number; errors: number }[];
  byTenant: { tenantId: string | null; requests: number; p95Ms: number; errorRate: number }[];
}

export type ReservationStatus = "requested" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";

export interface Reservation {
  id: string;
  reservedFor: string;
  partySize: number;
  guestName: string;
  phone: string | null;
  notes: string | null;
  status: ReservationStatus;
  tableLabel: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  email: string | null;
  role: Role;
  tenantId: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  /** The hardcoded super-admin account: its role is locked. */
  locked: boolean;
  status?: "active" | "pending";
  invitedAt?: string | null;
  inviteLink?: string | null;
}
