# Testing & QA

---

## 1. The test estate

| Layer | Tool | Location | Scope |
|---|---|---|---|
| Shared library unit | Jest + ts-jest | `libraries/shared/src/__tests__/` | money helpers, presets, allocation, overdraft, reconciliation (incl. randomised invariants) |
| UI library unit | Jest + `@testing-library/react` | `libraries/ui/src/__tests__/` | components, theme, toast |
| API unit + integration | Jest + Supertest | `apps/api/src/__tests__/` | every route, every service, middleware, config |
| API regression | Jest | `apps/api/src/__tests__/regression.test.ts` (898 lines) | end-to-end behaviour guard |
| Web unit | Jest (jsdom) | `apps/web/src/__tests__/` | pages, hooks, utils, **pool components** |
| Mobile unit | Jest | `apps/mobile/src/__tests__/` | contexts, hooks, pool service |
| Web E2E | Playwright | `e2e/tests/` | full browser journeys |
| Mobile E2E | Maestro | `apps/mobile/maestro/flows/` | device/simulator journeys |
| API smoke | plain Node | `scripts/local-dev/pool-smoke.mjs` | live pooling check against a running API |
| Manual | — | [`03-staging-test-scenarios.md`](03-staging-test-scenarios.md) | scripted exploratory passes |

---

## 2. Run everything

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush

# prerequisite
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui

# typecheck (exactly what CI does)
(cd apps/api && npx tsc --noEmit) && \
(cd apps/web && npx tsc --noEmit) && \
(cd apps/mobile && npx tsc --noEmit)

# unit tests
(cd libraries/shared && npm test)
(cd libraries/ui && npm test)
(cd apps/api && npm test)
(cd apps/web && npm test)
(cd apps/mobile && npm test)       # 2 known pre-existing failures

# coverage
(cd apps/api && npm run test:coverage)
(cd apps/web && npm run test:coverage)
(cd libraries/ui && npm run test:coverage)
(cd apps/mobile && npm run test:coverage)

# regression
(cd apps/api && npm run test:regression)

# E2E
(cd e2e && npx playwright test)

