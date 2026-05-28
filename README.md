# LedgerFlow

> Financiële workflows voor moderne finance teams.

LedgerFlow is a multi-tenant SaaS platform that connects accounting systems
(Yuki today; Exact Online, Twinfield, AFAS planned) with Excel exports,
reporting, consolidations, AI commentary, and finance automations.

This repository contains the MVP: a Node/TypeScript backend, a React/Vite
frontend, PostgreSQL via Prisma, Stripe subscriptions, and a modular
accounting-connector layer with a working **Yuki SOAP** implementation.

---

## Architecture

```
ledgerflow/
├── backend/                  Node/Express/TypeScript API
│   ├── src/
│   │   ├── config/           env, prisma, stripe, logger
│   │   ├── controllers/
│   │   ├── services/         auth, subscription, export
│   │   ├── middleware/       auth, validate, subscription, errors
│   │   ├── routes/           health, auth, organizations, yuki, export, billing
│   │   ├── clients/connectors/
│   │   │   ├── interfaces/   Connector.ts (abstraction)
│   │   │   ├── mock/         MockConnector
│   │   │   └── yuki/         YukiSoapClient + YukiConnector (real SOAP)
│   │   ├── utils/            crypto (AES-256-GCM), errors
│   │   └── types/
│   └── prisma/schema.prisma  User, Organization, Subscription, YukiConnection, AuditLog, RefreshToken
├── frontend/                 React + Vite + TypeScript + Tailwind
│   └── src/
│       ├── pages/            Login, Register, Dashboard, Settings, Billing, Yuki, Exports
│       ├── layouts/          AuthLayout, AppLayout
│       ├── contexts/         AuthContext, OrganizationContext
│       └── services/api.ts   fetch wrapper with auto-refresh
├── docker-compose.yml        postgres + backend + frontend
└── README.md
```

### Design principles

- **Multi-tenant by default.** Users → Organizations (many-to-many via `OrganizationUser` with a role). Every resource (subscription, Yuki connection, audit log) is scoped to an organization.
- **Backend-controlled accounting integrations.** Yuki credentials never touch the browser. They're stored encrypted (AES-256-GCM) and only decrypted server-side at call time.
- **Connector abstraction.** All accounting systems implement `Connector` (`testConnection`, `getTrialBalance`, `getTransactions`, `getDebtors`, `getCreditors`). Adding Exact Online or Twinfield is dropping a new class into `clients/connectors/`.
- **Subscription gating.** `requireActiveSubscription()` middleware blocks exports / syncs when the org has no active Stripe subscription.
- **API-first.** The frontend is a thin client over `/auth/*` and `/api/*`. Same surface will serve a future Excel Add-in or Power BI connector.

---

## Tech stack

| Layer       | Stack                                                                 |
|-------------|-----------------------------------------------------------------------|
| Frontend    | React 18, TypeScript, Vite, TailwindCSS, React Router                 |
| Backend     | Node 20, TypeScript, Express, Pino, Helmet, express-rate-limit, Zod   |
| Database    | PostgreSQL 16                                                         |
| ORM         | Prisma 5                                                              |
| Auth        | JWT access tokens + opaque refresh tokens (rotated, hashed in DB), bcrypt |
| Payments    | Stripe Subscriptions (Checkout + webhooks)                            |
| Excel       | ExcelJS                                                               |
| Yuki        | SOAP 1.2 client (`undici` + `fast-xml-parser`)                        |
| Infra       | Docker, docker-compose                                                |

---

## Local development

### Prerequisites
- Docker & Docker Compose
- Node 20+ (only if you want to run backend/frontend outside Docker)

### Quick start — Docker

```bash
# 1. Copy env template
cp backend/.env.example backend/.env

# 2. Generate a real encryption key (32 random bytes, hex)
#    openssl rand -hex 32
#    → paste into CREDENTIAL_ENCRYPTION_KEY in backend/.env

# 3. Boot the stack
docker compose up --build
```

