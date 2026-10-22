# System Architecture

## 1. Component map

```
┌──────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  Web (Next.js)   │   │ Mobile (Expo RN) │   │  Doctor tool (web)  │
│  localhost:3000  │   │  Metro :8081     │   │  local only         │
└────────┬─────────┘   └────────┬─────────┘   └─────────────────────┘
         │ REST + Socket.IO              │ REST + Socket.IO
         │ Firebase Auth (client SDK)    │ Firebase Auth (client SDK)
         └───────────────┬───────────────┘
                         ▼
             ┌───────────────────────────┐
             │   API  (Express 4)        │   :3001  (:3002 in emulator mode)
             │   ─────────────────────   │
             │   routes/   11 routers    │
             │   services/ 13 services   │
             │   middleware auth/log/err │
             │   Socket.IO server  /ws   │
             └───────┬───────────┬───────┘
                     │           │
      firebase-admin │           │ nodemailer (SMTP)
                     ▼           ▼
        ┌──────────────────────┐   ┌──────────────┐
        │ Firebase project     │   │ SMTP provider│
        │  · Auth              │   └──────────────┘
        │  · Firestore         │
        │  · Cloud Storage     │   ┌──────────────┐
        └──────────────────────┘   │ RevenueCat   │──webhook──► API
                                   └──────────────┘
                                   ┌──────────────┐
                                   │ open.er-api  │◄──FX rates── API
                                   └──────────────┘
```

Shared code: `@traxettle/shared` (types + pure money/pool maths, consumed by API, web and
mobile) and `@traxettle/ui` (styled-components primitives, consumed by web).

## 2. Design principles actually followed here

1. **The API is authoritative.** Balances, settlement plans, the entire pool ledger, access
   control and entitlements are computed server-side. Clients render; they do not decide.
2. **Clients never touch Firestore directly.** `firestore.rules` and `storage.rules` are
   deliberately deny-all for client SDKs; the API uses the Admin SDK, which bypasses rules.
   The client Firebase SDK is used **only for authentication**.
3. **Pure maths lives in `@traxettle/shared`.** `pool-math.ts` has no I/O, so the API
   (authoritative) and the clients (rendering the balance meter) always agree without the
   clients re-deriving anything.
4. **Derived, never stored.** Pool balances and overdraft state are recomputed from
   confirmed contributions and recorded spend on every read. A corrected or deleted expense
   self-heals the ledger.
5. **Absent means default.** Every pooling field is optional; an absent field reads as
   today's behaviour. No migration was needed and no existing document was backfilled.
6. **Reuse the settlement engine.** `calculateSettlementPlan(balances, …)` is a pure
   function over `Balance[]`. Pool reconciliation maps its output into `Balance[]` and feeds
   the same engine — so transaction minimisation, pay/confirm, proof upload, audit trail and
   auto-settle all come for free.
7. **Runtime configuration, not build-time.** One mobile bundle can be promoted from
   internal testing to production and still be pointed at staging, because it asks
   `/api/config` who it is.

## 3. The API

`apps/api/src/index.ts` is the whole bootstrap: helmet, permissive CORS, JSON body limit
raised to **12 MB** (base64 proof/receipt uploads), request logger, routers, two special
non-`/api` routes, the error handler, a 404 catch-all, then an HTTP server with Socket.IO
attached, listening on `0.0.0.0:${PORT || 3001}`.

### Routers

| Mount | File | Concern |
|---|---|---|
| `/api/auth` | `routes/auth.ts` | register, login, email-link, Google, refresh, logout, revoke, Firebase bootstrap |
| `/api/users` | `routes/users.ts` | profile, payment methods, account deletion, entitlement debug |
| `/api/events` | `routes/events.ts` | event CRUD, participants, roles, history email, backfill |
| `/api/expenses` | `routes/expenses.ts` | expense CRUD, balances, split calculator |
| `/api/settlements` | `routes/settlements.ts` | balances, generate/regenerate, approve review, pay/confirm/reject/retry, proof, providers, Razorpay, unsettled payments, storage proxy |
| `/api/groups` | `routes/groups.ts` | group CRUD, members, suggest, add-to-event, transfer representative |
| `/api/invitations` | `routes/invitations.ts` | create, list, token lookup, accept/decline/revoke, history email |
| `/api/pools` | `routes/pools.ts` | pool summary/ledger/cycles, config, convert, contributions, draw approvals, close/dissolve |
| `/api/uploads` | `routes/uploads.ts` | shared uploader for receipts and contribution proofs |
| `/api/billing` | `routes/billing.ts` | RevenueCat webhook + debug |
| `/api/internal/entitlements` | `routes/internal-entitlements.ts` | non-prod tier switch |

Plus, outside `/api`:

| Route | Purpose |
|---|---|
| `GET /health` | `{ status: "OK", timestamp }` — liveness, used by deploy scripts and Cloud Run |
| `GET /api/config` | **runtime configuration** (see §5) |
| `GET /auth/email-link` | HTML fallback page that deep-links a Firebase email-link back into the mobile app via `com.traxettle.app://auth/email-link?...` |

### Services

