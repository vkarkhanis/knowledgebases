# Money Pooling — Functional Guide

The feature introduced on branch `feature/money-pooling` (commit `a65f586`). This document
is the functional view: what a user can do, what the app does back, and why.

For the maths and the enforcement rules, see
[`../02-architecture/03-money-pooling-engine.md`](../02-architecture/03-money-pooling-engine.md).

---

## 1. The idea in one paragraph

Traxettle's original model is **expense-first, debt-derived**: people spend their own money,
splits accrue, balances net out, and one settlement plan appears at the end. Pooling is
**fund-first, balance-drawn**: money goes into a pool up front, expenses draw it down, and
at the end you reconcile the surplus or the deficit. These are not two applications — they
are two *funding models* over the same expense ledger. A pool expense is still an expense
(amount, currency, date, payer, receipt). What changes is only who funded it, whether it
creates debt, and what "settling" means.

**Nothing about existing events changes.** Every pooling field is optional and an absent
field always means today's behaviour. An event with no `fundingModel` is peer-to-peer; an
expense with no `fundingSource` is `self`.

---

## 2. Choosing how an event is funded

At event creation the user answers at most three questions, presented as cards (not a
dropdown) because the choice is consequential and one-way.

**Q1 — How is this event funded?**

| | |
|---|---|
| **Split expenses** *(default)* | "Everyone pays their own way. Settle up at the end." → exactly today's behaviour |
| **Pool money** | "Collect money up front. Spend from the pool." |

**Q2 — (only if Pool) Who puts money in?**

| | |
|---|---|
| **Several of us** | A contribution roster appears → Kitty / Fund / Treasury / Collection |
| **Just me** | No roster; a budget + spender authorisation UI instead → Budget |

> ⚠️ **"Several of us" is held back from production for the first release.**
> `CONTRIBUTOR_POOLS_IN_PRODUCTION = false`, and
> `contributorPoolsAvailable(appEnv)` returns true only for `local`, `development`,
> `staging` and `internal` — a missing or unknown environment counts as production. So a
> **production** user picking "Pool money" lands straight on **Just me / Budget**; the other
> four presets are not offered. **The API supports all five regardless** — this is a UI gate.
> Flip the constant to release them.

**Q3 — the preset**, plus its one or two headline amounts ("Each person puts in", or
"Total budget" / "Amount to collect").

An **Advanced** disclosure exposes: overdraft allowance %, approval mode and threshold, and
*"Also allow regular split expenses"* (which makes the event **hybrid**).

> The user never has to understand `surplusPolicy` or `deficitPolicy`. The preset sets them.

**Adding a pool later.** An existing split-expenses event can gain a pool
(`POST /api/pools/event/:id/convert`), which makes it **hybrid**. This is one-way, and
existing expenses are untouched.

---

## 3. The five presets

| Preset | Noun | Cycle | Surplus | Deficit | Overdraft | Receipts | Approval | Membership change |
|---|---|---|---|---|---|---|---|---|
| `trip_kitty` | **Kitty** | single | refund pro-rata | collect pro-rata | graduated 20% | optional | none | roster only grows |
| `household` | **Fund** | recurring monthly | carry forward | collect pro-rata | graduated 20% | claims required | none | **closes the cycle** (once money has moved) |
| `club_treasury` | **Treasury** | recurring monthly | carry forward | collect pro-rata | graduated 20% | claims required | none | roster updates, no cycle boundary |
| `sponsor_budget` | **Budget** | single | retain (stays with sponsor) | custodian absorbs | graduated 20% | **always** | **always** | n/a |
| `target_collection` | **Collection** | single | refund pro-rata | collect pro-rata | **block**, baseline = target, full funding required before spending | optional | none | roster only grows |

*Code: `POOL_PRESETS` in `libraries/shared/src/pool.ts`.*

### What each is for

- **Kitty** — *"Everyone drops ₹10,000 in before the trip; one person holds the cash."*
  Single cycle, multiple contributors who each expect a refund. The refund must be
  **pro-rata**: if A put in ₹15,000 and B ₹5,000 and ₹4,000 is left, A gets ₹3,000 and B
  ₹1,000. Refunding equally here would be a silent unfairness bug.
- **Fund** — *"Flatmates contribute ₹15,000 each per month; rent, electricity, internet and
  groceries come out of the fund."* Recurring cycles, carry-forward balance, arrears
  tracking, receipts for transparency, and reconciliation on membership change rather than
  only at the end.
