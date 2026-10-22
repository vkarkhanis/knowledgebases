# Data Model

All persistence is **Firestore**, accessed exclusively through the Firebase Admin SDK from
the API. Clients are blocked by `firestore.rules`. Types are defined once in
`libraries/shared/src/index.ts` (core) and `libraries/shared/src/pool.ts` (pooling) and
imported by API, web and mobile.

---

## 1. Collections

| Path | Type | Written by |
|---|---|---|
| `users/{userId}` | user profile + entitlement + payment methods | `auth.service`, `users` route, `entitlement.service`, `revenuecat.service` |
| `users/{userId}/sessions/{sessionId}` | active session for revocation | `auth.service` |
| `events/{eventId}` | event incl. `fundingModel`, `poolConfig`, `settlementApprovals` | `event.service`, `settlement.service`, `pool.service` |
| `events/{eventId}/participants/{userId}` | membership, role, status | `event.service` |
| `expenses/{expenseId}` | expense incl. `fundingSource`, `poolCycleId`, `poolDraw`, `poolFlags` | `expense.service`, `pool.service` |
| `groups/{groupId}` | group with `eventIds[]`, members, payer, representative | `group.service` |
| `invitations/{invitationId}` | invitation with token and expiry | `invitation.service` |
| `settlements/{settlementId}` | settlement leg incl. `kind`, `poolCycleId`, audit trail | `settlement.service`, `pool.service` |
| `poolCycles/{cycleId}` | pool accounting period | `pool.service` |
| `poolContributions/{contributionId}` | money-in record | `pool.service` |
| *FX cache* | end-of-day rates | `fx-rate.service` |
| *billing events* | processed RevenueCat events (idempotency) | `billing-events.service` |

Notable modelling choices:

- **Participants are a subcollection, not an array.** A membership check is one document
  read: `events/{eventId}/participants/{userId}`.
- **Expenses, settlements, groups and pool documents are top-level**, queried by
  `where('eventId','==',…)`. There are no composite indexes
  (`firestore.indexes.json` is `{}`), so every query is single-field.
- **Pool cycles and contributions are separate collections**, not subcollections of the
  event — `pools.ts` resolves an `eventId` from a contribution/expense id before doing the
  access check.
- **Pool amounts are integer minor units.** `Expense.amount` stays a float major-unit value
  for backward compatibility and is converted on read into the pool ledger.

---

## 2. Core entities

### User / UserProfile

```ts
interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  phoneNumber?: string;
  photoURL?: string;
  authProviders?: ('email' | 'google' | 'microsoft' | 'phone')[];
  hasPassword?: boolean;
  tier: PlanTier;                            // 'free' | 'pro'
  entitlementStatus: EntitlementStatus;      // active | grace_period | billing_retry | expired | revoked
  entitlementExpiresAt?: Date | string | null;
  entitlementSource?: EntitlementSource;     // revenuecat | manual_override | system
  internalTester?: boolean;
  capabilities: UserCapabilities;            // { multiCurrencySettlement } — DERIVED
  preferences: UserPreferences;              // { notifications, currency, timezone }
  paymentMethods?: UserPaymentMethod[];
}

interface UserPaymentMethod {
  id: string; label: string; currency: string;
  type: 'upi' | 'bank' | 'paypal' | 'wise' | 'swift' | 'other';
  details: string; isActive: boolean;
  createdAt?: Date | string; updatedAt?: Date | string;
}
```

`capabilities` is never stored — it is computed from the entitlement on every read via
`hasActivePro()`.

⚠️ **A lapsed subscription still reads `tier: 'pro'` with `entitlementStatus: 'expired'`.**
Never test `tier === 'pro'` alone; use `hasActivePro(entitlement)` from
`@traxettle/shared`, which requires status `active` or `grace_period`. The free-tier
3-event quota uses the same helper.

### Event

