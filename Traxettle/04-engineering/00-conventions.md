# Codebase Conventions

What this codebase actually does, not what a style guide says. Match these patterns or your
change will stand out.

---

## 1. Language & general style

- **TypeScript everywhere**, strict-ish. No `.js` source except `index.js` entry points and
  a few Node scripts (`doctor.js`, `scripts/*.js`, `scripts/local-dev/pool-smoke.mjs`).
- **Compact code is preferred.** The pool implementation is dense on purpose: 1,547 lines of
  service covering six use cases. Collapse duplicate branches, share abstractions, avoid
  nesting.
- **Comments explain *why*, never *what*.** The pool modules are the model:

  ```ts
  /**
   * Pre-flight check for a pool draw.
   *
   * Pre-authorised draws ("about to spend from the pool") are refused past the
   * limit. Money that has ALREADY left someone's account is always recorded and
   * flagged instead — an accurate ledger beats an enforced one.
   */
  ```

  Every non-obvious decision carries its rationale inline. Follow that.
- **Do not add or remove comments gratuitously.** If you delete one by accident, put it back.
- **Error handling at boundaries, not per line.** Routes have one `try/catch` that maps error
  classes to HTTP responses; services throw typed errors.
- **Section banners** are used in long files:

  ```ts
  // ── Overdraft ─────────────────────────────────────────────────────────────
  ```

---

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| Types / interfaces / classes | `PascalCase` | `PoolCycleSummary`, `SettlementService` |
| Functions / variables | `camelCase` | `computeOverdraftState`, `fundingSource` |
| Constants | `SCREAMING_SNAKE_CASE` | `POOL_PRESETS`, `DEFAULT_FUNDING_MODEL`, `MAX_RECEIPT_BYTES` |
| Enum-like unions | lowercase snake values | `'refund_pro_rata'`, `'pool_reimbursement'` |
| **Integer minor-unit fields** | **always suffixed `Minor`** | `expectedMinor`, `balanceMinor`, `targetAmountMinor` |
| Files — API services | `<domain>.service.ts` | `pool.service.ts` |
| Files — API routes | `<plural>.ts`, exported as `<domain>Routes` | `pools.ts` → `poolRoutes` |
| Files — React components | `PascalCase.tsx` | `PoolTab.tsx` |
| Files — hooks | `useX.ts` | `useSocket.ts` |
| Test ids | `kebab-case`, scoped by feature | `pool-add-money`, `tab-expenses`, `funding-pool` |
| Socket events | `domain:action` | `pool:updated`, `settlement:generated` |
| Error codes | `SCREAMING_SNAKE_CASE` | `POOL_OVERDRAFT_BLOCKED`, `FEATURE_REQUIRES_PRO` |

The `Minor` suffix is not cosmetic. The design doc says it explicitly: *"Integer minor units
are explicit: `targetAmountMinor`, `expectedMinor`, `receivedMinor`… Makes the unit impossible
to misread."*

---

## 3. The optional-field doctrine

**The single most important convention in this codebase.**

```ts
const model  = event.fundingModel   ?? 'peer_to_peer';
const source = expense.fundingSource ?? 'self';
```

- Every new field on an existing entity is **optional**.
- An **absent** field must read as the current behaviour.
- **Never backfill.** Never write `fundingModel: 'peer_to_peer'` on a peer-to-peer event.
- Provide a resolver helper rather than scattering `??` everywhere:
  `resolveFundingModel()`, `resolveFundingSource()`.

This is why the pooling feature needed no migration and cannot break a single existing
document.

---

## 4. Money

| Rule | |
|---|---|
| Pool amounts are **integer minor units**, always | `expectedMinor`, `balanceMinor`, … |
| Convert only at the presentation boundary | `toMinor()` / `fromMinor()` |
| Never `Math.round(x * 100) / 100` in new pool code | that is the legacy float pattern the pool ledger exists to avoid |
| Splitting an integer across parties | `allocateMinor()` — guarantees the parts sum to the total |
| Zero-decimal currencies are real | `currencyExponent()` handles JPY et al. |
| Balances are **derived, never stored** | recompute from confirmed contributions and recorded spend |

Core `Expense.amount` and `Settlement.amount` remain float major units for backward
compatibility. Do not "fix" that without a migration plan; convert on read into the pool
ledger, which is what `toDrawLike()` does.

---

## 5. API conventions

### Response shape

Always `ApiResponse<T>`:

```ts
res.json({ success: true, data } as ApiResponse);
res.status(400).json({ success: false, error: 'message', code: 'SOME_CODE', data } as ApiResponse);
```

Never return a bare array or object.

### Route structure

