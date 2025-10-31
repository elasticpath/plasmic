# Getting Started with Plasmic Development

Set up and run Plasmic Studio locally.

## Prerequisites

- Git
- Docker and Docker Compose
- Node.js (see `.tool-versions` for exact version)
- Yarn 1.22.x

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

Run `yarn install` twice -- once in the root folder, and second time in the `./platform/wab`

### 3. Setup application and run migrations

In the root directory run (this may take several minutes):

```bash
yarn setup && yarn setup:canvas-packages && cd platform/wab && yarn typeorm migration:run && yarn migrate-dev-bundles
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
yarn bootstrap
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

## Resources

- Original docs - `docs/contributing/platform/00-getting-started.md`
- WAB: `platform/wab/CLAUDE.md`
- Platform: `docs/contributing/platform/`
- Contributing: `CONTRIBUTING.md`
- Help: [Forum](https://forum.plasmic.app/)
