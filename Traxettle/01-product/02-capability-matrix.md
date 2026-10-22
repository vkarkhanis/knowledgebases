# Traxettle — Capability Matrix

The exhaustive answer to *"is X supported?"*. Legend: ✅ supported · 🚧 partial /
in progress · ❌ not supported (planned or declined).

This is a reorganised, verified restatement of `traxettle-app/docs/app/Functional.md`.
Where this KB and that file disagree, this file is the corrected version and the
discrepancy is logged in
[`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

---

## 1. Authentication & accounts

| Capability | | Notes |
|---|---|---|
| Email + password sign-up / sign-in | ✅ | bcrypt-hashed; `POST /api/auth/register`, `/login` |
| Google sign-in | ✅ | Firebase client-side Google auth, native on mobile |
| Email-link (passwordless) sign-in | ✅ | `/api/auth/email-link/send` + `/complete`; browser fallback page deep-links back into the app |
| Password visibility toggle | ✅ | Web and mobile |
| Forgot password | ✅ | `POST /api/auth/forgot-password` |
| JWT access token (1 h) + refresh token (7 d) | ✅ | `Authorization: Bearer <token>`; `/api/auth/refresh` |
| Automatic token refresh on expiry | ✅ | Client-side |
| Graceful auth-expiry handling | ✅ | Distinct error codes `AUTH_MISSING`, `AUTH_INVALID`, `AUTH_SESSION_REVOKED` |
| Session tracking & revocation | ✅ | `users/{id}/sessions/{sessionId}`; `POST /api/auth/revoke-sessions` |
| Concurrent sessions across devices | ✅ | By design — logging in on one device does not log out another |
| Provider-aware account behaviour | ✅ | `authProviders[]`, `hasPassword` on the profile |
| Mobile quick-unlock (PIN / biometrics) | ✅ | `SetupPinScreen`, `UnlockScreen`, `expo-local-authentication` |
| Profile view / update | ✅ | `GET`/`PUT /api/users/profile` |
| Payment-method details on profile | ✅ | UPI / bank / PayPal / Wise / SWIFT / other, per currency |
| Account deletion | ✅ | `DELETE /api/users/account` |
| Mock auth for development | ✅ | `Bearer mock-<uid>`; refused outside local/test |
| Phone OTP sign-in | ❌ | Endpoints exist but return "not available in phase 1" |
| Microsoft OAuth | ❌ | `POST /api/auth/microsoft` returns 410 |
| Apple sign-in | ❌ | — |
| Multi-factor authentication | ❌ | — |

## 2. Events

| Capability | | Notes |
|---|---|---|
| Create event (trip or event) | ✅ | Name, type, dates, currency, description, funding choice |
| Dashboard event list | ✅ | Real-time status updates via WebSocket |
| Event detail with tabs | ✅ | Pool (if pooled) · Expenses · Participants/Spenders · Groups · Invitations |
| Update event | ✅ | Admin only |
| Delete event | ✅ | Creator or admin; blocked for settled/closed; modal shows pending settlement amount |
| Lifecycle `active → review → payment → settled → closed` | ✅ | See [`03-user-journeys.md`](03-user-journeys.md) |
| Mutation lock on `payment`/`settled`/`closed` | ✅ | `review` is *not* locked — expenses stay editable, the plan is marked stale |
| Closed events hidden from dashboard | ✅ | Removed live over WebSocket when closed |
| Closed-events history view + export | ✅ | CSV and printable, web and mobile |
| Multi-currency settlement | ✅ | **Pro-gated server-side**; free users get `403 FEATURE_REQUIRES_PRO` on FX fields |
| **Free-tier event limit: 3** | ✅ | A non-Pro user may hold at most **3 `active` or `closed` events**; a 4th returns `403 "Free users can have at most 3 active or closed events/trips"`. `mock-` users are exempt. A **lapsed** Pro (tier `pro`, status `expired`) counts as free |
| Predefined or EOD FX rates | ✅ | `open.er-api.com` with Firestore caching and reverse lookup |
| Backfill participant ids (repair) | ✅ | `POST /api/events/:id/backfill-participants` |
| Event history by email | ✅ | `POST /api/events/history-email` |
| Event search / filter | ❌ | — |
| Event duplication | ❌ | — |

## 3. Participants & groups

| Capability | | Notes |
|---|---|---|
| View / add / remove participants | ✅ | Admin adds and removes others; a user may remove themselves |
| Roles (admin / member) + role change | ✅ | `PUT /api/events/:id/participants/:userId/role` |
| Creator protection | ✅ | The event creator cannot be removed |
| Create / update / delete group | ✅ | Creator or representative |
| Group as a single split & settle entity | ✅ | One payer pays/receives for the whole group |
| Group designated payer + representative | ✅ | First member by default; transferable |
| Group reuse across events | ✅ | `eventIds[]`; `POST /api/groups/:id/add-to-event` |
| Group suggestions on ≥70% member overlap | ✅ | `POST /api/groups/suggest` |
| Add / remove group member | ✅ | Creator, or self-removal |
| Bulk participant import | ❌ | — |
| Nested groups | ❌ | — |

## 4. Expenses

| Capability | | Notes |
|---|---|---|
| Create / view / edit / delete expense | ✅ | Creator or event admin for edit/delete |
| Expense date | ✅ | Settable and displayed |
| Equal / ratio / custom split | ✅ | |
| Split validation | ✅ | Splits must sum exactly to the total; submit disabled with a mismatch message |
| Entity selection for splits | ✅ | Pick which groups and individuals participate |
| Private expenses | ✅ | Visible only to the creator; filtered **server-side** |
| Exclude-private filter | ✅ | |
| "On behalf of" expenses | ✅ | Payer's share becomes 0; splits exclude the payer |
| Receipt / bill attachment | ✅ | Images or PDF, ≤5 MB, via `POST /api/uploads`; camera capture on mobile |
| Expense-name truncation in lists | ✅ | |
| Currency symbols in UI | ✅ | $ € £ ₹ ¥ A$ C$ |
| Event balance calculation | ✅ | Net per entity across all expenses |
| Split calculation helper API | ✅ | `POST /api/expenses/calculate-splits` |
| Membership required to read **and** create | ✅ | Hardened in Phase 6 |
| Expense categories / tags | ❌ | Called out as a prerequisite for category reporting |
| Recurring expenses | ❌ | — |
| Comments / notes on expenses | ❌ | — |
| Per-expense audit log | ❌ | Settlements and contributions have audit trails; expenses do not |
| Multi-currency *expenses* within one event | ❌ | One expense currency per event |

## 5. Settlement & payments

| Capability | | Notes |
|---|---|---|
| Greedy transaction-minimising settlement plan | ✅ | Entity-level, groups included |
| Generate plan (admin) | ✅ | `POST /api/settlements/event/:id/generate` |
| Entity balances | ✅ | `GET /api/settlements/event/:id/balances` |
| Settlement review & per-entity approval | ✅ | `Event.settlementApprovals`; stale detection |
| Regenerate plan | ✅ | `POST /api/settlements/event/:id/regenerate` |
| Payer marks paid | ✅ | `POST /api/settlements/:id/pay` → `initiated` |
| Payee confirms receipt | ✅ | `POST /api/settlements/:id/approve` → `completed` |
| Payee marks paid on payer's behalf | ✅ | `POST /api/settlements/:id/mark-paid-by-payee` |
| Payee rejects a claimed payment | ✅ | `POST /api/settlements/:id/reject` with reason |
| Retry a failed payment | ✅ | `POST /api/settlements/:id/retry`; `retryCount` tracked |
| Proof-of-payment upload | ✅ | `POST /api/settlements/:id/upload-proof`; storage proxy for display |
| Full audit trail per leg | ✅ | `SettlementAuditEntry[]` |
| Auto-settle when all legs complete | ✅ | Event auto-transitions `payment → settled` |
| Zero-balance shortcut | ✅ | All balances zero ⇒ straight to `settled` |
| Dual-currency display with FX rate | ✅ | Original + converted amount + rate |
| Payee payment methods shown on the leg | ✅ | So the payer knows how to pay |
| Cross-event unsettled payments view + export | ✅ | Summary and detail endpoints, CSV/print |
| Real-time settlement broadcast | ✅ | `settlement:generated`, `settlement:updated`, `event:updated` |
| Manual settlement as the default | ✅ | Users pay outside the app, then record it |
| Razorpay gateway settlement | 🚧 | Code exists (`create-razorpay-order`, `verify-razorpay`); **hidden behind `SETTLEMENT_GATEWAY_PILOT_ENABLED`**, off in production |
| BillDesk gateway settlement | 🚧 | Same flag; pending approval |
| Partial settlements | ❌ | A leg is all-or-nothing (pool *contributions* do support partial) |
| Settlement reminders | ❌ | — |

## 6. Money pooling

Functional detail: [`04-money-pooling-functional.md`](04-money-pooling-functional.md).

| Capability | | Notes |
|---|---|---|
| Funding choice at event creation | ✅ | Split expenses (default) or Pool money → Several of us / Just me |
| Five presets | ✅ | Kitty · Fund · Treasury · Collection · Budget |
| "Several of us" pools in **production** | 🚧 | Held back for the first release: `CONTRIBUTOR_POOLS_IN_PRODUCTION = false`. Offered only when `APP_ENV` is `local`/`development`/`staging`/`internal`; a missing/unknown env counts as production. **Production users get "Just me" budgets only.** The API supports all five presets |
| Self-approval of pool draws | ❌ | Deliberately blocked. A manager cannot approve their own pool expense (`403 POOL_SELF_APPROVAL`) — **except the custodian**, because it is their money. The same rule governs auto-approval |
| Reimbursement progress states | ✅ | *To reimburse → Reimbursement sent → Reimbursed*, derived from the claim plus its settlement leg |
| "Payments waiting on you" summary | ✅ | e.g. *"1 payment to confirm · 2 payments to make"*, on web and mobile |
| Settle-up blocked by pending draws | ✅ | `409 POOL_PENDING_DRAWS` — decide every draw first |
| Approved claims guaranteed a leg at settle-up | ✅ | Dissolution creates any missing reimbursement leg, so an event cannot settle without paying a claimant back |
| Hybrid events (pool + peer in one event) | ✅ | One combined settlement plan |
| Add a pool to an existing split event | ✅ | One-way conversion to hybrid; existing expenses untouched |
| Contributions with mark-paid → confirm | ✅ | Per-person or tiered; partial; waive; proof; custodian's own confirm instantly |
| Top-ups | ✅ | Ad-hoc money in any time |
| Pool expenses ("Paid with: Pool funds") | ✅ | No splits needed; deducts on approval |
| Reimbursement claims ("My money — claim it back") | ✅ | Receipt → approval → settlement leg, without settling or locking the event |
| Graduated overdraft with latch | ✅ | Warn to −20%, then pause until repaid plus more |
| Record-anyway for already-spent money | ✅ | Always recorded, flagged, custodian alerted |
| Approval modes | ✅ | never / above an amount / always |
| Authorised spenders (users or groups) with caps | ✅ | Sponsor budgets |
| Mandatory receipts | ✅ | Above a threshold, or always; claims default to required |
| Transparency ledger | ✅ | Balance meter, contributions, arrears, spend-by-person, every movement with receipts, cycle history |
| Recurring cycles with carry-forward | ✅ | Close a month, carry credits, open the next with fresh dues |
| Membership-change handling | ✅ | Funds square up a leaver and carry everyone else forward; treasuries just update the roster |
| Fair settle-up weighted by commitment | ✅ | Non-payers still owe their share |
| Deficit cover attribution | ✅ | Credited to whoever fronted it |
| Real-time pool updates | ✅ | `pool:updated` refreshes the pool tab and dashboard tiles |
| Consumption-weighted deficits | ✅ | Uses splits on pool expenses; **not** Pro-gated (a deliberate product decision) |
| Scheduled / automatic cycle closing | ❌ | A custodian or admin closes cycles; there is no background scheduler |
| Pool notifications by email or push | ❌ | In-app and socket only |

## 7. Web application

| Capability | | Notes |
|---|---|---|
| Auth pages (login, register, forgot password) | ✅ | |
| Dashboard with pool tile status | ✅ | |
| Create/edit event incl. funding step | ✅ | |
| Event detail with tabbed UI and modals | ✅ | Edit event, invite, create group — all in-page modals |
| Create / edit expense pages | ✅ | Entity selection, split validation, private, on-behalf-of, Paid with, receipts |
| Pool tab | ✅ | Meter, totals, funding banner, arrears, approvals, contributions, spenders, ledger, cycles, pool payments |
| Invitations, closed events, unsettled payments, profile, Pro, help | ✅ | |
| Guided onboarding tour | ✅ | `components/GuidedTour.tsx` |
| Toast notifications; no browser `alert`/`confirm` anywhere | ✅ | |
| Themed confirmation modals for destructive actions | ✅ | |
| Consistent status badge colours across dashboard and detail | ✅ | |
| Loading / error / empty states | ✅ | |
| Real-time updates | ✅ | Socket.IO, multi-event room subscription on the dashboard |
| Themes (light, dark, ocean, forest) | ✅ | |
| CSV / printable export | ✅ | Closed events and unsettled payments |
| Responsive / mobile-optimised layout | ❌ | Desktop-first |
| PWA | ❌ | — |
| WCAG accessibility conformance | ❌ | Partial ARIA only |

## 8. Mobile application

| Capability | | Notes |
|---|---|---|
| Auth, dashboard, event detail, expenses, groups, invitations | ✅ | |
| Pool screen (via a card on the event screen) | ✅ | `screens/PoolScreen.tsx` |
| Create/edit expense with Paid with + camera receipts | ✅ | |
| Closed events, unsettled payments, profile | ✅ | |
| Guided walkthrough | ✅ | |
| PIN / biometric unlock | ✅ | |
| In-app purchase (Google Play Billing / Apple IAP) | ✅ | via RevenueCat `react-native-purchases` |
| Hidden 7-tap developer menu | ✅ | Environment switch prod ⇄ staging with app re-bootstrap |
| Environment badge | ✅ | Orange "STAGE" badge when in staging mode |
| Shared-content intake (share an image into the app) | ✅ | `hooks/useSharedContent.ts`, Android SEND intent filter |
| Analytics screen | 🚧 | "Coming soon" placeholder |
| Push notifications | ❌ | — |
| Offline support | ❌ | — |

## 9. Platform, notifications, reporting

| Capability | | Notes |
|---|---|---|
| Email on invitation | ✅ | Nodemailer SMTP; mock mode logs to console when `SMTP_HOST` is unset |
| Email event / invitation history | ✅ | |
| In-app toasts | ✅ | |
| SMS / push / web push notifications | ❌ | |
| Notification preferences | ❌ | `UserPreferences.notifications` exists but is not acted on |
| Expense summary per event | ✅ | |
| CSV / PDF-style export | ✅ | Closed events, unsettled payments; pool ledgers viewable per cycle |
| Charts, spending trends, category breakdown | ❌ | |
| Admin / ops dashboard | ❌ | |
| Rush monorepo with custom commands | ✅ | |
| GitHub Actions CI on Node 24 | ✅ | Typecheck + shared/UI/API/web tests; mobile non-blocking |
| Docker images for API and web | ✅ | `Dockerfile`, `Dockerfile.web` |
| Firestore + Storage security rules | ✅ | Deliberately deny-all for clients; the Admin SDK bypasses them |
| Structured monitoring / log aggregation | ❌ | Console logging only |
| Rate limiting | ❌ | |
| OpenAPI / Swagger spec | ❌ | Use [`../02-architecture/02-api-reference.md`](../02-architecture/02-api-reference.md) |

## 10. Entitlements & billing controls

| Capability | | Notes |
|---|---|---|
| Server-authoritative tier + capability model | ✅ | `tier`, `entitlementStatus`, `entitlementSource`, `capabilities` |
| RevenueCat webhook ingestion (idempotent) | ✅ | `POST /api/billing/revenuecat/webhook` |
| Internal entitlement switch | ✅ | Non-prod only; env flag + internal-tester check |
| Tier update broadcast | ✅ | `user:tier-updated`; web refreshes profile live |
| Local tier switching (web + mobile) | ✅ | Only with local/internal flags |
| Staging/TestFlight mobile-only switching | ✅ | Web read-only there |
| Manual tier switch disabled in production | ✅ | Billing/webhook-driven only |
| Non-prod real-payment opt-in guardrails | ✅ | Requires env flag **and** request flag **and** internal-tester identity |

---

**Sources:** `traxettle-app/docs/app/Functional.md` · route files under
`traxettle-rush/apps/api/src/routes/` · `apps/web/src/`, `apps/mobile/src/` file trees ·
`libraries/shared/src/pool*.ts` · `.github/workflows/ci.yml`
