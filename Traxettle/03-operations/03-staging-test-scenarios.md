# Staging Test Scenarios

Detailed, numbered manual test scenarios for verifying Traxettle — with emphasis on the
**money-pooling** feature on `feature/money-pooling`.

**Prerequisite:** you are running per
[`02-staging-verification-guide.md`](02-staging-verification-guide.md) (Path A recommended).

---

## How to use this document

- Scenarios are grouped: **A** regression (the original model must be untouched),
  **B–G** pooling use cases, **H** cross-surface & real-time, **I** entitlements,
  **J** access control, **K** edge cases.
- Each step states the **action** and the **expected result**. Anything marked ⚠️ is a
  known-sharp edge where a bug would be easy to miss.
- **Use INR and round numbers** so you can verify the arithmetic in your head.
- Record results in the table at the end.

### Test personas

| Persona | Token (web console) | Role in most scenarios |
|---|---|---|
| **Alice** | `mock-alice` | event creator, admin, custodian |
| **Bob** | `mock-bob` | contributor / spender |
| **Carol** | `mock-carol` | second contributor, or a leaver |

Switch persona on web:

```js
localStorage.setItem('traxettle.authToken', 'mock-bob');
localStorage.setItem('traxettle.uid', 'mock-bob');
location.reload();
```

Use separate browser profiles / incognito windows to be two people at once. On mobile, use a
real staging account and drive the other personas from web.

Add a persona to an event Alice created:

```bash
curl -X POST http://localhost:3001/api/events/<eventId>/participants \
  -H 'Authorization: Bearer mock-alice' -H 'Content-Type: application/json' \
  -d '{"userId":"mock-bob"}'
```

### ⚠️ Environment gate before you start

**"Several of us" pools are hidden in production builds.** Scenarios **B, D, E, F** and the
contributor half of **G** require `APP_ENV` to be `local`, `development`, `staging` or
`internal`. On a production build, picking "Pool money" goes straight to **Just me**, so only
scenario **C** is reachable.

Confirm which you are on before blaming a missing option:

```bash
curl -s <api-base>/api/config | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['env'])"
```

### Scenario 0 — automated smoke first

```bash
node scripts/local-dev/pool-smoke.mjs
```

**Expect:** every line `PASS`, ending `ALL LIVE CHECKS PASSED`, exit 0.
It covers kitty creation, contributions, receipt upload, a pool draw, the graduated-overdraft
refusal, the "already paid" override, access control and the settle-up plan. If this fails,
stop and fix the environment before manual testing.

---

## A · Regression — split-expenses events must be unchanged

> The whole design rests on *"absent means default"*. If anything here behaves differently,
> that is the highest-severity class of bug in this release.

### A1 — Create a plain split event

| # | Action | Expected |
|---|---|---|
| 1 | Create event → **Funding: Split expenses** (the default), name "Plain Trip", type Trip, currency INR | Created |
| 2 | Open the event | ⚠️ **No pool tab.** Tabs are exactly Expenses · Participants · Groups · Invitations |
| 3 | Inspect the event via API: `curl localhost:3001/api/events/<id> -H "$AUTH"` | ⚠️ `fundingModel` is **absent** from the document — not `"peer_to_peer"` |
| 4 | Add expense ₹1,200, split equally with Bob | ⚠️ **No "Paid with" control** on the form. Splits are required |
| 5 | Inspect the expense | ⚠️ `fundingSource` is **absent** |

### A2 — The classic lifecycle still works

