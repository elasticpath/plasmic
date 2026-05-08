/**
 * useEPAutocompleteState — deep-module hook owning autocomplete-core lifecycle.
 *
 * The four EP autocomplete React components consume this hook and never call
 * `createAutocomplete` directly. The hook hides the state-machine setup,
 * source construction, debounced live-mirror to `useSearchBox().refine`,
 * selection-time immediate refine, and React-state subscription behind a
 * single signature.
 *
 * Inputs are pure (no React types beyond ref boundary). Outputs are the
 * autocomplete-core prop-getters plus a small set of imperative handlers
 * the provider exposes as Plasmic ref-actions.
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import {
  predictionsSource,
  MultiSearchBody,
  MultiSearchResponse,
} from "./predictionsSource";
import { AutocompleteCollection } from "./design-time-data";

export interface UseEPAutocompleteStateConfig {
  predictionsField: string;
  debounceMs: number;
  enableRecentSearches: boolean;
  recentSearchesKey?: string;
  recentSearchesLimit?: number;
  plugins?: any[];
  postMultiSearch: (body: MultiSearchBody) => Promise<MultiSearchResponse>;
}

export interface UseEPAutocompleteStateResult {
  state: any;
  collections: AutocompleteCollection[];
  getInputProps: (...args: any[]) => any;
  getPanelProps: (...args: any[]) => any;
  getListProps: (...args: any[]) => any;
  getItemProps: (...args: any[]) => any;
  getRootProps: (...args: any[]) => any;
  getEnvironmentProps: (...args: any[]) => any;
  setQuery: (value: string) => void;
  focus: () => void;
  clear: () => void;
  submit: () => void;
}

export function useEPAutocompleteState(
  config: UseEPAutocompleteStateConfig
): UseEPAutocompleteStateResult {
  const {
    predictionsField,
    debounceMs,
    enableRecentSearches,
    plugins,
    postMultiSearch,
  } = config;

  const { useSearchBox } = require("react-instantsearch");
  const {
    query: instantSearchQuery,
    refine,
    clear: refineClear,
  } = useSearchBox();

  // Stable refs keep the instance handlers from going stale across renders.
  const refineRef = useRef(refine);
  refineRef.current = refine;
  const refineClearRef = useRef(refineClear);
  refineClearRef.current = refineClear;
  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;
  const predictionsFieldRef = useRef(predictionsField);
  predictionsFieldRef.current = predictionsField;

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMirroredQuery = useRef<string>(instantSearchQuery ?? "");
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // autocomplete-core's createAutocomplete() does not expose `state` on the
  // returned instance — state is delivered to subscribers via onStateChange.
  // Maintain our own ref-tracked snapshot so render reads always see a value
  // (default empty until the first state notification arrives).
  const stateRef = useRef<any>({
    query: instantSearchQuery ?? "",
    isOpen: false,
    activeItemId: null,
    collections: [],
    status: "idle",
  });

  const cancelDebounce = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const scheduleRefine = useCallback(
    (next: string) => {
      cancelDebounce();
      debounceTimer.current = setTimeout(() => {
        refineRef.current(next);
        debounceTimer.current = null;
      }, debounceMsRef.current);
    },
    [cancelDebounce]
  );

  const instanceRef = useRef<any>(null);
  if (instanceRef.current === null) {
    const source = predictionsSource({ predictionsField, postMultiSearch });
    const { createAutocomplete } = require("@algolia/autocomplete-core");

    instanceRef.current = createAutocomplete({
      onStateChange: ({ state }: any) => {
        stateRef.current = state;
        if (state.query !== lastMirroredQuery.current) {
          lastMirroredQuery.current = state.query;
          scheduleRefine(state.query);
        }
        forceRender();
      },
      getSources: () => [
        {
          sourceId: "predictions",
          getItems: ({ query }: { query: string }) =>
            source.getItems({ query }),
          // autocomplete-core's default returns state.query — meaning a
          // click would leave the input unchanged. Surface the item's
          // suggestion field so selection updates the input value AND the
          // URL via the live-mirror refine.
          getItemInputValue: ({ item }: any) =>
            (item?.[predictionsFieldRef.current] as string | undefined) ?? "",
          onSelect: ({ item, setIsOpen }: any) => {
            cancelDebounce();
            const value =
              (item?.[predictionsFieldRef.current] as string | undefined) ??
              "";
            lastMirroredQuery.current = value;
            refineRef.current(value);
            setIsOpen(false);
          },
        },
      ],
      plugins: plugins ?? [],
    });
  }

  // Mirror the existing useSearchBox query into the autocomplete-core
  // instance once on mount. Done in an effect (not at render time) so
  // the resulting state notification stays inside React's update cycle.
  const initialMirrorDone = useRef(false);
  useEffect(() => {
    if (initialMirrorDone.current) return;
    initialMirrorDone.current = true;
    if (instantSearchQuery) {
      lastMirroredQuery.current = instantSearchQuery;
      instanceRef.current.setQuery(instantSearchQuery);
    }
    // intentional: empty deps — runs once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      cancelDebounce();
    };
  }, [cancelDebounce]);

  const instance = instanceRef.current;

  const setQueryAction = useCallback(
    (value: string) => {
      instance.setQuery(value);
    },
    [instance]
  );

  const focusAction = useCallback(() => {
    instance.setIsOpen(true);
  }, [instance]);

  const clearAction = useCallback(() => {
    cancelDebounce();
    lastMirroredQuery.current = "";
    instance.setQuery("");
    instance.setIsOpen(false);
    refineClearRef.current();
  }, [cancelDebounce, instance]);

  const submit = useCallback(() => {
    cancelDebounce();
    const v: string = stateRef.current?.query ?? "";
    lastMirroredQuery.current = v;
    refineRef.current(v);
    instance.setIsOpen(false);
  }, [cancelDebounce, instance]);

  const currentState = stateRef.current;
  const collections: AutocompleteCollection[] = (
    currentState?.collections ?? []
  ).map((c: any) => ({
    sourceId: c.source?.sourceId ?? c.sourceId,
    items: c.items,
  }));

  return {
    state: currentState,
    collections,
    getInputProps: instance.getInputProps,
    getPanelProps: instance.getPanelProps,
    getListProps: instance.getListProps,
    getItemProps: instance.getItemProps,
    getRootProps: instance.getRootProps,
    getEnvironmentProps: instance.getEnvironmentProps,
    setQuery: setQueryAction,
    focus: focusAction,
    clear: clearAction,
    submit,
  };
}
