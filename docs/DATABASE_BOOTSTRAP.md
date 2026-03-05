# Database Bootstrap

How to seed a fresh Plasmic database for a new environment.

## Prerequisites

- PostgreSQL database is running with `wab` user and `uuid-ossp` extension
- TypeORM migrations have been run (WAB service runs these on first boot)
- Export devflags from an existing environment (e.g., integration):
  ```sql
  SELECT data FROM dev_flag_overrides ORDER BY "createdAt" DESC LIMIT 1;
  ```
  Save the JSON output to a file (e.g., `devflags-template.json`).

## Run the bootstrap

```bash
cd platform/wab
ADMIN_PASSWORD=<strong-password> WAB_DBPASSWORD=<db-password> \
  yarn bootstrap:prod \
  --devflags /path/to/devflags-template.json \
  --dburi postgresql://wab:<db-password>@<host>:5432/wab
```

`WAB_DBPASSWORD` must match the password in `--dburi` — it's required for TypeORM to correctly route to the target database.

### What it does

1. Creates admin users (`robert.field+plasmicadmin@elasticpath.com`, `it@elasticpath.com`)
2. Creates Starter and Enterprise feature tiers
3. Seeds Plume and Plexus system packages
4. Creates a hostless workspace with all 69 hostless projects
5. Remaps the devflags template with new project IDs and saves to `dev_flag_overrides`

### After bootstrap

Run the **Publish Hostless Packages** GitHub Actions workflow targeting the new environment. This updates all hostless packages to their latest versions.

### Known warnings

**"Encountered likely duplicate host version: X vs X"** — Expected and harmless. Indicates `@plasmicapp/host` was already loaded by a previous package. Only a concern if the two version numbers differ.

## Verification

```sql
-- Hostless workspace ID is set
SELECT data::jsonb->'hostLessWorkspaceId' FROM dev_flag_overrides ORDER BY "createdAt" DESC LIMIT 1;

-- Hostless projects exist (expect 69)
SELECT COUNT(*) FROM project WHERE "workspaceId" = '<hostless-workspace-id>';

-- Plexus project ID is not a placeholder
SELECT data::jsonb->'installables'->0->'projectId' FROM dev_flag_overrides ORDER BY "createdAt" DESC LIMIT 1;
```
