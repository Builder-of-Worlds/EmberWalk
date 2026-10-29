# EmberWalk landing site: design system

Scope: the public site in `workers/static/public/` (`index.html`, `privacy.html`, `site.css`, `site.js`, `boot.js`, `brand/`, `fonts/`). Every value below is read from those files; `site.css:NN` means file and line. The phone app has its own system in `.interface-design/system.md`.

## World

A wooded valley at dusk seen from a ridge, then the same house taken apart and made ready. Dark forest grounds, paper and sand cards, one warm gold for emphasis, ember orange only where fire or a finding is meant.

## Colour tokens

Custom properties on `:root`, `site.css:15` to `site.css:36`.

| Token | Value | Line | Role in the build |
| --- | --- | --- | --- |
| `--night` | `#1a271e` | 16 | page ground (`body`, 44), footer, solid card |
| `--forest` | `#22342a` | 17 | section tone, gradient end |
| `--leaf` | `#3d5a40` | 18 | button fill, links on light cards, step 1 node |
| `--paper` | `#f7f3e6` | 19 | body text on dark, light card ground |
| `--stone` | `#d9d2bd` | 20 | secondary text on dark: sources, captions, privacy prose |
| `--sand` | `#ece6d4` | 21 | section tone, subhead text |
| `--ink` | `#2d2a22` | 22 | text on light cards and controls |
| `--bark` | `#54402e` | 23 | lead text, error status, focus ring on light |
| `--muted` | `#5a5546` | 24 | source lines on light cards |
| `--edge` | `#857c63` | 25 | form control border |
| `--gold` | `#f5c24c` | 26 | links on dark, figures, fixes, focus ring on dark |
| `--orange` | `#f08a3c` | 27 | photo pins |
| `--ember` | `#c2561a` | 28 | step 3 node, flow progress start |
| `--required` | `#b3402a` | 29 | Required Now marker |
| `--recommended` | `#c9971c` | 30 | Recommended marker |
| `--glass` | `rgba(26, 39, 30, 0.8)` | 31 | default card ground |
| `--glass-line` | `rgba(247, 243, 230, 0.14)` | 32 | card and tile borders, step dividers |

Section tones, each a single background:

| Class | Token | Hex | Line |
| --- | --- | --- | --- |
| `.tone-forest` | `--forest` | `#22342a` | 133 |
| `.tone-night` | `--night` | `#1a271e` | 135 |
| `.tone-sand` | `--sand` | `#ece6d4` | 137 |

Two gradient grounds use the same pair: `.block` night to forest (125), `.closing` forest to night (481).

Local literals that are not tokens (one use each): button hover `#4b6d4f` (530), control ground `#fff` (502), phone bezel `#0e1611` (418), step dot `#2b3a30` (409), step 2 node `#8a5f08` (454), flow progress end `#b9780a` (649), take apart dim `#0d1510` (612), zone map fills `#26372b`, `#2f4634`, `#5e5530` and their on states (245 to 261). New surfaces use the tokens, not these.

## Type

- One family: Atkinson Hyperlegible, self hosted, weights 400 and 700 only, `font-display: swap` (`site.css:1` to `site.css:13`). Files: `fonts/atkinson-hyperlegible-latin-400-normal.woff2`, `...-700-normal.woff2`, licence `fonts/OFL.txt`. Both weights are preloaded (`index.html:27`, `index.html:28`). Fallback `system-ui, sans-serif` (`site.css:46`).
- Body: `clamp(1.0625rem, 1rem + 0.35vw, 1.25rem)`, line height 1.6 (`site.css:47`, 48).
- Headings: line height 1.15, bottom margin 0.9rem, `text-wrap: balance` (69).
  - `h1` `clamp(2.1rem, 1.4rem + 3.4vw, 4rem)` (71)
  - `h2` `clamp(1.6rem, 1.2rem + 1.8vw, 2.5rem)` (73)
  - `h3` `clamp(1.15rem, 1.05rem + 0.5vw, 1.4rem)` (75)
