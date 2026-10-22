# Real-time (Socket.IO)

Attached to the same HTTP server as the API. **Path `/ws`**, CORS `origin: '*'`,
methods `GET, POST`.

`apps/api/src/config/websocket.ts` · clients: `apps/web/src/hooks/useSocket.ts`,
`apps/mobile/src/hooks/useSocket.ts`.

```
local   ws://localhost:3001/ws
staging wss://traxettle-api-staging-943648574702.us-central1.run.app/ws
prod    wss://traxettle-api-prod-ncwutlgtga-uc.a.run.app/ws
```

---

## 1. Rooms

| Room | Joined by | Purpose |
|---|---|---|
| `event:{eventId}` | `socket.emit('join-event', eventId)` | Everything about one event |
| `user:{userId}` | `socket.emit('join-user', userId)` | User-level notifications |

Leave with `socket.emit('leave-event', eventId)`.

The **dashboard subscribes to many event rooms at once**, which is how event tiles update
their status (and pool status) live without polling.

> There is **no authentication on room joins.** Any connected client can join any
> `event:{id}` or `user:{id}` room if it knows the id. Payloads carry entity data, so this
> is a real information-disclosure surface. Logged in
> [`../04-engineering/02-known-issues-and-debt.md`](../04-engineering/02-known-issues-and-debt.md).

## 2. Emitters

```ts
emitToEvent(eventId, type, payload)  // → io.to(`event:${eventId}`)
emitToUser(userId,  type, payload)   // → io.to(`user:${userId}`)
```

Both are **no-ops when the server is not initialised**, so services can emit freely in tests.
Both decorate the payload:

```ts
emitToEvent → { eventId, ...payload, timestamp: ISO }
emitToUser  → { userId,  ...payload, timestamp: ISO }
```

## 3. Event catalogue

`WsEventType` is a closed union — adding an event means adding it there first.

### Expenses — room `event:{id}`

| Event | Payload | Emitted from |
|---|---|---|
| `expense:created` | `{ expense }` | `POST /api/expenses` |
| `expense:updated` | `{ expense }` | `PUT /api/expenses/:id`, pool draw approve/reject |
| `expense:deleted` | `{ expenseId }` | `DELETE /api/expenses/:id` |

### Events — room `event:{id}`

| Event | Payload | Emitted from |
|---|---|---|
| `event:updated` | `{ event }` / `{ event: { status } }` / `{ status: 'settled' }` / `{ fundingModel: 'hybrid' }` / `{}` | event update, review/payment/settled transitions, auto-settle, pool convert, dissolve |
| `event:deleted` | `{ eventId }` | `DELETE /api/events/:id` — the web dashboard removes the tile immediately |

Status transitions you will observe: `→ review` (plan generated), `→ payment` (all approvals
in), `→ settled` (all legs complete, emitted as `{ status: 'settled' }`), and the admin
close.

### Groups — room `event:{id}`

`group:created` `{ group }` · `group:updated` `{ group }` · `group:deleted` `{ groupId }`

### Participants — room `event:{id}`

`participant:added` `{ userId }` · `participant:removed` · `participants:updated` `{ participants }`

### Invitations — room `event:{id}`

`invitation:created` `{ invitation }` · `invitation:accepted` `{ invitation }` ·
`invitation:declined` `{ invitation }` · `invitation:revoked` `{ invitationId }`

### Settlements — room `event:{id}`

| Event | Payload | When |
|---|---|---|
| `settlement:generated` | `{ plan }` | a plan was generated or regenerated, including via pool dissolve |
| `settlement:updated` | `{ settlement }` / `{ settlement, allComplete }` / `{ settlementId }` / `{ settlementIds }` / `{ approvals, allApproved }` | pay, confirm, reject, retry, review approval, reimbursement leg creation, cycle-close payouts |

`allComplete` / `allApproved` let a client skip a refetch to decide whether the event just
advanced.

### Pool — room `event:{id}`

| Event | Payload | When |
|---|---|---|
| `pool:updated` | `{ reason, ...extra }` | **every** pool mutation |

Observed `reason` values:

| `reason` | Trigger |
|---|---|
| `config` | `PUT /api/pools/event/:id/config` |
| `converted` | `POST /api/pools/event/:id/convert` |
| `contributions` | `PUT /api/pools/event/:id/contributions` |
| `top_up` | `POST /api/pools/event/:id/top-ups` |
| `contribution_mark-paid` / `contribution_confirm` / `contribution_reject` / `contribution_waive` | the contribution actions (with `{ contributionId }`) |
| `draw_recorded` | a pool expense was created (with `{ expenseId }`) |
| `draw_updated` | a pool expense amount changed |
| `draw_deleted` | a pool expense was deleted |
| `draw_approved` / `draw_rejected` | the approval endpoints |
| `cycle_closed` | `POST /api/pools/event/:id/close` (with `{ cycleId }`) |
| `dissolving` | `POST /api/pools/event/:id/dissolve` |
| *membership-change action* | a participant join/leave that touched the pool, with `settlementIds` |

The contribution-action reasons are generated as `` `contribution_${path}` `` in
`routes/pools.ts`, so they follow the URL segment exactly.

### Pool alerts — room `user:{custodianId}`

| Event | Payload | When |
|---|---|---|
| `pool:alert` | `{ eventId, expenseId, flags, title }` | a draw was recorded **flagged** — i.e. `alreadyIncurred` past a limit. `flags` is `PoolExpenseFlag[]`: `exceeds_tolerance`, `exceeds_spender_cap`, `underfunded` |

This is the "record it anyway" notification path: the custodian learns that real money moved
outside the limit, even though the draw was accepted.

### Entitlements — room `user:{userId}`

| Event | Payload | When |
|---|---|---|
| `user:tier-updated` | `{ tier, entitlementStatus, capabilities }` | RevenueCat webhook applied an entitlement, or the internal switch was used. The web app refreshes profile + capabilities **without a reload** |

---

## 4. Client usage pattern

```ts
// web: apps/web/src/hooks/useSocket.ts   ·   mobile: apps/mobile/src/hooks/useSocket.ts
const socket = io(apiBaseUrl, { path: '/ws' });
socket.emit('join-event', eventId);
socket.on('pool:updated', () => refreshPool());
socket.on('settlement:updated', () => refreshSettlements());
// on unmount:
socket.emit('leave-event', eventId);
```

Both clients treat most events as **invalidation signals** rather than authoritative state:
they refetch the affected resource. That is deliberate — it keeps the server the single source
of truth and avoids divergence when a payload is partial (several `event:updated` emissions
carry only a status).

Tests: `apps/web/src/__tests__/hooks/useSocket.test.ts`,
`apps/api/src/__tests__/config/websocket.test.ts`.

---

## 5. Adding a new real-time event

1. Add the name to `WsEventType` in `apps/api/src/config/websocket.ts`.
2. Emit it from the service or route with `emitToEvent` / `emitToUser`.
3. Subscribe in `apps/web/src/hooks/useSocket.ts` and
   `apps/mobile/src/hooks/useSocket.ts`.
4. Prefer *"something changed, refetch"* over shipping full state.
5. Add it to the catalogue above.

---

**Sources:** `apps/api/src/config/websocket.ts` · `apps/api/src/routes/*.ts` ·
`apps/api/src/services/{settlement,pool}.service.ts` ·
`apps/web/src/hooks/useSocket.ts` · `apps/mobile/src/hooks/useSocket.ts`
