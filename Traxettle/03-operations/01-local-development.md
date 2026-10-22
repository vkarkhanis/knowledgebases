# Local Development

> **Run modes at a glance.** Modes 1–4 are the atomic scripts that start an API locally;
> **mode 6** (`06_staging_mobile.sh`) runs the mobile app against the **deployed** staging API
> with no local backend at all. Mode 0 is the no-Firebase fast path.

---

## 1. Prerequisites

| Tool | Version | Check | Needed for |
|---|---|---|---|
| Node.js | **≥24.11.1 and <25** (pinned by `rush.json`) | `node -v` | everything |
| Java JDK | ≥21 | `java -version` | Firebase emulators |
| Xcode + an iOS runtime | current | `xcodebuild -version`; `xcrun simctl list runtimes` | iOS simulator |
| Android SDK + an AVD | — | `~/Library/Android/sdk/emulator/emulator -list-avds` | Android emulator |
| CocoaPods | — | `pod --version` | iOS native builds |
| Firebase CLI | latest | `firebase --version` (or `npx firebase-tools`) | emulators, hosting |
| Rush / rushx | auto-managed | use the bundled installer | monorepo commands |

> If Node is newer than 24.x, Rush refuses to run. Either `nvm install 24 && nvm use 24`, or
> prefix commands with `RUSH_ALLOW_UNSUPPORTED_NODEJS=1` (works, but untested by Rush).

Rush is **never installed globally**. Use the bundled runners:

```bash
cd traxettle-rush
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
```

`tools/doctor-tool/scripts/install-run-rush.js` and `install-run-rushx.js` are equivalent
wrappers that the local-dev scripts use (`node .../install-run-rushx.js <script>`), which is
why those scripts never hold a Rush lock.

> **Always rebuild `@traxettle/shared` after pulling** — the apps consume it from `dist/`.

### Local secrets you need

| File | Needed for |
|---|---|
| `.env.local` | SMTP, service-account path, Razorpay test keys, RevenueCat keys |
| `fb-service-accounts/traxettle-fb-sa-{test,staging}.json` | real-Firebase modes |
| `fb-web-configs/{traxettle-test,traxettle-staging}.env` | web-platform Firebase config |
| `apps/mobile/google-services.{local,staging}.json` | Android |
| `apps/mobile/GoogleService-Info.{local,staging}.plist` | iOS |
| `apps/mobile/debug.keystore.{local,staging}` | Android debug signing |
| `rc_local.properties` / `rc_staging.properties` | RevenueCat |

All are gitignored. Everything except `.env.local` and the RC properties is produced by
downloading from the Firebase Console; `scripts/firebase/create-debug-keystore.sh` generates
a keystore.

---

## 2. Set the tier and payment flags (optional, persistent)

```bash
cd traxettle-rush
sh scripts/local-dev/05_set-flags.sh --tier free --payments mock   # default
sh scripts/local-dev/05_set-flags.sh --tier pro  --payments mock
sh scripts/local-dev/05_set-flags.sh --tier pro  --payments real   # non-prod only
```

Written to `scripts/local-dev/.runtime.env` as `DEV_TIER` / `DEV_REAL_PAYMENTS` and picked up
by all four run scripts.

---

## 3. Run modes

### Mode 0 — in-memory API, no Firebase at all *(fastest; best for UI work)*

With no Firebase credentials the API falls back to an in-memory Firestore and, with
`APP_ENV=local`, accepts `Bearer mock-<id>` tokens. **Data is lost when the API restarts.**

```bash
# Terminal 1 — API on :3001
cd apps/api && APP_ENV=local PORT=3001 npx ts-node src/index.ts

# Terminal 2 — Web on :3000
cd apps/web && NEXT_PUBLIC_APP_ENV=local NEXT_PUBLIC_API_URL=http://localhost:3001 \
  npx next dev --webpack -p 3000
```

Sign in from the browser console on `http://localhost:3000`, then reload:

```js
localStorage.setItem('traxettle.authToken', 'mock-alice');
localStorage.setItem('traxettle.uid', 'mock-alice');
```

Switch person by changing the value (`mock-bob`). To add Bob to an event Alice created:

```bash
curl -X POST http://localhost:3001/api/events/<eventId>/participants \
  -H 'Authorization: Bearer mock-alice' -H 'Content-Type: application/json' \
  -d '{"userId":"mock-bob"}'
```

End-to-end API smoke test against the running server:

```bash
node scripts/local-dev/pool-smoke.mjs      # expects "ALL LIVE CHECKS PASSED"
```

### Modes 1–4 — the atomic scripts

All run from `traxettle-rush/`. Each starts everything it needs, runs `bootstrap.sh` first,
loads RevenueCat config, sources `.env.local`, and traps `EXIT`/`INT`/`TERM` to kill the
whole process group.

| # | Command | Firebase | Clients | Data |
|---|---|---|---|---|
| 1 | `sh scripts/local-dev/02_emulator_web.sh` | `traxettle-local` (emulated) | API 3001 + Web 3000 + Emulator UI 4000 | resets |
| 2 | `sh scripts/local-dev/01_emulator_mobile.sh` | `traxettle-local` (emulated) | API 3001 + Metro 8081 + Emulator UI | resets |
| 3 | `sh scripts/local-dev/04_real_web.sh [local\|staging]` | `traxettle-test` or **`traxettle-staging`** | API 3001 + Web 3000 | real cloud |
| 4 | `sh scripts/local-dev/03_real_mobile.sh [local\|staging]` | `traxettle-test` or **`traxettle-staging`** | API 3001 + Metro 8081 | real cloud |
| **6** | `bash scripts/local-dev/06_staging_mobile.sh [ios\|android]` | `traxettle-staging` | **no local API** — the mobile dev build talks to the **deployed** staging API | real cloud |

The argument to scripts 3 and 4 selects the **Firebase project**, not `APP_ENV` — those
scripts always set `APP_ENV=local`, which is why mock auth and tier switching keep working
against real staging data. This is the mode
[`02-staging-verification-guide.md`](02-staging-verification-guide.md) builds on.

What they set, in summary:

- **API**: `APP_ENV=local`, `PORT=3001`, JWT secrets, `INTERNAL_TIER_SWITCH_ENABLED=true`,
  `PAYMENT_ALLOW_REAL_IN_NON_PROD=$DEV_REAL_PAYMENTS`, Razorpay/RevenueCat passthrough,
  `FIREBASE_USE_EMULATOR=false`, and all `FIREBASE_*` values from `.bootstrap.env`.
- **Web**: `NEXT_PUBLIC_APP_ENV=local`, `NEXT_PUBLIC_API_URL=http://localhost:3001`,
  `NEXT_PUBLIC_ALLOW_LOCAL_TIER_SWITCH=true`, all `NEXT_PUBLIC_FIREBASE_*`.
- **Mobile**: `EXPO_PUBLIC_APP_ENV=local`,
  `EXPO_PUBLIC_API_URL_IOS=http://localhost:3001`,
  `EXPO_PUBLIC_API_URL_ANDROID=http://10.0.2.2:3001`,
  `EXPO_PUBLIC_INTERNAL_FEATURES_ENABLED=true`,
  `EXPO_PUBLIC_LOCAL_DEV_OPTIONS_ENABLED=true`, `EXPO_PUBLIC_DEFAULT_TIER=$DEV_TIER`,
  the Google client ids from `.bootstrap.env`, and the RevenueCat keys.

Override the API host for a physical device:

```bash
REAL_DEVICE_API_HOST=192.168.1.42 sh scripts/local-dev/03_real_mobile.sh staging
# or explicitly
EXPO_PUBLIC_API_URL_IOS=http://192.168.1.42:3001 sh scripts/local-dev/03_real_mobile.sh staging
```

### Mode 6 — mobile against the **deployed** staging API

```bash
bash scripts/local-dev/06_staging_mobile.sh ios            # default is ios
bash scripts/local-dev/06_staging_mobile.sh android
bash scripts/local-dev/06_staging_mobile.sh ios --build     # force a reinstall
```

