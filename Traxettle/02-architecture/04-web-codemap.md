# Web App — Code Map

`apps/web` · `@traxettle/web` · Next.js **16.1.6** (App Router, `--webpack`), React
**19.2.3**, styled-components **6.3**, Firebase JS SDK 10 (auth only), socket.io-client 4.

```bash
cd apps/web
npm run dev        # next dev --webpack  → http://localhost:3000
npm run build      # next build --webpack
npm run typecheck  # tsc --noEmit
npm test           # jest (jsdom) — coverage thresholds include the pool components
```

---

## 1. Routes → files

| Route | File | What it does |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing / redirect to dashboard or login |
| `/auth/login` | `src/app/auth/login/page.tsx` | Email+password, Google, email-link; password visibility toggle |
| `/auth/register` | `src/app/auth/register/page.tsx` | Sign-up |
| `/auth/forgot-password` | `src/app/auth/forgot-password/page.tsx` | Reset request |
| `/dashboard` | `src/app/dashboard/page.tsx` | Event tiles with status badges, FX badge and **pool tile status**; multi-event socket room subscription for live updates |
| `/events/create` | `src/app/events/create/page.tsx` | Event form incl. the **funding step** |
| `/events/[eventId]` | `src/app/events/[eventId]/page.tsx` | **The big one — ~2,400 lines.** Tabbed event detail |
| `/events/[eventId]/expenses/create` | `.../expenses/create/page.tsx` | Expense form incl. **Paid with** + receipts |
| `/events/[eventId]/expenses/[expenseId]/edit` | `.../edit/page.tsx` | Same form, pre-populated |
| `/invitations` | `src/app/invitations/page.tsx` | Pending invitations, accept/decline |
| `/invitations/accept` | `src/app/invitations/accept/page.tsx` | Tokenised invite landing page |
| `/closed-events` | `src/app/closed-events/page.tsx` | History + CSV/print export |
| `/unsettled-payments` | `src/app/unsettled-payments/page.tsx` | Cross-event outstanding legs + export |
| `/profile` | `src/app/profile/page.tsx` | Profile, payment methods, theme, local tier switch (flag-gated) |
| `/pro` | `src/app/pro/page.tsx` | Pro explainer; purchase happens on mobile |
| `/help` | `src/app/help/page.tsx` | Help content |
| `/open/event/[eventId]` | `src/app/open/event/[eventId]/page.tsx` | Deep-link entry that routes into the event |
| — | `src/app/layout.tsx` | Root layout, providers, `StyledComponentsRegistry` |

### The event detail page

`src/app/events/[eventId]/page.tsx` is the densest file in the web app (~2,400 lines, ~41
`useState` calls). It owns:

- the tab set, which is **conditional on the funding model**:

  | Tab | `data-testid` | Shown when |
  |---|---|---|
  | *\<pool noun\>* (Kitty/Fund/Treasury/Budget/Collection) | `tab-pool` | pooled or hybrid, with a `poolConfig` |
  | Expenses *(n)* | `tab-expenses` | always |
  | Spenders *(n)* | `tab-spenders` | **sponsor** pool only |
  | Participants *(n)* | `tab-participants` | non-sponsor |
  | Groups *(n)* | `tab-groups` | non-sponsor |
  | Invitations *(n)* | `tab-invitations` | non-sponsor |

- the summary grid (`pool-summary-grid`), settlement section, in-page modals (edit event,
  invite, create group, confirmations), and the socket subscription for the event room.

> This is why the design chose a **creation-time** funding choice rather than a runtime
> toggle: a toggle would have doubled every branch in an already very large page.

---

## 2. Pool components — `src/components/pool/`

| File | Export | Purpose |
|---|---|---|
| `FundingStep.tsx` | `FundingStep` | The create-event funding choice: Split-expenses vs Pool-money cards, funder choice, preset cards, target / per-person amounts, Advanced (tolerance %, approval mode + threshold, allow-peer-expenses). Test ids: `funding-pool`, `pool-target-input`, `pool-per-person-input`, `pool-tolerance-input`, `pool-approval-select`, `pool-allow-peer` |
| `PoolTab.tsx` | `PoolTab` | **838 lines.** The whole pool surface: header with actions, meter, totals, funding banner, arrears, pending approvals, contributions table, spenders, ledger, cycle history, and every modal (amount, mark-paid, set-amounts, reconcile). Test ids: `pool-tab`, `pool-title`, `pool-add-money`, `pool-set-amounts`, `pool-close-cycle`, `pool-settle-up`, `pool-totals`, `pool-funding`, `pool-arrears`, `pool-pending-approvals`, `pool-contributions`, `pool-spenders`, `pool-ledger`, `pool-cycles`, `pool-amount-modal`, `pool-amount-input`, `pool-amount-submit`, `pool-mark-paid-modal`, `pool-amounts-modal`, `pool-reconcile-modal` |
| `PoolMeter.tsx` | `PoolMeter` | The three-zone balance meter. Renders `meterGeometry()` and `meterCaption()` from `@traxettle/shared`. Test ids `pool-meter` (with `data-zone`), `pool-meter-caption` |
| `PoolPayments.tsx` | `PoolPayments` | Pool side legs (reimbursement / cycle / leaver) with pay and confirm. Test ids `pool-payments`, `pool-leg-pay-submit` |
| `PoolTileStatus.tsx` | `PoolTileStatus`, `remainingPct` | The compact dashboard-tile pool indicator. Test id `pool-tile-status` |
| `PaidWithControl.tsx` | `PaidWithControl` | The **Paid with** selector on the expense form. Offers only the funding sources the event allows; shows live headroom and the receipt requirement |
| `SpenderPermissions.tsx` | `SpenderPermissions` | Sponsor budgets: tick *Can spend* per participant/group, set caps, save |
| `ReceiptField.tsx` | `ReceiptField` | Receipt picker + uploader with required/disabled states and upload progress |
| `fundingChoice.ts` | — | Thin re-export/adapter over the shared `FundingChoice` helpers |
| `poolFormat.ts` | — | Local formatting shims over `formatMinor` etc. |

