# 01 — Establish the UI surface registry and state harness

Status: needs-triage

## Outcome

Create reciprocal production-surface ownership and a local Storybook harness using synthetic data.

## Acceptance

- An approved manifest maps active regions to production entry points, required states, stories, route scenarios, maturity, and exceptions.
- Manifest component and pattern IDs reuse `docs/design/specular-component-library-inventory.json`; they do not introduce a parallel naming catalog.
- A production registry maps back to every manifest row; CI detects entries missing in either direction.
- Transition handling covers the current `App.tsx`, stylesheet, auth UI, and active hosted components.
- The separately built MCP widget is classified as a legacy compatibility surface and is not counted as active hosted-product coverage or silently refactored in this program.
- Initial stories cover buttons, icon buttons, status patterns, dialogs, fields, and the two supplied failure states.
- Stories contain no real authored writing, identity, or production responses.
- No application redesign is included in this issue.
