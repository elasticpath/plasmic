/**
 * Internal React context shared between the EPSearchAutocomplete provider
 * and its three bridge components (Input, Panel, List).
 *
 * The provider populates this with the autocomplete-core prop-getters and
 * imperative handlers it gets out of `useEPAutocompleteState`. Children
 * read it to spread the right prop-getter onto their slot element. This
 * is *not* exposed through Plasmic's `$ctx` because the values include
 * non-serialisable functions and refs.
 */

import React from "react";
import { AutocompleteCollection } from "./design-time-data";

export interface EPAutocompleteContextValue {
  state: {
    query: string;
    isOpen: boolean;
    activeItemId: number | null;
    collections: any[];
    [key: string]: any;
  };
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

export const EPAutocompleteContext =
  React.createContext<EPAutocompleteContextValue | null>(null);

export function useEPAutocompleteContextOptional(): EPAutocompleteContextValue | null {
  return React.useContext(EPAutocompleteContext);
}
