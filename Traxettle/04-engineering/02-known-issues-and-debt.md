# Known Issues & Technical Debt

Verified against commit **`505de9a`** on `feature/money-pooling`. Each entry says what is
wrong, where, why it matters, and what to do. **If a test fails or something looks broken,
check here before assuming you caused it.**

### Resolved since the previous KB revision (`a65f586` → `505de9a`)

| Was | Now |
|---|---|
| **C7** — `/api/pools/*` returned 404 on deployed staging | ✅ **Pooling is deployed to staging** (401, verified) |
| **I2** — `npm run build:android:staging` secretly ran the *production* profile | ✅ the misleading alias was **deleted** |
| **P3** — `build-ios.sh production` fell back to the staging API URL | ✅ that profile is **gone**; iOS is now `debug \| testflight`, and release builds pick their API at runtime |
| Four version fields bumped by hand | ✅ replaced by `scripts/version.{sh,mts}` + `release-versions.json`, driven automatically by the store build scripts |
| In-memory Firestore stand-in diverged from real merge semantics | ✅ `apps/api/src/utils/firestore-merge.ts` now implements Firestore's actual `set(merge)` / `update()` semantics for the mock and the tests, *"a stand-in that merges more loosely hides bugs that only appear against a real database"* |
| Pro survived expiry in the free-event check | ✅ `hasActivePro()` is now the single rule, applied to both capabilities and the event quota |
| **P5** — RevenueCat properties filename mismatch (`rc_production` vs `rc_prod`) | ✅ `load-rc-config.sh` normalises `prod → production`, falls back to legacy `rc_prod.properties`, and the file is now `rc_production.properties` |
| **C5** — mobile `ENV.APP_VERSION` hard-coded to `'1.0.0'` | ✅ now reads `appJson.expo.version` |
| Admins could approve their own pool spending | ✅ `canApproveDraw()` blocks it (`POOL_SELF_APPROVAL`), custodian excepted |
| Settle-up could close an event with an unpaid approved claim | ✅ dissolution creates any missing reimbursement leg, and refuses outright while draws are pending (`POOL_PENDING_DRAWS`) |
| A cleared spender cap came back after a config save | ✅ `updateConfig` uses `update()` instead of `set(..., { merge: true })` |

Severity: 🔴 fix before a production release · 🟠 fix soon · 🟡 cosmetic / papercut ·
⚪ accepted trade-off

---

## 🔴 Security

### S1 — IDOR on `GET /api/events/:eventId`

**Verified.** `apps/api/src/routes/events.ts:143` calls `eventService.getEvent()` with **no
`requireEventAccess()`**:

```ts
router.get('/:eventId', requireAuth, async (req, res) => {
  const event = await eventService.getEvent(req.params.eventId);
  if (!event) return res.status(404)...;
  return res.json({ success: true, data: event });   // ← no membership check
});
```

Any authenticated user who knows (or guesses) an event id can read its name, dates,
currency, participants-as-admins, settlement approvals and **full `poolConfig`** — including
the custodian id, target amounts and spender caps.

Every *other* event-scoped read does gate correctly (`expenses`, `pools`, `groups`,
`settlements`). This one was missed.

**Fix:** add `await requireEventAccess(req.params.eventId, req.user!.uid);` and map
`EventAccessError`. Add a test asserting a non-participant gets 403/404.

> Explicitly acknowledged as out of scope by the pooling plan:
> *"the IDOR on `GET /api/events/:id` [was] out of this plan's scope; see the code review."*

### S2 — No authentication on WebSocket room joins

`apps/api/src/config/websocket.ts:23-44` — `join-event` and `join-user` accept **any**
string:

```ts
socket.on('join-event', (eventId: string) => { socket.join(`event:${eventId}`); });
socket.on('join-user',  (userId: string)  => { socket.join(`user:${userId}`); });
```

There is no handshake auth and no membership check. A client that knows an event id receives
every `expense:created`, `settlement:updated` and `pool:updated` payload for it — which carry
entity data. `join-user` additionally leaks `pool:alert` and `user:tier-updated`.

**Fix:** authenticate the socket handshake (pass the bearer token, verify it with the same
ladder as `requireAuth`), then check membership before `socket.join`.

### S3 — The in-memory Firestore fallback is silent, including in production

`apps/api/src/config/firebase.ts` — with no credentials the API logs
`🔧 Firebase credentials not found, using mock services` and serves traffic against an
in-process `Map`. There is **no environment check**.

A production deploy with a broken or missing service account will start successfully, pass
`/health`, accept writes, and lose all of them on the next container restart. Cloud Run
scales to zero, so this would present as *"data randomly disappears"*.

**Fix:** refuse to start when `APP_ENV` is `staging` or `production` and no real credentials
resolve. Keep the fallback for local/test only.

