# Environments

---

## 1. The important subtlety

Traxettle has **two independent axes** that both get called "environment":

| Axis | Values | Controlled by |
|---|---|---|
| **App environment** — what the API thinks it is, which gates mock auth, tier switching and real payments | `local` · `staging` · `production` (also `internal`, `development`, `test`) | `APP_ENV` (API), `NEXT_PUBLIC_APP_ENV` (web), `EXPO_PUBLIC_APP_ENV` (mobile) |
| **Firebase project** — where the data and the identities actually live | `traxettle-local` (emulated) · `traxettle-test` · `traxettle-staging` · `traxettle-prod` | `FIREBASE_PROJECT_ID` + credentials (API); `google-services.*.json` / `GoogleService-Info.*.plist` (mobile); `NEXT_PUBLIC_FIREBASE_*` (web) |

They are **deliberately decoupled**, and the local-dev scripts exploit it: you can run
`APP_ENV=local` (so mock auth and tier switching work) against the **real
`traxettle-staging`** Firebase project. That is the practical meaning of
*"run against staging locally"* and it is what
[`02-staging-verification-guide.md`](02-staging-verification-guide.md) uses.

Conversely, a *deployed* staging service runs `APP_ENV=staging`, which **disables** mock
auth and restricts tier switching to internal testers.

---

## 2. Environment matrix

| | **local (emulator)** | **local (test project)** | **staging** | **production** |
|---|---|---|---|---|
| Firebase project | `traxettle-local` *(Emulator Suite)* | `traxettle-test` | `traxettle-staging` | `traxettle-prod` |
| Project number | — | `603084161476` | `943648574702` | — |
| Storage bucket | emulated | `traxettle-test.firebasestorage.app` | `traxettle-staging.firebasestorage.app` | `traxettle-prod.firebasestorage.app` |
| API | `http://localhost:3001` (or `:3002` in emulator mode) | `http://localhost:3001` | `https://traxettle-api-staging-943648574702.us-central1.run.app` | `https://traxettle-api-prod-ncwutlgtga-uc.a.run.app` |
| Web | `http://localhost:3000` | `http://localhost:3000` | `https://traxettle-staging.web.app` | `https://traxettle.app` |
| Service account file | — | `fb-service-accounts/traxettle-fb-sa-test.json` | `…-staging.json` | `…-prod.json` |
| Mobile Android config | `google-services.local.json` | `google-services.local.json` | `google-services.staging.json` | `google-services.prod.json` |
| Mobile iOS config | `GoogleService-Info.local.plist` | same | `…staging.plist` | `…prod.plist` |
| Android signing | `debug.keystore.local` | `debug.keystore.local` | `debug.keystore.staging` or the release keystore | release keystore |
| RevenueCat properties | `rc_local.properties` | `rc_local.properties` | `rc_staging.properties` | `rc_prod.properties` |
| Mock auth (`Bearer mock-x`) | ✅ | ✅ | ❌ | ❌ |
| Tier switching | ✅ full | ✅ full | internal testers only, mobile only | ❌ (RevenueCat only) |
| Settlement payments | mock (real behind opt-in) | mock (real behind opt-in) | mock (real behind opt-in) | manual settlement; gateway pilot off |
| Data durability | resets on emulator restart | real cloud | real cloud | real cloud |

### The two staging API URLs

Both of these resolve to the **same Cloud Run service** (`traxettle-api-staging`,
project `traxettle-staging`, region `us-central1`) — Cloud Run issues both a
project-number-based and a legacy hash-based hostname:

```
https://traxettle-api-staging-943648574702.us-central1.run.app   ← used by env.ts, build-android.sh
https://traxettle-api-staging-lomxjapdhq-uc.a.run.app            ← used by build-ios.sh, eas.json, the docs
```

