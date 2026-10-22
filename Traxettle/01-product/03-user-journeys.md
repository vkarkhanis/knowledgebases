# Traxettle — User Journeys & Workflows

Every end-to-end flow, with the state machines that govern it. Written so a functional
analyst can produce specs from it without reading code; code pointers are given for
engineers who need to go deeper.

---

## 1. Event lifecycle — the spine of the product

```
          ┌──────────────── expenses editable ─────────────────┐
          │                                                     │
       ACTIVE ───generate settlement───► REVIEW ───all approved───► PAYMENT
          │                                 │                          │
          │  (all balances zero)            │ (expenses changed ⇒      │ all legs
          │                                 │  settlementStale = true) │ completed
          └─────────────────────────────────┴──────────────────────────┤
                                                                       ▼
                                                                    SETTLED
                                                                       │ admin closes
                                                                       ▼
                                                                    CLOSED
```

| Status | Meaning | Mutations allowed? |
|---|---|---|
| `active` | Normal operation. Add expenses, invite people, make groups. | ✅ everything |
| `review` | A settlement plan exists and is awaiting per-entity approval. | ✅ **still editable** — changing an expense sets `settlementStale` so the plan can be regenerated |
| `payment` | Approvals are in; legs are being paid and confirmed. | ❌ locked — only pay / confirm / reject / retry |
| `settled` | All legs complete (or there was nothing to settle). | ❌ locked — only status → `closed` |
| `closed` | Archived. Hidden from the dashboard, available in history with export. | ❌ locked |

The lock is enforced centrally in `apps/api/src/utils/event-guards.ts`:
`requireEditableEvent()` throws for `payment`/`settled`/`closed`.
`markStaleIfInReview()` is called after any mutation that succeeds during review.

**Zero-balance shortcut:** if every balance is zero when a plan is generated, the event
goes straight to `settled` and an admin can close it immediately.

---

## 2. Core journey — peer-to-peer event, start to finish

### 2.1 Create the event

1. User opens **Create event** (web `/events/create`, mobile `CreateEventScreen`).
2. Enters name, type (`trip` | `event`), start date, optional end date, description.
3. Chooses the **expense currency**.
4. **Funding step** — *Split expenses* (default) or *Pool money*. Choosing split means the
   event has no `fundingModel` field at all, which is exactly today's behaviour.
5. Optionally (Pro) sets a **settlement currency** different from the expense currency, plus
   an FX rate mode: *predefined* (type the rate now) or *EOD* (fetch at settlement time).
   A free user attempting this gets `403 FEATURE_REQUIRES_PRO`.
6. Save. The creator becomes an admin and the first participant.

### 2.2 Bring people in

Two routes:

- **Invite** (admin only) — by email, phone or user id, with an optional role (`member` |
  `admin`), an optional target **group**, and an optional message. An email goes out
  (console-logged in mock mode) with a tokenised link. Invitations expire after **7 days**.
- **Add directly** (admin only) — if you already know the user id.

Invitation state machine:

```
PENDING ──accept──► ACCEPTED   (invitee becomes a participant; auto-joins the group if one was set)
   │ ──decline──► DECLINED
   │ ──inviter revokes──► (deleted)
   └──7 days──► EXPIRED  (cannot be accepted)
```

The invitee sees pending invitations on the **Invitations** page/screen, or can open the
tokenised link directly (`GET /api/invitations/token/:token` is public, so the link works
before sign-in).

### 2.3 Optionally form groups

An admin creates a group inside the event: name, members, and a **designated payer**. The
first member becomes the representative by default; it can be transferred.

From then on the group is **one entity**: expenses split onto the group as a whole, and at
settlement the group's payer is the single person who pays or receives.

If the new group's membership overlaps an existing group by ≥70%, Traxettle offers to reuse
the existing one (`POST /api/groups/suggest`) rather than create a near-duplicate.

### 2.4 Add expenses

For each spend:

1. Title, optional description, amount, date.
2. **Paid by** — defaults to the current user.
3. **Split with** — pick the participating entities (individuals and/or groups).
4. **Split type**:
   - *Equal* — divided evenly across selected entities
   - *Ratio* — weights per entity
   - *Custom* — exact amounts, which must sum to the total (the form blocks submit otherwise)
5. Optional **Private** — only you will ever see this expense. The API strips other people's
   private expenses out of event reads, so privacy does not depend on the client.
6. Optional **On behalf of** — pick the entities you are fronting money for. Your own share
   becomes 0 and the splits exclude you.
7. Optional **receipt** — photo or PDF up to 5 MB. Mobile offers *Take photo* / *Choose photo*.
8. In a pooled or hybrid event, a **Paid with** control appears — see
   [`04-money-pooling-functional.md`](04-money-pooling-functional.md).

Any participant may add an expense. Editing or deleting requires being the creator of the
expense or an event admin.

### 2.5 Generate the settlement plan

An admin triggers **Settle**. The API:

1. Computes **entity balances** across all non-private expenses — positive = owed,
   negative = owes.
2. If the event is pooled or hybrid, **reconciles the pool first** and merges its per-entity
   net positions into the same balance array. This happens on *both*
   `POST /api/pools/event/:id/dissolve` and the ordinary
   `POST /api/settlements/event/:id/generate`, so the old "Settle now" button can never mark
   a pool event settled with its money unaccounted for.
3. Runs a **greedy transaction-minimising algorithm** over the balances, producing the
   smallest practical set of legs.
4. For group entities, resolves the actual paying and receiving **users** (the group payer).
5. Applies FX if the settlement currency differs: each leg carries `amount` + `currency`
   plus `settlementAmount` + `settlementCurrency` + `fxRate`.
6. Moves the event to `review` and seeds `settlementApprovals` with one entry per entity.
7. Emits `settlement:generated` and `event:updated` to the event room.

### 2.6 Review and approve

Each entity (a user, or a group via its representative) approves the proposal. Until all
approvals are in, the event stays in `review` and expenses remain editable — any change
sets `settlementStale: true` so the UI can prompt a **regenerate**.

When the last approval lands, the event moves to `payment` and all mutations lock.

### 2.7 Pay and confirm

Per leg:

```
PENDING ──payer marks paid──► INITIATED ──payee confirms──► COMPLETED
   ▲                              │
   │                              │ payee rejects (with reason)
   └──────────────────────────────┘
        (or payer retries after a failure: retryCount++)
```

- The leg shows the **payee's payment methods** so the payer knows where to send the money.
- The payer may attach **proof of payment** (an image) and a note/reference.
- The payee can alternatively **mark paid on the payer's behalf** (*"it arrived, I'll record it"*).
- Every transition appends a `SettlementAuditEntry`: who, what, when, note, reference,
  proof, status from → to.
- Rejection returns the leg to `pending` with a `rejectionReason`.

When **all** legs are `completed`, the event auto-transitions `payment → settled`. Every
transition broadcasts `settlement:updated` so other participants' screens move in real time.

### 2.8 Close and archive

An admin closes the settled event. It disappears from everyone's dashboard immediately
(over WebSocket) and appears in **Closed events**, where it can be exported to CSV or
printed, or emailed as history.

---

## 3. Journey — pooled event

Full detail in [`04-money-pooling-functional.md`](04-money-pooling-functional.md). The
shape:

```
Create event → Funding: Pool money → Several of us / Just me → preset + amounts
      ↓
Pool tab opens.  Contributions created per roster entity.
      ↓
Contributor marks paid (+ proof) → custodian confirms → balance rises
      ↓
Expenses added with "Paid with: Pool funds" or "My money — claim it back"
      ↓  (approval if configured; receipts if required; overdraft checked)
Approved draws deduct.  Claims create a Pool payment leg paid by the custodian.
      ↓
Recurring:  Close <Month> → carry credits forward → next cycle opens
Final:      Settle up / Finish & report → ONE settlement plan → review → payment → settled
```

