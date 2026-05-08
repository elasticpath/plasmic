/**
 * EPSearchAutocompleteList — repeater bridge.
 *
 * Renders `<ul {...getListProps()}>` with one `<li {...getItemProps(...)}>`
 * per item in the configured source. Per-iteration `currentSuggestion`
 * context is published via Plasmic DataProvider — designers compose row
 * visuals from the slot's child elements, repeated via `repeatedElement`.
 *
 * `sourceId` (default unset) scopes to a single source. When unset, all
 * sources flatten into a single list. When set, only items from the
 * matching source are rendered.
 */

import {
  DataProvider,
  repeatedElement,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import {
  AutocompleteCollection,
  AutocompleteSuggestionItem,
  CurrentSuggestion,
  MOCK_AUTOCOMPLETE_DATA,
} from "./design-time-data";
import { useEPAutocompleteContextOptional } from "./EPAutocompleteContext";

type PreviewState = "auto" | "withData";

interface EPSearchAutocompleteListProps {
  children?: React.ReactNode;
  className?: string;
  sourceId?: string;
  previewState?: PreviewState;
}

export const epSearchAutocompleteListMeta: CodeComponentMeta<EPSearchAutocompleteListProps> =
  {
    name: "plasmic-commerce-ep-search-autocomplete-list",
    displayName: "EP Search Autocomplete List",
    description:
      "Repeats children once per autocomplete suggestion item. Click handlers and ARIA semantics are wired automatically. Use `sourceId` to scope the list to a single named source. Per-iteration $ctx.currentSuggestion exposes the item, isHighlighted, and source. Must be inside EP Search Autocomplete.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "text",
            value: "Suggestion",
            styles: { padding: "8px 12px" },
          },
        ],
      },
      sourceId: {
        type: "string",
        displayName: "Source ID",
        description:
          "Restrict to one source (e.g. 'predictions', 'recent'). Defaults to all sources.",
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
    importName: "EPSearchAutocompleteList",
    parentComponentName: "plasmic-commerce-ep-search-autocomplete",
    providesData: true,
  };

interface FlatItem {
  item: AutocompleteSuggestionItem;
  source: string;
  isHighlighted: boolean;
  /** Real autocomplete-core source object (or a mock {sourceId} stub). */
  rawSource: any;
}

function flattenCollections(
  collections: AutocompleteCollection[],
  rawCollections: any[],
  activeItemId: number | null,
  sourceFilter?: string
): FlatItem[] {
  const flat: FlatItem[] = [];
  let absoluteIndex = 0;
  collections.forEach((collection, ci) => {
    if (sourceFilter && collection.sourceId !== sourceFilter) {
      // still advance absoluteIndex past skipped items so highlight ids
      // remain in lockstep with autocomplete-core's count
      absoluteIndex += collection.items.length;
      return;
    }
    const raw = rawCollections?.[ci]?.source ?? { sourceId: collection.sourceId };
    collection.items.forEach((item) => {
      flat.push({
        item,
        source: collection.sourceId,
        isHighlighted: activeItemId === absoluteIndex,
        rawSource: raw,
      });
      absoluteIndex += 1;
    });
  });
  return flat;
}

export function EPSearchAutocompleteList(
  props: EPSearchAutocompleteListProps
) {
  const { children, className, sourceId } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const ctx = useEPAutocompleteContextOptional();

  if (!ctx) return null;

  // Editor mode: prefer mock collections so designers see populated rows
  // even when the autocomplete-core hook hasn't been driven.
  const mockMode =
    inEditor &&
    (!ctx.collections || ctx.collections.length === 0);

  const collections = mockMode
    ? MOCK_AUTOCOMPLETE_DATA.collections
    : ctx.collections;
  const rawCollections = ctx.state.collections ?? [];
  const activeItemId = ctx.state.activeItemId;

  const flat = flattenCollections(
    collections,
    mockMode ? [] : rawCollections,
    typeof activeItemId === "number" ? activeItemId : null,
    sourceId
  );

  const listProps = ctx.getListProps({});

  return (
    <ul
      {...listProps}
      className={className}
      data-ep-autocomplete-list=""
    >
      {flat.map((entry, i) => {
        const itemProps = ctx.getItemProps({
          item: entry.item,
          source: entry.rawSource,
        });
        const ctxValue: CurrentSuggestion = {
          item: entry.item,
          isHighlighted: entry.isHighlighted,
          source: entry.source,
          query: ctx.state.query ?? "",
        };
        return (
          <li
            {...itemProps}
            key={`${entry.source}:${entry.item.q}:${i}`}
          >
            <DataProvider name="currentSuggestion" data={ctxValue}>
              <DataProvider name="currentSuggestionIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          </li>
        );
      })}
    </ul>
  );
}

export function registerEPSearchAutocompleteList(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPSearchAutocompleteListProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPSearchAutocompleteList,
    customMeta ?? epSearchAutocompleteListMeta
  );
}
