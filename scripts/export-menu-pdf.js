#!/usr/bin/env node
/**
 * Exports the Ghalib menu (web/src/data/food_fusion_menu.json) to a print-ready,
 * on-brand PDF.
 *
 * How it works: builds a self-contained HTML document styled like the website
 * (espresso background, amber-gold headings, Playfair Display + Geist), then
 * prints it to A4 with Playwright's Chromium PDF engine, so the layout is
 * real CSS: multi-column sections, no dishes split across pages.
 *
 * Usage
 *   npm run export:menu-pdf
 *   npm run export:menu-pdf -- --out "D:\menus\ghalib.pdf"
 *   npm run export:menu-pdf -- --light        # ink-friendly cream variant
 *
 * Default output: <your home>\Downloads\Ghalib_Food_Fusion_Menu.pdf
 * Browser: Playwright's bundled Chromium if installed, otherwise the
 * installed Microsoft Edge or Google Chrome (or force one with PW_CHANNEL).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { chromium } = require('playwright');

const MENU_PATH = path.join(__dirname, '..', 'web', 'src', 'data', 'food_fusion_menu.json');

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(os.homedir(), 'Downloads', 'Ghalib_Food_Fusion_Menu.pdf') },
    light: { type: 'boolean', default: false },
  },
});

// ─────────────────────────────────────────────────────────────── helpers ──

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Prices are whole rupees in the JSON → "PKR 1,990". */
const pkr = (rupees) => `PKR ${Math.round(rupees).toLocaleString('en-US')}`;

/** Capitalise the first letter only (source has e.g. "sizzling Brownie"). */
const tidyName = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ──────────────────────────────────────────────────────────────── template ──

