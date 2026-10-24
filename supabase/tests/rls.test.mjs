import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs every real migration + seed in an in-process Postgres (PGlite) with
// minimal Supabase auth stubs, then asserts the 3-tier RLS rules role by role.
const root = fileURLToPath(new URL('../..', import.meta.url));
const migrations = fs.readdirSync(`${root}/supabase/migrations`).filter((f) => f.endsWith('.sql')).sort();
const db = new PGlite({ extensions: { pgcrypto } });

// Minimal Supabase auth stubs.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb not null default '{}');
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(auth.jwt()->>'role','anon') $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  create publication supabase_realtime;
`);

const T1 = 'f00df051-0000-4000-8000-000000000001';
const T2 = 'f00df051-0000-4000-8000-000000000002';
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const MGR = 'aaaaaaaa-0000-4000-8000-000000000003';
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000004';
const LEGACY_CHEF = 'aaaaaaaa-0000-4000-8000-000000000005';
const FORGED = 'aaaaaaaa-0000-4000-8000-000000000006';
const CHEF = 'aaaaaaaa-0000-4000-8000-000000000007';
const OWNER_EMAIL = 'bhawishk15@gmail.com';
const ITEM = 'f00d0000-0000-4000-8000-000000000001';
const ITEM2 = 'f00d0000-0000-4000-8000-000000000004';

// Migration 1, then pre-3-tier users, then the rest, so the role remap is exercised.
await db.exec(fs.readFileSync(`${root}/supabase/migrations/${migrations[0]}`, 'utf8'));
await db.exec(fs.readFileSync(`${root}/supabase/seed.sql`, 'utf8'));
await db.exec(`
  insert into tenants (id,name,slug) values ('${T2}','Other','other-place');
  insert into auth.users (id, email, raw_app_meta_data) values
    ('${U1}', 'u1@x.com', '{}'), ('${U2}', 'u2@x.com', '{"role":"customer"}'), ('${MGR}', 'mgr@x.com', '{}'),
    ('${OWNER}', '${OWNER_EMAIL}', '{"role":"owner"}'), ('${FORGED}', 'old-owner@x.com', '{"role":"super_admin"}'),
    ('${LEGACY_CHEF}', 'chef@x.com', '{"role":"kitchen","tenant_id":"${T1}"}');
`);
for (const m of migrations.slice(1)) await db.exec(fs.readFileSync(`${root}/supabase/migrations/${m}`, 'utf8'));
await db.exec(`
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  grant execute on function public.tenant_analytics, public.api_usage_summary to authenticated;
`);

async function as(pgRole, claims, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false); set role ${pgRole};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
const user = (sub) => ({ sub, role: 'authenticated', app_metadata: { role: 'user' } });
const manager = (tenant_id) => ({ sub: MGR, role: 'authenticated', app_metadata: { role: 'manager', tenant_id } });
const owner = { sub: OWNER, email: OWNER_EMAIL, role: 'authenticated', app_metadata: { role: 'super_admin' } };
const staff = (tenant_id) => ({ sub: CHEF, email: 'cook@x.com', role: 'authenticated', app_metadata: { role: 'staff', tenant_id } });
/** A token claiming super_admin from the wrong email (e.g. a stale/forged claim). */
const forged = { sub: FORGED, email: 'old-owner@x.com', role: 'authenticated', app_metadata: { role: 'super_admin', tenant_id: T1 } };

let fails = 0;
let passes = 0;
async function check(name, fn) {
  try { const r = await fn(); passes++; console.log(`ok   ${name}${r !== undefined ? ` → ${r}` : ''}`); }
  catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); }
}
async function expectError(name, fn, re) {
  try { await fn(); fails++; console.log(`FAIL ${name}: no error`); }
  catch (e) {
    if (re && !re.test(e.message)) { fails++; console.log(`FAIL ${name}: ${e.message}`); }
    else { passes++; console.log(`ok   ${name} → rejected (${e.message})`); }
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const count = async (who, sql, params) => (await as('authenticated', who, `select count(*)::int n from (${sql}) x`, params)).rows[0].n;

// ── migration
const roleOf = async (id) => (await db.query(`select raw_app_meta_data->>'role' role from auth.users where id=$1`, [id])).rows[0].role;
await check('migrated roles: only the hardcoded email is super_admin; legacy kitchen→manager; others→user', async () => {
  const roles = { owner: await roleOf(OWNER), forged: await roleOf(FORGED), chef: await roleOf(LEGACY_CHEF), customer: await roleOf(U2) };
  assert(roles.owner === 'super_admin' && roles.forged === 'user' && roles.chef === 'manager' && roles.customer === 'user', JSON.stringify(roles));
  return JSON.stringify(roles);
});
await check('new sign-ups default to user; the hardcoded email (any case) becomes super_admin', async () => {
  await db.exec(`insert into auth.users (id, email) values ('${CHEF}', 'cook@x.com'), (gen_random_uuid(), 'BhawishK15@Gmail.com')`);
  assert((await roleOf(CHEF)) === 'user', 'default');
  const o = await db.query(`select raw_app_meta_data->>'role' role from auth.users where lower(email)='${OWNER_EMAIL}' and id <> '${OWNER}'`);
  assert(o.rows[0].role === 'super_admin', 'owner email');
});
await check('nobody else can be promoted to super_admin, even via service-role writes', async () => {
  await db.exec(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}' where id = '${U1}'`);
  assert((await roleOf(U1)) === 'user', 'escalated');
  await db.exec(`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"staff","tenant_id":"${T1}"}' where id = '${CHEF}'`);
  assert((await roleOf(CHEF)) === 'staff', 'staff not assignable');
});