This starts:
- `postgres` on `localhost:5432`
- `backend` on `http://localhost:4000`
- `frontend` on `http://localhost:5173`

### First-run database migration

In a second terminal:

```bash
docker compose exec backend npx prisma migrate dev --name init
docker compose exec backend npx prisma generate
```

Then open <http://localhost:5173>, register an account, and you're in.

### Running outside Docker (optional)

```bash
# Postgres
docker compose up postgres -d

# Backend
cd backend
cp .env.example .env  # edit if needed
npm install
npx prisma migrate dev --name init
npm run dev           # http://localhost:4000

# Frontend
cd ../frontend
npm install
npm run dev           # http://localhost:5173
```

---

## Environment variables

See `backend/.env.example`. Key settings:

| Variable                       | Purpose                                                                                  |
|--------------------------------|------------------------------------------------------------------------------------------|
| `DATABASE_URL`                 | Postgres connection string                                                               |
| `JWT_ACCESS_SECRET`             | JWT access-token signing key (≥16 chars). Refresh tokens are opaque, not JWTs — no separate secret needed. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`       | e.g. `15m` / `30d`                                                            |
| `CREDENTIAL_ENCRYPTION_KEY`    | **64 hex chars** (32 bytes) for AES-256-GCM. `openssl rand -hex 32`                      |
| `CONNECTOR_MODE`               | `mock` (default, no Yuki account needed) or `yuki`                                       |
| `STRIPE_SECRET_KEY`            | `sk_test_...` from your Stripe dashboard                                                 |
| `STRIPE_WEBHOOK_SECRET`        | From `stripe listen --forward-to localhost:4000/api/billing/webhook`                     |
| `STRIPE_PRICE_STARTER/PROFESSIONAL/OFFICE` | Stripe Price IDs from your Stripe products                                    |
| `CORS_ORIGIN`                  | Frontend origin, comma-separated for multiple                                            |

---

## Stripe setup

1. In <https://dashboard.stripe.com> (test mode) create three Products with recurring prices: **Starter**, **Professional**, **Office**.
2. Copy each Price ID (`price_...`) into `STRIPE_PRICE_*` env vars.
3. Install the Stripe CLI and forward webhooks locally:

   ```bash
   stripe listen --forward-to localhost:4000/api/billing/webhook
   ```

   Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
4. Complete a test checkout from the **Billing** page; the webhook upserts the `Subscription` row, which unlocks exports.

---

## Yuki setup

LedgerFlow uses Yuki's SOAP 1.2 web services
(`https://api.yukiworks.nl/ws/{Service}.asmx`).

1. In your Yuki portal, generate a **Web service API key** (Settings → Web services → Web service API key) with rights on the **Accounting**, **AccountingInfo**, and (optional) **Contact** services.
2. Find the **Administration ID** (UUID) for the administration you want to connect (Settings → Administration → details).
3. Set `CONNECTOR_MODE=yuki` in `backend/.env`.
4. In the app, go to **Yuki-koppeling**, paste the API key + Administration ID, save, then click **Test verbinding**.

The credentials are encrypted with AES-256-GCM and never returned to the browser.

### Yuki method mapping (verify against your Postman collection)

| LedgerFlow call                | Yuki service     | Method                           |
|--------------------------------|------------------|----------------------------------|
| `connector.testConnection()`   | Accounting       | `Authenticate` (+ optional `Administrations`) |
| `connector.getTrialBalance()`  | AccountingInfo   | `GLAccountBalance` *              |
| `connector.getTransactions()`  | AccountingInfo   | `GLAccountTransactions` *         |
| `connector.getDebtors()`       | Contact          | `Debtors`                         |
| `connector.getCreditors()`     | Contact          | `Creditors`                       |
| `connector.processJournal()`   | Accounting       | `ProcessJournal` (writeback)      |

