# Money Pooling — Engine Internals

The maths and the enforcement. Functional view:
[`../01-product/04-money-pooling-functional.md`](../01-product/04-money-pooling-functional.md).

| File | Lines | Role |
|---|---|---|
| `libraries/shared/src/pool.ts` | 512 | Types, presets, funding-model helpers, minor-unit conversion |
| `libraries/shared/src/pool-math.ts` | 531 | **Pure** ledger maths — no I/O. Shared by API (authoritative) and clients (rendering) |
| `libraries/shared/src/pool-ui.ts` | 270 | Platform-agnostic presentation: formatting, refusal copy, receipt rule, meter geometry, create-event funding choice |
| `apps/api/src/services/pool.service.ts` | 1547 | All persistence and orchestration |
| `apps/api/src/validation/pool.schemas.ts` | 84 | zod schemas for every pool write |
| `apps/api/src/routes/pools.ts` | 262 | Thin HTTP layer |

Tests: `libraries/shared/src/__tests__/pool-math.test.ts` (700 lines, incl. randomised
invariant checks), `pool.test.ts`, `pool-ui.test.ts`;
`apps/api/src/__tests__/routes/pools.flows.test.ts` (794), `pools.recurring.test.ts` (307),
`services/pool.service.test.ts` (284), with harnesses
`__tests__/helpers/{memoryFirestore,poolHarness}.ts`.

---

## 1. Money & allocation

### Minor units

```ts
currencyExponent(currency) // 0 for JPY KRW VND CLP ISK UGX XAF XOF, else 2
toMinor(amount, currency)  // major → minor, half away from zero
fromMinor(minor, currency) // minor → major
```

`toMinor` guards against the classic float trap:

```ts
const scaled = Number((Math.abs(amount) * factor).toPrecision(15));
const rounded = Math.round(scaled);
return amount < 0 && rounded !== 0 ? -rounded : rounded;
```

`toPrecision(15)` is what makes `toMinor(1.005, 'USD') === 101` instead of `100`.

### `allocateMinor(total, weights)` — largest remainder

Splits an integer `total` across weights so the parts sum to `total` **exactly**.

```ts
allocateMinor(total: number, weights: Array<{ key: string; weight: number }>): Record<string, number>
```

Properties that matter:

- Non-integer `total` **throws** — the whole point is integer arithmetic.
- Duplicate keys are merged; non-finite or non-positive weights become 0.
- **If every weight is zero, the total is split equally.** This is what makes a cycle where
  nobody has committed anything still reconcile.
- Fractional weights are scaled by `1e6` and the arithmetic is done in `BigInt`, so there is
  no intermediate precision loss.
- Remainders are distributed by **largest remainder**, ties broken by lexically-first key →
  **deterministic**. The same inputs always produce the same output, which is why the
  randomised invariant tests are meaningful.
- Negative totals split symmetrically.
- Allocating a non-zero total across zero entities throws.

---

## 2. Derived totals

`computeCycleTotals({ openingBalanceMinor, contributions, draws })` → `PoolCycleTotals`:

```
expectedRegularMinor   = Σ expectedMinor  of regular, non-waived contributions
confirmedRegularMinor  = Σ receivedMinor  of regular contributions
confirmedTopUpMinor    = Σ receivedMinor  of top_up contributions
overdraftCoverMinor    = Σ receivedMinor  of overdraft_cover contributions
poolSpendMinor         = Σ amountMinor    of APPROVED draws with fundingSource 'pool'
reimbursementsMinor    = Σ amountMinor    of APPROVED draws with 'pool_reimbursement'
pendingDrawsMinor      = Σ amountMinor    of PENDING draws        (informational only)

balanceMinor = opening + confirmedRegular + confirmedTopUp + overdraftCover
                       − poolSpend − reimbursements
```

Three things to internalise:

1. **Only `received` money counts**, never `expected`. A member marking themselves paid
   does not move the balance; the custodian confirming does.
2. **Only `approved` draws deduct.** Pending draws are surfaced separately so a custodian
   can see what is queued, but they do not reduce the balance.
3. **The balance is always recomputed**, never stored. A corrected or deleted expense
   self-heals the ledger.

`computeArrears(contributions)` → outstanding `expectedMinor − receivedMinor` per entity,
regular and non-waived only, sorted by entity key.

`computeFundingState(config, opening, totals)`:

```
fundedMinor = opening + confirmedRegular + confirmedTopUp
targetMinor = config.targetAmountMinor  (if > 0)
            ⟶ else expectedRegularMinor (if > 0)
            ⟶ else null
state = targetMinor === null ? 'open_ended'
      : fundedMinor >= targetMinor ? 'funded' : 'underfunded'
```

Note the fallback: with no explicit target, the sum of agreed contributions becomes the
target, so progress is still meaningful.

---

## 3. Overdraft

### `computeOverdraftState(config, opening, totals, latchedAt)`

```
confirmedFunding = opening + confirmedRegular + confirmedTopUp

baseline B (by config.overdraftBaseline):
  'confirmed_funding' (default) → confirmedFunding
  'expected_funding'            → opening + expectedRegular + confirmedTopUp
  'target_amount'               → config.targetAmountMinor   (if > 0, else falls back)
B = max(0, B)

tolerancePercent      = policy === 'graduated' ? max(0, config.overdraftTolerancePercent ?? 20) : 0
toleranceMinor T      = policy === 'graduated' ? floor(B × tolerancePercent / 100) : 0
floorMinor            = policy === 'allow'  ? −∞
                      : T === 0             ? 0
                      :                       −T
clearanceThresholdMinor = policy === 'graduated' ? floor(B × max(0, clearancePercent ?? 0) / 100) : 0
```

Deliberate choices:

- `floor(...)` on the tolerance — a fractional minor unit of extra headroom is never granted.
- The default baseline is the **prudent** one. If nobody has paid, `B = 0`, so `T = 0`, so
  the floor is `0`, so a `graduated` pool behaves exactly like `block`. The formula degrades
  safely at the edges with no special-casing.
- The floor **moves with the baseline**. More confirmed money means more headroom, so the
  pool heals itself with no manual unblock step. The UI must render this live, not cache it.

### The latch

```ts
latched = policy === 'graduated' &&
          ( balance <= floor ||                                  // reaching the floor latches BY DEFINITION
            (Boolean(latchedAt) && balance <= clearanceThreshold) )  // ...and stays latched during recovery
```

The first disjunct is why behaviour never depends on *when* the flag was written: the
persisted `overdraftLatchedAt` only matters in the recovery window
`floor < balance ≤ clearanceThreshold`.

```ts
nextOverdraftLatch(state, currentlyLatched)
  // non-graduated     → 'release' if currently latched, else 'unchanged'
  // !latched && balance <= floor               → 'latch'
  // latched && balance > clearanceThreshold    → 'release'
  // otherwise                                  → 'unchanged'
```

Persisted by `PoolService.refreshOverdraftLatch(eventId, cycleId)` after any balance move.

**Why a latch at all?** The original design said pre-flight checking was self-latching. It
is not: a ₹500 top-up would unblock a ₹500 spend, and then the cycle repeats. The required
behaviour was *"block until the 20% plus an additional amount is added"*, which needs
hysteresis. `overdraftClearancePercent` defaults to `0`, meaning the whole overdraft must be
repaid **plus more** (`balance > 0`) before pre-authorised draws resume. Raise it to stop
*dribbling*.

### Zone & headroom

| | |
|---|---|
| `zone` | `allow` → `balance > 0 ? healthy : overdrawn`. Else `latched \|\| balance <= floor` → `blocked`. Else `balance > 0 ? healthy : overdrawn` |
| `headroomMinor` | `allow` → `MAX_SAFE_INTEGER`; latched → `0`; else `max(0, balance − floor)` |

### `evaluateDraw(state, amountMinor, opts)` — the pre-flight

```ts
opts: { alreadyIncurred: boolean; funding?: PoolFundingState; requireFullFunding?: boolean }
→ { allowed, warn, flag?, code?, projectedMinor, shortfallMinor, clearanceRequiredMinor }
```

Evaluation order:

1. **Full-funding gate** (`requireFullFundingBeforeSpend` and `funding.state === 'underfunded'`)
   → `POOL_UNDERFUNDED`, shortfall = `target − funded`. If `alreadyIncurred`, allowed and
   flagged `underfunded`.
2. **`allow`** → always allowed; `warn` when projected < 0.
3. **`block`** → allowed iff projected ≥ 0. Otherwise `POOL_INSUFFICIENT_FUNDS`, shortfall =
   `−projected`. If `alreadyIncurred`, allowed, warned, flagged `exceeds_tolerance`.