// ── user (customer)
await check('anon reads the menu', async () => assert((await as('anon', {}, 'select count(*)::int n from menu_items')).rows[0].n === 12, 'menu'));

let orderId;
await check('user places an order via place_order', async () => {
  const r = await as('authenticated', user(U1), `select place_order($1, $2::jsonb, 'pickup') id`, [T1, JSON.stringify([{ menu_item_id: ITEM, quantity: 2 }])]);
  orderId = r.rows[0].id;
  return `order ${orderId.slice(0, 8)}`;
});
await expectError('user cannot insert orders directly', () =>
  as('authenticated', user(U1), `insert into orders (tenant_id, customer_id, fulfilment, total_cents) values ($1,$2,'pickup',1)`, [T1, U1]), /row-level security/);
await check('another user cannot see that order', async () => assert((await count(user(U2), 'select * from orders')) === 0, 'leak'));
await expectError('user cannot change menu availability', async () => {
  const r = await as('authenticated', user(U1), `update menu_items set is_available=false where id=$1 returning id`, [ITEM]);
  if (!r.rows.length) throw new Error('row-level security: 0 rows');
}, /row-level security/);
await check('user manages own profile', async () => {
  await as('authenticated', user(U1), `insert into profiles (id, display_name) values ($1, 'Ayesha')`, [U1]);
  const r = await as('authenticated', user(U1), `update profiles set phone='0300' where id=$1 returning phone`, [U1]);
  assert(r.rows[0]?.phone === '0300', 'not updated');
});
await expectError('user cannot write someone else\x27s profile', () =>
  as('authenticated', user(U2), `insert into profiles (id, display_name) values ($1, 'x')`, [U1]), /row-level security/);
await check('user cannot read another profile', async () => assert((await count(user(U2), 'select * from profiles')) === 0, 'leak'));

const tomorrow = new Date(Date.now() + 86400000).toISOString();
let reservationId;
await check('user books a table (status forced to requested)', async () => {
  const r = await as('authenticated', user(U1), `insert into reservations (tenant_id, customer_id, reserved_for, party_size, guest_name) values ($1,$2,$3,4,'Ayesha') returning id, status`, [T1, U1, tomorrow]);
  reservationId = r.rows[0].id;
  assert(r.rows[0].status === 'requested', r.rows[0].status);
});
await expectError('user cannot pre-confirm a booking', () =>
  as('authenticated', user(U1), `insert into reservations (tenant_id, customer_id, reserved_for, party_size, guest_name, status) values ($1,$2,$3,2,'x','confirmed')`, [T1, U1, tomorrow]), /row-level security/);
