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

export interface ProjectBundleResponse {
  rev: {
    data: string; // JSON-stringified Bundle
    revision: number;
  };
  project: {
    id: string;
    name: string;
  };
}

export interface ListProjectsResponse {
  projects: ApiProject[];
  perms: ApiPermission[];
}

// --- API request types ---

export interface NewComponentReq {
  name?: string;
  path?: string;
  body: PlasmicElement;
  byUuid?: string;
  cloneFrom?: string;
}

export interface UpdateProjectReq {
  newComponents?: NewComponentReq[];
  updateComponents?: NewComponentReq[];
  branchId?: string;
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
}

export interface DefaultComponentElement {
  type: "default-component";
  kind: string;
  props?: Record<string, unknown>;
  styles?: Record<string, string>;
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
  text?: string;
  attrs?: Record<string, unknown>;
  layoutType?: "vbox" | "hbox" | "box";
  children?: TreeNode[];
  componentName?: string;
  componentUuid?: string;
  slotName?: string;
}
