---
name: traxettle-kb-refresh
description: >-
  Check whether the Traxettle knowledgebase has gone stale against the Traxettle codebase,
  and update the affected documents. Use this when asked to refresh/update/verify/audit the
  Traxettle knowledgebase or its docs, when the KB looks out of date or contradicts the
  code, or after any non-trivial change to the Traxettle repo.
---

# Traxettle Knowledgebase — Staleness Check & Refresh

```
KB_ROOT  = /Users/vkarkhanis/workspace/Knowledgebase/Traxettle
REPO     = /Users/vkarkhanis/workspace/Traxettle
MANIFEST = $KB_ROOT/MANIFEST.json
SCRIPT   = $KB_ROOT/.devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs
```

Each KB document declares, in `MANIFEST.json`, the source files it describes. The script
fingerprints those files (sha256 of content, so uncommitted edits count) and compares the
result with the pinned digest. **A changed digest means the document may no longer describe
reality.** It is a prompt to review, not proof of error.

---

## Commands

```bash
node $SCRIPT                      # report; exit 0 = fresh, 1 = stale, 2 = config error
node $SCRIPT --verbose            # list every changed file, not just the first six
node $SCRIPT --json               # machine-readable
node $SCRIPT --doc 02-api-reference.md   # one document (suffix match is fine)
node $SCRIPT --init               # pin digests for documents that have none
node $SCRIPT --update             # RE-PIN. Only after the docs are actually updated.
```

> **Never run `--update` before updating the documents.** It would silently bless stale
> content, and the next check would report everything fresh.

---

## Workflow

### 1. Check

```bash
cd /Users/vkarkhanis/workspace/Knowledgebase/Traxettle
node .devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs --verbose
```

The report gives the pinned vs current branch/commit, whether the working tree is dirty, and
the stale documents ordered by criticality (`critical` → `high` → `normal` → `low`), each with
the files that were added (`+`), removed (`-`) or modified (`~`).

If it is already fresh, say so and stop. Do not make busywork edits.

### 2. Triage

Work **critical first**. For each stale document:

1. Read the changed source files (the report names them).
2. Read the KB document.
3. Decide: does the change actually alter what the document claims?
   - **Yes** → update the document.
   - **No** (a comment, a rename, a test-only change) → no edit needed, but it still has to be
     re-pinned so the signal stays meaningful.

### 3. Update

Preserve the KB's conventions:

| Rule | |
|---|---|
| Cite paths | Every technical claim names the file (and line range where it matters). Paths are relative to `traxettle-rush/` unless stated |
| Keep the `**Sources:**` footer accurate | It is at the bottom of every document |
| `01-product/` must stand alone | A product person should never need to open code |
| Verify, don't assume | Read the code; run a probe. Don't infer behaviour from the old doc |
| Record defects honestly | Real problems go in `04-engineering/02-known-issues-and-debt.md` with a severity, a verified location and a fix — not smoothed over |
| Update `INDEX.md` | If you add a section someone would search for, make it findable |
| Add sources to the manifest | A new document, or a document that now describes new files, needs its `sources` list extended |

### 4. Specific triggers worth watching for

| If this changed | Then also update |
|---|---|
| `libraries/shared/src/index.ts` exports | `02-architecture/01-data-model.md`, `06-shared-libraries.md`, `01-product/01-glossary.md` |
| `libraries/shared/src/pool*.ts` | `02-architecture/03-money-pooling-engine.md` **and** `01-product/04-money-pooling-functional.md` — functional and technical views must agree |
| A new/changed route in `apps/api/src/routes/` | `02-architecture/02-api-reference.md`, and `01-product/02-capability-matrix.md` if it is a new capability |
| `apps/api/src/config/websocket.ts` (`WsEventType`) | `02-architecture/08-realtime.md` |
| `pool.schemas.ts` | `02-api-reference.md` (bodies/limits) and `02-architecture/01-data-model.md` |
| A refusal `code` or its copy in `pool-ui.ts` | `02-api-reference.md` §Error codes, `01-product/04-money-pooling-functional.md` §11, `03-operations/03-staging-test-scenarios.md` |
| `scripts/local-dev/*` | `03-operations/01-local-development.md`, `02-staging-verification-guide.md` |
| `apps/mobile/scripts/build-*.sh`, `eas.json`, `app.json` | `03-operations/04-build-and-release.md`, `04-engineering/02-known-issues-and-debt.md` (P1–P5) |
| `scripts/api-deployment/*` | `03-operations/05-deployment.md` |
| Any `*.test.ts` added/removed | `03-operations/06-testing-and-qa.md` |
| A new file in `apps/web/src/` or `apps/mobile/src/` | the matching code map |
| A new env var | `03-operations/00-environments.md` §5 |
| An `.env.example` change | `03-operations/00-environments.md` |

### 5. Re-verify the live facts

Digests only cover files. Some KB claims are about **deployed state** and must be re-probed.
`MANIFEST.json` → `liveProbes` lists them:

```bash
BASE=https://traxettle-api-staging-943648574702.us-central1.run.app
curl -s -o /dev/null -w 'health: %{http_code}\n' $BASE/health
curl -s $BASE/api/config | python3 -m json.tool
curl -s -o /dev/null -w 'pools:  %{http_code}\n' $BASE/api/pools/event/x/summary
curl -s https://traxettle-api-prod-ncwutlgtga-uc.a.run.app/api/config | python3 -m json.tool
```

**The one that matters most:** `pools` returns **404** as of the pinned commit, meaning money
pooling is **not** deployed to staging. If it returns **401**, pooling has been deployed and
you must update:

- `INDEX.md` (the warning at the bottom)
- `03-operations/00-environments.md` § "The deployed staging API does not have money pooling"
- `03-operations/02-staging-verification-guide.md` §0 (the Path A vs Path B recommendation)
- `04-engineering/02-known-issues-and-debt.md` entry **C7**

### 6. Re-verify the known-issues list

`04-engineering/02-known-issues-and-debt.md` claims specific defects at specific locations.
When re-pinning, spot-check the 🔴 entries — a fixed issue that still appears in the KB is
worse than no KB. The quickest checks:

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
# S1 — IDOR: does GET /api/events/:eventId gate access yet?
sed -n '142,155p' apps/api/src/routes/events.ts | grep -c requireEventAccess   # 0 = still vulnerable

# S2 — socket room auth
grep -n "join-event" apps/api/src/config/websocket.ts

# S3 — silent in-memory fallback
grep -n "using mock services" apps/api/src/config/firebase.ts

# P1/P2 — production build profile still using staging
grep -n 'FIREBASE_ENV="staging"' apps/mobile/scripts/build-*.sh

# C1 — the two failing mobile tests
(cd apps/mobile && npm test 2>&1 | tail -20)
```

### 7. Re-pin

```bash
node .devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs --update
node .devin/skills/traxettle-kb-refresh/scripts/check-staleness.mjs        # expect: all up to date
```

This rewrites each entry's `digest`, `fileHashes` and `pinnedAt`, and refreshes
`repo.pinnedCommit` / `pinnedBranch` / `pinnedCommittedAt` and `lastVerifiedAt`.

Re-pin **one document at a time** (`--update --doc <name>`) if you are working incrementally
— that keeps the remaining stale signals intact.

### 8. Report

Tell the user:

- which documents were stale and why (the source change)
- which you actually edited, and what changed materially
- which were re-pinned with no edit needed, and why
- anything you found that contradicted the KB — especially a known issue that is now fixed,
  or a new one
- the new pinned commit

---

## Adding a document to the knowledgebase

1. Write it in the right numbered directory, following the existing structure and the
   `**Sources:**` footer convention.
2. Add an entry to `MANIFEST.json` → `documents`:

   ```jsonc
   "02-architecture/09-my-new-doc.md": {
     "criticality": "high",          // critical | high | normal | low
     "note": "One line on why staleness here matters.",
     "sources": [
       "traxettle-rush/apps/api/src/services/thing.service.ts",
       "traxettle-rush/apps/api/src/routes/things.ts"
     ]
   }
   ```

   `sources` entries may be a file, a **directory** (walked recursively, with
   `node_modules`/`dist`/`.next`/`coverage`/`artifacts` and friends skipped), or a **glob**
   (`**`, `*`, `?`, `{a,b}`). Paths are relative to the **repo root**
   (`/Users/vkarkhanis/workspace/Traxettle`), so monorepo files start with `traxettle-rush/`.
3. Add it to `INDEX.md` so it is discoverable.
4. `node $SCRIPT --init` to pin it.

### Choosing `criticality`

| Level | Use when |
|---|---|
| `critical` | A behavioural contract someone will act on: API reference, data model, pool engine, capability matrix, environments, test scenarios, known issues |
| `high` | Detailed reference that drifts easily: code maps, glossary, realtime, auth, build/release, playbooks |
| `normal` | Conventions, troubleshooting |
| `low` | Narrative that source churn rarely invalidates: overview, README |

---

## Health check

If the script reports configuration problems:

| Report | Meaning | Fix |
|---|---|---|
| `error MANIFEST.json not found` | Wrong working directory or a moved KB | Run with the absolute `$SCRIPT` path |
| `error repo root does not exist` | The repo moved | Fix `repo.rootRelativeToKb` in `MANIFEST.json` |
| **Missing knowledgebase documents** | A manifest entry points at a file that is gone | Restore the document, or remove the entry |
| **Source patterns matching nothing** | A source file or directory was renamed/deleted | Update that entry's `sources` — and check whether the document itself is now wrong |
| **Not yet pinned** | A new entry has no digest | `--init` |

---

## Suggested cadence

| When | Do |
|---|---|
| Before relying on the KB for anything consequential | `node $SCRIPT` |
| After pulling the Traxettle repo | `node $SCRIPT` |
| After your own non-trivial change | full workflow, then `--update` |
| Before a release | full workflow **plus** the live probes **plus** the known-issues spot-checks |
| When the KB and the code disagree | trust the code, fix the KB, and note the discrepancy in your report |