4. **`graduated`** → allowed iff not latched **and** projected ≥ floor. Otherwise
   `POOL_OVERDRAFT_BLOCKED` with
   `shortfall = max(0, toUnlatch, toClearFloor)` where
   `toUnlatch = clearanceThreshold − balance + 1` (if latched) and
   `toClearFloor = floor − projected`. If `alreadyIncurred`, allowed, warned, flagged
   `exceeds_tolerance`.

The governing principle, stated in the source: *pre-authorised draws ("about to spend from
the pool") are refused past the limit; money that has ALREADY left someone's account is
always recorded and flagged instead — an accurate ledger beats an enforced one.*

### Where it is enforced

| Point | Why |
|---|---|
| `POST /api/expenses` with `fundingSource: 'pool'` | refuse before anything is written |
| `POST /api/pools/expenses/:id/approve` | **approval is what deducts**, so the custodian sees *"approving this pushes the pool ₹3,000 past its limit"* before clicking |
| `PoolService.prepareAmountChange(...)` on expense edit | the same check on a changed amount |

`PoolService.prepareDraw(...)` additionally checks, before the overdraft:

1. the cycle is writable and the event editable
2. the expense currency equals the pool currency (otherwise
   *"Pool expenses must be in the pool currency (INR)"*)
3. the actor may draw — `canDraw`: the custodian, a user in `authorizedSpenders`, or a member
   of a group in `authorizedSpenderGroups`
4. the receipt rule — `receiptRequiredAboveMinor` for pool spends, `claimReceiptRequired`
   for claims (mirrored client-side by `isReceiptRequired()` in `pool-ui.ts`)
5. the spender cap — spend so far (approved **and** pending) for that spender key vs
   `spenderCapsMinor`

---

## 4. Reconciliation

`reconcileCycle(input: ReconcileInput): ReconcileResult`.

### The formula

```
net = openingCredit + contributed − fairShare + cover
```

**Fair shares are weighted by AGREED COMMITMENT, not by what was actually paid.** This is
the single most important decision in the engine, and it changed during implementation.
Weighting by what was paid lets a non-payer escape their share; with commitment weights a
member who paid nothing still bears their full share and correctly ends up owing. Top-ups
count as money in but **do not enlarge a stake**, so they are simply refunded.

### Key set construction

The entity key set is the union of: the roster, everyone with a contribution, everyone with
an opening credit, everyone named in `extraCover`, **everyone who appears in any approved
draw's consumption weights** (so a consumer who never contributed still bears a share and
correctly ends up owing), and the custodian.

### Share basis

`basisFor(policy)` — where `policy` is the **surplus** policy if `preCoverBalance ≥ 0`,
otherwise the **deficit** policy:

| Policy | Basis |
|---|---|
| `refund_equal`, `collect_equal` | `equal` |
| `collect_by_consumption` | `consumption` |
| `retain`, `custodian_absorbs` | `custodian` |
| everything else | `commitment` |

Then:

- **`commitment`** — `allocateMinor(spend, [{key, weight: commitment[key]}])` over the
  roster. Falls back to equal weights if all commitments are zero.
