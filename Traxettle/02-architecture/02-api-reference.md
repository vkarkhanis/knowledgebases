# API Reference

Base URLs: see [`../03-operations/00-environments.md`](../03-operations/00-environments.md).
Local: `http://localhost:3001`.

**Every response** is an `ApiResponse<T>`:

```ts
{ success: boolean; data?: T; error?: string; message?: string; code?: string; feature?: string }
```

**Auth:** `Authorization: Bearer <token>`. Accepted token forms, in the order the middleware
tries them: `mock-<uid>` (local/test only) → a Traxettle-issued JWT → a Firebase ID token →
an emulator ID token. See [`07-auth-and-security.md`](07-auth-and-security.md).

Legend: 🔓 public · 🔐 authenticated · 👥 participant · 🛡 event admin · 💰 custodian/admin ·
⭐ Pro-gated

---

## Infrastructure

| Method | Path | | Notes |
|---|---|---|---|
| GET | `/health` | 🔓 | `{ status: "OK", timestamp }` |
| GET | `/api/config` | 🔓 | Runtime config: `env`, `apiUrl` (derived from the request), `firebaseConfig`, `revenueCatConfig` |
| GET | `/auth/email-link` | 🔓 | HTML page that deep-links a Firebase email-link into the mobile app (`com.traxettle.app://auth/email-link?...`) |

---

## `/api/auth`

| Method | Path | | Body / notes |
|---|---|---|---|
| POST | `/register` | 🔓 | `{ email, password, displayName }` — bcrypt-hashed. Returns tokens + profile |
| POST | `/login` | 🔓 | `{ identifier, password?, provider? }` — `identifier` is email or phone |
| POST | `/forgot-password` | 🔓 | `{ email }` |
| POST | `/email-link/send` | 🔓 | `{ email }` — passwordless sign-in link |
| POST | `/email-link/complete` | 🔓 | `{ email, link?, oobCode? }` — completes via Identity Toolkit REST (needs `FIREBASE_WEB_API_KEY`) |
| POST | `/google` | 🔓 | `{ token }` — Firebase ID token from the client Google flow |
| POST | `/refresh` | 🔓 | `{ refreshToken }` → new access token |
| POST | `/logout` | 🔐 | Invalidates the current session |
| POST | `/revoke-sessions` | 🔐 | Revokes **all** of this user's sessions |
| POST | `/bootstrap-firebase` | 🔐 | `{ password? }` — creates/links the Firebase Auth user for an existing account |
| POST | `/send-otp` | 🔓 | ❌ returns "not available in phase 1" |
| POST | `/verify-otp` | 🔓 | ❌ returns "not available in phase 1" |
| POST | `/microsoft` | 🔓 | ❌ returns **410** |

Token lifetimes: access **1 h**, refresh **7 d**. Sessions are tracked at
`users/{uid}/sessions/{sessionId}`; a revoked session makes `requireAuth` return
`401 AUTH_SESSION_REVOKED`.

---

## `/api/users`

| Method | Path | | Body / notes |
|---|---|---|---|
| GET | `/profile` | 🔐 | Full `UserProfile` incl. `tier`, `entitlementStatus`, derived `capabilities`, `paymentMethods` |
| PUT | `/profile` | 🔐 | `Partial<UserProfile>` — display name, preferences |
| GET | `/payment-methods` | 🔐 | `UserPaymentMethod[]` |
| POST | `/payment-methods` | 🔐 | `{ label, currency, type, details, isActive? }` — `type`: `upi\|bank\|paypal\|wise\|swift\|other` |
| PUT | `/payment-methods/:methodId` | 🔐 | Partial update of the same fields |
| DELETE | `/payment-methods/:methodId` | 🔐 | |
| DELETE | `/account` | 🔐 | Account deletion with cascade over the user's events/expenses |
| GET | `/debug/entitlement` | 🔐 | Diagnostic entitlement dump |

---

## `/api/events`

