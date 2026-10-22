# Traxettle Knowledgebase

The single source of truth for **Traxettle** — a shared-expense coordination product for
trips, households, teams, clubs and events, with web, iOS and Android clients backed by a
single API.

This knowledgebase is written to serve **three audiences at once**:

| Audience | Start here |
|---|---|
| Product / business / functional analyst | [`01-product/`](01-product/00-overview.md) — what the app does, who for, every workflow, every supported & unsupported capability |
| Engineer or AI coding agent | [`02-architecture/`](02-architecture/00-system-architecture.md) — system shape, data model, full API reference, per-app code maps, and [`04-engineering/`](04-engineering/01-change-playbooks.md) change playbooks |
| Whoever has to run, build, test or ship it | [`03-operations/`](03-operations/00-environments.md) — environments, local dev, staging verification, test scenarios, builds, deployment, troubleshooting |

> **The one file to read first is [`INDEX.md`](INDEX.md)** — it maps every question you
> might have to the exact document (and section) that answers it.

---

## Scope snapshot

| | |
|---|---|
| Repository | `/Users/vkarkhanis/workspace/Traxettle` (GitHub: `vkarkhanis/splitex-app`) |
| Documented branch | `feature/money-pooling` |
| Documented commit | `a65f586` — *feat: money pooling* (2026-10-11) |
| Active monorepo | `traxettle-rush/` (Rush 5.167 + pnpm 9.15.9, Node ≥24.11.1 <25) |
| In-repo docs | `traxettle-app/docs/` — this KB supersedes and reorganises them, and cites them where they remain the deepest source |
| Packages | `@traxettle/api`, `@traxettle/web`, `@traxettle/mobile`, `@traxettle/shared`, `@traxettle/ui`, `@traxettle/doctor-tool`, `@traxettle/e2e` |

---

## How this knowledgebase is organised

```
Traxettle/
├── README.md                 ← you are here
├── INDEX.md                  ← question → document map. ALWAYS start here.
├── MANIFEST.json             ← machine-readable doc→source mapping, used for staleness checks
│
├── 01-product/               FUNCTIONAL / NON-TECHNICAL
│   ├── 00-overview.md              What Traxettle is, personas, value proposition, surfaces
│   ├── 01-glossary.md              Every domain term, precisely defined
│   ├── 02-capability-matrix.md     Supported / in-progress / not-supported, feature by feature
│   ├── 03-user-journeys.md         End-to-end workflows with state machines
│   ├── 04-money-pooling-functional.md  The pooling feature, functionally, use case by use case
│   └── 05-plans-entitlements-billing.md  Free vs Pro, entitlements, RevenueCat, store billing
│
├── 02-architecture/          TECHNICAL
│   ├── 00-system-architecture.md   Components, request flow, runtime config, boundaries
│   ├── 01-data-model.md            Firestore collections, every shared type, invariants
│   ├── 02-api-reference.md         All ~95 endpoints with auth, body, errors
│   ├── 03-money-pooling-engine.md  Pool maths: allocation, overdraft, reconciliation
│   ├── 04-web-codemap.md           Next.js app: routes → files → responsibilities
│   ├── 05-mobile-codemap.md        Expo app: screens → files → responsibilities
│   ├── 06-shared-libraries.md      @traxettle/shared and @traxettle/ui
│   ├── 07-auth-and-security.md     Token model, mock auth, access control, rules
│   └── 08-realtime.md              Socket.IO rooms and every event name
│
├── 03-operations/            RUN / BUILD / SHIP / TEST
│   ├── 00-environments.md          The four environments, projects, URLs, env vars
│   ├── 01-local-development.md     Six local run modes, prerequisites, secrets
│   ├── 02-staging-verification-guide.md  ⭐ Exact steps: web + iOS sim + Android emulator on staging
│   ├── 03-staging-test-scenarios.md      ⭐ Detailed, numbered manual test scenarios
│   ├── 04-build-and-release.md     Android/iOS build scripts, versioning, signing
│   ├── 05-deployment.md            Cloud Run API + web deploys, staging & prod
│   ├── 06-testing-and-qa.md        Jest, Playwright, Maestro: what exists and how to run it
│   └── 07-troubleshooting.md       Symptom → cause → fix
│
├── 04-engineering/           CONTRIBUTING
│   ├── 00-conventions.md           Code style, patterns, idioms actually used here
│   ├── 01-change-playbooks.md      "I need to add X" → the files to touch, in order
│   └── 02-known-issues-and-debt.md Real defects, inconsistencies and traps found in the code
│
└── .devin/skills/
    ├── traxettle-kb/              Skill: answer questions from this KB
    └── traxettle-kb-refresh/      Skill + script: detect staleness and refresh
```

---

## Using the knowledgebase in a session

### Ask it questions

Add this folder to your session and invoke the skill:

```
skill: traxettle-kb
```

The skill teaches an agent to resolve a question through `INDEX.md` → the right
document, and to only fall back to reading source code when the KB genuinely does
not cover it (and to then record the gap).

### Check whether it is stale

```bash
node /Users/vkarkhanis/workspace/Knowledgebase/Traxettle/.devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs
```

Exit code `0` = fresh, `1` = stale (with a per-document report of which source files
changed). Use the `traxettle-kb-refresh` skill to then actually update the affected
documents.

---

## Ground rules for this knowledgebase

1. **Every technical claim cites a file path** (and line range where it matters), so a
   reader can verify or go deeper. Paths are relative to `traxettle-rush/` unless stated.
2. **Functional docs stand alone.** A product person should never need to open code.
3. **Absent means default.** Pooling fields are all optional; an absent field always
   means today's peer-to-peer behaviour. The docs repeat this because the code depends on it.
4. **Corrections over politeness.** [`04-engineering/02-known-issues-and-debt.md`](04-engineering/02-known-issues-and-debt.md)
   records things that are actually wrong or inconsistent, including in the in-repo docs.
5. **Staleness is tracked, not hoped for.** `MANIFEST.json` pins each document to the
   source files it describes.
