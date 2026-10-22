# Mobile App — Code Map

`apps/mobile` · `@traxettle/mobile` v**1.0.37** · React Native **0.81.5** / Expo SDK
**~54** / React 19.1 · React Navigation 6 (native stack) · styled-components 6 ·
Firebase JS SDK 10 (auth only) · `react-native-purchases` **^10.14** (RevenueCat).

```bash
cd apps/mobile
npm start                 # expo start (Metro :8081)
npm run ios               # expo run:ios      — builds & launches the iOS simulator
npm run android           # expo run:android  — builds & launches the Android emulator
npm run typecheck         # tsc --noEmit
npm test                  # jest
npm run prebuild:ios      # expo prebuild --platform ios --clean
npm run prebuild:android  # expo prebuild --platform android --clean

npm run version:show      # bash scripts/version.sh status
npm run version:bump      # start a release (patch | minor | major | x.y.z)
npm run build:ios:testflight      # archive locally with Xcode + upload
npm run build:android:production  # signed .aab
```

> Run the app on a simulator against the **deployed staging API** with
> `bash scripts/local-dev/06_staging_mobile.sh ios|android` from the repo root.

Identity: bundle id / package `com.traxettle.app`; URL scheme `com.traxettle.app`;
EAS project `c54ee544-0b20-4d5a-b8d3-873f4df16602`; owner `vkarkhanis`.
Native projects (`ios/`, `android/`) are committed, so `expo run:*` works without a prebuild.

---

## 1. Navigation

`src/App.tsx` composes three navigators selected by auth state
(`user`, `loading`, `pinSetupRequired`, `sessionLocked`):

| Stack | Screens |
|---|---|
| **Auth** | `Login`, `Register`, `ForgotPassword` |
| **Lock** | `SetupPin`, `Unlock` — gates the app behind a PIN / biometric when enabled |
| **Main** | `Dashboard` · `EventDetail` · **`Pool`** · `CreateEvent` · `CreateExpense` · `EditExpense` · `Profile` · `Invitations` · `ProUpgrade` · `AllEvents` · `ClosedEvents` · `Help` · `Analytics` · `UnsettledPayments` |

`CreateEvent`, `CreateExpense`, `EditExpense` and `ProUpgrade` present as `card` on iOS and
`modal` on Android. The `Pool` screen takes its title from
`route.params.title` (the preset noun), defaulting to `"Pool"`.

## 2. Screens → files

| Screen | File | Notes |
|---|---|---|
| Login / Register / ForgotPassword | `screens/{Login,Register,ForgotPassword}Screen.tsx` | Email+password, Google (native sign-in), email-link; password visibility toggle |
| SetupPin / Unlock | `screens/{SetupPin,Unlock}Screen.tsx` | `expo-local-authentication` + `expo-secure-store` |
| Dashboard | `screens/DashboardScreen.tsx` | Event list, pull-to-refresh, status + FX badges, pool status on tiles |
| AllEvents | `screens/AllEventsScreen.tsx` | Full list beyond the dashboard's slice |
| EventDetail | `screens/EventDetailScreen.tsx` | Summary cards, expense list, settlement cards with dual currency and pay/confirm, groups. **`event-detail-pool-card`** opens the Pool screen; **`event-detail-settle-pool`** routes settle-up there |
| **Pool** | `screens/PoolScreen.tsx` | **580 lines.** Test ids: `pool-summary`, `pool-title`, `pool-arrears`, `pool-add-money`, `pool-set-amounts`, `pool-close-cycle`, `pool-settle-up` (labelled *"Finish & report"* for sponsors), `pool-pending-approvals`, `pool-payments`, `pool-contributions`, `pool-spender-permissions`, `pool-spenders`, `pool-ledger`, `pool-cycles`, `pool-add-expense` (FAB) |
| CreateEvent | `screens/CreateEventScreen.tsx` | Event form incl. the funding choice and Pro-gated FX fields |
| CreateExpense / EditExpense | `screens/{CreateExpense,EditExpense}Screen.tsx` | Entity selection, split calculation, on-behalf-of, **Paid with**, *Take photo / Choose photo* receipts |
| Profile | `screens/ProfileScreen.tsx` | Profile, payment methods, theme, local security, environment badge, the hidden 7-tap trigger |
| Invitations | `screens/InvitationsScreen.tsx` | Accept / decline |
| ClosedEvents | `screens/ClosedEventsScreen.tsx` | History + export/share |
| UnsettledPayments | `screens/UnsettledPaymentsScreen.tsx` | Cross-event outstanding legs |
| ProUpgrade | `screens/ProUpgradeScreen.tsx` | RevenueCat offering + purchase |
| Help | `screens/HelpScreen.tsx` | Help & features |
| Analytics | `screens/AnalyticsScreen.tsx` | 🚧 "coming soon" placeholder |

