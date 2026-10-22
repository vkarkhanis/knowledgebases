# Shared Libraries

Two packages under `libraries/`. Both are consumed from their **built `dist/`**, which has a
practical consequence worth stating up front:

```bash
# After ANY change to libraries/shared or libraries/ui, rebuild or the apps use stale code:
node common/scripts/install-run-rush.js build --to @traxettle/shared --to @traxettle/ui
```

Forgetting this is the most common source of *"I changed the type / the maths and nothing
happened"*.

---

## `@traxettle/shared` — `libraries/shared`

Types, enums, DTOs and **pure money/pool maths**. No I/O, no React, no platform APIs — which
is why the API, the web app and the mobile app can all depend on it.

| File | Lines | Contents |
|---|---|---|
| `src/index.ts` | 577 | Core domain types, DTOs, enums, `ApiResponse`, `Balance`, `Settlement`, `isPoolSideLeg()`, `SUPPORTED_CURRENCIES`, `PaymentProvider`. Re-exports all three pool modules |
| `src/pool.ts` | 512 | Pool types, `POOL_PRESETS`, `POOL_PRESET_LABELS`, `buildPoolConfig`, funding-model helpers, `entityKey`/`parseEntityKey`, `currencyExponent`/`toMinor`/`fromMinor` |
| `src/pool-math.ts` | 531 | `allocateMinor`, `computeCycleTotals`, `computeArrears`, `computeFundingState`, `computeOverdraftState`, `nextOverdraftLatch`, `evaluateDraw`, `reconcileCycle`, `splitForMembershipChange` |
| `src/pool-ui.ts` | 270 | Presentation helpers shared by both clients: formatting, refusal copy, receipt rule, meter geometry, the create-event funding choice |
| `src/passwordRules.ts` | 8 | `isStrongPassword`, `PASSWORD_RULE_MESSAGE` |

Tests (`src/__tests__/`): `index.test.ts` (615, with a snapshot), `pool.test.ts` (156),
`pool-math.test.ts` (**700**, including randomised invariant checks), `pool-ui.test.ts` (183).

```bash
cd libraries/shared && npm test          # 100% coverage target
cd libraries/shared && npm run build     # tsc → dist/
cd libraries/shared && npm run dev       # tsc --watch
```

### What belongs here

✅ A type used by more than one package · a pure calculation both the API and a client must
agree on · an enum or constant list · user-facing copy derived from structured data
(like a pool refusal message).

❌ Anything that touches Firestore, `fetch`, React, `react-native`, `AsyncStorage`,
`localStorage` or `process.env`.

The guiding rule stated in `pool-math.ts`: *"No I/O. Shared by the API (authoritative) and
the clients (rendering the balance meter), so both always agree."*

### Exported symbol groups

