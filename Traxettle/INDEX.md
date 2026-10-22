# Traxettle Knowledgebase — Index

**Find the document that answers your question.** Scan the left column, open the right.

---

## 1. Functional / product questions

| I want to know… | Document |
|---|---|
| What is Traxettle? Who is it for? What problem does it solve? | [`01-product/00-overview.md`](01-product/00-overview.md) |
| What do "event", "entity", "custodian", "draw", "cycle", "leg" mean? | [`01-product/01-glossary.md`](01-product/01-glossary.md) |
| Is feature X supported? Is it planned? | [`01-product/02-capability-matrix.md`](01-product/02-capability-matrix.md) |
| How does a user go from creating an event to being settled up? | [`01-product/03-user-journeys.md`](01-product/03-user-journeys.md) § Core journey |
| What are the event statuses and what is allowed in each? | [`01-product/03-user-journeys.md`](01-product/03-user-journeys.md) § Event lifecycle |
| How do invitations work? Expiry? Roles? | [`01-product/03-user-journeys.md`](01-product/03-user-journeys.md) § Invitations |
| How does settlement work? Who marks paid, who confirms? | [`01-product/03-user-journeys.md`](01-product/03-user-journeys.md) § Settlement |
| What is money pooling and what can I do with it? | [`01-product/04-money-pooling-functional.md`](01-product/04-money-pooling-functional.md) |
| What is a Kitty vs Fund vs Treasury vs Budget vs Collection? | [`01-product/04-money-pooling-functional.md`](01-product/04-money-pooling-functional.md) § The five presets |
| What happens if the pool runs out of money? | [`01-product/04-money-pooling-functional.md`](01-product/04-money-pooling-functional.md) § Graduated overdraft |
| Who gets refunded how much when a kitty closes? | [`01-product/04-money-pooling-functional.md`](01-product/04-money-pooling-functional.md) § Fair shares |
| What is free vs Pro? What does Pro unlock? | [`01-product/05-plans-entitlements-billing.md`](01-product/05-plans-entitlements-billing.md) |
| How are subscriptions bought and validated? | [`01-product/05-plans-entitlements-billing.md`](01-product/05-plans-entitlements-billing.md) § RevenueCat |
| I need to write a functional spec / BRD / user story for Traxettle | Start with [`01-product/03-user-journeys.md`](01-product/03-user-journeys.md), then [`02-capability-matrix.md`](01-product/02-capability-matrix.md) for scope boundaries |

---

## 2. Architecture / code questions

| I want to know… | Document |
|---|---|
| What are the components and how do they talk? | [`02-architecture/00-system-architecture.md`](02-architecture/00-system-architecture.md) |
| How does a client discover its API URL and Firebase project? | [`02-architecture/00-system-architecture.md`](02-architecture/00-system-architecture.md) § Runtime configuration |
| What Firestore collections exist? What is in each document? | [`02-architecture/01-data-model.md`](02-architecture/01-data-model.md) |
| What is the shape of `Event` / `Expense` / `Settlement` / `PoolCycle`? | [`02-architecture/01-data-model.md`](02-architecture/01-data-model.md) |
| What invariants must the ledger satisfy? | [`02-architecture/01-data-model.md`](02-architecture/01-data-model.md) § Invariants |
| What endpoints exist? What does `POST /api/expenses` accept? | [`02-architecture/02-api-reference.md`](02-architecture/02-api-reference.md) |
| What error codes can the API return? | [`02-architecture/02-api-reference.md`](02-architecture/02-api-reference.md) § Error codes |
| How is the overdraft limit computed? What latches it? | [`02-architecture/03-money-pooling-engine.md`](02-architecture/03-money-pooling-engine.md) § Overdraft |
| How does reconciliation produce settlement legs? | [`02-architecture/03-money-pooling-engine.md`](02-architecture/03-money-pooling-engine.md) § Reconciliation |
| Why integer minor units? How is rounding handled? | [`02-architecture/03-money-pooling-engine.md`](02-architecture/03-money-pooling-engine.md) § Money & allocation |
| Which file renders the web event page / pool tab / expense form? | [`02-architecture/04-web-codemap.md`](02-architecture/04-web-codemap.md) |
| Which file is the mobile pool screen / expense screen? | [`02-architecture/05-mobile-codemap.md`](02-architecture/05-mobile-codemap.md) |
| Where do shared types live? How do I add one? | [`02-architecture/06-shared-libraries.md`](02-architecture/06-shared-libraries.md) |
| How does auth work? What is a `mock-` token? | [`02-architecture/07-auth-and-security.md`](02-architecture/07-auth-and-security.md) |
| Who can read an event? Who can approve a pool draw? | [`02-architecture/07-auth-and-security.md`](02-architecture/07-auth-and-security.md) § Access control |
| What WebSocket events are emitted and when? | [`02-architecture/08-realtime.md`](02-architecture/08-realtime.md) |