```ts
interface Event {
  id: string;
  name: string;
  description?: string;
  type: 'trip' | 'event';
  startDate: Date;
  endDate?: Date;
  currency: string;                     // expense currency
  settlementCurrency?: string;          // defaults to currency. Pro to differ.
  fxRateMode?: 'predefined' | 'eod';
  predefinedFxRates?: Record<string, number>;   // key "USD_INR"
  status: 'active' | 'review' | 'payment' | 'settled' | 'closed';
  settlementApprovals?: Record<string, SettlementApproval>;   // key = entity key
  settlementStale?: boolean;
  fundingModel?: EventFundingModel;     // ABSENT ⇒ 'peer_to_peer'. Never written on p2p events.
  poolConfig?: PoolConfig;              // only when fundingModel is 'pool' or 'hybrid'
  createdBy: string;
  admins: string[];
  createdAt: Date; updatedAt: Date;
}

interface EventParticipant {
  userId: string; displayName?: string; email?: string;
  groupId?: string;
  role: 'admin' | 'member';
  joinedAt: Date; invitedBy: string;
  status: 'pending' | 'accepted' | 'declined';
}

interface SettlementApproval {
  approved: boolean; approvedAt?: string;
  entityType: 'user' | 'group'; displayName?: string;
}
```

### Group

```ts
interface Group {
  id: string;
  eventId: string;          // the originating event
  eventIds?: string[];      // all events this group is used in (reuse)
  name: string; description?: string;
  createdBy: string;
  members: string[];
  representative: string;   // may update the group, approves on its behalf
  payerUserId: string;      // pays and receives for the group
  createdAt: Date; updatedAt: Date;
}
```

### Expense

```ts
interface Expense {
  id: string; eventId: string;
  title: string; description?: string;
  amount: number;            // MAJOR units (float) — legacy, kept for compatibility
  currency: string;
  paidBy: string;
  paidOnBehalfOf?: OnBehalfOfEntry[];   // payer's own split becomes 0
  isPrivate: boolean;
  splitType: 'equal' | 'ratio' | 'custom';
  splits: ExpenseSplit[];               // must sum exactly to amount
  selectedEntities?: SplitEntity[];
  attachments: string[];                // receipt URLs
  fundingSource?: ExpenseFundingSource; // ABSENT ⇒ 'self'
  poolCycleId?: string;
  poolDraw?: PoolDrawState;             // only approved draws deduct
  poolFlags?: PoolExpenseFlag[];        // limits breached when recorded after the fact
  createdAt: Date; updatedAt: Date;
}

interface ExpenseSplit { entityType: 'user'|'group'; entityId: string; amount: number; ratio?: number }
interface SplitEntity  { entityType: 'user'|'group'; entityId: string; name?: string }
interface OnBehalfOfEntry { entityId: string; entityType: 'user'|'group' }
```

**Pool draws carry no splits and no required `splitType`.** Splits on a pool expense are
optional and used only for `collect_by_consumption` weighting.

### Settlement

```ts
interface Settlement {
  id: string; eventId: string;
  fromEntityId: string; fromEntityType: 'user'|'group';
  toEntityId: string;   toEntityType: 'user'|'group';
  fromUserId: string;   // the actual payer (for a group, its payerUserId)
  toUserId: string;     // the actual payee
  amount: number; currency: string;                  // expense currency
  settlementAmount?: number; settlementCurrency?: string; fxRate?: number;
  status: 'pending' | 'initiated' | 'failed' | 'completed';
  paymentMethod?: string; paymentId?: string; paymentReference?: string;
  payerNote?: string; proofUrl?: string; checkoutUrl?: string;
  failureReason?: string; rejectionReason?: string; retryCount?: number;
  payerMarkedAt?: Date; payeeConfirmedAt?: Date; rejectedAt?: Date;
  payeePaymentMethods?: UserPaymentMethod[];   // so the payer knows where to send money
  auditTrail?: SettlementAuditEntry[];
  kind?: SettlementKind;        // ABSENT ⇒ 'standard'
  poolCycleId?: string;
  expenseId?: string;           // pool_reimbursement: the expense being reimbursed
  initiatedAt?: Date; createdAt: Date; failedAt?: Date; completedAt?: Date;
}

type SettlementKind = 'standard' | 'pool_reimbursement' | 'pool_cycle' | 'pool_member_exit';

interface SettlementAuditEntry {
  id: string;
  action: 'created'|'marked_paid'|'confirmed'|'rejected'|'retry_requested';
  actorUserId: string; note?: string; referenceId?: string; proofUrl?: string;
  statusFrom?: string; statusTo?: string; createdAt: string;
}
```

