# Staging Verification Guide — Web, iOS Simulator, Android Emulator

**Goal:** get Traxettle (including the money-pooling feature on
`feature/money-pooling`) running in a staging configuration on web, the iOS simulator and
the Android emulator, so you can verify functionality by hand.

Run the scenarios in [`03-staging-test-scenarios.md`](03-staging-test-scenarios.md)
once you are up.

---

## 0. Read this first — which "staging" you mean

There are two things people call staging. **Money pooling is now deployed to the hosted
staging API**, so both paths work.

| | **Path A — local API + `traxettle-staging` Firebase** | **Path B — deployed staging Cloud Run** |
|---|---|---|
| Who serves the API | your machine, `localhost:3001`, from your working tree | `traxettle-api-staging` on Cloud Run |
| Which code | ✅ exactly what you have checked out | whatever was last deployed |
| **Money pooling available?** | ✅ yes | ✅ **yes — verified deployed** |
| Data | real `traxettle-staging` Firestore / Auth / Storage | same |
| `APP_ENV` | `local` ⇒ **mock auth and tier switching work** | `staging` ⇒ no mock auth, internal testers only |
| Set-up cost | minutes | none — it is already running |
| Mobile wiring | simulator/emulator → your local API | `06_staging_mobile.sh` → the hosted URL |

**Verify before you start:**

```bash
B=https://traxettle-api-staging-943648574702.us-central1.run.app
curl -s -o /dev/null -w 'health: %{http_code}\n' $B/health          # 200
curl -s -o /dev/null -w 'pools:  %{http_code}\n' $B/api/pools/event/x/summary
#   401 ⇒ pooling IS deployed (current state)
#   404 ⇒ pooling is NOT deployed; use Path A, or deploy per §7
curl -s $B/api/config | python3 -m json.tool                        # env staging, projectId traxettle-staging
```

### Which to use

| Goal | Path |
|---|---|
| Verify **code you are changing**; multi-persona pool scenarios with `mock-` tokens | **A** (§2–§5) |
| Verify the **deployed artefact** on a simulator/emulator with zero local backend | **B** — and there is now a purpose-built script, `06_staging_mobile.sh` (§6) |
| Verify a **release build** and the 7-tap environment switch | **B** via a TestFlight / release build (§6.4) |

> **Path A keeps `APP_ENV=local`**, which is the real reason to prefer it for functional
> testing: you can be Alice, Bob and Carol instantly with `mock-` tokens instead of
> registering three accounts.

### ⚠️ "Several of us" pools are hidden in production builds

`CONTRIBUTOR_POOLS_IN_PRODUCTION = false` in `libraries/shared/src/pool-ui.ts`. The create-event
form offers **Kitty / Fund / Treasury / Collection only when `APP_ENV` is
`local`, `development`, `staging` or `internal`** — a missing or unknown environment counts as
production, so the option cannot reach production users by accident. Production users get
**"Just me" budgets only**.

The API supports every preset regardless; this is a UI gate for the first release. So test
contributor pools on a **staging or local** build, not a production one.

---

## 1. One-time prerequisites

### 1.1 Toolchain

```bash
node -v        # must be >=24.11.1 and <25  (rush.json pins it)
java -version  # >=21
pod --version  # CocoaPods, for iOS
xcode-select -p
adb version
```

> On the machine this KB was written on: Node `v24.21.0` ✅, Java `21.0.5` ✅,
> CocoaPods `1.16.2` ✅, Xcode `27.0` ✅, `adb` at
> `~/Library/Android/sdk/platform-tools/adb` ✅.

### 1.2 Install an iOS simulator runtime

Check what you have:

```bash
xcrun simctl list runtimes
xcrun simctl list devices available
```

If both are empty (a fresh Xcode install), install a runtime — this is a multi-GB download:

```bash
xcodebuild -downloadPlatform iOS
# or: Xcode → Settings → Components → iOS <version> Simulator → Get
```

Then confirm a device exists:

```bash
xcrun simctl list devices available | grep -i iphone
# If none, create one:
xcrun simctl create "iPhone 16 Pro" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-18-0
```

### 1.3 Confirm an Android AVD

