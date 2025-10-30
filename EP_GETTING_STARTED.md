# Getting Started with Plasmic Development

Set up and run Plasmic Studio locally.

## Quick Start

```bash
# 1. Install dependencies
yarn install
cd packages/react-web-runtime && yarn install && cd ../..
cd platform/host-test && yarn install && cd ../..

# 2. Start PostgreSQL
docker-compose up -d --no-deps plasmic-db

# 3. Create .env files (see Step 3 for content)
cp .env.example .env  # or create manually
cp .env platform/wab/.env

# 4. Setup and run
yarn setup-all
yarn bootstrap:platform
yarn dev

# 5. Component development (new terminal)
cd plasmicpkgs-dev && yarn dev
```

http://localhost:3003 • Login: `user@example.com` / `!53kr3tz!`

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | See `.tool-versions` |
| Yarn | 1.22.21 | |
| Docker | Any recent | PostgreSQL only |
| RAM | 8GB+ | Recommended |

## Setup Instructions

### Step 1: Install Dependencies

```bash
git clone <repository-url>
cd plasmic-ep
yarn install

# Required for specific packages
cd packages/react-web-runtime && yarn install && cd ../..
cd platform/host-test && yarn install && cd ../..
```

### Step 2: Start Database

```bash
docker-compose up -d --no-deps plasmic-db
```

Verify with `docker ps`

### Step 3: Configure Environment

Create `.env` in root `/` and `/platform/wab/`:

```bash
DATABASE_URI=postgres://wab:SEKRET@localhost:5432/wab
WAB_DBNAME=plasmic-db
WAB_DBPASSWORD=SEKRET
NODE_ENV=development
```

Required in both directories.

### Step 4: Build Everything

```bash
yarn setup-all
```

Builds all packages and prepares platform.

### Step 5: Initialize Database

```bash
yarn bootstrap:platform
```

### Step 6: Start Plasmic Studio

```bash
yarn dev
```

Running at:
- Studio: http://localhost:3003
- API: http://localhost:3004

### Step 7: Component Development (Optional)

New terminal:
```bash
cd plasmicpkgs-dev
yarn dev
```

http://localhost:3000

## Test Accounts

| Account | Email | Password | Notes |
|---------|-------|----------|-------|
| User | `user@example.com` | `!53kr3tz!` | Use this |
| User 2 | `user2@example.com` | `!53kr3tz!` | Alternative |
| Admin | `admin@admin.example.com` | `!53kr3tz!` | Avoid |

## Common Tasks

### Building Packages

| Task | Command |
|------|---------|
| Build all | `yarn bootstrap` |
| Build package | `cd packages/[name] && yarn build` |
| Build component | `cd plasmicpkgs/[name] && yarn build` |
| Build canvas | `yarn setup:canvas-packages` |

### Daily Commands

| Task | Command | Port |
|------|---------|------|
| Start all | `yarn dev` | 3003, 3004 |
| Frontend only | `cd platform/wab && yarn dev:frontend` | 3003 |
| Backend only | `cd platform/wab && yarn dev:backend` | 4004 |
| Components | `cd plasmicpkgs-dev && yarn dev` | 3000 |
| Reset DB | `yarn db:reset` | |
| Tests | `yarn test` | |
| Types | `yarn typecheck` | |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port in use | `lsof -ti:3003 \| xargs kill -9` |
| DB connection failed | `docker ps` then `docker-compose restart plasmic-db` |
| Build errors | `rm -rf node_modules && yarn install && yarn setup-all` |
| Memory errors | `NODE_OPTIONS='--max-old-space-size=8192' yarn build` |
| Package conflicts | `npm list @plasmicapp/*` then `yarn install --force` |

### Common Fixes

```bash
# Reset everything
rm -rf node_modules */*/node_modules
yarn install
yarn setup-all
yarn bootstrap:platform

# Reset database
yarn db:reset

# Check ports
lsof -i :3003
```

## Development Workflow

### Daily

```bash
# Terminal 1
yarn dev

# Terminal 2 (if needed)
cd plasmicpkgs-dev && yarn dev

# Before commits
yarn lint && yarn typecheck && yarn test
```

### Component Development

```bash
# Terminal 1: Build component
cd plasmicpkgs/commerce-providers/elastic-path
yarn start

# Terminal 2: Test
cd plasmicpkgs-dev
yarn dev
```

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

| Service | URL |
|---------|-----|
| Studio | http://localhost:3003 |
| API | http://localhost:3004 |
| Components | http://localhost:3000 |

## Resources

- WAB: `platform/wab/CLAUDE.md`
- Platform: `docs/contributing/platform/`
- Contributing: `CONTRIBUTING.md`
- Help: [Forum](https://forum.plasmic.app/) • [Slack](https://www.plasmic.app/slack)

## Advanced

<details>
<summary>Manual PostgreSQL Setup</summary>

### MacOS (MacPorts)
```bash
sudo port install postgresql15 postgresql15-server
sudo port select postgresql postgresql15
```

### Ubuntu
```bash
apt update
apt install postgresql postgresql-contrib
sudo -u postgres psql
CREATE DATABASE wab;
CREATE USER wab WITH PASSWORD 'SEKRET';
GRANT ALL PRIVILEGES ON DATABASE wab TO wab;
```
</details>

<details>
<summary>ASDF Version Management</summary>

```bash
# Install asdf - see https://asdf-vm.com/
asdf plugin add nodejs
asdf plugin add python
asdf install
```
</details>
