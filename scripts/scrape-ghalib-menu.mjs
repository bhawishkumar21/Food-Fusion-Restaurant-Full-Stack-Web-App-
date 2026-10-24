#!/usr/bin/env node
/**
 * Scrapes the public menu of https://order.ghalib.com.pk/ into
 * web/src/data/food_fusion_menu.json (imported by the storefront).
 *
 * How it works
 *   The storefront is a Next.js app on the Indolj ordering platform. On load,
 *   the homepage itself requests the full menu from Indolj's
 *   `WebApiV2/StructuredMenu` endpoint. Rather than clicking through the
 *   order-type/location modal and parsing rendered HTML, we let Playwright load
 *   the homepage like a normal visitor and read that response. This means one
 *   page view, no extra requests to the API, and structured data instead of
 *   brittle CSS selectors.
 *
 *   robots.txt disallows /menu, so we only ever load the homepage.
 *
 * Usage
 *   node scripts/scrape-ghalib-menu.mjs [--out path.json] [--verify-images]
 *
 *   Browser: uses Playwright's bundled Chromium (`npx playwright install chromium`),
 *   or an installed browser via PW_CHANNEL=msedge | chrome.
 *
 * Note: menu text and photos belong to Ghalib Restaurant. Fine for local
 * prototyping; get permission before publishing them in a product.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const SOURCE_URL = 'https://order.ghalib.com.pk/';
const MENU_ENDPOINT = /\/WebApiV2\/StructuredMenu\b/;
/** Ghalib's uploads are served from the Indolj media CDN. */
const MEDIA_CDN_HOSTS = new Set(['assets.indolj.io']);
/**
 * Platform placeholders, plus the restaurant logo uploaded in place of a dish
 * photo (e.g. "ghalib logo.png", "LOGOD.png"). Neither shows the dish.
 */
const PLACEHOLDER_IMAGE = /placholde|place-holder|\/[^/]*logo[^/]*$/i;

const { values: args } = parseArgs({
  options: {
    // Written straight into the web app, which imports it for the storefront.
    out: { type: 'string', default: 'web/src/data/food_fusion_menu.json' },
    'verify-images': { type: 'boolean', default: false },
    timeout: { type: 'string', default: '60000' },
  },
});

// ────────────────────────────────────────────────────────────── helpers ──

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
/** Descriptions are CMS rich text: strip tags, decode entities, tidy whitespace. */
function cleanText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'with']);
/**
 * Title-case ALL-CAPS category names from the CMS ("KID'S CORNER" → "Kid's Corner",
 * "FLAVORS OF THE WORLD" → "Flavors of the World"), keeping vowel-less
 * acronyms like "BBQ" intact.
 */