```bash
~/Library/Android/sdk/emulator/emulator -list-avds
# e.g. Medium_Phone_API_36.1, Pixel_9_Pro_XL, Small_Phone, ...
```

Create one in Android Studio → Device Manager if the list is empty.

### 1.4 Required local secrets

All gitignored. Confirm they exist:

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
ls .env.local \
   fb-service-accounts/traxettle-fb-sa-staging.json \
   fb-web-configs/traxettle-staging.env \
   apps/mobile/google-services.staging.json \
   apps/mobile/GoogleService-Info.staging.plist \
   apps/mobile/debug.keystore.staging \
   rc_staging.properties
```

Any missing file and its source is listed in
[`00-environments.md`](00-environments.md) §4.

### 1.5 Install and build the monorepo

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
git checkout feature/money-pooling
git status --short                       # expect clean

node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
```

> ⚠️ **The build step is not optional.** Web and mobile import `@traxettle/shared` from its
> built `dist/`. Skip it and the pool maths and types will be stale or missing.

### 1.6 Sanity-check the build

```bash
(cd apps/api && npx tsc --noEmit) && \
(cd apps/web && npx tsc --noEmit) && \
(cd apps/mobile && npx tsc --noEmit)

(cd libraries/shared && npm test)        # pool maths — should be green
(cd apps/api && npm test)                # includes pools.flows + pools.recurring
```

### 1.7 Pick your tier and payment mode

```bash
sh scripts/local-dev/05_set-flags.sh --tier pro --payments mock
```

`--tier pro` lets you exercise multi-currency settlement. `--payments mock` keeps every
settlement a manual record-and-confirm, which is what you want for functional testing.

---

## 2. Path A · Web against staging

### 2.1 Start it

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
sh scripts/local-dev/04_real_web.sh staging
```

This single command:

1. runs `bootstrap.sh staging` — copies the staging Firebase configs into place, validates
   the keystore SHA-1, and extracts the Google client ids and **web** Firebase config into
   `scripts/local-dev/.bootstrap.env`
2. loads `rc_local.properties` and sources `.env.local`
3. starts the **API on :3001** with `APP_ENV=local`, `FIREBASE_USE_EMULATOR=false`,
   `FIREBASE_PRIVATE_KEY_FILE=fb-service-accounts/traxettle-fb-sa-staging.json`,
   `FIREBASE_PROJECT_ID=traxettle-staging`, `INTERNAL_TIER_SWITCH_ENABLED=true`
4. starts the **web app on :3000** with `NEXT_PUBLIC_API_URL=http://localhost:3001` and all
   `NEXT_PUBLIC_FIREBASE_*` pointing at `traxettle-staging`

Expect the banner:

```
[local-dev] mode=real-firebase+web env=staging tier=pro real_payments=false
✅ Service account: fb-service-accounts/traxettle-fb-sa-staging.json
✅ All prerequisites OK (staging). Ready to develop!
```

### 2.2 Verify before you click anything

```bash
curl -s localhost:3001/health
# {"status":"OK","timestamp":"..."}

curl -s localhost:3001/api/config | python3 -m json.tool
# data.firebaseConfig.projectId MUST be "traxettle-staging"

curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/pools/event/x/summary
# 401  ⇒ the pool router is mounted (good). 404 ⇒ wrong branch or stale build.

node scripts/local-dev/pool-smoke.mjs
# ... ALL LIVE CHECKS PASSED
```

> `pool-smoke.mjs` writes real documents into `traxettle-staging` under `mock-smoke-*` user
> ids. That is usually fine for a staging project; if you would rather not, run it against
> Mode 0 (`03-staging-test-scenarios.md` §0) instead.

### 2.3 Sign in

**Option 1 — mock personas (fastest, recommended for multi-user scenarios).**
Open `http://localhost:3000`, then in the browser console:

```js
localStorage.setItem('traxettle.authToken', 'mock-alice');
localStorage.setItem('traxettle.uid', 'mock-alice');
location.reload();
```

Use a second browser profile or an incognito window with `mock-bob` to act as a second
person. Switching persona = changing the value and reloading. This works because
`APP_ENV=local`.

**Option 2 — real staging accounts.** Register through the UI, or sign in with Google. Use
two browser profiles for two people. Slower, but exercises the real auth path.

