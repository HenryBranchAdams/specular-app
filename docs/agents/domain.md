# Domain Docs

This repository uses a single domain context.

## Before exploring

- Read `CONTEXT.md` at the repository root.
- Read relevant decisions under `docs/adr/`.
- If either is absent, proceed silently; `/domain-modeling` creates domain documentation only when terms or decisions are resolved.

## Vocabulary and decisions

Use the canonical terms defined in `CONTEXT.md`. Do not substitute terms listed under `_Avoid_`. Surface any conflict with an existing ADR rather than silently overriding it.

## Layout

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```
