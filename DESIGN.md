# DESIGN.md — Stan CLI

> Design system for **Stan CLI**, modelled on the **iOS News (Apple News) app**.
> An editorial, card-driven feed: big bold headlines, a magazine-style mixed-size
> card grid, grouped sections, and the signature News red. Drop this in the
> project root and have the coding agent build UI that matches it.

-----

## 1. Visual Theme & Atmosphere

**Mood:** Editorial, calm, premium. It should read like a well-designed
newspaper, not a dashboard. Content is the hero; chrome stays quiet.

**Density:** Low to medium. Generous breathing room between cards and sections.
Never cramped — whitespace is doing real work.

**Design philosophy:**

- **Magazine layout, not a list.** The feed mixes card sizes — one large hero
  card leading a section, then smaller stories beneath. Visual rhythm matters
  more than uniformity.
- **Grouped by section.** Content lives under clear, bold section headers
  (“Top Stories”, “Trending”, “For You”). Each group feels like a page in a
  publication.
- **Light-first.** Default is a bright, paper-white canvas. Dark mode is fully
  supported but the design is conceived in light.
- **Quiet chrome, loud content.** Navigation and controls recede; headlines and
  imagery carry the screen.
- **One accent only.** The News red is used sparingly — for the brand mark,
  active states, and key actions. Everything else is black, white, and grey.

-----

## 2. Color Palette & Roles

### Light mode (default)

|Semantic name     |Hex      |Role                                            |
|------------------|---------|------------------------------------------------|
|`canvas`          |`#FFFFFF`|App background, card surfaces                   |
|`grouped-bg`      |`#F2F2F7`|Background behind grouped sections / inset lists|
|`surface-elevated`|`#FFFFFF`|Cards sitting on grouped-bg                     |
|`brand-red`       |`#FF3B5C`|News accent — logo, active tab, primary actions |
|`brand-red-press` |`#E32E4C`|Pressed state of brand-red                      |
|`label-primary`   |`#000000`|Headlines, primary text                         |
|`label-secondary` |`#3C3C43`|Body copy, summaries                            |
|`label-tertiary`  |`#8E8E93`|Timestamps, publisher names, metadata           |
|`separator`       |`#C6C6C8`|Hairline dividers between rows                  |
|`separator-soft`  |`#E5E5EA`|Lighter dividers, card outlines                 |
|`fill-quaternary` |`#F2F2F7`|Image placeholders, skeleton loaders            |

### Dark mode

|Semantic name     |Hex      |Role                                 |
|------------------|---------|-------------------------------------|
|`canvas`          |`#000000`|App background                       |
|`grouped-bg`      |`#000000`|Grouped section background           |
|`surface-elevated`|`#1C1C1E`|Cards                                |
|`surface-raised`  |`#2C2C2E`|Cards stacked on a card              |
|`brand-red`       |`#FF4E6A`|Slightly lifted red for dark surfaces|
|`label-primary`   |`#FFFFFF`|Headlines                            |
|`label-secondary` |`#EBEBF5`|Body copy                            |
|`label-tertiary`  |`#8E8E93`|Metadata                             |
|`separator`       |`#38383A`|Hairline dividers                    |
|`separator-soft`  |`#2C2C2E`|Card outlines                        |

**Rule:** Never introduce a second accent colour. Status colours (success,
error) may appear functionally but are never decorative.

-----

## 3. Typography Rules

**Font families:**

- **UI + headlines:** `SF Pro Display` (large text) / `SF Pro Text` (small text).
  Fallback stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- **Editorial serif (optional accent):** `New York`, falling back to
  `Georgia, "Times New Roman", serif`. Used only for feature/hero headlines when
  an editorial tone is wanted — never for UI chrome.
- **Mono (CLI/code surfaces):** `SF Mono`, fallback `"JetBrains Mono", ui-monospace, monospace`.

**Hierarchy:**

|Token           |Size / Line height|Weight        |Tracking|Use                           |
|----------------|------------------|--------------|--------|------------------------------|
|`display`       |34 / 40           |Heavy (800)   |-0.4px  |Screen title (“Today”)        |
|`hero-headline` |28 / 32           |Bold (700)    |-0.3px  |Lead card headline            |
|`headline`      |22 / 26           |Bold (700)    |-0.2px  |Standard card headline        |
|`headline-sm`   |17 / 22           |Semibold (600)|-0.1px  |Small/list card headline      |
|`section-header`|20 / 24           |Heavy (800)   |-0.2px  |“Top Stories” group titles    |
|`body`          |15 / 21           |Regular (400) |0       |Card summary / dek            |
|`byline`        |13 / 16           |Semibold (600)|+0.3px  |Publisher name — **UPPERCASE**|
|`caption`       |12 / 15           |Regular (400) |0       |Timestamps, metadata          |
|`tab-label`     |10 / 12           |Medium (500)  |+0.1px  |Bottom tab labels             |

