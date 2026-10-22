# Traxettle — Domain Glossary

Terms are listed in dependency order where that helps, otherwise alphabetically within a
section. Where a term has both a user-facing and an internal name, both are given — the
internal name is what you will find in code.

---

## Core domain

**Event** — the organising unit for everything. A trip, a home, a wedding, a work outing,
a club season. Has a name, a type (`trip` | `event`), start/end dates, an expense
currency, optionally a different settlement currency, a status, a creator, a list of
admins, participants, and — if pooled — a funding model and pool config.
*Code: `Event` in `libraries/shared/src/index.ts`; Firestore `events/{eventId}`.*

**Participant** — a user who belongs to an event, with a role (`admin` | `member`) and a
status (`pending` | `accepted` | `declined`). Stored as a subcollection document, not an
array, so membership checks are a single document read.
*Code: `EventParticipant`; Firestore `events/{eventId}/participants/{userId}`.*

**Admin** — a participant who may invite people, add/remove participants, edit the event,
create/delete groups, generate the settlement and close the event. The creator is always an
admin and can never be removed.

**Group** — an optional sub-unit inside an event (e.g. "the Sharmas", "the shopping team").
A group is a **single entity** for splitting and settling: one expense split lands on the
group, and one designated **payer** pays or receives on the group's behalf. Groups can be
reused across events via an `eventIds` array, and Traxettle can suggest an existing group
when a new one overlaps it ≥70%.
*Code: `Group`; Firestore `groups/{groupId}`.*

**Entity** — the unit of splitting and settling: either a **user** or a **group**. Nearly
every money structure in the system is keyed by `(entityType, entityId)`. In pool code
this is serialised as an **entity key**: `"user:abc123"` or `"group:xyz789"`.
*Code: `SplitEntity`, `PoolEntityRef`, `entityKey()`, `parseEntityKey()`.*

**Expense** — a single spend: title, description, amount, currency, who paid, how it is
split, whether it is private, attachments (receipts), and — if pooled — a funding source,
a cycle, a draw state and any limit flags.
*Code: `Expense`; Firestore `expenses/{expenseId}`.*

**Split** — one entity's share of one expense: `{ entityType, entityId, amount, ratio? }`.
The splits of an expense must sum exactly to its amount.
*Code: `ExpenseSplit`.*

**Split type** — how shares were derived: `equal` (divided evenly among selected entities),
`ratio` (weighted), `custom` (exact amounts typed in).

**Private expense** — an expense visible only to its creator. The API filters other
people's private expenses out of event reads server-side; they never reach another
client.

**On behalf of** — a payer fronting money *for* one or more other entities. The payer's
own share becomes zero and the splits exclude the payer's entity.
*Code: `Expense.paidOnBehalfOf: OnBehalfOfEntry[]`.*

**Balance** — a net position for one entity: `{ entityId, entityType, amount }`. **Positive
means owed money; negative means owes money.** This sign convention is load-bearing: pool
reconciliation produces values with exactly the same semantics so they can be fed into the
existing settlement engine.
*Code: `Balance`.*

**Settlement / leg** — one proposed or in-flight payment from one entity to another:
from/to entity, the actual from/to *users* (for a group, its payer), amount, currency,
optional settlement-currency amount and FX rate, a status, proof, notes and an audit trail.
Informally called a **leg** of the settlement plan.
*Code: `Settlement`; Firestore `settlements/{settlementId}`.*

**Settlement plan** — the full set of legs generated for an event, computed by a greedy
algorithm that minimises the number of transactions.
*Code: `SettlementPlan`, `SettlementService.calculateSettlementPlan()`.*

**Settlement review / approval** — the phase after a plan is generated and before payment
starts, where each entity approves the proposal. Tracked per entity on the event.
*Code: `Event.settlementApprovals: Record<string, SettlementApproval>`.*

**Settlement stale** — set when expenses are changed after a plan was generated but before
all approvals landed, so the UI can tell users the plan needs regenerating.
*Code: `Event.settlementStale`.*

**Invitation** — a pending request for someone to join an event, addressed by email, phone
or user id, carrying a unique token, an optional target group, a role, an optional message,
and expiring after 7 days.
*Code: `Invitation`; Firestore `invitations/{invitationId}`.*

**Unsettled payments** — the cross-event view of legs a user still has to pay or still has
to confirm receipt of.

**Closed events** — events whose lifecycle has ended; hidden from the dashboard, available
in a dedicated history view with CSV/printable export.

---

## Currency & FX

**Expense currency** (`Event.currency`) — the currency expenses are recorded in.

**Settlement currency** (`Event.settlementCurrency`) — the currency legs are to be paid in.
Defaults to the expense currency. Using a *different* one is a **Pro** capability.

**FX rate mode** (`Event.fxRateMode`) — `predefined` (rates fixed at event creation, stored
in `predefinedFxRates` keyed `"USD_INR"`) or `eod` (latest end-of-day rate fetched at
settlement time from `open.er-api.com`, cached in Firestore).