await check('user cannot see others\x27 bookings', async () => assert((await count(user(U2), 'select * from reservations')) === 0, 'leak'));

// ── manager (operations, one restaurant)
await check('manager sees the kitchen queue for their restaurant', async () => assert((await count(manager(T1), 'select * from orders')) === 1, 'no orders'));
await check('manager advances order status', async () => {
  const r = await as('authenticated', manager(T1), `update orders set status='preparing' where id=$1 returning status`, [orderId]);
  assert(r.rows.length === 1, 'not updated');
});
await expectError('manager cannot change an order total', () =>
  as('authenticated', manager(T1), `update orders set total_cents=1 where id=$1`, [orderId]), /only order status/);
await check('manager sets daily stock and 86s an item', async () => {
  const r = await as('authenticated', manager(T1), `update menu_items set daily_stock=3 where id=$1 returning daily_stock`, [ITEM2]);
  assert(r.rows[0]?.daily_stock === 3, 'stock not set');
});
await expectError('manager cannot change prices (owner only)', () =>
  as('authenticated', manager(T1), `update menu_items set price_cents=1 where id=$1`, [ITEM]), /manager may only change/);
await expectError('manager cannot add menu items (owner only)', () =>
  as('authenticated', manager(T1), `insert into menu_items (tenant_id, name, price_cents) values ($1,'x',1)`, [T1]), /row-level security/);
await check('manager runs the reservation book', async () => {
  const r = await as('authenticated', manager(T1), `update reservations set status='confirmed', table_label='T4' where id=$1 returning status`, [reservationId]);
  assert(r.rows[0]?.status === 'confirmed', 'not confirmed');
});
await check('manager of another restaurant sees nothing', async () => {
  assert((await count(manager(T2), 'select * from orders')) === 0, 'orders leak');
  assert((await count(manager(T2), 'select * from reservations')) === 0, 'reservations leak');
  const r = await as('authenticated', manager(T2), `update menu_items set is_available=false where id=$1 returning id`, [ITEM]);
  assert(r.rows.length === 0, 'cross-tenant stock update');
});
await expectError('manager cannot read revenue analytics (owner only)', () =>
  as('authenticated', manager(T1), 'select tenant_analytics($1, 30)', [T1]), /forbidden/);
await check('manager cannot read customer feedback (owner only)', async () => {
  await as('authenticated', user(U1), `insert into feedback (tenant_id, order_id, customer_id, rating, text, source) values ($1,$2,$3,2,'Cold','text')`, [T1, orderId, U1]);
  assert((await count(manager(T1), 'select * from feedback')) === 0, 'manager saw feedback');
});
await check('legacy "kitchen" JWT is treated as manager', async () => {
  const legacy = { sub: LEGACY_CHEF, role: 'authenticated', app_metadata: { role: 'kitchen', tenant_id: T1 } };
  assert((await count(legacy, 'select * from orders')) === 1, 'legacy kitchen lost access');
});

// ── staff (kitchen)
await check('staff sees their kitchen queue and advances an order', async () => {
  assert((await count(staff(T1), 'select * from orders')) === 1, 'no orders');
  const r = await as('authenticated', staff(T1), `update orders set status='ready' where id=$1 returning status`, [orderId]);
  assert(r.rows.length === 1, 'not updated');
});
await check('staff can 86 a dish', async () => {
  const r = await as('authenticated', staff(T1), `update menu_items set is_available=false where id=$1 returning id`, [ITEM]);
  assert(r.rows.length === 1, 'not toggled');
  await as('authenticated', staff(T1), `update menu_items set is_available=true where id=$1`, [ITEM]);
});
await expectError('staff cannot set daily stock (manager only)', () =>
  as('authenticated', staff(T1), `update menu_items set daily_stock=5 where id=$1`, [ITEM]), /staff may only change is_available/);
