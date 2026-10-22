# Change Playbooks

*"I need to do X"* → the files to touch, in order. Written for both humans and coding agents.

**Before any of these:**

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
```

**After any of these:**

```bash
(cd apps/api && npx tsc --noEmit) && (cd apps/web && npx tsc --noEmit) && (cd apps/mobile && npx tsc --noEmit)
(cd libraries/shared && npm test) && (cd apps/api && npm test) && (cd apps/web && npm test)
```

---

## Playbook 1 — Add a field to an existing entity

Example: adding `category` to `Expense`.

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/index.ts` | Add the field to the interface, **optional**. Add it to the relevant `Create*Dto` / `Update*Dto` |
| 2 | — | Rebuild shared (`rush build --to @traxettle/shared`) |
| 3 | `apps/api/src/services/<domain>.service.ts` | Persist and map it. Add a default in the `mapX` function if one is needed |
| 4 | `apps/api/src/routes/<domain>.ts` | Accept it on create/update; validate it |
| 5 | `apps/web/src/app/.../create/page.tsx` + `edit/page.tsx` | Add the form control |
| 6 | `apps/mobile/src/screens/Create<X>Screen.tsx` + `Edit<X>Screen.tsx` | Same |
| 7 | Read surfaces | Display it (web event page, mobile detail screen) |
| 8 | `apps/api/src/__tests__/routes/<domain>.test.ts` | Round-trip test, **plus a test that an absent field behaves as before** |
| 9 | `traxettle-app/docs/app/Functional.md` | Flip the ❌ to ✅ |
| 10 | This KB | `02-architecture/01-data-model.md`, `01-product/02-capability-matrix.md` |

**Rules:** optional, never backfilled, absent reads as the old behaviour. If it is money in
the pool ledger, it is an **integer minor-unit** field suffixed `Minor`.

---

## Playbook 2 — Add an API endpoint

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/index.ts` | Request/response types if they are shared |
| 2 | `apps/api/src/validation/<domain>.schemas.ts` | A zod schema — `.strict()`, cap arrays and strings. **Mandatory for anything touching money** |
| 3 | `apps/api/src/services/<domain>.service.ts` | The logic. Throw a typed error (`PoolError` etc.) with a `code` and structured `data` |
| 4 | `apps/api/src/routes/<domain>.ts` | Register the route: `requireAuth` → `requireEventAccess` → `requireEditableEvent` → `parse(schema, …)` → service → emit → `{ success, data }`. Map errors in the existing `fail()` |
| 5 | `apps/api/src/config/websocket.ts` | Add the event name to `WsEventType` if you emit something new |
| 6 | `apps/web/src/utils/<domain>-api.ts` | A client method |
| 7 | `apps/mobile/src/services/<domain>.ts` | The mirroring client method |
| 8 | Both `useSocket.ts` | Subscribe to any new event |
| 9 | `apps/api/src/__tests__/routes/<domain>.test.ts` | Happy path, every refusal (assert `code` **and** `data`), and access control |
| 10 | This KB | `02-architecture/02-api-reference.md`, and `08-realtime.md` if you added an event |

Mounting a **new router** also needs `apps/api/src/index.ts`
(`app.use('/api/<x>', xRoutes)`).

---

## Playbook 3 — Add a pool preset

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/pool.ts` | Add to the `PoolPreset` union; add the policy row to `POOL_PRESETS`; add `POOL_PRESET_LABELS` (title + tagline) and `POOL_NOUN` |
| 2 | `libraries/shared/src/pool-ui.ts` | Add to `CONTRIBUTOR_PRESETS` if contributor-funded; check `needsTarget()`; verify `withPreset()` resets the advanced defaults correctly |
| 3 | `apps/api/src/validation/pool.schemas.ts` | Add to `presetSchema` |
| 4 | `libraries/shared/src/__tests__/pool.test.ts` | Assert the preset's policy matrix |
| 5 | `libraries/shared/src/__tests__/pool-math.test.ts` | If it introduces a new surplus/deficit/overdraft combination, test the reconciliation and the overdraft behaviour |
| 6 | `apps/web/src/components/pool/FundingStep.tsx` | The preset card |
| 7 | `apps/mobile/src/components/pool/PoolViews.tsx` | The preset card |
| 8 | `apps/api/src/__tests__/routes/pools.flows.test.ts` | An end-to-end flow for the new use case |
| 9 | This KB | `01-product/04-money-pooling-functional.md` (table + "what it's for"), `02-architecture/03-money-pooling-engine.md` (policy matrix), `03-operations/03-staging-test-scenarios.md` (a scenario) |

Ask first whether a new preset is needed at all, or whether an existing preset plus
`overrides` covers it. The presets exist so users never see `surplusPolicy`; adding one is a
product decision, not just a config addition.

---

## Playbook 4 — Add a pool policy or change the overdraft maths

