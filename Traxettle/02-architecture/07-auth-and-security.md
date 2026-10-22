# Authentication, Authorization & Security

---

## 1. Token model

`requireAuth` (`apps/api/src/middleware/auth.ts`) accepts `Authorization: Bearer <token>`
and tries four strategies **in this order**:

| # | Form | Verification | Notes |
|---|---|---|---|
| 1 | `mock-<uid>` | none | **Development only.** `uid` is the literal token (e.g. `mock-alice`), email `mock@example.com`. Refused unless `isMockAuthAllowed()` |
| 2 | Traxettle JWT | `jwt.verify(token, JWT_SECRET)` **and** `authService.isSessionActive(userId, sessionId)` | Issued by `/api/auth/register`, `/login`, `/refresh`. Revoked sessions ⇒ `401 AUTH_SESSION_REVOKED` |
| 3 | Firebase ID token | `auth.verifyIdToken(token)` | What the web and mobile clients send after a Firebase sign-in |
| 4 | Emulator ID token | decode + check `aud === FIREBASE_PROJECT_ID` and `iss` contains `securetoken.google.com/<projectId>`, take `sub`/`user_id` | Only attempted when `FIREBASE_USE_EMULATOR=true` (the emulator does not sign tokens verifiably) |

Failures return `401` with a `code`:

| `code` | Cause |
|---|---|
| `AUTH_MISSING` | Header absent, not `Bearer `, or empty token |
| `AUTH_INVALID` | Nothing verified it — including a `mock-` token outside local/test |
| `AUTH_SESSION_REVOKED` | Valid JWT, inactive session |

`req.user` is then `{ uid, email?, name?, sessionId? }`.

### Mock auth — the exact rule

```ts
function isLocalOrTestEnvironment(): boolean {
  return process.env.APP_ENV === 'local'
      || process.env.NODE_ENV === 'test'
      || process.env.NODE_ENV === 'development';
}
export function isMockAuthAllowed(): boolean {
  return isLocalOrTestEnvironment() || process.env.ALLOW_MOCK_AUTH === 'true';
}
```

The default is **deny**: an unset environment refuses mock tokens. This was hardened in
Phase 6 and is covered by `apps/api/src/__tests__/middleware/auth.test.ts`.

> Never set `ALLOW_MOCK_AUTH=true` on a deployed service. It makes every account
> impersonable by anyone who can guess a user id.

### JWT secrets

`JWT_SECRET` and `JWT_REFRESH_SECRET` are **required** in any non-local environment —
`getJwtSecret()` throws `"JWT_SECRET is not configured"` rather than falling back. In
local/test/development it falls back to `local-dev-jwt-secret-change-me` /
`local-dev-jwt-refresh-secret-change-me`.

Lifetimes: access **1 hour**, refresh **7 days**.

### Sessions

Each login creates `users/{uid}/sessions/{sessionId}` (`randomUUID`). The `sessionId` is
embedded in the JWT and checked on every authenticated request, which is what makes
`POST /api/auth/revoke-sessions` effective immediately. **Concurrent sessions across devices
are allowed by design** — signing in on one device does not sign out another.

---

## 2. Sign-in methods

| Method | Flow |
|---|---|
| **Email + password** | `POST /api/auth/register` / `/login`. Passwords bcrypt-hashed. Returns a `TokenPair` + profile |
| **Google** | Client-side Firebase Google auth → ID token → `POST /api/auth/google`. Native on mobile via `@react-native-google-signin/google-signin` |
| **Email link (passwordless)** | `POST /api/auth/email-link/send` → the user clicks → `POST /api/auth/email-link/complete` with `{ email, link?, oobCode? }`, completed server-side against the Identity Toolkit REST API (needs `FIREBASE_WEB_API_KEY`). If the link opens in a browser instead of the app, `GET /auth/email-link` serves a page that redirects to `com.traxettle.app://auth/email-link?...` |
| **Firebase bootstrap** | `POST /api/auth/bootstrap-firebase` links an existing Traxettle account to a Firebase Auth user |
| Phone OTP | ❌ stubbed — `signInWithPhone` logs a mock OTP and `verifyOTP` accepts `123456`; the routes return "not available in phase 1" |
| Microsoft | ❌ returns **410** |

