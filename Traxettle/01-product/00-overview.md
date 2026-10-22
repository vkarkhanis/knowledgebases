# Traxettle — Product Overview

## What it is

Traxettle is a **shared-expense coordination** product. Whenever several people spend
money together and then need a clean, non-awkward way to work out who owes whom,
Traxettle is the shared ledger and the settlement referee.

It is not merely a bill splitter. The distinguishing capabilities are:

- **Events as the organising unit** — a trip, a flat, a wedding, a club season, a team outing
- **Groups as first-class split entities** — a couple or a family can be one payer and one
  debtor rather than two or four line items
- **A review phase before money moves** — participants approve the proposed settlement
  before anyone is asked to pay
- **Two-sided payment confirmation** — the payer marks paid, the payee confirms receipt,
  with optional proof-of-payment images and a full audit trail
- **Money pooling** — collect money up front and spend from the pool, as an alternative
  funding model to "everyone pays their own way and we net out at the end"
- **Multi-currency settlement** — spend in one currency, settle in another, with either a
  rate fixed at event creation or the latest end-of-day rate

## The two funding models

This is the single most important concept in the product.

| | **Peer-to-peer** (the default, and all historic events) | **Pool** |
|---|---|---|
| Shape | expense-first, debt-derived | fund-first, balance-drawn |
| Money flow | *"someone spends their own money → splits accrue → balances net out → one settlement plan at the end"* | *"money goes into a pool up front → expenses draw it down → reconcile surplus or deficit"* |
| Who funded an expense | an individual's own pocket | the pool |
| Does an expense create debt? | yes — that is the point | no — it reduces a balance |
| Are splits required? | yes | no (optional, only for consumption-weighted fairness) |
| What does "settlement" mean? | net out mutual debts | return surplus / recover deficit |
| Money moves | once, at the end | in at the start, out as refunds/reimbursements |

They are **not two applications**. They are two *funding dimensions* over one expense
ledger — `Event.fundingModel` and `Expense.fundingSource`. A single event can use both
(`hybrid`), and the final settlement plan covers both streams at once.

An event with no `fundingModel` field is peer-to-peer. Every existing event is therefore
unaffected by pooling, by construction.

## Personas

| Persona | What they need | Where the product serves them |
|---|---|---|
| **Trip organiser** | Collect a kitty, pay for the villa and the van, refund the leftovers fairly | Kitty preset; pro-rata refunds |
| **Flatmate / household treasurer** | Monthly contributions, pay rent and bills from the fund, carry the balance over, chase who hasn't paid | Fund preset; recurring cycles; arrears list |
| **Event sponsor** (e.g. paying for a wedding) | Set a budget, authorise other people to spend from it, reimburse them against receipts, see the budget burn down | Budget preset; authorised spenders with caps; mandatory receipts; approval queue |
| **Club / team treasurer** | Tiered dues, perpetual treasury, published ledger, constant membership churn | Treasury preset; carry-forward surplus; cycle history export |
| **Group buyer** ("I'm booking the villa, send me ₹8,000") | Know when it is safe to commit | Collection preset; target-funding gate blocks spending until funded |
| **Ordinary participant** | Add an expense, see what I owe, pay it, be done | Dashboard, expense form, settlement cards |
| **Event admin** | Invite people, make groups, generate the settlement, close the event | Admin-only actions across the event |

## Product surfaces

| Surface | Stack | What it covers |
|---|---|---|
| **Web app** | Next.js 16, React 19, styled-components | Auth, dashboard, event management, expenses, pool tab, invitations, closed events, unsettled payments, profile, Pro upgrade, guided tour, help |
| **Mobile app** | React Native 0.81 / Expo SDK 54 (iOS + Android) | The same, plus local security (PIN/biometric unlock), camera receipt capture, in-app purchase, a hidden 7-tap developer menu with environment switching |
| **API** | Express 4 + Firebase Admin + Socket.IO | All business logic, auth, settlement generation, pool ledger, email, uploads, runtime config, RevenueCat webhook |
| **Doctor tool** | Local web tool (`tools/doctor-tool`) | Guided setup and environment validation for new machines and releases |

The clients hold **no business logic of consequence**. The API is authoritative for
balances, settlement plans and the entire pool ledger; the shared library
(`@traxettle/shared`) holds the pure maths so clients can render the same numbers without
re-deriving them.

## How money actually moves

Traxettle deliberately **does not move money by default**.

- **Event settlement** is manual: participants pay each other outside the app by any means
  (UPI, bank transfer, cash), then mark it paid in Traxettle, and the payee confirms
  receipt. Users' profiles carry payment-method details (UPI handle, bank details, PayPal,
  Wise, SWIFT) so a payer knows *how* to pay the right person.
- **Gateway settlement** (Razorpay, BillDesk) exists in code for a pilot but is hidden
  behind the `SETTLEMENT_GATEWAY_PILOT_ENABLED` flag and is off in production.
- **Subscription purchase** is entirely separate: Google Play Billing on Android and
  Apple IAP on iOS, brokered by RevenueCat. Do not conflate the two — see
  [`05-plans-entitlements-billing.md`](05-plans-entitlements-billing.md).

## What Traxettle is explicitly not

- Not a payment processor or wallet. It holds no funds.
- Not an accounting system. There is no chart of accounts, no tax handling, no categories.
- Not offline-capable. Every surface needs the API.
- Not a notification platform. Email on invitations and history; no push, no SMS.

See [`02-capability-matrix.md`](02-capability-matrix.md) for the exhaustive supported /
not-supported list.

## Current state

Development is organised in phases; **Phase 6 (money pooling) is complete** on the
`feature/money-pooling` branch, which is what this knowledgebase documents.

| Phase | Scope | State |
|---|---|---|
| 1 | Monorepo, auth, users, API skeleton, app scaffolding | complete |
| 2 | Event CRUD, expenses with splits, groups, invitations, web UI, unit + E2E tests | complete |
| 3 | Settlement algorithm, groups-as-entities, group reuse, private expenses, WebSocket, email | complete |
| 3.5 | Expense editing, admin permissions, split validation, lifecycle locks, dashboard filtering | complete |
| 4 | Settlement flow: payment mode, pay/approve, real-time status, auto-settle | complete |
| 4.5 | UX polish: confirmation modals, consistent badges, real-time dashboard | complete |
| 5 | "On behalf of" expenses, multi-currency FX, full mobile app, Free/Pro tiers | complete |
| 6 | **Money pooling** (kitty, fund, treasury, collection, sponsor budget, hybrid), receipts on all expenses, expense-access hardening, CI running all suites | complete |

---

**Sources:** `README.md` (repo root) · `traxettle-app/docs/app/Functional.md` ·
`traxettle-app/docs/utility/MONEY_POOLING_DESIGN.md` ·
`traxettle-rush/libraries/shared/src/pool.ts` · `traxettle-rush/rush.json` ·
`traxettle-rush/apps/mobile/app.json`
