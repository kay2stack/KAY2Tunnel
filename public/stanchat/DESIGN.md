# DESIGN.md — StanAI Chat

> The premium-AI-chat design system for **Stan Chat** — Claude Code as a
> conversation, running on the kay2 Pi. This is a *focused composite*: it takes
> the calm editorial bones of the kay2OS house style (`/DESIGN.md`, Apple News)
> and fuses the message-craft of the best AI chat products into one spec built
> to out-feel all of them.
>
> **Goal:** StanAI is the face of the future. The conversation should feel
> faster, calmer, and more legible than Claude.ai, ChatGPT, Gemini or any
> competitor — not by adding chrome, but by removing it and perfecting the
> reading experience.

---

## 0. What we steal, and how we beat it

| Competitor | What they do well | How StanAI goes further |
|---|---|---|
| **Claude.ai** | Warm, full-width turns; superb reading typography | Same calm column, but with a live **tool timeline** competitors hide — Stan *runs* on a real machine, so show the work proudly |
| **ChatGPT** | Clear turn separation, code blocks, copy | Tighter type scale, language-labelled code, per-turn identity rail, zero visual noise |
| **Gemini** | Soft surfaces, gradient brand moment | One disciplined accent (`#FF3B5C`) instead of rainbow gradients — restraint reads as premium |
| **Linear / Raycast** | Precision, motion, density of meaning | Borrow the micro-interaction polish: spring easing, status rails, instant feedback |

**One-line philosophy:** *content is the product; the agent's work is the proof;
everything else gets out of the way.*

---

## 1. Theme & atmosphere

- **Light-first, dark-equal.** Conceived in light (paper calm), but dark mode is
  a first-class, near-black reading surface — not an inversion afterthought.
- **No bubbles for Stan.** The assistant speaks in a full-width editorial column
  with a small identity rail. Bubbles are reserved for the *user's* turns, so
  the eye instantly knows who is speaking without reading a word.
- **One accent, used like punctuation.** The brand red appears on the orb, the
  send action, links, and active states. Never as fill behind long text.
- **Depth from blur + hairlines, not shadow.** Translucent bars float over
  content; cards separate with a single hairline and air. Max shadow ~12%.
- **Motion is meaning.** Every state change (streaming, tool running, arriving
  message) animates with the house spring `cubic-bezier(0.16,1,0.3,1)`. Nothing
  pops in hard; nothing janks.

---

## 2. Color (inherits `/brand/tokens.css`)

| Role | Light | Dark | Token |
|---|---|---|---|
| Conversation canvas | `#F2F2F7` | `#000000` | `--bg` |
| Reading/elevated surface | `#FFFFFF` | `#1C1C1E` | `--bg-card` |
| Inset surface (tool input) | `#F2F2F7` | `#2C2C2E` | `--bg-secondary` |
| Console (tool output, code) | `#12101C` | `#12101C` | `--bg-console` |
| Primary text | `#000000` | `#FFFFFF` | `--text-primary` |
| Body / prose | `#3C3C43` | `#EBEBF5` | `--text-secondary` |
| Metadata, author rail | `#8E8E93` | `#8E8E93` | `--text-dim` |
| **Accent (StanAI red)** | `#FF3B5C` | `#FF4E6A` | `--accent` |
| Hairline | `#E5E5EA` | `#2C2C2E` | `--border` |
| Success / error | `#34C759` / `#FF3B30` | same | `--green` / `--red` |

**Rule:** functional colour only (running = accent, ok = green, error = red).
No decorative second hue, no neumorphism, no glow except the orb's soft halo.

---

## 3. Typography

Fonts: `--font-display` (SF Pro Display) for headings/author, `--font-ui`
(SF Pro Text) for prose, `--font-mono` (SF Mono) for code & tool surfaces.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `auth-display` | 34 / 40 | 800 | Login wordmark |
| `turn-author` | 12 / 14 | 700, +0.04em, UPPER | "STAN" rail label |
| `prose` | 15.5 / 1.62 | 400 | Assistant body — the hero text |
| `prose strong` | inherit | 700 | Emphasis |
| `md-h1/2/3` | 20/18/16 | 800/700/700, tight | In-message headings |
| `user-msg` | 15.5 / 1.5 | 450 | User bubble |
| `tool-name` | 13 / 16 | 700 | Tool card title |
| `mono / code` | 12.5 / 1.5 | 400 | Code blocks, tool output |
| `meta` | 11–12 | 500 | Chips, cost, timestamps |

