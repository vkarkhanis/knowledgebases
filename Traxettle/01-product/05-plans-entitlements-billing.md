# Plans, Entitlements & Billing

## 1. The critical distinction

Two completely separate money flows share the word "payment". Confusing them is the most
common mistake made in this codebase.

| | **Store billing** | **Event settlement** |
|---|---|---|
| What is being bought | a Traxettle **Pro subscription** | one participant paying another what they owe |
| Rails | Google Play Billing (Android), Apple IAP (iOS), brokered by **RevenueCat** | by default **none** — users pay outside the app and record it. Optionally Razorpay/BillDesk in a hidden pilot. |
| Who is paid | Karkhanis Labs | another user |
| Where in the app | Pro upgrade screen | settlement cards / pool payments |
| Flag | n/a (always on in released builds) | `SETTLEMENT_GATEWAY_PILOT_ENABLED` (off in production) |

Gateway settlement is **not** a substitute for store billing, and store billing has nothing
to do with settling an event.

---

## 2. Tiers

| Tier | Who | What they get |
|---|---|---|
| **Free** | default for every account | Everything in the capability matrix *except* the Pro capabilities below |
| **Pro** | active subscriber | Pro capabilities |

### What Pro unlocks

Two distinct mechanisms — a **capability** and a **quota**.

| | Limit | Enforcement |
|---|---|---|
| **Capability** `multiCurrencySettlement` | Setting a **settlement currency different from the event's expense currency**, and the FX fields that go with it (`settlementCurrency`, `fxRateMode`, `predefinedFxRates`) | Server-side on event create/update. A free user gets `403` with `code: "FEATURE_REQUIRES_PRO"` and `feature: "multi_currency_settlement"` |
| **Quota** — free users may hold at most **3 events** | Counts events with status `active` **or** `closed`. A 4th returns `403 "Free users can have at most 3 active or closed events/trips"`. `mock-` users are exempt | `POST /api/events` in `apps/api/src/routes/events.ts` |

Notably **money pooling is not Pro-gated**. Consumption-weighted deficit sharing was
considered as a natural Pro differentiator and deliberately left open as a product
decision.

### One rule for "is this Pro paid up?"

```ts
// libraries/shared/src/index.ts
export function hasActivePro(entitlement: { tier?, entitlementStatus? }): boolean {
  if (entitlement.tier !== 'pro') return false;
  const status = entitlement.entitlementStatus || 'active';
  return status === 'active' || status === 'grace_period';
}
```

⚠️ **A lapsed subscription still reads `tier: 'pro'`, with status `expired`.** Never check
`tier === 'pro'` on its own. `hasActivePro()` is the single rule, and it is deliberately in
the **shared** library so the apps apply it to profile data and never offer what the API will
refuse. Both the capability derivation and the free-event quota go through it.

*Code: `UserCapabilities`, `hasActivePro()` in `libraries/shared/src/index.ts`;
`EntitlementService.computeCapabilities()` / `assertCapability()` in
`apps/api/src/services/entitlement.service.ts`.*

---

## 3. The entitlement model

Stored on the user document (`users/{userId}`) and returned on
`GET /api/users/profile`:

| Field | Values | Meaning |
|---|---|---|
| `tier` | `free` \| `pro` | The plan |
| `entitlementStatus` | `active` \| `grace_period` \| `billing_retry` \| `expired` \| `revoked` | Subscription health |
| `entitlementExpiresAt` | ISO date \| `null` | When it lapses |
| `entitlementSource` | `revenuecat` \| `manual_override` \| `system` | How it got set |
| `internalTester` | boolean | Unlocks non-prod tier switching and real-gateway opt-in |
| `capabilities` | `{ multiCurrencySettlement: boolean }` | **Derived, never stored** |

**Pro is granted only when** `tier === 'pro'` **and** the status is `active` **or**
`grace_period` (`hasActivePro()`). `billing_retry`, `expired` and `revoked` all drop the user
to free limits while leaving the tier field intact for reporting. Pro therefore **ends on
expiry but is kept through paid periods**, including the store's grace period.

Defaults for a brand-new or unknown user: `free` / `active` / no expiry / `system` /
not an internal tester. Unknown values read from Firestore are coerced to the safe default
rather than trusted.

---

## 4. How entitlement changes

### 4.1 Production — RevenueCat webhook only

