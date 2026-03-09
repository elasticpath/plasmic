/**
 * EPSearchBox — debounced search input for catalog search.
 *
 * Wraps `useSearchBox()` from react-instantsearch. At design time, renders
 * a static input with mock placeholder for visual editing.
 */

import { usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Registerable } from "../registerable";

type PreviewState = "auto" | "withData";

interface EPSearchBoxProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  showClear?: boolean;
  previewState?: PreviewState;
}

export const epSearchBoxMeta: ComponentMeta<EPSearchBoxProps> = {
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
      <div className={className} data-ep-search-box="">
        <input
          type="search"
          placeholder={placeholder}
          autoFocus={autoFocus}
          defaultValue="leather"
          readOnly
          style={{ width: "100%" }}
        />
        {showClear && (
          <button type="button" aria-label="Clear search">
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
    <div className={className} data-ep-search-box="">
      <input
        type="search"
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={inputValue}
        onChange={handleChange}
        style={{ width: "100%" }}
      />
      {showClear && inputValue && (
        <button type="button" aria-label="Clear search" onClick={handleClear}>
          &times;
        </button>
      )}
    </div>
  );
}

export function registerEPSearchBox(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPSearchBoxProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPSearchBox, customMeta ?? epSearchBoxMeta);
}