No local API and no emulators — the dev build talks straight to
`https://traxettle-api-staging-943648574702.us-central1.run.app` (override with
`STAGING_API_URL`). It checks `/health` first and aborts if staging is unreachable, runs
`bootstrap.sh staging`, blanks the per-platform API URL overrides, installs onto **every
booted iOS simulator**, and starts `expo start --clear`.

Flags: `--build` · `--no-bundler` (install only) · `--bundler-only` (bundler only, for a
two-terminal multi-device workflow).

Full detail: [`02-staging-verification-guide.md`](02-staging-verification-guide.md) §6.0.

### The `traxettle-test` project explicitly

Scripts 3 and 4 with the `local` argument already target `traxettle-test` (the service
account for `local` resolves to `…-sa-test.json`). To force different credentials, edit
`.env.local`:

```
FIREBASE_PROJECT_ID=traxettle-test
FIREBASE_CLIENT_EMAIL=<test-project-service-account>
FIREBASE_PRIVATE_KEY="<private-key>"
FIREBASE_STORAGE_BUCKET=traxettle-test.firebasestorage.app
```

### What `bootstrap.sh <local|staging>` does

1. Validates Node and Java.
2. Copies `debug.keystore.<env>` → `android/app/debug.keystore` and prints its SHA-1.
3. Copies `google-services.<env>.json` → `android/app/google-services.json` (falling back to
   the unsuffixed file with a warning).
4. Copies `GoogleService-Info.<env>.plist` → `GoogleService-Info.plist` and, if `ios/`
   exists, into `ios/Traxettle/`.
5. **Compares the keystore SHA-1 with `certificate_hash` in `google-services.json`** and
   warns loudly on a mismatch (the cause of Google Sign-In Error 10).
6. Extracts the Google OAuth client ids (plist `CLIENT_ID`; `client_type` 3 = web, 1 =
   Android) and the Firebase config, **preferring `fb-web-configs/<project>.env` web values**
   over the Android ones.
7. Resolves the service account (`local` → `…-sa-test.json`, `staging` → `…-sa-staging.json`).
8. Writes everything to `scripts/local-dev/.bootstrap.env`.

### Mobile emulator extras

```bash
adb reverse tcp:3001 tcp:3001   # API reachable from the Android emulator
adb reverse tcp:8081 tcp:8081   # Metro
```

Running the app on a device/simulator (in a second terminal, while a run script holds Metro):

```bash
cd apps/mobile
npx expo run:ios                 # builds the native iOS app and launches the simulator
npx expo run:ios --device "iPhone 16 Pro"
npx expo run:android             # builds the native Android app and launches the emulator
```

> **Switching environment requires an Android native rebuild** — `google-services.json` is
> compiled in. `03_real_mobile.sh` detects a change via
> `scripts/local-dev/.last-mobile-env`, prints a prominent warning, and waits for Enter.
> Without the rebuild, Google Sign-In fails with DEVELOPER_ERROR.

---

## 4. Rush commands

Global/bulk commands from `traxettle-rush/` (`rush <name>`), defined in
`common/config/rush/command-line.json`:

### Dev servers

| Command | Effect |
|---|---|
| `rush dev` | API 3001 + Web 3000 |
| `rush dev:api` / `rush dev:web` | one of them |
| `rush dev:api:emulator` | API on **3002** in emulator mode (`traxettle-local`) |
| `rush dev:web:emulator` | API 3002 + Web pointed at it |
| `rush dev:mobile` | Expo Metro |
| `rush dev:mobile:emulator` | API 3002 in emulator mode + Expo pointed at it |
| `rush dev:firebase:emulators` / `…:stop` | Emulator Suite in the background (no Rush lock) |
| `rush dev:shared` / `rush dev:ui` | library watch mode |
| `rush mobile:ios` / `rush mobile:android` / `rush mobile:tunnel` | simulator / emulator / tunnel |
| `rush mobile:prebuild:ios` / `…:android` | regenerate the native projects |

### Build / test