**Rules:**

- Headlines are tight (negative tracking) and heavy — this is the Apple News
  signature. Don’t use light weights for headlines.
- Publisher names (“THE VERGE”, “BBC NEWS”) are always uppercase, small,
  tertiary colour, with positive letter-spacing.
- Body/dek text never goes below 15px.
- Maximum 2 lines for small-card headlines, 3 for hero — truncate with ellipsis.

-----

## 4. Component Stylings

### Hero card (section lead)

- Full-bleed image on top, `16:9` or `4:3`, `corner-radius: 14px`.
- `hero-headline` directly below image, then optional `body` dek (2 lines max).
- Publisher row beneath: small logo (16px) + `byline` uppercase name + `caption` timestamp.
- No visible border in light mode; sits directly on `canvas`. Tap state: whole
  card dims to 92% opacity.

### Standard card

- Image left or top depending on layout (`12px` radius), headline + byline.
- `corner-radius: 12px` on the card container when on `grouped-bg`.
- Light mode: 1px `separator-soft` outline OR resting on white with a hairline
  divider below — pick one per screen, don’t mix.

### List-style story row (compact)

- Thumbnail right, 80×80, `8px` radius. Headline (`headline-sm`, 2 lines) left.
- Byline + timestamp below headline.
- Hairline `separator` divider between rows, inset to align with text (not the
  thumbnail edge).

### Section header

- `section-header` token, `label-primary`, left-aligned.
- Optional red “>” chevron or “See All” affordance in `brand-red` on the right.
- ~24px space above, ~12px below.

### Bottom tab bar

- 4–5 tabs, height 49px + safe-area inset. Translucent — a blurred material over
  content (`backdrop-filter: blur(20px)`, 80% canvas tint).
- Icon (24px line icon) above `tab-label`. Active tab: icon + label in
  `brand-red`. Inactive: `label-tertiary`.
- Hairline `separator` along the top edge.

### Top navigation bar

- Large-title style: `display` token title, left-aligned, sits inline with feed
  and shrinks to a centered inline title on scroll.
- Translucent blurred background once scrolled. Trailing action icons in
  `label-primary` (or `brand-red` for primary action).

### Buttons

- **Primary:** `brand-red` fill, white label, `headline-sm` weight, full-radius
  pill (`corner-radius: 999px`), 44px tall. Press → `brand-red-press`.
- **Secondary:** `grouped-bg` fill, `label-primary` text, same pill shape.
- **Text/inline:** `brand-red` label, no fill — used for “See All”, “Follow”.
- **Follow chip:** small pill, `brand-red` outline + red label when not followed;
  `brand-red` fill + white label when followed.

### Search field

- `grouped-bg` fill, `corner-radius: 10px`, 36px tall, magnifier glyph +
  placeholder in `label-tertiary`. No border.

### Skeleton / loading

- `fill-quaternary` blocks at the card’s shape, subtle shimmer left-to-right.
  Never spinners in the feed.

-----

## 5. Layout Principles

**Spacing scale (8pt base):** `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`.

- **Screen margins:** 16px left/right gutters on phone.
- **Card spacing:** 16px vertical gap between cards in a section.
- **Section spacing:** 32px between the end of one section and the next
  `section-header`.
- **Grid:** Single column on phone. Hero card spans full width; standard cards
  full width; compact rows full width. On wide layouts (iPad/desktop) move to a
  2-column masonry — hero spans both columns, standard cards fill one each.
- **Inset grouping:** Grouped sections sit on `grouped-bg` with cards inset 16px
  and `12–14px` radius, mimicking iOS inset grouped tables.
- **Alignment:** Everything aligns to the 16px gutter. Text within a card aligns
  to a consistent inner padding of 12–16px.
- **Whitespace philosophy:** When unsure, add space. Crowding kills the
  editorial feel. Headlines need room above and below.

-----

## 6. Depth & Elevation

Apple News is **nearly flat** — depth comes from blur and hairlines, not heavy
shadows.

