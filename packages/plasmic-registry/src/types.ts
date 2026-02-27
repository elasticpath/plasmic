/**
 * Serialized component metadata — all JSON-safe fields from CodeComponentMeta.
 *
 * Non-serializable fields (functions, React elements) are stripped during
 * serialization. Consumers receive the full declarative metadata and extract
 * only what they need (e.g., the MCP server extracts only `variants`).
 */
export interface SerializedComponentMeta {
  name: string;
  displayName?: string;
  description?: string;
  section?: string;
  thumbnailUrl?: string;
  importName?: string;
  importPath?: string;
  isDefaultExport?: boolean;
  classNameProp?: string;
  refProp?: string;
  defaultStyles?: Record<string, string>;
  parentComponentName?: string;
  isAttachment?: boolean;
  providesData?: boolean;
  alwaysAutoName?: boolean;
  hideFromContentCreators?: boolean;
  defaultDisplay?: string;
  trapsFocus?: boolean;
  isRepeatable?: boolean;
  styleSections?: boolean | Array<{ section: string; expanded?: boolean }>;
  variants?: Record<string, { cssSelector: string; displayName: string }>;
  figmaMappings?: Array<{ figmaComponentName: string }>;
  /** Prop type descriptors with functions stripped — only declarative parts remain. */
  props?: Record<string, unknown>;
  /** State specs with functions stripped — only type/access descriptors remain. */
  states?: Record<string, unknown>;
  /** Any additional JSON-safe fields from CodeComponentMeta are preserved. */
  [key: string]: unknown;
}

/**
 * Response shape from the /api/plasmic-registry endpoint.
 */
export interface RegistryResponse {
  components: SerializedComponentMeta[];
}