| Group | Symbols |
|---|---|
| Users | `User`, `UserPreferences`, `UserProfile`, `UserPaymentMethod`, `PaymentMethodType`, `PlanTier`, `EntitlementStatus`, `EntitlementSource`, `UserCapabilities`, **`hasActivePro()`** |
| Events | `Event`, `EventParticipant`, `SettlementApproval`, `CreateEventDto`, `UpdateEventDto`, `ParticipantDto`, `EventType`, `EventStatus` |
| Groups | `Group`, `CreateGroupDto`, `UpdateGroupDto`, `UserRole` |
| Expenses | `Expense`, `ExpenseSplit`, `SplitEntity`, `OnBehalfOfEntry`, `CreateExpenseDto`, `UpdateExpenseDto`, `ExpenseType`, `SplitType` |
| Settlement | `Balance`, `Settlement`, `SettlementKind`, `isPoolSideLeg`, **`poolPaymentActions()`**, `SettlementAuditEntry`, `SettlementPlan`, `CreateSettlementDto`, `SettlementStatus` |
| Invitations | `Invitation`, `CreateInvitationDto`, `InvitationStatus` |
| Currency / FX | `SUPPORTED_CURRENCIES`, `SupportedCurrency`, `FxRate`, `FxRateMode`, `PaymentProvider` |
| Payments | `PaymentIntent`, `PaymentResult`, `UPIData`, `CardData`, `PaymentMethod`, `PaymentStatus` |
| Notifications | `Notification`, `NotificationData`, `NotificationType` |
| API | `ApiResponse`, `PaginatedResponse`, `TokenPair`, `ValidationError`, `LoginRequest`, `RegisterRequest` |
| Pool — config | `EventFundingModel`, `ExpenseFundingSource`, `PoolConfig`, `CreatePoolConfigDto`, `PoolPreset`, `PoolFunderMode`, `PoolCycleMode`, `PoolRecurrence`, `PoolSurplusPolicy`, `PoolDeficitPolicy`, `PoolOverdraftPolicy`, `PoolOverdraftBaseline`, `PoolExpenseApprovalMode`, `POOL_PRESETS`, `POOL_PRESET_LABELS`, `buildPoolConfig`, `DEFAULT_FUNDING_MODEL`, `DEFAULT_FUNDING_SOURCE` |
| Pool — ledger | `PoolCycle`, `PoolCycleStatus`, `PoolCycleCloseReason`, `PoolContribution`, `PoolContributionKind`, `PoolContributionStatus`, `PoolAuditEntry`, `PoolAuditAction`, `PoolDrawState`, `PoolDrawStatus`, `PoolExpenseFlag`, `PoolLedger`, `PoolLedgerEntry`, `PoolSpenderSummary`, `PoolEntityRef`, `PoolEntityShare`, `PoolShareBasis`, `PoolReconciliation` |
| Pool — derived | `PoolCycleTotals`, `PoolOverdraftState`, `PoolBalanceZone`, `PoolFundingState`, `PoolArrear`, `PoolCycleSummary`, `PoolRefusalCode`, `PoolRefusalDetails` |
| Pool — maths | `allocateMinor`, `AllocationWeight`, `ContributionLike`, `DrawLike`, `computeCycleTotals`, `computeArrears`, `computeFundingState`, `computeOverdraftState`, `nextOverdraftLatch`, `evaluateDraw`, `DrawDecision`, `reconcileCycle`, `ReconcileInput`, `ReconcileResult`, `splitForMembershipChange` |
| Pool — money | `currencyExponent`, `toMinor`, `fromMinor`, `entityKey`, `parseEntityKey`, `resolveFundingModel`, `resolveFundingSource`, `isPoolFundedEvent`, `isPoolFundedExpense`, `allowedFundingSources`, **`canApproveDraw()`** |
| Pool — UI | `CURRENCY_SYMBOLS`, `currencySymbol`, `formatMinor`, `POOL_NOUN`, `poolNoun`, `ZONE_TONE`, `CONTRIBUTION_STATUS`, `describePoolRefusal`, `canRecordAnyway`, `toPoolError`, `poolErrorText`, `PoolErrorInfo`, `isReceiptRequired`, `meterGeometry`, `meterCaption`, `FundingKind`, `FunderChoice`, `FundingChoice`, `DEFAULT_FUNDING_CHOICE`, `CONTRIBUTOR_PRESETS`, `withPreset`, `needsTarget`, `validateFundingChoice`, `buildFundingPayload`, **`poolPaymentActionsText()`**, **`ReimbursementStatus`**, **`REIMBURSEMENT_STATUS`**, **`reimbursementStatus()`**, **`CONTRIBUTOR_POOLS_IN_PRODUCTION`**, **`contributorPoolsAvailable()`**, **`choosePool()`** |
| Password | `isStrongPassword`, `PASSWORD_RULE_MESSAGE` |

---

## `@traxettle/ui` — `libraries/ui`

Styled-components primitives and the theme system. **Web only** — React 19 + `react-dom` +
`styled-components` are peer dependencies, so the mobile app does not consume it (mobile uses
`styled-components/native` with its own `theme.ts`).

| Path | Export |
|---|---|
| `src/components/Button.tsx` | `Button` — `$variant` (primary/secondary/outline/danger), `$size` |
| `src/components/Input.tsx` | `Input` |
| `src/components/TextArea.tsx` | `TextArea` |
| `src/components/Select.tsx` | `Select` |
| `src/components/Card.tsx` | `Card`, `CardTitle` |
| `src/components/Modal.tsx` | `Modal` — takes `dataTestId`; used for every confirmation (there are no browser `alert`/`confirm` calls anywhere in the web app) |
| `src/components/Badge.tsx` | `Badge` — status/tone colours shared by dashboard tiles and the event detail page |
| `src/components/Tabs.tsx` | `Tab`, `TabList`, `TabPanel` |
| `src/components/EmptyState.tsx` | `EmptyState` |
| `src/components/AppShell.tsx` | `AppShell` layout frame |
| `src/theme/themes.ts` | Four themes: **light, dark, ocean, forest** |
| `src/theme/ThemeProvider.tsx` | `ThemeProvider` |
| `src/toast/ToastProvider.tsx` | `ToastProvider` + the toast hook — all success/error feedback |
| `src/types/styled.d.ts` | Theme type augmentation |

```bash
cd libraries/ui && npm run build   # tsc → dist/
cd libraries/ui && npm test        # jest + @testing-library/react
```

Tested with `@testing-library/react` 16 and `jest-dom` 6. Coverage thresholds apply
(`npm run test:coverage`).

---

## Dependency graph

```
@traxettle/shared  ──►  @traxettle/api
                   ──►  @traxettle/web  ◄──  @traxettle/ui
                   ──►  @traxettle/mobile
```

`@traxettle/shared` depends on nothing in the monorepo. `@traxettle/ui` depends on nothing in
the monorepo either (it is pure React + styled-components). There are no cycles.

Rush resolves these as `workspace:^1.0.0` dependencies.

---

**Sources:** `libraries/shared/src/**` · `libraries/shared/package.json` ·
`libraries/ui/src/**` · `libraries/ui/package.json` · `rush.json` ·
`.github/workflows/ci.yml`