|Layer              |Treatment                                                                                          |
|-------------------|---------------------------------------------------------------------------------------------------|
|Feed cards         |No shadow in light mode. Separated by whitespace + hairline dividers.                              |
|Inset grouped cards|Optional shadow `0 1px 3px rgba(0,0,0,0.06)` — barely there.                                       |
|Bottom tab bar     |Translucent blur material, hairline top separator. No drop shadow.                                 |
|Nav bar (scrolled) |Translucent blur, hairline bottom separator.                                                       |
|Modals / sheets    |`corner-radius: 16px` top, shadow `0 -2px 20px rgba(0,0,0,0.12)`, dimmed scrim behind at 40% black.|

**Surface hierarchy (dark mode):** `canvas (#000)` → `surface-elevated (#1C1C1E)`
→ `surface-raised (#2C2C2E)`. Elevation is communicated by getting *lighter*,
not by shadow.

**Rule:** No coloured shadows, no glows, no neumorphism. Maximum shadow opacity
is ~12%.

-----

## 7. Do’s and Don’ts

**Do:**

- ✅ Use heavy, tight headlines — they carry the design.
- ✅ Mix card sizes within a section for magazine rhythm.
- ✅ Keep publisher names small, uppercase, tertiary.
- ✅ Lean on whitespace and hairlines for structure.
- ✅ Keep the red rare — brand mark, active tab, primary CTA only.
- ✅ Use translucent blurred bars over content.
- ✅ Round card corners (12–14px) and image corners consistently.

**Don’t:**

- ❌ Don’t make the feed a uniform list of identical cards.
- ❌ Don’t use light-weight fonts for headlines.
- ❌ Don’t add a second accent colour or decorative gradients.
- ❌ Don’t use heavy drop shadows or glows.
- ❌ Don’t crowd cards — never drop section spacing below 24px.
- ❌ Don’t put borders *and* dividers *and* shadows on the same card; pick one
  separation method per screen.
- ❌ Don’t use spinners in the feed — use skeleton placeholders.
- ❌ Don’t let body text go below 15px or tap targets below 44px.

-----

## 8. Responsive Behavior

**Breakpoints:**

- `phone`: < 600px — single column, 16px gutters, bottom tab bar.
- `tablet`: 600–1024px — 2-column masonry, hero spans full width, 24px gutters.
- `desktop`: > 1024px — centered content column max-width ~960px, 3-column
  masonry optional; tab bar may become a left sidebar.

**Touch targets:** Minimum 44×44px for every interactive element. Follow chips
and inline text buttons still need 44px hit areas even if visually smaller.

**Collapsing strategy:**

- Large nav title shrinks to an inline centered title on scroll.
- On narrow widths, list-style rows replace standard cards to save vertical
  space; hero card always survives.
- Bottom tab bar → left rail on desktop; labels stay visible.
- Images keep aspect ratio and crop center; never letterbox.

**Safe areas:** Respect top notch/Dynamic Island and bottom home indicator
insets — content and the tab bar pad accordingly.

-----

## 9. Agent Prompt Guide

**Quick color reference:**

- Background: `#FFFFFF` light / `#000000` dark
- Grouped background: `#F2F2F7` light / `#000000` dark
- Cards (dark): `#1C1C1E`
- Accent (News red): `#FF3B5C` light / `#FF4E6A` dark
- Primary text: `#000000` / `#FFFFFF`
- Secondary text: `#3C3C43` / `#EBEBF5`
- Metadata text: `#8E8E93`
- Hairline: `#C6C6C8` light / `#38383A` dark

**Fonts:** SF Pro Display/Text (UI + headlines) · New York serif (optional
editorial headlines) · SF Mono (code/CLI surfaces).

**Ready-to-use prompts:**

> “Build the Stan feed screen using DESIGN.md. Large-title nav reading the
> screen name. Below it, a ‘Top Stories’ section header, then a hero card
> (16:9 image, 14px radius, bold 28px headline, 2-line dek, uppercase publisher
> byline with 16px logo and timestamp). Follow it with three standard cards.
> 16px gutters, 16px between cards, 32px before the next section.”

> “Create the bottom tab bar from DESIGN.md: translucent blurred material,
> 49px + safe area, 4 tabs with 24px line icons and 10px labels. Active tab in
> News red `#FF3B5C`, inactive in `#8E8E93`, hairline top separator.”

> “Build a compact story list per DESIGN.md: rows with an 80×80 thumbnail (8px
> radius) on the right, 2-line 17px semibold headline on the left, uppercase
> byline + timestamp below, hairline dividers inset to the text edge.”

> “Style a section header from DESIGN.md: 20px heavy weight, black, with a
> ‘See All’ text button in News red on the trailing edge, 24px above and 12px
> below.”

**Tone for the agent:** Editorial and calm. Content first, chrome quiet, one
accent, lots of air. When in doubt, add whitespace and make the headline bolder.