- **Treasury** — *"A running club collects monthly dues at unequal tiers — full ₹500,
  student ₹200, patron ₹2,000."* Nobody expects a refund; surplus carries forward
  indefinitely. "Settlement" is replaced by a published, exportable ledger. Membership
  churns constantly **without** triggering reconciliation.
- **Budget** — *"I've budgeted ₹8,00,000 for the wedding. There are no contributors, but
  there are several spenders — one group shops, another handles the venue."* Budget vs
  actual, authorised spenders who are not contributors, reimbursement claims with mandatory
  receipts, per-spender visibility and caps. There is **no inter-participant settlement**:
  completion means every spender has been reimbursed and the unspent budget is reported
  back to the sponsor.
- **Collection** — *"I'm booking the villa — everyone send ₹8,000 by Friday."* The pool has
  a target and a funding state. Spending is **refused while underfunded**, which answers the
  organiser's actual question: *am I clear to book?*

### Hybrid

With *"Also allow regular split expenses"* on, one event carries both kinds of expense: the
villa, van hire and groceries come out of the kitty, while someone's spa afternoon and
Tuesday's bar round stay as ordinary peer-to-peer splits. The expense form then offers a
third option, *My money — split it* (the classic form). **Settle up produces one plan**
covering pool refunds and peer debts, so nobody has to settle twice.

---

## 4. Money in — contributions

### Setting what people owe

When the pool opens, one **contribution** of kind `regular` is created per roster entity,
using the "each person puts in" amount. A custodian or admin can later change amounts
individually via **Set amounts** — which is how tiered dues work (2,000 / 500 / 200).

New participants joining a contributor pool automatically get a contribution for the
current cycle at the default amount.

### Paying

People pay **outside the app** — UPI, bank transfer, cash — exactly as with settlements.
Then:

```
PENDING  ──contributor "Mark as paid" (+ amount, reference, note, proof)──►  INITIATED
INITIATED ──custodian "Confirm" (optionally a different received amount)──►  CONFIRMED
                                                                         └─►  PARTIAL   (received < expected)
INITIATED ──custodian "Reject" (with reason)──► back to PENDING
PENDING   ──custodian/admin "Waive" (with reason)──► WAIVED
```

Key behaviours:

- **Only confirmed money moves the balance.** A member marking themselves paid does not
  unblock the pool; the custodian confirming receipt does. This is the same two-sided
  confirmation as settlements, and it is deliberate.
- **The custodian's own dues confirm instantly.** Marking your own contribution (or top-up)
  paid as the custodian confirms it at once, because the money is already in your hands.
- **Partial payment is a first-class state**, because real people underpay.
- **Waived** covers *"he's covering it next month"*. A waived contribution carries no
  fair-share weight.
- Every transition appends an audit entry (actor, action, amount, note, reference, proof,
  status from → to).

### Top-ups

**Add money** records an ad-hoc contribution of kind `top_up` at any time — typically to
unpause a latched pool, or to pay off carried arrears. Top-ups count as money in but
**do not enlarge your stake**: they do not increase your fair-share weight, so they are
simply refunded at close.

### Arrears

The pool tab shows outstanding regular contributions per entity, highlighted. This is the
feature that actually sells recurring funds.

---

## 5. Money out — draws

A pool-funded expense is called a **draw**. There are two kinds, chosen on the expense form
via **Paid with**:

| Paid with | `fundingSource` | What it means | Effect |
|---|---|---|---|
| **Pool funds** | `pool` | Paid directly with the pool's cash or card | Deducts on approval. No splits needed — the form has no split section. |
| **My money — claim it back** | `pool_reimbursement` | The spender used their own money and wants it back | Deducts on approval **and** creates a settlement leg paying the claimant back |
| **My money — split it** *(hybrid only)* | `self` | The classic peer-to-peer expense | Unchanged |

### Who may draw

- the **custodian**
- any user in `authorizedSpenders`
- any member of a group in `authorizedSpenderGroups`

Optional **per-spender caps** limit how much each spender (user or group) may draw. The
**Spenders** tab is where a sponsor ticks *Can spend* and sets limits.

### Receipts

- `receiptRequiredAboveMinor` — a receipt is mandatory on pool draws above this amount.
  `0` means always; `null` means never. Sponsor budgets default to **always**.
