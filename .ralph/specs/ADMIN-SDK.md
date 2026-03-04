# Standalone Plasmic Admin Client - SDK Specification

## Overview

This document specifies what a standalone HTTP client SDK needs to implement for interacting with Plasmic's admin API endpoints. The target is a browser-based TypeScript client using session/cookie authentication with the native `fetch()` API.

**Scope:**
- Project CRUD operations
- Project admin operations (clone, delete, restore, change owner, revert)
- Workspace CRUD operations
- Session-based authentication

**Out of scope:**
- Studio/editor interactions
- Real-time WebSocket operations
- Bundle manipulation

## Authentication Flow (Session/Cookie)

Your client needs to implement a 3-step authentication flow:

### Step 1: Get CSRF Token
```
GET /api/v1/auth/csrf
Response: { "csrf": "<token>" }
```

### Step 2: Login
```
POST /api/v1/auth/login
Headers:
  Content-Type: application/json
  X-CSRF-Token: <csrf-token>
Body: { "email": "...", "password": "..." }
```
- Store the `connect.sid` cookie from the response
- Refresh CSRF token after login

### Step 3: Authenticated Requests
```
All subsequent requests need:
  Cookie: connect.sid=<session-id>
  X-CSRF-Token: <csrf-token>
  Content-Type: application/json
```

### Logout
```
POST /api/v1/auth/logout
```
- Clears session and related cookies

---

## API Endpoints

### Project CRUD

| Operation | Method | Path | Body/Params |
|-----------|--------|------|-------------|
| List all | GET | `/api/v1/projects?query=all` | - |
| List by workspace | GET | `/api/v1/projects?query=byWorkspace&workspaceId=<id>` | - |
| Get project | GET | `/api/v1/projects/:projectId` | - |
| Get metadata only | GET | `/api/v1/projects/:projectId/meta` | - |
| Create | POST | `/api/v1/projects` | `{ name?, workspaceId?, isPublic? }` |
| Update | PUT | `/api/v1/projects/:projectId` | `{ name?, workspaceId?, inviteOnly?, defaultAccessLevel?, readableByPublic? }` |
| Update metadata | PUT | `/api/v1/projects/:projectId/meta` | `{ name?, hostUrl?, workspaceId?, uiConfig? }` |
| Delete | DELETE | `/api/v1/projects/:projectId` | - |
| Clone | POST | `/api/v1/projects/:projectId/clone` | `{ name?, workspaceId?, branchName? }` |

### Project Admin Operations

**Note:** Admin endpoints require user email to be in `config.adminEmails` list on the server.

| Operation | Method | Path | Body |
|-----------|--------|------|------|
| List all projects | POST | `/api/v1/admin/projects` | `{ ownerId?: string }` |
| Clone project | POST | `/api/v1/admin/clone` | `{ projectId, revisionNum? }` |
| Delete project | POST | `/api/v1/admin/delete-project` | `{ id: string }` |
| Hard delete | DELETE | `/api/v1/admin/delete-project-and-revisions` | `{ projectId: string }` |
| Restore project | POST | `/api/v1/admin/restore-project` | `{ id: string }` |
| Change owner | POST | `/api/v1/admin/change-project-owner` | `{ projectId, ownerEmail }` |
| Revert revision | POST | `/api/v1/admin/revert-project-revision` | `{ projectId, revision: number }` |
| Get revision | GET | `/api/v1/admin/project/:projectId/rev?branchId=` | - |
| Save revision | POST | `/api/v1/admin/project/:projectId/rev` | `{ branchId, revision, data }` |

**CSRF-exempt admin routes** (no X-CSRF-Token needed):
- `/api/v1/admin/delete-project`
- `/api/v1/admin/restore-project`
- `/api/v1/admin/clone`
- `/api/v1/admin/revert-project-revision`

### Workspace CRUD

| Operation | Method | Path | Body/Params |
|-----------|--------|------|-------------|
| List all | GET | `/api/v1/workspaces` | - |
| Get workspace | GET | `/api/v1/workspaces/:workspaceId` | - |
| Get personal | GET | `/api/v1/personal-workspace` | - |
| Create | POST | `/api/v1/workspaces` | `{ name?, description?, teamId }` |
| Update | PUT | `/api/v1/workspaces/:workspaceId` | `{ name?, description?, teamId? }` |
| Delete | DELETE | `/api/v1/workspaces/:workspaceId` | - |

### Supporting Endpoints (likely needed)