> Also explicitly acknowledged as out of scope by the pooling plan.

### S4 — Permissive CORS on the API and Socket.IO

`apps/api/src/index.ts` uses bare `cors()` (`origin: *`), and the Socket.IO server sets
`cors: { origin: '*' }`.

Lower impact than it looks, because auth is header-based (no cookies ⇒ no classic CSRF), but
it means any site can call the API with a token it has obtained, and it is not defence in
depth.

**Fix:** allowlist the known web origins per environment.

### S5 — No rate limiting anywhere

No throttling on `/api/auth/login`, `/register`, `/forgot-password`, `/email-link/send`, or
any pool write. Credential stuffing, email-link spam, and ledger-churn are all unmetered.

**Fix:** `express-rate-limit` on the auth routes at minimum.

---

## 🔴 Production build configuration

These make the current `production` build profile effectively a *staging* build. All verified
in `apps/mobile/scripts/build-{android,ios}.sh` and `apps/mobile/eas.json`.

### P1 — The production profile uses the **staging** Firebase project

Both scripts set `FIREBASE_ENV="staging"` for `production`, so
`google-services.staging.json` / `GoogleService-Info.staging.plist` are compiled into the
production app. `google-services.prod.json` and `GoogleService-Info.prod.plist` exist in the
repo but are never used by the production profile.

### P2 — The production profile uses the **staging** Google OAuth client ids

`build-android.sh` even warns:

```
⚠️ Using staging OAuth client IDs — replace with production IDs when Firebase project is ready
# TODO: Replace these with production Firebase project OAuth client IDs
```

`build-ios.sh` has the same comment. `app.json` registers reversed-client-id URL schemes only
for **local** and **staging**, so a production Google client id would additionally need a
third `CFBundleURLTypes` entry.

### P4 — `eas.json` production API URL is a placeholder

```json
"production": { "env": { "EXPO_PUBLIC_API_URL": "https://REPLACE_WITH_PRODUCTION_API_URL" } }
```

Lower impact now that `build-ios.sh` no longer uses EAS, but `eas.json` is still in the repo
and still wrong.

**Combined fix for P1/P2/P4:** add a real `prod` Firebase environment to both build scripts
(the config files already exist), generate production OAuth client ids and register the third
reversed-client-id URL scheme in `app.json`, and either fix or delete `eas.json`.

---

## 🟠 Correctness & robustness

### C1 — Two known-failing mobile unit tests

| Test | Problem |
|---|---|
| `apps/mobile/src/__tests__/firebase.test.ts` | Expects a stale emulator project id |
| `apps/mobile/src/__tests__/App.test.tsx` | Jest cannot parse the suite |

CI runs mobile tests with `continue-on-error: true` because of these. **Neither is related to
pooling.** They mask real regressions in the mobile suite — fix them and make mobile tests
blocking.

### C2 — Phone OTP is a stub that accepts a hard-coded code

`apps/api/src/services/auth.service.ts` — `signInWithPhone()` logs a mock OTP and
`verifyOTP()` accepts `'123456'`:

```ts
if (otp === '123456') { // For testing
```

The **routes** correctly return "not available in phase 1", so this is not reachable today.
But the service method is live and would be an authentication bypass the moment anyone wires
it up.

**Fix:** delete the stub, or make it throw unless `APP_ENV=local`.

### C3 — `firestore.indexes.json` is empty

It is `{}`. Every query is single-field, which Firestore auto-indexes, so nothing is broken
today. But `settlement.service.ts` and `pool.service.ts` fetch by `eventId` and filter in
memory; at scale that is full-collection reads.

**Fix:** profile first; add composite indexes when queries get narrower.

### C4 — `settlement.service.ts` still uses float money

`Math.round(x * 100) / 100` appears in the settlement service. Fine for one event's split,
and the pool ledger deliberately avoids it, but the two systems use different numeric
regimes and meet at `toBalances()`.

**Fix:** eventually migrate core expense/settlement amounts to minor units too. Needs a
migration plan; not urgent.

### C5 — iOS and Android ship different versions

`release-versions.json` records iOS last shipped **1.0.33** while Android is on **1.0.37**
(build 39). The new scheme is designed to converge them — *"the second platform of a release
ships the version the first one moved to"* — but iOS is currently four patch releases behind
in the store. Expected to resolve on the next TestFlight upload; worth confirming with
`npm run version:show` before a release.

### C6 — `CreateExpenseDto.alreadyIncurred` is easy to mis-type

The field is `alreadyIncurred`, but it is a plain optional boolean on a DTO that is **not**
zod-validated (`POST /api/expenses` hand-validates). A typo silently becomes `undefined`,
turning a "record it anyway" into a refused pre-authorised draw.