- `claimReceiptRequired` — reimbursement claims must carry a receipt. Defaults to **true**.

Attempting a pool spend without a required receipt is refused
(`POOL_RECEIPT_REQUIRED` → *"Attach a receipt to record this."*).

### Approval

`expenseApproval` is `none`, `above_threshold` (with an amount), or `always`. While a draw
is `pending` it does **not** deduct; it shows in the custodian's **Waiting for your
approval** queue with the receipt thumbnail and one-tap approve/reject.

### Nobody approves their own spending

⚠️ **A manager cannot approve their own pool expense — except the custodian, because it is
their money.** Attempting it returns
`403 POOL_SELF_APPROVAL`: *"You can't approve your own expense. Ask the custodian or another
admin."*

The same rule decides **auto-approval**: a manager's own new expense is auto-approved only
if they are the custodian. An ordinary admin's own spend goes into the pending queue for
someone else to decide.

*Code: `canApproveDraw(approverId, payerId, custodianUserId, approverIsManager)` in
`libraries/shared/src/pool.ts`.*

On **approve**:
- a `pool` draw simply starts deducting
- a `pool_reimbursement` claim creates a **Pool payment** leg (custodian → claimant), which
  the custodian pays and the claimant confirms. If the custodian filed the claim themselves,
  no leg is needed (`selfReimbursed`).

On **reject**, the draw never deducts and the reason is recorded.

### Reimbursement progress

An approved claim shows how far its pay-back has got, derived from the claim plus its leg:

| Status | Meaning |
|---|---|
| **To reimburse** | approved, leg not yet paid |
| **Reimbursement sent** | the leg is `initiated` — the custodian has paid, awaiting the claimant's confirmation |
| **Reimbursed** | the leg is `completed`, or the custodian self-reimbursed |

Mobile and web also surface a one-line summary of what is waiting on *you* —
e.g. *"1 payment to confirm · 2 payments to make"*.

*Code: `reimbursementStatus()`, `REIMBURSEMENT_STATUS`, `poolPaymentActionsText()` in
`pool-ui.ts`; `poolPaymentActions()` in `index.ts`.*

---

## 6. Graduated overdraft — the "what if we overspend?" answer

Spending past the pool balance is **allowed with a warning down to 20% of the pool's value,
then paused** until money is added.

```
baseline  B  = the pool's value this cycle (default: opening + confirmed contributions + top-ups)
tolerance T  = floor(B × 20%)
floor        = −T
balance      = opening + confirmed in − approved out     (always derived, never stored)
```

Three zones, shown as a three-segment balance meter:

| Zone | Condition | Meter | Caption |
|---|---|---|---|
| **healthy** | balance > 0 | green | *"₹14,500 left of ₹53,400"* |
| **overdrawn** | balance ≤ 0 but above the floor | amber | *"Overdrawn ₹4,600 · ₹6,080 of overdraft headroom left"* |
| **blocked** | at/below the floor, or latched | red | *"Pool spending is paused — add more than ₹5,000 to resume"* |

### The latch

Reaching the floor **pauses** pre-authorised spending, and it stays paused until the balance
rises **above** `overdraftClearancePercent × B` — default `0`, meaning the whole overdraft
must be repaid *plus more*. A partial top-up therefore cannot unlock an equal-sized spend:
₹500 in does not unlock ₹500 out. Release is automatic once confirmed money lifts the
balance.

Set `overdraftClearancePercent > 0` only if you want to stop **dribbling** (top up ₹500,
spend ₹500, blocked again).

### Pre-authorisation vs recording — the distinction that matters

| Situation | Behaviour |
|---|---|
| *"I'm about to spend from the pool card"* — a pre-authorised `pool` draw | **Refused** past the floor. A limit a single large expense can blow through is not a limit. |
| *"I already paid the electricity bill"* — `alreadyIncurred`, or a reimbursement claim | **Recorded, flagged, custodian notified.** Refusing to record real money that already moved makes the ledger wrong, which is worse than an overdraft. |

So when a draw is refused, the UI offers **"It's already paid — record it anyway"**, which
saves it with a flag (`exceeds_tolerance`, `exceeds_spender_cap`, or `underfunded`) and
alerts the custodian.

### Headroom moves with the baseline