\* The method names for the AccountingInfo service are isolated at the bottom of `backend/src/clients/connectors/yuki/YukiConnector.ts` (`methodTrialBalance`, `methodTransactions`). If your Postman collection shows a different name (e.g. `GLAccountBalanceByPeriod`), edit those two constants — no other code changes needed.

### Mock mode

When `CONNECTOR_MODE=mock`, `MockConnector` returns realistic Dutch SME data so the entire frontend (dashboard, exports, billing flow) can be exercised without a Yuki account. Excellent for demos and for developing AI workflows.

---

## API surface

```
GET    /health                                health + db check

POST   /auth/register                         create user + org + owner membership
POST   /auth/login                            issue access + refresh tokens
POST   /auth/refresh                          rotate refresh, issue new access
POST   /auth/logout                           revoke refresh token
GET    /auth/me                               current user

GET    /api/organizations                     list orgs the user belongs to
POST   /api/organizations                     create a new org
PATCH  /api/organizations/current             rename current org (ADMIN+)

PUT    /api/yuki/connection                   save encrypted credentials (ADMIN+)
GET    /api/yuki/connection                   connection metadata (no secrets)
DELETE /api/yuki/connection                   disconnect
GET    /api/yuki/test-connection              call Authenticate against Yuki
GET    /api/yuki/trial-balance?from=&to=      returns trial balance rows
GET    /api/yuki/transactions?from=&to=       returns transaction rows
GET    /api/yuki/debtors                      contact list
GET    /api/yuki/creditors                    contact list

GET    /api/export/trial-balance.xlsx?from=&to=
GET    /api/export/transactions.xlsx?from=&to=

POST   /api/billing/create-checkout-session   { plan: STARTER|PROFESSIONAL|OFFICE }
GET    /api/billing/subscription              current sub status
POST   /api/billing/webhook                   Stripe webhook (raw body)
```

All `/api/*` routes require:
- `Authorization: Bearer <accessToken>` header
- `x-organization-id: <orgId>` header (the frontend sends this automatically)

Exports / syncs additionally require an active subscription (`ACTIVE` or `TRIALING`).

---

## Security

- Passwords hashed with bcrypt (cost 12).
- JWT access tokens, opaque refresh tokens (random 48 bytes, base64url), stored hashed (SHA-256) in DB, rotated on each use, revocable.
- Refresh tokens delivered as **httpOnly, sameSite=Lax cookie** scoped to `/auth`.
- Yuki credentials encrypted at rest with AES-256-GCM; encryption key never leaves the backend; ciphertext never leaves the backend.
- `helmet`, `cors` with explicit allow-list, `express-rate-limit` globally + stricter on auth endpoints.
- All requests validated with Zod schemas; errors mapped centrally and never leak stack traces in production.
- Pino logger redacts authorization headers, cookies, passwords, and encrypted credentials.

---

## Roadmap

Architecture is already shaped for these (no rewrites needed):

- **Exact Online connector** — drop a new class implementing `Connector` into `clients/connectors/exact/`.
- **Twinfield connector** — same.
- **AI commentary on financial data** — `services/ai/` consuming `Connector` output; expose `/api/ai/commentary`.
- **Variance analysis & anomaly detection** — same pattern.
- **Writeback to accounting systems** — the Yuki `processJournal()` method on the connector is already implemented and verified.
- **Office.js Excel Add-in** — calls the existing `/api/export/*` and `/api/yuki/*` endpoints with a bearer token.
- **Power BI connector** — same.

---

## Project conventions

- TypeScript strict mode everywhere (`noUncheckedIndexedAccess` on the backend).
- No business logic in routes — they validate, then delegate to a service.
- No SQL outside repositories/Prisma; no Yuki XML outside `clients/connectors/yuki/`.
- All async route handlers wrap in `asyncHandler` so thrown errors reach the central error middleware.
- UI text is in Dutch; code, comments, and logs are in English.