---

## 3. Running, building, testing, shipping

| I want to… | Document |
|---|---|
| Understand the environments (local / test / staging / prod) | [`03-operations/00-environments.md`](03-operations/00-environments.md) |
| Know the staging API URL / Firebase project / web URL | [`03-operations/00-environments.md`](03-operations/00-environments.md) § Environment matrix |
| Know every environment variable and where it is consumed | [`03-operations/00-environments.md`](03-operations/00-environments.md) § Variable reference |
| Run the app locally (any of the run modes) | [`03-operations/01-local-development.md`](03-operations/01-local-development.md) |
| Run the stack with no Firebase at all, fastest possible | [`03-operations/01-local-development.md`](03-operations/01-local-development.md) § Mode 0 |
| **Build & run web + iOS simulator + Android emulator against STAGING** | ⭐ [`03-operations/02-staging-verification-guide.md`](03-operations/02-staging-verification-guide.md) |
| Run the mobile app on a simulator against the **deployed** staging API | [`03-operations/02-staging-verification-guide.md`](03-operations/02-staging-verification-guide.md) §6.0 — `06_staging_mobile.sh` |
| Upload a TestFlight build | [`03-operations/04-build-and-release.md`](03-operations/04-build-and-release.md) § iOS |
| Bump the app version | [`03-operations/04-build-and-release.md`](03-operations/04-build-and-release.md) § Versioning |
| **Step-by-step manual test scenarios to verify functionality** | ⭐ [`03-operations/03-staging-test-scenarios.md`](03-operations/03-staging-test-scenarios.md) |
| Build a signed Android `.aab` / iOS `.ipa` | [`03-operations/04-build-and-release.md`](03-operations/04-build-and-release.md) |
| Know what to bump before a release | [`03-operations/04-build-and-release.md`](03-operations/04-build-and-release.md) § Version checklist |
| Deploy the API / web to Cloud Run | [`03-operations/05-deployment.md`](03-operations/05-deployment.md) |
| Deploy *this branch* to staging so pooling is live there | [`03-operations/05-deployment.md`](03-operations/05-deployment.md) § Deploying a feature branch to staging |
| Run unit / E2E / Maestro tests | [`03-operations/06-testing-and-qa.md`](03-operations/06-testing-and-qa.md) |
| Fix "Google Sign-In Error 10", "401 on emulator", "Rush already running"… | [`03-operations/07-troubleshooting.md`](03-operations/07-troubleshooting.md) |

---

## 4. Contributing / making changes

| I want to… | Document |
|---|---|
| Match the existing code style and patterns | [`04-engineering/00-conventions.md`](04-engineering/00-conventions.md) |
| Add a field to an entity | [`04-engineering/01-change-playbooks.md`](04-engineering/01-change-playbooks.md) § Add a field |
| Add an API endpoint | [`04-engineering/01-change-playbooks.md`](04-engineering/01-change-playbooks.md) § Add an endpoint |
| Add a pool policy or preset | [`04-engineering/01-change-playbooks.md`](04-engineering/01-change-playbooks.md) § Add a pool preset |
| Add a screen / page | [`04-engineering/01-change-playbooks.md`](04-engineering/01-change-playbooks.md) § Add a surface |
| Know what is already broken before I blame myself | [`04-engineering/02-known-issues-and-debt.md`](04-engineering/02-known-issues-and-debt.md) |

---

## 5. Fast facts

| Fact | Value |
|---|---|
| API base (local) | `http://localhost:3001` |
| API base (staging) | `https://traxettle-api-staging-943648574702.us-central1.run.app` (alias: `…-staging-lomxjapdhq-uc.a.run.app`) |
| API base (production) | `https://traxettle-api-prod-ncwutlgtga-uc.a.run.app` |
| Web (local) | `http://localhost:3000` |
| Firebase projects | `traxettle-local` (emulated) · `traxettle-test` · `traxettle-staging` · `traxettle-prod` |
| Mobile bundle id / package | `com.traxettle.app` |
| Mobile version | `1.0.33` (`apps/mobile/app.json`) |
| Ports | web 3000 · API 3001 · API-emulator-mode 3002 · Metro 8081 · Firestore 8080 · Auth 9099 · Storage 9199 · Emulator UI 4000 |
| Health check | `GET /health` → `{"status":"OK"}` |
| Runtime config | `GET /api/config` → env, apiUrl, firebaseConfig, revenueCatConfig |

> **Money pooling is deployed to staging** (`/api/pools/*` → 401, verified). Re-probe with
> `curl -o /dev/null -w '%{http_code}' <base>/api/pools/event/x/summary` — 401 = present,
> 404 = absent.
>
> ⚠️ **"Several of us" pools are hidden in production builds**
> (`CONTRIBUTOR_POOLS_IN_PRODUCTION = false`). Production users can only create "Just me"
> budgets; the API supports every preset. Test contributor pools on a staging or local build.