The crucial structural point: **pool side legs** (reimbursements, cycle payouts, leaver
settlements) are paid and confirmed *while the event stays active*. Only the final
settle-up drives the event lifecycle.

---

## 4. Journey — cross-event "what do I still owe?"

A user opens **Unsettled payments**. The API aggregates, across every event they belong to:

- legs where they (or their group, as its payer) must **pay**
- legs where they must **confirm receipt**

with a summary total and a detail list, exportable to CSV or print. Each row deep-links to
its event.

---

## 5. Journey — upgrading to Pro

1. User hits a Pro-gated action — in practice, choosing a settlement currency different
   from the expense currency. The API refuses with `403` and
   `code: "FEATURE_REQUIRES_PRO"`, naming the feature.
2. The client routes them to the **Pro** page/screen.
3. **Mobile**: RevenueCat presents the configured offering; purchase goes through Google
   Play Billing or Apple IAP. On success RevenueCat's webhook hits the API, the user's
   entitlement is updated, and `user:tier-updated` is broadcast so open sessions refresh
   their capabilities without a reload.
4. **Web**: purchase is not available; the web Pro page explains that the subscription is
   bought in the mobile app. Entitlement, once granted, applies everywhere because it lives
   on the user profile server-side.

See [`05-plans-entitlements-billing.md`](05-plans-entitlements-billing.md).

---

## 6. Journey — mobile environment switch (internal testing)

Released mobile builds default to **production**. To point the same bundle at staging:

1. Tap the **version text** 7 times within ~2 s (profile/settings screen).
2. The developer options sheet appears.
3. Toggle **Switch to Staging**. An orange **STAGE** badge appears.
4. The app **re-bootstraps** — this is required, because the Firebase project must change
   with the API, and a stale cached runtime config would cause
   `auth/custom-token-mismatch`.
5. The app now fetches `/api/config` from the staging API and uses the
   `traxettle-staging` Firebase project.
6. The setting persists across restarts; toggle back to return to production.

*Code: `apps/mobile/src/config/runtime.ts`, `src/services/environment-switch.ts`,
`src/services/app-rebootstrap.ts`, `src/components/DeveloperOptions*.tsx`.*

---

## 7. Access-control summary per action

| Action | Who may do it |
|---|---|
| Read an event, its expenses, groups, pool summary/ledger | any accepted participant |
| Add an expense | any participant (membership is checked server-side) |
| Edit / delete an expense | the expense creator, or an event admin |
| See someone else's private expense | nobody — filtered server-side |
| Invite, add/remove participants, change roles | event admin |
| Create / delete a group | event admin |
| Update a group, transfer representative | group creator or representative |
| Generate / regenerate the settlement | event admin |
| Approve the settlement review | the entity itself (user, or group representative) |
| Mark a leg paid | the `fromUserId` of that leg |
| Confirm / reject a leg | the `toUserId` of that leg |
| Set contribution amounts, confirm/reject/waive contributions | the custodian, or an event admin |
| Approve / reject a pool draw | the custodian, or an event admin |
| Close a cycle, dissolve the pool | the custodian, or an event admin |
| Draw from the pool | the custodian, an authorised spender, or a member of an authorised spender group |
| Delete the event | creator or admin, and only while not settled/closed |

*Code: `apps/api/src/utils/event-access.ts`, `event-guards.ts`,
`services/pool.service.ts` (`isManager`, `canDraw`), per-route checks in
`apps/api/src/routes/`.*

---

**Sources:** `apps/api/src/routes/{events,expenses,settlements,groups,invitations,pools}.ts` ·
`apps/api/src/services/{event,expense,settlement,invitation,pool}.service.ts` ·
`apps/api/src/utils/{event-guards,event-access}.ts` ·
`apps/web/src/app/events/[eventId]/page.tsx` ·
`apps/mobile/src/screens/{EventDetail,CreateExpense,Pool}Screen.tsx` ·
`traxettle-app/docs/app/Functional.md`
