# Quiet Spectral Refinement — Design QA

## Source reference

- Accepted concept: `docs/superpowers/specs/assets/specular-quiet-spectral-reference.png`
- Direction: Row A, Quiet Spectral Refinement
- Historical evidence note: the committed captures predate the later neutral product-language pass. Current visible copy is governed by the production specification and component tests; these images remain evidence for hierarchy, density, and spectral treatment rather than exact text.
- Implementation captures:
  - `docs/superpowers/specs/assets/design-qa/starter.png`
  - `docs/superpowers/specs/assets/design-qa/inline-retry.png`
  - `docs/superpowers/specs/assets/design-qa/capsule-empty.png`

## Viewport and state

- Browser render: 1280 × 800 desktop viewport with the production 430px work surface centered.
- Starter: fresh local origin, no active thread.
- Retry: failed first user turn against the unavailable local provider.
- Capsules: empty capsule library with an active local thread.

## Comparison

| State | Reference match | Intentional implementation choice |
| --- | --- | --- |
| Starter | Open near-black field, serif dominant prompt, subdued secondary prompts, compact composer | Existing eight rotating prompts remain available; hierarchy concentrates attention on the first three. |
| Failed turn | `Not sent` and `Retry` are attached directly to the failed thought | Existing transcript plane and thread actions remain intact. |
| Empty capsules | Centered database glyph, clear empty copy, isolated Export action | Close remains visible beside overflow for explicit modal navigation. |

## Focused inspection

- The starter no longer reads as a large dashboard card; spectral framing is restrained and the object in hand is the prompt.
- Persisted failure recovery is visually and semantically local to the failed turn.
- Unsupported voice is icon-only and does not repeat a visible unavailable label.
- The capsule empty state explains what will appear here, while destructive thread and owner-scope actions are available only from overflow.
- The compact PWA notice no longer changes shell padding or pushes the composer below the first viewport.

## QA history

1. Compared all three accepted Row A concepts with fresh rendered captures.
2. Verified the starter and capsule states visually in the in-app browser.
3. Created a real failed persisted turn and verified the inline recovery group in the rendered DOM and screenshot.
4. Confirmed the design deviations are deliberate and preserve existing product behavior.

final result: passed