**Rules:** prose never below 15px; line-height generous (1.6) — reading comfort
is the whole game. Headlines tight & heavy. Mono everywhere code or machine
output appears, never for chrome.

---

## 4. Signature components

### The turn (assistant)
Full-width, no card. A 28px **orb avatar** on a left rail; an UPPERCASE `STAN`
author label; then the prose. Rich markdown: headings, lists, blockquotes,
rules, links, inline code, and **language-labelled code blocks** with a copy
button. Streaming shows a blinking accent caret; arrival animates with a 6px
rise + fade.

### The turn (user)
Right-aligned bubble, `--accent` fill, white text, 20px radius with one tucked
corner (bottom-right 6px). Short by nature — colour is fine here and brands the
conversation. Max-width 85%.

### Tool timeline card — *the competitor-beating feature*
Stan actually executes. Each tool call is an inset card aligned to the prose
column:
- Coloured **badge** (per-tool glyph + hue), bold tool name, a mono one-line
  summary that truncates.
- A **status rail**: pulsing accent dot while running → green tick (done) /
  red dot (error), with an optional `0.4s` duration pill.
- Tap to expand: the **input** on an inset surface, the **output** in a dark
  console `pre`. Chevron rotates. Calm, scannable, never a wall of text.

### Thinking indicator
Orb + three sequenced dots + soft "thinking" label. Italic, dim, transient.

### System pill
Centred, small, pill-shaped, `--bg-secondary`. Warn → amber tint, error → red
tint. For connection/lifecycle notes only.

### Composer (floating)
A translucent blurred dock pinned to the bottom safe area. Above the input: a
meta row of **chips** (`dir`, `mode`) + a right-aligned cost readout. The input
is a rounded pill that auto-grows to 140px; focus lifts a subtle accent ring.
The send button is a circular accent control with press-scale feedback and a
disabled state. `/auto` in the box launches an autopilot session.

### Empty state
A large floating orb (gentle 4s bob + soft red halo), a heavy welcome title, a
calm subtitle, a gradient **⚡ Quick auto session** CTA, a one-line `/auto`
hint, and a wrap of suggestion chips.

### Jump-to-latest
When scrolled up past ~280px, a small floating pill (↓) fades in bottom-right;
tap returns to live. Hidden at the bottom.

### Sessions drawer
Bottom sheet, rounded top, blurred scrim. Session rows: orb icon, name + dir,
mono meta line (mode · status · age), delete. The new-chat view uses
section-labelled pill grids (Project / Model / Permissions) + a mode note + CTA.

---

## 5. Spacing, layout, motion

- **8pt scale:** `4 · 8 · 12 · 16 · 20 · 24 · 32`.
- **Reading column:** thread content centres at `max-width: 740px` on wide
  screens, full-bleed with 14–16px gutters on phone.
- **Turn rhythm:** 22px between turns; 6px between an author label and its prose.
- **Touch targets:** ≥ 44px for every control; chips keep a 44px hit area.
- **Safe areas:** topbar pads the notch, composer pads the home indicator.
- **Motion tokens:** `--dur-fast 120ms / normal 200ms / slow 320ms`, all on the
  house spring `--ease`. Streaming caret blinks 1s; running dots pulse 1.1s.
- **Skeletons over spinners** anywhere we wait on the feed.

---

## 6. Do / Don't

**Do** ✅ keep Stan's prose full-width and bubble-free · show the tool timeline
proudly · reserve red for accents · lean on whitespace + hairlines · animate
every state change with the spring · label code blocks · keep both themes
first-class.

**Don't** ❌ put long text inside a coloured bubble · add a second accent or
decorative gradient (beyond the orb/CTA) · use heavy shadows or glows · crowd
turns below 16px · use spinners in the feed · let prose drop below 15px or
targets below 44px · make dark mode a flat invert — give it a true near-black
canvas with elevated surfaces.
