# Stan Mascot Brand Brief

## Project

Repository: `kay2stack/KAY2Tunnel`

Working product names:

- **KAY2Tunnel** — the serious underlying tunnel/dev tool
- **Stan CLI** — the friendly developer-facing CLI mascot and brand layer

Stan CLI is inspired by tools like Lunel CLI, but should become its own distinct developer companion: lightweight, memorable, cute, useful, and mascot-driven.

Stan is based on Kane’s late kitten: a small black fluffy kitten called **Stan**. The mascot should feel respectful, warm, and personal without becoming sad or overly sentimental. Stan should feel like a tiny terminal companion that helps developers ship faster.

---

## Core idea

Stan is not just a logo. Stan should be part of the product experience.

When users run the CLI, Stan should appear as a small friendly companion in terminal output, onboarding screens, docs, banners, and the PWA app icon.

Think:

```bash
$ stan init

 /\_/\
( o.o )  Stan is preparing your workspace...
 > ^ <

✓ Project detected
✓ Tunnel config created
✓ Ready to ship
```

The feel should be:

- premium developer tool
- cute but not childish
- dark terminal aesthetic
- fluffy black kitten mascot
- clean, modern, slightly cyberpunk
- friendly CLI companion
- memorable GitHub/readme identity

---

## Mascot description

Stan should be a small black fluffy kitten with:

- soft black fur
- round curious eyes
- cute but focused expression
- slightly cheeky terminal-helper energy
- clear silhouette at small icon sizes
- paws interacting with a terminal prompt
- optional purple/cyan glow around the edges
- optional command prompt panel in front of him

Avoid making Stan look scary, angry, evil, or too realistic. He should be adorable, intelligent, and a little mischievous.

Stan should look like he belongs inside a developer tool, not a random pet brand.

---

## PWA logo direction

Create a PWA icon version first.

Requirements:

- square icon
- works at 512x512, 192x192, 128x128, and 72x72
- no text in the main app icon
- dark rounded-square background
- Stan’s face and paws should fill most of the canvas
- terminal prompt symbol should be visible: `>_`
- strong contrast so it remains readable on iPhone home screen
- premium, polished, modern

Suggested composition:

A fluffy black kitten peeking over a small terminal panel with a glowing `>_` prompt. The terminal panel sits near the bottom. Stan’s ears and eyes dominate the upper area. Background is matte black/deep charcoal with subtle purple glow.

---

## Logo lockup direction

Create separate logo lockups for README, GitHub, website, and PWA splash screens.

Versions needed:

1. App icon — no text
2. Horizontal logo — Stan icon + `Stan CLI`
3. Compact logo — small Stan terminal badge + `Stan CLI`
4. GitHub/README banner — wide hero image
5. CLI splash ASCII art
6. Sticker-style mascot variations

Text style:

- `Stan` in white or soft off-white
- `CLI` in purple/lilac gradient or accent colour
- bold, clean developer-tool typography
- avoid gimmicky cartoon fonts

---

## Brand colours

Preferred palette:

```txt
#0D0D12  near-black background
#1A1330  deep purple shadow
#7C5CFF  electric purple
#B18CFF  soft lilac glow
#33EE8D  terminal success green
#41D7FF  cyan accent
#FFB020  warning amber
#2A2F3A  muted border grey
```

Primary feel: dark, premium, terminal-native, modern AI/dev tooling.

Avoid generic hacker green-only branding. Stan should feel fresher and more characterful than a basic terminal app.

---

## Personality directions

Stan should have a few visual moods:

### 1. Coding Stan

Stan using a tiny laptop or terminal. Calm, focused, helpful.

### 2. Curious Stan

Stan peeking out of a box, folder, or terminal window. Used for onboarding and docs.

### 3. Bug Hunter Stan

Stan chasing a small bug icon or looking at an error message. Used for debug states.

### 4. Sleepy Stan

Stan asleep on the terminal. Used for idle/stopped tunnel states.

### 5. Deploy Stan

Stan proudly sitting beside a successful build/tunnel output. Used for success states.

---

## CLI personality

Stan should appear in terminal text without becoming annoying.

Example command output:

```bash
$ stan tunnel 3000

 /\_/\
( o.o )  Stan is opening the tunnel...
 > ^ <

Local:  http://localhost:3000
Public: https://quiet-fluffy-stan.kay2tunnel.dev
Status: live
```

