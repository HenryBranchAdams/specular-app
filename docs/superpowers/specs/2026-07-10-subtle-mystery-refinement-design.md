# Subtle Mystery Refinement

**Status:** Active design direction on 2026-07-11
**Mobile reference:** `assets/specular-subtle-mystery-mobile.png` (palette and datum)
**Desktop reference:** `assets/specular-subtle-mystery-desktop.png` (palette and measure)
**Thread reference:** `assets/specular-subtle-mystery-thread-mobile.png` (open typography)
**Scope:** Fresh starter, active inquiry, ambient treatment, composer, and thread actions

## Intent

Specular is not an oracle and does not perform intelligence on the user's behalf. It
uses the model to return one useful question so the user can think more clearly for
themselves. The interface should express that inversion through behavior and omission,
not through a claim about AI, intelligence, clarity, or self-improvement.

The user's unfinished thought is the primary object. Specular remains a quiet instrument
around it.

## Copy lock

- `Specular`
- `Capsules`
- `Something unfinished.`
- `A decision still open`
- `An untested assumption`
- `Notes that don’t yet agree`
- `Write it as it stands…`
- `Test this`
- `Gather this thread`

There is no explanatory subtitle. The first model response proves the product thesis by
asking one precise question instead of supplying an answer.

## Visual system

- **Background:** matte graphite blue-black (`#080a0e`) with a low-contrast generated
  afterimage texture. The spectral idea is discovered at the extreme edge rather than
  announced across the screen.
- **Text:** mineral bone (`#eeeae4`) with gray secondary copy. Starter typography uses
  the existing humanist system sans; no ceremonial display serif.
- **Datum:** one one-pixel vertical rule with a nearly imperceptible mineral-to-spectral
  shift near its lower edge.
- **Containers:** the starter is borderless and open. The composer is part of the same
  datum system, separated by one horizontal hairline rather than a rounded glass card.
- **Controls:** Lucide icons remain code-native. Send is neutral, unglowing, and only
  gains contrast when enabled.
- **Motion:** no looping starter drift, simulated thinking, or ambient movement in the
  starter cues.

## Layout

Mobile uses 16–20px safe gutters. The datum sits just inside the working column; the
copy begins roughly 40px to its right. `Something unfinished.` occupies the lower part
of the open field. The composer follows immediately, so writing is the first available
interaction. Three unnumbered, non-interactive fragments sit beneath it with slight
asymmetry; they suggest unfinished material without presenting categories or modes.
The entire composition remains visible within 375 × 812 and 320 × 700 first viewports.

Desktop expands only the empty starter workspace to an approximately 37.5rem working
column. It does not become a landing page, dashboard, sidebar layout, or feature grid.
Conversation and artifact states retain their focused reading measure.

## Active inquiry

The starter's datum continues into the thread. User thoughts and Specular questions are
open typography, never chat bubbles. The latest user line is the strongest text in the
thread. The current Specular question is smaller, quieter, and slightly inset: clear
enough to use, but visually subordinate to the user's words.

The inquiry plane is borderless. The composer and secondary actions are separated by
mineral hairlines, with no glowing card or rainbow frame. `Test this` asks one sharper
question. `Gather this thread` appears only after two accepted user turns and organizes
distinct exact excerpts from those turns. It cannot paraphrase, synthesize, recommend,
or introduce a position; the user may edit the gathered working position afterward.

## Asset treatment

`public/specular-afterimage.webp` is a production background asset generated from the
accepted concept's palette. It contains no text or UI and must remain optional
atmosphere: all content and contrast work without it. Low-power, forced-colors, and
state-specific fallbacks may hide or replace it.

## Product and accessibility invariants

- Starter fragments are static text, not controls, categories, or hidden strategies.
- Text and controls remain code-native and keyboard accessible.
- Interactive targets remain at least 44 × 44 CSS pixels.
- Visible focus, increased contrast, forced colors, safe areas, 200% text scaling, and
  zero horizontal overflow remain release gates.
- Local-first thread, Capsule, voice, export, edit, and privacy contracts remain intact.
- Ordinary model turns and tests return exactly one question. Gathering is opt-in,
  delayed, and extractive-only; provenance must resolve to accepted user turns.

## Superseded starter details

This direction excludes capability lists, numbered starter taxonomies, dominant model
responses, serif manifestos, rainbow conic edges, ambient prompt drift, large rounded
planes, glowing send treatments, and model-authored working conclusions. Internal
storage shapes remain backward-compatible for existing local threads and Capsules.