**Minor units** — integer paise/cents. **All pool amounts are integer minor units**, never
floats, so a balance carried across many cycles never accumulates drift. Zero-decimal
currencies (JPY, KRW, VND, CLP, ISK, UGX, XAF, XOF) have an exponent of 0.
*Code: `toMinor()`, `fromMinor()`, `currencyExponent()` in `libraries/shared/src/pool.ts`.*
Field names carrying minor units always end in `Minor` (`expectedMinor`, `balanceMinor`…).

**Supported currencies** — `USD, EUR, GBP, INR, JPY, AUD, CAD`.

---

## Money pooling

**Funding model** (`Event.fundingModel`) — `peer_to_peer` (absent ⇒ this), `pool`, or
`hybrid`. `hybrid` allows both pool-funded and ordinary split expenses in one event.

**Funding source** (`Expense.fundingSource`) — where *this* expense's money came from:
- `self` (absent ⇒ this) — the payer's own money, split into debts. Today's behaviour.
- `pool` — paid directly from pool funds. Deducts from the pool; creates no debt.
- `pool_reimbursement` — the spender used their own money and claims it back. Deducts from
  the pool and creates a payable to the spender.

**Pool** — the collected money for an event. Not a separate ledger: it is a funding
dimension on the same expense ledger.

**Pool config** (`Event.poolConfig`) — the policy bundle: preset, funder mode, cycle mode,
custodian, target, default contribution, authorised spenders and caps, surplus/deficit/
overdraft policies, receipt rules, approval mode.

**Preset** — the user-facing shape of a pool, which sets the policy matrix so a user never
sees `surplusPolicy` or `deficitPolicy` unless they open Advanced. Five exist:

| Internal | User-facing noun | One-liner |
|---|---|---|
| `trip_kitty` | **Kitty** | Everyone chips in once; leftovers are refunded in proportion. |
| `household` | **Fund** | Monthly contributions for shared bills; balance rolls over. |
| `club_treasury` | **Treasury** | Recurring dues at any tier; surplus stays in the treasury. |
| `sponsor_budget` | **Budget** | You fund it; others spend from it and claim reimbursements. |
| `target_collection` | **Collection** | Collect toward a target before committing to a big spend. |

**Funder mode** (`PoolConfig.funderMode`) — `contributors` ("several of us put money in")
or `sponsor` ("just me").

**Custodian** (`PoolConfig.custodianUserId`) — the person who physically holds the money.
They confirm contributions, approve draws, pay out legs, and absorb deficits under some
policies. Marking *their own* contribution or top-up paid confirms it immediately, because
the money is already in their hands. The custodian **cannot leave the pool** without a new
custodian being assigned first.

**Cycle** (`PoolCycle`) — the accounting period for a pool. Single-cycle pools (kitty,
budget, collection) have exactly one; recurring pools (fund, treasury) have a sequence of
them. Holds the opening balance, the per-entity carried credits, the roster, the overdraft
latch, and — once closed — a reconciliation snapshot.
*Firestore `poolCycles/{cycleId}`. Status: `open` | `reconciling` | `closed`.*

**Roster** (`PoolCycle.roster`) — the entities that share this cycle's spending.

**Contribution** (`PoolContribution`) — one money-in record. Deliberately shaped to mirror
`Settlement` so the mark-paid → confirm interaction, the proof uploader and the audit
trail all transfer directly.
*Firestore `poolContributions/{contributionId}`.*
- **Kind**: `regular` (the agreed amount for this cycle — this defines the contributor's
  fair-share weight), `top_up` (ad-hoc money in, e.g. to unpause the pool), or
  `overdraft_cover` (money fronted to cover a deficit at close).
- **Status**: `pending` → `initiated` → `confirmed`, with `partial` for underpayment and
  `waived` for "he's covering it next month". Only **confirmed** money moves the balance.
- `expectedMinor` is the agreed amount; `receivedMinor` is what the custodian confirms
  receiving; `claimedMinor` is what the contributor says they sent.

**Arrears** — outstanding regular contributions per entity (`expected − received`, ignoring
waived ones).

**Draw** — a pool-funded expense (either `pool` or `pool_reimbursement`). Only an
**approved** draw deducts from the pool.
*Code: `Expense.poolDraw: PoolDrawState`, status `pending` | `approved` | `rejected`.*

**Already incurred** (`alreadyIncurred`) — the money had already left someone's account
when the expense was recorded. Such draws are **always recorded**, even past the overdraft
limit, and flagged instead of refused. The principle: *an accurate ledger beats an enforced
one.*

**Pre-authorised draw** — the opposite: *"I'm about to spend from the pool card."* These are
**refused** past the limit, because a limit that one large expense can blow through is not a
limit.

**Baseline** (`PoolOverdraftState.baselineMinor`) — the pool's value for this cycle, used as
the reference for the overdraft allowance. Derived per `overdraftBaseline`:
`confirmed_funding` (default — opening + confirmed contributions + top-ups),
`expected_funding` (uses agreed amounts, stable despite late payers), or `target_amount`.

**Tolerance / floor** — the overdraft allowance (`floor(baseline × tolerancePercent / 100)`,
default 20%) and the lowest balance a pre-authorised draw may reach (`−tolerance`).