Verified: both return `/health` 200 and the identical `/api/config`
(`projectId: traxettle-staging`). They are interchangeable. The inconsistency is cosmetic but
confusing, and is logged in
[`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

### Money pooling on deployed staging — verified present

```bash
B=https://traxettle-api-staging-943648574702.us-central1.run.app
curl -s -o /dev/null -w '%{http_code}\n' $B/api/pools/event/x/summary   # 401 ⇒ deployed
curl -s -o /dev/null -w '%{http_code}\n' $B/api/uploads                 # 401 ⇒ deployed
```

**401 means the router is mounted** (you simply sent no token). A **404** would mean the
pooling code is not deployed. Current state: **401 — pooling is live on staging.**

Always re-probe rather than trusting this paragraph; it is the one fact in this KB that a
deploy can change without any file changing.

### ⚠️ "Several of us" pools are gated by app environment

`libraries/shared/src/pool-ui.ts`:

```ts
export const CONTRIBUTOR_POOLS_IN_PRODUCTION = false;
const PRE_PRODUCTION_ENVS = ['local', 'development', 'staging', 'internal'];
export function contributorPoolsAvailable(appEnv) {
  return CONTRIBUTOR_POOLS_IN_PRODUCTION || PRE_PRODUCTION_ENVS.includes(String(appEnv ?? '').toLowerCase());
}
```

| App environment | Create-event offers |
|---|---|
| `local`, `development`, `staging`, `internal` | **Several of us** (Kitty / Fund / Treasury / Collection) **and** Just me |
| `production`, or missing/unknown | **Just me** (sponsor budget) only |

A missing or unrecognised environment counts as production, so the option cannot reach
production users by accident. **The API supports every preset regardless** — this is a
first-release UI gate, not a capability limit. Flip
`CONTRIBUTOR_POOLS_IN_PRODUCTION` to `true` to release them.

---

## 3. Ports

| Service | Port |
|---|---|
| Web (Next.js) | 3000 |
| API (Express) | 3001 |
| API in Firebase-emulator mode | 3002 |
| Expo Metro bundler | 8081 |
| Firestore emulator | 8080 |
| Firebase Auth emulator | 9099 |
| Cloud Storage emulator | 9199 |
| Emulator Suite UI | 4000 |

Android emulator reaches the host at **`10.0.2.2`**; the iOS simulator shares the host's
`localhost`. On a physical device use your LAN IP or `adb reverse`.

---

## 4. Configuration files

### Repo root (`traxettle-rush/`)

| File | Role | In git? |
|---|---|---|
| `.env.example` | Template for every API/web variable | ✅ |
| `.env.local` | **Your** local secrets — SMTP, service-account path, Razorpay test keys, RevenueCat keys. Loaded by the API (without override) and sourced by the run scripts | ❌ |
| `.env` | Secondary fallback, loaded after `.env.local` | ❌ |
| `.env.revenuecat.template`, `rc_env.properties.example` | RevenueCat templates | ✅ |
| `rc_local.properties`, `rc_staging.properties`, `rc_prod.properties` | RevenueCat keys per environment | ❌ |
| `fb-service-accounts/traxettle-fb-sa-{test,staging,prod}.json` | Firebase Admin service accounts | ❌ |
| `fb-web-configs/{traxettle-staging,traxettle-test}.env` | **Web-platform** Firebase config (`FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, auth domain, bucket, sender id, measurement id) | ❌ |
| `.traxettle/{api-staging,api-prod,web-prod}.env` | Captured deployed-service env snapshots | ❌ |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Firebase project config | ✅ |
| `apps/mobile/release-versions.json` | What each platform last shipped (version + build), driving the shared-version scheme | ✅ |
| `scripts/local-dev/.runtime.env` | `DEV_TIER` + `DEV_REAL_PAYMENTS`, written by `05_set-flags.sh` | ❌ |
| `scripts/local-dev/.bootstrap.env` | **Generated** by `bootstrap.sh` — extracted Google client ids and Firebase web config | ❌ |
| `scripts/local-dev/.last-mobile-env` | Remembers the last mobile environment, so a switch can warn about the required native rebuild | ❌ |
| `scripts/api-deployment/smtp_{staging,prod}.local.properties` | SMTP credentials for deploys | ❌ |

