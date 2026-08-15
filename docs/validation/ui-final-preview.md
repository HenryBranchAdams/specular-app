# Specular UI final preview record

Date: 2026-08-15

Status: qualified-local

## Revisions

- Candidate runtime revision: `7f5eb60e9650e6a889ac631c1bb468ef73bf57f9`
- Rollback revision: `9f979de8fd20d40a305a195276d71fccd85d0899`
- Owner review: approved visual doctrine and the standalone elevated authoring-page refinement on 2026-08-15

The candidate is a local Git revision. It has not been pushed, published, deployed, or substituted for the current live Site.

## Qualified result

The candidate applies the clean, crisp Specular visual system across the full governed product surface. The authoring document is a distinct white component elevated over a cool neutral workspace canvas, with stronger text, border, and depth contrast so the workspace remains calm without feeling washed out.

The final local qualification passed:

- TypeScript, ESLint, Stylelint, exact-value style ratchet, surface-manifest, component-inventory, and exception-registry checks
- 530 unit tests and the coverage gate
- 15 Storybook interaction and accessibility stories
- 5 blocking Chromium visual suites, including all four PWA notice states
- 138 functional end-to-end cases across Chromium and WebKit, with 18 intentional service-worker skips, plus the performance case
- release-evidence validation

The complete branch also previously passed the worker/D1 integration, integrated-browser, fixed-evaluation, PWA-build, production-build, Lighthouse, and dependency-audit gates.

## Evidence boundary

The iPhone Simulator package is supplemental. It proves Safari chrome, safe-area behavior, portrait and landscape reflow, fixed notices, and critical overlays with synthetic content. Safari exposed the input accessory strip but not the full software-keyboard grid, so installed standalone-PWA and full-key-grid receipts remain explicit manual follow-ups. No physical-device certification is claimed.

Publication remains a separate owner-approved action. If a future preview or deployment regresses the approved composition, return to the rollback revision above rather than accepting new baselines.
