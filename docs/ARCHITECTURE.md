# FarmOS — Architecture & System Design

FarmOS is a **modular monolith**: one Laravel API, one React SPA, one PostgreSQL
database. A farm business does not need microservices; it needs *correct
numbers* and an app that *feels instant*. Everything below serves those two goals.

```
┌──────────────────────────── Browser / PWA ─────────────────────────────┐
│ React 19 + TS + Vite                                                   │
│  ├─ TanStack Query cache  ──persisted──▶ IndexedDB  (instant re-open)  │
│  ├─ Optimistic mutations + offline outbox (Idempotency-Key per write)  │
│  ├─ Laravel Echo  ◀── websocket ── Reverb  (live invalidation)         │
│  └─ i18next (en / bn), Intl currency & number formatting               │
└───────────────┬────────────────────────────────────────────▲───────────┘
                │ HTTPS JSON  (Bearer token, X-Farm-Id)       │ WS
┌───────────────▼────────────────────────────────────────────┴───────────┐
│ Laravel 13 on FrankenPHP                                               │
│  Middleware: auth:sanctum → ResolveFarm (membership + role) →          │
│              Idempotency (replay-safe writes)                          │
│  Controllers (thin) → Form Requests (validation) → Domain Services     │
│  Domain Services run inside DB transactions and write *ledgers*:       │
│     InventoryLedger · MilkLedger · Accounting (double-entry journal)   │
│  Events → broadcast FarmDataChanged(farm, entities) via Reverb         │
│  Scheduler → GenerateAlerts (low stock, vaccines due, overdue AR, …)   │
└───────┬───────────────────────────────┬────────────────────────────────┘
        │                               │
   PostgreSQL (source of truth)     Redis (cache, queues, Reverb scaling)
```

## 1. Why it feels fast ("like WhatsApp")

WhatsApp is fast because it never waits on the network to show you
something. FarmOS uses the same ideas:

| Technique | Where | Effect |
|---|---|---|
| **Persisted query cache** | `frontend/src/lib/queryClient.ts` | Re-opening the app paints the last-known data from IndexedDB at once, then refreshes in the background. |
| **Optimistic writes** | `useApiMutation({ optimistic })` | Recording milk or marking a delivery shows up immediately; rolls back if the server rejects it. |
| **Offline outbox** | `frontend/src/lib/outbox.ts` | Writes made without a connection are queued with their `Idempotency-Key` and replayed when back online. A replay can never double-post. |
| **Realtime invalidation** | Reverb + `lib/realtime.ts` | When a worker records milk on a phone, the owner's dashboard updates live. The payload says only *what changed*, and the client refetches just those queries. |
| **Cheap reads** | running balances on rows (`feed_items.stock_qty`, `customers.balance`), cached dashboard per farm-version | The dashboard is one cached query, not 40 aggregate scans. |
| **Small bundles** | route-level `lazy()` splitting | First load ships only the shell and the current page. |
| **FrankenPHP + OPcache JIT** | prod | Modern HTTP/2/3 server with PHP embedded; Laravel Octane worker mode can be switched on later for boot-once performance. |
| **Service worker** | `public/sw.js` | The app shell is cached, so repeat opens and offline opens need no network for code. |

## 2. Correctness: ledgers, not editable totals

Every quantity that matters is a **ledger** (append-only movements). Totals
are derived from it and only *cached* on the parent row, inside the same
transaction, under a row lock.

| Ledger | Table | Sources |
|---|---|---|
| Feed / inventory | `inventory_movements` | purchase receipt (+), consumption (−), wastage/spoilage (−), adjustment (±) |
| Milk stock | `milk_movements` | production (+), internal use (−), spoilage (−), delivery (−) |
| Money | `journal_entries` + `journal_lines` (double-entry) | invoices, bills, payments, consumption, salary |

Each movement or journal entry carries a polymorphic `source_type/source_id`,
so every number on screen can be traced back to the document that caused it.
A unique index on `(source_type, source_id, kind)` makes **double posting
impossible at the database level**.

Negative stock is rejected in the service, under `SELECT … FOR UPDATE`, so two
phones selling the last 5 litres at the same moment cannot both succeed.

### Units: integers only
Money is stored as **integer minor units** (paisa), milk as **millilitres**,
feed as **grams** (or pieces for countable units). There are no floats on any
money or stock path. The API exchanges human units (`12.5` litres, `৳ 100.00`)
and converts them at the boundary (`App\Support\Units`).