More confirmed money in means a bigger baseline, a bigger tolerance, and more headroom —
so the pool heals itself with no manual unblock step. The UI shows this live rather than
caching it.

### Worked example (a household fund)

```
opening balance                    ₹  8,400
confirmed contributions            ₹ 45,000
──────────────────────────────────────────
baseline  B                        ₹ 53,400
tolerance T = 20% of B             ₹ 10,680
floor                              ₹−10,680   → total spend permitted ₹64,080 (120% of B)

spent so far                       ₹ 58,000
balance                            ₹ −4,600   ⚠ overdrawn, ₹6,080 of headroom left

→ ₹4,000 repair bill   projected −₹8,600    ✅ allowed, warned
→ ₹9,000 repair bill   projected −₹13,600   ⛔ refused (needs ₹2,920 more in the pool)

Dev pays his ₹15,000 → B = ₹68,400, T = ₹13,680, balance +₹10,400 → healthy again
```

---

## 7. Transparency — the pool tab

The pool tab (web) / pool screen (mobile) is the feature that sells recurring funds. It
shows, for the selected cycle:

- **Header**: preset noun + cycle label, e.g. *"Fund · September 2026"*
- **Balance meter** with its one-line caption
- **Totals**: opening · collected · spent · remaining
- **Funding banner** — progress toward a target, for Collections and Budgets
- **Arrears** — who hasn't paid, highlighted
- **Waiting for your approval** — the custodian's draw queue
- **Pool payments** — reimbursement / cycle / leaver legs, with pay and confirm actions
- **Contributions** — the roster with per-entity status chips (*Not paid · Awaiting
  confirmation · Part paid · Confirmed · Waived*) and mark-paid / confirm / reject / waive
  actions
- **Spenders** — spend per spender against their cap (sponsor budgets)
- **Ledger** — every movement in chronological order: who, when, how much, signed
  (money in positive, money out negative), with receipt thumbnails, flags, and whether the
  entry currently counts toward the balance
- **Cycle history** — past cycles with their closing balances and reconciliations

Actions available to a custodian/admin, by preset:

| Button | When it appears |
|---|---|
| **Add money** | always |
| **Set amounts** | contributor pools |
| **Close \<cycle label\>** | recurring pools |
| **Settle up** / **Finish & report** (sponsor) | event admin, event `active` |

The balance is **always derived**, never stored as a mutable running total. A corrected or
deleted expense therefore self-heals the balance instead of leaving the ledger wrong.

---

## 8. Closing a cycle (recurring pools)

**Close \<Month\>** is *bookkeeping*, not a payment event. The flow:

1. A **preview** reconciles without committing, and shows each entity's carried credit or
   debt.
2. If the cycle closed **short**, the preview asks *"the pool closed ₹6,600 short — who
   covered it?"* (defaulting to the custodian, re-attributable or splittable). This records
   an `overdraft_cover` contribution so the coverer is credited rather than being charged a
   share of spend they personally financed. **A cycle cannot close with an uncovered
   deficit.**
3. On confirm, the cycle is closed with a reconciliation snapshot, each entity's net
   position becomes their **opening credit** in the new cycle, the balance carries forward,
   and fresh dues are created.
4. The event stays `active`. **No money moves. No settlement legs.**

Under `carry_forward` (Fund, Treasury) this is the normal path. Under refund policies
(Kitty, Collection) a close settles instead of carrying.

---

## 9. Membership changes

| Pool kind | Behaviour when someone joins or leaves |
|---|---|
| **Fund** (`membershipChangeClosesCycle: true`) | Once money has moved, the current cycle **closes** and the leaver is squared up now through a **Pool payments** *Leaving settlement* — paid to them if they're in credit, paid by them if they owe. Everyone else carries forward into a continuing cycle labelled *"(from \<date\>)"*. In an untouched cycle the roster simply updates — no empty cycles while flatmates trickle in. |
| **Treasury**, **Kitty**, **Collection** | The roster updates; no cycle boundary. Nobody expects a refund mid-stream, and a kitty leaver who already consumed should not be retroactively refunded. In single-cycle pools the roster only ever grows. |
| A member leaving a **group** | Does **not** settle the group. |
| The **custodian** | Cannot leave. A new custodian must be assigned first. |

---

## 10. Settling up — the final reconcile

**Settle up** (contributor pools) / **Finish & report** (sponsor budgets):

