# ContactLogo — logo concepts

Four logo directions for ContactLogo, drawn as hand-authored SVGs.  All four
build on the identity the product already ships: warm cream (`#f5f0e8`),
near-black ink (`#1c1917`), gold (`#c4a574`), and the serif, letterpress
feel of the web app (Iowan Old Style / Palatino).

Open `preview.html` in a browser to see every concept at app-icon sizes
(128/64/32/16), on light and dark, plus the wordmark treatment.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| Ink | `#1c1917` | Primary mark color, dark tiles |
| Cream | `#f5f0e8` | Background, reversed marks |
| Gold | `#c4a574` | The "logo" accent — always marks the brand moment |
| Grey | `#ddd6c9` / `#a89d8d` | The "before" state: unbranded contacts |

The system rule across all four: **grey is the generic contact, gold is the
matched logo.** That is the product story in two colors.

## Concepts

### 01 — The Swap (`01-swap.svg`) — **front-runner**

A contact tile split on the diagonal: the top half is the grey monogram
silhouette every address book shows today; the bottom half is ink with a
gold spark — the moment ContactLogo replaces it with a real brand mark.
Most literal telling of the before/after.  Works directly as an app icon.

Picked as the working direction after first review.  Three cuts:

- `01-swap.svg` — the tile (app icon, marketing).
- `01-swap-round.svg` — circular avatar cut, the shape it lives in inside
  Contacts UIs; `01-swap-round-dark.svg` flips the ink half to cream so
  the disc holds its shape on dark grounds.
- `01-swap-small.svg` — simplified cut for 32 px and below: the person
  glyph drops and the spark grows, so the favicon stays crisp.
- `01-swap-square.svg` / `01-swap-1024.png` — full-bleed square cut for
  iOS app icons: no corner crop, since iOS applies its own squircle
  mask.  Geometry matches the tile exactly, so the masked result equals
  `01-swap.svg`.  The PNG is 1024×1024 RGB with no alpha, ready for the
  App Store / Xcode single-size AppIcon slot.

### 02 — Card & Badge (`02-card.svg`, `02-card-icon.svg`)

A business card whose avatar spot holds a gold-ring badge.  "A clean,
recognizable logo on every business card" as a picture.  The ringed circle
is a direct evolution of the current favicon, so it keeps continuity with
what is already deployed.  Strong at tiny sizes.

### 03 — C Aperture (`03-seal.svg`, `03-seal-icon.svg`)

A heavy letter C — ContactLogo's monogram — whose open mouth receives a
gold dot: the C accepting a logo.  The most abstract and most scalable of
the four; still legible at 16 px, works one-color, and doubles as a
favicon, watermark, or stamp.  Pairs naturally with the wordmark below.
Kept as the one-color alternate for stamps and watermarks.

### 04 — The Grid Lights Up (`04-grid.svg`, `04-grid-icon.svg`)

A 2×2 address-book grid: three grey contacts, one lit up in ink and gold.
Tells the scanning/matching story — out of a book full of grey monograms,
ContactLogo finds the brands.  Best at medium and large sizes (marketing,
splash screens); the person glyphs soften below 32 px.

## Wordmark

`ContactLog` set in the product serif (Iowan Old Style / Palatino /
Georgia), with the final **o** replaced by the gold-ring badge — the same
badge as the favicon and Concept 2.  Shown in `preview.html`.  If adopted,
the letterforms should be converted to outlines so the wordmark does not
depend on installed fonts.

## Direction

**01 (The Swap) is the working direction after first review** — it tells
the before/after story in one tile, is already the app icon, and its three
cuts cover every context (tile, circular avatar with dark flip, simplified
small-size).  03 stays the one-color alternate for stamps and watermarks;
the Concept 2 badge remains the deployed favicon until the swap-in; 04
works as an illustration motif in onboarding and empty states.

## Next steps

- Reversed (cream-on-ink) and one-color variants of the chosen mark.
- Replace `web/public/favicon.svg` and the PWA manifest icons.
- macOS/iOS `AppIcon` asset catalogs rendered from the SVG.
- Wordmark converted to outlined paths.