| # | Action | Expected |
|---|---|---|
| 1 | Add 3 expenses with different payers and split types (equal / ratio / custom) | Each saves; a custom split that doesn't sum to the total blocks submit with a mismatch message |
| 2 | Create a group with Bob + Carol, designated payer Bob; add an expense split onto the group | The group appears as **one** entity in the split |
| 3 | Mark one expense **Private** as Alice | As Bob, that expense is **not visible at all** (filtered server-side, not merely hidden) |
| 4 | Add an expense with **On behalf of** Bob, paid by Alice | Alice's own share is **0**; the splits exclude Alice |
| 5 | Attach a receipt (image and a PDF, each ≤5 MB) | Both upload and display |
| 6 | **Settle** as Alice | Event → `review`; one approval row per entity; the plan has the minimum number of legs |
| 7 | Edit an expense while in `review` | ⚠️ Allowed, and the plan is flagged **stale** |
| 8 | **Regenerate** | A fresh plan; stale flag clears |
| 9 | All entities approve | Event → `payment`; attempting to add an expense now fails with `403 Forbidden … Payments are in progress` |
| 10 | Payer marks a leg paid with a reference + proof image | Leg → `initiated`; the payee's payment methods were visible to the payer beforehand |
| 11 | Payee **rejects** with a reason | Leg returns to `pending` with the reason; the audit trail shows both transitions |
| 12 | Payer marks paid again; payee **confirms** | Leg → `completed` |
| 13 | Complete every leg | Event auto-transitions → `settled` |
| 14 | Admin **closes** the event | Disappears from the dashboard; appears in **Closed events** |
| 15 | Export the closed event to CSV and print-preview it | Both produce correct content |

### A3 — Zero-balance shortcut

| # | Action | Expected |
|---|---|---|
| 1 | Create an event; add one expense paid by Alice, split 100% onto Alice | Balances all zero |
| 2 | Settle | Event goes **straight to `settled`**, skipping review/payment; admin can close immediately |

---

## B · UC-3 Trip kitty — start here for pooling

The highest-volume case and the easiest to reason about.

### B1 — Create and read the empty kitty

| # | Action | Expected |
|---|---|---|
| 1 | Create event → **Pool money → Several of us → Kitty**, currency INR, "Each person puts in" = **10,000** | Created; you land on the **Kitty** tab |
| 2 | Read the meter | *"Nothing in the pool yet — add money to start spending"*, neutral/grey, `data-zone="blocked"` |
| 3 | Read your own contribution row | **Not paid**, expected ₹10,000 |
| 4 | `GET /api/pools/event/<id>/summary` | `balanceMinor: 0`, `overdraft.baselineMinor: 0`, `overdraft.toleranceMinor: 0`, `overdraft.zone: "blocked"` — ⚠️ with nothing in the pool, a `graduated` policy correctly behaves like `block` |
| 5 | Verify the event document | `fundingModel: "pool"`, `poolConfig.preset: "trip_kitty"`, `surplusPolicy: "refund_pro_rata"`, `deficitPolicy: "collect_pro_rata"`, `overdraftPolicy: "graduated"`, `overdraftTolerancePercent: 20` |

### B2 — Contributions

| # | Action | Expected |
|---|---|---|
| 1 | Add Bob as a participant | ⚠️ Bob automatically gets a **₹10,000 contribution** for the current cycle |
| 2 | As Alice (the custodian), **Mark as paid** your own contribution | ⚠️ **Confirmed immediately** — no separate confirm step, because the money is already in the custodian's hands. Balance → ₹10,000 |
| 3 | As Bob, **Mark as paid** with a reference and a proof image | Status → **Awaiting confirmation**. ⚠️ Balance is **still ₹10,000** — only the custodian's confirmation moves it |
| 4 | As Alice, **Reject** Bob's payment with a reason | Bob's row returns to **Not paid**; the reason and both transitions are in the audit trail |
| 5 | As Bob, mark paid again; as Alice **Confirm** | Status → **Confirmed**. Balance → **₹20,000**. Meter green: *"₹20,000 left of ₹20,000"* |
| 6 | Add Carol; as Alice **Confirm** only **₹4,000** of her ₹10,000 | ⚠️ Status → **Part paid**; balance → ₹24,000; **Arrears** shows Carol ₹6,000 |
| 7 | As Alice, **Waive** Carol's contribution with a reason | Status → **Waived**. ⚠️ Arrears no longer lists her, and her commitment weight drops out of fair-share calculations |

### B3 — Pool spending and the graduated overdraft

Reset to a clean state: Alice ₹10,000 confirmed, Bob ₹10,000 confirmed ⇒ baseline
**₹20,000**, tolerance **₹4,000**, floor **−₹4,000**.

