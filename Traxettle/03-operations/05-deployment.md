# Deployment

| Component | Target |
|---|---|
| API | Google Cloud Run, `us-central1` — `traxettle-api-staging` / `traxettle-api-prod` |
| Web | Cloud Run (`traxettle-web-*`) and/or Firebase Hosting |
| Data | Firebase per environment (`traxettle-staging`, `traxettle-prod`) |
| Mobile | Play Console / App Store Connect — see [`04-build-and-release.md`](04-build-and-release.md) |

Everything here needs `gcloud` authenticated and the right project selected.

```bash
gcloud auth login
gcloud config set project traxettle-staging    # or traxettle-prod
```

---

## 1. The deployment scripts

`scripts/api-deployment/` and `scripts/web-deployment/` wrap the whole thing so a deploy is
one command.

| Script | Purpose |
|---|---|
| `api-deployment/configure-staging.sh` | Interactive one-time (or when-secrets-change) configurator. Writes `.traxettle/api-staging.env` |
| `api-deployment/configure-prod.sh` | Same for production → `.traxettle/api-prod.env` |
| `api-deployment/deploy-staging.sh` | Deploy the API to `traxettle-api-staging` |
| `api-deployment/deploy-prod.sh` | Deploy the API to `traxettle-api-prod` |
| `api-deployment/deploy-staging-gmail.sh` / `deploy-prod-gmail.sh` | Thin wrappers that pre-set the Gmail SMTP path |
| `api-deployment/verify-deployed-api-env.sh` | Compares a deployed service's environment against expectations |
| `api-deployment/SECRET_CLEANUP.md` | How to rotate and remove secrets |
| `web-deployment/configure-prod.sh` | Production web configurator |
| `web-deployment/deploy-web-staging.sh` | Deploy the web app to staging |
| `web-deployment/deploy-web-prod.sh` | Deploy the web app to production |

Captured configuration lives in gitignored `.traxettle/{api-staging,api-prod,web-prod}.env`
and is sourced by the deploy scripts, so credentials are never passed on the command line.

SMTP credentials for deploys: `api-deployment/smtp_{staging,prod}.local.properties`
(template: `smtp_local.properties.example`).

### What `deploy-staging.sh` configures

| | Default |
|---|---|
| `GCP_PROJECT_ID` | `traxettle-staging` |
| `REGION` | `us-central1` |
| `SERVICE_NAME` | `traxettle-api-staging` |
| `RUNTIME_SA_NAME` | `traxettle-api-staging-runtime` |
| `NODE_ENV_VALUE` | `staging` |
| `MIN_INSTANCES` | `0` |
| `FIREBASE_PROJECT_ID` | `traxettle-staging` |
| `FIREBASE_STORAGE_BUCKET` | `traxettle-staging.firebasestorage.app` |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY_FILE` | **must be supplied** (placeholders otherwise) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | **must be supplied** |
| Optional | `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_MEASUREMENT_ID`, `AUTH_EMAIL_LINK_CONTINUE_URL`, `AUTH_ANDROID_PACKAGE_NAME`, `AUTH_IOS_BUNDLE_ID`, `APP_URL`, `DOMAIN_NAME` |
| SMTP | `SMTP_SERVICE=gmail` + `SMTP_USER` + `SMTP_PASS` (as a **secret**, not a plain env var) + `SMTP_FROM` |
| RevenueCat | loaded from `rc_<env>.properties` via `load-rc-config.sh` |

Secrets are **unified into two Secret Manager entries** rather than sixteen, explicitly to
cut Secret Manager cost. Read the script before changing that.

`FIREBASE_WEB_API_KEY` is only strictly required for **email-link passwordless sign-in**,
but it is also what `/api/config` hands to clients — set it.

---

## 2. Deploying a feature branch to staging

This is how you make money pooling live on the hosted staging API.

> ⚠️ Staging is a **shared environment**. Get sign-off before replacing what is running.

```bash
cd /Users/vkarkhanis/workspace/Traxettle/traxettle-rush
git checkout feature/money-pooling
git status --short                       # must be clean

gcloud auth login
gcloud config set project traxettle-staging

# One-time, or when secrets change
bash scripts/api-deployment/configure-staging.sh

# Deploy (builds from the current working tree)
bash scripts/api-deployment/deploy-staging.sh
```

### Verify

```bash
BASE=https://traxettle-api-staging-943648574702.us-central1.run.app

curl -s $BASE/health
# {"status":"OK",...}

curl -s $BASE/api/config | python3 -m json.tool
# env: "staging", firebaseConfig.projectId: "traxettle-staging"

# Pooling present?
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/pools/event/x/summary
# 401 ⇒ deployed   ·   404 ⇒ not deployed

# Mock auth MUST be refused here
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/users/profile -H 'Authorization: Bearer mock-alice'
# 401 ⇒ correct

bash scripts/api-deployment/verify-deployed-api-env.sh
```

### Web, if the staging web app needs the matching build

```bash
bash scripts/web-deployment/deploy-web-staging.sh
```

### Rollback

```bash
gcloud run revisions list --service traxettle-api-staging --region us-central1
gcloud run services update-traffic traxettle-api-staging \
  --region us-central1 --to-revisions <PREVIOUS_REVISION>=100