# Maestro (needs a simulator/emulator)
(cd apps/mobile && npm run test:maestro:ios)
(cd apps/mobile && npm run test:maestro:android)
```

Rush equivalents exist (`rush test:api`, `rush test:e2e`, `rush test:maestro`, …) but shell
out to a **global `rushx`**; if you do not have one, call the package scripts directly as
above. CI does the same.

---

## 3. API tests

`apps/api/src/__tests__/`

| File | Covers |
|---|---|
| `routes/pools.flows.test.ts` (794) | the full pooling lifecycle per use case |
| `routes/pools.recurring.test.ts` (307) | cycles, carry-forward, membership changes |
| `routes/expenses.test.ts` | expense CRUD incl. the pool funding paths |
| `routes/events.test.ts`, `events.pro-gating.test.ts` | event CRUD, Pro gating |
| `routes/groups.test.ts`, `invitations.test.ts`, `users.test.ts`, `health.test.ts` | the rest of the surface |
| `routes/billing.test.ts`, `internal-entitlements.test.ts` | RevenueCat webhook, tier switch |
| `services/pool.service.test.ts` (284) | pool orchestration |
| `services/settlement.service.test.ts` | greedy algorithm, entity balances, initiate/approve, auto-settle, on-behalf-of, edge cases |
| `services/fx-rate.service.test.ts` | predefined, reverse, EOD cache/fetch/error, `convert`, provider routing |
| `services/{auth,event,expense,group,invitation,email,entitlement,payment,revenuecat,billing-events,upload}.service.test.ts` | per-service |
| `middleware/auth.test.ts` | the token ladder and the **mock-auth refusal** outside local/test |
| `utils/event-guards.test.ts`, `utils/notification-helper.test.ts` | lock states, notification fan-out |
| `config/firebase.test.ts`, `config/websocket.test.ts` | backend selection, rooms and emitters |
| `regression.test.ts` (898) | broad behaviour guard |

### Test harnesses

| File | Purpose |
|---|---|
| `__tests__/helpers/memoryFirestore.ts` (147) | An in-memory Firestore mirroring the API's own fallback, so route tests run with no Firebase at all |
| `__tests__/helpers/poolHarness.ts` (118) | Builds pool fixtures — events, cycles, contributions, draws — so a pooling test is a few lines |
| `__tests__/utils/firestore-merge.test.ts` | Pins the stand-in's `set(merge)` / `update()` semantics to the real SDK's |

Use these rather than mocking `firebase-admin` by hand.

---

## 4. Shared-library tests

| File | Lines | Notes |
|---|---|---|
| `pool-math.test.ts` | **700** | The crown jewel: allocation exactness, overdraft/latch transitions, `evaluateDraw` for all three policies × already-incurred, reconciliation across every surplus/deficit policy, membership splits, **and randomised invariant checks** (Σnet === closing, parts sum to total) |
| `index.test.ts` | 615 | Core types + a snapshot of the exported surface — ⚠️ adding an export updates the snapshot, which is intentional: it makes API-surface changes visible in review |
| `pool.test.ts` | 156 | Presets, funding helpers, minor-unit conversion incl. zero-decimal currencies |
| `pool-ui.test.ts` | 183 | Formatting, refusal copy, receipt rule, meter geometry, funding-choice validation |

Target: **100% coverage**. If you add a branch to `pool-math.ts`, add a test.

---

## 5. Web tests

`apps/web/src/__tests__/` — `pool/pool-components.test.tsx` (340),
`pool/pool-interactions.test.tsx` (358), `pool/pool-logic.test.ts`,
`hooks/useSocket.test.ts`, plus `app/`, `config/` and `utils/` (with snapshots).

`jest.config.cjs` applies coverage thresholds that **include the pool components**, so new
pool UI without tests fails `npm test`.

---

## 6. Mobile tests

`apps/mobile/src/__tests__/` — `context/` (AuthContext entitlement hydration + switch),
`hooks/`, `services/pool.test.ts` (127), `version-script.test.ts` (145 — drives
`scripts/version.mts` against a throwaway `apps/mobile` via `TRAXETTLE_MOBILE_DIR`),
`subscriptionTerms.test.ts`, plus snapshots.

> ⚠️ **Two known, pre-existing failures**, unrelated to pooling:
> - `src/__tests__/firebase.test.ts` — expects a stale emulator project id
> - `src/__tests__/App.test.tsx` — Jest cannot parse the suite
>
> CI therefore runs mobile tests with `continue-on-error: true`. Do not treat a red mobile
> suite as *your* regression until you have confirmed it is not one of these two.

---

## 7. Playwright E2E

`e2e/` — `@playwright/test` 1.42, Chromium only, serial (`workers: 1`,
`fullyParallel: false`), 30 s timeout, HTML report, trace on first retry, screenshot on
failure, 2 retries in CI.

**It starts its own servers on dedicated ports** so it never collides with your dev stack:

| Service | Port | Env |
|---|---|---|
| API | **3201** | `APP_ENV=local`, `INTERNAL_TIER_SWITCH_ENABLED=true`, `PAYMENT_ALLOW_REAL_IN_NON_PROD=false` |
| Web | **3200** | `NEXT_PUBLIC_APP_ENV=local`, `NEXT_PUBLIC_API_URL=http://localhost:3201`, `NEXT_PUBLIC_ALLOW_LOCAL_TIER_SWITCH=true` |

`reuseExistingServer: false` — it always starts fresh. Note the `webServer` commands use
`rushx`, so a **global `rushx`** is required to run Playwright.

Specs: `auth`, `navigation`, `events`, `event-detail`, `expenses`, `expense-lifecycle`,
`groups`, `invitations`, `settlements`, `closed-events`, `tier-entitlements`.
Helpers: `helpers/api.ts`, `helpers/auth.ts` (which uses the `localStorage` mock-token
trick).

```bash
cd e2e
npx playwright install --with-deps chromium   # first time
npx playwright test
npx playwright test --headed
npx playwright test --ui
npx playwright show-report
```

---

## 8. Maestro mobile E2E

`apps/mobile/maestro/`

| Flow | Covers |
|---|---|
| `flows/auth/auth-and-profile.yaml` | auth + profile smoke |
| `flows/navigation/history-and-invitations.yaml` | invitations inbox, closed-events history |
| `flows/events/create-and-manage.yaml` | event creation and management |
| `flows/groups/create-group.yaml` | group creation |
| `flows/settlement/same-currency-mock.yaml` | same-currency settlement **including payer retry** (asserts `Retry Payment` then re-triggers before payee confirmation) |
| `flows/settlement/multi-currency-mock.yaml` | USD → INR with the EOD FX path |

```bash
cd apps/mobile
npm run test:maestro                 # all flows, no artifacts
npm run test:maestro:artifacts       # + screenshots/logs → maestro/artifacts/
npm run test:maestro:android         # MAESTRO_DEVICE defaults to emulator-5556
npm run test:maestro:ios

# or a single flow
maestro test maestro/flows/auth/auth-and-profile.yaml
```