await check('staff cannot see reservations or feedback', async () => {
  assert((await count(staff(T1), 'select * from reservations')) === 0, 'reservations leak');
  assert((await count(staff(T1), 'select * from feedback')) === 0, 'feedback leak');
});
await check('staff of another restaurant sees nothing', async () => assert((await count(staff(T2), 'select * from orders')) === 0, 'leak'));
await expectError('a token claiming super_admin from another email gets no owner access', () =>
  as('authenticated', forged, 'select tenant_analytics($1, 30)', [T1]), /forbidden/);

// ── daily stock is enforced and auto-86s
await expectError('cannot order more than the remaining daily stock', () =>
  as('authenticated', user(U2), `select place_order($1, $2::jsonb, 'pickup')`, [T1, JSON.stringify([{ menu_item_id: ITEM2, quantity: 4 }])]), /unavailable/);
await check('ordering the last portions decrements stock and auto-86s', async () => {
  await as('authenticated', user(U2), `select place_order($1, $2::jsonb, 'pickup')`, [T1, JSON.stringify([{ menu_item_id: ITEM2, quantity: 3 }])]);
  const r = await db.query(`select daily_stock, is_available from menu_items where id=$1`, [ITEM2]);
  assert(r.rows[0].daily_stock === 0 && r.rows[0].is_available === false, JSON.stringify(r.rows[0]));
  return 'stock 0, sold out';
});

// ── single-use promo codes
const ITEM3 = 'f00d0000-0000-4000-8000-000000000002';
const promoOrder = (who, code) =>
  as('authenticated', who, `select place_order($1, $2::jsonb, 'pickup', null, 'web', $3) id`, [T1, JSON.stringify([{ menu_item_id: ITEM3, quantity: 1 }]), code]);
await check('anyone can check a promo code without seeing the table', async () => {
  const r = await as('anon', {}, `select check_promo_code($1, ' welcome10 ') pct`, [T1]);
  assert(r.rows[0].pct === 10, `pct ${r.rows[0].pct}`);
  assert((await count(user(U1), 'select * from promo_codes')) === 0, 'leak');
  return '10%';
});
await check('placing an order with a code discounts it and burns the code', async () => {
  const id = (await promoOrder(user(U1), 'welcome10')).rows[0].id;
  const o = (await db.query(`select o.total_cents, o.discount_cents, o.promo_code, sum(i.quantity*i.unit_price_cents)::int sub
    from orders o join order_items i on i.order_id=o.id where o.id=$1 group by o.id`, [id])).rows[0];
  assert(o.promo_code === 'WELCOME10' && o.discount_cents === Math.round(o.sub * 0.1) && o.total_cents === o.sub - o.discount_cents, JSON.stringify(o));
  const p = (await db.query(`select is_used, used_by, used_order_id from promo_codes where code='WELCOME10'`)).rows[0];
  assert(p.is_used && p.used_by === U1 && p.used_order_id === id, JSON.stringify(p));
  return `${o.sub} → ${o.total_cents}`;
});
await expectError('a used code is rejected on check', () => as('anon', {}, `select check_promo_code($1, 'WELCOME10')`, [T1]), /already been used/);
await check('a used code rolls back the whole order', async () => {
  const before = await count(user(U2), 'select * from orders');
  try { await promoOrder(user(U2), 'WELCOME10'); throw new Error('accepted'); }
  catch (e) { assert(/already been used/.test(e.message), e.message); }
  assert((await count(user(U2), 'select * from orders')) === before, 'order kept');
});
await expectError('users cannot mint or reset codes', () =>
  as('authenticated', user(U1), `insert into promo_codes (tenant_id, code, discount_percentage) values ($1,'FREE',90)`, [T1]), /row-level security/);