| Service | Responsibility |
|---|---|
| `auth.service.ts` | JWT issue/verify, sessions subcollection, session revocation, user upsert |
| `event.service.ts` | Event CRUD, participants subcollection, cascade delete, admin checks |
| `expense.service.ts` | Expense CRUD, split calculators, event balances |
| `settlement.service.ts` | Entity balances, greedy plan, review approvals, regenerate, pay/confirm/reject/retry, unsettled payments, auto-settle |
| `pool.service.ts` | The pool ledger: cycles, contributions, draws, overdraft, reconciliation, close, dissolve, membership changes (**1,547 lines — the largest file in the repo**) |
| `group.service.ts` | Group CRUD, membership, reuse, suggestions |
| `invitation.service.ts` | Token generation, create/accept/decline/revoke, expiry |
| `email.service.ts` | Nodemailer transport; mock mode logs to console when `SMTP_HOST` is unset |
| `upload.service.ts` | base64 → MIME allowlist → 5 MB cap → Cloud Storage → signed URL, with emulator handling |
| `fx-rate.service.ts` | Predefined and EOD rates, reverse lookup, Firestore cache, `convert()` |
| `entitlement.service.ts` | Tier/status read, capability derivation, `assertCapability`, switch, RevenueCat apply |
| `billing/revenuecat.service.ts` | Webhook payload → entitlement mapping |
| `billing/billing-events.service.ts` | Idempotent webhook event store |
| `payment.service.ts` | Gateway policy (mock vs real), Razorpay order/verify, provider availability |

### Utilities & middleware

| File | Purpose |
|---|---|
| `middleware/auth.ts` | `requireAuth` — mock token → JWT → Firebase ID token → emulator token; `isMockAuthAllowed()` |
| `middleware/errorHandler.ts` | Terminal error formatter |
| `middleware/logger.ts` | Request logging |
| `utils/event-access.ts` | `requireEventAccess(eventId, uid)` — participant membership gate; `EventAccessError` |
| `utils/event-guards.ts` | `getEventLockStatus`, `requireEditableEvent`, `markStaleIfInReview` |
| `utils/notification-helper.ts` | Email notification fan-out to event participants |
| `utils/firestore-merge.ts` | Firestore's real write semantics, shared by the in-memory stand-ins (local mock mode and tests) — `set(data, {merge:true})` merges nested maps key by key (an **empty** map replaces the field), `update(data)` treats top-level keys as field paths and replaces each field outright. *"A stand-in that merges more loosely hides bugs that only appear against a real database."* |
| `validation/pool.schemas.ts` | **zod** schemas for every pool write |
| `config/firebase.ts` | Admin SDK init, emulator wiring, **in-memory Firestore fallback** |
| `config/websocket.ts` | Socket.IO init, rooms, typed emitters |

## 4. Request lifecycle

```
client
  → helmet · cors · express.json(12mb) · requestLogger
  → router
  → requireAuth                        (401 AUTH_MISSING / AUTH_INVALID / AUTH_SESSION_REVOKED)
  → requireEventAccess(eventId, uid)    (403/404 — must be an accepted participant)
  → requireEditableEvent(eventId)       (403 — locked in payment/settled/closed)
  → entitlementService.assertCapability (403 FEATURE_REQUIRES_PRO)
  → zod schema parse (pool writes)      (400 VALIDATION_ERROR)
  → service  → Firestore (Admin SDK)
  → emitToEvent / emitToUser            (Socket.IO)
  → notifyEventParticipants             (email, fire-and-forget)
  → { success, data } | { success, error, code, data }
```

Every response is an `ApiResponse<T>`:

```ts
{ success: boolean; data?: T; error?: string; message?: string; code?: string; feature?: string }
```

### Worked example: creating a pool expense

`POST /api/expenses` with `fundingSource: "pool"`
(`apps/api/src/routes/expenses.ts:100`):

1. Validate the body. **Pool draws need no `splitType` and no splits** — the pool pays,
   nobody owes anybody.
2. `requireEventAccess` then `requireActiveEvent`.
3. Resolve the event's funding model; refuse with `FUNDING_SOURCE_NOT_ALLOWED` if this
   source is not permitted (`allowedFundingSources(model)`).
4. `poolService.prepareDraw(...)` — checks the spender is authorised, the currency matches
   the pool, receipts where required, the spender cap, and runs the overdraft pre-flight.
   Returns the cycle id, the initial `poolDraw` state, any `poolFlags`, and whether it
   auto-approves. **Refusals throw a `PoolError` carrying `code` and structured `data`.**
5. `expenseService.createExpense(...)` persists it with the pool fields.
6. If auto-approved, `poolService.finalizeApprovedDraw(...)` — which for a reimbursement
   claim creates the settlement leg paying the claimant back.
7. Emit `expense:created` and `pool:updated`; alert the custodian if the draw was flagged;
   email the participants.

Note the deliberate asymmetry: **`fundingSource` cannot be changed on an existing expense**
("How an expense was paid cannot be changed. Delete it and add it again.").

## 5. Runtime configuration — `GET /api/config`

The mechanism that lets one build serve multiple environments.