| # | Action | Expected |
|---|---|---|
| 1 | **Add expense → Paid with: Pool funds**, ₹23,000 | ⚠️ The form has **no split section**. A warning says it goes into overdraft. **It saves.** |
| 2 | Read the meter | Amber. *"Overdrawn ₹3,000 · ₹1,000 of overdraft headroom left"* |
| 3 | Add another pool expense of **₹2,000** | ⚠️ **Refused**: *"This would go past the overdraft limit. Add at least ₹1,000 to the pool to allow it."* API: `400/403` with `code: POOL_OVERDRAFT_BLOCKED` and `data.shortfall: 100000` |
| 4 | Click **"It's already paid — record it anyway"** | Saved **and flagged**. The expense carries `poolFlags: ["exceeds_tolerance"]` |
| 5 | As Alice (custodian), check for an alert | A `pool:alert` socket event arrived with the flags; the flagged expense is marked in the ledger |
| 6 | Read the meter | Red, `data-zone="blocked"`: *"Pool spending is paused — add more than ₹5,000 to resume"* |
| 7 | **Add money** ₹4,000 (a top-up, self-confirmed as custodian) | ⚠️ **Still paused.** A partial top-up must not unlock an equal-sized spend — this is the latch |
| 8 | **Add money** ₹2,000 more | Spending **resumes automatically**; meter back to amber/green. No manual unblock step |
| 9 | Try a normal pool expense of ₹500 | Allowed |

> **Arithmetic to verify at step 6:** balance is `20000 + 4000(top-up later) − 23000 − 2000`.
> After step 4: `20000 − 25000 = −5000`, floor is `−4000`, so it is past the floor ⇒ latched.
> Clearance threshold is `0%` of baseline = `0`, so the balance must rise **above 0**:
> `−5000 → +1` needs **more than ₹5,000**. Exactly what the caption says.

### B4 — Receipts and ledger transparency

| # | Action | Expected |
|---|---|---|
| 1 | Open the **Ledger** | Every movement in chronological order: contributions positive, draws negative, each with who/when/amount, receipt thumbnails, flags, and whether it currently `counted` |
| 2 | Check the flagged expense row | Marked as flagged |
| 3 | Open **Spending by person** | Spend per spender (no caps set on a kitty) |
| 4 | Delete a pool expense | ⚠️ The balance **self-heals** — it is derived, not a stored running total. `pool:updated` fires with `reason: "draw_deleted"` |

### B5 — Settle up

| # | Action | Expected |
|---|---|---|
| 1 | Arrange: Alice contributed **₹15,000**, Bob **₹5,000**, pool spend **₹16,000** | Balance ₹4,000 |
| 2 | **Settle up** → read the preview (`close-preview` with `forDissolution: true`) | ⚠️ Fair shares **pro-rata to commitment**: Alice 0.75 × 16,000 = **₹12,000**; Bob 0.25 × 16,000 = **₹4,000**. Nets: Alice **+₹3,000**, Bob **+₹1,000**. Refunding ₹2,000 each would be the unfairness bug |
| 3 | If the pool closed short, the preview asks *"who covered the shortfall?"* | Defaults to the custodian; re-attributable/splittable. ⚠️ You **cannot** confirm with an uncovered deficit |
| 4 | Confirm | Event → `review`; one combined settlement plan; the cycle is closed with its reconciliation visible in **Cycle history** |
| 5 | Approve → pay → confirm every leg | Event → `settled` |
| 6 | Verify the invariant | Σ of all entity nets equals the closing balance (the API throws if not) |

### B6 — The non-payer must still owe

⚠️ This is the single most important fairness check in the release.

| # | Action | Expected |
|---|---|---|
| 1 | Alice ₹10,000 **confirmed**; Bob ₹10,000 **pending** (never paid, not waived) | Balance ₹10,000 |
| 2 | Pool spend ₹8,000 | Balance ₹2,000 |
| 3 | **Settle up** → preview | ⚠️ Fair shares are weighted by **agreed commitment** (₹10,000 each ⇒ ₹4,000 each), **not** by what was paid. Alice net `+10,000 − 4,000 = +₹6,000`; Bob net `0 − 4,000 = −₹4,000` ⇒ **Bob owes ₹4,000** |
| 4 | Compare with a **waived** Bob | His commitment drops out: Alice bears the whole ₹8,000, net `+₹2,000`; Bob owes nothing |