```

---

## 3. Production

Same shape, different project and service, and **more caution**.

```bash
gcloud config set project traxettle-prod
bash scripts/api-deployment/configure-prod.sh
bash scripts/api-deployment/deploy-prod.sh
bash scripts/web-deployment/deploy-web-prod.sh
```

### Production invariants to re-check after every deploy

| | Check | Why |
|---|---|---|
| ☐ | `APP_ENV=production` | disables mock auth and the internal tier switch |
| ☐ | `ALLOW_MOCK_AUTH` **unset** | otherwise every account is impersonable |
| ☐ | `INTERNAL_TIER_SWITCH_ENABLED` unset or `false` | the route refuses in prod anyway, but defence in depth |
| ☐ | `JWT_SECRET` and `JWT_REFRESH_SECRET` set | the API throws without them rather than using a dev default |
| ☐ | Firebase credentials valid | ⚠️ otherwise the API **silently** falls back to an in-memory store and loses every write |
| ☐ | `SETTLEMENT_GATEWAY_PILOT_ENABLED` off | keeps Razorpay/BillDesk hidden |
| ☐ | `PAYMENT_ALLOW_REAL_IN_NON_PROD` irrelevant/false | |
| ☐ | `RAZORPAY_LIVE_APPROVED` / `BILLDESK_LIVE_APPROVED` false | |
| ☐ | `REVENUECAT_WEBHOOK_SECRET` set and the webhook URL registered in RevenueCat | otherwise no tier ever upgrades |
| ☐ | `REVENUECAT_PRO_ENTITLEMENT_ID` matches the RevenueCat entitlement | staging uses `traxettle-pro`, so do not assume `pro` |
| ☐ | SMTP configured | ⚠️ no `SMTP_HOST` ⇒ mock mode, invitation emails silently go to the console |
| ☐ | `APP_URL` / `AUTH_EMAIL_LINK_CONTINUE_URL` point at production and are authorised domains in Firebase Auth | |

The silent-Firebase-fallback hazard is the one to be most careful about — verify with a real
write after any credential change:

```bash
curl -s $BASE/api/config | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['firebaseConfig']['projectId'])"
# then create something through the UI and confirm it survives a service restart
```

---

## 4. Firebase rules & indexes

```bash
cd traxettle-rush
firebase use traxettle-staging      # or traxettle-prod
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only firestore:indexes
```

`firebase.json` points at `firestore.rules`, `firestore.indexes.json` (currently `{}`) and
`storage.rules`. Per-environment variants are kept in
`scripts/firebase/rules-{staging,test,improved}.txt`.

Both rule sets are **deny-all for clients** by design — see
[`../02-architecture/07-auth-and-security.md`](../02-architecture/07-auth-and-security.md) §5.

---

## 5. Containers

| File | Builds |
|---|---|
| `Dockerfile` | the API |
| `Dockerfile.web` | the web app |
| `.dockerignore` | shared exclusions |

Cloud Run deploys use `--source`, so these are mainly for local container testing and any
non-Cloud-Run host.

---

## 6. Manual `gcloud` equivalent

If you need to bypass the scripts (reference only — prefer the scripts, which handle Secret
Manager):

```bash
gcloud run deploy traxettle-api-staging \
  --source apps/api \
  --region us-central1 \
  --set-env-vars="APP_ENV=staging,PORT=3001,FIREBASE_USE_EMULATOR=false" \
  --set-env-vars="FIREBASE_PROJECT_ID=traxettle-staging" \
  --set-env-vars="FIREBASE_STORAGE_BUCKET=traxettle-staging.firebasestorage.app" \
  --set-secrets="FIREBASE_PRIVATE_KEY=...,JWT_SECRET=...,JWT_REFRESH_SECRET=..." \
  --allow-unauthenticated

gcloud run deploy traxettle-web-staging \
  --source apps/web \
  --region us-central1 \
  --set-env-vars="NEXT_PUBLIC_APP_ENV=staging" \
  --set-env-vars="NEXT_PUBLIC_API_URL=https://traxettle-api-staging-943648574702.us-central1.run.app" \
  --allow-unauthenticated
```

---

## 7. Post-deploy smoke test

```bash
BASE=<deployed api base>

curl -s $BASE/health
curl -s $BASE/api/config | python3 -m json.tool
curl -s -o /dev/null -w 'pools: %{http_code}\n'  $BASE/api/pools/event/x/summary   # 401 expected
curl -s -o /dev/null -w 'mock:  %{http_code}\n'  $BASE/api/users/profile -H 'Authorization: Bearer mock-x'  # 401 expected
curl -s -o /dev/null -w '404:   %{http_code}\n'  $BASE/api/nope                    # 404 expected
```

Then, through the UI: register → create an event → add an expense → invite someone (confirm
the **email actually arrives**) → generate a settlement → pay → confirm → close.

---

## 8. Observability

There is **no structured monitoring or log aggregation** — only console logging, which
surfaces as Cloud Run logs:

```bash
gcloud run services logs read traxettle-api-staging --region us-central1 --limit 100
gcloud run services logs tail traxettle-api-staging --region us-central1
```

There is also **no rate limiting**. Both are recorded in
[`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

---

**Sources:** `scripts/api-deployment/*` · `scripts/web-deployment/*` ·
`scripts/firebase/*` · `firebase.json` · `.firebaserc` · `Dockerfile`, `Dockerfile.web` ·
`apps/api/src/config/firebase.ts` · `apps/api/src/middleware/auth.ts` ·
`traxettle-app/docs/deployment/{DEPLOYMENT_RUNBOOK,DEPLOYMENT_CHANNELS,FIRST_RELEASE_CHECKLIST}.md`