## 3. Components

| File | Purpose |
|---|---|
| `components/pool/PoolViews.tsx` | **261 lines** — the mobile pool primitives: meter (`pool-meter`, `pool-meter-caption`, `accessibilityRole="progressbar"`), the funding choice cards (`funding-pool`, `pool-target-input`, `pool-per-person-input`, `pool-allow-peer`), ledger/contribution rows |
| `components/DeveloperOptions.tsx` | The developer sheet: environment switch, diagnostics |
| `components/DeveloperOptionsTrigger.tsx` | The **7-tap within ~2 s** gesture wrapper. Logs `[DevOptions] Tap n…`. ⚠️ On release builds the gesture is on **"Traxettle" on the sign-in screen**, not the profile version text |
| `components/DeveloperOptionsTest.tsx` | Harness for the trigger |
| `components/EnvironmentBadge.tsx` | Orange **STAGE** badge when staging mode is on |
| `components/GuidedWalkthrough.tsx` | Onboarding |
| `components/PasswordInput.tsx` | Password field with visibility toggle |
| `examples/` | `DeveloperOptionsUsage.tsx`, `ProductionAPIErrorHandling.tsx` — reference patterns, not shipped UI |

## 4. Configuration

| File | Purpose |
|---|---|
| `config/env.ts` | The static `ENV` object: `APP_ENV`, `PROD_API_URL`, `STAGING_API_URL`, dev `API_URL` (`10.0.2.2` on Android, `localhost` on iOS), `WS_URL`, RevenueCat keys, Google OAuth client ids (with hard-coded dev/prod defaults), feature flags. Exports `getApiUrl()`, `getEmulatorApiUrl()`, `isLocalLikeEnv()` |
| `config/runtime.ts` | `RuntimeConfigManager` — fetch/cache `/api/config`, staging-mode toggle, completeness and environment-match validation. See [`00-system-architecture.md`](00-system-architecture.md) §5 |
| `config/buildEnv.ts` | `BUILD_ENV` fallback for RevenueCat keys. **Generated by the build scripts and gitignored** — they back it up and restore it afterwards |
| `utils/subscriptionTerms.ts` | App Review-ready subscription copy for the Pro screen (tested by `src/__tests__/subscriptionTerms.test.ts`) |
| `scripts/version.mts` / `version.sh` | One shared version for both stores — see [`../03-operations/04-build-and-release.md`](../03-operations/04-build-and-release.md) §2a |
| `release-versions.json` | **Committed** record of what each platform last shipped |
| `plugins/ios-release-signing.js` | Config plugin that signs with an App Store profile when no device is attached |

### API URL resolution (`getApiUrl()`), in order

1. `EXPO_PUBLIC_API_URL_ANDROID` / `EXPO_PUBLIC_API_URL_IOS` (platform-specific)
2. `EXPO_PUBLIC_API_URL`
3. `ENV.API_URL` — in `__DEV__`, `http://10.0.2.2:3001` (Android) or
   `http://localhost:3001` (iOS); otherwise the production URL

`10.0.2.2` is the Android emulator's alias for the host machine's loopback. On a physical
device use your LAN IP, or `adb reverse tcp:3001 tcp:3001`.

## 5. Services & state

| File | Purpose |
|---|---|
| `api.ts` | The HTTP client (263 lines) — see below |
| `services/pool.ts` | `poolService` — one method per pool endpoint, mirroring the web client, plus `payLeg` / `confirmLeg` / `rejectLeg` helpers for pool side legs and receipt upload |
| `services/firebase.ts` | Firebase JS SDK init from runtime config (auth only) |
| `services/local-session.ts` | PIN / biometric session state |
| `services/environment-switch.ts` | Orchestrates a staging ⇄ production switch |
| `services/app-rebootstrap.ts` | Full app re-bootstrap after an environment change, so Firebase is reinitialised against the right project |
| `services/onboarding.ts` | Walkthrough state |
| `services/purchases.ts` | RevenueCat configure / offerings / purchase / restore |
| `context/AuthContext.tsx` | Session, token persistence, entitlement hydration, lock state |
| `context/PurchaseContext.tsx` | Purchase state and entitlement refresh |
| `context/ThemeContext.tsx` | Theme selection |
| `context/FeedbackContext.tsx` | Toasts / feedback |
| `hooks/useSocket.ts` | Socket.IO subscription incl. `pool:updated` |
| `hooks/usePaymentProviders.ts` | Gateway availability |
| `hooks/useSharedContent.ts` | Handles images shared into the app (Android SEND intent) |
| `utils.ts`, `utils/errorMessages.ts`, `utils/openFile.ts`, `utils/passwordRules.ts` | Helpers |
| `theme.ts`, `types.ts` | Theme tokens and local types |