**Why `fb-web-configs/` exists:** the Firebase JS SDK (used by the React Native app for
auth) makes REST calls that need the **Web** API key and Web app id, which are *different*
from the Android values in `google-services.json`. `bootstrap.sh` prefers the web values and
falls back to the Android ones with a warning.

### `apps/mobile/`

See [`../02-architecture/05-mobile-codemap.md`](../02-architecture/05-mobile-codemap.md) §6
for the per-environment secret file list.

---

## 5. Variable reference

### API

| Variable | Purpose |
|---|---|
| `APP_ENV` | `local` \| `staging` \| `production`. Gates mock auth, tier switching, payment policy |
| `PORT` | default 3001 |
| `NODE_ENV` | also consulted for local/test detection |
| `FIREBASE_PROJECT_ID` | Admin SDK project |
| `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Admin credentials (inline form) |
| `FIREBASE_PRIVATE_KEY_FILE` | Admin credentials as a service-account JSON path (what the run scripts use) |
| `FIREBASE_STORAGE_BUCKET` | Uploads target |
| `FIREBASE_WEB_API_KEY` | **Required** for email-link completion via Identity Toolkit REST |
| `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_MEASUREMENT_ID` | Surfaced through `/api/config` to clients |
| `FIREBASE_USE_EMULATOR` | `true` ⇒ use the Emulator Suite |
| `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST` / `STORAGE_EMULATOR_HOST` | Emulator endpoints (`127.0.0.1:9099` / `:8080` / `:9199`) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | **Required** outside local/test — the API throws without them |
| `ALLOW_MOCK_AUTH` | Force-enable `mock-` tokens. **Never in a deployed environment** |
| `APP_URL` | Base URL used in invitation emails |
| `MOBILE_DEEP_LINK_SCHEME` / `MOBILE_APP_SCHEME` | default `com.traxettle.app` |
| `AUTH_EMAIL_LINK_CONTINUE_URL` | Must be an authorised domain in Firebase Auth |
| `AUTH_ANDROID_PACKAGE_NAME`, `AUTH_ANDROID_MIN_VERSION`, `AUTH_IOS_BUNDLE_ID` | Email-link mobile handling |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` (or `SMTP_PASSWORD`), `SMTP_FROM`, `SMTP_SERVICE` | Email. **No `SMTP_HOST` ⇒ mock mode, messages logged to the console** |
| `INTERNAL_TIER_SWITCH_ENABLED` | Enables `/api/internal/entitlements/*` (non-prod only) |
| `REVENUECAT_WEBHOOK_SECRET` | Authenticates the webhook |
| `REVENUECAT_PRO_ENTITLEMENT_ID` | default `pro`; staging uses `traxettle-pro` |
| `REVENUECAT_OFFERING_ID` | default `default`; staging uses `traxettle-default` |
| `REVENUECAT_GOOGLE_API_KEY`, `REVENUECAT_APPLE_API_KEY` | Surfaced through `/api/config` |
| `PAYMENT_ALLOW_REAL_IN_NON_PROD` | Allows a real gateway outside production (still needs a request flag + internal tester) |
| `PAYMENT_GATEWAY_MODE` | `mock` \| `live` |
| `SETTLEMENT_GATEWAY_PILOT_ENABLED` | Exposes Razorpay/BillDesk settlement at all |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Gateway credentials |
| `RAZORPAY_LIVE_APPROVED`, `BILLDESK_LIVE_APPROVED` | Live-mode gates, default `false` |

