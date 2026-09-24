/**
 * EPAccountProvider — publishes `$ctx.account` to descendants.
 *
 * Owns the boundary between account/session internals and consuming
 * components. Until the shopper-envelope identity work lands, runtime
 * `auto` is the anonymous shape and Studio uses previewState fixtures.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../registerable";
import {
  MOCK_ACCOUNT_ANONYMOUS,
  MOCK_ACCOUNT_BY_PREVIEW_STATE,
} from "../utils/design-time-data";
import { createLogger } from "../utils/logger";
import type { AccountContext, AccountPreviewState } from "./types";

const log = createLogger("EPAccountProvider");

interface EPAccountProviderProps {
  children?: React.ReactNode;
  previewState?: AccountPreviewState;
  className?: string;
}

/**
 * Resolves the published `$ctx.account` value.
 *
 * Fixtures are canvas-only, matching EPCheckoutProvider: explicit
 * previewState and the auto mock floor apply only when
 * `usePlasmicCanvasContext()` is set. Outside Studio the published
 * shape is anonymous until the identity architecture can fill it —
 * leftover previewState on a published page is ignored.
 */
export function resolveAccountContext(
  previewState: AccountPreviewState,
  inEditor: boolean
): AccountContext {
  if (!inEditor) {
    return MOCK_ACCOUNT_ANONYMOUS;
  }
  if (previewState === "auto") {
    return MOCK_ACCOUNT_BY_PREVIEW_STATE.selected;
  }
  return (
    MOCK_ACCOUNT_BY_PREVIEW_STATE[previewState] ??
    MOCK_ACCOUNT_BY_PREVIEW_STATE.selected
  );
}

export const epAccountProviderMeta: CodeComponentMeta<EPAccountProviderProps> =
  {
    name: "plasmic-commerce-ep-account-provider",
    displayName: "EP Account Provider",
    description:
      "Exposes the current shopper's account identity as `$ctx.account` to descendants. Wrap account gates, fields, and later account experiences. Preview State selects sample identity in Studio; runtime auto stays anonymous until account session architecture is available.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-gate",
            props: { when: "authenticated" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-account-field",
            props: { field: "selectedAccount.name" },
          },
        ],
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Anonymous", value: "anonymous" },
          { label: "Authenticated", value: "authenticated" },
          { label: "Account selected", value: "selected" },
          { label: "Lapsed account", value: "lapsed" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Studio only. Force a sample account identity so Gates and Fields can be composed. `auto` uses the selected-account fixture in the canvas. Ignored on the published page, which stays anonymous until live identity is available.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountProvider",
  };

export function EPAccountProvider(props: EPAccountProviderProps) {
  const { children, previewState = "auto", className } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const account = resolveAccountContext(previewState, inEditor);

  if (inEditor) {
    log.debug("Publishing account context from preview fixture", {
      previewState,
      state: account.state,
    });
  }

  return (
    <DataProvider name="account" data={account}>
      <div className={className} data-ep-account-provider="">
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPAccountProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPAccountProvider, customMeta ?? epAccountProviderMeta);
}
