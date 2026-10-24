# Food Fusion

AI-powered, multi-tenant restaurant platform: a voice-first storefront with a rotary-dial order review, a live Kitchen Display System, manager operations (inventory, reservations) and an owner console (analytics, finance, staff, menu).

```
.
├── src/                    NestJS API gateway (auth guards, RBAC, Socket.io, n8n, ElevenLabs)
├── supabase/
│   ├── migrations/         Schema, RLS policies, place_order / analytics functions
│   ├── seed.sql            Demo tenant + 12-dish menu
│   └── tests/rls.test.mjs  RLS test suite (runs the real migration in PGlite)
└── web/                    Next.js 16 App Router frontend
```

## Quick start (demo mode, no credentials)

```bash
cd web
npm install
npm run dev -- -p 3001
```

With no `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SUPABASE_URL` set, the frontend runs a self-contained demo: data lives in `localStorage` and realtime events travel between tabs over `BroadcastChannel`. Open `/` and `/kitchen` side by side, then place an order and watch it arrive. Use `/login` to switch between Customer, Manager and Super Admin. The voice agent uses the browser's own speech recognition and synthesis (Chrome/Edge; typing works everywhere) and calls the same client tools the ElevenLabs agent uses, so "add 2 Peshawari Karahi and 1 Club Sandwich" lands straight in the cart.

Build tip on low-memory machines: `CIRCLE_NODE_TOTAL=1 npx next build` limits Next to one build worker.

## Full stack

1. **Supabase**: apply `supabase/migrations/*` then `supabase/seed.sql`. Enable *Anonymous sign-ins* (guests order without an account).
2. **Assign staff roles** (service role only; users cannot change their own `app_metadata`):
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin","tenant_id":"f00df051-0000-4000-8000-000000000001"}'
   where email = 'owner@example.com';
   ```
   That bootstraps the first owner; after that, manage everyone from **/staff-management**. Roles are strictly 3-tier:

   | Role | Who | Routes | Can |
   |---|---|---|---|
   | `super_admin` | Restaurant owner | everything, incl. `/admin`, `/analytics`, `/finance`, `/staff-management`, `/menu-editor` | Full CRUD, prices, staff roles, revenue, feedback & discount codes |
   | `manager` | Operations / HR, one restaurant (needs `tenant_id`) | `/manager`, `/kitchen`, `/inventory`, `/table-reservations` | Read/update orders, availability & daily stock, reservations |
   | `user` (default) | Customers, incl. anonymous guests | `/`, `/menu`, `/cart`, `/orders/track` | Read menu, create own orders, own profile & bookings |

   Older role names (`owner`, `kitchen`, `customer`) are remapped by migration `20261012000000_three_tier_rbac.sql` and still accepted from not-yet-refreshed JWTs.
3. **API**: `cp .env.example .env`, fill it in, then `npm install && npm run start:dev` (port 4000).
4. **Web**: `cp web/.env.example web/.env.local`, then `npm run dev -- -p 3001` in `web/`.

### ElevenLabs agent

Create a Conversational AI agent and reference `{{menu}}` and `{{restaurant_name}}` in its prompt (the API injects the live menu as dynamic variables). Add these **client tools** with the matching parameters:

| Tool | Parameters | Effect on screen |
|---|---|---|
| `filter_menu` | `category`: a menu category name (e.g. "BBQ", "Desserts") or "all" | Switches the category chip; replies with valid categories if no match |
| `highlight_items` | `item_ids`: comma-separated ids | Glows the cards, "Suggested" badge |
| `add_to_cart` | `item_id`, `quantity?` | Adds to cart; refuses sold-out items |
| `add_items` | `order`: free text, e.g. "2 peshawari karahi and 1 club sandwich" | Parses and adds several dishes at once |
| `remove_from_cart` | `item_id` | Removes from cart |
| `view_cart` | – | Opens the cart drawer, returns contents |
| `checkout` | – | Opens checkout |

If a dish sells out mid-call (a manual 86, or its daily stock reaching zero), the browser pushes it to the agent with `sendContextualUpdate`.

### n8n customer-feedback workflow

For a verified completed order, `POST /feedback` records the review and then
asynchronously posts the following payload to `N8N_FEEDBACK_WEBHOOK_URL` with
an `x-webhook-secret` header. Configure the production `/webhook/...` URL,
not n8n's temporary `/webhook-test/...` URL.

```json
{
  "order_id": "ORD-1092",
  "customer_name": "Bhavesh Kumar",
  "customer_email": "bhawishk15@gmail.com",
  "customer_phone": "+923000000000",
  "rating_stars": 5,
  "feedback_text": "The Peshawari Karahi was incredible, steaming hot and perfectly spiced!",
  "items_ordered": ["Chicken Peshawari Karahi", "Roti"]
}
```

The workflow can run sentiment analysis, generate a voucher, log the review,
and send Slack/Gmail alerts before posting its sentiment result back:

```http
POST {callbackUrl}            # /api/webhooks/n8n/sentiment
x-webhook-secret: <N8N_WEBHOOK_SECRET>

{ "feedbackId": "…", "sentiment": "negative", "score": -0.8, "summary": "Cold food, late delivery" }
```

Negative results open an escalation and are pushed live to the owner's analytics view over Socket.io.

## Security model: three independent layers

| Layer | Where | What it enforces |
|---|---|---|
| Route gating | `web/src/proxy.ts` | Which screens a role can open (UX only) |
| API guards | `src/auth/*.guard.ts` | Authentication (Supabase JWT via JWKS), `@Roles()` with inheritance, tenant isolation on `/t/:tenantId/*` |
| Postgres RLS | `supabase/migrations` | Every row read and write, including column guards (managers may only change availability and daily stock; staff may only change order status) and daily-stock enforcement inside `place_order()` |

The API calls Supabase *as the user* (`SupabaseService.forUser`), so RLS applies to every request. The service-role client is used only for the n8n callback, API logging and super-admin routes. Prices are never trusted from the client: `place_order()` reads them from the database.

## Tests

```bash
npm test            # RBAC guard unit tests
npm run test:e2e    # API boots, /api/health
npm run test:rls    # 30 RLS checks per role, against all migrations (PGlite)
cd web && npx tsc --noEmit && npm run lint && npm run build
```

## Design system

The tokens live in `web/src/app/globals.css` under `@theme` (Tailwind v4 has no `tailwind.config.js`). Everything is defined there: espresso/velvet surfaces, amber-gold and saffron accents, cream text, emerald sage for success, and Inter with editorial tracking. Chart colours (`--color-chart-*`) are validated for colour-blind separation and contrast against the card surface. `web/components.json` is configured so `npx shadcn add <component>` picks up the theme.