**Fix:** zod-validate `POST /api/expenses`.

### C7 — ✅ Resolved: pooling is deployed to staging

`/api/pools/event/x/summary` now returns **401** on
`https://traxettle-api-staging-943648574702.us-central1.run.app` (it was 404). Both staging
paths in
[`../03-operations/02-staging-verification-guide.md`](../03-operations/02-staging-verification-guide.md)
are usable. **Re-probe rather than trusting this** — it is the one fact here that a deploy can
change without any file changing.

### C8 — "Several of us" pools are invisible in production, by a hard-coded constant

`CONTRIBUTOR_POOLS_IN_PRODUCTION = false` in `libraries/shared/src/pool-ui.ts`. Four of the
five presets (Kitty, Fund, Treasury, Collection) cannot be created in a production build;
only "Just me" budgets can. **The API accepts all five**, so this is a client gate, not a
capability limit.

Not a bug — a deliberate first-release decision — but it is invisible unless you read the
constant, and it will silently keep the majority of the pooling feature dark after release.
**Confirm it is still intended before every production release**, and remember that any
manual test of contributor pools must run on a local/staging/internal build.

---

## 🟡 Inconsistencies & papercuts

### I1 — Two different staging API URLs across the repo

| Used by | URL |
|---|---|
| `apps/mobile/src/config/env.ts`, `build-android.sh` | `https://traxettle-api-staging-943648574702.us-central1.run.app` |
| `build-ios.sh`, `eas.json`, `docs/` | `https://traxettle-api-staging-lomxjapdhq-uc.a.run.app` |

**Verified harmless** — both are Cloud Run hostnames for the *same* service: `/health` 200
and identical `/api/config` (`projectId: traxettle-staging`) from both. But
`RuntimeConfigManager.matchesSelectedEnvironment()` compares
`config.apiUrl === ENV.STAGING_API_URL` **by string**, and `/api/config` derives `apiUrl`
from the request host. So **an app built by `build-ios.sh` that reaches the `lomxjapdhq`
host will never match `ENV.STAGING_API_URL`** and will therefore discard its stored config
and refetch on every cold start. Functional, wasteful, and fragile.

**Fix:** pick one hostname and use it everywhere.

### I3 — `ENV.API_URL` ignores `APP_ENV=staging`

`apps/mobile/src/config/env.ts` resolves `API_URL` from `__DEV__` only — dev ⇒ localhost,
otherwise ⇒ the **production** URL. `STAGING_API_URL` exists but is used only by
`RuntimeConfigManager`. A build with `EXPO_PUBLIC_APP_ENV=staging` but no
`EXPO_PUBLIC_API_URL` would hit production. The build scripts always set
`EXPO_PUBLIC_API_URL`, so this is latent rather than live.

### I4 — The docs' local-dev mode table is misleading

`traxettle-app/docs/runbook/LOCAL_DEVELOPMENT.md` lists "Mode 5/6 — traxettle-testing" as
distinct from modes 3/4, but modes 3/4 with the `local` argument **already** resolve to
`traxettle-test`. Corrected in
[`../03-operations/01-local-development.md`](../03-operations/01-local-development.md).

### I5 — `ENVIRONMENT_SETUP.md` contains stale OAuth client ids

It documents a `368026022797-…` project for local, while the code and `bootstrap.sh` use
`603084161476-…` (`traxettle-test`). Trust the code and
[`../02-architecture/07-auth-and-security.md`](../02-architecture/07-auth-and-security.md).

It also shows `bash scripts/build-android.sh release:production`, which is not a valid
profile (`staging | production | debug | debug:staging`).

### I6 — `rush test:*` requires a global `rushx`

The Rush custom commands shell out to `rushx`, which Rush does not install globally. CI
sidesteps this by calling package scripts. The Playwright `webServer` commands have the same
dependency, so `npx playwright test` fails without a global `rushx`.

**Fix:** use `install-run-rushx.js` in the command definitions, as the local-dev scripts do.

### I7 — `UserPreferences.notifications` is never acted on

The field exists and is editable; nothing reads it. There are no push or email preferences to
honour yet.

### I8 — No Maestro coverage for money pooling

Maestro flows cover auth, navigation, events, groups and settlement, but **nothing pooling**.
Mobile pool coverage is unit tests plus manual scenarios. Adding kitty and sponsor-budget
flows is the highest-value test gap in the repo.

### I9 — `apps/mobile/src/examples/` ships in the source tree

`DeveloperOptionsUsage.tsx` and `ProductionAPIErrorHandling.tsx` are reference material, not
shipped UI, but they sit inside `src/` and are typechecked as app code.

### I10 — Committed build/run artefacts