### 2.4 Sanity walkthrough

1. Dashboard loads (empty state is fine).
2. **Create event** → the **Funding** step shows *Split expenses* and *Pool money* cards.
3. Create a plain split event → no pool tab, no **Paid with** control. *(Regression check: the
   original model must be untouched.)*
4. Create a pool event → you land on the pool tab, named **Kitty** / **Fund** / etc.

Now go to [`03-staging-test-scenarios.md`](03-staging-test-scenarios.md).

---

## 3. Path A · iOS simulator against staging

Two terminals.

### 3.1 Terminal 1 — API + Metro

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
sh scripts/local-dev/03_real_mobile.sh staging
```

If the last mobile run used a different Firebase environment, you will get:

```
⚠  ENVIRONMENT SWITCHED (local → staging)
   google-services.json changed. You MUST rebuild the native app.
```

Press Enter to continue (you are about to rebuild anyway in 3.2).

This sets, for the mobile bundle:
`EXPO_PUBLIC_APP_ENV=local`, `EXPO_PUBLIC_API_URL_IOS=http://localhost:3001`,
`EXPO_PUBLIC_API_URL_ANDROID=http://10.0.2.2:3001`,
`EXPO_PUBLIC_INTERNAL_FEATURES_ENABLED=true`,
`EXPO_PUBLIC_LOCAL_DEV_OPTIONS_ENABLED=true`,
`EXPO_PUBLIC_DEFAULT_TIER=pro`, plus the **staging** Google client ids.

### 3.2 Terminal 2 — build and launch the simulator

The native `ios/` project is committed, so no prebuild is needed. Pods are already
installed; refresh them if the build complains:

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush/apps/mobile
(cd ios && pod install)          # only if the build complains about pods

npx expo run:ios
# or target a specific device:
npx expo run:ios --device "iPhone 16 Pro"
```

The first build takes several minutes. The app launches in the simulator and connects to the
Metro server from terminal 1.

### 3.3 Verify

- The simulator shares the host's `localhost`, so `http://localhost:3001` resolves to your
  API. No port forwarding needed.
- In the Metro logs you should see:
  ```
  [RuntimeConfig] Local dev — skipping stored config, fetching fresh
  [RuntimeConfig] Fetching config from: http://localhost:3001/api/config (attempt 1/3)
  [RuntimeConfig] Environment: local, projectId: traxettle-staging
  ```
  **`projectId: traxettle-staging` is the thing to confirm.**
- If you see `Local API unavailable`, terminal 1's API has not finished starting — the client
  retries 3× with 2 s backoff; reload the app (`r` in Metro).

### 3.4 Sign in on the simulator

Mock tokens are a web-console trick and are not exposed in the mobile UI, so on mobile use a
**real staging account**: register through the app, or use Google Sign-In (the staging iOS
client id and its reversed-client-id URL scheme are already registered in `app.json`).

For multi-user pool scenarios, drive the *other* participants from the web app (§2) or
`curl` against the same API — all three surfaces share the `traxettle-staging` data.

### 3.5 Troubleshooting

| Symptom | Fix |
|---|---|
| No simulators listed | §1.2 — install an iOS runtime |
| Build fails on pods | `cd ios && pod install --repo-update` |
| Build fails oddly after an env switch | `npm run prebuild:ios` (⚠️ `--clean` regenerates `ios/`), then `pod install` |
| App can't reach the API | confirm `curl localhost:3001/health` on the host; check `EXPO_PUBLIC_API_URL_IOS` in the Metro banner |
| Stale env values | `npx expo start -c` to clear the Metro cache |

---

## 4. Path A · Android emulator against staging

### 4.1 Start the emulator first

```bash
~/Library/Android/sdk/emulator/emulator -list-avds
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1 &
adb wait-for-device && adb devices
```

### 4.2 Terminal 1 — API + Metro

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
sh scripts/local-dev/03_real_mobile.sh staging
```

### 4.3 Terminal 2 — port forwarding + build

```bash
adb reverse tcp:3001 tcp:3001      # API
adb reverse tcp:8081 tcp:8081      # Metro

cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush/apps/mobile
npx expo run:android
```

> **Why both `10.0.2.2` and `adb reverse`?** The script sets
> `EXPO_PUBLIC_API_URL_ANDROID=http://10.0.2.2:3001`, which is the emulator's alias for the
> host loopback and normally works on its own. `adb reverse` is belt-and-braces and is what
> the repo's troubleshooting notes recommend when you see 401s.

### 4.4 Verify

```bash
adb logcat | grep -i "RuntimeConfig\|traxettle"
# expect: Environment: local, projectId: traxettle-staging
```

### 4.5 The Google Sign-In trap

Android compiles `google-services.json` **into the APK**, and Google Sign-In only works if the
signing certificate's SHA-1 is registered in that Firebase project.

`bootstrap.sh staging` copies `debug.keystore.staging` and `google-services.staging.json`
into `android/app/` and prints:

```
✅ debug.keystore.staging → android/app/debug.keystore
   SHA-1: AA:BB:CC:...
✅ google-services.staging.json → android/app/google-services.json
✅ SHA-1 matches google-services.json ✓
```

If instead you see **`⚠️ SHA-1 MISMATCH!`**, Google Sign-In will fail with **Error 10 /
DEVELOPER_ERROR**. Fix it by adding the printed SHA-1 in Firebase Console →
`traxettle-staging` → Project Settings → Android app → *Add fingerprint*, then re-download
`google-services.json` as `apps/mobile/google-services.staging.json` and rebuild.

Email+password sign-in works regardless.

### 4.6 Alternative — a self-contained staging APK (no Metro)

If you want to test the **bundled** app rather than a Metro-served one, and you accept that it
talks to the *deployed* staging API (so **no pooling** until you do §7):

```bash
cd apps/mobile
bash scripts/build-android.sh debug:staging
# → android/app/build/outputs/apk/release/app-release.apk
# auto-installs and launches on the connected emulator/device
```

Requires `keystore/traxettle-release-key.keystore` and `android/gradle.properties.local`.
Details in [`04-build-and-release.md`](04-build-and-release.md).

---

## 5. Path A · all three at once

```
Terminal 1   sh scripts/local-dev/04_real_web.sh staging     # API :3001 + Web :3000
Terminal 2   cd apps/mobile && npx expo start                # Metro only — API already running
Terminal 3   cd apps/mobile && npx expo run:ios
Terminal 4   adb reverse tcp:3001 tcp:3001 && npx expo run:android
```

Start **only one** script that launches the API — `04_real_web.sh` and `03_real_mobile.sh`
both bind :3001 and the second will fail. Use `04_real_web.sh` for the API + web, then a
plain `npx expo start` for Metro.

This is the ideal setup for multi-surface pool testing: be the custodian on web, a
contributor on iOS, and a second contributor on Android, all against the same
`traxettle-staging` data, and watch the `pool:updated` socket events refresh every surface
live.

---

## 6. Path B · the deployed staging API

Verifies the real deployed configuration with no local backend at all.

### 6.0 ⭐ Mobile — the purpose-built script

`scripts/local-dev/06_staging_mobile.sh` exists for exactly this: run the mobile **dev build**
on a simulator/emulator against the **deployed staging API** — no local API, no Firebase
emulators.

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush

bash scripts/local-dev/06_staging_mobile.sh ios            # default platform is ios
bash scripts/local-dev/06_staging_mobile.sh android
bash scripts/local-dev/06_staging_mobile.sh ios --build     # force a reinstall of the dev build
```

| Flag | Effect |
|---|---|
| *(none)* | installs the app where needed, starts the bundler, opens the app |
| `--build` | reinstalls the development build first (also automatic when the app is missing from the running simulator/emulator) |
| `--no-bundler` | install/build only, then exit. Opens the app if a bundler is already running |
| `--bundler-only` | start the bundler and open the app, without installing |
| `STAGING_API_URL=…` | override the staging API address |

What it does for you:

1. **Checks `$STAGING_API_URL/health` first** and aborts if staging is unreachable — the app
   cannot start without its API.
2. Runs `bootstrap.sh staging`, so the staging plist, `google-services.json`, keystore and
   Google client ids are all in place.
3. Loads `rc_staging.properties` if present (without it, Pro purchases will not work).
4. Exports `EXPO_PUBLIC_APP_ENV=staging`,
   `EXPO_PUBLIC_API_URL=$STAGING_API_URL`, and deliberately **blanks**
   `EXPO_PUBLIC_API_URL_IOS` / `_ANDROID` so the per-platform variables cannot override it.
5. **iOS:** installs onto **every booted simulator** (iPhones *and* iPads) — built once and
   copied to the rest, comparing a fingerprint of the app binary so a simulator left on an
   older native build gets updated. Boot more with `xcrun simctl boot <UDID>`. With none
   booted, Expo boots its default.
6. **iOS:** if the project was last built for TestFlight/Release, it clears Xcode's
   DerivedData and re-runs `expo prebuild --platform ios --clean` first — a Debug build on top
   of a Release one can fail to link (`Undefined symbols … facebook::react::Sealable`).
7. **Android:** builds and installs with Gradle (`app:installDebug`) rather than
   `expo run:android`, because that ends by opening a dev-client link this app cannot handle.
   Sets up `adb reverse tcp:8081`.
8. Starts `expo start --clear` and opens the app once the bundler answers.

> Two-terminal workflow for several devices: run `--bundler-only` in one terminal, then
> `--build --no-bundler` in another (again after booting another simulator, without restarting
> the bundler).
>
> In the bundler, press **`r`** to reload every device. **Do not press `i` / `a`** — those open
> Expo Go, which is not this app.

The first native build takes **10–20 minutes**. Subsequent runs are seconds.

### 6.1 Web

```bash
cd apps/web
NEXT_PUBLIC_APP_ENV=staging \
NEXT_PUBLIC_API_URL=https://traxettle-api-staging-943648574702.us-central1.run.app \
NEXT_PUBLIC_FIREBASE_API_KEY=<from fb-web-configs/traxettle-staging.env> \
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=traxettle-staging.firebaseapp.com \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=traxettle-staging \
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=traxettle-staging.firebasestorage.app \
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=943648574702 \
NEXT_PUBLIC_FIREBASE_APP_ID=<from fb-web-configs/traxettle-staging.env> \
npx next dev --webpack -p 3000
```

Or just use the hosted web app at `https://traxettle-staging.web.app`.

**Mock tokens do not work here** — `APP_ENV=staging` refuses them. Register or use Google.

### 6.2 Mobile — manual override (if you are not using §6.0)

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
sh scripts/local-dev/bootstrap.sh staging    # staging Firebase configs + keystore

cd apps/mobile
EXPO_PUBLIC_APP_ENV=staging \
EXPO_PUBLIC_API_URL=https://traxettle-api-staging-943648574702.us-central1.run.app \
EXPO_PUBLIC_API_URL_IOS= EXPO_PUBLIC_API_URL_ANDROID= \
npx expo start -c
# then, in another terminal:
npx expo run:ios      # or run:android
```

Blanking the per-platform variables matters — they are checked **before**
`EXPO_PUBLIC_API_URL` and would otherwise win. §6.0 does this for you.

### 6.3 Android — a self-contained staging APK

```bash
cd apps/mobile
bash scripts/build-android.sh debug:staging
# → android/app/build/outputs/apk/release/app-release.apk, auto-installed if a device is attached
```

A release-signed APK pointing at the staging API with **no Metro needed**. Requires
`keystore/traxettle-release-key.keystore` and `android/gradle.properties.local`.

### 6.4 Release builds and the 7-tap environment switch

> ⚠️ **The iOS build profiles changed.** `build-ios.sh` now takes **`debug | testflight`**
> only — the former `staging` and `production` EAS profiles are gone (EAS Build cannot install
> to a simulator). The script itself redirects you to
> `scripts/local-dev/06_staging_mobile.sh ios` for simulator-against-staging.

```bash
cd apps/mobile
APPLE_TEAM_ID=ABCDE12345 bash scripts/build-ios.sh testflight   # archives locally with Xcode, uploads
bash scripts/build-android.sh production                        # signed .aab for Play
```

**Release builds choose their API at runtime: production by default.** Testers switch to
staging with the hidden gesture:

1. Install the release/TestFlight build.
2. ⚠️ Tap **"Traxettle" 7 times on the sign-in screen** (within ~2 s). *The gesture moved —
   it used to be the version text on the profile screen.*
3. The developer options sheet appears (logs: `[DevOptions] 7 taps detected!`).
4. Toggle **Switch to Staging** → an orange **STAGE** badge appears, the app re-bootstraps, and
   `[RuntimeConfig] Fetching config from: https://…staging…/api/config` appears in the logs.
