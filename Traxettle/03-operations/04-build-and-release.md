# Build & Release

---

## 1. What builds what

| Target | Command (from `apps/mobile`) | Task | Output |
|---|---|---|---|
| Android **debug APK** → local API | `bash scripts/build-android.sh debug` | `app:assembleDebug` | `android/app/build/outputs/apk/debug/app-debug.apk` — needs Metro running |
| Android **self-contained release APK** → staging API | `bash scripts/build-android.sh debug:staging` | `app:assembleRelease` | `android/app/build/outputs/apk/release/app-release.apk` — **no Metro needed**; auto-installs if a device is attached |
| Android **staging bundle** | `bash scripts/build-android.sh staging` | `app:bundleRelease` | `android/app/build/outputs/bundle/release/app-release.aab` → Play Console internal testing |
| Android **production bundle** | `npm run build:android:production` | `app:bundleRelease` | same path `.aab` → Play Console production. **Also runs `version.sh prepare/record android`** |
| iOS **local debug** | `bash scripts/build-ios.sh debug` | `expo run:ios --configuration Debug` | runs on simulator/device locally, against the local API |
| iOS **TestFlight** | `APPLE_TEAM_ID=… bash scripts/build-ios.sh testflight` <br>or `npm run build:ios:testflight` | **local Xcode archive** + upload | uploaded to App Store Connect → TestFlight → promote to App Store |
| iOS/Android **simulator vs deployed staging** | `bash scripts/local-dev/06_staging_mobile.sh ios\|android` *(from repo root)* | `expo run:ios` / `gradlew app:installDebug` | dev build on every booted simulator / the emulator |
| Web | `cd apps/web && npm run build` | `next build --webpack` | `.next/` |
| API | `cd apps/api && npm run build` | `tsc` | `dist/` |

### ⚠️ The iOS profiles changed

`build-ios.sh` now accepts **`debug | testflight` only**. The former `staging` and
`production` profiles used EAS Build and have been **removed** — EAS cloud builds cannot
install to a simulator. Passing them prints a redirect:

```
For TestFlight:   APPLE_TEAM_ID=<your Team ID> bash scripts/build-ios.sh testflight
For a simulator against the deployed staging API (from traxettle-rush/):
                  bash scripts/local-dev/06_staging_mobile.sh ios
```

`testflight` archives the **production release** build locally with Xcode and uploads it.
Release builds **choose their API at runtime** — production by default; testers switch to
staging by tapping **"Traxettle" 7 times on the sign-in screen**.

Removed npm scripts: `build:ios`, `build:ios:staging`, `build:ios:production`,
`build:android:dev`, and the misleading `build:android:staging` (which used to run the
*production* profile — now fixed by deletion). Added: `build:ios:testflight`,
`version:show`, `version:bump`.

---

## 2. What the build scripts actually do

Both `scripts/build-android.sh` and `scripts/build-ios.sh` follow the same five steps.

1. **Validate prerequisites** — the right `google-services.<env>.json` /
   `GoogleService-Info.<env>.plist`, and for release profiles the keystore and signing
   credentials. Missing files abort with an explicit message.
2. **Place the Firebase config** —
   `google-services.<env>.json` → `android/app/google-services.json`;
   `GoogleService-Info.<env>.plist` → `ios/Traxettle/GoogleService-Info.plist`
   (and the canonical `GoogleService-Info.plist` for the Expo config plugin).
3. **Load RevenueCat keys** from the gitignored `rc_<env>.properties` via
   `scripts/revenuecat/load-rc-config.sh`. For release profiles the key is
   **required** (`rc_require_nonempty`); for debug it only warns.
4. **Write the environment** —
   - a temporary `apps/mobile/.env` so Metro inlines the `EXPO_PUBLIC_*` values at bundle time
   - a temporary `apps/mobile/src/config/buildEnv.ts` as a TS fallback, so a release bundle
     always carries the RevenueCat keys even if Expo's dotenv inlining is skipped on some
     native paths

   Both are backed up if they already existed and **restored or deleted on exit** via a
   `trap`. Neither should ever be committed.
