# Troubleshooting

Symptom → cause → fix. Grouped by where you hit it.

---

## Monorepo & tooling

| Symptom | Cause | Fix |
|---|---|---|
| Rush refuses to run, complains about Node | `rush.json` pins `>=24.11.1 <25` | `nvm install 24 && nvm use 24`, or prefix with `RUSH_ALLOW_UNSUPPORTED_NODEJS=1` (works, untested by Rush) |
| **"Rush is already running"** | Another Rush process holds the lock | Use the atomic scripts `scripts/local-dev/0{1,2,3,4}_*.sh` — they run via `install-run-rushx.js` and hold no lock |
| Changed a shared type / pool formula, nothing happened | Apps import `@traxettle/shared` from its built `dist/` | `node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui` |
| `rush test:api` fails with "rushx not found" | The `test:*` commands shell out to a **global** `rushx` | Run the package script instead: `cd apps/api && npm test` |
| `Cannot find module '@traxettle/shared'` | Install or build not run | `rush install` then the shared build |
| Playwright `webServer` fails to start | Its commands also use `rushx` | Install `rushx` globally, or start the servers manually on 3200/3201 |
| Typecheck passes locally, fails in CI | Stale `dist/` locally | Rebuild shared/UI, then re-run `npx tsc --noEmit` in each app |

---

## API