### Google Sign-In configuration

Three OAuth client ids per Firebase project (web / Android / iOS), supplied as
`EXPO_PUBLIC_GOOGLE_{WEB,ANDROID,IOS}_CLIENT_ID`. `scripts/local-dev/bootstrap.sh` extracts
them from `google-services.*.json` (`client_type` 3 = web, 1 = Android) and
`GoogleService-Info.*.plist` (`CLIENT_ID`), writing `scripts/local-dev/.bootstrap.env`.

**Android requires the signing certificate's SHA-1 to be registered in the Firebase
project.** `bootstrap.sh` compares the keystore's SHA-1 against `certificate_hash` in
`google-services.json` and warns loudly on a mismatch, because that mismatch is exactly what
produces **Error 10 / DEVELOPER_ERROR**.

| Project | Project number | Clients |
|---|---|---|
| `traxettle-test` (local) | `603084161476` | web `…-igddelh46pe5l2t0hajsl52da0rici6o`, android `…-ii602klf0go223a0ve690kopl7u5e7a0`, ios `…-j4ht8hs7kk6tqqh273q2ks89udmdc3pe` |
| `traxettle-staging` | `943648574702` | web `…-n7h4msh3iho1187po0dnc8tja7insc89`, android `…-0qk99r3oql0sv3k4h6cgluffdqs7letj`, ios `…-cvgj086ppdcbqgcagrekjs4pekn0q1ok` |
| `traxettle-prod` | — | ⚠️ the build scripts still use the **staging** client ids for the production profile. See [`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md) |

`app.json` registers a reversed-client-id URL scheme for the local **and** staging iOS
clients, which is what lets one binary do Google Sign-In in either environment.

> **Switching environment requires a native rebuild on Android.** `google-services.json` is
> compiled in. `03_real_mobile.sh` detects an environment change and prints a warning before
> starting Metro.

---

## 3. Mobile local security

Optional, on top of the server session:

| Piece | File |
|---|---|
| PIN set-up and unlock screens | `screens/SetupPinScreen.tsx`, `screens/UnlockScreen.tsx` |
| Biometric / device authentication | `expo-local-authentication` |
| Secret storage | `expo-secure-store` |
| Lock state | `services/local-session.ts`, surfaced as `pinSetupRequired` / `sessionLocked` on `AuthContext`, which selects the Lock navigator |

This gates the **app**, not the API. A stolen device with a valid refresh token still needs
the PIN to get past the lock screen.

---

## 4. Authorization

Three layers, applied in order by the routes.

### Layer 1 — event membership (`utils/event-access.ts`)

```ts
canAccessEvent(eventId, userId)   // createdBy | admins[] | participantIds[] | participants subcollection
requireEventAccess(eventId, userId)  // throws EventAccessError(404 | 403)
```

The `participantIds[]` array is checked before the subcollection because older events may
lack one or the other; the subcollection is the fallback. `requireEventAccess` returns
**404** for a missing event and **403** for a non-member.

Required to read **and** to create expenses — hardened in Phase 6.

### Layer 2 — event lifecycle lock (`utils/event-guards.ts`)

```ts
getEventLockStatus(eventId)    // 'payment' | 'settled' | 'closed' | null
requireEditableEvent(eventId)  // throws Forbidden when locked
markStaleIfInReview(eventId)   // sets settlementStale after a mutation during review
```

`review` is deliberately **not** locked — expenses stay editable and the plan is marked
stale instead.

### Layer 3 — role / ownership, per route

See [`../01-product/03-user-journeys.md`](../01-product/03-user-journeys.md) §7 for the full
table. The important ones:

| Check | Implementation |
|---|---|
| Event admin | `event.createdBy === uid \|\| event.admins.includes(uid)` |
| Expense edit/delete | expense creator **or** event admin |
| Leg pay | `settlement.fromUserId === uid` |
| Leg confirm/reject | `settlement.toUserId === uid` |
| Pool manager | `PoolService.isManager()` — custodian **or** event admin |
| Pool draw | `PoolService.canDraw()` — custodian, `authorizedSpenders`, or a member of an `authorizedSpenderGroups` group |
| Upload a contribution proof | the contributor **or** the custodian |
| Group update | group creator **or** representative |

### Private-expense filtering

```ts
filterVisibleExpenses(expenses, viewerId, groups)
```

A private expense is visible to the creator's **entity** — the creator, or fellow members of
the event group the creator belongs to. Applied **server-side** on every event-expense read,
so privacy never depends on a client honouring a flag.

### Pro capability gating

`EntitlementService.assertCapability(userId, capability)` throws a `403` carrying
`code: 'FEATURE_REQUIRES_PRO'` and `feature: 'multi_currency_settlement'`. Applied on event
create/update when FX fields are present.

---

## 5. Firestore & Storage rules

Both are **deny-all for clients**, by design.

```js
// firestore.rules
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
match /{document=**} { allow read, write: if false; }
```

```js
// storage.rules
match /users/{userId}/{allPaths=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
match /{allPaths=**} { allow read, write: if false; }
```

The reasoning is written into the rules: *"Traxettle clients should not talk to Firestore
directly. The API uses the Firebase Admin SDK and is NOT restricted by rules. This ruleset is
intentionally strict to prevent data leakage if someone extracts the public Firebase config
from the web app."*

The `users/{uid}/**` allowance is a safe baseline for any future client-private data; nothing
currently relies on it.

Per-environment rule variants live in `scripts/firebase/rules-{staging,test,improved}.txt`.

---

## 6. Uploads

`upload.service.ts` / `POST /api/uploads`:

- base64 payload → **MIME allowlist** → **5 MB cap** → Cloud Storage → URL
- PDFs allowed for receipts and contribution proofs
- paths are scoped: `events/{eventId}/receipts/…`, `pools/{eventId}/contributions/{id}/…`,
  `settlements/{id}/proofs/…`
- emulator-aware (writes to the Storage emulator when configured)
- `GET /api/settlements/storage-proxy/:objectPath` streams an object back so proof images
  render in the UI without handing signed URLs to the browser
- `express.json` is raised to **12 MB** to accommodate the base64 inflation

Access checks: receipts require event access; contribution proofs require being the
contributor **or** the custodian.

---

## 7. Other hardening

| Measure | Where |
|---|---|
| `helmet()` security headers | `apps/api/src/index.ts` |
| zod `.strict()` validation on all pool writes | `apps/api/src/validation/pool.schemas.ts` — unknown keys rejected; arrays capped (contributions ≤200, spenders ≤200, spender groups ≤100, cover ≤50); strings capped (notes 500, references 200, URLs 2000) |
| Password strength rule shared by API and clients | `libraries/shared/src/passwordRules.ts` |
| Secrets kept out of git | `.gitignore` covers `.env*`, `*.keystore`, `fb-service-accounts/`, `*sa*.json`, `google-services*.json`, `GoogleService-Info*.plist`, `rc_*.properties`, `buildEnv.ts` |
| Secret cleanup guidance | `scripts/api-deployment/SECRET_CLEANUP.md` |
| Deployed-config verification | `scripts/api-deployment/verify-deployed-api-env.sh` |

### Known weaknesses

Recorded in full in
[`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).
The two that matter most:

1. **`cors()` is wide open** on the API and Socket.IO (`origin: '*'`). Acceptable while auth
   is header-based (no cookies to steal via CSRF), but it is not defence in depth.
2. **The Firebase in-memory fallback is silent.** A production deployment with broken
   credentials will start, serve traffic, and quietly lose every write. The money-pooling
   design document calls this out explicitly as out of scope for that plan.

There is also **no rate limiting**.

---

**Sources:** `apps/api/src/middleware/auth.ts` · `apps/api/src/services/auth.service.ts` ·
`apps/api/src/utils/{event-access,event-guards}.ts` ·
`apps/api/src/services/entitlement.service.ts` · `apps/api/src/services/upload.service.ts` ·
`apps/api/src/validation/pool.schemas.ts` · `firestore.rules` · `storage.rules` ·
`apps/mobile/app.json` · `scripts/local-dev/bootstrap.sh` ·
`apps/mobile/scripts/build-{android,ios}.sh` · `.gitignore`
