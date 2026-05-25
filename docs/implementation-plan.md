# Stan CLI — Brand Implementation Plan

## Status key
- ✅ Done
- 🔄 In progress / partial
- ⬜ Not started
- 🎨 Needs designer asset

---

## Phase 1 — Token foundation ✅

All colour, typography, and spacing values live in `public/brand/tokens.css`.
No hex values are hardcoded in component CSS.

| Task | File | Status |
|------|------|--------|
| Design token file | `public/brand/tokens.css` | ✅ |
| Update `styles.css` to use tokens | `public/styles.css` | ✅ |
| Inter + JetBrains Mono via Google Fonts | `public/index.html` | ✅ |

---

## Phase 2 — Logo & icon assets

### SVG assets (vector, no artwork needed)
| Asset | File | Status |
|-------|------|--------|
| Full logo lockup (horizontal) | `public/brand/logo.svg` | ✅ |
| Compact logo lockup | `public/brand/logo-compact.svg` | ✅ |
| Icon placeholder (geometric cat) | `public/brand/icon.svg` | ✅ |
| OG banner (README/social) | `public/brand/og-banner.svg` | ✅ |

### PNG icons — need real Stan artwork
| Asset | File | Size | Status |
|-------|------|------|--------|
| App icon | `public/icons/icon-512.png` | 512×512 | 🎨 |
| iOS touch icon | `public/icons/icon-192.png` | 192×192 | 🎨 |
| Spotlight icon | `public/icons/icon-128.png` | 128×128 | 🎨 |
| Favicon / small | `public/icons/icon-72.png` | 72×72 | 🎨 |
| OG image | `public/icons/og-image.png` | 1200×630 | 🎨 |

**Icon spec for designer / AI generation:**
- Stan (black kitten) peeking over a terminal block with `>_` prompt
- Background: `#1A1330` (no transparency needed for PNG icons)
- Terminal block border: gradient `#7C5CFF → #B18CFF`
- No text/wordmark on the icon itself
- Rounded corners applied by the OS; supply a square image

---

## Phase 3 — In-app brand application

### Auth screen
| Task | Status |
|------|--------|
| "Stan CLI" wordmark with gradient "CLI" | ✅ |
| ASCII Stan in token entry screen | ⬜ |
| Tagline "Your terminal companion." | ⬜ |

**To do — `public/index.html`:**
Add below `.auth-logo`:
```html
<pre class="auth-ascii">  /\_/\
 ( o.o )
  &gt; ^ &lt;</pre>
<p class="auth-tagline">Your terminal companion.</p>
```

Add to `public/styles.css`:
```css
.auth-ascii {
  font: var(--text-mono); color: var(--color-text-dim);
  text-align: center; line-height: 1.4; user-select: none;
}
.auth-tagline {
  font: var(--text-caption); color: var(--color-text-dim);
  letter-spacing: 0.05em;
}
```

### Terminal tab
| Task | Status |
|------|--------|
| Purple cursor (`#7C5CFF`) | ✅ |
| Purple selection highlight | ✅ |
| Reconnect pill uses `--color-accent-soft` | ✅ |
| Success-coloured stdout (optional, complex) | ⬜ |

### Tab bar
| Task | Status |
|------|--------|
| Active tab: `--color-accent` | ✅ |
| Replace emoji icons with SVG glyphs | ⬜ |

**SVG tab icons to build:**
```
Terminal: >_ monospace glyph in 24×24 box
Files:    folder outline, 1.5px stroke
AI:       sparkle/star or Stan face silhouette
```

### Files tab
| Task | Status |
|------|--------|
| Token-based colours | ✅ |
| Context menu uses brand surface/raised | ✅ |
| Empty state with Curious Stan art | 🎨 |

### AI tab
| Task | Status |
|------|--------|
| Token-based colours | ✅ |
| User bubble: `--color-surface` / accent border | ⬜ (currently hardcoded #0a2030) |
| Code block "→ Term" button: accent colour | ✅ |
| "Stan is thinking…" loading state | ⬜ |

**To do — `public/ai.js` AI bubble user style:**
Replace `background: #0a2030; border: 1px solid #0e3d55` with:
```css
background: var(--color-surface-raised); border: var(--border-accent);
```

---

## Phase 4 — PWA completeness

| Task | File | Status |
|------|------|--------|
| `manifest.webmanifest` — name, theme, bg | `public/manifest.webmanifest` | ✅ |
| Service worker cache version bumped | `public/sw.js` | ✅ |
| `apple-touch-icon` points to real Stan art | `public/index.html` | 🎨 |
| `favicon.ico` / `favicon.svg` | `public/favicon.svg` | ⬜ |
| `og:image` meta tag | `public/index.html` | ⬜ |

**To do — add to `<head>` in `index.html`:**
```html
<link rel="icon" type="image/svg+xml" href="brand/icon.svg">
<meta property="og:title" content="Stan CLI">
<meta property="og:description" content="Your terminal companion.">
<meta property="og:image" content="icons/og-image.png">
<meta property="og:type" content="website">
```

---

## Phase 5 — README & GitHub

| Task | Status |
|------|--------|
| README.md with OG banner at top | ⬜ |
| `og-banner.svg` → export as `og-image.png` | 🎨 |
| Repo description: "Your terminal companion." | ⬜ |
| Social preview image set in repo settings | ⬜ |

---

## Asset delivery path

When designer / AI delivers PNG artwork:

```
Provided PNG → drop here
├── public/icons/icon-512.png    ← primary
├── public/icons/icon-192.png
├── public/icons/icon-128.png
├── public/icons/icon-72.png
└── public/icons/og-image.png    ← 1200×630 banner
```

Then run:
```bash
pm2 restart stan-cli
# On iPhone: Settings → Safari → Advanced → Website Data → delete kay2.tail69c58c.ts.net
# Or: hard reload in Safari (hold reload button)
```

Service worker will pick up new icons on next visit because `CACHE_VERSION` was already bumped to `stan-cli-v1`.

---

## Quick wins — do these now (no artwork needed)

1. **Favicon** — link `brand/icon.svg` as SVG favicon (works in most modern browsers)
2. **OG meta tags** — 4 lines in `<head>`, improves link previews
3. **Auth screen ASCII** — adds personality with zero images
4. **AI bubble hardcoded colours** — replace 2 hex values with tokens
5. **"Stan is thinking…" state** — 5 lines in `ai.js`