---

## C · UC-2 Sponsor budget (a wedding)

### C1 — Create and authorise spenders

| # | Action | Expected |
|---|---|---|
| 1 | Create event → **Pool money → Just me**, total budget **8,00,000** | Tabs are **Budget · Expenses · Spenders** — ⚠️ no Participants/Groups/Invitations tabs |
| 2 | Verify the config | `funderMode: "sponsor"`, `preset: "sponsor_budget"`, `surplusPolicy: "retain"`, `deficitPolicy: "custodian_absorbs"`, `receiptRequiredAboveMinor: 0` (always), `expenseApproval: "always"` |
| 3 | Invite Bob and Carol | They join as spenders, **not contributors** |
| 4 | **Spenders** tab → tick **Can spend** for Bob, set a cap of **2,00,000**. Save | Saved to `authorizedSpenders` and `spenderCapsMinor` |
| 5 | A single self-contribution of ₹8,00,000 should exist, confirmed | Budget meter: *"₹8,00,000 left of ₹8,00,000"* |

### C2 — Reimbursement claims

| # | Action | Expected |
|---|---|---|
| 1 | As **Bob**: Add expense → **My money — claim it back**, ₹50,000, **no receipt** | ⚠️ **Refused**: *"Attach a receipt to record this."* (`POOL_RECEIPT_REQUIRED`) — and this refusal has **no** "record it anyway" option |
| 2 | Retry with a receipt attached | Saved as `pending`. Bob sees *"Waiting for your approval"* |
| 3 | As **Alice** (sponsor): open **Waiting for your approval** | The claim with its receipt thumbnail and one-tap approve/reject |
| 4 | **Reject** with a reason | ⚠️ Balance **unchanged** — only approved draws deduct. Reason recorded |
| 5 | Bob re-files; Alice **Approves** | Budget drops by ₹50,000. ⚠️ A **Pool payments** row appears: *You → Bob, Reimbursement*, status ⚠️ **To reimburse** |
| 6 | Alice marks the leg paid | ⚠️ Status becomes **Reimbursement sent** |
| 7 | Bob confirms receipt | ⚠️ Status becomes **Reimbursed**. The event ⚠️ **stays `active`** — pool side legs do not drive the lifecycle |
| 8 | Verify the leg | `kind: "pool_reimbursement"`, with `expenseId` pointing at the claim |
| 9 | Check the "waiting on you" line on each surface | e.g. *"1 payment to confirm"* for Bob, *"1 payment to make"* for Alice; disappears when nothing is outstanding |

### C2a — Nobody approves their own spending ⚠️ new

| # | Action | Expected |
|---|---|---|
| 1 | Make **Carol** an event **admin** (so she is a pool *manager* but not the custodian) | |
| 2 | As Carol, add a pool expense with approval required | ⚠️ It lands as **`pending`** — a manager's own draw is **not** auto-approved unless they are the custodian |
| 3 | As Carol, try to **approve her own** expense | ⚠️ **Refused `403 POOL_SELF_APPROVAL`**: *"You can't approve your own expense. Ask the custodian or another admin."* |
| 4 | As Alice (the custodian), approve Carol's expense | Allowed |
| 5 | As Alice, add her **own** pool expense | ⚠️ **Auto-approved** — the custodian is the exception, because it is their money |
| 6 | Try to approve a draw that is already approved/rejected | `409 Cannot approve: this draw is <status>` |

### C3 — Caps and direct pool spends

| # | Action | Expected |
|---|---|---|
| 1 | As Bob, claim another ₹1,80,000 (total 2,30,000 > his ₹2,00,000 cap) | ⚠️ **Refused** with `POOL_SPENDER_CAP`: *"This would take you over your spending limit for this pool."* Overridable with "already paid" |
| 2 | As **Carol** (not authorised), try any pool expense | **Refused** — not an authorised spender |
| 3 | As Alice, add a direct **Paid with: Pool funds** expense without a receipt | **Refused** — receipts are mandatory on budgets (`receiptRequiredAboveMinor: 0`) |
| 4 | As Alice, file a claim herself and approve it | ⚠️ `poolDraw.selfReimbursed: true`; **no settlement leg** is created |