const tidyCategory = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      if (/^[^aeiou\W\d]{2,4}$/i.test(word)) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.replace(/(^|[(&/-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(' ');

/**
 * Full-resolution, directly fetchable CDN URL: drops the `?q=` quality hint,
 * percent-encodes spaces in filenames, and rejects placeholders and any
 * non-CDN hosts.
 */
function cdnImageUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim() || PLACEHOLDER_IMAGE.test(raw)) return null;
  try {
    const url = new URL(encodeURI(decodeURI(raw.trim())));
    if (url.protocol !== 'https:' || !MEDIA_CDN_HOSTS.has(url.hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function toPrice(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────── scrape ──

async function fetchStructuredMenu() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });
  try {
    const page = await browser.newPage();
    const timeout = Number(args.timeout);
    const [response] = await Promise.all([
      page.waitForResponse((r) => MENU_ENDPOINT.test(r.url()) && r.request().method() === 'GET', { timeout }),
      page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout }),
    ]);
    if (!response.ok()) throw new Error(`Menu endpoint returned HTTP ${response.status()}`);
    const body = await response.json();
    if (!body?.details || typeof body.details !== 'object') {
      throw new Error('Menu response has no `details` object; the site structure may have changed.');
    }
    return body.details;
  } finally {
    await browser.close();
  }
}

/**
 * The API returns categories keyed by id, each with `items` keyed by id.
 * "Featured" categories (Popular Items, New Addition…) repeat dishes whose
 * real home is given by `item.category_info`. We emit each dish once, under
 * its home category, and record where else it is featured.
 */
function normalise(details) {
  const categories = Object.values(details)
    .filter((c) => c?.categoryDetail?.status === 'publish' && c.categoryDetail.hidden !== '1')
    .map((c) => ({
      id: String(c.id),
      name: tidyCategory(c.title ?? c.categoryDetail.category_name),
      sequence: Number(c.categoryDetail.sequence) || 0,
      image_url: cdnImageUrl(c.image),
      raw: c,
    }))
    .sort((a, b) => a.sequence - b.sequence);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const dishes = new Map(); // item_id → dish
  const warnings = [];

  for (const category of categories) {
    const keys = category.raw.sortedItemKeys ?? Object.keys(category.raw.items ?? {});
    for (const key of keys) {
      const item = category.raw.items?.[key];
      if (!item?.item_id || !item.item_name) continue;

      const homeId = String(item.category_info?.cat_id ?? category.id);
      const home = categoryById.get(homeId) ?? category;
      const existing = dishes.get(item.item_id);
      if (existing) {
        if (category.name !== existing.category && !existing.featured_in.includes(category.name)) {
          existing.featured_in.push(category.name);
        }
        continue;
      }

      const name = cleanText(item.item_name);
      const prices = (Array.isArray(item.prices) ? item.prices : [])
        .map((p) => ({ size: cleanText(p.size ?? '') , price: toPrice(p.price) }))
        .filter((p) => p.price !== null);
      if (!prices.length) warnings.push(`No price for "${name}" (${item.item_id})`);

      const image_url = cdnImageUrl(item.photo);
      if (!image_url) warnings.push(`No CDN image for "${name}" (${item.item_id})`);

      dishes.set(item.item_id, {
        // Stable across runs and unique even when two dishes share a name.
        id: `${slugify(name)}-${item.item_id}`,
        name,
        price: prices.length ? Math.min(...prices.map((p) => p.price)) : null,
        category: home.name,
        description: cleanText(item.item_description),
        image_url,
        ...(prices.length > 1 && { sizes: prices.map((p) => ({ size: p.size, price: p.price })) }),
        tag: cleanText(item.item_tag_name) ?? undefined,
        featured_in: home === category ? [] : [category.name],
      });
    }
  }

  const items = [...dishes.values()].map(({ featured_in, tag, ...rest }) => ({
    ...rest,
    ...(tag && { tag }),
    ...(featured_in.length && { featured_in }),
  }));

  // Only categories that actually own dishes (featured lists are folded in).
  const owned = new Set(items.map((i) => i.category));
  const outCategories = categories
    .filter((c) => owned.has(c.name))
    .map((c) => ({
      id: slugify(c.name),
      name: c.name,
      image_url: c.image_url,
      item_count: items.filter((i) => i.category === c.name).length,
    }));

  // Keep items grouped in menu order.
  const order = new Map(outCategories.map((c, i) => [c.name, i]));
  items.sort((a, b) => order.get(a.category) - order.get(b.category));

  return { categories: outCategories, items, warnings };
}

/** Optional: confirm every image URL resolves on the CDN (HEAD, 4 at a time). */
async function verifyImages(items) {
  const urls = [...new Set(items.map((i) => i.image_url).filter(Boolean))];
  const broken = [];
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(
      urls.slice(i, i + 4).map(async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !type.startsWith('image/')) broken.push(`${res.status} ${type} ${url}`);
        } catch (e) {
          broken.push(`ERR ${e.message} ${url}`);
        }
      }),
    );
  }
  return { checked: urls.length, broken };
}

// ───────────────────────────────────────────────────────────────── main ──

const details = await fetchStructuredMenu();
const { categories, items, warnings } = normalise(details);

if (!items.length) throw new Error('Scraped 0 items; aborting without writing output.');
const ids = new Set(items.map((i) => i.id));
if (ids.size !== items.length) throw new Error('Duplicate ids generated; aborting.');

const output = {
  source: SOURCE_URL,
  restaurant: 'Ghalib Restaurant',
  scraped_at: new Date().toISOString(),
  currency: 'PKR',
  category_count: categories.length,
  item_count: items.length,
  categories,
  items,
};

await writeFile(args.out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${items.length} items in ${categories.length} categories → ${args.out}`);
for (const w of warnings) console.warn(`  warn: ${w}`);

if (args['verify-images']) {
  const { checked, broken } = await verifyImages(items);
  console.log(`Verified ${checked} image URLs: ${broken.length ? `${broken.length} broken` : 'all OK'}`);
  for (const b of broken) console.warn(`  broken: ${b}`);
  if (broken.length) process.exitCode = 1;
}
