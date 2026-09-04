# Web review UI contract

This is the boundary between `web/src/app.ts` (DOM construction and behaviour) and
`web/src/styles.css` + `web/index.html` (presentation).  app.ts owns which elements
exist, their class names, their ARIA attributes, and their text content.  styles.css
owns how those class names look.  Neither side may invent a class name, data
attribute, or copy string the other side doesn't already expect — this document is
the shared source of truth for all three.  Anything app.ts emits that isn't listed
here, or any selector styles.css styles that isn't listed here, is a contract bug.

References: `docs/EVALUATION-2026-08.md` § "Design and interaction",
`docs/MATCHING-ENGINE.md`, `docs/VISION.md`.

## 1. Class-name inventory

### 1.1 Structure (unchanged names, kept for continuity)

`app`, `hero`, `hero-row`, `settings`, `settings-input`, `drop`, `btn` /
`btn.secondary` / `btn.ghost` / `btn.small`, `search-bar`, `search-input`,
`mask-toggle`, `stats`, `stat` / `stat.high` / `stat.medium` / `stat.skip`,
`toolbar`, `section`, `grid`, `card`, `card-content`, `name`, `alts`, `actions`,
`footer`, `hidden`, `notice-banner`, `google-sync-btn`, `drag-over`,
`modal-backdrop`, `crop-modal`, `crop-header`, `crop-canvas`, `crop-controls`,
`crop-row`, `zoom-slider`, `zoom-val`, `crop-check-row`, `crop-actions`.

### 1.2 New elements required by the audit

**Confidence badge** (replaces "border tint + lowercase word" as the only signal).
Each card gets a dedicated badge element, in addition to (not instead of) the
existing `card.high` / `card.medium` / `card.low` / `card.skip` modifier class
that drives the border tint:

```html
<span class="confidence-badge confidence-badge--high">High confidence</span>
<span class="confidence-badge confidence-badge--medium">Needs a look</span>
<span class="confidence-badge confidence-badge--low">Low confidence</span>
```

Badge modifier suffix is the literal `item.confidence` value (`high` / `medium` /
`low`; the `skip` tier never reaches a badge — it renders the terminal state
below instead). Copy text per tier, exact strings:

| `item.confidence` | Badge text |
|---|---|
| `high` | `High confidence` |
| `medium` | `Needs a look` |
| `low` | `Low confidence` |

The badge sits inside `.card-content`, first child, above `.name`.

**Terminal "no logo found" card state.**  Today an exhausted card (every
candidate 404'd or was rejected as too small) renders `.noimg` — an inert `?`
box — while staying checked and counted in "Ready to Apply".  That is a bug in
app.ts's state machine (the checkbox must be forced unselected and disabled
when `candidates.length === 0` after exhaustion), tracked separately in
match.ts/app.ts ownership. This contract fixes the presentation side of it:
when a card has no viable candidate left, the card root gets an additional
modifier class `card--exhausted`, and the thumbnail slot renders:

```html
<div class="noimg noimg--exhausted" aria-hidden="true">
  <svg class="noimg-icon" ...></svg>
</div>
<p class="exhausted-label">No logo found</p>
```

`.exhausted-label` is a sibling of `.name` inside `.card-content`, styled as a
small status line (not `.meta`, so it can carry its own color independent of
the metadata line). A card with `card--exhausted` must never also carry
`card.high` — app.ts sets confidence to `skip` and the card renders in the
"Not Found" section (see §1.3), not "Ready to Apply".

**Filter chip row.**  `state.filterStatus: FilterStatus` (`"all" | "ready" |
"review" | "notfound" | "missingphoto"`) gets UI: a row of toggle chips between
`.search-bar` and `.stats`:

```html
<div class="filter-chips" role="group" aria-label="Filter contacts by status">
  <button class="chip" type="button" data-filter="all" aria-pressed="true">All</button>
  <button class="chip" type="button" data-filter="ready" aria-pressed="false">Ready to Apply</button>
  <button class="chip" type="button" data-filter="review" aria-pressed="false">Needs Review</button>
  <button class="chip" type="button" data-filter="notfound" aria-pressed="false">Not Found</button>
  <button class="chip" type="button" data-filter="missingphoto" aria-pressed="false">Missing Photo</button>
</div>
```

Exactly one chip carries `aria-pressed="true"` at a time, matching
`state.filterStatus`. The active chip additionally gets modifier class
`chip--active`. Chip label strings are exactly the five above (Title Case, no
counts appended — counts already live in `.stats`).