### C4 — Finish & report

| # | Action | Expected |
|---|---|---|
| 1 | **Finish & report** | ⚠️ **Nobody owes anybody.** The unspent budget stays with the sponsor. Report shows budgeted / spent / unspent |
| 2 | Event status | → `settled` |

---

## D · UC-1 Shared-living fund (recurring)

### D1 — Create and collect

| # | Action | Expected |
|---|---|---|
| 1 | Create event → **Pool money → Several of us → Fund**, **15,000** per person per month | Config: `cycleMode: "recurring"`, `recurrence: "monthly"`, `surplusPolicy: "carry_forward"`, `membershipChangeClosesCycle: true`, `claimReceiptRequired: true` |
| 2 | Invite Bob and Carol | ⚠️ **No extra cycles are created** while nobody has paid — the roster just grows. There should be exactly **one** cycle |
| 3 | Everyone pays in; Alice confirms | Balance ₹45,000 |
| 4 | Add pool expenses: rent ₹30,000, electricity ₹4,200 **with a PDF receipt** | Both deduct; PDF renders in the ledger |
| 5 | Leave Carol's next-month contribution unpaid | Shows in **Arrears** |

### D2 — Close the month

| # | Action | Expected |
|---|---|---|
| 1 | **Close \<Month\>** → preview | Each person's carried credit/debt, computed with commitment weights |
| 2 | Confirm | ⚠️ A **new cycle opens**: `openingBalanceMinor` = previous closing balance, `openingCredits` per entity, fresh dues created. ⚠️ **The event stays `active` and no settlement legs are created** — this is bookkeeping, not a payment event |
| 3 | Verify `nextCycle.openingBalanceMinor === previousCycle.closingBalanceMinor` | Equal |
| 4 | Open **Cycle history** | The closed cycle with its reconciliation snapshot |

### D3 — Overspend before closing

| # | Action | Expected |
|---|---|---|
| 1 | Spend past the balance (accepting the overdraft), then **Close** | ⚠️ The preview asks **who covered the shortfall** |
| 2 | Attribute it to Alice and confirm | An `overdraft_cover` contribution is created, `confirmed`, for Alice. ⚠️ Alice's net goes **up** — she is credited for fronting it, not charged a share of spend she personally financed |
| 3 | Try to close leaving the deficit unattributed | ⚠️ **Refused** — `uncoveredDeficitMinor` must be 0 |

### D4 — A flatmate leaves

| # | Action | Expected |
|---|---|---|
| 1 | After money has moved, remove Carol | ⚠️ The current cycle **closes** (`closeReason: "membership_change"`). Carol is squared up now through **Pool payments** as a *Leaving settlement* — paid **to** her if in credit, **by** her if she owes (`kind: "pool_member_exit"`) |
| 2 | Everyone else | Carries forward into a continuing cycle labelled ⚠️ **"(from \<date\>)"** |
| 3 | Remove someone in a cycle where **no money has moved** | ⚠️ The roster just updates — **no** cycle boundary, no empty cycle |
| 4 | Try to remove **Alice**, the custodian | ⚠️ **Refused**: *"The custodian cannot leave the pool. Assign a new custodian first."* |
| 5 | Reassign the custodian to Bob, then remove Alice | Now allowed |
| 6 | Remove a member from a **group** inside the event | ⚠️ Does **not** settle the group |

---

## E · UC-4 Club treasury

| # | Action | Expected |
|---|---|---|
| 1 | Create → **Several of us → Treasury** | `cycleMode: recurring`, `surplusPolicy: carry_forward`, `membershipChangeClosesCycle: false` |
| 2 | **Set amounts** with tiers: Alice 2,000 / Bob 500 / Carol 200 | ⚠️ Per-entity amounts, not one flat figure |
| 3 | Add a new member mid-cycle | ⚠️ **No cycle boundary** — unlike the Fund |
| 4 | Close a cycle with a surplus | ⚠️ Surplus **always carries forward**; there is no dissolution/refund flow offered |
| 5 | Close a cycle with a deficit | ⚠️ Shared **pro-rata by tier (commitment)**, not by head-count. Alice bears the largest share |
| 6 | Export the cycle ledger | Correct per-cycle report |

