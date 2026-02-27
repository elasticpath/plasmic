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
 * Serialized global context metadata — mirrors GlobalContextMeta minus
 * `component` ref and function callbacks in props/globalActions.
 *
 * Why: GlobalContextMeta.props may contain callback functions (hidden,
 * validator, control, options, defaultValueHint, readOnly, onSearch).
 * globalActions entries have parameters arrays containing FunctionParam
 * which may have function fields. JSON roundtrip strips all of these.
 */
export interface SerializedContextMeta {
  name: string;
  displayName?: string;
  description?: string;
  importName?: string;
  importPath?: string;
  isDefaultExport?: boolean;
  refProp?: string;
  providesData?: boolean;
  /** Prop type descriptors with function callbacks stripped. */
  props?: Record<string, unknown>;
  /** Global actions with function-bearing parameter types stripped. */
  globalActions?: Record<string, unknown>;
  /** Any additional JSON-safe fields are preserved. */
  [key: string]: unknown;
}

/**
 * Serialized custom function metadata — mirrors CustomFunctionMeta minus
 * `function` ref and `fnContext` callback.
 *
 * Why: The `function` ref is at the entry level (not meta level), handled
 * by the reader. `fnContext` is a callback returning { dataKey, fetcher }.
 * params array entries may have function fields (control, hidden) —
 * JSON roundtrip handles these.
 */
export interface SerializedFunctionMeta {
  name: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  typescriptDeclaration?: string;
  isQuery?: boolean;
  importPath?: string;
  isDefaultExport?: boolean;
  params?: Array<Record<string, unknown>>;
  returnValue?: Record<string, unknown>;
  /** Any additional JSON-safe fields are preserved. */
  [key: string]: unknown;
}

/**
 * Token registration — matches @plasmicapp/host registerToken's TokenRegistration.
 *
 * Tokens are fully serializable (no stripping needed). Entries are stored
 * DIRECTLY in the global array (no { meta } wrapper).
 */
export type TokenType =
  | "color"
  | "spacing"
  | "font-family"
  | "font-size"
  | "line-height"
  | "opacity";

export interface TokenRegistration {
  name: string;
  value: string;
  type: TokenType;
  displayName?: string;
  selector?: string;
}

/**
 * Trait registration — matches @plasmicapp/host registerTrait's TraitRegistration.
 *
 * Traits are fully serializable (no stripping needed). Entries have shape
 * { trait: string, meta: TraitMeta }.
 */
export interface BasicTrait {
  label?: string;
  type: "text" | "number" | "boolean";
}

export interface ChoiceTrait {
  label?: string;
  type: "choice";
  options: string[];
}

export type TraitMeta = BasicTrait | ChoiceTrait;

export interface TraitRegistration {
  trait: string;
  meta: TraitMeta;
}

/**
 * Full registry response — all five registries in one shape.
 * Supersedes RegistryResponse (which only had components).
 */
export interface FullRegistryResponse {
  components: SerializedComponentMeta[];
  contexts: SerializedContextMeta[];
  functions: SerializedFunctionMeta[];
  tokens: TokenRegistration[];
  traits: TraitRegistration[];
}

/**
 * @deprecated Use FullRegistryResponse instead. Kept for backward compatibility.
 */
export interface RegistryResponse {
  components: SerializedComponentMeta[];
}