| Symptom | Cause | Fix |
|---|---|---|
| `401 AUTH_MISSING` | No / malformed `Authorization: Bearer <token>` header | Send the header |
| `401 AUTH_INVALID` on a `mock-` token | `APP_ENV` is not `local` and `NODE_ENV` is not `test`/`development` | Start the API with `APP_ENV=local`. **Never** set `ALLOW_MOCK_AUTH=true` on a deployed service |
| `401 AUTH_SESSION_REVOKED` | The session was revoked (`/api/auth/revoke-sessions`) or deleted | Sign in again |
| API starts but every write vanishes on restart | ⚠️ No Firebase credentials ⇒ **silent** in-memory Firestore fallback | Check `GET /api/config` → `firebaseConfig.projectId`; set `FIREBASE_PRIVATE_KEY_FILE` (or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`) |
| `JWT_SECRET is not configured` | Required outside local/test/development — it refuses to use a dev default | Set `JWT_SECRET` and `JWT_REFRESH_SECRET` |
| Invitation emails never arrive | No `SMTP_HOST` ⇒ email service runs in **mock mode** and logs to the console | Configure SMTP; check `emailSent` / `emailError` on the invitation document |
| Email-link completion fails | `FIREBASE_WEB_API_KEY` missing — Identity Toolkit REST needs it | Set it from `fb-web-configs/<project>.env` |
| Email-link opens a browser and stops | Normal — that is the fallback page | `GET /auth/email-link` redirects to `com.traxettle.app://auth/email-link?...`; tap the button if autoredirect is blocked |
| `413` / upload rejected | >5 MB, or a MIME type outside the allowlist | Shrink the file or use JPEG/PNG/WebP/HEIC/PDF |
| `403 Forbidden: Cannot modify this event` | The event is in `payment`/`settled`/`closed` | Expected — only `active` and `review` are editable |
| `403 FEATURE_REQUIRES_PRO` | A free user set an FX field | Switch tier (non-prod) or drop the FX fields |
| `404 Route not found` for `/api/pools/...` | ⚠️ The running API is **not** from the pooling branch | Check out `feature/money-pooling`, rebuild, restart. On a deployed service, deploy the branch |
| `400 VALIDATION_ERROR: <path>: <msg>` | A pool payload failed its zod schema (`.strict()`) | Remove unknown keys; send integers for `*Minor` fields |

---

## Pool-specific

| Symptom | Cause | Fix / expected |
|---|---|---|
| Confirmed money but the balance didn't move | Only **confirmed** contributions count; a contributor's *mark paid* is not enough | The custodian must **Confirm** |
| Balance shows 0 and every draw is refused on a `graduated` pool | Baseline 0 ⇒ tolerance 0 ⇒ floor 0. **Correct behaviour** — it degrades to `block` | Add and confirm money |
| Topped up but spending is still paused | ⚠️ The **latch**: the balance must rise **above** `clearance% × baseline` (default 0, i.e. the overdraft repaid *plus more*) | Add more than the amount in the caption |
| `POOL_UNDERFUNDED` even though there is money in the pool | `requireFullFundingBeforeSpend` (Collection preset) | Collect the full target first |
| `POOL_SPENDER_CAP` | Spend-so-far (approved **and** pending) exceeds `spenderCapsMinor` | Raise the cap, or record as already-paid |
| `POOL_RECEIPT_REQUIRED` and no "record it anyway" | By design — this is the one refusal that is not overridable | Attach a receipt |
| *"Pool expenses must be in the pool currency (INR)"* | Expense currency ≠ event currency | Use the pool currency |
| *"How an expense was paid cannot be changed."* | `fundingSource` is immutable | Delete and re-add |
| Draw approved but the balance didn't drop | It is still `pending` — only **approved** draws deduct | Approve it |
| Cycle close refused | `uncoveredDeficitMinor > 0` — the shortfall must be attributed | Supply `cover`, or accept the custodian default |
| *"The custodian cannot leave the pool."* | By design | Reassign the custodian first |
| A reimbursement leg never appears | The claim was filed **by the custodian** ⇒ `selfReimbursed`, no leg needed | Expected |
| `reconcileCycle invariant violated: Σnet X ≠ closing Y` | A genuine engine bug — the ledger does not balance | Capture the cycle id, contributions and draws, and open an issue. Do not paper over it |
| Refund amounts look equal when they should be proportional | ⚠️ Would be the pro-rata unfairness bug | Verify against test B5 in [`03-staging-test-scenarios.md`](03-staging-test-scenarios.md) |
| A non-payer appears to owe nothing | Their contribution was **waived** (which correctly removes their commitment weight) — or a bug | Check the status; see test B6 |
| Pool tab missing on a pooled event | `poolConfig` absent, or the funding model is `peer_to_peer` | The tab requires `poolFunded && event.poolConfig` |
| Extra empty cycles appearing | Should not happen — a membership change only forces a boundary once money has moved | Report it |

---

## Web

| Symptom | Cause | Fix |
|---|---|---|
| Stuck on login / instant redirect | No token in `localStorage`, or it expired | Sign in; for local testing set `traxettle.authToken` + `traxettle.uid` to `mock-alice` and reload |
| Logged out repeatedly | A 401 dispatches `traxettle:webAuthUnauthorized` | Check the API's `APP_ENV` and Firebase project — a project mismatch invalidates tokens |
| Requests go to the wrong API | `NEXT_PUBLIC_API_URL` is inlined at build time | Restart `next dev` with the right value |
| Pool refusal shows a generic error | `WebApiError.data` was dropped on the way to `describePoolRefusal()` | Pass the whole error through `poolErrorText(err, currency)` |
| Styles flash / mismatch on first paint | styled-components SSR | `StyledComponentsRegistry` must wrap the tree in `app/layout.tsx` |
| Socket updates not arriving | Not joined to the room, or the wrong base URL | Confirm `join-event` fired and the socket connected on path `/ws` |
| Layout broken on a phone-size window | Known — the web app is desktop-first | Use the mobile app |

---

## Mobile — general

| Symptom | Cause | Fix |
|---|---|---|
| `Local API unavailable — start the API server first` | The app launched before the API | It retries 3× with 2 s backoff; press `r` in Metro to reload |
| App reaches a *hosted* API in local dev | Should not happen — local mode deliberately never falls back | Check `EXPO_PUBLIC_API_URL_IOS` / `_ANDROID` in the Metro banner |
| `auth/custom-token-mismatch` | The client Firebase project ≠ the API's Firebase project | Clear the runtime config cache / re-bootstrap; confirm both report the same `projectId` |
| `EXPO_PUBLIC_*` change has no effect | Inlined by Metro at bundle time | `npx expo start -c` |
| RevenueCat offerings empty | Key missing from `rc_<env>.properties`, or the entitlement/offering id differs | Check `GET /api/config` → `revenueCatConfig` (staging uses `traxettle-pro` / `traxettle-default`) |
| Stale runtime config after switching environment | Stored config is only reused when it is complete **and** matches the selected environment | `clearRuntimeConfigCache()` or reinstall; a switch triggers a re-bootstrap |
| Stuck on the unlock screen | PIN/biometric session state | Re-run set-up; clear app data if necessary |

---

## Mobile — Android

| Symptom | Cause | Fix |
|---|---|---|
| **Google Sign-In Error 10 / DEVELOPER_ERROR** | The signing certificate's SHA-1 is not registered in that Firebase project | Run `bootstrap.sh <env>` and read its SHA-1 output. Add it in Firebase Console → Android app → *Add fingerprint*, re-download `google-services.<env>.json`, **rebuild natively** |
| `⚠️ SHA-1 MISMATCH!` from bootstrap | Keystore SHA-1 ≠ `certificate_hash` in `google-services.json` | As above |
| Google Sign-In broke right after switching environment | `google-services.json` is **compiled into the APK** | `npx expo run:android` to rebuild. `03_real_mobile.sh` warns about this via `.last-mobile-env` |
| 401 from the emulator | Host not reachable | `adb reverse tcp:3001 tcp:3001` (and `tcp:8081` for Metro); confirm `10.0.2.2` is in use |
| Metro unreachable from the emulator | Port not forwarded | `adb reverse tcp:8081 tcp:8081` |
| Gradle release build fails on signing | Missing keystore or `gradle.properties.local` | See [`04-build-and-release.md`](04-build-and-release.md) §3 |
| `rc_require_nonempty` aborts the build | A release profile requires a non-empty RevenueCat key | Populate `rc_<env>.properties` |
| Play Console rejects the upload | `versionCode` not strictly incremented | Bump it in `android/app/build.gradle` |

---

## Mobile — iOS

| Symptom | Cause | Fix |
|---|---|---|
| `xcrun simctl list devices available` is empty | No iOS runtime installed (common on a fresh Xcode) | `xcodebuild -downloadPlatform iOS`, or Xcode → Settings → Components |
| Build fails on pods | Pods out of date | `cd ios && pod install --repo-update` |
| Build fails after an environment switch | Native project out of sync | `npm run prebuild:ios` (⚠️ `--clean` regenerates `ios/`), then `pod install` |
| `GoogleService-Info.plist` not found | Not copied in | `bootstrap.sh <env>` copies it to `ios/Traxettle/`; the `copy-google-service-plist` plugin handles prebuild |
| Google Sign-In does nothing | The reversed-client-id URL scheme is missing for that environment | `app.json` registers local + staging. A **production** client id needs a third entry |
| `build-ios.sh staging` doesn't give me a simulator app | It uses **EAS cloud build** by design | Use `npx expo run:ios` for the simulator |
| EAS build fails on credentials | `credentialsSource: "local"` and no Apple credentials | Run `eas build` interactively once, or archive from Xcode |

---

## Firebase emulators

| Symptom | Cause | Fix |
|---|---|---|
| "Java not found" | Emulators need a JDK | `brew install openjdk@21` |
| Emulator data gone | It only persists to `.firebase/emulator-data/` on a **clean** shutdown | Stop with `rush dev:firebase:emulators:stop`, not `kill -9` |
| Port already in use | A previous run is alive | `lsof -ti:8080,9099,9199,4000 \| xargs kill` |
| API not using the emulators | Missing env | `FIREBASE_USE_EMULATOR=true` plus `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST` |
| Emulator ID tokens rejected | The emulator does not sign verifiably | The fallback decoder requires `aud`/`iss` to match `FIREBASE_PROJECT_ID` — it must be `traxettle-local` |
| `firebase.test.ts` fails on mobile | ⚠️ Known pre-existing failure (stale emulator project id) | Not your regression |

---

## Deployment

| Symptom | Cause | Fix |
|---|---|---|
| Deployed API returns 404 for `/api/pools/...` | That branch isn't deployed | [`05-deployment.md`](05-deployment.md) §2 |
| Deployed API accepts `mock-` tokens | ⚠️ `ALLOW_MOCK_AUTH=true` or `APP_ENV` not set to staging/production | **Fix immediately** — every account is impersonable |
| Deployed API loses data | ⚠️ Broken credentials ⇒ silent in-memory fallback | Verify `GET /api/config` → `projectId` and do a real write |
| Tier never upgrades in production | Webhook secret missing, URL not registered, or `REVENUECAT_PRO_ENTITLEMENT_ID` mismatched | Check `GET /api/billing/revenuecat/webhook-debug` and the RevenueCat dashboard |
| Emails silently not sent | No `SMTP_HOST` ⇒ mock mode | Configure SMTP on the service |
| CORS problems | `cors()` is wide open (`origin: '*'`) — unlikely to be the cause | Look elsewhere; and note this as a hardening item |
| Need to roll back | — | `gcloud run services update-traffic <service> --region us-central1 --to-revisions <REV>=100` |

---

## Diagnostics cheat sheet

```bash
# API identity and health
curl -s <base>/health
curl -s <base>/api/config | python3 -m json.tool

# Is pooling mounted?  401 = yes, 404 = no
curl -s -o /dev/null -w '%{http_code}\n' <base>/api/pools/event/x/summary

# Is mock auth (correctly) refused on a deployed service?
curl -s -o /dev/null -w '%{http_code}\n' <base>/api/users/profile -H 'Authorization: Bearer mock-x'

# Full pooling smoke test
node scripts/local-dev/pool-smoke.mjs

# Doctor
bash scripts/doctor.sh local --non-interactive
cd tools/doctor-tool && npm run dev

# Ports
lsof -ti:3000,3001,3002,8081,8080,9099,9199,4000

# Android
adb devices && adb reverse --list
adb logcat | grep -i "RuntimeConfig\|traxettle"

# iOS
xcrun simctl list devices available
xcrun simctl list runtimes

# Cloud Run logs
gcloud run services logs tail traxettle-api-staging --region us-central1

# Deployed env vs expectations
bash scripts/api-deployment/verify-deployed-api-env.sh
```

---

**Sources:** `apps/api/src/{middleware/auth.ts,config/firebase.ts}` ·
`apps/api/src/services/pool.service.ts` · `libraries/shared/src/{pool-math,pool-ui}.ts` ·
`apps/mobile/src/config/runtime.ts` · `scripts/local-dev/{bootstrap,03_real_mobile}.sh` ·
`apps/mobile/scripts/build-{android,ios}.sh` · `e2e/playwright.config.ts` ·
`traxettle-app/docs/runbook/LOCAL_DEVELOPMENT.md` §Troubleshooting ·
`traxettle-app/docs/app/DEVELOPER_OPTIONS_TESTING.md`