```
User buys in app  →  Google Play / Apple IAP  →  RevenueCat
                                                     │
                                  POST /api/billing/revenuecat/webhook
                                                     │
                            idempotent event store (billingEvents)
                                                     │
                             EntitlementService.applyRevenueCatEntitlement()
                                                     │
                          users/{id}.tier / entitlementStatus / expiresAt
                                                     │
                              socket  user:tier-updated  →  client refreshes
```

- The webhook is **idempotent** — repeated deliveries of the same RevenueCat event are
  recorded and ignored, so retries cannot double-apply.
- `REVENUECAT_WEBHOOK_SECRET` authenticates the call.
- `REVENUECAT_PRO_ENTITLEMENT_ID` (default `pro`) is the entitlement identifier matched
  against RevenueCat's payload. **Note:** the deployed staging API currently reports
  `proEntitlement: "traxettle-pro"` and `offering: "traxettle-default"`, so the ids are
  environment-specific — always read them from `GET /api/config` rather than assuming.
- There is a debug endpoint, `GET /api/billing/revenuecat/webhook-debug`.
- **Manual tier switching is disabled in production.** The internal switch route refuses
  outright when `APP_ENV=production`.

*Code: `apps/api/src/routes/billing.ts`,
`apps/api/src/services/billing/revenuecat.service.ts`,
`apps/api/src/services/billing/billing-events.service.ts`.*

### 4.2 Non-production — the internal switch

`GET /api/internal/entitlements/me` and `POST /api/internal/entitlements/switch` let a
tester flip their own tier. Guarded by **four** conditions:

1. `APP_ENV` (or `RUNTIME_ENV`/`NODE_ENV`) must **not** be `production`
2. `INTERNAL_TIER_SWITCH_ENABLED=true`
3. either the environment is `local`/`development`/`test`, **or** the caller is an
   `internalTester` (or a `mock-` user)
4. outside local/development, you may only switch **your own** tier

A successful switch sets `entitlementSource: 'manual_override'` and broadcasts
`user:tier-updated` to that user's sockets, so the web app refreshes its profile and
capabilities live without a reload.

*Code: `apps/api/src/routes/internal-entitlements.ts`.*

### 4.3 Client-side testing overrides

| Surface | Variable | Effect |
|---|---|---|
| Mobile | `EXPO_PUBLIC_DEFAULT_TIER=free\|pro` | Local/internal default tier for feature-gated UI |
| Mobile | `EXPO_PUBLIC_INTERNAL_FEATURES_ENABLED=true` | Reveals internal testing controls |
| Web | `NEXT_PUBLIC_ALLOW_LOCAL_TIER_SWITCH=true` | Shows tier switch controls on the profile page |

The local-dev helper sets these for you:

```bash
sh scripts/local-dev/05_set-flags.sh --tier pro --payments mock
```

Flags persist in `scripts/local-dev/.runtime.env` and are picked up by all four run scripts.

### 4.4 Entitlement switching by environment

| Environment | Mobile switch | Web switch | Source of truth |
|---|---|---|---|
| local / emulator | ✅ full | ✅ full | manual override |
| staging / TestFlight / internal testing | ✅ for internal testers | read-only | manual override or RevenueCat |
| production | ❌ | ❌ | RevenueCat webhook only |

---

## 5. Buying Pro

**Mobile** is the only place a purchase can happen.

1. The app initialises RevenueCat with the platform API key —
   `REVENUECAT_APPLE_API_KEY` (iOS) / `REVENUECAT_GOOGLE_API_KEY` (Android), resolved from
   `EXPO_PUBLIC_REVENUECAT_*` env vars, then the build-time `BUILD_ENV` fallback, then
   runtime config.
2. The Pro screen fetches the configured **offering** and presents its packages.
3. Purchase goes through the platform store. RevenueCat validates the receipt.
4. RevenueCat calls the webhook; the API updates the entitlement; the socket event refreshes
   the UI.

*Code: `apps/mobile/src/services/purchases.ts`,
`apps/mobile/src/context/PurchaseContext.tsx`,
`apps/mobile/src/screens/ProUpgradeScreen.tsx`.*

**Web** (`/pro`) cannot transact — it explains the benefit and points at the mobile app.
Once granted, the entitlement applies on web too, because it lives on the server-side
profile.

### RevenueCat configuration files

Keys are kept out of git in per-environment properties files at the repo root, loaded by
`scripts/revenuecat/load-rc-config.sh`:

| File | Used by |
|---|---|
| `rc_local.properties` | local dev scripts |
| `rc_staging.properties` | `build-android.sh staging`, `build-ios.sh staging` |
| `rc_prod.properties` | `build-android.sh production`, `build-ios.sh production` |
| `rc_env.properties.example` / `.env.revenuecat.template` | templates |

Each defines `RC_REVENUECAT_GOOGLE_PUBLIC_KEY`, `RC_REVENUECAT_APPLE_PUBLIC_KEY`,
`RC_REVENUECAT_WEBHOOK_SECRET`, `RC_REVENUECAT_SECRET_API_KEY`,
`RC_REVENUECAT_PRO_ENTITLEMENT_ID`, `RC_REVENUECAT_OFFERING_ID`.

Release builds additionally write a gitignored `src/config/buildEnv.ts` so a release bundle
always carries the keys even if Expo's dotenv inlining is skipped on some native build
paths. The build scripts restore/delete it afterwards.

Helper scripts: `scripts/revenuecat/{bootstrap,configure,check-config,smoke-webhook}.sh`.

---

## 6. Settlement gateways (the hidden pilot)

Separate from billing, and **off by default**.

| | |
|---|---|
| Flag | `SETTLEMENT_GATEWAY_PILOT_ENABLED` — when off, only manual settlement is exposed and Razorpay/BillDesk options stay hidden |
| Non-prod real-payment opt-in | requires `PAYMENT_ALLOW_REAL_IN_NON_PROD=true` **and** a per-request flag **and** an internal-tester identity |
| Live approval gates | `RAZORPAY_LIVE_APPROVED`, `BILLDESK_LIVE_APPROVED` (both default `false`) |
| Credentials | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Endpoints | `GET /api/settlements/providers`, `POST /api/settlements/:id/create-razorpay-order`, `POST /api/settlements/:id/verify-razorpay` |
| Currency routing | `PaymentProvider` enum: Razorpay/BillDesk for INR in India, Stripe for international (Stripe is not implemented) |

*Code: `apps/api/src/services/payment.service.ts`;
`traxettle-app/docs/utility/SETTLEMENT_GATEWAY_TESTING_POLICY.md` and
`SETTLEMENT_PROVIDER_RECOMMENDATION_AND_RUNBOOK.md`.*

---

## 7. Testing tiers

| Goal | How |
|---|---|
| Free vs Pro UI locally | `sh scripts/local-dev/05_set-flags.sh --tier free\|pro --payments mock` then start a run script |
| Flip tier at runtime (non-prod) | `POST /api/internal/entitlements/switch` with `{"tier":"pro"}` |
| Verify the Pro capability gate | Create an event with `settlementCurrency` ≠ `currency` as a free user → expect `403 FEATURE_REQUIRES_PRO` |
| Verify the free event quota | As a non-`mock-` free user, create 4 events → the 4th returns `403 "Free users can have at most 3 active or closed events/trips"` |
| Verify a **lapsed** Pro is treated as free | Set `tier: 'pro'` with `entitlementStatus: 'expired'` → capabilities drop and the 3-event quota applies |
| Verify live refresh | Switch tier in one tab and watch another tab's capabilities update via `user:tier-updated` |
| E2E coverage | `e2e/tests/tier-entitlements.spec.ts` |
| API coverage | `apps/api/src/__tests__/services/entitlement.service.test.ts`, `routes/internal-entitlements.test.ts`, `routes/billing.test.ts`, `routes/events.pro-gating.test.ts` |

Further reading in the repo:
`traxettle-app/docs/utility/TIER_ENTITLEMENT_ENV_MATRIX.md`,
`TIER_SWITCH_TESTING_GUIDE.md`,
`PRO_FREE_IMPLEMENTATION_CHECKLIST.md`,
`REVENUECAT_INTEGRATION_RUNBOOK.md`,
`REVENUECAT_SETUP.md`,
`local-entitlement-test.sh`.

---

**Sources:** `apps/api/src/services/entitlement.service.ts` ·
`apps/api/src/routes/{internal-entitlements,billing}.ts` ·
`apps/api/src/services/billing/*` · `apps/api/src/services/payment.service.ts` ·
`apps/api/src/index.ts` (`/api/config`) · `apps/mobile/src/config/env.ts` ·
`scripts/revenuecat/*` · `scripts/local-dev/05_set-flags.sh` ·
live `GET /api/config` responses from the staging and production APIs