`isPoolSideLeg(settlement)` returns true for the three pool kinds. **Pool side legs live
alongside the settlement plan and do not drive the event lifecycle** — this is what allows
reimbursements to be paid while the event stays `active`.

### Invitation

```ts
interface Invitation {
  id: string; eventId: string; invitedBy: string;
  inviteeEmail?: string; inviteePhone?: string; inviteeUserId?: string;
  groupId?: string;                 // auto-join this group on accept
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  token: string;                    // public lookup key
  message?: string;
  emailSent?: boolean; emailError?: string;
  createdAt: Date; expiresAt: Date; // +7 days
  respondedAt?: Date;
}
```

### Balance — the universal money interface

```ts
interface Balance { entityId: string; entityType: 'user'|'group'; amount: number }
```

**Positive = owed money. Negative = owes money.** This is the pivot of the whole design:
`PoolEntityShare.netMinor` has identical semantics, so pool reconciliation can feed the
existing settlement engine with a one-line map.

---

## 3. Pool entities

### PoolConfig (embedded on the event)

```ts
interface PoolConfig {
  preset?: PoolPreset;                 // trip_kitty|household|club_treasury|sponsor_budget|target_collection
  funderMode: PoolFunderMode;          // 'contributors' | 'sponsor'       — FIXED after creation
  cycleMode: PoolCycleMode;            // 'single' | 'recurring'           — FIXED after creation
  recurrence?: PoolRecurrence;         // 'monthly' | 'quarterly' | 'custom'
  targetAmountMinor?: number | null;   // budget / collection target. null ⇒ open-ended
  defaultContributionMinor?: number | null;
  custodianUserId: string;             // holds the money, confirms, approves, pays out
  authorizedSpenders?: string[];       // sponsor mode: may draw without contributing
  authorizedSpenderGroups?: string[];
  spenderCapsMinor?: Record<string, number>;   // userId|groupId → minor
  surplusPolicy: 'refund_pro_rata'|'refund_equal'|'carry_forward'|'retain';
  deficitPolicy: 'collect_pro_rata'|'collect_equal'|'collect_by_consumption'|'custodian_absorbs';
  overdraftPolicy: 'block'|'graduated'|'allow';
  overdraftTolerancePercent?: number;          // default 20
  overdraftBaseline?: 'confirmed_funding'|'expected_funding'|'target_amount';   // default confirmed_funding
  overdraftClearancePercent?: number;          // default 0
  requireFullFundingBeforeSpend?: boolean;     // escrow behaviour
  receiptRequiredAboveMinor?: number | null;   // 0 ⇒ always, null ⇒ never
  claimReceiptRequired?: boolean;              // default true
  expenseApproval: 'none'|'above_threshold'|'always';
  approvalThresholdMinor?: number | null;
  membershipChangeClosesCycle?: boolean;
}
```

`funderMode` and `cycleMode` are **not** in `poolConfigPatchSchema` — the funding shape is
fixed once the event exists.

### PoolCycle — `poolCycles/{cycleId}`

```ts
interface PoolCycle {
  id: string; eventId: string;
  sequence: number;                 // 1, 2, 3…
  label: string;                    // "September 2026", or "(from 12 Oct)" after a membership split
  startDate: string; endDate?: string | null;
  status: 'open' | 'reconciling' | 'closed';
  currency: string;
  openingBalanceMinor: number;      // carried in; 0 for cycle 1
  openingCredits: Record<string, number>;  // entity key → minor; sums to openingBalanceMinor
  roster: PoolEntityRef[];          // entities that share this cycle's spending
  overdraftLatchedAt?: string | null;
  closeReason?: 'scheduled'|'membership_change'|'dissolution'|'manual' | null;
  closedAt?: string | null; closedBy?: string | null;
  reconciliation?: PoolReconciliation | null;
  createdAt: string; updatedAt: string;
}
```

