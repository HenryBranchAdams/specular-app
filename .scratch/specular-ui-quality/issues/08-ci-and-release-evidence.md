# 08 — Lock UI quality into CI and release evidence

Status: needs-triage

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