| Operation | Method | Path |
|-----------|--------|------|
| Get current user | GET | `/api/v1/auth/self` |
| List teams | GET | `/api/v1/teams` |
| Get team | GET | `/api/v1/teams/:teamId` |

---

## TypeScript Type Definitions

```typescript
// ============================================
// Base Types
// ============================================

type GrantableAccessLevel = "owner" | "editor" | "commenter" | "viewer";

interface ApiEntityBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdById: string | null;
  updatedById: string | null;
  deletedById: string | null;
}

// ============================================
// User & Team Types
// ============================================

interface ApiUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

interface ApiTeam extends ApiEntityBase {
  name: string;
  billingEmail: string | null;
  seats: number | null;
  featureTierId: string | null;
  featureTier: ApiFeatureTier | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  personalTeamOwnerId: string | null;
  trialStartDate: string | null;
}

interface ApiFeatureTier {
  id: string;
  name: string;
  // ... tier limits and features
}

// ============================================
// Project Types
// ============================================

interface ApiProject extends ApiEntityBase {
  id: string;
  name: string;
  workspaceId: string | null;
  teamId: string | null;
  hostUrl: string | null;
  clonedFromProjectId: string | null;
  projectApiToken: string | null;
  secretApiToken: string | null;
  readableByPublic: boolean;
  inviteOnly: boolean;
  defaultAccessLevel: GrantableAccessLevel;
  isUserStarter: boolean;
}

interface ApiProjectRevision {
  id: string;
  projectId: string;
  revision: number;
  data?: string;  // JSON bundle - only included in full fetch
  branchId: string | null;
  createdBy: ApiUser | null;
  createdAt: string;
}

interface ApiPermission {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  teamId: string | null;
  userId: string | null;
  email: string | null;
  accessLevel: GrantableAccessLevel;
}

// ============================================
// Workspace Types
// ============================================

interface ApiWorkspace extends ApiEntityBase {
  id: string;
  name: string;
  description: string;
  team: ApiTeam;
  uiConfig: Record<string, unknown> | null;
  contentCreatorConfig: Record<string, unknown> | null;
}

// ============================================
// Request Types
// ============================================

interface CreateProjectRequest {
  name?: string;
  workspaceId?: string;
  isPublic?: boolean;
}

interface UpdateProjectRequest {
  name?: string;
  workspaceId?: string;
  inviteOnly?: boolean;
  defaultAccessLevel?: GrantableAccessLevel;
  readableByPublic?: boolean;
  isUserStarter?: boolean;
  regenerateSecretApiToken?: boolean;
}

interface UpdateProjectMetaRequest {
  name?: string;
  hostUrl?: string;
  workspaceId?: string;
  uiConfig?: Record<string, unknown>;
}

interface CloneProjectRequest {
  name?: string;
  workspaceId?: string;
  branchName?: string;
}

interface CreateWorkspaceRequest {
  name?: string;
  description?: string;
  teamId: string;  // Required
  contentCreatorConfig?: Record<string, unknown>;
}

interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
  teamId?: string;
  contentCreatorConfig?: Record<string, unknown>;
}

// ============================================
// Response Types
// ============================================

interface ListProjectsResponse {
  projects: ApiProject[];
  perms: ApiPermission[];
}

interface GetProjectResponse {
  project: ApiProject;
  rev: ApiProjectRevision;
  perms: ApiPermission[];
  owner: ApiUser | undefined;
  latestRevisionSynced: number;
  modelVersion: number;
  hasAppAuth: boolean;
  isMainBranchProtected: boolean;
}

interface CreateProjectResponse {
  project: ApiProject;
  rev: Omit<ApiProjectRevision, "data">;
}

interface UpdateProjectResponse {
  paywall: "pass" | "block";
  project?: ApiProject;
  perms?: ApiPermission[];
  owner?: ApiUser;
  regeneratedSecretApiToken?: string;
}

interface CloneProjectResponse {
  projectId: string;
  workspaceId: string;
}

interface DeleteResponse {
  deletedId: string;
}

interface ListWorkspacesResponse {
  teams: ApiTeam[];
  workspaces: ApiWorkspace[];
}

interface GetWorkspaceResponse {
  workspace: ApiWorkspace;
  perms: ApiPermission[];
}

interface CreateWorkspaceResponse {
  paywall: "pass" | "block";
  workspace?: ApiWorkspace;
}

// Admin responses
interface AdminCloneResponse {
  projectId: string;
}

interface AdminProjectsResponse {
  projects: ApiProject[];
}

// ============================================
// Error Types
// ============================================

interface ApiError {
  type: string;
  message: string;
  statusCode: number;
}

// Specific error types you may encounter
type ApiErrorType =
  | "UnauthorizedError"      // 401
  | "ForbiddenError"         // 403
  | "NotFoundError"          // 404
  | "BadRequestError"        // 400
  | "ProjectRevisionError"   // 412
  | "PaywallError";          // 402
```