Runner behaviour (`maestro/scripts/run-maestro.sh`):

| Variable | Default | Effect |
|---|---|---|
| `MAESTRO_USE_FIREBASE_EMULATOR` | `true` | boots auth/firestore/storage emulators for the run |
| `MAESTRO_MANAGE_API` | `true` | starts and stops the API in emulator mode |
| `MAESTRO_API_PORT` | `3001` | emulator-backed API port |
| `MAESTRO_DEVICE` | `emulator-5556` (Android) | target device |
| `RUN_ID` | `$(date +%s)` | artifact folder name |

Firebase test data is cleaned **before and after** every run via
`maestro/scripts/cleanup-firebase-maestro.js`. A seeded emulator snapshot lives in
`maestro/.firebase-data/`.

> ⚠️ There are currently **no Maestro flows for money pooling**. Pool coverage on mobile is
> unit tests + manual scenarios. Adding flows for the kitty and sponsor-budget paths is the
> highest-value test gap.

---

## 9. The pooling smoke test

```bash
# with an API running on :3001 with APP_ENV=local
node scripts/local-dev/pool-smoke.mjs
API=http://localhost:3201 node scripts/local-dev/pool-smoke.mjs   # against the Playwright API
```

Uses `Bearer mock-*` tokens and unique per-run user ids (`mock-smoke-alice-<base36>`), and
exercises:

- a plain split event is still created with **no `fundingModel`** (the regression guard)
- kitty creation, contributions, receipt upload
- a pool draw
- the graduated-overdraft **refusal** and the **"already paid"** override
- access control
- the settle-up plan

Exits non-zero on any failed check; prints `ALL LIVE CHECKS PASSED` when clean. This is the
fastest possible confirmation that a pooling environment is wired correctly.

---

## 10. CI

`.github/workflows/ci.yml`, on push to `main` and PRs to `main`/`stage`, Node 24:

```
rush install
rush build --to @traxettle/shared --to @traxettle/ui
typecheck:  apps/api, apps/web, apps/mobile
test:       libraries/shared, libraries/ui, apps/api, apps/web
test:       apps/mobile   (continue-on-error)
```

**Not in CI:** Playwright, Maestro, mobile artefact builds, deploys.

---

## 11. Coverage reference

Figures recorded in the repo's functional doc (verify before quoting them):

| Suite | Figure |
|---|---|
| API | 392 tests / 15 suites, ~92.9% statements, ~83.6% branches |
| Shared | 100% coverage target |
| Playwright | 31 tests |
| Regression | 48 tests |
| Settlement service | 38+ tests |
| FX rate service | 14 tests |
| Event guards | 10 tests |
| Web / mobile unit | 🚧 expanding |

The pooling commit added roughly **2,500 lines of new tests** across the shared library, API,
web and mobile.

---

## 12. Writing a new test

| You are testing | Do this |
|---|---|
| A pure calculation | `libraries/shared/src/__tests__/` — no mocks needed |
| An API route | `apps/api/src/__tests__/routes/` with Supertest + `memoryFirestore` |
| Pool behaviour on the API | add `poolHarness` fixtures; assert both the happy path **and** the refusal with its `code`/`data` |
| A web pool component | `apps/web/src/__tests__/pool/` — coverage thresholds will enforce it |
| A mobile screen | `apps/mobile/src/__tests__/` |
| A browser journey | `e2e/tests/` — reuse `helpers/auth.ts` |
| A device journey | `apps/mobile/maestro/flows/` |

Non-negotiables for pool changes:

1. If you touch `pool-math.ts`, add a case to `pool-math.test.ts` — including an invariant
   assertion if you changed a balance or share calculation.
2. If you add a refusal, assert the `code` **and** the structured `data` fields a client
   needs to render the message.
3. If you add a shared export, expect `index.test.ts`'s snapshot to change, and review that
   diff deliberately.
4. Always include the regression direction: *"a split-expenses event is unaffected."*

---

**Sources:** `apps/api/src/__tests__/**` · `libraries/shared/src/__tests__/**` ·
`apps/web/src/__tests__/**` · `apps/mobile/src/__tests__/**` ·
`e2e/{package.json,playwright.config.ts,tests,helpers}` ·
`apps/mobile/maestro/{README.md,flows,scripts}` ·
`scripts/local-dev/pool-smoke.mjs` · `.github/workflows/ci.yml` ·
`common/config/rush/command-line.json` · `traxettle-app/docs/app/Functional.md` §11