```jsonc
{ "success": true, "data": {
  "env": "staging",
  "apiUrl": "https://traxettle-api-staging-943648574702.us-central1.run.app",
  "firebaseConfig":   { "projectId": "traxettle-staging", "apiKey": "…", "authDomain": "…",
                        "databaseURL": "", "storageBucket": "…", "messagingSenderId": "…",
                        "appId": "…", "measurementId": "…" },
  "revenueCatConfig": { "googleApiKey": "…", "appleApiKey": "…",
                        "proEntitlement": "traxettle-pro", "offering": "traxettle-default" }
}}
```

- `apiUrl` is **derived from the request** (`x-forwarded-proto` + `Host`), so it is always
  correct behind a proxy and reveals which alias you reached.
- Firebase values fall back through `FIREBASE_*` → `NEXT_PUBLIC_FIREBASE_*` → `''`, with
  `projectId` defaulting to `traxettle-staging`.

**Client side** (`apps/mobile/src/config/runtime.ts`, `RuntimeConfigManager`):

| Situation | Behaviour |
|---|---|
| local-like (`APP_ENV=local` or `__DEV__`) | Always discard stored config and fetch fresh from the **locally configured** API base, retrying 3× with 2 s backoff (the app usually starts before the API). It deliberately never falls back to a hosted API, because that serves a different Firebase project and would cause `auth/custom-token-mismatch`. |
| staging/production build | Load from AsyncStorage if the stored config is **complete** (`projectId`, `apiKey`, `authDomain`, `appId` all non-empty) **and** matches the selected environment (`apiUrl === STAGING_API_URL` or `PROD_API_URL`); otherwise discard and refetch. In-memory cache lasts 5 minutes. |
| production API unreachable | Does **not** silently fall back to staging: throws *"Production API unavailable. Use developer options to switch to staging."* |

Environment selection is a single AsyncStorage key, `@traxettle_staging_mode`. Toggling it
clears the config cache; the app then re-bootstraps so Firebase is reinitialised against
the right project.

The web app resolves its API base from `NEXT_PUBLIC_API_URL` at build/run time instead.

## 6. Firebase layer

`apps/api/src/config/firebase.ts` (408 lines) exports `db`, `auth` and storage helpers, and
decides between three backends:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Real** | service-account credentials present | Admin SDK against the real project |
| **Emulator** | `FIREBASE_USE_EMULATOR=true` + `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST` / `STORAGE_EMULATOR_HOST` | Admin SDK against the local Emulator Suite (project `traxettle-local`) |
| **In-memory** | no credentials at all | A hand-rolled in-memory Firestore (`__tests__/helpers/memoryFirestore.ts` mirrors it for tests), both sharing `utils/firestore-merge.ts` so merge semantics match the real SDK. **Data is lost on restart.** |

Credentials can be supplied either as `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` +
`FIREBASE_PRIVATE_KEY`, or as a path in `FIREBASE_PRIVATE_KEY_FILE` pointing at a
service-account JSON (what the local-dev scripts use, from `fb-service-accounts/`).

> ⚠️ The in-memory fallback is **silent**, including in production. See
> [`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

## 7. Real-time

Socket.IO on path `/ws`, CORS `*`. Rooms: `event:{eventId}` and `user:{userId}`.
See [`08-realtime.md`](08-realtime.md) for the full event catalogue.

## 8. Monorepo & build graph

```
rush.json  (Rush 5.167.0 · pnpm 9.15.9 · Node >=24.11.1 <25)
│
├── libraries/shared   @traxettle/shared   ← types + pure pool maths
├── libraries/ui       @traxettle/ui       ← styled-components primitives
├── apps/api           @traxettle/api      depends on shared
├── apps/web           @traxettle/web      depends on shared + ui
├── apps/mobile        @traxettle/mobile   depends on shared
├── tools/doctor-tool  @traxettle/doctor-tool
└── e2e                @traxettle/e2e
```

**Important:** web and mobile consume `@traxettle/shared` from its **built `dist/`**. After
changing `libraries/shared` you must rebuild it or the apps will use stale types and stale
maths:

```bash
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
```

Custom Rush commands are declared in `common/config/rush/command-line.json` — see
[`../03-operations/01-local-development.md`](../03-operations/01-local-development.md).

## 9. Hosting

| Component | Where |
|---|---|
| API | Google Cloud Run, region `us-central1`, services `traxettle-api-staging` / `traxettle-api-prod` |
| Web | Cloud Run (`traxettle-web-*`) and/or Firebase Hosting (`.firebaserc`, `firebase.json`) |
| Data | Firebase (Firestore + Auth + Cloud Storage) per environment |
| Mobile | Play Console (Android `.aab`) and App Store Connect / TestFlight (iOS `.ipa`) |

---

**Sources:** `apps/api/src/index.ts` · `apps/api/src/config/{firebase,websocket}.ts` ·
`apps/api/src/routes/*` · `apps/api/src/services/*` · `apps/api/src/utils/*` ·
`apps/mobile/src/config/{env,runtime}.ts` · `rush.json` ·
`common/config/rush/command-line.json` · `firebase.json` · `firestore.rules` ·
live `GET /api/config`
