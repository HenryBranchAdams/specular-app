# Critical-module coverage baseline

**Measured:** 2026-08-15
**Command:** `npm run test:coverage`
**Tests:** 38 files, 486 tests

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| All named critical modules | 85.90% | 61.62% | 84.48% | 90.65% |
| Authentication boundary | 93.67% | 83.33% | 93.75% | 97.22% |
| Dictation capture/client | 82.79% | 66.32% | 85.29% | 87.66% |
| Workspace synchronization | 84.48% | 51.58% | 80.64% | 89.61% |
| Account archive/deletion client | 100% | 100% | 100% | 100% |

The configured thresholds are named, scope-specific non-regression floors, intentionally below this exact run to avoid making harmless instrumentation differences fail immediately. They are not the target. Ratchet branches and lines upward as missing scenario tests land, with a long-term target of at least 90% branch coverage for extracted authorization, authentication/cache, synchronization, archive/deletion, and dictation state machines.

Review the baseline after each critical testing tranche. A threshold decrease requires a written exception with an owner, reason, and expiry in the release evidence.