- **`equal`** — weight 1 per roster entity, **excluding fully-waived entities**.
- **`consumption`** — allocates **each approved draw separately** by its own consumption
  weights (derived from that expense's splits), falling back to commitment weights, then to
  equal weights. This is where pool mode and the split engine genuinely interlock: the
  flatmate who was travelling for two weeks really did consume less of the groceries.
- **`custodian`** — everyone else's contributed money is consumed in full
  (`fairShare[k] = contributed[k]`) and the custodian takes whatever is left or short
  (`spend − othersConsumed`). This is what makes a sponsor budget produce no
  inter-participant settlement.

### Balances & disposition

```
openingBalance        = Σ openingCredits
confirmedContributions= Σ received (regular + top_up)
overdraftCover        = Σ received (overdraft_cover) + extraCover
preCoverBalance       = opening + confirmedContributions − spend
closingBalance        = preCoverBalance + overdraftCover
uncoveredDeficit      = max(0, −closingBalance)        // MUST be 0 to close
outcome               = preCover > 0 ? 'surplus' : preCover < 0 ? 'deficit' : 'balanced'
disposition           = (!forDissolution && surplusPolicy === 'carry_forward')
                        ? 'carry_forward' : 'settle'
```

**The invariant is asserted, not assumed:**

```ts
if (netSum !== closingBalanceMinor) {
  throw new Error(`reconcileCycle invariant violated: Σnet ${netSum} ≠ closing ${closingBalanceMinor}`);
}
```

### Producing settlement balances

When `disposition === 'settle'`:

```ts
settlementBalances[entityKey] = entityShare.netMinor;
// the custodian holds the remaining cash and pays it out:
settlementBalances[custodianKey] -= closingBalanceMinor;
// zero entries are deleted
```

The result **sums to zero**, which is exactly what the greedy planner needs.
`PoolService.toBalances(settlementBalances, currency)` converts it to `Balance[]`, and from
there `SettlementService.calculateSettlementPlan()` — unchanged, already tested — produces
the minimal set of legs.

> No new settlement algorithm. No new payment rails. No new payment UI.

### Overdraft cover attribution

A negative closing balance means **someone's real money covered the gap** — normally the
custodian's card. If that is not recorded, reconciliation charges them a share of spend they
personally financed. So at close a negative balance prompts *"the pool closed ₹6,600 short —
who covered it?"* (default: custodian, re-attributable or splittable), creating a
`confirmed` contribution of kind `overdraft_cover`. Then everything follows automatically:
the cover absorbs into the closing balance, the ledger invariants hold, the coverer's
`coverMinor` counts, and they come out with `net > 0` — owed a refund for whatever they
fronted beyond their fair share. **No special case in the settlement path.**

`PoolService.normalizeCover(...)` defaults the cover to the custodian when the client
supplies none.

### Membership changes

```ts
splitForMembershipChange(result, leavingKeys, custodianEntityKey)
  → { carryCredits, carryOpeningBalanceMinor, exitBalances }
```

A member leaving a carry-forward pool must be squared up **now** — their credit cannot roll
into a cycle they are not part of. Leavers' net positions go into `exitBalances` (balanced
against the custodian); everyone else's go into `carryCredits` for the continuing cycle.

**The custodian cannot leave** — the function throws
*"The custodian cannot leave the pool. Assign a new custodian first."*

`PoolService.onMembershipChanged(...)` decides whether a change even forces a boundary:
only when `membershipChangeClosesCycle` **and** money has actually moved. In an untouched
cycle the roster simply updates — no empty cycles while flatmates trickle in. In
single-cycle pools the roster only ever grows, so a kitty leaver who already consumed is
not retroactively refunded.

---

## 5. Presets as a policy matrix

`POOL_PRESETS` in `pool.ts`. `GRADUATED` is the shared default
`{ overdraftPolicy: 'graduated', overdraftTolerancePercent: 20, overdraftBaseline: 'confirmed_funding', overdraftClearancePercent: 0 }`.

| | `trip_kitty` | `household` | `club_treasury` | `sponsor_budget` | `target_collection` |
|---|---|---|---|---|---|
| `funderMode` | contributors | contributors | contributors | **sponsor** | contributors |
| `cycleMode` | single | recurring | recurring | single | single |
| `recurrence` | — | monthly | monthly | — | — |
| `surplusPolicy` | refund_pro_rata | carry_forward | carry_forward | **retain** | refund_pro_rata |
| `deficitPolicy` | collect_pro_rata | collect_pro_rata | collect_pro_rata | **custodian_absorbs** | collect_pro_rata |
| `overdraftPolicy` | graduated 20% | graduated 20% | graduated 20% | graduated 20% | **block**, baseline `target_amount` |
| `requireFullFundingBeforeSpend` | — | — | — | — | **true** |
| `receiptRequiredAboveMinor` | null | null | null | **0 (always)** | null |
| `claimReceiptRequired` | false | true | true | true | false |
| `expenseApproval` | none | none | none | **always** | none |
| `membershipChangeClosesCycle` | false | **true** | false | false | false |

Two notes on intent:

- `club_treasury` uses `collect_pro_rata`, **not** `collect_equal` as originally proposed.
  Dues are tiered, so a shortfall should be shared by tier (commitment), not head-count.
- `target_collection` is the only `block` preset, because the whole point is *"don't commit
  until the money is in"*.

`buildPoolConfig(preset, custodianUserId, extras, overrides)` composes the final config.

---

## 6. Funding-model & approval helpers

