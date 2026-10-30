# EmberWalk phone app: design system

Scope: the app in `apps/web/src/`: `styles.css` (the only stylesheet, imported at `main.tsx:3`), the screens in `src/screens/`, and `copy.ts` for naming only. `styles.css:NN` means file and line. The public landing site has its own system in `DESIGN.md`.

## World

A field tool held in one hand outdoors: warm paper ground, earth browns for headings and emphasis, one muted leaf green for action and progress. Light theme only. No glass, no shadows on surfaces, no imagery beyond the user's own walk.

## Colour tokens

Custom properties on `:root`, `styles.css:1` to `styles.css:15`.

| Token | Value | Line | Role in the build |
| --- | --- | --- | --- |
| `--paper` | `#efeae0` | 7 | page ground (13, 23), text on filled buttons, photo marker border |
| `--ink` | `#2f2a25` | 8 | body text (12), passed trail labels |
| `--bark` | `#4a3f35` | 2 | headings (44, 55, 371), banner text, Required Now label, pressed toggle, source links, note border, video ground |
| `--soil` | `#6b5a48` | 3 | hints, upcoming trail steps, counts, outline strokes, button focus ring |
| `--leaf` | `#5b6b4f` | 4 | button border, primary fill, progress fill, done marks, radio accent |
| `--leaf-dark` | `#46543d` | 5 | outline button text, all clear line, current step ring |
| `--stone` | `#d9d3c7` | 6 | tile ground (walks, findings, banner), choice border, trail track |

Outside the stylesheet: `theme-color` and manifest `theme_color` are `#5b6b4f` (`apps/web/index.html:6`, `public/manifest.webmanifest`), manifest `background_color` is `#efeae0`; both match `--leaf` and `--paper`.

There is no separate colour for Recommended: `.label.required_now` alone is coloured `--bark` (279); every label is 700 weight (275).

## Type

- Family stack `"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif` (`styles.css:9`). The app ships no `@font-face` and no font file, so it renders in Atkinson Hyperlegible only where the phone already has it installed.
- Root size 1.25rem, line height 1.5 (10, 11). Text size adjust is fixed at 100% (14).
- `h1` 1.75rem, line height 1.2, `--bark` (40 to 45).
- `h2` 1.375rem, line height 1.25, `--bark` (51 to 56).
- `h3` 1.25rem, `--bark` (368 to 372).
- Finding sentence 1.5rem, 700, line height 1.3 (297 to 301). Recording time left 1.5rem, 700, tabular figures, centered (100 to 106).
- Smaller text: citations and trail marks 1rem (286, 433). Nothing smaller.
- Emphasis is weight 700 only: labels (275), status first line (309), all clear (231), source links (353), current trail step (469).
- Numbers that change in place use `font-variant-numeric: tabular-nums` (105, 482).

## Layout and spacing

- `.app` (26): at least `100dvh`, max width 40rem, centered, 1rem padding, `overflow-wrap: break-word` so long words never push sideways.
- `.screen` (34): a single column, 1rem gap. Every screen root is `<main className="screen">` (`Home.tsx:42`, `How.tsx:21`, `Results.tsx:142`, `Finding.tsx:92`).
- Gaps step 0.5rem, 0.75rem, 1rem: list stacks 0.75rem (65, 71, 339, 347, 365), button grids 0.5rem (138, 212, 316), finding list 1rem (240).
- Tile padding 0.75rem (78, 196, 247); banner `0.75rem 1rem` (85).
- Radii: tiles, buttons, banner, choices, video 0.75rem (79, 86, 95, 114, 198, 248); photo and note input 0.5rem (259, 330); photo marker and progress bar 0.375rem (271, 489); trail marks 50%.
- No breakpoints. The app is one phone column at every width.

## Components

**Buttons** (`.button`, 108): block, full width, min height 3.5rem, 2px `--leaf` border, radius 0.75rem, 700, centered text, transparent ground with `--leaf-dark` text. Links styled as buttons drop the underline (120).
- `.primary` (124): `--leaf` fill, `--paper` text. One per screen state is the main action (`Home.tsx:44`, `How.tsx:28`).
- `.toggle` (129): pressed state from `aria-pressed="true"` turns `--bark` fill and border, paper text. Used for view choice (`Results.tsx:145`), status choice (`Finding.tsx:49`) and recording switches (`Record.tsx:81`).
- Grids of buttons: `.controls` auto fit, min 6.5rem (135 to 143); `.views` two equal columns, min height 3rem (209 to 218); `.statuses` wrap, each at least 6rem (313 to 321).
- Disabled: 0.5 opacity, default cursor (374). Focus: 3px `--soil` outline, 2px offset (379).