---

## F · UC-5 Target collection

| # | Action | Expected |
|---|---|---|
| 1 | Create → **Several of us → Collection**, "Amount to collect" = **20,000** | `overdraftPolicy: "block"`, `overdraftBaseline: "target_amount"`, `requireFullFundingBeforeSpend: true` |
| 2 | With ₹8,000 collected, try a ₹5,000 pool expense | ⚠️ **Refused**: *"The collection hasn't reached its target yet (₹12,000 still to collect)."* (`POOL_UNDERFUNDED`) — even though there is "enough" money |
| 3 | Read the funding banner | Progress toward the target; chase-up list of who hasn't paid |
| 4 | Collect the full ₹20,000 | `funding.state: "funded"`; spending unlocks |
| 5 | Try a ₹25,000 pool expense | ⚠️ **Refused** with `POOL_INSUFFICIENT_FUNDS` — once funded, spending is capped at the balance (no overdraft tolerance at all) |
| 6 | Spend ₹18,000, then settle | Pro-rata refund of the ₹2,000, exactly like a kitty |

---

## G · UC-6 Hybrid

| # | Action | Expected |
|---|---|---|
| 1 | Create → **Pool money → Several of us → Kitty → Advanced → *Also allow regular split expenses*** | `fundingModel: "hybrid"` |
| 2 | Open the expense form | ⚠️ **Three** options under Paid with: *Pool funds* · *My money — claim it back* · *My money — split it* |
| 3 | Add a pool expense (villa ₹20,000) **and** a peer-split expense (Bob's spa ₹3,000 split with Carol) | Both save; the Expenses tab badges them by funding source |
| 4 | **Settle up** | ⚠️ **ONE** settlement plan covering **both** pool refunds and peer debts. Nobody settles twice |
| 5 | Verify the merge | Peer balances and pool nets were summed **per entity** before the planner ran |

### G2 — Convert an existing split event

| # | Action | Expected |
|---|---|---|
| 1 | Take a plain split event with existing expenses; `POST /api/pools/event/<id>/convert` with a preset | Event becomes `hybrid`; a pool tab appears |
| 2 | Inspect the pre-existing expenses | ⚠️ **Untouched** — still no `fundingSource`, still peer-to-peer |
| 3 | Try to convert again / convert back | ⚠️ One-way — conversion back is not offered |

---

## H · Cross-surface & real-time

Run with web + iOS + Android all pointed at the same API (guide §5).

| # | Action | Expected |
|---|---|---|
| 1 | On **web** as Alice, confirm a contribution | ⚠️ The **iOS** and **Android** pool screens update **without a manual refresh** (`pool:updated`, reason `contribution_confirm`) |
| 2 | On **iOS**, add a pool expense | Web's meter, totals and ledger update live; the dashboard tile's pool status changes |
| 3 | On **Android**, approve a draw | Web shows `expense:updated` + `settlement:updated` effects immediately |
| 4 | On web, generate a settlement | Mobile surfaces move to review in real time (`settlement:generated`, `event:updated`) |
| 5 | On web, close the event | ⚠️ It disappears from the other surfaces' dashboards immediately (`event:deleted`/`event:updated`) |
| 6 | Mobile: open an event → tap the **pool card** | Navigates to the Pool screen titled with the preset noun |
| 7 | Mobile: Add expense → **Paid with** + **Take photo / Choose photo** | Receipt captures and uploads |
| 8 | Mobile: the FAB on the Pool screen | Opens Create Expense for that event |

---

## I · Entitlements (Free vs Pro)

| # | Action | Expected |
|---|---|---|
| 1 | Set tier free: `POST /api/internal/entitlements/switch {"tier":"free"}` | `tier: free` |
| 2 | Create an event with a **settlement currency different from** the expense currency | ⚠️ `403` with `code: "FEATURE_REQUIRES_PRO"`, `feature: "multi_currency_settlement"`; the UI routes to the Pro page |
| 2a | ⚠️ As a free, **non-`mock-`** user, create a 4th `active`/`closed` event | ⚠️ `403 "Free users can have at most 3 active or closed events/trips"`. Note `mock-` users are **exempt**, so this must be tested with a real account |
| 2b | ⚠️ Set `tier: 'pro'` with `entitlementStatus: 'expired'`, then retry 2 and 2a | ⚠️ Both are refused — a **lapsed** Pro counts as free (`hasActivePro()`) |
| 3 | Switch to pro | Same action now succeeds |
| 4 | With two browser tabs open, switch tier in one | ⚠️ The other tab's capabilities refresh **without a reload** (`user:tier-updated`) |
| 5 | Create a USD event settling in INR with `fxRateMode: eod` | Legs carry `amount` + `settlementAmount` + `fxRate`; the UI shows both currencies and the rate |
| 6 | Try the same with `fxRateMode: predefined` and a typed rate | Uses your rate, including the reverse direction |
| 7 | Verify pooling is **not** Pro-gated | A free user can create and use every pool preset |

---

## J · Access control

| # | Action | Expected |
|---|---|---|
| 1 | As a **non-participant** (`mock-dave`), `GET /api/events/<id>` | `403` / `404` — not a participant |
| 2 | As a non-participant, `GET /api/pools/event/<id>/summary` | Refused |
| 3 | As a non-participant, `POST /api/expenses` for that event | ⚠️ Refused — membership is required to **create**, not just to read |
| 4 | As a plain member, try to invite someone / change a role / delete the event | Refused — admin only |
| 5 | As a non-custodian non-admin, try `contributions/:id/confirm` or `expenses/:id/approve` | Refused |
| 6 | As Bob, try to mark **Alice's** settlement leg paid | Refused — only `fromUserId` may pay |
| 7 | As Alice, try to confirm a leg where she is the payer | Refused — only `toUserId` may confirm |
| 8 | Alice marks an expense private; Bob lists event expenses | ⚠️ Absent from the response payload entirely |
| 9 | Upload a contribution proof as someone who is neither the contributor nor the custodian | `403` |
| 10 | Send a pool write with an **unknown field** | ⚠️ `400 VALIDATION_ERROR` — the zod schemas are `.strict()` |
| 11 | Send `expectedMinor: 10.5` (non-integer) | `400` — minor units must be integers |

---

## K · Edge cases and arithmetic

| # | Action | Expected |
|---|---|---|
| 1 | Create a **JPY** pool with per-person 10,000 | ⚠️ Zero-decimal currency: `toMinor(10000,'JPY') === 10000`. Amounts display without decimals |
| 2 | Contribute amounts that don't divide evenly (3 people, spend ₹1,000) | ⚠️ Fair shares sum to **exactly** ₹1,000 (largest-remainder allocation) — e.g. 333.34 / 333.33 / 333.33 |
| 3 | A pool expense in a **different currency** from the pool | ⚠️ Refused: *"Pool expenses must be in the pool currency (INR)"* |
| 4 | Change a pool expense's **amount** after approval | Re-runs the overdraft check against the new amount |
| 5 | Try to change a pool expense's **`fundingSource`** | ⚠️ Refused: *"How an expense was paid cannot be changed. Delete it and add it again."* |
| 6 | Delete an approved reimbursement claim | The linked settlement leg is removed too |
| 6a | ⚠️ **Edit** an approved claim's amount, then settle up | ⚠️ The claim stays **payable**: dissolution re-creates its leg because leg existence is checked in Firestore, not inferred from `settlementId` |
| 6b | ⚠️ Settle up with a **pending** draw outstanding | ⚠️ Refused `409 POOL_PENDING_DRAWS`: *"Approve or reject pending pool expenses before settling up"* |
| 6c | ⚠️ Set a spender cap, save, then **clear** it and save again | ⚠️ The cap is really gone (config is written with `update()`, not a merge, so removed keys do not come back) |
| 7 | Try to add a pool expense to a **closed** cycle | Refused |
| 8 | Try any pool mutation while the event is in `payment`/`settled`/`closed` | Refused — the event lock applies to pool mode too |
| 9 | Zero-amount or negative expense | `400 "Amount must be greater than zero"` |
| 10 | A receipt larger than 5 MB | Refused by the uploader |
| 11 | An unsupported file type as a receipt | Refused by the MIME allowlist |
| 12 | A `graduated` pool with **nothing** in it | ⚠️ Behaves as `block` (baseline 0 ⇒ tolerance 0 ⇒ floor 0) |
| 13 | Set `overdraftClearancePercent: 10` via config, then latch the pool | Requires recovery to +10% of baseline before resuming — stops "dribbling" |
| 14 | An invitation older than 7 days | Marked `expired`; cannot be accepted |
| 15 | `GET /api/invitations/token/<token>` while signed out | ⚠️ Works — it is deliberately public so invite links work pre-sign-in |

---

## L · Non-pool features worth a pass

| Area | Checks |
|---|---|
| **Auth** | register · login · forgot password · Google sign-in · email-link send + complete · password visibility toggle · logout · revoke all sessions (another device's token stops working immediately) · concurrent sessions allowed |
| **Profile** | update display name · add/edit/delete payment methods of each type · themes (light/dark/ocean/forest) · account deletion |
| **Mobile security** | set a PIN · lock on background · unlock by PIN · unlock by biometric |
| **Unsettled payments** | cross-event summary + detail · CSV/print export · deep-link into the event |
| **Closed events** | history list · CSV/print export · history by email |
| **Groups** | create · update · transfer representative · reuse across events · ≥70% overlap suggestion · group-as-entity in splits and settlements |
| **Onboarding** | guided tour (web) · guided walkthrough (mobile) |
| **Help** | Help page / screen renders |
| **UX** | no browser `alert`/`confirm` anywhere · all destructive actions use themed modals · toasts on every action · status badge colours identical on dashboard and detail |

---

## M · Automated suites to run alongside

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush

(cd libraries/shared && npm test)   # pool maths incl. randomised invariants
(cd libraries/ui && npm test)
(cd apps/api && npm test)           # pools.flows, pools.recurring, pool.service, upload.service, regression
(cd apps/web && npm test)           # __tests__/pool/* with coverage thresholds
(cd apps/mobile && npm test)        # ⚠️ 2 known pre-existing failures, see known-issues
(cd apps/api && npm run test:regression)

cd e2e && npx playwright test        # needs API + Web running
cd apps/mobile && npm run test:maestro:ios      # or :android
```

Details: [`06-testing-and-qa.md`](06-testing-and-qa.md).

---

## Results log

| Scenario | Surface | Result | Notes |
|---|---|---|---|
| 0 smoke | API | | |
| A1 split event untouched | web | | |
| A2 classic lifecycle | web | | |
| A3 zero-balance | web | | |
| B1 kitty created | web | | |
| B2 contributions | web | | |
| B3 overdraft + latch | web | | |
| B4 ledger | web | | |
| B5 settle up pro-rata | web | | |
| B6 non-payer still owes | web | | |
| C1–C4 sponsor budget | web | | |
| C2a self-approval blocked | web | | |
| D1–D4 recurring fund | web | | |
| E treasury | web | | |
| F collection | web | | |
| G hybrid + convert | web | | |
| H cross-surface real-time | web+iOS+Android | | |
| I entitlements | web | | |
| J access control | API | | |
| K edge cases | API/web | | |
| L non-pool pass | all | | |
| M automated suites | CI | | |

---

**Sources:** `traxettle-app/docs/runbook/MONEY_POOLING_TESTING.md` §4 ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` §2, §3.7, §4 ·
`libraries/shared/src/{pool,pool-math,pool-ui}.ts` ·
`apps/api/src/services/pool.service.ts` · `apps/api/src/routes/{pools,expenses}.ts` ·
`apps/api/src/__tests__/routes/pools.flows.test.ts` ·
`apps/web/src/components/pool/*` · `apps/mobile/src/screens/PoolScreen.tsx` ·
`scripts/local-dev/pool-smoke.mjs` · `traxettle-app/docs/app/Functional.md`