| Command | Effect |
|---|---|
| `rush build:shared` / `build:ui` / `build:api` / `build:web` / `build:mobile` *(typecheck)* | per-package build |
| `rush typecheck` · `rush lint` · `rush test` · `rush clean` | bulk, parallel, across all packages |
| `rush test:api` / `test:shared` / `test:ui` / `test:web` / `test:mobile` (+ `:coverage`) | per-package tests |
| `rush test:regression` | the API regression suite |
| `rush test:e2e` (+ `:headed`, `:ui`, `:report`) | Playwright |
| `rush test:maestro` (+ `:artifacts`, `:android`, `:ios`) | mobile Maestro flows |
| `rush start:api` / `rush start:web` | production mode |
| `rush clean:mobile` | clears `.expo`, `dist`, `node_modules/.cache` |

> `rush test:*` commands shell out to `rushx`, which needs a **global** `rushx` on PATH. If
> you do not have one, run the package script directly
> (`cd apps/api && npm test`) — that is what CI does.

### Per-package npm scripts

```bash
cd apps/api    && npm run dev | build | typecheck | test | test:coverage | test:regression | start
cd apps/web    && npm run dev | build | typecheck | test | test:coverage | lint | start
cd apps/mobile && npm start | run ios | run android | run typecheck | test
cd libraries/shared && npm run build | dev | test
cd e2e         && npx playwright test
```

---

## 5. Typecheck everything

```bash
cd traxettle-rush
(cd apps/api && npx tsc --noEmit) && \
(cd apps/web && npx tsc --noEmit) && \
(cd apps/mobile && npx tsc --noEmit)
```

This is exactly what CI runs (`.github/workflows/ci.yml`).

---

## 6. Doctor

```bash
cd traxettle-rush
bash scripts/doctor.sh local --non-interactive      # also: staging | production
cd tools/doctor-tool && npm run dev                 # guided web UI
```

The doctor validates prerequisites, Firebase setup, store/release readiness and
deployment prep. Details: `traxettle-app/docs/utility/DOCTOR_SCRIPT.md`.

---

## 7. Useful one-liners

```bash
# Is the API alive and what does it think it is?
curl -s localhost:3001/health
curl -s localhost:3001/api/config | python3 -m json.tool

# Pool smoke test end-to-end
node scripts/local-dev/pool-smoke.mjs

# Start/stop emulators independently
sh scripts/firebase/start-emulators.sh
rush dev:firebase:emulators:stop

# Generate an Android debug keystore
sh scripts/firebase/create-debug-keystore.sh

# User maintenance helpers
node scripts/check-users.js
node scripts/check-specific-users.js
node scripts/cleanup-test-users.js
node scripts/merge-duplicate-users.js
node scripts/check-traxettle-smtp.js
```

---

## 8. Gotchas

| Symptom | Cause / fix |
|---|---|
| Changed a shared type or pool formula, nothing happened | Rebuild `@traxettle/shared` — apps use `dist/` |
| *"Rush is already running"* | Use the atomic scripts (01–04); they avoid Rush locks |
| 401 from the Android emulator | `adb reverse tcp:3001 tcp:3001`, or confirm `10.0.2.2` is being used |
| Google Sign-In Error 10 / DEVELOPER_ERROR | Keystore SHA-1 not registered in the Firebase project — re-run `bootstrap.sh` and compare |
| `auth/custom-token-mismatch` | API and client are on different Firebase projects. Clear the mobile runtime config cache / re-bootstrap |
| Emulator data vanished | It only persists to `.firebase/emulator-data/` on a clean shutdown |
| Mock tokens rejected | `APP_ENV` is not `local` (and `NODE_ENV` is not test/development) |
| `EXPO_PUBLIC_*` change not taking effect | Restart Metro with `npx expo start -c` |
| iOS simulator list is empty | Install an iOS runtime: Xcode → Settings → Components, or `xcodebuild -downloadPlatform iOS` |

Full list: [`07-troubleshooting.md`](07-troubleshooting.md).

---

**Sources:** `scripts/local-dev/{01..06}*.sh`, `bootstrap.sh`, `pool-smoke.mjs` ·
`scripts/firebase/*` · `common/config/rush/command-line.json` · `rush.json` ·
per-package `package.json` · `.github/workflows/ci.yml` ·
`traxettle-app/docs/runbook/LOCAL_DEVELOPMENT.md` ·
`traxettle-app/docs/runbook/MONEY_POOLING_TESTING.md`
