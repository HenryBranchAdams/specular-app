# Subtle Mystery Refinement

**Status:** Active design direction on 2026-07-10
**Mobile reference:** `assets/specular-subtle-mystery-mobile.png`
**Desktop reference:** `assets/specular-subtle-mystery-desktop.png`
**Thread reference:** `assets/specular-subtle-mystery-thread-mobile.png`
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
- **Motion:** no looping starter drift and no simulated thinking. Hover and focus may
  shift a row by two pixels; reduced motion removes that shift.

## Layout

Mobile uses 16–20px safe gutters. The datum sits just inside the working column; the
copy begins roughly 40px to its right. `Something unfinished.` occupies the lower part
of the open field, followed by three indexed 44px-or-larger starter rows. The composer
remains visible within 375 × 812 and 320 × 700 first viewports.

Desktop expands only the empty starter workspace to an approximately 37.5rem working
column. It does not become a landing page, dashboard, sidebar layout, or feature grid.
Conversation and artifact states retain their focused reading measure.

## Active inquiry

The starter's datum continues into the thread. User thoughts and Specular questions are
open typography, never chat bubbles. The user's line remains present rather than being
demoted to a faint outgoing bubble; the current question is stronger but uses regular,
human-scale type rather than an answer-like display treatment.

The inquiry plane is borderless. The composer and secondary actions are separated by
mineral hairlines, with no glowing card or rainbow frame. `Challenge this` and
`Draft a working conclusion` remain available as quiet secondary controls.

## Asset treatment

`public/specular-afterimage.webp` is a production background asset generated from the
accepted concept's palette. It contains no text or UI and must remain optional
atmosphere: all content and contrast work without it. Low-power, forced-colors, and
state-specific fallbacks may hide or replace it.

## Product and accessibility invariants

- Every starter only focuses the composer; it never selects a hidden mode or strategy.
- Text and controls remain code-native and keyboard accessible.
- Interactive targets remain at least 44 × 44 CSS pixels.
- Visible focus, increased contrast, forced colors, safe areas, 200% text scaling, and
  zero horizontal overflow remain release gates.
- The existing local-first thread, Challenge, conclusion, Capsule, voice, and privacy
  contracts do not change.

## Superseded starter details

This direction supersedes the previous starter's eight-item capability list, dominant
serif question, rainbow conic edge, ambient prompt drift, large rounded plane, and
glowing send treatment. It does not supersede the active-thread, recovery, conclusion,
or Capsule behavior specified elsewhere.