Routes are **thin**. `apps/api/src/routes/pools.ts` is the reference implementation at 262
lines for 12 endpoints:

```ts
const router: Router = Router();
const poolService = new PoolService();

function parse<T>(schema: ZodSchema<T>, body: unknown, res: Response): T | null { /* 400 on failure */ }
function fail(res: Response, err: any, label: string) { /* map error classes → HTTP */ }

router.post('/event/:eventId/close', requireAuth, async (req: AuthenticatedRequest, res) => {
  const body = parse(closeSchema, req.body, res);
  if (!body) return;
  try {
    await requireEventAccess(req.params.eventId, req.user!.uid);
    const result = await poolService.closeCycle(req.params.eventId, req.user!.uid, {...}, planner);
    announce(req.params.eventId, 'cycle_closed', { cycleId: result.closed.id });
    return res.json({ success: true, data: result } as ApiResponse);
  } catch (err) {
    return fail(res, err, 'POST /pools/event/:eventId/close');
  }
});
```

Note the patterns worth copying:

- a local `parse()` helper so every handler is two lines of validation
- a single `fail()` that maps `PoolError` / `EventAccessError` / `Forbidden…` to status codes
  and logs the rest
- a local `announce()` closure for the repeated socket emit
- **higher-order route registration** for families of near-identical endpoints:

  ```ts
  const contributionAction = (path, schema, run) =>
    router.post(`/contributions/:contributionId/${path}`, requireAuth, async (req, res) => { ... });

  contributionAction('mark-paid', markPaidSchema, (id, uid, b) => poolService.markContributionPaid(id, uid, b));
  contributionAction('confirm',   confirmSchema,  (id, uid, b) => poolService.confirmContribution(id, uid, b));
  contributionAction('reject',    reasonSchema,   (id, uid, b) => poolService.rejectContribution(id, uid, b.reason));
  contributionAction('waive',     reasonSchema,   (id, uid, b) => poolService.waiveContribution(id, uid, b.reason));
  ```

### Middleware order

```
requireAuth → requireEventAccess → requireEditableEvent → assertCapability → zod parse → service
```

### Typed errors

```ts
export class PoolError extends Error {
  constructor(public statusCode: number, message: string, public code?: string, public data?: unknown) { ... }
}
export class EventAccessError extends Error {
  constructor(public readonly statusCode: 403 | 404, message: string) { ... }
}
export class UploadError extends Error { constructor(public readonly statusCode: number, message: string) { ... } }
```

Throw a typed error from the service; map it once in the route. Carry a `code` and structured
`data` whenever a client must render something specific.

### Validation

**New pool-adjacent writes must be zod-validated.** The reasoning from the design doc: *"Pool
endpoints do money-in/money-out arithmetic against a shared ledger; a malformed payload here
corrupts other people's financial records, not just the sender's."*

Schemas are `.strict()` (unknown keys rejected), arrays are capped, strings are capped.
Non-pool routes still hand-validate — follow the file you are in, but prefer zod for anything
new that touches money.

---

## 6. Service conventions

- A class per domain, instantiated at module scope in the route file.
- Collection names as module constants: `const CYCLES = 'poolCycles';`
- Firestore documents mapped through an explicit `mapX(id, data)` function, so field
  normalisation and defaults live in one place.
- `private` helpers for internal invariants (`requireManager`, `assertCycleWritable`,
  `assertEventEditable`).
- Avoid refetching: `buildSummary()` returns the summary **plus** `_draws`,
  `_contributions`, `_groups` so callers can reuse them. The underscore prefix marks them as
  internal and they are destructured away in `getSummary()`.
- Dependency injection by parameter, not by container — e.g. the settlement planner is passed
  into `closeCycle(..., planner)`.

---

## 7. Shared-library conventions

- `libraries/shared` is **pure**: no I/O, no React, no `react-native`, no `process.env`.
- If the API and a client must agree on a number or a string, it belongs here. That is why
  `pool-ui.ts` holds the refusal copy and the receipt rule — both clients render identical
  text, and `isReceiptRequired()` mirrors the server rule exactly.
- Adding an export changes the `index.test.ts` snapshot. That is deliberate: it forces
  API-surface changes to be visible in review.
- **Rebuild after changing it** — apps consume `dist/`.

---

## 8. Client conventions

### Both clients

- Shared types and maths from `@traxettle/shared`. **Never re-derive a balance, a headroom, a
  caption, or a validation rule in a client.**
- A thin per-domain API module mirroring the endpoints (`utils/pool-api.ts` on web,
  `services/pool.ts` on mobile) — note how closely they mirror each other, which is
  intentional.