⚠️ **The highest-risk change in the codebase.** This is a financial ledger.

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/pool.ts` | Add the policy value to its union and to `PoolConfig` |
| 2 | `libraries/shared/src/pool-math.ts` | Implement it. If it is a share basis, extend `basisFor()` and `reconcileCycle()`. If it is an overdraft rule, extend `computeOverdraftState()` / `evaluateDraw()` / `nextOverdraftLatch()` |
| 3 | `libraries/shared/src/__tests__/pool-math.test.ts` | Unit cases **and** a randomised invariant check that `Σnet === closingBalance` still holds |
| 4 | `apps/api/src/validation/pool.schemas.ts` | Add to the enum in `poolConfigPatchSchema` |
| 5 | `apps/api/src/services/pool.service.ts` | Only if persistence or orchestration changes — the maths should stay in the shared library |
| 6 | `libraries/shared/src/pool-ui.ts` | Refusal copy, meter caption, zone tone if the user-visible behaviour changes |
| 7 | `apps/api/src/__tests__/routes/pools.flows.test.ts` | A flow exercising it |
| 8 | This KB | `02-architecture/03-money-pooling-engine.md` **and** `01-product/04-money-pooling-functional.md` |

**Guard rails:**

- The invariant `Σ entityShares.netMinor === closingBalanceMinor` is **asserted at runtime**
  and throws. If your change makes it throw, your change is wrong.
- Keep the pre-authorised vs already-incurred asymmetry: pre-authorised draws are refused,
  already-spent money is recorded and flagged.
- Never make the balance a stored running total.
- `allocateMinor` must keep summing to exactly the total.

---

## Playbook 5 — Add a screen / page

### Web

| # | File |
|---|---|
| 1 | `apps/web/src/app/<route>/page.tsx` |
| 2 | Navigation entry in `apps/web/src/components/WebAppShell.tsx` |
| 3 | Feature components in `apps/web/src/components/<feature>/`, primitives from `@traxettle/ui` |
| 4 | `data-testid` on every interactive element |
| 5 | A test in `apps/web/src/__tests__/` (coverage thresholds will insist for pool components) |
| 6 | An `e2e/tests/*.spec.ts` journey if it is user-facing |
| 7 | This KB: `02-architecture/04-web-codemap.md` |

### Mobile

| # | File |
|---|---|
| 1 | `apps/mobile/src/screens/<Name>Screen.tsx` |
| 2 | Register in `apps/mobile/src/App.tsx` (`<Stack.Screen name=… />`), choosing `card`/`modal` presentation per the existing pattern |
| 3 | Navigation entry point from wherever it is reached |
| 4 | `testID` mirroring the web's `data-testid` names where surfaces correspond |
| 5 | A test in `apps/mobile/src/__tests__/` |
| 6 | A Maestro flow in `apps/mobile/maestro/flows/` if it is a key journey |
| 7 | This KB: `02-architecture/05-mobile-codemap.md` |

---

## Playbook 6 — Add a Pro-gated capability

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/index.ts` | Add the flag to `UserCapabilities` |
| 2 | `apps/api/src/services/entitlement.service.ts` | Derive it in `computeCapabilities()`; add a code to `PRO_FEATURE_CODES` |
| 3 | The route that gates it | `await entitlementService.assertCapability(uid, '<capability>')` |
| 4 | Clients | Read `profile.capabilities.<flag>`; route to the Pro screen on `403 FEATURE_REQUIRES_PRO` |
| 5 | `apps/api/src/__tests__/services/entitlement.service.test.ts` + a route gating test | Free refused with the right `code`/`feature`; Pro allowed |
| 6 | `e2e/tests/tier-entitlements.spec.ts` | Browser-level check |
| 7 | This KB | `01-product/05-plans-entitlements-billing.md`, `01-product/02-capability-matrix.md` |

Capabilities are granted only for `tier === 'pro'` **and** status `active` or `grace_period`.
Never check `tier` directly at a call site — always go through a capability.

---

## Playbook 7 — Add a real-time event

| # | File |
|---|---|
| 1 | `apps/api/src/config/websocket.ts` — add to `WsEventType` |
| 2 | Emit from the service/route with `emitToEvent` / `emitToUser` |
| 3 | `apps/web/src/hooks/useSocket.ts` — subscribe |
| 4 | `apps/mobile/src/hooks/useSocket.ts` — subscribe |
| 5 | `apps/api/src/__tests__/config/websocket.test.ts` and/or the route test |
| 6 | This KB: `02-architecture/08-realtime.md` |

Prefer `{ reason }` over full state. Treat it as an invalidation signal on the client.

---

## Playbook 8 — Add a new Firestore collection

| # | File | Action |
|---|---|---|
| 1 | `libraries/shared/src/<domain>.ts` | The document type |
| 2 | `apps/api/src/services/<domain>.service.ts` | A module constant for the name, a `mapX(id, data)` mapper, and the CRUD |
| 3 | `firestore.rules` | **Leave it denied to clients.** The API uses the Admin SDK |
| 4 | `firestore.indexes.json` | Only if you need a composite query — the file is currently `{}` and every query is single-field. Prefer keeping it that way |
| 5 | `apps/api/src/__tests__/helpers/memoryFirestore.ts` | Usually works unchanged; extend only if you use an unsupported operation |
| 6 | This KB | `02-architecture/01-data-model.md` |

Decide subcollection vs top-level deliberately: participants are a subcollection because
membership checks are then a single document read; expenses/settlements/pool documents are
top-level because they are queried by `eventId`.

---

## Playbook 9 — Fix a bug

1. **Reproduce it.** Prefer a failing test:
   - pure maths → `libraries/shared/src/__tests__/pool-math.test.ts`
   - API behaviour → `apps/api/src/__tests__/routes/…` with `memoryFirestore` + `poolHarness`
   - live pooling → `node scripts/local-dev/pool-smoke.mjs`
2. **Trace the path** using the code maps in `02-architecture/`.
3. **Add targeted logging** if needed — the codebase uses prefixed `console.log`
   (`[RuntimeConfig]`, `[DevOptions]`, `[api]`, `[local-dev]`). Follow that and remove the
   temporary ones.
4. **Find the root cause**, not the symptom. For money bugs, check which side of the
   confirmed/expected and approved/pending distinctions you are on.
5. **Fix, then confirm the test passes** and the invariant assertions do not throw.
6. **Check the regression direction:** does a split-expenses event still behave identically?
7. Update `traxettle-app/docs/app/Functional.md` if behaviour changed, and this KB.

---

## Playbook 10 — Change environment configuration

| Need | Touch |
|---|---|
| A new API env var | `.env.example`, consume it in the API, add it to `scripts/api-deployment/deploy-{staging,prod}.sh`, document it in `03-operations/00-environments.md` §5 |
| A new client-visible value | Prefer adding it to `GET /api/config` (`apps/api/src/index.ts`) plus `RuntimeConfig` in `apps/mobile/src/config/runtime.ts`, so it is runtime- not build-time |
| A new mobile build-time var | `apps/mobile/src/config/env.ts`, both `scripts/build-{android,ios}.sh` (the `.env` writer), and `eas.json` |
| A new per-environment secret file | `.gitignore`, `scripts/local-dev/bootstrap.sh`, and `03-operations/00-environments.md` §4 |

Runtime config beats build-time config: it is what lets one mobile bundle serve staging and
production.

---

## Playbook 11 — Add a dependency

```bash
cd apps/<app>              # or libraries/<lib>
npm install <pkg>          # then:
cd ../.. && node common/scripts/install-run-rush.js update
```

- Check it is not already present (the pooling feature found `expo-image-picker` and
  `expo-file-system` already there).
- Prefer a version published **≥7 days ago**. No `latest`, `*`, or unbounded `>=`.
- Mobile native modules need a rebuild (`npx expo run:ios|android`), and possibly
  `pod install`.
- Never weaken a security control to make a build pass — escalate instead.

---

## Playbook 12 — Investigate "what happened to this money?"

| Question | Where to look |
|---|---|
| Why is the balance this number? | `GET /api/pools/event/:id/summary` → `totals`. Balance = opening + confirmedRegular + confirmedTopUp + overdraftCover − poolSpend − reimbursements |
| Why is spending blocked? | `summary.overdraft` → `baselineMinor`, `toleranceMinor`, `floorMinor`, `latched`, `clearanceThresholdMinor`. A latched pool needs the balance **above** the clearance threshold |
| Who hasn't paid? | `summary.arrears`, and `ledger.contributions` statuses |
| What moved the balance? | `GET /api/pools/event/:id/ledger` → `entries`, each with `counted` and `status` |
| Why does X owe this much? | The cycle's `reconciliation.entityShares` → `netMinor = opening + contributed − fairShare + cover`. Check `shareBasis` and `commitmentMinor` — shares are weighted by **agreed commitment**, not by what was paid |
| Where did the deficit go? | A `confirmed` contribution of kind `overdraft_cover` |
| Why is there an extra cycle? | `cycle.closeReason` — `membership_change` forces a boundary once money has moved |
| Why wasn't a draw deducted? | `expense.poolDraw.status` must be `approved` |
| Why no reimbursement leg? | `poolDraw.selfReimbursed` — the custodian claimed from themselves |

---

## Playbook 13 — Update this knowledgebase

```bash
# 1. What is stale?
node /Users/vkarkhanis/workspace/Knowledgebase/Traxettle/.devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs

# 2. Fix the reported documents, then re-pin:
node .../check-staleness.mjs --update
```

Or invoke the skill: `traxettle-kb-refresh`.

Rules: cite file paths for technical claims; keep `01-product/` readable without code; record
real defects in `02-known-issues-and-debt.md` rather than smoothing them over; keep
`INDEX.md` answerable.

---

**Sources:** the whole `traxettle-rush/` tree, in particular
`apps/api/src/routes/pools.ts` (the reference route file),
`libraries/shared/src/pool-math.ts` (the reference pure module),
`apps/api/src/services/entitlement.service.ts`,
`apps/api/src/config/websocket.ts`, `apps/mobile/src/App.tsx`,
`scripts/api-deployment/*`, `.github/workflows/ci.yml`
