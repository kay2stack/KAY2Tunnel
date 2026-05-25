# Stan CLI — Mobile AI Architecture Brief

## Purpose

This file is a direct implementation brief for Claude Code / Codex.

Stan CLI is NOT a normal AI chatbot.

Stan CLI is a **mobile‑first AI developer workstation** inspired by Lunel CLI.

The AI section should provide **direct access to real coding agents and CLIs** such as:

- Claude Code CLI
- Codex CLI
- Gemini CLI
- OpenCode / OpenHands
- local agents
- OpenClaw / Clive integration (future)

Stan is not the model itself.

Stan is the orchestration layer and friendly CLI personality sitting on top of multiple AI coding agents.

---

## Product Vision

Think:

**Lunel CLI × Raycast × Warp × iOS developer control centre**

Primary target:

Mobile‑first.

Built for:

- iPhone
- iOS PWA
- one‑handed use
- remote dev workflows
- developers controlling AI agents away from desktop
- monitoring live coding sessions from mobile

The UI should feel premium, clean, and modern.

Not hacker‑edgy black everywhere.

Avoid heavy pure‑black terminal aesthetics.

Preferred feel:

- soft graphite backgrounds
- deep purple accents
- subtle blur / glass
- dark terminal panels only where useful
- Apple‑style spacing
- clean typography
- premium developer tooling aesthetic

---

## Navigation Structure

Replace generic "AI" tab concept.

Recommended structure:

```txt
Terminal | Projects | Agents
```

or

```txt
Home | Terminal | Stan
```

Final implementation choice can evolve.

---

## Terminal Screen

Purpose:

Direct CLI interaction.

Real terminal access.

Not fake UI.

Should support:

- live output streaming
- command execution
- session persistence
- command history
- long‑running processes
- coloured terminal output
- reconnect handling
- mobile keyboard optimisation

Example:

```bash
$ claude
$ codex
$ stan tunnel 3000
$ npm run dev
```

UI concept:

Top area:

- connection indicator
- active session name
- running status

Main body:

live terminal output.

Bottom:

command input.

Optional:

floating quick actions.

---

## Agents Screen

This replaces traditional AI chat.

Purpose:

Control and launch AI coding agents.

Not chat bubbles.

Display connected agents as cards.

Example:

```txt
Claude Code      ● Connected
Codex            ● Ready
Gemini CLI       ○ Offline
OpenClaw         ● Running
```

Each card can show:

- status
- runtime
- provider
- active repo
- token/model state

Actions:

- launch session
- resume session
- stop agent
- open logs
- settings

---

## Session Screen

Critical feature.

This is where Claude Code / Codex sessions live.

Not a standard chatbot interface.

Think:

mobile coding control panel.

Example:

```txt
Claude Code
Repository: KAY2Tunnel
Directory: ~/projects/KAY2Tunnel
Mode: Agent
```

Live stream example:

```txt
Thinking...
Reading files...
Editing src/components/Nav.tsx
Running tests...
✓ Completed
```

Required controls:

- approve
- reject
- stop
- retry
- diff preview
- undo changes
- copy output
- reopen terminal

Should support long reasoning / task monitoring.

---

## Projects Screen

Developers work in repositories.

Expose projects directly.

Example:

```txt
KAY2Tunnel
CliveDEX
FlipperForge
Stan CLI
```

Selecting project should allow:

```txt
Open with Claude Code
Open with Codex
Open with Gemini CLI
```

Optional metadata:

- git branch
- status
- last edit time
- local path
- deployment state

---

## Stan Orchestration Layer

Important architectural rule.

Stan ≠ AI model.

Stan = orchestration + UX layer.

Stan routes requests.

Example:

User request:

```txt
Fix iOS keyboard overlap issue.
```

Stan response:

```txt
Using Claude Code...
Scanning repository...
Found 3 candidate files.
Ready to execute.
```

This creates a consistent user experience across multiple AI providers.

Stan should feel like:

"your tiny terminal companion"

not another generic assistant.

---

## Dashboard Concept

Optional but recommended.

Instead of opening into blank terminal.

Open into useful status dashboard.

Example:

```txt
Good morning Kane.

2 agents running
1 deployment warning
Pi gateway online
Last sync: 2m ago
```

Stan status/mood indicators can appear here.

---

## Design Direction

Strong recommendation:

Move away from current heavy dark look.

Use lighter premium styling.

Balance:

80% clean iOS productivity app
20% terminal aesthetic

Reference inspirations:

- Lunel CLI
- Raycast
- Warp terminal
- Linear
- Cursor
- Apple system apps

Avoid:

- overcrowded cyberpunk UI
- full pure black everywhere
- fake hacker styling
- oversized neon effects

---

## Claude Code Implementation Tasks

Please review existing repo and implement:

1. updated mobile IA/navigation
2. revised UI direction
3. terminal screen redesign
4. agents screen replacing old AI tab
5. session screen concepts
6. project management view
7. Stan orchestration UX layer
8. component structure proposal
9. architecture notes for CLI integration
10. mobile‑first responsive implementation plan

If coding begins:

Prefer:

- React
- TypeScript
- Tailwind
- mobile‑first layout
- clean component separation
- reusable card system
- modern animation restraint

---

## Final Goal

Build a mobile‑first AI developer workstation.

Not just another AI chat wrapper.

Users should be able to:

- control Claude Code from mobile
- monitor Codex tasks
- run CLI commands
- switch projects
- review outputs
- approve actions
- stay productive away from desktop

Stan CLI should feel like carrying a tiny AI engineering workstation in your pocket.
