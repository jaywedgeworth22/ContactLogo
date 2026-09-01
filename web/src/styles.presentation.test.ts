// Presentation-lane tests for docs/UI-CONTRACT.md compliance.
//
// These check the static contents of web/src/styles.css, web/index.html and
// web/public/manifest.webmanifest — the three files this lane owns — against
// the token set, selector rules and contrast minimums the contract lays out.
// Run directly (not part of the shared `npm test` glob, which this lane does
// not own):
//   node --experimental-strip-types --test src/styles.presentation.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(here + "styles.css", "utf8");
const html = readFileSync(here + "../index.html", "utf8");
const manifest = readFileSync(here + "../public/manifest.webmanifest", "utf8");

// ---- WCAG contrast helper -------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map(linear);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrastRatio(a: string, b: string): number {
  const la = relLuminance(hexToRgb(a));
  const lb = relLuminance(hexToRgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---- token extraction -------------------------------------------------

function extractBlock(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `could not find block starting at ${JSON.stringify(startMarker)}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(braceStart, i + 1);
}

function extractTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const re = /--([a-z-]+):\s*(#[0-9a-fA-F]{3,8}|[a-z]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

const lightBlock = extractBlock(css, ":root {");
const darkMediaBlock = extractBlock(css, '@media (prefers-color-scheme: dark)');
const darkAttrBlock = extractBlock(css, ':root[data-theme="dark"]');

const lightTokens = extractTokens(lightBlock);
const darkMediaTokens = extractTokens(darkMediaBlock);
const darkAttrTokens = extractTokens(darkAttrBlock);

const REQUIRED_TOKENS = [
  "bg", "ink", "muted", "card", "line", "high", "medium", "low", "skip",
  "accent", "accent-ink", "focus-ring", "danger",
  "badge-high-bg", "badge-high-ink", "badge-medium-bg", "badge-medium-ink",
  "badge-low-bg", "badge-low-ink",
  "chip-bg", "chip-ink", "chip-active-bg", "chip-active-ink",
  "exhausted-bg", "exhausted-ink",
];

test("all three theme blocks define every required token (no color defined only inside one block)", () => {
  for (const name of REQUIRED_TOKENS) {
    assert.ok(name in lightTokens, `--${name} missing from bare :root`);
    assert.ok(name in darkMediaTokens, `--${name} missing from prefers-color-scheme(dark) block`);
    assert.ok(name in darkAttrTokens, `--${name} missing from [data-theme="dark"] block`);
  }
});

test("dark media block is guarded against an explicit light override", () => {
  const idx = css.indexOf("@media (prefers-color-scheme: dark)");
  const guardedSelector = css.slice(idx, idx + 200);
  assert.match(guardedSelector, /:root:not\(\[data-theme="light"\]\)/);
});

test("color-scheme flips correctly across all three blocks", () => {
  assert.match(lightBlock, /color-scheme:\s*light/);
  assert.match(darkMediaBlock, /color-scheme:\s*dark/);
  assert.match(darkAttrBlock, /color-scheme:\s*dark/);
});

// ---- contrast minimums --------------------------------------------------

function assertAA(label: string, fg: string, bg: string, min = 4.5) {
  const ratio = contrastRatio(fg, bg);
  assert.ok(
    ratio >= min,
    `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1, needs >= ${min}:1`,
  );
}

test("light theme: body ink and muted text clear AA (4.5:1) against bg/card", () => {
  assertAA("ink/bg", lightTokens.ink, lightTokens.bg);
  assertAA("muted/bg", lightTokens.muted, lightTokens.bg);
  assertAA("muted/card", lightTokens.muted, lightTokens.card);
});

test("dark theme: body ink and muted text clear AA (4.5:1) against bg/card", () => {
  assertAA("ink/bg", darkAttrTokens.ink, darkAttrTokens.bg);
  assertAA("muted/bg", darkAttrTokens.muted, darkAttrTokens.bg);
  assertAA("muted/card", darkAttrTokens.muted, darkAttrTokens.card);
});

test("both themes: btn text (accent-ink on accent) clears AA", () => {
  assertAA("light accent-ink/accent", lightTokens["accent-ink"], lightTokens.accent);
  assertAA("dark accent-ink/accent", darkAttrTokens["accent-ink"], darkAttrTokens.accent);
});

test("both themes: confidence badge ink/bg pairs clear AA for their tier", () => {
  for (const tier of ["high", "medium", "low"]) {
    assertAA(`light badge-${tier}`, lightTokens[`badge-${tier}-ink`], lightTokens[`badge-${tier}-bg`]);
    assertAA(`dark badge-${tier}`, darkAttrTokens[`badge-${tier}-ink`], darkAttrTokens[`badge-${tier}-bg`]);
  }
});

test("both themes: chip text and active-chip text clear AA", () => {
  assertAA("light chip", lightTokens["chip-ink"], lightTokens["chip-bg"]);
  assertAA("light chip-active", lightTokens["chip-active-ink"], lightTokens["chip-active-bg"]);
  assertAA("dark chip", darkAttrTokens["chip-ink"], darkAttrTokens["chip-bg"]);
  assertAA("dark chip-active", darkAttrTokens["chip-active-ink"], darkAttrTokens["chip-active-bg"]);
});

test("both themes: exhausted-label ink clears AA against card and exhausted-bg", () => {
  assertAA("light exhausted-ink/card", lightTokens["exhausted-ink"], lightTokens.card);
  assertAA("light exhausted-ink/exhausted-bg", lightTokens["exhausted-ink"], lightTokens["exhausted-bg"]);
  assertAA("dark exhausted-ink/card", darkAttrTokens["exhausted-ink"], darkAttrTokens.card);
  assertAA("dark exhausted-ink/exhausted-bg", darkAttrTokens["exhausted-ink"], darkAttrTokens["exhausted-bg"]);
});

test("both themes: focus ring clears the 3:1 non-text minimum against bg/card", () => {
  assertAA("light focus-ring/bg", lightTokens["focus-ring"], lightTokens.bg, 3);
  assertAA("light focus-ring/card", lightTokens["focus-ring"], lightTokens.card, 3);
  assertAA("dark focus-ring/bg", darkAttrTokens["focus-ring"], darkAttrTokens.bg, 3);
  assertAA("dark focus-ring/card", darkAttrTokens["focus-ring"], darkAttrTokens.card, 3);
});

// ---- selector-level contract rules --------------------------------------

test(".btn reads accent-ink via a variable, not a hardcoded literal", () => {
  const btnRule = extractBlock(css, "\n.btn {");
  assert.match(btnRule, /color:\s*var\(--accent-ink\)/);
  assert.doesNotMatch(btnRule, /#f8f4ec/);
});

test("focus-visible rule covers every control named in the contract", () => {
  const block = extractBlock(css, ".btn:focus-visible,");
  for (const sel of [
    ".btn:focus-visible",
    ".chip:focus-visible",
    ".alts-btn:focus-visible",
    ".search-input:focus-visible",
    ".settings-input:focus-visible",
    ".zoom-slider:focus-visible",
    'input[type="checkbox"]:focus-visible',
  ]) {
    assert.ok(css.includes(sel), `missing focus-visible selector: ${sel}`);
  }
  assert.match(block, /outline:\s*2px solid var\(--focus-ring\)/);
});

test("prefers-reduced-motion guard is present and neutralizes animation/transition duration", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const block = extractBlock(css, "@media (prefers-reduced-motion: reduce)");
  assert.match(block, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);
});

test("disabled rule covers .btn, .chip and .alts-btn together", () => {
  assert.match(css, /\.btn:disabled,\s*\n\.chip:disabled,\s*\n\.alts-btn:disabled\s*\{\s*opacity:\s*0\.45;\s*cursor:\s*not-allowed;/);
});

test("touch targets: .alts-btn and .chip and .card checkbox declare 44px minimums", () => {
  const altsBtn = extractBlock(css, ".alts-btn {");
  assert.match(altsBtn, /min-width:\s*44px/);
  assert.match(altsBtn, /min-height:\s*44px/);

  const chip = extractBlock(css, "\n.chip {");
  assert.match(chip, /min-height:\s*44px/);

  const btn = extractBlock(css, "\n.btn {");
  assert.match(btn, /min-width:\s*44px/);
  assert.match(btn, /min-height:\s*44px/);

  const checkbox = extractBlock(css, '.card > input[type="checkbox"] {');
  assert.match(checkbox, /width:\s*44px/);
  assert.match(checkbox, /height:\s*44px/);
});

test(".grid no longer sets a competing transform (virtualization owns it via inline style)", () => {
  // Any rule targeting .grid in this sheet must not declare `transform`.
  const re = /\.grid\s*\{[^}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    assert.doesNotMatch(m[0], /transform\s*:/, `found a transform on a .grid rule: ${m[0]}`);
  }
});

test("virtual-list scaffolding classes exist", () => {
  assert.match(css, /\.virtual-list\s*\{/);
  assert.match(css, /\.virtual-list-spacer\s*\{/);
  assert.match(css, /position:\s*relative/); // spacer
});

test("card grid gives the content column meaningfully more room than the old ~140px", () => {
  // grid minimum column width
  const gridMin = /minmax\((\d+)px/.exec(css);
  assert.ok(gridMin, "expected .grid minmax(<n>px, 1fr)");
  const colWidth = Number(gridMin![1]);

  const cardBlock = extractBlock(css, "\n.card {\n");
  const cols = /grid-template-columns:\s*([0-9]+)px\s+([0-9]+)px\s+1fr/.exec(cardBlock);
  assert.ok(cols, "expected .card grid-template-columns: <n>px <n>px 1fr");
  const [, checkboxCol, thumbCol] = cols!.map(Number as unknown as (s: string) => number);
  const paddingMatch = /padding:\s*([0-9]+)px/.exec(cardBlock);
  const padding = paddingMatch ? Number(paddingMatch[1]) : 0;
  const gapMatch = /\n\s*gap:\s*([0-9]+)px/.exec(cardBlock);
  const gap = gapMatch ? Number(gapMatch[1]) : 0;

  const contentWidth = colWidth - padding * 2 - gap * 2 - checkboxCol - thumbCol;
  assert.ok(
    contentWidth >= 190,
    `content column at minimum grid width is only ${contentWidth}px (was ~140px pre-fix)`,
  );
});

test("confidence badge classes exist for all three tiers with distinct copy-bearing modifiers", () => {
  for (const tier of ["high", "medium", "low"]) {
    assert.match(css, new RegExp(`\\.confidence-badge--${tier}\\s*\\{`));
  }
});

test("exhausted state classes exist", () => {
  assert.match(css, /\.card--exhausted\s*\{/);
  assert.match(css, /\.noimg--exhausted\s*\{/);
  assert.match(css, /\.exhausted-label\s*\{/);
});

// ---- index.html ------------------------------------------------------

test("index.html declares both light and dark theme-color meta tags", () => {
  // Light chrome matches the cream page, not near-black ink.  A dark theme-color
  // on a light page is what iOS paints into the status bar.
  assert.match(html, /<meta name="theme-color" content="#f4f0e8" media="\(prefers-color-scheme: light\)" \/>/);
  assert.match(html, /<meta name="theme-color" content="#17140f" media="\(prefers-color-scheme: dark\)" \/>/);
});

// ---- manifest.webmanifest ---------------------------------------------

test("manifest.webmanifest is still valid JSON and matches the light-theme tokens", () => {
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.theme_color, lightTokens.bg);
  assert.equal(parsed.background_color, lightTokens.bg);
  const png = (parsed.icons as { src: string; type?: string }[]).filter((i) => i.type === "image/png");
  assert.ok(png.some((i) => i.src === "/icon-192.png"));
  assert.ok(png.some((i) => i.src === "/icon-512.png"));
});

test("index.html uses a PNG apple-touch-icon and cream light theme-color", () => {
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon.png"/);
  assert.match(html, /rel="canonical" href="https:\/\/contactlogo.com\/"/);
  assert.match(html, /property="og:image" content="https:\/\/contactlogo.com\/og.png"/);
});

test("public SEO and PWA files exist", () => {
  const pub = here + "../public/";
  for (const name of ["robots.txt", "sitemap.xml", "og.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "privacy.html", "terms.html"]) {
    assert.ok(readFileSync(pub + name).length > 0, name);
  }
  const robots = readFileSync(pub + "robots.txt", "utf8");
  assert.match(robots, /Sitemap: https:\/\/contactlogo.com\/sitemap.xml/);
});