**Graduated overdraft** — spending is warned down to the floor, then **paused**. See
**latch**.

**Latch** (`PoolCycle.overdraftLatchedAt`) — once the balance reaches the floor,
pre-authorised draws stay refused until the balance rises **above**
`overdraftClearancePercent × baseline` (default 0, i.e. the whole overdraft repaid *plus
more*). This exists so a ₹500 top-up cannot unlock a ₹500 spend.

**Headroom** — how much more may be drawn right now: `balance − floor`, never negative, and
zero while latched.

**Zone** (`PoolBalanceZone`) — `healthy` (balance > 0), `overdrawn` (negative but within
tolerance), `blocked` (at/below the floor, or latched). Drives the colour of the balance
meter: green / amber / red.

**Funding state** (`PoolFundingState`) — progress toward a target: `underfunded`, `funded`,
or `open_ended`.

**Reconciliation** (`PoolReconciliation`) — the snapshot taken when a cycle closes:
balances, outcome (`surplus` | `deficit` | `balanced`), share basis, disposition
(`carry_forward` | `settle`), per-entity shares, and the ids of any settlement legs created.

**Fair share** (`PoolEntityShare.fairShareMinor`) — an entity's share of the cycle's
spending under the active policy. **Weighted by agreed commitment, not by what was actually
paid** — otherwise a member who paid nothing would escape their share. The net position is
`opening + contributed − fairShare + cover`; positive means owed, negative means owes.

**Share basis** (`PoolShareBasis`) — how fair shares were weighted: `commitment` (default),
`equal`, `consumption` (uses the splits on pool expenses, so a flatmate who was away pays
less), or `custodian` (the sponsor takes whatever is left or short).

**Surplus policy** — what happens to money left over: `refund_pro_rata`, `refund_equal`,
`carry_forward`, `retain`.

**Deficit policy** — who covers a shortfall: `collect_pro_rata`, `collect_equal`,
`collect_by_consumption`, `custodian_absorbs`.

**Overdraft cover** — a `confirmed` contribution of kind `overdraft_cover` created at close
to attribute a negative balance to whoever's real money covered the gap. Without it,
reconciliation would charge that person a share of spend they personally financed.

**Close (a cycle)** — reconcile and either carry the balance into a new cycle or pay it out.
For recurring pools this is routine bookkeeping; no money needs to move.

**Dissolve / settle up** — the final reconcile. Produces **one** settlement plan covering
pool positions and any peer-to-peer expenses, then the event follows the existing
review → payment → settled lifecycle.

**Settlement kind** (`Settlement.kind`) — `standard` (absent ⇒ this; part of the event's
settlement plan and drives the lifecycle), or a **pool side leg** that lives alongside the
plan without driving the lifecycle: `pool_reimbursement` (paying a claimant back),
`pool_cycle` (squaring up at a cycle close), `pool_member_exit` (squaring up a leaver).
*Code: `isPoolSideLeg()`.*

**Pool payments** — the UI section listing pool side legs (reimbursements, cycle payouts,
leaving settlements), which the custodian pays and the recipient confirms **without the
event being settled or locked**.

---

## Plans, entitlements & billing

**Tier** (`PlanTier`) — `free` or `pro`.

**Entitlement status** (`EntitlementStatus`) — `active`, `grace_period`, `billing_retry`,
`expired`, `revoked`.

**Entitlement source** (`EntitlementSource`) — `revenuecat`, `manual_override`, `system`.

**Capability** (`UserCapabilities`) — the server-authoritative feature flags derived from
the tier. Currently one: `multiCurrencySettlement`.

**Internal tester** (`UserProfile.internalTester`) — allows non-production tier switching
and real-gateway opt-in.

**RevenueCat** — the subscription broker in front of Google Play Billing and Apple IAP. Its
webhook drives tier transitions in production.

---

## Platform & infrastructure

**Rush / rushx** — the monorepo tool. `rush <command>` runs global/bulk commands;
`rushx <script>` runs a package's own script. Pinned to Rush 5.167.0, pnpm 9.15.9,
Node ≥24.11.1 <25.

**Mock auth** (`Bearer mock-<uid>`) — a development convenience token accepted **only** when
`APP_ENV=local`, `NODE_ENV=test|development`, or `ALLOW_MOCK_AUTH=true`. Refused everywhere
else, including when the environment is unset.

**In-memory Firestore** — without Firebase credentials the API silently falls back to an
in-memory store. Extremely convenient locally; see
[`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md)
for why it is a hazard in production.

**Runtime config** (`GET /api/config`) — how a client discovers its API URL, Firebase client
config and RevenueCat keys at run time instead of at build time. This is what makes the
same mobile bundle usable against staging and production.

**7-tap developer menu** — tapping the version text seven times within 2 s on mobile opens
a hidden developer sheet whose main power is switching the runtime environment between
production and staging. Switching requires an app re-bootstrap so Firebase project
selection stays aligned.

**Doctor** — the guided setup/validation tool, available as a CLI
(`bash scripts/doctor.sh <env> --non-interactive`) and a local web UI
(`tools/doctor-tool`).
