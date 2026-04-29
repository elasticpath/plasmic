/**
 * EPSearchBox — debounced search input for catalog search.
 *
 * Wraps `useSearchBox()` from react-instantsearch. At design time, renders
 * a static input with mock placeholder for visual editing.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Registerable } from "../registerable";

type PreviewState = "auto" | "withData";

const DEFAULT_SEARCH_BOX_WRAPPER_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  display: "flex",
  alignItems: "center",
};

const DEFAULT_SEARCH_BOX_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  height: "44px",
  padding: "0 44px 0 16px",
  border: "1px solid #e7e5e4",
  borderRadius: "8px",
  backgroundColor: "#ffffff",
  fontSize: "14px",
  color: "#1c1917",
  outline: "none",
  fontFamily: "inherit",
};

const DEFAULT_SEARCH_BOX_CLEAR_BUTTON_STYLE: React.CSSProperties = {
  position: "absolute",
  right: "8px",
  top: "50%",
  transform: "translateY(-50%)",
  width: "28px",
  height: "28px",
  border: "none",
  borderRadius: "6px",
  backgroundColor: "transparent",
  color: "#a8a29e",
  cursor: "pointer",
  fontSize: "18px",
  lineHeight: "1",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

interface EPSearchBoxProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  showClear?: boolean;
  previewState?: PreviewState;
}

export const epSearchBoxMeta: CodeComponentMeta<EPSearchBoxProps> = {
  name: "plasmic-commerce-ep-search-box",
  displayName: "EP Search Box",
  description:
    "Search input with debounce for catalog search. Must be inside EP Catalog Search Provider.",
  props: {
    placeholder: {
      type: "string",
      defaultValue: "Search products...",
      displayName: "Placeholder",
    },
    autoFocus: {
      type: "boolean",
      defaultValue: false,
      displayName: "Auto Focus",
    },
    debounceMs: {
      type: "number",
      defaultValue: 300,
      displayName: "Debounce (ms)",
      description: "Milliseconds to wait before triggering search",
    },
    showClear: {
      type: "boolean",
      defaultValue: true,
      displayName: "Show Clear Button",
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPSearchBox",
  parentComponentName: "plasmic-commerce-ep-catalog-search-provider",
};

export function EPSearchBox(props: EPSearchBoxProps) {
  const {
    className,
    placeholder = "Search products...",
    autoFocus = false,
    debounceMs = 300,
    showClear = true,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const useMock =
    previewState === "withData" || (previewState === "auto" && inEditor);

  if (useMock) {
    return (
      <div className={className} data-ep-search-box="" style={DEFAULT_SEARCH_BOX_WRAPPER_STYLE}>
        <input
          type="search"
          placeholder={placeholder}
          autoFocus={autoFocus}
          defaultValue="leather"
          readOnly
          style={DEFAULT_SEARCH_BOX_INPUT_STYLE}
        />
        {showClear && (
          <button
            type="button"
            aria-label="Clear search"
            style={DEFAULT_SEARCH_BOX_CLEAR_BUTTON_STYLE}
          >
            &times;
          </button>
        )}
      </div>
    );
  }

  return (
    <EPSearchBoxInner
      className={className}
      placeholder={placeholder}
      autoFocus={autoFocus}
      debounceMs={debounceMs}
      showClear={showClear}
    />
  );
}

function EPSearchBoxInner(props: {
  className?: string;
  placeholder: string;
  autoFocus: boolean;
  debounceMs: number;
  showClear: boolean;
}) {
  const { className, placeholder, autoFocus, debounceMs, showClear } = props;

  // Import useSearchBox at runtime — requires InstantSearch context
  const { useSearchBox } = require("react-instantsearch");
  const { query, refine, clear } = useSearchBox();

  const [inputValue, setInputValue] = useState(query);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external query changes to input
  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        refine(value);
      }, debounceMs);
    },
    [refine, debounceMs]
  );

  const handleClear = useCallback(() => {
    setInputValue("");
    clear();
  }, [clear]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={className} data-ep-search-box="" style={DEFAULT_SEARCH_BOX_WRAPPER_STYLE}>
      <input
        type="search"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={inputValue}
        onChange={handleChange}
        style={{ width: "100%" }}
      />
      {showClear && inputValue && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={handleClear}
          style={DEFAULT_SEARCH_BOX_CLEAR_BUTTON_STYLE}
        >
          &times;
        </button>
      )}
    </div>
  );
}

export function registerEPSearchBox(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchBoxProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchBox, customMeta ?? epSearchBoxMeta);
}