- Display figure: `clamp(2.6rem, 2rem + 3vw, 4rem)`, 700, gold, line height 1 (211); unit words in `small` at 0.55em (213).
- Statement: `clamp(1.2rem, 1.05rem + 0.8vw, 1.6rem)`, line height 1.5, strong in gold (462, 464).
- Small sizes: lead 1.1em (485); tile and step text 0.95em to 0.98em (229, 288, 399); captions 0.95rem (344, 422); labels 0.9rem (493); fine print 0.88rem, line height 1.5 (546); footer 0.85rem (550); tips 0.8rem (322); sources 0.78rem (207).
- Paragraphs, list items and captions use `text-wrap: pretty` (79). Weight is the only emphasis; no italics and no letter spacing on running text.

## Spacing and radii

- Section padding `3.5rem 1rem` (119), `4.5rem 2rem` from 900px (636). Closing `3.5rem 1rem 3rem` (481). Footer `0 1rem 2.5rem` (550).
- Card padding `1.6rem 1.35rem` (87), `2rem 2.25rem` from 900px (637). Signup card `2rem 1.35rem` (483).
- Paragraph rhythm 0.9rem (77). Grid gaps step through 0.75rem, 1rem, 1.25rem, 1.5rem (217, 233, 235, 275, 346, 414); opening cards 6rem apart before pinning (165).
- Radii: card 1.25rem (88); stat and zone tiles 1rem (223, 279); photos 1.1rem (294, 351); controls and button 0.75rem (501, 522); phone bezel 2.2rem with 1.7rem screen (418, 420); tips 999px (319); pins, markers, dots 50%.
- Breakpoint: one, `min-width: 900px` (634). Below it every grid is one column.

## Cards

Base `.card` (83): full width up to 42rem, centered by `margin: 0 auto`, glass ground `--glass`, 1px `--glass-line` border, 10px backdrop blur, shadow `0 18px 50px rgba(0, 0, 0, 0.28)`.

| Variant | Line | Change |
| --- | --- | --- |
| `.wide` | 96 | max width 64rem |
| `.solid` | 98 | ground `--night`, no blur |
| `.light` | 100 | ground `--paper`, text `--ink`, no border, warm shadow `rgba(84, 64, 46, 0.18)`; links `--leaf` (102) |
| `.signup-card` | 483 | max width 30rem, all text centered |

Pairing in `index.html`: glass and solid cards sit on forest or night tones; light cards sit on sand tones or the closing gradient. Inner tiles (`.stat` 219, `.zone` 277) are 6% paper on the card with the same border; the active zone turns gold at 12% with a 75% gold border (290).

## Buttons and form controls

- `.button` (518): min height 3.4rem, `--leaf` ground, `--paper` text, weight 700, radius 0.75rem, no border; hover `#4b6d4f` (530); disabled 0.6 opacity with a progress cursor (532). In the signup grid it spans the full card width.
- `.control` (496): min height 3.2rem, 2px `--edge` border, radius 0.75rem, white ground, `--ink` text, inherits the font. Text inside a control is left aligned (505).
- `select.control` (508): native arrow removed, an ink chevron drawn at `right 1.1rem`, size 1.4rem.
- Labels sit above controls, 0.9rem, 700, `--ink` (491, 493).
- Status line `.status` (538): centered, balanced, `--ink`; errors `--bark` and 700 (540). It is a polite live region (`index.html:348`).
- Focus: 3px gold outline, 3px offset (542); bark on light cards (544).

## Alignment

- Headings `h1` to `h3` are centered everywhere (69); card titles therefore center.
- Captions center (`.pinboard figcaption` 344, `.phone figcaption` 422), as do figures (211), stats (226), zones (282), timeline steps (393), flow nodes (435), the statement (462), the checks list (468), the signup form and its button (489), and the footer (550).
- Running paragraphs may stay left aligned inside a centered column: the privacy prose (`privacy.html:40`, `.column.prose.card`) keeps its paragraphs at the default start alignment while the card is centered by `margin: 0 auto` (86). On the landing page, paragraphs that stand alone in a card carry `.center`.
- Nothing hugs the left edge: every section has at least 1rem side padding (119, 121, 125, 481) and every card is a centered column with a max width.

