# Getting Started with Plasmic Development

Set up and run Plasmic Studio locally.

## Prerequisites

- Git
- Docker and Docker Compose
- Node.js (see `.tool-versions` for exact version)
- pnpm, at the version pinned by the `packageManager` field in the root `package.json`.
  `corepack enable` provisions it. Check with `pnpm --version` before installing: a pnpm
  supplied by volta or asdf can sit earlier on `PATH` and shadow corepack's shim, and pnpm 9
  silently ignores everything in `pnpm-workspace.yaml` — `overrides`, `allowBuilds`,
  `shamefullyHoist` — so it resolves a different dependency tree.
- Yarn 1.22.x, for the `platform/*` apps

## Clone the repository

```bash
git clone https://github.com/elasticpath/plasmic.git plasmic-ep
cd plasmic-ep
```

# Start PostgreSQL

## Database setup

Plasmic uses PostgreSQL (v15) as a database. We highly recommend setting postgres through docker (see `docker-compose.yml` for details).
Run `docker-compose up -d --no-deps plasmic-db` in your terminal to build and launch the postgresql instance.

```bash
docker-compose up -d --no-deps plasmic-db
```

## Manual services setup (suggested)

Before proceeding, make sure you have configured your [database](#database-setup).

### 1. Environment variables

Make sure the root of your project and `./platform/wab` folder contain the following `.env` files:

```
DATABASE_URI=postgres://wab:SEKRET@localhost:5432/wab
WAB_DBNAME=plasmic-db
WAB_DBPASSWORD=SEKRET
NODE_ENV=development
```

### 2. Installing dependencies

The root workspace (`packages/`, `plasmicpkgs/`, `plasmicpkgs-dev`) uses pnpm; every
`platform/*` app uses yarn 1. So install twice:

```bash
pnpm install
cd platform/wab && yarn install
```

### 3. Setup application and run migrations

In the root directory run (this may take several minutes):

```bash
pnpm setup && pnpm setup:canvas-packages && cd platform/wab && yarn typeorm migration:run && yarn migrate-dev-bundles
```

### 4. Seeding the database

In the `./platform/wab` run:

```bash
yarn seed
```

### 5. Seed latest Plume

Updates the "Plume" package in your local database. Plume is Plasmic's internal component library/design system.

In the `./platform/wab` run:

```bash
yarn plume:dev update
```

### 6. Build all packages

Build all SDK packages (this may take several minutes):

```bash
pnpm bootstrap
```

### 7. Start Plasmic Studio

In the `./platform/wab` run:

```bash
yarn dev
```

Running at:

- Studio: http://localhost:3003
- API: http://localhost:3004

http://localhost:3003 • Login: `user@example.com` / `!53kr3tz!`

## Test Accounts

| Account | Email                     | Password    | Notes       |
| ------- | ------------------------- | ----------- | ----------- |
| User    | `user@example.com`        | `!53kr3tz!` | Use this    |
| User 2  | `user2@example.com`       | `!53kr3tz!` | Alternative |
| Admin   | `admin@admin.example.com` | `!53kr3tz!` | Avoid       |

WARNING: Avoid testing with the admin@admin.example.com user.
By default, the admin.example.com domain is considered an admin and has
elevated privileges (e.g. access to all teams, workspaces, projects, etc).
For most development purposes, use a normal user such as user@example.com.

## Project Structure

```
plasmic-ep/
├── packages/           # Core SDKs
├── plasmicpkgs/       # Components
├── plasmicpkgs-dev/   # Testing app
├── platform/wab/      # Studio
├── examples/          # References
└── .env              # Config
```

## Quick Links

| Service | URL                   |
| ------- | --------------------- |
| Studio  | http://localhost:3003 |
| API     | http://localhost:3004 |

## Database Management

### Resetting the database

If you need to reset your database to a fresh state (useful when testing migrations or starting fresh):

```bash
cd platform/wab && yarn db:reset
```

This command will:

1. Backup your existing database with a timestamp
2. Create a fresh database
3. Run all migrations
4. Seed the database with test users and initial data

**When to use db:reset:**

- Starting fresh after breaking changes
- Testing migration scripts
- Clearing out test data

### Pointing at a different database

Two mechanisms decide which database you hit, and they read different sources:

| What you run                        | Reads                                           | Notes                                                                   |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `yarn typeorm migration:run`        | `platform/wab/ormconfig.json`                   | TypeORM CLI only. Ignores `DATABASE_URI`.                               |
| `yarn seed`, `yarn dev`, the server | `DATABASE_URI` (from the environment or `.env`) | Falls back to `postgresql://wab@localhost/$WAB_DBNAME`, i.e. port 5432. |

So setting one does not redirect the other. To run against a throwaway database on
port 5433, set the port in `ormconfig.json` for the migration, and pass
`DATABASE_URI` to everything else:

```bash
# migrations: ormconfig.json needs "port": 5433
cd platform/wab && yarn typeorm migration:run

# seed and Studio: environment wins over ormconfig.json
DATABASE_URI="postgres://wab:SEKRET@localhost:5433/wab" yarn seed
DATABASE_URI="postgres://wab:SEKRET@localhost:5433/wab" pnpm dev
```

Set only `ormconfig.json` and the migrations land on the throwaway while the seed
writes to your normal database. `ormconfig.json` is tracked, so revert it afterwards.

## Worker Pool Configuration

Code generation runs in worker threads to avoid blocking the main server. Two pools handle different stages:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GENERIC_WORKER_POOL_SIZE` | Generates React code per project (CPU-intensive: parses site model, exports components/assets/tokens to TypeScript/CSS) | `1` |
| `LOADER_WORKER_POOL_SIZE` | Bundles generated code from multiple projects using esbuild into final output for the loader SDK | `1` |

**Service architecture:**

- **Development**: The wab server handles everything, so both pools are used locally.
- **Production**: Codegen routes are split to a separate service for security (SSR sandboxing). The wab service still needs workers for CLI sync (`plasmic sync`) and localization. The codegen service handles high-volume loader API requests.

**Production defaults** (configurable via GitHub Actions or Terraform):

| Service | Generic | Loader |
|---------|---------|--------|
| codegen | 2 | 4 |
| wab | 2 | 2 |

```bash
# .env example for local development
GENERIC_WORKER_POOL_SIZE=2
LOADER_WORKER_POOL_SIZE=4
```

Workers timeout after 6 minutes. Higher values improve parallel request throughput but increase memory usage.

## Resources

- Original docs - `docs/contributing/platform/00-getting-started.md`
- WAB: `platform/wab/CLAUDE.md`
- Platform: `docs/contributing/platform/`
- Contributing: `CONTRIBUTING.md`
- Help: [Forum](https://forum.plasmic.app/)
