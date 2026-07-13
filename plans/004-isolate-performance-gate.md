# Plan 004: Isolate the long-task performance gate from browser contention

> **Executor instructions**: Execute step by step, modify only in-scope files, and stop on a STOP condition. Commit in the isolated worktree. The reviewer owns the plan index.
>
> **Drift check (run first)**: `git diff --stat 138b6da..HEAD -- package.json playwright.config.ts tests/e2e/performance.spec.ts .github/workflows/ci.yml README.md`
> If the E2E scripts or project matrix changed, stop and report before redesigning the orchestration.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx / tests / perf
- **Planned at**: commit `138b6da`, 2026-07-12

## Why this matters

The default E2E command runs the latency-sensitive long-task assertion concurrently across multiple browser projects. The current audit observed two failures (79 ms attributed to starter motion at 320 px and 53 ms to send at 375 px) while the focused single-worker performance command passed. In addition, the observer is installed after navigation with buffered entries labeled `starter-motion`, so startup work can be misattributed. The gate must remain strict while measuring deliberate interaction windows in an isolated process.

## Current state

- `playwright.config.ts:9-10` uses three local workers and two CI workers, with a CI retry.
- `playwright.config.ts:23-32` instantiates every test file across six viewport/browser projects.
- `tests/e2e/performance.spec.ts:9-24` installs a buffered observer after navigation and initializes the operation label to `starter-motion`.
- `tests/e2e/performance.spec.ts:34-38` calls `openSpecular` before observer installation.
- `package.json:20-22` runs the performance file inside `test:e2e`, while the focused script selects only Chromium 375.
- The active design explicitly has no starter motion, so `starter-motion` is stale attribution.

## Commands you will need

Use the Node 22.23.1 `PATH` from Plan 001. Playwright commands require local loopback/browser permission.

| Purpose | Command | Expected on success |
|---|---|---|
| Focused performance | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test:performance` | exactly one Chromium 375 performance test passes, exit 0 |
| Functional matrix | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test:e2e:functional` | functional Chromium/WebKit matrix passes; only intentional duplicate PWA projects skip |
| Full browser gate | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run test:e2e` | functional stage and isolated performance stage both exit 0 |
| Typecheck | `PATH=/opt/homebrew/Cellar/node@22/22.23.1/bin:/opt/homebrew/bin:/usr/bin:/bin npm run typecheck:e2e` | exit 0 |

## Scope

**In scope**:

- `tests/e2e/performance.spec.ts`
- `package.json`
- `playwright.config.ts`
- `.github/workflows/ci.yml`
- `README.md`

**Out of scope**:

- Raising the 50 ms threshold, adding retries to the performance gate, or deleting coverage.
- Product CSS/React optimization; this plan makes evidence deterministic, not the app faster.
- Reducing the functional 320/375/430 Chromium/WebKit matrix.
- Changing Lighthouse score thresholds.

## Git workflow

- Work on the assigned isolated branch; this plan can start from the base or cumulative executor branch.
- Conventional commit: `test: isolate browser performance gate`.
- Do not push, merge, or open a PR.

## Steps

### Step 1: Give performance tests an explicit selection boundary

Tag the performance test title or describe block with a unique marker such as `@performance`. Add a `test:e2e:functional` script that runs the existing full matrix while excluding that marker. Change `test:performance` to run only the marker in `chromium-375` with `--workers=1 --retries=0`. Change `test:e2e` to run the functional matrix first and the isolated performance command second.

Keep CI calling the repository-owned `npm run test:e2e`; do not duplicate orchestration in workflow YAML. Update README language so the full gate is explicitly two-stage.

**Verify**: `npm run test:e2e:functional -- --list` excludes the performance test, and `npm run test:performance -- --list` lists exactly one test.

### Step 2: Measure named interaction windows only

Refactor the observer harness so it does not consume buffered pre-observer startup entries and does not use the obsolete `starter-motion` label. Add a helper that, for each named interaction:

1. clears prior long-task entries;
2. sets the operation name;
3. performs and awaits the action plus its visible completion assertion;
4. waits for the browser to finish the current rendering turn;
5. reads and asserts that operation's long-task list is empty.

Cover send, Test transition, the second send, Gather transition, and capsule navigation. Keep the hard 50 ms Long Tasks API definition; do not replace it with a looser wall-clock assertion. Startup remains covered by Lighthouse, while this test is explicitly about scripted interactions.

**Verify**: focused performance passes twice in two separate invocations without retry.

### Step 3: Run the complete browser gate

Run the functional matrix, then the full `test:e2e` script. Confirm the performance test ran only once and all functional viewport/browser projects still ran.

**Verify**: both commands exit 0; full output shows a passing isolated Chromium 375 performance stage and only the intended PWA skips.

### Step 4: Verify CI and documentation use the same command

Keep `.github/workflows/ci.yml` invoking `npm run test:e2e`. Update comments or step names only if needed to state that this script includes the functional matrix plus isolated performance gate. Do not add CI retry around the performance command.

**Verify**: `rg -n "test:e2e|test:performance|test:e2e:functional" package.json .github/workflows/ci.yml README.md` shows one repository-owned orchestration.

## Test plan

- Use `--list` to prove test selection before running browsers.
- Run the performance test twice separately; both must pass without retries.
- Run the full functional matrix and full composite browser gate once.
- Read the final Playwright output and confirm no viewport project was silently dropped from functional coverage.

## Done criteria

- [ ] The compatibility matrix excludes the long-task spec but retains all functional viewport/browser coverage.
- [ ] The long-task test runs exactly once, Chromium 375, one worker, zero retries.
- [ ] Interaction attribution begins after startup and is reset per named operation.
- [ ] No stale `starter-motion` label remains.
- [ ] The threshold remains 50 ms.
- [ ] Two focused runs, the functional matrix, the composite E2E command, and E2E typecheck pass.
- [ ] Only in-scope files changed.

## STOP conditions

Stop and report if:

- Playwright CLI selection cannot guarantee the performance file is excluded from the functional matrix and included exactly once later.
- The only way to make the test pass is to raise the threshold, add retries, or skip an interaction.
- The focused single-worker test still fails twice with the same application long task; that is a real product-performance finding requiring a different plan.
- A change would remove any functional browser/viewport project.

## Maintenance notes

Keep performance evidence isolated from cross-browser compatibility evidence. If more performance tests are added, put them behind the same marker and single-worker command rather than reintroducing project contention.