5. Force-close and reopen — the setting persists.
6. Toggle back to production and confirm the badge disappears.

> The gesture is documented as unreliable on emulators and intended for real devices
> (`traxettle-app/docs/app/DEVELOPER_OPTIONS_TESTING.md`).

---

## 7. Deploying to staging

Pooling **is** already deployed. Use this when you need *your* code there instead.
**Requires GCP credentials and changes a shared environment — get sign-off first.**

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
gcloud auth login
gcloud config set project traxettle-staging

# One-time / when secrets change
bash scripts/api-deployment/configure-staging.sh

# Deploy the API from the current branch
bash scripts/api-deployment/deploy-staging.sh

# Confirm pooling arrived
curl -s -o /dev/null -w '%{http_code}\n' \
  https://traxettle-api-staging-943648574702.us-central1.run.app/api/pools/event/x/summary
# 401 ⇒ deployed.  404 ⇒ not deployed.

bash scripts/api-deployment/verify-deployed-api-env.sh

# Web, if needed
bash scripts/web-deployment/deploy-web-staging.sh
```

Full detail and the production equivalents: [`05-deployment.md`](05-deployment.md).

---

## 8. Shutdown & cleanup

```bash
# Ctrl-C in the run-script terminal kills the whole process group (it traps EXIT/INT/TERM).

# Leftovers
lsof -ti:3001 | xargs kill      # API
lsof -ti:3000 | xargs kill      # web
lsof -ti:8081 | xargs kill      # Metro
adb reverse --remove-all

# Remove test data created in traxettle-staging
node scripts/cleanup-test-users.js
node scripts/check-users.js
```

Delete the events you created through the UI (Delete is blocked once an event is
settled/closed, so close out or delete before settling if you want a clean slate).

---

## 9. Pre-flight checklist

| | Check |
|---|---|
| ☐ | `node -v` is 24.x |
| ☐ | `git branch --show-current` is `feature/money-pooling` |
| ☐ | `rush install` + `build --to @traxettle/shared --to @traxettle/ui` have been run **after** the last pull |
| ☐ | All seven staging secret files from §1.4 are present |
| ☐ | `xcrun simctl list devices available` shows an iPhone |
| ☐ | `emulator -list-avds` shows an AVD |
| ☐ | `curl localhost:3001/api/config` reports `projectId: traxettle-staging` *(Path A)* |
| ☐ | `curl -o /dev/null -w '%{http_code}' <base>/api/pools/event/x/summary` returns **401**, not 404 |
| ☐ | `node scripts/local-dev/pool-smoke.mjs` prints `ALL LIVE CHECKS PASSED` *(Path A)* |
| ☐ | `bootstrap.sh` reported `SHA-1 matches google-services.json ✓` (needed only for Google Sign-In on Android) |
| ☐ | You are on a **staging or local** build if you need to test "Several of us" pools — they are hidden in production |

---

**Sources:**
`scripts/local-dev/{03_real_mobile,04_real_web,05_set-flags,06_staging_mobile,bootstrap}.sh` ·
`scripts/local-dev/pool-smoke.mjs` · `apps/mobile/scripts/build-{android,ios}.sh` ·
`apps/mobile/scripts/version.{sh,mts}` · `apps/mobile/{package.json,app.json,eas.json}` ·
`apps/mobile/src/config/{env,runtime}.ts` ·
`libraries/shared/src/pool-ui.ts` (`CONTRIBUTOR_POOLS_IN_PRODUCTION`,
`contributorPoolsAvailable`) · `scripts/api-deployment/*` · `scripts/web-deployment/*` ·
`traxettle-app/docs/runbook/{LOCAL_DEVELOPMENT,MONEY_POOLING_TESTING}.md` ·
`traxettle-app/docs/app/DEVELOPER_OPTIONS_TESTING.md` ·
live probes of the staging and production APIs (pooling verified **deployed**: `/api/pools/*`
returns 401)