## Motion

- One curve, `--heavy: cubic-bezier(0.3, 0, 0.1, 1)` (`site.css:33`, `site.js:2`). Durations run long and calm: 700ms to 1800ms.
- Scroll scrub is damped, not tied 1:1 to the scrollbar: each frame moves toward the scroll target by `1 - exp(-dt * 4)` (`site.js:69`, 106), settling under 0.0005 (`site.js:70`, 158). The opening film and the take apart passage pin with sticky frames 100svh tall (175, 583) and step through `.beat` spacers (604).
- `.rise` reveal (552 to 561): starts transparent, 2.5rem low, scale 0.97, 4px blur; when shown it settles over 1200ms (opacity, blur) and 1600ms (movement). A card that is above the viewport waits 2.5rem high instead (`.above`, 559), so scrolling back up it drops in from above. Trigger margin `-12% 0px -12% 0px` (`site.js:50`).
- Pinned opening cards cross fade with blur and scale 0.96 (196 to 205). Take apart cards slide 1.5rem and fade (598). Zone bands grow from 0.86 scale over 1800ms, 700ms apart (`site.js:82` to 85, 394).
- Pins ping once every 1600ms when shown (569, 628); tips lift 0.4rem as they appear (565).
- Reduced motion shows everything at once: `boot.js` adds `.js` only when reduced motion is not asked for, so every `.js`-gated hidden state (552, 563, 565) never applies; `site.js:512` returns before any scrub or reveal starts, and the remaining transitions are switched off (652 to 654).

## Images

- Every house or app picture file name starts `synthetic-` and is WebP: `landing/synthetic-*.webp` and `landing/frames/synthetic-v2-*.webp` (`site.js:122`).
- Every `img` sets `width` and `height` (for example `index.html:38`, 121, 230, 246, 275, 313). Wide pictures ship 960 and 1920 widths in `srcset`.
- Every meaningful picture has a plain alt sentence describing what is in it; layered copies use empty alt (`index.html:124`).
- No visible "synthetic" label is required on any image; the footer line at `index.html:357` that says so is under copy review and may go.
- App screenshots sit in a phone bezel (`.bezel`, 418), 15rem or 70vw wide (416).

## Brand files

All in `workers/static/public/brand/`.

| File | Size | Use |
| --- | --- | --- |
| `lockup-dark.png` | 836 x 192 | the masthead lockup on the dark opening (`index.html:43`), width `min(20rem, 78vw)`, 26rem from 900px (`site.css:34`, 635) |
| `lockup.png` | 836 x 192 | light ground lockup; not referenced by the pages |
| `mark.svg` | vector | shield and house in leaf `#3d5a40`; not referenced by the pages |
| `mark-dark.svg` | vector | the same in paper `#f7f3e6` and stone `#d9d2bd`, house in leaf; not referenced by the pages |
| `icon.svg` | vector | leaf shield, paper house; the favicon (`index.html:10`) |
| `icon-32.png`, `apple-touch-icon.png` | 32, 180 | favicon and home screen icon (`index.html:9`, 11) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | 192, 512, 512 | install icons; not referenced by the pages |
| `share-card.png` | 1200 x 630 | link preview image (`index.html:17`) |

The privacy page uses a text wordmark instead of the lockup: 1.5rem, 700, letter spacing 0.02em, paper (`site.css:123`, `privacy.html:35`).

## Rules for a new section

1. Pick one tone class; put one card on it, `wide` when it holds a grid.
2. Use the tokens above; a new colour is a new token, not a literal.
3. Title centered, paragraphs either `.center` or left inside the centered card.
4. Add `.rise` to the card; never hide content without the `.js` gate.
5. Pictures follow the image rules; sources sit last in `.source`.
6. Check at 390px wide: no sideways scroll.
