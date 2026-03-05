# New Environment Checklist

Step-by-step guide for bootstrapping a new Plasmic production environment (e.g., `prod-eu`).

Infrastructure is automated via Terraform in `plasmic-terraservices`. This checklist covers the **manual application-level steps**.

---

## Pre-flight

- [ ] Terraform for all 12 projects applied successfully
- [ ] All 8 services have environment-specific `.tfvars` configs
- [ ] AWS Secrets Manager populated:
  - `db-password` (RDS master password)
  - `session-secret` (Express session secret)
  - `database-uri` (full PostgreSQL connection string)
- [ ] ECR repository has WAB Docker image
- [ ] `canvas-packages/build-server/` is built and included in Docker image

## Database Bootstrap

- [ ] RDS PostgreSQL 15 is running and accessible
- [ ] DB users created:
  ```sql
  CREATE USER wab WITH PASSWORD '...';
  CREATE USER superwab WITH PASSWORD '...' CREATEDB CREATEROLE;
  GRANT ALL PRIVILEGES ON DATABASE wab TO superwab;
  ```
- [ ] `uuid-ossp` extension installed:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  ```
- [ ] WAB service deployed (runs `maybeMigrateDatabase()` on first boot — executes all TypeORM migrations)
- [ ] Run bootstrap script:
  ```bash
  cd platform/wab
  ADMIN_PASSWORD=<strong-password> yarn bootstrap:prod --dburi postgresql://wab:<password>@<rds-host>:5432/wab
  ```

### Known warnings during bootstrap

**"Encountered likely duplicate host version: X vs X"** — This is expected and harmless.
The `@plasmicapp/host` package sets `globalThis.__Sub` on first load. Each subsequent
hostless package load sees `__Sub` already exists and logs this warning. As long as the
two version numbers match (e.g., `1.0.233 vs 1.0.233`), there is no conflict — the
component registrations still work correctly. This is most visible on commerce-dependent
packages which load two server packages (the `commerce` base + the provider). If you ever
see **mismatched** versions in this warning, that indicates a real problem — the
`@plasmicapp/host` dependency is out of sync between packages.

## Hostless Publishing

- [ ] Verify `hostLessWorkspaceId` is set:
  ```sql
  SELECT data::jsonb->'hostLessWorkspaceId' FROM dev_flag_overrides ORDER BY "createdAt" DESC LIMIT 1;
  ```
- [ ] Verify hostless projects exist:
  ```sql
  SELECT COUNT(*) FROM project WHERE "workspaceId" = '<hostless-workspace-id>';
  -- Expected: 70+
  ```
- [ ] Run `Publish Hostless Packages` GitHub Actions workflow targeting the new environment
- [ ] Verify in CloudWatch logs: `/ecs/plasmic-<env>-publish-hostless`

## Service Deployment

All services are deployed via Terraform + GitLab pipeline:

- [ ] WAB (catch-all ALB route, port 3004)
- [ ] socket-backend (WebSocket, port 3020)
- [ ] codegen
- [ ] data
- [ ] loader
- [ ] loader-html
- [ ] img-optimizer
- [ ] copilot (requires OpenAI/Anthropic API keys in Secrets Manager)

## Frontend Deployment

- [ ] Run `Deploy Frontend` workflow targeting the new environment
- [ ] Verify CloudFront invalidation completed

## GitHub Actions Environment

- [ ] Create GitHub environment (e.g., `prod-eu`) with these secrets/variables:

| Type | Name | Example |
|------|------|---------|
| Secret | `AWS_ROLE_ARN` | `arn:aws:iam::role/github-actions-plasmic` |
| Secret | `GITLAB_API_TOKEN` | GitLab personal access token |
| Secret | `GITLAB_PROJECT_ID` | GitLab project ID |
| Variable | `AWS_REGION` | `eu-west-2` |
| Variable | `ENVIRONMENT` | `prod-eu` |
| Variable | `ECR_REPOSITORY` | `plasmic/wab` |
| Variable | `FRONTEND_URL` | `https://studio.eu.example.com` |
| Variable | `HOST_URL` | `https://host.eu.example.com` |
| Variable | `FRONTEND_CF_ID` | CloudFront distribution ID |
| Variable | `HOST_CF_ID` | CloudFront distribution ID |
| Variable | `FRONTEND_BUCKET` | S3 bucket name |
| Variable | `HOST_BUCKET` | S3 bucket name |
| Variable | `PRIVATE_SUBNET_IDS` | Comma-separated subnet IDs |
| Variable | `ECS_SECURITY_GROUP_ID` | Security group ID |

## Smoke Test

- [ ] `/api/v1/healthcheck` returns 200
- [ ] Studio loads (React frontend renders)
- [ ] Admin can log in with configured credentials
- [ ] Can create a new project
- [ ] Component Store shows hostless packages
- [ ] Plexus components appear in insert panel
- [ ] WebSocket connection established (real-time collaboration)
- [ ] Can publish a project
- [ ] `host.html` loads correctly