function buildHtml(menu, { light }) {
  const theme = light
    ? { bg: '#FBF7F0', bg2: '#F3EBDD', text: '#1E1B18', muted: '#6B625B', gold: '#A86E12', line: 'rgba(30,27,24,0.14)', card: 'rgba(255,255,255,0.55)' }
    : { bg: '#0B0908', bg2: '#14100E', text: '#F8F5F0', muted: '#A8A099', gold: '#E5A93C', line: 'rgba(255,255,255,0.10)', card: 'rgba(30,27,24,0.6)' };

  const byCategory = menu.categories
    .map((c) => ({ ...c, items: menu.items.filter((i) => i.category === c.name) }))
    .filter((c) => c.items.length);

  const itemHtml = (item) => {
    const sizes = Array.isArray(item.sizes) && item.sizes.length > 1
      ? `<p class="sizes">${item.sizes.map((s) => `${escapeHtml(s.size || 'Regular')} <b>${pkr(s.price)}</b>`).join('<span class="dot">·</span>')}</p>`
      : '';
    return `
      <article class="item">
        <div class="row">
          <h3>${escapeHtml(tidyName(item.name))}</h3>
          <span class="leader"></span>
          <span class="price">${Array.isArray(item.sizes) && item.sizes.length > 1 ? 'from ' : ''}${pkr(item.price)}</span>
        </div>
        ${item.tag ? `<p class="meta"><span class="tag">${escapeHtml(item.tag)}</span></p>` : ''}
        ${item.description ? `<p class="desc">${escapeHtml(item.description)}</p>` : ''}
        ${sizes}
      </article>`;
  };

  const sections = byCategory
    .map(
      (c, i) => `
    <section class="category" id="${escapeHtml(c.id)}">
      <header class="cat-head">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <h2>${escapeHtml(c.name)}</h2>
        <span class="count">${c.items.length} ${c.items.length === 1 ? 'dish' : 'dishes'}</span>
      </header>
      <div class="items">${c.items.map(itemHtml).join('')}</div>
    </section>`,
    )
    .join('');

  const index = byCategory
    .map((c, i) => `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(c.name)}</span><span class="leader"></span><span class="muted">${c.items.length}</span></li>`)
    .join('');

  const scraped = new Date(menu.scraped_at);
  const asOf = Number.isNaN(scraped.getTime())
    ? ''
    : scraped.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ghalib · Food Fusion Menu</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=block" rel="stylesheet">
<style>
  /* Paint the whole sheet, margins included, so there are no white bands. */
  @page { size: A4; margin: 16mm 0 18mm; background: var(--bg); }
  @page :first { margin: 0; }
  :root {
    --bg: ${theme.bg}; --bg2: ${theme.bg2}; --text: ${theme.text}; --muted: ${theme.muted};
    --gold: ${theme.gold}; --line: ${theme.line}; --card: ${theme.card};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: var(--bg); }
  body {
    font-family: 'Geist', 'Segoe UI', system-ui, sans-serif;
    color: var(--text);
    font-size: 9.5pt;
    line-height: 1.5;
    letter-spacing: -0.005em;
    background: var(--bg);
  }
  /* A fixed layer repeats on every printed page: full-bleed ambient glow. */
  .page-bg {
    position: fixed; inset: -20mm 0; z-index: -1;
    background:
      radial-gradient(circle at 50% 0%, ${light ? 'rgba(168,110,18,0.10)' : 'rgba(229,169,60,0.12)'} 0%, transparent 55%),
      linear-gradient(180deg, var(--bg2), var(--bg) 70%);
  }
  .display { font-family: 'Playfair Display', Georgia, serif; letter-spacing: -0.02em; }
  .eyebrow { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold); }
  .muted { color: var(--muted); }

  /* ── cover ── */
  .cover {
    height: 297mm; padding: 26mm 22mm 20mm; display: flex; flex-direction: column;
    break-after: page; position: relative; overflow: hidden;
  }
  .cover .frame { position: absolute; inset: 10mm; border: 0.6pt solid var(--line); border-radius: 6mm; }
  .cover .frame::after { content: ''; position: absolute; inset: 2mm; border: 0.4pt solid ${light ? 'rgba(168,110,18,0.35)' : 'rgba(229,169,60,0.35)'}; border-radius: 4.5mm; }
  .cover h1 { font-size: 78pt; line-height: 0.86; font-weight: 600; text-transform: uppercase; margin-top: 22mm; }
  .cover h1 em { color: var(--gold); font-weight: 500; }
  .cover .sub { margin-top: 9mm; font-size: 12pt; max-width: 120mm; color: var(--muted); }
  .cover .sub b { color: var(--text); font-weight: 500; }
  .index { margin-top: auto; list-style: none; columns: 2; column-gap: 12mm; }
  .index li { display: flex; align-items: baseline; gap: 3mm; padding: 1.6mm 0; break-inside: avoid; font-size: 10pt; }
  .index .num { font-family: 'Playfair Display', serif; font-style: italic; color: var(--gold); width: 7mm; }
  .cover .foot { margin-top: 10mm; display: flex; justify-content: space-between; font-size: 8pt; color: var(--muted); border-top: 0.5pt solid var(--line); padding-top: 4mm; }

  /* ── menu ── */
  main { padding: 0 16mm; }
  .category { margin-bottom: 9mm; }
  .cat-head {
    display: flex; align-items: baseline; gap: 4mm; padding-bottom: 3mm; margin-bottom: 4mm;
    border-bottom: 0.6pt solid ${light ? 'rgba(168,110,18,0.45)' : 'rgba(229,169,60,0.45)'};
    break-after: avoid;
  }
  .cat-head .num { font-family: 'Playfair Display', serif; font-style: italic; color: var(--gold); font-size: 13pt; }
  .cat-head h2 { font-family: 'Playfair Display', serif; font-weight: 600; font-size: 22pt; color: var(--gold); letter-spacing: -0.02em; line-height: 1.1; }
  .cat-head .count { margin-left: auto; font-size: 7.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .items { columns: 2; column-gap: 7mm; }
  .item {
    break-inside: avoid; margin-bottom: 3.2mm; padding: 3mm 3.6mm;
    background: var(--card); border: 0.5pt solid var(--line); border-radius: 2.6mm;
  }
  .row { display: flex; align-items: baseline; gap: 2mm; }
  .item h3 { font-size: 10pt; font-weight: 600; letter-spacing: -0.01em; }
  .leader { flex: 1; border-bottom: 0.6pt dotted ${light ? 'rgba(30,27,24,0.28)' : 'rgba(248,245,240,0.22)'}; transform: translateY(-1mm); min-width: 4mm; }
  .price { font-weight: 600; color: var(--gold); white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 9.5pt; }
  .tag {
    display: inline-block; padding: 0.2mm 1.8mm; border-radius: 3mm;
    border: 0.5pt solid ${light ? 'rgba(168,110,18,0.5)' : 'rgba(229,169,60,0.5)'};
    color: var(--gold); font-size: 6.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; vertical-align: 1pt;
  }
  /* Tags sit on their own line so the name, leader and price row never wraps. */
  .meta { margin-top: 1mm; line-height: 1; }
  .desc { margin-top: 1mm; color: var(--muted); font-size: 8.5pt; line-height: 1.45; }
  .sizes { margin-top: 1.2mm; font-size: 8pt; color: var(--muted); }
  .sizes b { color: var(--text); font-weight: 600; }
  .sizes .dot { margin: 0 1.6mm; color: var(--gold); }
  .closing { text-align: center; padding: 8mm 0 2mm; color: var(--muted); font-size: 8pt; break-inside: avoid; }
  .closing .display { font-size: 16pt; color: var(--gold); font-style: italic; display: block; margin-bottom: 2mm; }
</style>
</head>
<body>
  <div class="page-bg"></div>

  <section class="cover">
    <div class="frame"></div>
    <p class="eyebrow">Ghalib Restaurant × Food Fusion</p>
    <h1 class="display">Ghalib<br><em>Cuisine</em></h1>
    <p class="sub"><b>Tonight's Table.</b> Karahi from the clay pot, charcoal BBQ, handi, chaat and more: ${menu.items.length} dishes across ${byCategory.length} sections.</p>
    <ol class="index">${index}</ol>
    <div class="foot">
      <span>All prices in Pakistani Rupees (PKR)</span>
      <span>${asOf ? `Menu as of ${escapeHtml(asOf)}` : ''}</span>
    </div>
  </section>

  <main>
    ${sections}
    <p class="closing"><span class="display">Thank you for dining with us</span>Prices and availability may change. Ask your server about allergens and dietary requirements.</p>
  </main>
</body>
</html>`;
}

// ───────────────────────────────────────────────────────────────── browser ──

async function launchBrowser() {
  const preferred = process.env.PW_CHANNEL;
  const attempts = preferred ? [preferred] : [undefined, 'msedge', 'chrome'];
  let lastError;
  for (const channel of attempts) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No Chromium browser available (${lastError?.message?.split('\n')[0]}).\n` +
      'Run `npx playwright install chromium`, or install Microsoft Edge / Google Chrome.',
  );
}

// ──────────────────────────────────────────────────────────────────── main ──

async function main() {
  const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  if (!Array.isArray(menu.items) || !menu.items.length) throw new Error(`No items in ${MENU_PATH}`);

  const bad = menu.items.filter((i) => typeof i.price !== 'number' || !i.name || !i.category);
  if (bad.length) throw new Error(`${bad.length} items are missing a name, category or numeric price`);

  const html = buildHtml(menu, { light: args.light });
  const out = path.resolve(args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Wait for Playfair/Geist; if offline, the serif/sans fallbacks are used.
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-family:Segoe UI,sans-serif;font-size:7px;letter-spacing:0.14em;text-transform:uppercase;color:${args.light ? '#6B625B' : '#A8A099'};display:flex;justify-content:space-between;padding:0 16mm;">
          <span>Ghalib · Food Fusion</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }

  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`Saved ${menu.items.length} dishes in ${new Set(menu.items.map((i) => i.category)).size} categories → ${out} (${kb} KB)`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