await check('manager issues a code; it can be redeemed once via redeem_promo_code', async () => {
  await as('authenticated', manager(T1), `insert into promo_codes (tenant_id, code, discount_percentage) values ($1,'MGR-25',25)`, [T1]);
  const id = (await as('authenticated', user(U2), `select place_order($1, $2::jsonb, 'pickup') id`, [T1, JSON.stringify([{ menu_item_id: ITEM3, quantity: 2 }])])).rows[0].id;
  await expectError('another user cannot redeem on someone else\x27s order', () => as('authenticated', user(U1), `select redeem_promo_code($1, 'MGR-25')`, [id]), /order not found/);
  const off = (await as('authenticated', user(U2), `select redeem_promo_code($1, 'mgr-25') off`, [id])).rows[0].off;
  assert(off > 0, 'no discount');
  await expectError('second redemption on the same order fails', () => as('authenticated', user(U2), `select redeem_promo_code($1, 'MGR-25')`, [id]), /already has a promo/);
});
await check('coupons view insert persists to promo_codes and check_promo_code normalizes casing & hyphens', async () => {
  await db.query(`insert into coupons (tenant_id, code, discount_percent, expires_at) values ($1, 'sorry20-dqna8', 20, now() + interval '30 days')`, [T1]);
  // Pre-checkout validation check with lowercase and hyphen spacing
  const pct = (await as('anon', {}, `select check_promo_code($1, '  sorry20 - dqna8  ') pct`, [T1])).rows[0].pct;
  assert(pct === 20, `pct was ${pct}`);
  // Verify it is NOT consumed during pre-checkout check
  const p = (await db.query(`select is_used, discount_percentage from promo_codes where code='SORRY20-DQNA8'`)).rows[0];
  assert(p.is_used === false && p.discount_percentage === 20, JSON.stringify(p));
  return '20% active, is_used=false';
});
await check('positive feedback referral code (THANKYOU10-GWBWK) inserted into coupons validates at 10%', async () => {
  await db.query(`insert into coupons (tenant_id, code, expires_at) values ($1, 'THANKYOU10-GWBWK', now() + interval '30 days')`, [T1]);
  const pct = (await as('anon', {}, `select check_promo_code($1, 'thankyou10-gwbwk') pct`, [T1])).rows[0].pct;
  assert(pct === 10, `pct was ${pct}`);
  const row = (await db.query(`select is_used, discount_percentage, source from promo_codes where code='THANKYOU10-GWBWK'`)).rows[0];
  assert(row.is_used === false && row.discount_percentage === 10 && row.source === 'referral', JSON.stringify(row));
  return '10% referral active';
});



// ── super admin (owner)
await check('owner reads analytics, feedback and every restaurant', async () => {
  const a = await as('authenticated', owner, 'select tenant_analytics($1, 30) a', [T1]);
  // Analytics counts completed orders only.
  const completed = (await db.query(`select count(*)::int n from orders where tenant_id=$1 and status='completed'`, [T1])).rows[0].n;
  assert(a.rows[0].a.orders === completed, `orders ${a.rows[0].a.orders} vs ${completed}`);
  assert((await count(owner, 'select * from feedback')) === 1, 'feedback');
  assert((await count(owner, 'select * from tenants')) === 2, 'tenants');
});
await check('owner edits prices and creates menu items', async () => {
  await as('authenticated', owner, `update menu_items set price_cents=2900 where id=$1`, [ITEM]);
  await as('authenticated', owner, `insert into menu_items (tenant_id, name, price_cents) values ($1,'Special',1500)`, [T1]);
});
await check('owner issues a discount code', async () => {
  const fb = (await db.query('select id from feedback limit 1')).rows[0].id;
  await as('authenticated', owner, `insert into discount_codes (tenant_id, code, percent_off, feedback_id, issued_by) values ($1,'SORRY-1',15,$2,$3)`, [T1, fb, OWNER]);
});
await check('owner reads all profiles', async () => assert((await count(owner, 'select * from profiles')) === 1, 'profiles'));
await check('users cannot read API logs', async () => {
  await db.exec(`insert into api_logs (method, route, status, duration_ms, level) values ('GET','/x',200,1,'info')`);
  assert((await count(user(U1), 'select * from api_logs')) === 0, 'leak');
  assert((await count(owner, 'select * from api_logs')) === 1, 'owner blind');
});

console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
