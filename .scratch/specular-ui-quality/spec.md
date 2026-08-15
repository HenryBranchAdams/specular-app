# Specular UI quality system

Status: approved for implementation planning
External effects: none
Owner decisions: 2026-08-15

## Objective

Refactor low-quality or inconsistent frontend surfaces across the entire active product into a coherent system that begins from the approved MagicPath `Specular` defaults and establish a lightweight quality ratchet that prevents prospective drift.

## Current references

- `CONTEXT.md`
- `docs/design/specular-interface-doctrine.md`
- `docs/design/specular-magicpath-source.md`
- `docs/research/2026-08-15-specular-ui-quality-audit-and-plan.md`
- accepted ADRs, including ADR 0007's non-blocking physical-device follow-up

## Approved decisions

1. Preserve the authored block-document product model.
2. Use the loaded MagicPath `Specular` theme as the approved default: white/black neutral surfaces, Playfair Display 400, Noto Sans 400, restrained gray structure, and blue only for focus or selected emphasis. It is not immutable; owner-reviewed improvements are allowed. The prior tan/paper exploration is superseded as the default.
3. Use Storybook for finite component states and existing Playwright infrastructure for local visual regression.
4. Establish reusable foundations in the same batch that fixes entry, update, offline, safe-area, and overlay-focus failures.
5. The owner gives lightweight greenlight to intentional visual-baseline changes.
6. Do not add a physical-device release gate. Use Xcode iPhone Simulator as supplemental evidence.
7. Cover the entire active product surface in the release scope while retaining blocker-ordered internal issues and review checkpoints.
8. Keep dark tokens valid and testable without adding a user-facing dark-mode control in the initial rework.
9. Use deterministic synthetic writing for local and preview evidence. Authorized live verification uses a clearly synthetic test document and leaves existing private writing untouched.
10. Keep implementation and review separate from live publication; publishing the Site requires the owner's explicit greenlight.
11. Implement the program ticket-by-ticket on one long-lived UI-rework branch with reviewable commits and visual checkpoints, then present one coherent final PR to `main`.
12. Define the active release surface as the hosted workspace, PWA states, authentication boundaries, Library, Connections, snapshots, and hosted snapshots. Treat the separately built MCP widget as a legacy compatibility surface outside this rework; any retention, adaptation, or removal is separate future work.
13. Permit minor enhancements when they are local, low-risk, and make an existing task clearer or more dependable. Major product capabilities, data-model changes, and new workflow concepts require separate future work.
14. Use MagicPath as an exploratory and supplemental resource for difficult compositions, alternatives, and checkpoint reviews. Once implemented, production components, Storybook stories, and owner-approved visual baselines are the operational source of truth; routine two-way synchronization is not required.
15. A minor enhancement may ship in this program only when it improves an existing task, is local and reversible, needs no schema, permission, or API change, fits inside the current ticket's tests, and introduces no new workflow concept.
16. Hold three lightweight visual checkpoints: after issues 01–05; after issue 06; and after issues 07–09. Each checkpoint presents concise before/after evidence for owner feedback rather than requiring approval for every component.
17. Do not leave an active hosted state silently unfinished. Any accepted exception names the exact state, rationale, owner, creation and expiry dates, tracking issue, and removal condition.
18. Live cutover requires green required CI, complete synthetic visual evidence, critical WebKit mobile/PWA checks, supplemental iPhone Simulator receipts, final owner preview approval, and an identified rollback revision. Owner greenlight is the sole publication trigger.

## Delivery order

Issues are blocker-ordered implementation units inside one entire-product release scope and one long-lived rework branch. Each issue ends in a reviewable commit. Checkpoint 1 follows issues 01–05, checkpoint 2 follows issue 06, and checkpoint 3 follows issues 07–09. Issue 01 establishes enforceable surface ownership. Issues 02–05 prove the foundations on the highest-risk defects. Issue 06 covers the core authoring product. Issues 07–08 cover secondary hosted surfaces and lock the system. Issue 09 adds non-blocking simulator receipts. A final coherent PR targets `main` only after the internal sequence passes.

No issue authorizes deployment. Live publication or release qualification requires separate explicit authority.

## Program acceptance

- The active UI registry and manifest agree in both directions.
- The current visual direction is unambiguous and old visual specs are labeled historical.
- The supplied update and sign-in failures pass at 320, 375, and 430 CSS pixels and 200% text.
- Dialogs and drawers meet the agreed focus, keyboard, layering, and narrow-height contract.
- Critical active surfaces have deterministic synthetic fixtures, stories or route scenarios, axe results, and reviewable visual baselines.
- New raw visual values and unregistered visible surfaces cannot silently bypass CI.
- Baseline changes are understandable and owner-approved without unnecessary ceremony.
- Simulator evidence is supplemental and clearly distinguished from physical-device evidence.
- Every active hosted state has owner-reviewed evidence or an explicitly accepted, owned, and expiring exception.
- The final preview identifies its exact candidate revision and rollback revision before publication is proposed.

## Out of scope

- Replacing the authored block-document model.
- Importing a third-party product's visual identity.
- Adding Chromatic or another hosted screenshot service without separate privacy and cost approval.
- Requiring physical-device evidence for release.
- Deployment, publication, or changing ADR 0007.
- Refactoring, adapting, or removing the legacy MCP compatibility widget.
- Major new product features, new workflow concepts, or data-model changes discovered during the visual rework.