Note what is **absent**: no stored running totals. There is no
`confirmedContributionTotal`, no `closingBalance`. All of it is derived on read by
`computeCycleTotals()`. Only `openingBalanceMinor` / `openingCredits` are persisted
(they are the committed result of the previous close).

The proposed `collecting` status was dropped: collection and spending happen concurrently,
so a stored funding status would drift. Funding progress is derived as
`PoolFundingState`.

### PoolContribution — `poolContributions/{contributionId}`

```ts
interface PoolContribution {
  id: string; eventId: string; cycleId: string;
  fromEntityId: string; fromEntityType: 'user'|'group';
  fromUserId: string;                      // for a group, its payer
  kind: 'regular' | 'top_up' | 'overdraft_cover';
  expectedMinor: number;                   // agreed amount → defines fair-share WEIGHT
  receivedMinor: number;                   // what the custodian confirmed receiving
  claimedMinor?: number | null;            // what the contributor says they sent
  currency: string;
  status: 'pending'|'initiated'|'partial'|'confirmed'|'waived';
  dueDate?: string | null;
  paymentReference?: string | null; payerNote?: string | null; proofUrl?: string | null;
  payerMarkedAt?: string | null; custodianConfirmedAt?: string | null;
  rejectionReason?: string | null;
  auditTrail: PoolAuditEntry[];
  createdBy: string; createdAt: string; updatedAt: string;
}
```

Deliberately shaped to mirror `Settlement` so the mark-paid → confirm interaction, the proof
uploader and the audit trail transfer directly. There is no `rejected` status — a rejection
returns the contribution to `pending`.

`PoolAuditEntry.action`: `created | marked_paid | confirmed | partially_confirmed |
rejected | waived | amount_changed`.

### PoolDrawState (embedded on the expense)

```ts
interface PoolDrawState {
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string | null; decidedAt?: string | null; reason?: string | null;
  settlementId?: string | null;   // pool_reimbursement: the leg paying the claimant back
  selfReimbursed?: boolean;       // claim filed by the custodian: no leg needed
  alreadyIncurred?: boolean;      // money had already moved — never refused, only flagged
}

type PoolExpenseFlag = 'exceeds_tolerance' | 'exceeds_spender_cap' | 'underfunded';
```

One approval model serves both pool spends and reimbursement claims; payment progress for a
claim is read from the linked settlement leg rather than duplicated here.

### PoolReconciliation (embedded on the closed cycle)

```ts
interface PoolReconciliation {
  cycleId: string; currency: string;
  openingBalanceMinor: number;
  confirmedContributionsMinor: number;
  overdraftCoverMinor: number;
  poolSpendMinor: number;
  reimbursementsMinor: number;
  preCoverBalanceMinor: number;    // opening + contributions − spend, before cover
  closingBalanceMinor: number;     // preCover + cover. Never negative once closed.
  outcome: 'surplus' | 'deficit' | 'balanced';
  shareBasis: 'commitment' | 'equal' | 'consumption' | 'custodian';
  disposition: 'carry_forward' | 'settle';
  entityShares: PoolEntityShare[];
  settlementIds: string[];
  generatedAt: string; generatedBy: string;
}

interface PoolEntityShare {
  entityId: string; entityType: 'user'|'group';
  openingCreditMinor: number;
  contributedMinor: number;    // confirmed regular + top-up this cycle
  coverMinor: number;          // fronted to cover a deficit at close
  commitmentMinor: number;     // agreed share weight (non-waived regular expected amounts)
  fairShareMinor: number;      // this entity's share of the cycle's spending
  netMinor: number;            // opening + contributed − fairShare + cover.  >0 owed · <0 owes
}
```

### Derived read models (never stored)