## 3. Accounting rules (documented, consistent)

FarmOS uses **accrual accounting** with a small fixed chart of accounts that
each farm gets seeded with.

| Event | Debit | Credit |
|---|---|---|
| Milk delivery confirmed → invoice | Accounts Receivable (customer) | Milk Sales |
| Other sale (eggs, animals, manure) | AR / Cash | Egg / Animal / Other Sales |
| Customer payment | Cash / Bank / Mobile wallet | Accounts Receivable |
| Feed purchase (bill) | Feed Inventory | Accounts Payable (supplier) |
| Feed consumed | Feed Expense | Feed Inventory (at moving average cost) |
| Wastage / spoilage | Inventory Loss | Feed Inventory |
| Operating expense (bill) | Expense category | AP / Cash |
| Treatment / vaccination cost | Veterinary Expense | AP / Cash |
| Animal purchase | Livestock Assets (capital, **not** an operating expense) | AP / Cash |
| Supplier payment | Accounts Payable | Cash / Bank / Mobile wallet |
| Salary payment | Salaries Expense | Cash / Bank |

Consequences that the reports rely on:
* **Revenue ≠ cash collected.** P&L reads revenue and expense accounts; the
  cash-flow report reads cash, bank and wallet accounts.
* **Feed purchase ≠ feed expense.** Buying feed raises inventory; feed is
  expensed only when it is consumed.
* **Advance payments** credit AR, which leaves the customer with a negative
  balance (a credit). They never create revenue.
* **A payment can never duplicate an expense.** Bills create the expense, and
  payments only settle AP.
* Per-cow and per-flock profitability uses *direct* costs (feed consumed, vet
  costs, purchase) plus clearly labelled *allocated* estimates.

## 4. Multi-tenancy and security

* Every business table has `farm_id`. Models use the `BelongsToFarm` trait,
  which applies a global scope and fills `farm_id` on create from the resolved
  farm. A request **cannot** read another farm's rows, even with a guessed ID.
* `ResolveFarm` middleware reads `X-Farm-Id`, checks the user's membership and
  binds the farm and role for the request.
* Roles: `owner, manager, vet, accountant, delivery, worker`. Abilities live in
  `config/farmos.php`, are checked with `Gate` in controllers, and are
  **enforced on the server**. The UI only mirrors them to hide buttons.
* Auth uses Sanctum bearer tokens, which work the same for the SPA and a future
  mobile app. Tokens expire, and login is rate-limited.
* Audit log: sensitive models record who changed what (before/after JSON).

## 5. Idempotency and document numbers

Every `POST/PUT/PATCH/DELETE` from the client carries an `Idempotency-Key`
(a UUID made when the user *starts* the action). The `Idempotency` middleware
stores the first response for 24h keyed by `(user, key)` and replays it for
any retry. A double-tap, a flaky network or an offline replay can never post
twice.

Invoice and bill numbers come from a per-farm counter row in `document_sequences`,
incremented under a row lock. That makes them gap-free and unique even under concurrency.

## 6. Code layout

```
backend/app/
  Domain/                 business logic; every write path lives here
    Accounting/Ledger.php           double-entry posting, chart of accounts
    Inventory/InventoryLedger.php   stock in/out at moving average cost
    Milk/MilkLedger.php             milk stock, oversell lock
    Sales/SalesService.php          invoices, payments, FIFO allocation, advances
    Sales/DeliveryService.php       delivery workflow → stock + invoice atomically
    Purchasing/PurchasingService.php  bills, supplier payments, salaries
    Livestock/LivestockService.php  animals, flocks, daily records, vet costs
    Reports/ReportService.php, DashboardService.php
    Notifications/AlertService.php  scheduled, de-duplicated alerts
  Http/Controllers/Api/   thin: validate → call service → resource
  Models/                 Eloquent + BelongsToFarm
  Support/Units.php       unit/money conversion
frontend/src/
  lib/        api client, query client, outbox, realtime, i18n, format
  components/ ui primitives, layout shell
  features/   one folder per module (pages + hooks)
```

## 7. Scaling path (no rewrite needed)

1. A single VPS: FrankenPHP + Postgres + Redis + Reverb (docker-compose).
2. Read-heavy growth: Postgres read replica for reports, and Redis cache for the dashboard.
3. Many farms: Octane worker mode and horizontal API containers behind a load balancer, with Reverb scaled over Redis pub/sub.
4. Very large farms: partition `milk_records` and `journal_lines` by month.