### The HTTP client (`src/api.ts`)

- Tokens in AsyncStorage: `@traxettle_token`, `@traxettle_refresh_token`.
- Other keys: `@traxettle_staging_mode`, `@traxettle_dev_firebase_emulator`,
  `@traxettle_runtime_config`.
- **`setRuntimeApiBaseUrl(url)`** is called once runtime config loads, so `api.ts` talks to
  *the same server that supplied the Firebase config*. Without this the client could resolve
  its URL independently (via the staging-mode flag) and end up against a different Firebase
  project — producing `auth/custom-token-mismatch`.
- Single-flight token refresh (`refreshInFlight`) so a burst of 401s triggers one refresh.
- A pluggable `AuthFailureHandler` lets `AuthContext` sign the user out gracefully.
- Throws `ApiRequestError { message, status, code, feature, data }` — `feature` carries the
  Pro-gating feature name, `data` the structured pool refusal details.

## 6. Native configuration

| File | Purpose |
|---|---|
| `app.json` | Expo config: name, slug, scheme, version `1.0.33`, splash, iOS `infoPlist` (camera/photo usage strings, three `CFBundleURLTypes` — the app scheme plus a Google Sign-In reversed-client-id scheme for **each** of local and staging), Android package + SEND intent filter, plugin `./plugins/copy-google-service-plist`, EAS project id |
| `eas.json` | Three build profiles — `development` (dev client, internal, APK), `staging` (internal, app-bundle, local credentials, staging API), `production` (store, app-bundle, local credentials; `EXPO_PUBLIC_API_URL` still a placeholder) |
| `plugins/copy-google-service-plist` | Config plugin that places `GoogleService-Info.plist` during prebuild |
| `metro.config.js`, `babel.config.js` | Bundler config (monorepo-aware) |
| `scripts/build-android.sh`, `scripts/build-ios.sh` | The build entry points — see [`../03-operations/04-build-and-release.md`](../03-operations/04-build-and-release.md) |
| `maestro/` | Maestro E2E flows, run scripts, and a Firebase emulator data snapshot |

### Per-environment secret files (all gitignored)

| File | Environment |
|---|---|
| `google-services.local.json` / `.staging.json` / `.prod.json` | Android Firebase config |
| `GoogleService-Info.local.plist` / `.staging.plist` / `.prod.plist` | iOS Firebase config |
| `debug.keystore.local` / `.staging` | Android debug signing (SHA-1 must be registered in the matching Firebase project) |
| `keystore/traxettle-release-key.keystore` | Android release signing |
| `android/gradle.properties.local` | Release signing credentials |

`scripts/local-dev/bootstrap.sh <local|staging>` copies the right ones into place and
validates that the keystore SHA-1 matches `certificate_hash` in `google-services.json` —
a mismatch is the cause of Google Sign-In **Error 10 / DEVELOPER_ERROR**.

## 7. Tests

`src/__tests__/` — `context/` (AuthContext entitlement hydration and switching),
`hooks/`, `services/pool.test.ts` (127 lines), plus snapshots.

> Two **pre-existing, known** failures, unrelated to pooling, are why CI runs mobile tests
> as non-blocking: `firebase.test.ts` expects a stale emulator project id, and
> `App.test.tsx` cannot be parsed by Jest. See
> [`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

---

**Sources:** `apps/mobile/package.json` · `apps/mobile/app.json` · `apps/mobile/eas.json` ·
`apps/mobile/src/**` · `apps/mobile/src/config/{env,runtime}.ts` ·
`apps/mobile/src/api.ts` · `apps/mobile/src/services/pool.ts` ·
`apps/mobile/scripts/build-{android,ios}.sh` · `scripts/local-dev/bootstrap.sh`