| Type | Purpose |
|---|---|
| `PoolCycleTotals` | expected/confirmed regular, confirmed top-ups, overdraft cover, pool spend, reimbursements, pending draws, balance |
| `PoolOverdraftState` | policy, baseline, tolerance %, tolerance, floor, balance, headroom, zone, latched, clearance threshold |
| `PoolFundingState` | target, funded, `underfunded`/`funded`/`open_ended` |
| `PoolArrear` | outstanding regular contribution per entity |
| `PoolCycleSummary` | cycle + totals + overdraft + funding + arrears — the `/summary` payload |
| `PoolLedgerEntry` | one movement: signed amount, status, actor, receipts, flags, `counted` |
| `PoolSpenderSummary` | spent / pending / cap per spender |
| `PoolLedger` | summary + contributions + entries + spenders + cycles — the `/ledger` payload |
| `PoolRefusalDetails` | the `data` payload of a refused draw (all minor units) |

### Entity keys

Pool records are keyed by a serialised entity reference:

```ts
entityKey('user', 'abc')   // "user:abc"
parseEntityKey('group:xyz') // { entityType: 'group', entityId: 'xyz' }
```

Used for `openingCredits`, `settlementBalances`, allocation weights and
`settlementApprovals`.

---

## 4. Money representation

| | Core expenses & settlements | Pool ledger |
|---|---|---|
| Unit | major units, JS `number` (float) | **integer minor units** |
| Rounding | `Math.round(x * 100) / 100` in places | exact integer arithmetic; `allocateMinor` guarantees parts sum to the total |
| Field naming | `amount`, `settlementAmount` | always suffixed `Minor` |
| Conversion | — | `toMinor(amount, currency)` / `fromMinor(minor, currency)` only at the presentation boundary |

`currencyExponent(currency)` returns 0 for `JPY, KRW, VND, CLP, ISK, UGX, XAF, XOF` and 2
otherwise. `toMinor` rounds half away from zero and is immune to the `1.005 × 100` float
trap via `toPrecision(15)`.

The reason for the split is explicit in the design: *"a running balance carried across
twelve monthly cycles accumulates float drift, and the ledger stops reconciling to zero.
You will notice this around month four and lose a day finding it."*

---

## 5. Invariants

Asserted in code and/or covered by tests. These are what make the ledger trustworthy.

1. `closingBalance === openingBalance + confirmedContributions − poolSpend − approvedReimbursements`
2. `Σ entityShares[].netMinor === closingBalanceMinor`
   — **actively thrown** by `reconcileCycle()`:
   *"reconcileCycle invariant violated: Σnet X ≠ closing Y"*
3. `Σ entityShares[].fairShareMinor === poolSpend + reimbursements`
4. `nextCycle.openingBalanceMinor === previousCycle.closingBalanceMinor`
5. A reimbursement's amount never exceeds its expense amount
6. No pool expense may be written against a `closed` cycle
   (`assertCycleWritable`, `assertDrawCycleWritable`)
7. Under `overdraftPolicy: 'block'`, no draw may take the balance negative
8. Under `'graduated'`, no **pre-authorised** draw may take the balance below the floor;
   after-the-fact records may breach it but must carry `exceeds_tolerance`
9. A cycle may not close with a negative balance **and** no `overdraft_cover` — the gap must
   be attributed (`uncoveredDeficitMinor` must be 0 to close)
10. `allocateMinor(total, weights)` parts always sum to exactly `total`
11. Expense splits sum exactly to the expense amount
12. The custodian cannot leave the pool (`splitForMembershipChange` throws)

Randomised invariant checks live in
`libraries/shared/src/__tests__/pool-math.test.ts` (700 lines).

---

## 6. Security rules

`firestore.rules` — clients may read/write **only their own** `users/{uid}/**` subtree;
everything else is `allow read, write: if false`. `storage.rules` is comparably strict. The
API bypasses rules entirely via the Admin SDK. This is a deliberate posture: the public
Firebase web config is extractable from the web bundle, so it must grant nothing.

`firestore.indexes.json` is `{}` — no composite indexes are defined, so all queries are
single-field.

---

**Sources:** `libraries/shared/src/index.ts` · `libraries/shared/src/pool.ts` ·
`libraries/shared/src/pool-math.ts` · `apps/api/src/services/pool.service.ts` ·
`apps/api/src/services/{event,expense,settlement,auth}.service.ts` ·
`apps/api/src/validation/pool.schemas.ts` · `firestore.rules` ·
`firestore.indexes.json` · `traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` §3, §3.8
