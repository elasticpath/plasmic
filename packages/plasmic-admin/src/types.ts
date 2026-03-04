/**
 * Type definitions for the Plasmic Admin Client SDK.
 *
 * These types mirror the Plasmic server API responses. They are intentionally
 * standalone (no WAB imports) so the SDK can be used in any browser or Node
 * environment without pulling in platform internals.
 */

// ---------------------------------------------------------------------------
// Base types
// ---------------------------------------------------------------------------

export type GrantableAccessLevel = "owner" | "editor" | "commenter" | "viewer";

export interface ApiEntityBase {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdById: string | null;
  updatedById: string | null;
  deletedById: string | null;
}

// ---------------------------------------------------------------------------
// User & Team
// ---------------------------------------------------------------------------

export interface ApiUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface ApiFeatureTier {
  id: string;
  name: string;
}

export interface ApiTeam extends ApiEntityBase {
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

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ApiProject extends ApiEntityBase {
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

export interface ApiProjectRevision {
  id: string;
  projectId: string;
  revision: number;
  data?: string;
  branchId: string | null;
  createdBy: ApiUser | null;
  createdAt: string;
}

export interface ApiPermission {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  teamId: string | null;
  userId: string | null;
  email: string | null;
  accessLevel: GrantableAccessLevel;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface ApiWorkspace extends ApiEntityBase {
  name: string;
  description: string;
  team: ApiTeam;
  uiConfig: Record<string, unknown> | null;
  contentCreatorConfig: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface CreateProjectRequest {
  name?: string;
  workspaceId?: string;
  isPublic?: boolean;
}

export interface UpdateProjectRequest {
  name?: string;
  workspaceId?: string;
  inviteOnly?: boolean;
  defaultAccessLevel?: GrantableAccessLevel;
  readableByPublic?: boolean;
  isUserStarter?: boolean;
  regenerateSecretApiToken?: boolean;
}

export interface UpdateProjectMetaRequest {
  name?: string;
  hostUrl?: string;
  workspaceId?: string;
  uiConfig?: Record<string, unknown>;
}

export interface CloneProjectRequest {
  name?: string;
  workspaceId?: string;
  branchName?: string;
}

export interface CreateWorkspaceRequest {
  name?: string;
  description?: string;
  teamId: string;
  contentCreatorConfig?: Record<string, unknown>;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
  teamId?: string;
  contentCreatorConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ListProjectsResponse {
  projects: ApiProject[];
  perms: ApiPermission[];
}

export interface GetProjectResponse {
  project: ApiProject;
  rev: ApiProjectRevision;
  perms: ApiPermission[];
  owner: ApiUser | undefined;
  latestRevisionSynced: number;
  modelVersion: number;
  hasAppAuth: boolean;
  isMainBranchProtected: boolean;
}

export interface CreateProjectResponse {
  project: ApiProject;
  rev: Omit<ApiProjectRevision, "data">;
}

export interface UpdateProjectResponse {
  paywall: "pass" | "block";
  project?: ApiProject;
  perms?: ApiPermission[];
  owner?: ApiUser;
  regeneratedSecretApiToken?: string;
}

export interface CloneProjectResponse {
  projectId: string;
  workspaceId: string;
}

export interface DeleteResponse {
  deletedId: string;
}

export interface ListWorkspacesResponse {
  teams: ApiTeam[];
  workspaces: ApiWorkspace[];
}

export interface GetWorkspaceResponse {
  workspace: ApiWorkspace;
  perms: ApiPermission[];
}

export interface CreateWorkspaceResponse {
  paywall: "pass" | "block";
  workspace?: ApiWorkspace;
}

// ---------------------------------------------------------------------------
// Admin response types
// ---------------------------------------------------------------------------

export interface AdminProjectsResponse {
  projects: ApiProject[];
}

export interface AdminCloneResponse {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type ApiErrorType =
  | "UnauthorizedError"
  | "ForbiddenError"
  | "NotFoundError"
  | "BadRequestError"
  | "ProjectRevisionError"
  | "PaywallError";

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface PlasmicAdminClientConfig {
  /** Base URL of the Plasmic server, e.g. "https://studio.plasmic.app" */
  baseUrl: string;

  /**
   * Custom fetch implementation. Defaults to globalThis.fetch.
   * Useful for testing or environments without native fetch.
   */
  fetch?: typeof globalThis.fetch;
}