1. The pool is reconciled for **dissolution** — always settle, never carry.
2. Each entity's net position is computed as
   `opening + contributed − fairShare + cover`.
3. **Fair shares are weighted by agreed commitment, not by what was actually paid.** A
   member who paid nothing still bears their full share and correctly ends up owing. (Weighting
   by what was paid would let a non-payer escape their share — this was changed during
   implementation precisely because of that.)
4. The custodian is debited for the cash they are holding, so the balances sum to zero.
5. Those net positions become `Balance[]` — identical semantics to peer-to-peer balances —
   and, merged with any peer-to-peer expense balances in a hybrid event, are fed into the
   **existing** greedy settlement engine.
6. From there the event follows the normal lifecycle: `review → payment → settled → closed`,
   with the existing pay/confirm/proof/audit machinery.

> No new settlement algorithm. No new payment rails. No new payment UI.

**Sponsor budgets** are the exception worth stating plainly: there is no inter-participant
settlement. Nobody owes anyone; the unspent budget stays with the sponsor; the event goes to
settled with a final report (*budgeted ₹8,00,000, spent ₹7,42,300, unspent ₹57,700*).

---

## 11. Refusal messages the user will see

| Code | Message |
|---|---|
| `POOL_OVERDRAFT_BLOCKED` | *"This would go past the overdraft limit. Add at least ₹X to the pool to allow it."* — or, if latched: *"Spending is paused until the overdraft is repaid. Add more than ₹X to resume."* |
| `POOL_INSUFFICIENT_FUNDS` | *"Not enough money in the pool. Add at least ₹X first."* |
| `POOL_UNDERFUNDED` | *"The collection hasn't reached its target yet (₹X still to collect)."* |
| `POOL_SPENDER_CAP` | *"This would take you over your spending limit for this pool."* |
| `POOL_RECEIPT_REQUIRED` | *"Attach a receipt to record this."* |
| `POOL_SELF_APPROVAL` | *"You can't approve your own expense. Ask the custodian or another admin."* |
| `POOL_PENDING_DRAWS` | *"Approve or reject pending pool expenses before settling up"* |

The first five are refusals of a **draw**; all but `POOL_RECEIPT_REQUIRED` offer
**"It's already paid — record it anyway"**. `POOL_SELF_APPROVAL` and `POOL_PENDING_DRAWS`
are refusals of an **action**, and are not overridable.

*Code: `describePoolRefusal()` / `canRecordAnyway()` in `libraries/shared/src/pool-ui.ts`.*

---

## 12. What pooling deliberately does **not** do

- **No automatic cycle closing.** A custodian or admin closes cycles; there is no scheduler.
- **No email or push notifications** for pool events — in-app and WebSocket only.
- **No Pro gating.** Consumption-weighted deficits were considered as a Pro differentiator
  and left open as a product decision.
- **No separate pool ledger.** It is the same expense collection with a funding dimension.
- **No "Several of us" in production yet** — a first-release gate, not a limitation (§2).

---

## 13. Settle-up safety rails

Two refusals exist specifically so an event cannot be settled with pool money unaccounted
for:

1. **Pending draws block settle-up.** `POOL_PENDING_DRAWS` — *"Approve or reject pending pool
   expenses before settling up"*. An undecided draw has no agreed effect on the balance, so
   reconciling around it would be arbitrary.
2. **Approved claims are given their leg before reconciling.** At dissolution the service
   walks every approved `pool_reimbursement` that is not `selfReimbursed` and creates its leg
   if missing — *"settling with an approved claim that has no leg would close the event
   without paying the claimant back."*

A claim can also reference a leg that no longer exists (data written before an edit replaced
`poolDraw` kept the removed leg's id), so leg existence is **checked in Firestore**, not
inferred from the presence of `settlementId`.

---

**Sources:** `libraries/shared/src/pool.ts`, `pool-math.ts`, `pool-ui.ts` ·
`apps/api/src/services/pool.service.ts` · `apps/api/src/routes/pools.ts` ·
`apps/api/src/validation/pool.schemas.ts` ·
`apps/web/src/components/pool/*` · `apps/mobile/src/screens/PoolScreen.tsx` ·
`apps/mobile/src/components/pool/PoolViews.tsx` ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` ·
`traxettle-app/docs/runbook/MONEY_POOLING_TESTING.md`