```ts
resolveFundingModel(event)   // event.fundingModel ?? 'peer_to_peer'
resolveFundingSource(expense)// expense.fundingSource ?? 'self'
isPoolFundedEvent(event)     // model is 'pool' or 'hybrid'
isPoolFundedExpense(expense) // source is 'pool' or 'pool_reimbursement'
allowedFundingSources(model) // pool → [pool, pool_reimbursement]
                             // hybrid → [pool, pool_reimbursement, self]
                             // peer_to_peer → [self]
isPoolSideLeg(settlement)    // kind is pool_reimbursement | pool_cycle | pool_member_exit
```

**Never backfill `fundingModel` or `fundingSource`.** Absence is the signal.

### `canApproveDraw` — nobody approves their own spending

```ts
export function canApproveDraw(
  approverId: string, payerId: string, custodianUserId: string, approverIsManager: boolean,
): boolean {
  return approverIsManager && (approverId !== payerId || approverId === custodianUserId);
}
```

*"Managers approve, but never their own spending, except the custodian: it is their money."*

Used in **two** places in `pool.service.ts`, and they must stay consistent:

| Call site | Effect |
|---|---|
| `approveDraw()` | throws `PoolError(403, …, 'POOL_SELF_APPROVAL')` — *"You can't approve your own expense. Ask the custodian or another admin."* |
| `prepareDraw()` / `prepareAmountChange()` | decides **auto-approval**. A manager's own new draw is auto-approved only if they are the custodian; otherwise it enters the pending queue |

Note the deliberate call in `prepareDraw`:
`canApproveDraw(actorId, actorId, config.custodianUserId, manager)` — payer and approver are
the same person by construction there.

### Pool-payment helpers (shared with both clients)

```ts
// index.ts — legs waiting on a user
poolPaymentActions(settlements, userId)
  → { toPay:    pool side legs where fromUserId === userId and status is pending|failed,
      toConfirm: pool side legs where toUserId === userId and status is initiated }

// pool-ui.ts — the one-line summary, or null when nothing waits
poolPaymentActionsText(toConfirm, toPay)   // "1 payment to confirm · 2 payments to make"

// pool-ui.ts — how far an approved claim's pay-back has got
reimbursementStatus(draw, legStatus)
  // null                while pending or rejected
  // 'reimbursed'        selfReimbursed, or leg completed
  // 'sent'              leg initiated
  // 'to_reimburse'      otherwise
REIMBURSEMENT_STATUS     // labels + tones for the three states
```

### Production gating of contributor pools

```ts
export const CONTRIBUTOR_POOLS_IN_PRODUCTION = false;
const PRE_PRODUCTION_ENVS = ['local', 'development', 'staging', 'internal'];
export function contributorPoolsAvailable(appEnv: string | null | undefined): boolean {
  return CONTRIBUTOR_POOLS_IN_PRODUCTION
      || PRE_PRODUCTION_ENVS.includes(String(appEnv ?? '').toLowerCase());
}
/** Picking "Pool money": start on "Just me" when it is the only funder on offer. */
export function choosePool(choice: FundingChoice, contributorPools: boolean): FundingChoice {
  return contributorPools
    ? { ...choice, kind: 'pool' }
    : withPreset({ ...choice, kind: 'pool', funder: 'sponsor' }, 'sponsor_budget');
}
```

A missing or unknown environment **counts as production**, so the option cannot leak. This is
a **client-side** gate only — the API accepts every preset.

---

## 7. Presentation helpers (`pool-ui.ts`)

Shared by web and mobile so both always agree.

| Export | Purpose |
|---|---|
| `formatMinor(minor, currency, {signed})` | `1234567, 'INR'` → `"₹12,345.67"`; negatives use a true minus sign `−` |
| `currencySymbol`, `CURRENCY_SYMBOLS` | `$ € £ ₹ ¥ A$ C$` |
| `POOL_NOUN`, `poolNoun(config)` | Kitty / Fund / Treasury / Budget / Collection, default `"Pool"` |
| `ZONE_TONE` | `healthy→success`, `overdrawn→warning`, `blocked→error` |
| `CONTRIBUTION_STATUS` | labels + tones: *Not paid · Awaiting confirmation · Part paid · Confirmed · Waived* |
| `describePoolRefusal(err, currency)` | plain-language refusal text from the structured `data` |
| `canRecordAnyway(code)` | true for all refusals except `POOL_RECEIPT_REQUIRED` |
| `toPoolError`, `poolErrorText` | normalise anything thrown by the API client |
| `isReceiptRequired(config, source, amountMinor)` | **mirrors the server rule** |
| `meterGeometry(overdraft)` | `{ poolMarkPct, spentPoolPct, spentOverdraftPct, total }` over a track spanning pool + overdraft allowance |
| `meterCaption(overdraft, currency)` | the one-line status per zone |
| `FundingChoice`, `DEFAULT_FUNDING_CHOICE`, `CONTRIBUTOR_PRESETS`, `withPreset`, `needsTarget`, `validateFundingChoice`, `buildFundingPayload` | the entire create-event funding step as pure functions, so web and mobile render the same form with the same validation |