---

## Error Handling

The API returns JSON error responses:

```typescript
interface ApiError {
  type: string;       // Error class name
  message: string;
  statusCode: number;
}
```

Common status codes:
- 400 - Bad request (invalid params)
- 401 - Unauthorized (not logged in)
- 403 - Forbidden (not admin, no permission)
- 404 - Not found
- 412 - Precondition failed (revision conflict)

---

## SDK Interface Specification

The SDK should expose the following public interface:

```typescript
interface PlasmicAdminClient {
  // Auth
  refreshCsrf(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<ApiUser>;

  // Projects
  listProjects(query?: "all" | { workspaceId: string }): Promise<ListProjectsResponse>;
  getProject(projectId: string): Promise<GetProjectResponse>;
  getProjectMeta(projectId: string): Promise<ApiProject>;
  createProject(opts: CreateProjectRequest): Promise<CreateProjectResponse>;
  updateProject(projectId: string, updates: UpdateProjectRequest): Promise<UpdateProjectResponse>;
  updateProjectMeta(projectId: string, updates: UpdateProjectMetaRequest): Promise<ApiProject>;
  deleteProject(projectId: string): Promise<DeleteResponse>;
  cloneProject(projectId: string, opts?: CloneProjectRequest): Promise<CloneProjectResponse>;

  // Admin Project Ops
  adminListProjects(ownerId?: string): Promise<AdminProjectsResponse>;
  adminCloneProject(projectId: string, revisionNum?: number): Promise<AdminCloneResponse>;
  adminDeleteProject(projectId: string): Promise<void>;
  adminHardDeleteProject(projectId: string): Promise<void>;
  adminRestoreProject(projectId: string): Promise<void>;
  adminChangeProjectOwner(projectId: string, ownerEmail: string): Promise<void>;
  adminRevertRevision(projectId: string, revision: number): Promise<AdminCloneResponse>;

  // Workspaces
  listWorkspaces(): Promise<ListWorkspacesResponse>;
  getWorkspace(workspaceId: string): Promise<GetWorkspaceResponse>;
  getPersonalWorkspace(): Promise<GetWorkspaceResponse>;
  createWorkspace(opts: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse>;
  updateWorkspace(workspaceId: string, updates: UpdateWorkspaceRequest): Promise<CreateWorkspaceResponse>;
  deleteWorkspace(workspaceId: string): Promise<DeleteResponse>;
}
```

---

## Browser Fetch Pattern

All requests should follow this pattern:

```typescript
// Internal request helper pattern
async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${baseUrl}/api/v1${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Include CSRF token for non-exempt routes
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(url, {
    method,
    headers,
    credentials: "include",  // Critical for cookie auth
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new PlasmicApiError(error.type, error.message, response.status);
  }

  return response.json();
}
```

### Authentication Flow Example

```typescript
// 1. Fetch CSRF token
const { csrf } = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
  credentials: "include",
}).then(r => r.json());

// 2. Login
await fetch(`${baseUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrf,
  },
  credentials: "include",
  body: JSON.stringify({ email, password }),
});

// 3. Refresh CSRF after login (important!)
const { csrf: newCsrf } = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
  credentials: "include",
}).then(r => r.json());

// 4. Use newCsrf for subsequent requests
```

---

## Key Implementation Notes (Browser Environment)

1. **Cookie Management**: Use `credentials: 'include'` on all fetch requests - browser handles cookies automatically

2. **CSRF Token**: Must be refreshed after login and stored in memory, included in `X-CSRF-Token` header

3. **CORS**: If your app is on a different origin than Plasmic, you'll need CORS configured on the Plasmic server

4. **Admin Access**: Requires server-side configuration - the user's email must be in the `adminEmails` config array

5. **Base URL**: All paths are relative to `/api/v1/` (e.g., `https://your-plasmic-host/api/v1/projects`)

6. **Content-Type**: Always `application/json` for request bodies

7. **Query Parameters**: For GET requests with complex params, JSON-serialize them (the Plasmic API expects this for array/object query params)

---

## Verification

To test your client implementation:

1. Test auth flow: login, verify session persists, logout
2. Test CRUD: create project, list, update, delete
3. Test admin ops: clone, restore (requires admin email configured)
4. Test workspaces: create in team, move project between workspaces