### Web (`NEXT_PUBLIC_*` — inlined at build time)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `local` \| `staging` \| `production` |
| `NEXT_PUBLIC_API_URL` | API base |
| `NEXT_PUBLIC_API_URL_EMULATOR` | API base in emulator mode |
| `NEXT_PUBLIC_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_STORAGE_BUCKET` / `_MESSAGING_SENDER_ID` / `_APP_ID` / `_MEASUREMENT_ID` | Firebase client (auth only) |
| `NEXT_PUBLIC_FIREBASE_{AUTH,FIRESTORE,STORAGE}_EMULATOR_{HOST,PORT}` | Emulator wiring |
| `NEXT_PUBLIC_ALLOW_LOCAL_TIER_SWITCH` | Shows tier controls on the profile page |
| `NEXT_PUBLIC_USE_REAL_PAYMENTS` | Requests a real gateway |
| `NEXT_PUBLIC_REVENUECAT_*` | Display-only |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google sign-in |

### Mobile (`EXPO_PUBLIC_*` — inlined by Metro at bundle time)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_APP_ENV` | `local` \| `staging` \| `production` \| `internal` |
| `EXPO_PUBLIC_API_URL` | API base |
| `EXPO_PUBLIC_API_URL_IOS` / `_ANDROID` | Platform-specific override, **checked first** |
| `EXPO_PUBLIC_API_URL_EMULATOR`, `…_EMULATOR_IOS`, `…_EMULATOR_ANDROID` | Emulator-mode API |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `_ANDROID_CLIENT_ID` / `_IOS_CLIENT_ID` | Google sign-in |
| `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY` / `_APPLE_KEY` / `_PRO_ENTITLEMENT` / `_OFFERING` | RevenueCat |
| `EXPO_PUBLIC_DEFAULT_TIER` | `free` \| `pro` for local testing |
| `EXPO_PUBLIC_INTERNAL_FEATURES_ENABLED` | Reveals internal testing controls |
| `EXPO_PUBLIC_LOCAL_DEV_OPTIONS_ENABLED` | Enables the developer options sheet (default `true`) |
| `EXPO_PUBLIC_USE_REAL_PAYMENTS` | Requests a real gateway |
| `EXPO_PUBLIC_FIREBASE_USE_EMULATOR` | Default emulator toggle |

`EXPO_PUBLIC_*` variables are **compiled into the bundle**. Changing one requires restarting
Metro with a cleared cache (`npx expo start -c`), and for release builds a rebuild. The build
scripts write a temporary `apps/mobile/.env` for exactly this reason and restore it
afterwards.

---

## 6. Verifying an environment

```bash
# Local or deployed, same checks
curl -s <base>/health
curl -s <base>/api/config | python3 -m json.tool

# Is pooling present?
curl -s -o /dev/null -w '%{http_code}\n' <base>/api/pools/event/x/summary   # 401 = yes, 404 = no

# Mock auth must be REFUSED on any deployed service
curl -s -o /dev/null -w '%{http_code}\n' <base>/api/users/profile -H 'Authorization: Bearer mock-x'  # 401

# Doctor, per environment
cd traxettle-rush
bash scripts/doctor.sh local      --non-interactive
bash scripts/doctor.sh staging    --non-interactive
bash scripts/doctor.sh production --non-interactive

# Doctor web UI
cd tools/doctor-tool && npm run dev

# Compare a deployed service's env against expectations
bash scripts/api-deployment/verify-deployed-api-env.sh
```

---

**Sources:** `.env.example` · `apps/api/src/index.ts` · `apps/api/src/config/firebase.ts` ·
`apps/api/src/middleware/auth.ts` · `apps/mobile/src/config/{env,runtime}.ts` ·
`scripts/local-dev/*.sh` · `scripts/api-deployment/*` · `fb-web-configs/*` ·
`traxettle-app/docs/utility/ENVIRONMENT_SETUP.md` ·
`traxettle-app/docs/deployment/DEPLOYMENT_CHANNELS.md` ·
live `GET /api/config` + `/api/pools/...` probes