Example microcopy:

```txt
Stan is preparing your workspace...
Stan found your project.
Stan opened a tunnel.
Stan is watching your port.
Stan curled up. Tunnel stopped.
Stan found a problem. Tiny paws, big warning.
```

Tone:

- friendly
- short
- useful
- slightly funny
- never too childish
- never too verbose

---

## Brand taglines

Potential lines:

```txt
Your tiny terminal companion.
Ship faster. Stay in flow.
Stan handles the tunnel.
A tiny companion for your greatest ideas.
Local apps, public links, zero drama.
Open tunnels without opening chaos.
```

Favourite direction:

```txt
Stan CLI — your tiny terminal companion.
```

---

## README banner concept

Wide GitHub/README banner idea:

Dark terminal window frame. Left side says:

```txt
Stan CLI
Ship faster.
Write less.
Stay in flow.
```

Below:

```bash
$ stan deploy
✓ Deployed in 2.3s
```

Right side shows Stan sitting beside or behind a laptop/terminal panel, glowing softly with purple edge lighting.

---

## Sticker pack ideas

Create future sticker-style assets for community/dev culture:

- Stan holding a terminal panel saying `SHIP IT`
- Stan with `GOOD COMMIT`
- Stan holding a sign saying `WORKS ON MY MACHINE`
- Stan sleeping on a `>_` terminal
- Stan chasing a tiny bug icon
- Stan wrapped in a cable like yarn

Sticker style should be high-contrast, dark, outlined, readable at small sizes, and suitable for GitHub README badges, Telegram stickers, Discord emojis, or social posts.

---

## Implementation notes for Claude

Claude should create brand assets and/or prompts that can be used by image generation tools and front-end builders.

Please create:

1. A polished `README.md` section introducing Stan CLI and KAY2Tunnel.
2. A `/public/brand/` asset plan listing all needed exported images.
3. A `/docs/brand.md` file containing final brand rules.
4. A `/docs/stan-cli-personality.md` file containing terminal copy, ASCII art, and output examples.
5. A simple PWA manifest icon plan for 512x512, 192x192, 128x128, and 72x72.
6. Optional React/Vite landing page concept using the mascot and dark terminal brand.

---

## Image generation prompt for main PWA icon

Use this prompt as the base:

```txt
Square PWA app icon for a developer CLI tool called Stan CLI. No text. A small fluffy black kitten mascot peeking over a dark terminal prompt panel with a glowing `>_` symbol. Big round curious eyes, soft black fur, cute paws gripping the terminal edge. Dark matte rounded-square background, deep charcoal and near-black tones, subtle electric purple and soft lilac glow around the kitten silhouette. Premium modern developer-tool aesthetic, clean high contrast, readable at tiny app icon sizes, iOS PWA home screen ready, polished 3D mascot illustration, not childish, not scary, no extra text, no watermark.
```

---

## Image generation prompt for horizontal logo

```txt
Horizontal logo lockup for Stan CLI, a premium developer CLI tool. Left side: small fluffy black kitten mascot peeking over a terminal panel with glowing `>_` prompt. Right side: clean bold text `Stan CLI`, with Stan in white and CLI in soft purple/lilac. Dark transparent or near-black background. Modern AI developer tooling aesthetic, polished, GitHub README ready, high contrast, professional but cute, no clutter.
```

---

## Image generation prompt for GitHub banner

```txt
Wide GitHub README banner for Stan CLI, a friendly developer terminal companion. Dark terminal-window hero scene, matte black and deep purple background. A cute fluffy black kitten mascot called Stan sits beside a laptop/terminal, paws near the keyboard, glowing purple edge light. Large clean text reads `Stan CLI`. Smaller tagline: `Your tiny terminal companion.` Include a subtle command example: `$ stan tunnel 3000` and `✓ Tunnel live`. Premium developer tool branding, modern, polished, not childish, cinematic but clean, high contrast.
```

---

## Final product feel

Stan CLI should feel like a dev tool people remember, not just another utility.

KAY2Tunnel can be the serious engine underneath. Stan is the character layer that makes the tool lovable.

The aim is a mascot-driven CLI brand that developers would actually enjoy installing, starring, and sharing.
