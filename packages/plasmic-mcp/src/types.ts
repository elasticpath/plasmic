/**
 * Type definitions for the Plasmic MCP server.
 *
 * AuthConfig and API types mirror the patterns in packages/cli/src/api.ts
 * and packages/cli/src/utils/auth-utils.ts. PlasmicElement types are from
 * packages/host/src/element-types.ts (the canonical source for create-page).
 * TreeNode is our own output format for the custom Tpl model walker.
 */

// --- Auth ---

export interface AuthConfig {
  host: string;
  user: string;
  token: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
}

// --- API response types ---

export interface ApiProject {
  id: string;
  name: string;
  hostUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiPermission {
  id: string;
  projectId: string;
  userId: string;
  accessLevel: string;
}

export interface DepPkgInfo {
  id: string;
  pkgId: string;
  version: string;
  model: string; // JSON-stringified Bundle (or already-parsed Bundle object)
}

export interface ProjectBundleResponse {
  rev: {
    data: string; // JSON-stringified Bundle
    revision: number;
  };
  project: {
    id: string;
    name: string;
    hostUrl?: string;
  };
  depPkgs: DepPkgInfo[];
  // M2: needed for incremental saves (populated from server response)
  modelVersion?: number;
  hostlessDataVersion?: number;
}

export interface ListProjectsResponse {
  projects: ApiProject[];
  perms: ApiPermission[];
}

// --- API request types ---

export interface NewComponentReq {
  name?: string;
  path?: string;
  body?: PlasmicElement;
  byUuid?: string;
  cloneFrom?: { uuid: string } | { name: string };
}

export interface UpdateProjectReq {
  newComponents?: NewComponentReq[];
  updateComponents?: NewComponentReq[];
  branchId?: string;
}

// --- API response for updateProject ---
// The server returns { result: { newComponents: [{ uuid, name, path }] } }
// when creating new components or pages.

export interface NewComponentResult {
  uuid: string;
  name: string;
  path?: string;
}

export interface UpdateProjectResponse {
  result?: {
    newComponents?: NewComponentResult[];
  };
}

// --- PlasmicElement types (for create-page body) ---
// Mirrors packages/host/src/element-types.ts

export type PlasmicElement =
  | string
  | ContainerElement
  | TextElement
  | ImageElement
  | ButtonElement
  | InputElement
  | ComponentElement
  | DefaultComponentElement;

export interface ContainerElement {
  type: "box" | "vbox" | "hbox" | "page-section";
  tag?: string;
  styles?: Record<string, string>;
  children?: PlasmicElement | PlasmicElement[];
  attrs?: Record<string, unknown>;
}

export interface TextElement {
  type: "text";
  value: string;
  tag?: string;
  styles?: Record<string, string>;
  attrs?: Record<string, unknown>;
}

export interface ImageElement {
  type: "img";
  src: string;
  styles?: Record<string, string>;
  attrs?: Record<string, unknown>;
}

export interface ButtonElement {
  type: "button";
  value?: string;
  styles?: Record<string, string>;
  attrs?: Record<string, unknown>;
}

export interface InputElement {
  type: "input" | "password" | "textarea";
  styles?: Record<string, string>;
  attrs?: Record<string, unknown>;
}

export interface ComponentElement {
  type: "component";
  name: string;
  props?: Record<string, unknown>;
  styles?: Record<string, string>;
  children?: PlasmicElement | PlasmicElement[];
}

export interface DefaultComponentElement {
  type: "default-component";
  kind: string;
  props?: Record<string, unknown>;
  styles?: Record<string, string>;
  children?: PlasmicElement | PlasmicElement[];
}

// --- Package management API types ---

export interface PkgInfo {
  id: string;
  name: string;
  projectId: string;
}

export interface PkgVersionInfoMeta {
  id: string;
  pkgId: string;
  version: string;
  tags?: string[];
  description?: string;
  revisionId?: string;
  pkg?: PkgInfo | null;
  hostUrl?: string | null;
  branchId?: string | null;
}

export interface PkgVersionInfo extends PkgVersionInfoMeta {
  model: string; // JSON-stringified Bundle
}

export interface GetPkgByProjectIdResponse {
  pkg: PkgInfo | undefined;
}

export interface GetPkgVersionResponse {
  pkg: PkgVersionInfo;
  depPkgs: PkgVersionInfo[];
}

export interface GetPkgVersionMetaResponse {
  pkg: PkgVersionInfoMeta;
  depPkgs: PkgVersionInfoMeta[];
}

export interface AppAuthPubConfig {
  allowed: boolean;
  appName: string;
  authScreenProperties: Record<string, unknown> | null;
  isAuthEnabled: boolean;
}

// --- App Config / Package Discovery types ---

export interface HostLessComponentInfo {
  type: "hostless-component";
  componentName: string;
  displayName: string;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
  hidden?: boolean;
  isFake?: boolean;
  isCustomFunction?: boolean;
  hiddenOnStore?: boolean;
  onlyShownIn?: "old" | "new";
}

export interface HostLessPackageInfo {
  type: "hostless-package";
  name: string;
  sectionLabel: string;
  projectId: string | string[];
  items: HostLessComponentInfo[];
  codeName?: string;
  codeLink?: string;
  imageUrl?: string;
  hidden?: boolean;
  showInstall?: boolean;
  hiddenWhenInstalled?: boolean;
  isInstallOnly?: boolean;
  whitelistDomains?: string[];
  whitelistTeams?: string[];
  onlyShownIn?: "old" | "new";
}

export interface AppConfigResponse {
  config: {
    hostLessComponents?: HostLessPackageInfo[];
    [key: string]: unknown;
  };
}

export interface AvailablePackage {
  name: string;
  projectId: string | string[];
  sectionLabel: string;
  isInstalled: boolean;
  items: Array<{
    componentName: string;
    displayName: string;
    description?: string;
    imageUrl?: string;
  }>;
  codeName?: string;
  codeLink?: string;
  imageUrl?: string;
}

export interface PackageComponent {
  packageName: string;
  packageProjectId: string;
  name: string;
  displayName: string;
}

// --- Model updates response (P0.3: incremental updates from server) ---

/** Incremental update available — apply partial bundle to local model. */
export interface ModelUpdateIncremental {
  data: string; // JSON-stringified partial Bundle
  needsReload?: never;
  revision: number;
  depPkgs: Array<{ model: string; id: string }>;
  deletedIids: string[];
  modifiedComponentIids: string[];
}

/** Full reload required — model diverged beyond incremental reconciliation. */
export interface ModelUpdateNeedsReload {
  data?: never;
  needsReload: true;
}

/** No changes — already at latest revision. */
export interface ModelUpdateNoChanges {
  data: null;
  needsReload?: never;
}

/** Discriminated union for GET /projects/{id}/updates response. */
export type GetModelUpdatesResponse =
  | ModelUpdateIncremental
  | ModelUpdateNeedsReload
  | ModelUpdateNoChanges;

// --- Save revision request (M2: incremental writes) ---

export interface SaveRevisionReq {
  data: string;
  modelVersion: number;
  hostlessDataVersion: number;
  incremental: boolean;
  toDeleteIids: string[];
  modifiedComponentIids: string[];
  modelSchemaHash: string;
}

// --- Token output ---
// Produced by the get-tokens tool when reading site.styleTokens.

export type StyleTokenType =
  | "Color"
  | "Spacing"
  | "Opacity"
  | "LineHeight"
  | "FontFamily"
  | "FontSize";

export interface TokenInfo {
  uuid: string;
  name: string;
  type: StyleTokenType;
  value: string;
  /** Resolved CSS value when the raw value is a token reference (var(--token-<uuid>)). */
  resolvedValue?: string;
}

// --- Page metadata output ---
// Produced by the get-page-meta tool when reading component.pageMeta fields.

export interface PageMetaInfo {
  name: string;
  uuid: string;
  path: string;
  title: string | null;
  description: string | null;
  openGraphImage: string | null;
  canonical: string | null;
  params: Record<string, string>;
  query: Record<string, string>;
  roleId: string | null;
}

// --- Tree reader output ---
// Produced by tree-reader.ts when walking the in-memory Tpl model.
// Designed to give Claude full fidelity: tags, styles, text, images, layout, children.

export interface TreeNode {
  type: "tag" | "component" | "slot";
  tag?: string;
  nodeType?: string;
  name?: string;
  uuid?: string;
  styles?: Record<string, string>;
  /** Maps CSS property names to token names when the value is a token reference. */
  tokenRefs?: Record<string, string>;
  text?: string;
  /** Inline formatting marks on the text (bold, italic, link, etc.). Only present when RawText has markers. */
  marks?: TreeNodeMark[];
  /** True when text is a dynamic expression (ExprText), not static RawText. */
  dynamic?: boolean;
  /** Fallback value for dynamic expressions (shown when expression evaluates to null/undefined). */
  fallback?: string;
  attrs?: Record<string, unknown>;
  layoutType?: "vbox" | "hbox" | "box";
  /** Semantic layout hint: flex-row, flex-col, grid, or block. More descriptive than layoutType for LLM reasoning. */
  layoutHint?: "flex-row" | "flex-col" | "grid" | "block";
  /** Element visibility state. Only present when element is not in default visible state. */
  visibility?: "notRendered" | "displayNone";
  /** Data condition expression for conditional rendering. Only present when a custom condition is set. */
  dataCond?: string;
  /** Data repetition config. Only present when element repeats over a collection. */
  dataRep?: {
    collection: string;
    elementVariable: string;
    indexVariable?: string;
  };
  children?: TreeNode[];
  /** Number of immediate children. Present in summary mode and when depth-truncated. */
  childCount?: number;
  componentName?: string;
  componentUuid?: string;
  slotName?: string;
}

// --- Rich text mark (in tree output) ---
// Represents an inline formatting mark on text content.
// Positions are in the user-visible text coordinate system (not WAB internal).

export interface TreeNodeMark {
  start: number;
  end: number;
  type: "bold" | "italic" | "underline" | "strikethrough" | "link" | "code";
  href?: string;
}

// --- Tree reader options ---
// Controls how much detail the tree reader returns. All fields optional for
// backward compatibility — omitting all options produces the full tree.

export interface TreeReadOptions {
  /** Stop recursing after this many levels (0 = root only, 1 = root + children, etc.). */
  maxDepth?: number;
  /** Strip CSS styles from output to reduce size. */
  excludeStyles?: boolean;
  /** Compact mode: type/tag/name/uuid/childCount only — no styles, attrs, or text. */
  summaryOnly?: boolean;
  /** Style tokens for resolving var(--token-<uuid>) references in styles to display token names. */
  styleTokens?: any[];
}