- Errors are typed with `status`, `code`, `data` so `poolErrorText(err, currency)` can render
  the right message.
- Treat socket events as **invalidation signals**: refetch rather than patching local state
  from a partial payload.

### Web

- Next.js App Router, one `page.tsx` per route.
- styled-components with transient props (`$variant`, `$size`, `$active`, `$tone`).
- Primitives from `@traxettle/ui`; feature components local to `src/components/`.
- **No browser `alert()` or `confirm()` anywhere.** Use `Modal` + the toast provider.
- `data-testid` on anything a test or a human needs to find.

### Mobile

- React Navigation native stack; one screen component per route.
- `styled-components/native` plus `theme.ts` tokens.
- `testID` mirroring the web's `data-testid` names where the surfaces correspond
  (`pool-add-money` exists on both) — this is what makes the test scenarios platform-agnostic.
- AsyncStorage keys are prefixed `@traxettle_`.
- `EXPO_PUBLIC_*` env vars are inlined at bundle time; anything that must vary at runtime goes
  through `/api/config`.

---

## 9. Real-time conventions

- Event names are `domain:action`, declared in the closed `WsEventType` union.
- `emitToEvent` / `emitToUser` are no-ops when uninitialised, so services emit freely in tests.
- Payloads are decorated with `eventId`/`userId` and a `timestamp` automatically.
- Prefer *"something changed, here is the reason"* over shipping full state —
  `pool:updated { reason }` is the pattern.

---

## 10. Testing conventions

- Co-located under `src/__tests__/` mirroring the source tree.
- API route tests use Supertest + `__tests__/helpers/memoryFirestore.ts`. **Do not hand-mock
  `firebase-admin`.**
- Pool fixtures come from `__tests__/helpers/poolHarness.ts`.
- Pure maths is tested without mocks, including **randomised invariant checks**.
- Assert refusals by `code` **and** the structured `data` fields a client needs.
- Always include the regression direction: *"a split-expenses event is unaffected."*

---

## 11. Dependencies

- Added via the package manager, never by hand-editing a manifest.
- Prefer a version published **at least 7 days ago**; avoid `latest`, `*` and unbounded `>=`.
- Check whether the library is already present before adding it — the pooling feature needed
  camera and file access and found `expo-image-picker` / `expo-file-system` already there.
- `zod` was a declared-but-unused dependency until pooling gave it a purpose. Look for that
  kind of thing.
- Never weaken a security control (`minimumReleaseAge`, branch protection, `.npmrc`) to make a
  build pass.

---

## 12. Git conventions

Observed history on this repo:

```
feat: money pooling
feat(TA-8): added support for razor pay but hidden
fix(TA-9): unify google secrets
chore(TA-5): updated test cases
TA-4: handled auth expiry properly
```

- Conventional-ish prefixes: `feat`, `fix`, `chore`.
- A ticket id in scope where one exists: `feat(TA-11): add expense date`.
- Branch naming: `feature/<slug>`, `bugfix/TA-n-<slug>`, `TA-n-<slug>`, `fix/TA-n-<slug>`.
- Flow: feature branch → PR to `stage` → PR to `main`.
- CI runs on pushes to `main` and PRs to `main`/`stage`.
- **Never commit** `.env*`, keystores, `fb-service-accounts/`, `google-services*.json`,
  `GoogleService-Info*.plist`, `rc_*.properties`, or the generated
  `apps/mobile/src/config/buildEnv.ts`. Run `git status` after any mobile build — the scripts
  write and then restore these, but a crashed build can leave one behind.

---

## 13. Documentation conventions

- Repo docs live under `traxettle-app/docs/` in four buckets: `app/`, `deployment/`,
  `runbook/`, `utility/`.
- Functional changes update `traxettle-app/docs/app/Functional.md` with a ✅/🚧/❌ status.
- A significant feature gets a design doc in `utility/` and a testing runbook in `runbook/`.
- This knowledgebase is the organised, agent-consumable layer over those. If you change
  behaviour, update **both**, and run the staleness check:

  ```bash
  node /Users/vkarkhanis/workspace/Knowledgebase/Traxettle/.devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs
  ```

- Do **not** create new ad-hoc markdown files to describe a change. Update the existing docs.

---

**Sources:** `apps/api/src/routes/pools.ts` · `apps/api/src/services/pool.service.ts` ·
`libraries/shared/src/{pool,pool-math,pool-ui}.ts` ·
`apps/api/src/validation/pool.schemas.ts` · `apps/web/src/components/pool/*` ·
`apps/mobile/src/{api.ts,services/pool.ts}` · `.eslintrc.json` · `.gitignore` ·
`git log` · `traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md`