`buildFundingPayload` is where the UI choice becomes the API payload: a sponsor choice forces
`preset: 'sponsor_budget'`; `allowPeerExpenses` (not available for sponsors) flips
`fundingModel` to `hybrid`; only values that *differ* from the preset are sent as
`overrides`, keeping stored configs clean.

---

## 8. Service orchestration highlights

Selected `PoolService` members worth knowing (`apps/api/src/services/pool.service.ts`):

| Member | Line | Note |
|---|---|---|
| `isManager(event, config, userId)` | 153 | custodian **or** event admin |
| `resolveRoster(eventId, config, groups)` | 184 | participants collapsed into group entities where applicable |
| `buildSummary(event, cycle)` | 325 | the single read path — returns the summary plus `_draws`, `_contributions`, `_groups` for reuse, avoiding refetches |
| `getSummary` / `getLedger` / `listCycles` | 349 / 997 / 260 | the three read endpoints |
| `openFirstCycle(eventId, actorId)` | 400 | cycle 1 + one `regular` contribution per roster entity |
| `setContributions` / `addTopUp` | 510 / 565 | custodian's own top-up self-confirms |
| `markContributionPaid` / `confirmContribution` / `rejectContribution` / `waiveContribution` | 606–690 | the two-sided flow; custodian's own mark-paid confirms at once |
| `canDraw` / `spenderKey` | 711 / 723 | authorisation and cap bucketing |
| `prepareDraw` | 752 | all pre-flight checks; throws `PoolError` with structured data |
| `finalizeApprovedDraw` | 842 | creates the reimbursement leg, or marks `selfReimbursed` |
| `approveDraw` / `rejectDraw` | 898 / 924 | |
| `assertDrawMutable` / `prepareAmountChange` / `removeLeg` | 946 / 964 / 991 | editing and deleting a draw, including tearing down its leg |
| `previewClose` / `closeCycle` | 1096 / 1206 | preview is side-effect free; close commits and optionally opens the next cycle |
| `legExists(legId)` | ~886 | ⚠️ checks Firestore rather than trusting `poolDraw.settlementId` — *"a claim can reference a leg that no longer exists: data written before edits replaced `poolDraw` kept the id of the leg the edit removed."* |
| `beginDissolution` | 1332 | marks the cycle `reconciling`. Refuses with `POOL_PENDING_DRAWS` if any draw is pending, then **creates a leg for every approved, non-self-reimbursed claim that lacks one** — settling without it *"would close the event without paying the claimant back"* |
| `prepareForSettlement` / `computeSettlementBalances` / `finalizeOnSettled` | 1361 / 1373 / 1386 | the hooks `SettlementService` calls, which is what makes the ordinary generate endpoint pool-aware |
| `assertCanLeave` / `onMembershipChanged` | 1410 / 1425 | custodian protection and cycle-boundary decisions |
| `updateConfig` / `convertToHybrid` | 1510 / 1535 | ⚠️ `updateConfig` uses Firestore **`update()`**, not `set(..., { merge: true })` — *"update() replaces the whole map; a merge would keep removed keys such as a cleared spender cap."* Clearing a spender limit depends on this |
| `refreshOverdraftLatch` | 370 | persists latch transitions |

`PoolError(statusCode, message, code?, data?)` is the single error type; `routes/pools.ts`
maps it straight to an HTTP response.

---

**Sources:** `libraries/shared/src/{pool,pool-math,pool-ui}.ts` ·
`apps/api/src/services/pool.service.ts` · `apps/api/src/routes/pools.ts` ·
`apps/api/src/validation/pool.schemas.ts` ·
`libraries/shared/src/__tests__/pool-math.test.ts` ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` §0, §3.7, §3.8, §4