**Tiles**: `--stone` ground, radius 0.75rem, 0.75rem padding, stacked with 0.5rem gaps. Used for a walk in Your Walks (74, `Home.tsx:13`) and a finding row (243, `Results.tsx:19`). Tiles carry no border and no shadow.

**Banner** (`.banner`, 83): stone ground, bark text, a polite status region shown only when offline (`App.tsx:60`).

**Choices** (`.choice`, 192): radio rows with a 2px stone border, 1.5rem inputs in `--leaf` accent (201 to 207).

**Text input** (`.note input`, 323): full width, min height 3rem, 2px `--bark` border, radius 0.5rem, inherits the font (`Finding.tsx:67`).

**Status lines** (`.status`, 303; `Status.tsx`): one wrapping row; the first line names the state in 700 (309), a second line adds context (not rechecked yet, or a long date in a `time` element, `Status.tsx:12`). The kind is also written as a class and `data-status` (`Status.tsx:18`). No colour per kind.

**Photo and marker (pins)** (`Photo.tsx`): `.proof` clips the still with radius 0.5rem (256). `.marker` (268) is a box around the found thing, placed by percentage from the finding's box (`Photo.tsx:12`), 4px paper border with a 3px bark ring so it reads on any photo. The still has empty alt; the sentence beside it carries the meaning.

**Progress trail** (`.trail`, 384 to 499; `Progress.tsx`): an ordered list of stages. Each has a 2rem round mark joined by a 4px track.
- Upcoming: soil label, stone ring, paper fill (397, 427).
- Current: 4px `--leaf-dark` ring with a 0.75rem dot (447 to 457), bark 700 label (467), a line of what is happening, and when counted a 0.75rem stone bar filled in leaf (485 to 498) with a tabular count (478).
- Behind: leaf fill and track, ink label (419, 438, 463).
- Only the current stage is read aloud; the rest are `aria-hidden` (`Progress.tsx:16`). The list is a polite live region unless the screen is waiting (`Progress.tsx:11`).

**Pan outline** (`.outline`, 145 to 180; `Record.tsx:66`): a 5rem square with four corner circles. Corners fill leaf when reached; the side being panned strokes bark, panned sides stroke leaf.

**Video preview** (`.preview`, 91): full width, at most 60dvh, cover fit, bark ground behind it.

**Fix preview** (`.fix-preview`, 375 to 404; `FixPreview.tsx`): a stone figure with radius 0.5rem held at 16 / 9 while the image loads, the image cover fit inside it. The AI label (`.ai-label`, 391) sits centered 0.5rem above the bottom edge on a bark chip with radius 0.375rem, paper text at 1rem, 700. If the preview cannot be fetched, the button and figure leave the screen.

**Second check note** (`.second-check`, 407): a centered note under the finding sentence, soil text at 1rem, shown only when the second check flags the instruction (`FixPreview.tsx:35`).

## States

- Pressed, disabled and focus as above; state lives in ARIA attributes (`aria-pressed`, `aria-expanded`) and `data-*` attributes (`data-route`, `data-verdict`, `data-view`, `data-status`, `data-stage`, `data-part`), which tests read.
- Offline: the banner appears at the top of every screen (`App.tsx:59`).
- Done: leaf fill on marks and tracks; there is no red or alarm colour in the app.

## Motion

- Only the progress trail moves: track and mark colour 0.4s ease (412, 435), bar width 0.6s ease (498).
- Reduced motion removes those transitions (501 to 507).
- No entrance animation on any screen.

## Copy naming (structure only)

- `copy.ts` exports `copy`, grouped by screen or part: `app`, `home`, `results`, `status`, `finding`, `how`, `record`, `send` (`copy.ts:114` onward). Screens read only their own group.
- Values that depend on data are functions taking typed arguments (for example `side`, `count`, `day`); enum maps are typed with `satisfies Record<Label, string>` or `Record<StatusKind, string>` so every case has words (149, 152).
- Data keys stay snake case (`required_now`, `fix_planned`, `zone_0`); copy keys are camel case.
- Button and heading words are in title case; sentences are in sentence case.
- Two other exports hold words kept apart from `copy`: `draft` (58) and `unbacked` (103).

## Rules for a new screen

1. Root is `<main className="screen">` inside `.app`; one `h1`.
2. Colours from the seven tokens only; a new colour is a new token.
3. Actions are full width `.button`s; at most one `.primary` for the main action; choices among equals are `.toggle`s with `aria-pressed`.
4. Grouped content sits on stone tiles; no borders, shadows or glass.
5. Words come from the screen's group in `copy.ts`.
6. Anything that moves has a reduced motion rule.
7. Check at 390px wide: no sideways scroll.
