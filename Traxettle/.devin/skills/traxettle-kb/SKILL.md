---
name: traxettle-kb
description: >-
  Answer any question about the Traxettle app — functional, product, architectural,
  data-model, API, build, deploy, test or troubleshooting — from the Traxettle
  knowledgebase, reading source code only when the KB genuinely does not cover it. Use
  this whenever a request concerns Traxettle, shared-expense events, expenses, splits,
  settlements, money pooling, pool cycles, contributions, custodians, overdrafts, the
  Traxettle web/mobile/API apps, or running/building/deploying Traxettle.
---

# Traxettle Knowledgebase

You have a complete, curated knowledgebase for the **Traxettle** shared-expense
coordination app. **Use it before reading source code.** It exists so that routine
questions cost one or two file reads instead of a codebase walkthrough.

```
KB_ROOT = /Users/vkarkhanis/workspace/Knowledgebase/Traxettle
REPO    = /Users/vkarkhanis/workspace/Traxettle
CODE    = /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
```

---

## How to answer a question

### Step 1 — Always start with the index

Read `$KB_ROOT/INDEX.md`. It maps questions to documents. Do not guess at filenames.

### Step 2 — Read the one or two documents it points at

| Topic | Document |
|---|---|
| What the app is, personas, surfaces | `01-product/00-overview.md` |
| Precise meaning of a domain term | `01-product/01-glossary.md` |
| "Is X supported?" | `01-product/02-capability-matrix.md` |
| Workflows, state machines, who-can-do-what | `01-product/03-user-journeys.md` |
| Money pooling, functionally | `01-product/04-money-pooling-functional.md` |
| Free vs Pro, entitlements, billing | `01-product/05-plans-entitlements-billing.md` |
| Components, request flow, runtime config | `02-architecture/00-system-architecture.md` |
| Firestore collections, every type, invariants | `02-architecture/01-data-model.md` |
| Endpoints, bodies, error codes | `02-architecture/02-api-reference.md` |
| Pool maths: allocation, overdraft, reconciliation | `02-architecture/03-money-pooling-engine.md` |
| "Which file renders/does X?" (web) | `02-architecture/04-web-codemap.md` |
| "Which file renders/does X?" (mobile) | `02-architecture/05-mobile-codemap.md` |
| Shared libraries and their exports | `02-architecture/06-shared-libraries.md` |
| Tokens, mock auth, access control, rules | `02-architecture/07-auth-and-security.md` |
| WebSocket rooms and events | `02-architecture/08-realtime.md` |
| Environments, URLs, env vars | `03-operations/00-environments.md` |
| Running locally | `03-operations/01-local-development.md` |
| Running web/iOS/Android against staging | `03-operations/02-staging-verification-guide.md` |
| Manual test scenarios | `03-operations/03-staging-test-scenarios.md` |
| Builds, signing, versioning | `03-operations/04-build-and-release.md` |
| Cloud Run deploys | `03-operations/05-deployment.md` |
| Test suites and how to run them | `03-operations/06-testing-and-qa.md` |
| Symptom → fix | `03-operations/07-troubleshooting.md` |
| Code style and patterns | `04-engineering/00-conventions.md` |
| "I need to add/change X" | `04-engineering/01-change-playbooks.md` |
| Known defects, inconsistencies, trade-offs | `04-engineering/02-known-issues-and-debt.md` |

### Step 3 — Go to source only when needed

The KB cites file paths for every technical claim. Read source when:

- you need **exact current code** to modify it
- you need a detail finer than the KB records (a specific line, an exact string)
- the KB's claim looks wrong or the staleness check flags the area

When you do, **start from the path the KB cites** rather than searching blind.

### Step 4 — Report gaps

If the KB did not answer the question, say so explicitly in your response and name the
document that *should* have covered it. Then offer to update it via the
`traxettle-kb-refresh` skill.

---

## Non-negotiable facts

Get these wrong and your answer is wrong.

1. **Two funding models, one ledger.** `Event.fundingModel` is `peer_to_peer` (absent ⇒
   this), `pool`, or `hybrid`. `Expense.fundingSource` is `self` (absent ⇒ this), `pool`, or
   `pool_reimbursement`. **Absent always means today's behaviour. Nothing is ever
   backfilled.**
2. **Pool amounts are integer minor units**, always suffixed `Minor`. Core
   `Expense.amount` / `Settlement.amount` remain float major units.
3. **`Balance.amount` and `PoolEntityShare.netMinor`: positive = owed, negative = owes.**
   Identical semantics, which is why pool reconciliation feeds the existing settlement
   engine.
4. **Only *confirmed* contributions move the pool balance; only *approved* draws deduct.**
5. **The pool balance is derived on every read, never stored.**
6. **Fair shares are weighted by agreed commitment, not by what was paid** — so a non-payer
   still owes their share.
7. **Pre-authorised draws are refused past the overdraft floor; already-incurred money is
   always recorded and flagged.** The pause is **latched** until the balance rises above the
   clearance threshold.
8. **The API is authoritative.** Never re-derive a balance, headroom, caption or validation
   rule in a client — import it from `@traxettle/shared`.
9. **Pool side legs** (`pool_reimbursement`, `pool_cycle`, `pool_member_exit`) are paid while
   the event stays `active`. Only `standard` legs drive the lifecycle.
10. **`mock-<uid>` tokens work only when `APP_ENV=local` / `NODE_ENV=test|development` /
    `ALLOW_MOCK_AUTH=true`.**
11. **Web and mobile consume `@traxettle/shared` from its built `dist/`** — it must be
    rebuilt after any change to it.
12. **The deployed staging API does not have money pooling** (as of the pinned commit);
    `/api/pools/*` returns 404 there.
13. **Store billing (RevenueCat/Play/Apple) ≠ event settlement (manual, gateway pilot off).**
    Never conflate them.

---

## When asked to write code

1. Read `04-engineering/01-change-playbooks.md` and find the matching playbook. It lists the
   files to touch, in order.
2. Read `04-engineering/00-conventions.md` and match the existing patterns —
   `apps/api/src/routes/pools.ts` is the reference route file and
   `libraries/shared/src/pool-math.ts` the reference pure module.
3. Read `04-engineering/02-known-issues-and-debt.md` so you neither re-break a known
   trade-off nor get blamed for a pre-existing failure.
4. Follow the verification commands at the top of the playbooks doc.

## When asked to run or test the app

1. `03-operations/00-environments.md` to pick the environment.
2. `03-operations/01-local-development.md` for local, or
   `03-operations/02-staging-verification-guide.md` for staging on web/iOS/Android.
3. `03-operations/03-staging-test-scenarios.md` for what to actually exercise.
4. `03-operations/07-troubleshooting.md` the moment anything fails.

## When asked for functional / product output

Specs, user stories, BRDs, feature summaries and release notes should be built from
`01-product/` alone — those documents are written to stand without code. Use
`02-capability-matrix.md` to state scope boundaries honestly (what is ❌, not just ✅).

---

## Rules

- **Cite your source.** Point at the KB document, and at the code path the KB cites, so the
  reader can verify.
- **Never invent an endpoint, field, env var, script or command.** If it is not in the KB,
  check the code; if it is in neither, say it does not exist.
- **Prefer correction over agreement.** If the user's premise contradicts the KB (or the
  KB contradicts the code), say so plainly and show the evidence.
- **Distinguish supported from planned.** The capability matrix marks ❌ items explicitly.
- **Flag the staging/pooling trap** whenever someone plans to test pooling against the
  deployed staging API.