| Method | Path | | Body / notes |
|---|---|---|---|
| GET | `/` | 🔐 | Events the user created or participates in. Closed events excluded from the dashboard view |
| POST | `/` | 🔐 ⭐ | `CreateEventDto` — see below. ⚠️ Also enforces the **free-tier quota**: a non-Pro user with ≥3 `active`-or-`closed` events gets `403`. Uses `hasActivePro()`, so a **lapsed** Pro counts as free; `mock-` users are exempt |
| GET | `/:eventId` | 👥 | |
| PUT | `/:eventId` | 🛡 ⭐ | `UpdateEventDto` incl. `status` transitions |
| DELETE | `/:eventId` | 🛡 | Blocked for `settled`/`closed`. Cascades expenses, settlements, invitations, participants |
| GET | `/:eventId/participants` | 👥 | `EventParticipant[]` with display names resolved |
| POST | `/:eventId/participants` | 🛡 | `{ userId, role? }` |
| DELETE | `/:eventId/participants/:userId` | 🛡 or self | Creator cannot be removed. In a pool, triggers `onMembershipChanged` |
| PUT | `/:eventId/participants/:userId/role` | 🛡 | `{ role: 'admin'\|'member' }` |
| POST | `/:eventId/backfill-participants` | 🛡 | Repair utility for legacy events |
| POST | `/history-email` | 🔐 | Emails event history to the caller |

### `CreateEventDto`

```ts
{
  name: string;
  description?: string;
  type: 'trip' | 'event';
  startDate: Date; endDate?: Date;
  currency: string;
  settlementCurrency?: string;             // ⭐ Pro if different from currency
  fxRateMode?: 'predefined' | 'eod';       // ⭐
  predefinedFxRates?: Record<string, number>;  // ⭐  key "USD_INR"
  fundingModel?: 'peer_to_peer' | 'pool' | 'hybrid';   // OMIT for split-expenses
  pool?: CreatePoolConfigDto;
}

interface CreatePoolConfigDto {
  preset: 'trip_kitty'|'household'|'club_treasury'|'sponsor_budget'|'target_collection';
  custodianUserId?: string;                // defaults to the creator
  targetAmountMinor?: number | null;
  defaultContributionMinor?: number | null;
  allowPeerExpenses?: boolean;             // true ⇒ fundingModel becomes 'hybrid'
  overrides?: Partial<PoolConfig>;         // minus custodianUserId and preset
}
```

A free user supplying any FX field gets
`403 { code: "FEATURE_REQUIRES_PRO", feature: "multi_currency_settlement" }`.

When `pool` is present the API builds the full `PoolConfig` from the preset and opens
cycle 1 with contributions for the roster.

---

## `/api/expenses`

| Method | Path | | Body / notes |
|---|---|---|---|
| GET | `/event/:eventId` | 👥 | All expenses. **Other users' private expenses are stripped server-side** |
| GET | `/:expenseId` | 👥 | |
| POST | `/` | 👥 | `CreateExpenseDto` — see below |
| PUT | `/:expenseId` | creator or 🛡 | `UpdateExpenseDto`. `fundingSource` **cannot** be changed |
| DELETE | `/:expenseId` | creator or 🛡 | For a pool draw, also removes any linked reimbursement leg |
| GET | `/event/:eventId/balances` | 👥 | `Record<entityKey, number>` |
| POST | `/calculate-splits` | 🔐 | Split calculator helper; no persistence |

### `CreateExpenseDto`

```ts
{
  eventId: string;
  title: string;
  description?: string;
  amount: number;                 // major units, must be > 0
  currency: string;
  splitType: 'equal'|'ratio'|'custom';     // NOT required for pool draws
  splits: ExpenseSplit[];                  // must sum exactly to amount; NOT required for pool draws
  selectedEntities?: SplitEntity[];
  attachments?: string[];                  // receipt URLs from POST /api/uploads
  isPrivate?: boolean;
  paidOnBehalfOf?: OnBehalfOfEntry[];
  fundingSource?: 'self' | 'pool' | 'pool_reimbursement';   // omit ⇒ 'self'
  alreadIncurred?: boolean;                // (spelled `alreadyIncurred`) money already spent
}
```

**Funding-source rules** — `allowedFundingSources(model)`:

| Event funding model | Allowed `fundingSource` |
|---|---|
| `peer_to_peer` (absent) | `self` |
| `pool` | `pool`, `pool_reimbursement` |
| `hybrid` | `pool`, `pool_reimbursement`, `self` |

Violations return `400 { code: "FUNDING_SOURCE_NOT_ALLOWED" }`.

For a pool draw the API additionally checks: spender authorisation, currency match with the
pool, receipt requirement, spender cap, and the overdraft pre-flight. See
[Pool refusals](#pool-refusals).

---

## `/api/groups`

| Method | Path | | Body / notes |
|---|---|---|---|
| GET | `/my` | 🔐 | Every group the user is a member of |
| GET | `/event/:eventId` | 👥 | |
| GET | `/:groupId` | 👥 | |
| POST | `/` | 🛡 | `CreateGroupDto { eventId, name, description?, memberIds, payerUserId, representative? }` |
| PUT | `/:groupId` | creator or representative | `UpdateGroupDto { name?, description?, memberIds?, payerUserId?, representative? }` |
| DELETE | `/:groupId` | creator or representative | |
| POST | `/:groupId/members` | creator | `{ userId }` |
| DELETE | `/:groupId/members/:userId` | creator or self | Leaving a group does **not** settle the group |
| POST | `/suggest` | 🔐 | `{ memberIds, threshold? }` — existing groups matching ≥70% (default) member overlap |
| POST | `/:groupId/add-to-event` | 🔐 | `{ eventId }` — reuse this group in another event |
| PUT | `/:groupId/transfer-representative` | representative | `{ newRepresentative }` |

---

## `/api/invitations`

| Method | Path | | Body / notes |
|---|---|---|---|
| GET | `/my` | 🔐 | Pending invitations for the caller, with inviter names |
| GET | `/event/:eventId` | 🛡 | All invitations for an event |
| GET | `/:invitationId` | 🔐 | |
| GET | `/token/:token` | 🔓 | **Public** — so an invite link works before sign-in |
| POST | `/` | 🛡 | `CreateInvitationDto { eventId, inviteeEmail?, inviteePhone?, inviteeUserId?, groupId?, role?, message? }` |
| POST | `/:invitationId/accept` | 🔐 | Adds the participant; auto-joins `groupId` if set; expired invitations are marked `expired` and refused |
| POST | `/:invitationId/decline` | 🔐 | |
| DELETE | `/:invitationId` | inviter | Revoke |
| POST | `/history-email` | 🔐 | Emails invitation history |

Invitations expire **7 days** after creation. An email goes out via nodemailer; when
`SMTP_HOST` is unset the service runs in mock mode and logs the message to the console,
recording `emailSent` / `emailError` on the invitation.

---

## `/api/settlements`

### Reading

| Method | Path | | Notes |
|---|---|---|---|
| GET | `/event/:eventId/balances` | 👥 | Entity-level `Balance[]` — positive = owed |
| GET | `/event/:eventId` | 👥 | All legs for the event |
| GET | `/event/:eventId/pending-total` | 👥 | Sum still outstanding |
| GET | `/unsettled-payments/summary` | 🔐 | Cross-event totals for the caller |
| GET | `/unsettled-payments` | 🔐 | Cross-event detail rows |
| GET | `/providers` | 🔐 | Gateway availability (`manual` only unless the pilot flag is on) |
| GET | `/storage-proxy/:objectPath` | 🔓 | Streams a Storage object so proof images render without exposing signed URLs |

### Plan lifecycle

| Method | Path | | Notes |
|---|---|---|---|
| POST | `/event/:eventId/generate` | 🛡 | Computes balances (**reconciling the pool first** if pooled/hybrid), runs the greedy planner, moves the event to `review`, seeds `settlementApprovals`. All-zero balances ⇒ straight to `settled`. Emits `settlement:generated` |
| POST | `/event/:eventId/approve-settlement` | entity | Records one entity's approval. Last approval ⇒ event moves to `payment` |
| POST | `/event/:eventId/regenerate` | 🛡 | Recomputes after a stale change |

### Per-leg actions

| Method | Path | | Body / notes |
|---|---|---|---|
| POST | `/:settlementId/pay` | payer | `{ referenceId?, proofUrl?, useRealGateway?, paymentMode?, note? }` → `initiated`. `useRealGateway` is honoured only under the non-prod opt-in guardrails |
| POST | `/:settlementId/approve` | payee | Confirms receipt → `completed`. When all legs complete, the event auto-settles |
| POST | `/:settlementId/mark-paid-by-payee` | payee | `{ note? }` — payee records that money arrived |
| POST | `/:settlementId/reject` | payee | `{ reason? }` → back to `pending` with `rejectionReason` |
| POST | `/:settlementId/retry` | payer | `{ useRealGateway? }` — increments `retryCount` |
| POST | `/:settlementId/upload-proof` | payer | `{ base64, contentType?, filename? }` → stored under `settlements/{id}/proofs` |
| POST | `/:settlementId/create-razorpay-order` | payer | 🚧 pilot. `{ prefillName?, prefillEmail?, prefillContact? }` |
| POST | `/:settlementId/verify-razorpay` | payer | 🚧 pilot. `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |

Every transition appends a `SettlementAuditEntry` and emits `settlement:updated`.

---

## `/api/pools`

All pool writes are **zod-validated** (`apps/api/src/validation/pool.schemas.ts`) with
`.strict()` schemas — unknown keys are rejected. All amounts are **integer minor units**.
Every mutation emits `pool:updated` with a `reason`.

### Reading — any participant

| Method | Path | Returns |
|---|---|---|
| GET | `/event/:eventId/summary?cycleId=` | `PoolCycleSummary` — cycle, totals, overdraft state, funding state, arrears |
| GET | `/event/:eventId/ledger?cycleId=` | `PoolLedger` — summary + contributions + entries + spenders + cycles |
| GET | `/event/:eventId/cycles` | `PoolCycle[]` |

### Configuration

| Method | Path | | Body |
|---|---|---|---|
| PUT | `/event/:eventId/config` | 💰 | `poolConfigPatchSchema` — any of: `custodianUserId`, `recurrence`, `targetAmountMinor`, `defaultContributionMinor`, `authorizedSpenders[]` (≤200), `authorizedSpenderGroups[]` (≤100), `spenderCapsMinor`, `surplusPolicy`, `deficitPolicy`, `overdraftPolicy`, `overdraftTolerancePercent` (0–100), `overdraftBaseline`, `overdraftClearancePercent`, `requireFullFundingBeforeSpend`, `receiptRequiredAboveMinor`, `claimReceiptRequired`, `expenseApproval`, `approvalThresholdMinor`, `membershipChangeClosesCycle`. **`funderMode` and `cycleMode` are not patchable.** A new custodian must be a participant |
| POST | `/event/:eventId/convert` | 🛡 | `poolCreateSchema` — adds a pool to a split-expenses event; the event becomes `hybrid`. One-way. Emits `event:updated` |

### Contributions

| Method | Path | | Body |
|---|---|---|---|
| PUT | `/event/:eventId/contributions` | 💰 | `{ contributions: [{ entityId, entityType, expectedMinor, dueDate? }] }` — 1–200 entries. This is how tiered dues are set |
| POST | `/event/:eventId/top-ups` | 👥 | `{ amountMinor, note?, entityId?, entityType? }` — kind `top_up`. The custodian's own top-up self-confirms |
| POST | `/contributions/:id/mark-paid` | contributor | `{ amountMinor?, reference?, note?, proofUrl? }` → `initiated`. **The custodian's own contribution confirms immediately** |
| POST | `/contributions/:id/confirm` | 💰 | `{ receivedMinor? }` → `confirmed`, or `partial` if less than expected |
| POST | `/contributions/:id/reject` | 💰 | `{ reason? }` → back to `pending` |
| POST | `/contributions/:id/waive` | 💰 | `{ reason? }` → `waived` (carries no fair-share weight) |

### Draw approvals

Pool expenses are **created through `POST /api/expenses`** with a `fundingSource`. These
endpoints only decide them.

| Method | Path | | Notes |
|---|---|---|---|
| POST | `/expenses/:expenseId/approve` | 💰 | Deducts. For a `pool_reimbursement`, creates the settlement leg paying the claimant back (or marks `selfReimbursed` if the custodian filed it). ⚠️ **Refuses `403 POOL_SELF_APPROVAL` if the approver is the payer, unless they are the custodian.** `409` if the draw is not `pending`. Emits `expense:updated`, `settlement:updated` |
| POST | `/expenses/:expenseId/reject` | 💰 | `{ reason? }` — never deducts |

### Close & settle up

| Method | Path | | Body / notes |
|---|---|---|---|
| POST | `/event/:eventId/close-preview` | 💰 | `{ forDissolution?, cover? }` — reconciles **without committing**. Returns the reconciliation plus `coverNeededMinor`. Use this to render "who covered the shortfall?" |
| POST | `/event/:eventId/close` | 💰 | `{ cover?, openNext? }` — commits. Carries forward or pays out, optionally opens the next cycle. `cover` is `[{ entityId, entityType, amountMinor }]`, ≤50 |
| POST | `/event/:eventId/dissolve` | 🛡 | `{ cover? }` — final reconcile, then generates **one** settlement plan covering pool positions and any peer-to-peer expenses. Emits `settlement:generated`, `event:updated` |

> Both `POST /api/pools/event/:id/dissolve` **and** the ordinary
> `POST /api/settlements/event/:id/generate` reconcile the pool first. This is deliberate:
> otherwise the old "Settle now" button would compute peer debts only and mark a pool event
> settled with its money unaccounted for.

---

## `/api/uploads`

One shared uploader. `POST /api/uploads` 🔐, with a **discriminated union** body on `scope`:

```jsonc
// receipt for an expense — works before the expense exists
{ "scope": "expense_receipt", "eventId": "...", "base64": "...",
  "contentType": "image/jpeg", "filename": "bill.jpg" }

// proof of payment for a pool contribution
{ "scope": "pool_contribution_proof", "contributionId": "...", "base64": "...",
  "contentType": "application/pdf", "filename": "upi.pdf" }
```

| | |
|---|---|
| Returns | `201` with the stored object (including a URL to put on the record) |
| Limits | 5 MB; MIME allowlist; **PDF allowed** for both scopes |
| Storage paths | `events/{eventId}/receipts/…`, `pools/{eventId}/contributions/{id}/…`, `settlements/{id}/proofs/…` |
| Access | receipts need event access; proofs need to be the contributor **or** the custodian |
| Body limit | the API raises `express.json` to **12 MB** to accommodate base64 |

---

## `/api/billing`

| Method | Path | | Notes |
|---|---|---|---|
| POST | `/revenuecat/webhook` | 🔓 (secret) | Idempotent — repeated deliveries of the same event are recorded and ignored. Authenticated by `REVENUECAT_WEBHOOK_SECRET`. Updates the entitlement and emits `user:tier-updated` |
| GET | `/revenuecat/webhook-debug` | 🔓 | Diagnostic |

---

## `/api/internal/entitlements`

**Non-production only.** Refused outright when `APP_ENV=production`, and additionally
requires `INTERNAL_TIER_SWITCH_ENABLED=true` plus either a local/dev/test environment or an
`internalTester` (or `mock-`) caller.

| Method | Path | Body |
|---|---|---|
| GET | `/me` | — → entitlement + capabilities |
| POST | `/switch` | `{ tier: 'free'\|'pro', userId? }`. Outside local/development you may only switch **your own** tier |

---

## Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `AUTH_MISSING` | No / malformed `Authorization` header |
| 401 | `AUTH_INVALID` | Token not verifiable (or a `mock-` token outside local/test) |
| 401 | `AUTH_SESSION_REVOKED` | Valid JWT but the session was revoked |
| 403 | `FEATURE_REQUIRES_PRO` | Pro capability required; `feature` names it (e.g. `multi_currency_settlement`) |
| 403 | — | `Forbidden: …` — not an admin, not the payer/payee, event locked |
| 400 | `VALIDATION_ERROR` | zod rejected a pool payload; `error` is `"<path>: <message>"` |
| 400 | `FUNDING_SOURCE_NOT_ALLOWED` | This funding source is not available in this event's funding model |
| 403 | `POOL_SELF_APPROVAL` | *"You can't approve your own expense. Ask the custodian or another admin."* A manager may not approve their own pool expense — **except the custodian** |
| 409 | `POOL_PENDING_DRAWS` | *"Approve or reject pending pool expenses before settling up"* |
| 409 | — | `Cannot approve: this draw is <status>` — the draw is no longer `pending` |
| 403 | — | `Free users can have at most 3 active or closed events/trips` — the free-tier event quota (`mock-` users exempt; a lapsed Pro counts as free) |
| 404 | — | Not found, or not a participant (membership failures are not distinguished from 404 on some reads) |
| 500 | — | Unhandled |

### Pool refusals

Structured so clients can render the amber/red states without re-deriving anything. All
amounts are **minor units**.

```jsonc
{
  "success": false,
  "error": "Pool spending is paused",
  "code": "POOL_OVERDRAFT_BLOCKED",
  "data": {
    "balance": -1068000,
    "baseline": 5340000,
    "tolerance": 1068000,
    "floor": -1068000,
    "requested": 900000,
    "projected": -1968000,
    "shortfall": 900000,          // add this much to permit THIS draw
    "clearanceRequired": 1068000  // add this much to leave the paused state
  }
}
```

| `code` | When | User-facing text (`describePoolRefusal`) |
|---|---|---|
| `POOL_OVERDRAFT_BLOCKED` | graduated policy, draw would breach the floor or the pool is latched | *"This would go past the overdraft limit. Add at least ₹X…"* / *"Spending is paused until the overdraft is repaid. Add more than ₹X to resume."* |
| `POOL_INSUFFICIENT_FUNDS` | `block` policy, draw would go negative | *"Not enough money in the pool. Add at least ₹X first."* |
| `POOL_UNDERFUNDED` | `requireFullFundingBeforeSpend` and the target is not met | *"The collection hasn't reached its target yet (₹X still to collect)."* |
| `POOL_SPENDER_CAP` | the spender's cap would be exceeded | *"This would take you over your spending limit for this pool."* |
| `POOL_RECEIPT_REQUIRED` | a receipt is mandatory and absent | *"Attach a receipt to record this."* |

All except `POOL_RECEIPT_REQUIRED` are overridable by resubmitting with
`alreadyIncurred: true` (`canRecordAnyway(code)`), which records the draw and flags it.

---

## Quick cURL recipes (local, mock auth)

```bash
# health & config
curl -s localhost:3001/health
curl -s localhost:3001/api/config | python3 -m json.tool

# act as a test user
AUTH='Authorization: Bearer mock-alice'

# create a kitty event
curl -s -X POST localhost:3001/api/events -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "name":"Goa Trip","type":"trip","startDate":"2026-11-01","currency":"INR",
  "fundingModel":"pool","pool":{"preset":"trip_kitty","defaultContributionMinor":1000000}}'

# add a second participant
curl -s -X POST localhost:3001/api/events/<eventId>/participants \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"userId":"mock-bob"}'

# pool state
curl -s localhost:3001/api/pools/event/<eventId>/summary -H "$AUTH"
curl -s localhost:3001/api/pools/event/<eventId>/ledger  -H "$AUTH"

# spend from the pool
curl -s -X POST localhost:3001/api/expenses -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "eventId":"<eventId>","title":"Villa","amount":23000,"currency":"INR",
  "fundingSource":"pool","splits":[]}'

# preview the final settle-up
curl -s -X POST localhost:3001/api/pools/event/<eventId>/close-preview \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"forDissolution":true}'

# full automated smoke test against a running API
node scripts/local-dev/pool-smoke.mjs      # expects "ALL LIVE CHECKS PASSED"
```

---

**Sources:** `apps/api/src/index.ts` · `apps/api/src/routes/*.ts` ·
`apps/api/src/validation/pool.schemas.ts` · `apps/api/src/middleware/auth.ts` ·
`apps/api/src/utils/event-access.ts` · `libraries/shared/src/{index,pool,pool-ui}.ts` ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` §5