**Separate "Not a Brand" and "Not Found" sections.**  VISION.md treats "this
contact isn't a business" and "this is a business but no logo was found" as
different facts; the audit calls out that the app currently merges them into
one "Not found / not a brand" section, hiding the real miss rate. The review
stage renders three result sections, not two:

```
"Ready to Apply"   — section class "section section--ready"
"Needs Review"     — section class "section section--review"
"Not a Brand"      — section class "section section--nonbrand"
"Not Found"        — section class "section section--notfound"
```

`.section` keeps its existing look; the `section--*` suffix exists purely as a
styling/testing hook and carries no required visual difference except where
noted below. "Not a Brand" holds items whose flags include `non-brand` or
`person`; "Not Found" holds business-classified items that exhausted every
candidate (`card--exhausted`, confidence `skip`, no non-brand/person flag).
Section heading copy is exactly `Ready to Apply (N)`, `Needs Review (N)`,
`Not a Brand (N)`, `Not Found (N)` — same `${title} (${items.length})` pattern
already used by `section()`.

**Virtualized list container.**  Each result section's `.grid` is wrapped in a
scroll viewport so only on-screen cards mount, per finding CL-08/09 ("virtualize
the list"):

```html
<div class="virtual-list" style="height: <viewport-px>px;">
  <div class="virtual-list-spacer" style="height: <total-content-px>px;">
    <div class="grid" style="transform: translateY(<offset-px>px);">
      <!-- only the currently-visible slice of .card elements -->
    </div>
  </div>
</div>
```

`.virtual-list` is the fixed-height, `overflow-y: auto` scroll container.
`.virtual-list-spacer` reserves full scrollable height so the scrollbar reflects
true content size. `.grid` keeps its existing grid layout rules and is
repositioned with an inline `transform: translateY(...)` per scroll frame —
styles.css must not put a competing `transform` on `.grid`. Section chrome
(`.section h2`) sits outside `.virtual-list`, never inside the scrolled region.

## 2. ARIA / semantics contract

**Per-card checkbox.**  The `<input type="checkbox">` in `card()` must carry an
accessible name tied to the contact, not be a bare unlabeled control:

```html
<input type="checkbox" aria-label="Apply logo to Jane's Cleaners" />
```

Exact label pattern: `` `Apply logo to ${item.contact.displayName}` ``. When the
card is in the exhausted/no-candidate state the checkbox is `disabled` (already
true today) and additionally gets `aria-label="No logo available for ${displayName}"`.

**Candidate buttons.**  Today a candidate button's only accessible name is
`title="${sourceLabel(cand.source)}"` on the button but the inner `<img
alt="${cand.source}">` (raw engine id, e.g. `"brandfetch"`) — screen readers
prefer the image's alt text over the button title, so users hear "brandfetch"
verbatim. Fix: give the button itself the accessible name via `aria-label`, and
make the inner image decorative:

```html
<button class="alts-btn" type="button" aria-label="Use Brandfetch (HD) logo" aria-pressed="false">
  <img src="..." alt="" />
</button>
```

Label pattern: `` `Use ${sourceLabel(cand.source)} logo` ``. The currently-chosen
candidate button gets `aria-pressed="true"` (all others `"false"`) in addition
to the existing `.on` class — `aria-pressed` is the semantic signal, `.on` is
the visual hook.

**Status banner `aria-live`.**  `.notice-banner` (the `<p>` bound to
`state.notice`) must carry `aria-live="polite"` and `aria-atomic="true"` so
async notices (import progress, sync progress, errors) are announced without
stealing focus:

```html
<p class="meta notice-banner" role="status" aria-live="polite" aria-atomic="true">…</p>
```

**Crop modal dialog semantics.**  `.modal-backdrop` wraps `.crop-modal`; the
modal itself needs full dialog semantics, an Escape binding, and a focus trap
(behavior lives in app.ts; this contract fixes the required attributes so
styles.css/index.html assumptions about landmark roles hold):

```html
<div class="crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-modal-title">
  <div class="crop-header">
    <h3 id="crop-modal-title">Crop & Adjust — Jane's Cleaners</h3>
    ...
```

Required behavior (app.ts): Escape closes the modal (equivalent to clicking
Cancel); focus moves to the modal's first focusable control on open and is
trapped within `.crop-modal` (Tab/Shift+Tab cycle, never escaping to the page
behind the backdrop) until it closes, at which point focus returns to the
element that opened it (the thumbnail or Crop button).

**Touch targets.**  Every interactive control a user taps — `.alts-btn`,
`.chip`, `.btn` variants, the checkbox's hit area — has a minimum 44×44px touch
target. `.alts-btn` is currently 36×36; the box itself may stay visually
smaller (32–36px image) but the clickable element's `min-width`/`min-height`
must be 44px, centering the smaller visual inside via padding, not by simply
enlarging the icon.

## 3. CSS custom-property token set

Token names are unchanged from today's `:root` block, plus new tokens for the
badge, chip, exhausted state, and focus ring. All tokens are defined three
times: once on bare `:root` (light, the default), once under a
`prefers-color-scheme: dark` media query guarded to not fire when the user has
explicitly chosen light, and once under an explicit `data-theme="dark"`
attribute so a manual toggle always wins.

```css
:root {
  color-scheme: light;
  --bg: #f4f0e8;
  --ink: #1c1917;
  --muted: #6b635a;
  --card: #fffdf8;
  --line: #e4dccf;
  --high: #2f7d4a;
  --medium: #b86b1a;
  --low: #a3491f;
  --skip: #8a8178;
  --accent: #1c1917;
  --accent-ink: #f8f4ec;
  --focus-ring: #2563eb;
  --danger: #b3261e;
  --badge-high-bg: #e4f3e8;
  --badge-high-ink: #1f5c34;
  --badge-medium-bg: #f7e9d8;
  --badge-medium-ink: #8a4a10;
  --badge-low-bg: #f5ded2;
  --badge-low-ink: #7a3312;
  --chip-bg: #fffdf8;
  --chip-ink: #6b635a;
  --chip-active-bg: #1c1917;
  --chip-active-ink: #f8f4ec;
  --exhausted-bg: #f1ebe0;
  --exhausted-ink: #8a8178;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #17140f;
    --ink: #f2ece1;
    --muted: #a89e90;
    --card: #211d17;
    --line: #3a342a;
    --high: #57c17d;
    --medium: #e0973f;
    --low: #e08360;
    --skip: #8a8178;
    --accent: #f2ece1;
    --accent-ink: #17140f;
    --focus-ring: #6ea8ff;
    --danger: #ff6b60;
    --badge-high-bg: #1c3524;
    --badge-high-ink: #8fe3ab;
    --badge-medium-bg: #3a2a14;
    --badge-medium-ink: #f0b871;
    --badge-low-bg: #3a2116;
    --badge-low-ink: #f0a37e;
    --chip-bg: #211d17;
    --chip-ink: #a89e90;
    --chip-active-bg: #f2ece1;
    --chip-active-ink: #17140f;
    --exhausted-bg: #201c16;
    --exhausted-ink: #7d766a;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #17140f;
  --ink: #f2ece1;
  --muted: #a89e90;
  --card: #211d17;
  --line: #3a342a;
  --high: #57c17d;
  --medium: #e0973f;
  --low: #e08360;
  --skip: #8a8178;
  --accent: #f2ece1;
  --accent-ink: #17140f;
  --focus-ring: #6ea8ff;
  --danger: #ff6b60;
  --badge-high-bg: #1c3524;
  --badge-high-ink: #8fe3ab;
  --badge-medium-bg: #3a2a14;
  --badge-medium-ink: #f0b871;
  --badge-low-bg: #3a2116;
  --badge-low-ink: #f0a37e;
  --chip-bg: #211d17;
  --chip-ink: #a89e90;
  --chip-active-bg: #f2ece1;
  --chip-active-ink: #17140f;
  --exhausted-bg: #201c16;
  --exhausted-ink: #7d766a;
}
```

`--accent-ink` replaces the hard-coded `#f8f4ec` currently used on `.btn`
text; `.btn` must read `color: var(--accent-ink)`, not a literal. Any color
literal styles.css introduces for the new elements below must resolve through
one of these tokens — no new bare hex values outside this table.

`web/index.html`'s `<meta name="theme-color" content="#1c1917">` stays as the
static light-mode value (browsers don't evaluate CSS custom properties for
this meta tag); add a second, dark-variant tag so the browser chrome matches
the manifest's dark `theme_color`:

```html
<meta name="theme-color" content="#1c1917" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#17140f" media="(prefers-color-scheme: dark)" />
```

## 4. Focus, motion, and disabled-state rules

**`:focus-visible`.**  Every interactive element (`.btn`, `.chip`, `.alts-btn`,
checkboxes, `.search-input`, `.settings-input`, `.zoom-slider`, the crop modal's
buttons) gets a visible focus ring on keyboard focus, not on mouse click:

```css
.btn:focus-visible,
.chip:focus-visible,
.alts-btn:focus-visible,
.search-input:focus-visible,
.settings-input:focus-visible,
.zoom-slider:focus-visible,
input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

**`prefers-reduced-motion`.**  Every transition/animation in the sheet
(`.card.drag-over`'s `transform`/`transition`, `.thumb.clickable:hover`'s
`transform`, `.modal-backdrop`'s `fadeIn` animation) is guarded:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Disabled state.**  `.btn:disabled` keeps its existing `opacity: 0.45;
cursor: not-allowed;` rule and it now also applies to `.chip:disabled` and
`.alts-btn:disabled` (a candidate button whose image 404'd is hidden via
`display:none` today via inline `style.display`, not disabled — that stays
app.ts's job, not this rule's).  The exhausted-card checkbox
(`disabled`) uses the same `:disabled` rule, no separate selector needed.

## 5. Copy rules: flags never reach the user verbatim

The metadata line (`.meta` inside `.card-content`) currently concatenates
`item.confidence`, `sourceLabel(hit.source)`, `viaLabel(item.via)`, and then
`item.flags.join(", ")` — dumping raw internal flag identifiers
(`homonym-risk`, `via-guess`, `guessed-domain`, `brand-tail`, `non-brand`,
`photo-protected`, `replace-existing`, `person`) straight into the UI, often
restating the same fact `viaLabel` already humanized.

Rule: **no raw flag identifier (the `item.flags` string values, or the literal
`via` enum values) may appear in rendered text.** Every flag that is
user-relevant gets a human phrase via a mapping table; every flag that exists
purely for internal tiering logic (not user-relevant) is dropped from display
entirely. The confidence word itself moves out of the metadata line and into
the badge (§1.2) — `.meta` no longer starts with `${item.confidence} ·`.

Flag → human phrase mapping (exhaustive; any flag not listed here is
suppressed, not printed as-is):

| Flag / via value | Shown to user? | Phrase |
|---|---|---|
| `via: "phone"` | yes | `found by phone` (existing `viaLabel`, unchanged) |
| `via: "catalog"` | yes | `known company` (existing `viaLabel`, unchanged) |
| `via: "website"` | yes | `from website` (existing `viaLabel`, unchanged) |
| `via: "email"` | yes | `from email` (existing `viaLabel`, unchanged) |
| `via: "guess"` | yes | `guessed from name` (existing `viaLabel`, unchanged) |
| `via-guess` | no (duplicates `via: "guess"`) | — suppressed |
| `via-catalog` / `via-website` / `via-phone` / `via-email` | no (duplicates `via`) | — suppressed |
| `guessed-domain` | yes, folded into the badge, not the meta line | badge gets a secondary note: `Domain guessed — check before applying` |
| `homonym-risk` | yes | `name is also a common word` |
| `brand-tail` | yes | `matched a partial name` |
| `replace-existing` | yes | `replaces an existing photo` |
| `non-brand` | n/a — routes to the "Not a Brand" section (§1.3), never rendered as inline text |
| `person` | n/a — item never enters the review list (`matchBook` filter); not a display concern |
| `photo-protected` | n/a — same as `person`; these contacts don't reach card rendering |

Resulting `.meta` line format (source and optional via/flag phrases only —
confidence has moved to the badge):

```
${sourceLabel(hit.source)}${via ? ` · ${viaLabel(item.via)}` : ""}${humanFlags.length ? ` · ${humanFlags.join(", ")}` : ""}
```

where `humanFlags` is built by mapping only `homonym-risk` and `brand-tail`
(the two flags with a phrase above that aren't already implied by the via
label or the badge) through the table — e.g. for a homonym-risk, via-guess,
guessed-domain business the old line

```
medium · Brandfetch (HD) · guessed from name · homonym-risk, via-guess, guessed-domain
```

becomes badge `Needs a look` (with the guessed-domain note under it) plus meta
line:

```
Brandfetch (HD) · guessed from name · name is also a common word
```

Each fact now appears exactly once, in user language.