Everything numeric in these components comes from `@traxettle/shared` — the web app does
not re-derive balances, headroom, captions or validation.

## 3. Other components

| File | Purpose |
|---|---|
| `components/WebAppShell.tsx` | Navigation shell: dashboard, invitations, profile, theme |
| `components/GuidedTour.tsx` | Onboarding walkthrough |
| `components/PasswordInput.tsx` | Password field with a visibility toggle |
| `lib/StyledComponentsRegistry.tsx` | SSR style collection for styled-components |

## 4. Config, hooks, services, utils

| File | Purpose |
|---|---|
| `config/firebase-client.ts` | Firebase JS SDK init from `NEXT_PUBLIC_FIREBASE_*` — **auth only** |
| `config/dev-options.ts` | `getResolvedApiBaseUrl()` and local dev toggles |
| `hooks/useSocket.ts` | Socket.IO: joins `event:{id}` rooms (and multiple rooms for the dashboard), exposes handlers for every event name |
| `services/onboarding.ts` | Guided-tour state persistence |
| `utils/api.ts` | The HTTP client — see below |
| `utils/pool-api.ts` | `poolApi` — one method per pool endpoint, plus `uploadReceipt` / `uploadContributionProof`, `fileToBase64`, `RECEIPT_ACCEPT`, `MAX_RECEIPT_BYTES` (5 MB) |
| `utils/errorMessages.ts` | Error → user-facing copy mapping |
| `utils/passwordRules.ts` | Re-export of the shared password rule |
| `utils/closed-events-export.ts` | CSV / printable export for closed events |
| `utils/unsettled-export.ts` | CSV / printable export for unsettled payments |
| `utils/mobile-subscribe.ts` | Routes web users to the mobile app for purchase |
| `types/styled.d.ts` | styled-components theme typing |

### The HTTP client (`utils/api.ts`)

- Resolves the base URL via `getResolvedApiBaseUrl()` (from `NEXT_PUBLIC_API_URL`, with dev
  overrides).
- **Always gets a fresh token**: `getAuth().currentUser.getIdToken(true)`, caching it in
  `localStorage['traxettle.authToken']`, falling back to the cached value if Firebase is
  unavailable. This is what makes auth expiry graceful.
- 25 s timeout via `AbortController`.
- Throws `WebApiError { message, status, code, data }` — **`data` carries the structured pool
  refusal details**, which is how `describePoolRefusal()` can render the exact shortfall.
- On 401 it dispatches a `traxettle:webAuthUnauthorized` window event so the shell can
  redirect to login from anywhere.

### Test-user shortcut (local only)

The Playwright suite and manual local testing sign in by writing to `localStorage`:

```js
localStorage.setItem('traxettle.authToken', 'mock-alice');
localStorage.setItem('traxettle.uid', 'mock-alice');
```

Then reload. Switching user = changing the value. This only works where the API accepts
`mock-` tokens (local/test).

## 5. Tests

`src/__tests__/`

| Path | Covers |
|---|---|
| `pool/pool-components.test.tsx` | 340 lines — rendering of the pool components |
| `pool/pool-interactions.test.tsx` | 358 lines — user interactions through the pool tab |
| `pool/pool-logic.test.ts` | Pool-adjacent web logic |
| `hooks/useSocket.test.ts` | Socket subscription and handler wiring |
| `app/`, `config/`, `utils/` (+ snapshots) | Page-level and utility coverage |

`jest.config.cjs` sets coverage thresholds that **include the pool components**, so adding
pool UI without tests will fail `npm test`.

---

**Sources:** `apps/web/package.json` · `apps/web/src/**` ·
`apps/web/src/app/events/[eventId]/page.tsx` · `apps/web/src/components/pool/*` ·
`apps/web/src/utils/{api,pool-api}.ts` · `apps/web/jest.config.cjs`
