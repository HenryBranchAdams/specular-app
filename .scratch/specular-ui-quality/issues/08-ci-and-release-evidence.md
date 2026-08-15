# 08 — Lock UI quality into CI and release evidence

Status: ready-for-agent
Blocked by: 07

## Progress

- 2026-08-15: repaired the pre-existing Lighthouse runner failure with an explicit hosted-Chromium launch flag and a deterministic, compressed, fail-closed anonymous fixture over the emitted client build. Ticket completion remains blocked by 07 because canonical visual baselines and release evidence depend on the approved final surface.
- 2026-08-15: added the existing style, component-inventory, reciprocal surface-manifest, and real-Chromium Storybook interaction/accessibility contracts to hosted CI, with a machine-readable Storybook report uploaded on failure. Canonical pixel baselines and the versioned UI release-evidence extension still depend on 07.
- 2026-08-15: added a versioned UI exception registry and CI validator. Exceptions must be exact-state, owned, tracked, dated, removable, unexpired, and referenced bidirectionally by a governed surface or style rule.
- 2026-08-15: strengthened the style ratchet to reject unapproved raw-value substitutions even when declaration counts do not increase, and strengthened the surface manifest to require production `data-ui-surface` annotations. Release evidence now records the owner-approved baseline review and the complete PWA baseline set.

## Outcome

Turn the approved UI contract into a lightweight, enforceable quality ratchet.

## Acceptance

- CI runs style linting, reciprocal manifest validation, story interaction/accessibility checks, and canonical visual comparisons.
- Chromium is the initial blocking pixel baseline; selected WebKit cases remain diagnostic until stable.
- Failure artifacts include actual, expected, diff, accessibility, and manifest reports.
- CI cannot regenerate or auto-accept baselines.
- Changed baselines receive concise owner-review evidence without an additional approval bureaucracy.
- The release-evidence schema is versioned and records manifest, baseline commit, suites, viewports, accessibility policy, exceptions, and reviewer evidence.
- Exceptions name owner, rationale, affected states, issue, expiry, and removal condition; expired exceptions fail.