5. **Run the build** and print the output path.

### Environment per profile

| Profile | `EXPO_PUBLIC_APP_ENV` | API URL | Firebase env | RC properties |
|---|---|---|---|---|
| `debug` (both) | `local` | `http://localhost:3001` | `local` → `traxettle-test` | `rc_local` |
| `debug:staging` (Android) | `staging` | `https://traxettle-api-staging-943648574702.us-central1.run.app` | `staging` | `rc_staging` |
| `staging` (Android) | `staging` | same staging URL | `staging` | `rc_staging` |
| `production` (Android) | `production` | `EXPO_PUBLIC_API_URL` if set, else the prod URL | ⚠️ `staging` | ⚠️ `rc_production` (does not exist) |
| `testflight` (iOS) | `production` | chosen at **runtime** (production by default) | ⚠️ `staging` | `rc_prod` |

Override the production API URL explicitly:

```bash
EXPO_PUBLIC_API_URL=https://traxettle-api-prod-ncwutlgtga-uc.a.run.app \
  bash scripts/build-android.sh production
```

### ⚠️ Remaining production-profile gaps

See [`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md)
for the tracked list. Still open:

1. **Production uses the staging Firebase config.** Both scripts still set
   `FIREBASE_ENV="staging"` for their production-grade profile, even though
   `google-services.prod.json` and `GoogleService-Info.prod.plist` exist in the repo.
2. **Production uses the staging Google OAuth client ids**, with an explicit
   `warn "Using staging OAuth client IDs — replace with production IDs…"`. `app.json`
   registers reversed-client-id URL schemes only for local and staging, so a production
   client id needs a third entry.
3. **`build-android.sh production` loads `rc_production.properties`**, but only
   `rc_prod.properties` exists — `rc_require_nonempty` will abort the build.
4. `eas.json` still carries `EXPO_PUBLIC_API_URL: "https://REPLACE_WITH_PRODUCTION_API_URL"`,
   though `eas.json` is no longer on the build path for iOS.

Fixed since the previous KB revision: the iOS production profile no longer silently falls
back to the staging API (that profile is gone), and the misleading
`build:android:staging` npm alias has been removed.

---

## 2a. Versioning — iOS and Android share one version

New scheme (`scripts/version.mts`, driven by `scripts/version.sh`). Replaces the old
"bump four files by hand" process.

```bash
cd apps/mobile
npm run version:show            # = bash scripts/version.sh status
npm run version:bump            # = bash scripts/version.sh bump   (also: patch | minor | major | x.y.z)
```

| Command | Effect |
|---|---|
| `version.sh status` | current version, what each platform last shipped, what the next builds get |
| `version.sh prepare <ios\|android>` | picks this build's version and writes it to the files |
| `version.sh record <ios\|android> [build]` | records a finished store build (Android reads its `versionCode`) |
| `version.sh bump <patch\|minor\|major\|x.y.z>` | starts a release by hand, e.g. `bump minor` for new features |

**The store build scripts call `prepare` and `record` themselves** —
`build-android.sh production` and `build-ios.sh testflight`. A *failed* build therefore
reuses its version on the next attempt.

How the shared version works:

- `app.json` `expo.version` is the version **both** platforms ship.
- `package.json` `version` and `android/app/build.gradle` `versionName` mirror it;
  `build.gradle` also holds the Android `versionCode`.
- `release-versions.json` records what each platform last shipped, so **a platform never
  ships the same version twice** (the patch number goes up), and **the second platform of a
  release ships the version the first one moved to**.

```jsonc
// apps/mobile/release-versions.json  (committed)
{ "ios":     { "version": "1.0.33", "build": null },
  "android": { "version": "1.0.37", "build": "39" } }
```

`version.mts` is TypeScript run **directly by Node** via type stripping, so it needs Node
≥22.18 (the repo pins 24). `version.sh` checks `process.features.typescript` and fails with a
clear message otherwise.

Files it writes (and that you must commit): `apps/mobile/app.json`, `package.json`,
`android/app/build.gradle`, `release-versions.json`.

`TRAXETTLE_MOBILE_DIR` points it at another `apps/mobile` directory (used by its tests,
`src/__tests__/version-script.test.ts`).

---

## 3. Android signing

| Key | Location | Alias |
|---|---|---|
| Release | `apps/mobile/keystore/traxettle-release-key.keystore` | `traxettle-key` |
| Debug (local) | `apps/mobile/debug.keystore.local` | `androiddebugkey` (store/key password `android`) |
| Debug (staging) | `apps/mobile/debug.keystore.staging` | `androiddebugkey` |

Signing credentials go in `apps/mobile/android/gradle.properties.local` (gitignored):

```properties
TRAXETTLE_RELEASE_STORE_FILE=traxettle-release-key.keystore
TRAXETTLE_RELEASE_STORE_PASSWORD=<password>
TRAXETTLE_RELEASE_KEY_ALIAS=traxettle-key
TRAXETTLE_RELEASE_KEY_PASSWORD=<password>
```

Upload key SHA-1 (per the repo's deployment doc):
`6A:77:3A:F7:80:44:DF:90:49:77:64:40:89:15:27:AB:8D:10:AE:26`

Generate a debug keystore: `sh scripts/firebase/create-debug-keystore.sh`.

> **Never commit keystores or `gradle.properties.local`.** Both are in `.gitignore`.
> **Every debug/release certificate's SHA-1 must be registered in the matching Firebase
> project** or Google Sign-In fails with Error 10.

---

## 4. iOS signing

| Path | Tooling |
|---|---|
| EAS (`build-ios.sh staging\|production`) | `credentialsSource: "local"`; EAS prompts for or reuses Apple credentials. Requires an enrolled Apple Developer account |
| Local Xcode archive | `npm run prebuild:ios` → `cd ios && pod install` → `open ios/Traxettle.xcworkspace` → set team + version → *Product → Archive* → Organizer → *Distribute App* |

Bundle identifier `com.traxettle.app`.

---

## 5. Version checklist

**Do not edit version fields by hand any more** — use `version.sh` (§2a). The store build
scripts run `prepare` before and `record` after the build.

```bash
cd apps/mobile
npm run version:show       # confirm what the next build will ship
npm run version:bump minor # only when starting a new feature release
```

> **`versionCode` must strictly increase for every Play Console upload.** `version.mts`
> handles this; it also guarantees a platform never ships the same `version` twice.

Current: `app.json`/`package.json` **1.0.37**; last shipped — iOS `1.0.33`,
Android `1.0.37` build `39`.

---

## 6. Release channels

| Channel | Artefact | Destination |
|---|---|---|
| Android internal testing | signed `.aab` (`staging` profile) | Play Console → Testing → Internal testing |
| Android production | signed `.aab` (`production` profile) | Play Console → Production |
| Android sideload | `app-release.apk` (`debug:staging`) | `adb install -r`, or Firebase App Distribution |
| iOS TestFlight → App Store | archive + upload (`testflight` profile) | App Store Connect → TestFlight, then promote to the App Store |
| iOS/Android simulator vs deployed staging | dev build | `scripts/local-dev/06_staging_mobile.sh` |

iOS now uploads in **one command**:

```bash
cd apps/mobile
APPLE_TEAM_ID=ABCDE12345 bash scripts/build-ios.sh testflight
```

It archives the production release build locally with Xcode and uploads it — no EAS. The
`plugins/ios-release-signing.js` config plugin signs with an **App Store profile when no
device is attached**. An App Store Connect API key is required; see
`traxettle-app/docs/utility/` for the iOS subscription runbook.

> The script leaves an `ios/.release-build` marker. `06_staging_mobile.sh` reads it and
> regenerates the iOS project before the next simulator (Debug) build, because building Debug
> on top of a Release build can fail to link
> (`Undefined symbols … facebook::react::Sealable`).

### Promoting the same bundle

The mobile release strategy intentionally supports **promoting the same bundle** from closed
testing to production:

- Released builds default to **production** at runtime.
- The hidden 7-tap gesture — **"Traxettle" tapped 7 times on the sign-in screen** — moves the
  runtime environment to **staging** for testing.
- Switching requires an app **re-bootstrap** so Firebase project selection stays aligned
  with the API.

This is why `/api/config` exists: the binary does not hard-code its environment.

---

## 7. Store assets

`play-store-assets/` holds the Play Console listing material (icons, screenshots, copy).

---

## 8. CI

`.github/workflows/ci.yml` — on push to `main` and PRs to `main`/`stage`:

```
Node 24
  → node common/scripts/install-run-rush.js install
  → node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
  → typecheck: apps/api, apps/web, apps/mobile  (npx tsc --noEmit)
  → test: libraries/shared, libraries/ui, apps/api, apps/web   (npm test -- --ci)
  → test: apps/mobile   (continue-on-error: true)
```

CI invokes **package scripts directly**, not `rush test:*`, because those shell out to a
global `rushx`.

Mobile tests are non-blocking because of two **pre-existing** failures unrelated to pooling:
`src/__tests__/firebase.test.ts` (expects a stale emulator project id) and
`src/__tests__/App.test.tsx` (Jest cannot parse the suite).

CI does **not** build mobile artefacts, run Playwright, or run Maestro.

---

## 9. Pre-release checklist

| | Item |
|---|---|
| ☐ | `rush install` + shared/UI build clean |
| ☐ | `npx tsc --noEmit` green in api, web, mobile |
| ☐ | `npm test` green in shared, ui, api, web |
| ☐ | Playwright E2E green |
| ☐ | Maestro flows green on at least one platform |
| ☐ | Manual pass of [`03-staging-test-scenarios.md`](03-staging-test-scenarios.md) |
| ☐ | `npm run version:show` reports the intended version; `version:bump` run if this is a new feature release |
| ☐ | Correct `google-services.<env>.json` and `GoogleService-Info.<env>.plist` in place |
| ☐ | `rc_<env>.properties` populated (release builds **require** the RC key) |
| ☐ | Signing keystore + `gradle.properties.local` present |
| ☐ | Signing SHA-1 registered in the target Firebase project |
| ☐ | `EXPO_PUBLIC_API_URL` set explicitly for production |
| ☐ | `SETTLEMENT_GATEWAY_PILOT_ENABLED` **off** for production |
| ☐ | `ALLOW_MOCK_AUTH` **unset** everywhere deployed |
| ☐ | `JWT_SECRET` / `JWT_REFRESH_SECRET` set on the deployed API |
| ☐ | `bash scripts/doctor.sh production --non-interactive` clean |
| ☐ | No `.env` or `buildEnv.ts` accidentally committed (`git status` after a build) |
| ☐ | `app.json`, `package.json`, `android/app/build.gradle` and `release-versions.json` committed after a store build |
| ☐ | Decide deliberately whether `CONTRIBUTOR_POOLS_IN_PRODUCTION` should still be `false` for this release |

Also see `traxettle-app/docs/deployment/FIRST_RELEASE_CHECKLIST.md`.

---

**Sources:** `apps/mobile/scripts/build-android.sh` · `apps/mobile/scripts/build-ios.sh` ·
`apps/mobile/scripts/version.sh` · `apps/mobile/scripts/version.mts` ·
`apps/mobile/release-versions.json` · `apps/mobile/plugins/ios-release-signing.js` ·
`apps/mobile/{package.json,app.json,eas.json}` · `scripts/local-dev/06_staging_mobile.sh` ·
`scripts/revenuecat/load-rc-config.sh` · `scripts/firebase/create-debug-keystore.sh` ·
`libraries/shared/src/pool-ui.ts` · `.github/workflows/ci.yml` · `.gitignore` ·
`traxettle-app/docs/deployment/{DEPLOYMENT_CHANNELS,FIRST_RELEASE_CHECKLIST}.md`
