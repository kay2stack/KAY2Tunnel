# Stan CLI — Mascot & Brand Brief

> "A tiny companion for your greatest ideas." — Stan

---

## Identity in one sentence

Stan CLI is a **personal terminal companion** — approachable, a little mischievous, always ready to ship. The brand sits at the intersection of dev-tool utility and playful personality.

---

## Mascot — Stan

Stan is a small, fluffy **black kitten** with oversized yellow-green eyes and a signature terminal block (`>_`) he holds up like a sign. He is the soul of the product.

### Character traits
- Curious and clever, not intimidating
- Loves the terminal; lives in it
- Slightly dramatic about bugs; deeply satisfied by clean commits
- Never judges. He's seen worse.

### Canonical poses

| Name | Description | Usage |
|------|-------------|-------|
| **Default Stan** | Peering over a floating terminal block, paws resting on top | App icon, splash screen, logo lockup |
| **Coding Stan** | Hunched at a laptop, terminal glow on his face | Loading states, "working…" UI moments |
| **Curious Stan** | Sitting inside a cardboard box labelled `>_` | Empty states, onboarding |
| **Caffeine Stan** | Holding a mug labelled `CODE FUEL` | Long-running operations, after midnight sessions |
| **Bug Hunter Stan** | Magnifying glass, focused stare | Error states, `stderr` output, test failures |

### Mascot rules
- Always black fur; never gray, brown, or coloured
- Eyes: yellow-green with large round pupils and a subtle glow
- Terminal block prop uses the brand purple gradient (`#7C5CFF` → `#B18CFF`)
- Never show Stan looking sad or defeated — curious and determined at worst
- Stan does not wear clothes; no hats, no outfits
- Minimum icon size where Stan is recognisable: **72 × 72 px**

---

## Logo system

### Wordmark
- **"Stan"** — Inter, weight 700, `#FFFFFF`
- **"CLI"** — Inter, weight 700, gradient `#7C5CFF` → `#B18CFF` (left → right)
- Letter-spacing: 0 (tight, modern)

### Lockup variants

| Variant | Composition | Use case |
|---------|------------|----------|
| **Horizontal** | Stan icon (48 px) + wordmark | README header, navigation bar |
| **Compact** | Stan icon (32 px) + wordmark | Tab bar, small headers |
| **Icon-only** | Stan icon, no text | App icon, favicon, social avatar |
| **Stacked** | Stan icon above wordmark, centred | Splash screen, loading screen |

### Clear space
Minimum clear space = 1× the cap-height of "CLI" on all sides.

### Don'ts
- Do not recolour the wordmark
- Do not place the logo on light backgrounds (it is a dark-first brand)
- Do not stretch or skew Stan
- Do not add drop shadows to the logo text (Stan himself may have ambient glow)

---

## Colour palette

### Primary

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#0D0D12` | Page / app background |
| `--color-surface` | `#1A1330` | Cards, panels, modals |
| `--color-surface-raised` | `#1e1a35` | Hover states, inputs |
| `--color-accent` | `#7C5CFF` | Primary CTA, active states, cursor |
| `--color-accent-soft` | `#B18CFF` | Secondary labels, "CLI" wordmark end |

### Semantic / status

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#33E88D` | Success messages, `✓` checkmarks, `stdout` highlights |
| `--color-info` | `#41D7FF` | Info banners, link text |
| `--color-warn` | `#FFB020` | Warnings, unstable states |
| `--color-muted` | `#2A2F3A` | Disabled, placeholder, borders |

### Text

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text` | `#E8EAF0` | Body copy |
| `--color-text-dim` | `#6B7B8D` | Captions, metadata, placeholders |
| `--color-danger` | `#FF4455` | Errors, delete actions |

### Gradients

```css
/* Accent gradient — used on "CLI" wordmark, borders, glows */
--gradient-accent: linear-gradient(135deg, #7C5CFF, #B18CFF);

/* Surface gradient — panel backgrounds */
--gradient-surface: linear-gradient(180deg, #1A1330 0%, #0D0D12 100%);
```

---

## Typography

### Typefaces

| Role | Family | Weight | Usage |
|------|--------|--------|-------|
| UI / brand | **Inter** | 300, 400, 600, 700 | All UI chrome, labels, buttons |
| Monospace | **JetBrains Mono** | 400 | Terminal, code blocks, file paths, metadata |

### Scale