`firestore-debug.log`, `apps/mobile/coverage/`, `apps/mobile/dist/`,
`apps/mobile/maestro/artifacts/` (hundreds of screenshots and HTML reports from February and
March), `e2e/playwright-report/`, `e2e/test-results/`, and `rush-logs/` directories are
present in the working tree. They bloat the repo and make `git status` noisy after any test
run.

---

## ⚪ Accepted trade-offs

Deliberate decisions, documented so nobody "fixes" them by accident.

| | Decision | Why |
|---|---|---|
| A1 | **Manual settlement is the default.** Traxettle moves no money | Users pay outside the app however they like; the gateway pilot stays hidden behind `SETTLEMENT_GATEWAY_PILOT_ENABLED` |
| A2 | **Concurrent sessions are allowed** across devices | Product decision; `revoke-sessions` exists for when you want the other behaviour |
| A3 | **No automatic cycle closing** | A custodian or admin closes cycles; no background scheduler |
| A4 | **No pool email/push notifications** | In-app and socket only |
| A5 | **Money pooling is not Pro-gated**, including consumption weighting | Considered as a differentiator, left open as a product decision |
| A6 | **Funding model is chosen at creation, not toggled** | A runtime toggle would double every branch in a 2,400-line page. One-way conversion to hybrid is offered instead |
| A7 | **The web app is desktop-first** | The mobile app covers phones |
| A8 | **Pool balances are derived on every read** | A corrected or deleted expense self-heals the ledger; a stored running total would drift |
| A9 | **Fair shares weight agreed commitment, not amounts paid** | Weighting by what was paid lets a non-payer escape their share |
| A10 | **Already-incurred draws are always recorded**, even past the limit | An accurate ledger beats an enforced one; the custodian is alerted instead |
| A11 | **The overdraft pause is latched** rather than purely pre-flight | Otherwise a ₹500 top-up unlocks a ₹500 spend |
| A12 | **No composite Firestore indexes** | Keeps queries single-field and index management at zero |
| A13 | **Firestore/Storage rules are deny-all for clients** | The public Firebase config is extractable from the web bundle, so it must grant nothing |
| A14 | **`PoolContribution` has no `rejected` status** | A rejection returns it to `pending`, matching the settlement leg model |
| A15 | **`fundingSource` is immutable on an existing expense** | Changing it would mean unwinding ledger effects; delete and re-add instead |

---

## Priority order if you are fixing this

1. **S1** IDOR on `GET /api/events/:id` — one line, real exposure, **still open**
2. **S3** silent Firebase fallback in production — data-loss risk
3. **P1 / P2 / P4** production build profile — the production app still uses the staging
   Firebase project and staging OAuth client ids
4. **S2** WebSocket room auth
5. **C1** the two failing mobile tests, then make mobile CI blocking
6. **C2** delete the OTP stub
7. **S5** rate limiting on auth
8. **C8** decide deliberately whether contributor pools ship
9. **I1** the two staging URLs (it defeats the runtime-config cache)
10. **I8** Maestro coverage for pooling
11. **I10** stop committing artefacts

---

**Sources (all re-verified at commit `505de9a`):**
`apps/api/src/routes/events.ts:143` *(still no `requireEventAccess` — confirmed by grep)* ·
`apps/api/src/config/websocket.ts:19-49` · `apps/api/src/config/firebase.ts` *(2 silent
fallback sites)* · `apps/api/src/index.ts:36` *(`app.use(cors())`)* ·
`apps/api/src/services/auth.service.ts` *(OTP `123456` still present)* ·
`apps/api/src/services/settlement.service.ts` · `apps/api/src/utils/firestore-merge.ts` ·
`apps/mobile/scripts/build-android.sh` · `apps/mobile/scripts/build-ios.sh` ·
`apps/mobile/scripts/version.mts` · `apps/mobile/release-versions.json` ·
`apps/mobile/eas.json` · `apps/mobile/package.json` ·
`apps/mobile/src/config/env.ts:41` *(`APP_VERSION` now from `app.json`)* ·
`apps/mobile/src/config/runtime.ts:49-56` ·
`libraries/shared/src/pool-ui.ts` *(`CONTRIBUTOR_POOLS_IN_PRODUCTION`)* ·
`libraries/shared/src/index.ts` *(`hasActivePro`)* ·
`scripts/revenuecat/load-rc-config.sh` *(`prod → production` normalisation)* ·
`rc_{local,staging,production}.properties` · `firestore.indexes.json` ·
`common/config/rush/command-line.json` · `e2e/playwright.config.ts` ·
`.github/workflows/ci.yml` ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` §0 ("Not done") ·
`traxettle-app/docs/utility/ENVIRONMENT_SETUP.md` ·
`traxettle-app/docs/runbook/LOCAL_DEVELOPMENT.md` ·
live probes of the staging and production APIs *(staging pooling: **401 — deployed**)*