| Name | Size | Weight | Line-height | Usage |
|------|------|--------|-------------|-------|
| `display` | 28 px | 700 | 1.1 | App logo, splash |
| `heading` | 18 px | 600 | 1.3 | Panel titles |
| `body` | 14 px | 400 | 1.55 | Chat bubbles, file names |
| `caption` | 11 px | 400 | 1.4 | Metadata, size, timestamps |
| `mono` | 13 px | 400 | 1.5 | Code, terminal, file paths |

---

## Iconography

### Tab bar icons (emoji stand-ins, production should use SVG)

| Tab | Icon | Notes |
|-----|------|-------|
| Terminal | `⌨` or custom `>_` glyph | Can be the Stan mini-icon |
| Files | `◫` folder glyph | |
| AI | `◈` or Stan-face silhouette | |

### In-product icon style
- Stroke weight: 1.5 px
- Corner radius: 2 px on paths
- Size grid: 16 / 20 / 24 px
- Colour: always inherit from `--color-text-dim`; active = `--color-accent`

---

## ASCII mascot

Used in terminal splash screens and CLI output.

```
  /\_/\
 ( o.o )
  > ^ <
```

Styled output (ANSI):
- Cat lines: dim white
- Status text after: `\e[35m` (purple) for "Stan" + white for the rest
- Checklist items: `\e[32m✓\e[0m` (green tick)

### Splash sequence
```
  /\_/\
 ( o.o )   Stan is preparing your workspace...
  > ^ <

  > Setting up project         ✓
  > Installing dependencies    ✓
  > Configuring tools          ✓
  > Making it awesome         ...
```

---

## Voice & tone

| Context | Tone | Example |
|---------|------|---------|
| Success | Warm, brief | `✓ Deployed in 2.3s` |
| Error | Direct, no blame | `Connection lost. Reconnecting…` |
| Empty state | Curious | `Nothing here yet. Stan is waiting.` |
| Loading | Active | `Stan is thinking…` |
| Onboarding | Friendly, efficient | `Enter your token once. Stan remembers.` |

### Don'ts
- No exclamation marks on errors
- No "Oops!" or "Uh oh!" — Stan is a professional
- No passive voice in status messages
- Don't anthropomorphise bugs ("sneaky bug") — Stan hunts them, he doesn't befriend them

---

## Motion & feel

- **Transitions:** 150 ms ease-out for state changes (tab switch, panel slide)
- **Reconnect pill:** fade-in 200 ms, no bounce
- **Sticky key activation:** instant colour fill, no animation needed
- **Loading / streaming:** pulsing opacity on the cursor (0.4 → 1.0, 800 ms loop)
- **Stan's eyes:** if animated anywhere, a single slow blink — 300 ms close, 200 ms open, every 4–6 s

---

## Sticker pack

| Sticker | Visual | Copy |
|---------|--------|------|
| **Ship It** | Stan pumping paw, green terminal | `>_ SHIP IT` |
| **Good Commit** | Stan with sparkles | `GOOD COMMIT` |
| **Works on my Machine** | Stan shrugging, smug | `WORKS on my MACHINE` |
| **Sleep Mode** | Stan curled up, `zzz` | `>_` |

---

## Asset checklist

### Required (blocking launch)
- [ ] `icon-512.png` — Stan Default, no text, transparent bg → `#1A1330` bg
- [ ] `icon-192.png` — same, 192 px
- [ ] `icon-128.png` — 128 px
- [ ] `icon-72.png` — 72 px (iOS spotlight)
- [ ] `favicon.svg` — vector Stan face, monochrome works
- [ ] `og-image.png` — 1200 × 630, GitHub/README banner (Stan + "Stan CLI" wordmark on dark bg)

### Nice to have
- [ ] SVG logo lockup (horizontal + compact)
- [ ] Sticker pack PNGs (4 × 1024 px)
- [ ] Mascot poses (5 × PNG, transparent bg)

---

## Usage by surface

| Surface | Logo variant | Background | Accent |
|---------|-------------|------------|--------|
| iOS home screen icon | Icon-only | `#1A1330` | `#7C5CFF` glow |
| Auth / token screen | Stacked | `#0D0D12` | `#7C5CFF` |
| Tab bar | No logo; tab icons only | `#1A1330` | `#7C5CFF` active |
| Terminal tab | No logo | `#000000` | `#7C5CFF` cursor |
| README / GitHub | Horizontal lockup on banner | `#0D0D12` | — |
