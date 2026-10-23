/**
 * EPAccountAddressProvider — publishes `$ctx.accountAddresses`.
 *
 * Calls `identity.accountAddresses()` with no arguments when an organisation
 * is selected. That operation is the data boundary; the result's `addresses`
 * and `total` are published as returned.
 */

import {
  DataProvider,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useEffect, useRef, useState } from "react";
import { epIdentityErrorCode } from "../identity/client";
import type { EpAccountAddressResult } from "../identity/operations";
import { useEpIdentity } from "../identity/useEpIdentity";
import { Registerable } from "../registerable";
import { useCanvasPreviewState } from "../utils/canvas-preview-state";
import { MOCK_ACCOUNT_ADDRESSES } from "../utils/design-time-data";
import type {
  AccountAddressBookContext,
  AccountAddressPreviewState,
  AccountContext,
} from "./types";

const NO_MEMBER = "No account member is signed in.";
const NO_SELECTED = "No organisation is selected.";
const LAPSED =
  "The account credential ran out and cannot be re-minted. Sign in again.";
const READ_FAILED = "Elastic Path rejected the account-address read.";

const LOADING_BOOK: AccountAddressBookContext = {
  status: "loading",
  addresses: [],
  total: 0,
  error: null,
};

const EMPTY_PREVIEW: AccountAddressBookContext = {
  status: "empty",
  addresses: [],
  total: 0,
  error: null,
};

const FIXTURE_BOOK: AccountAddressBookContext = {
  status: "ready",
  addresses: MOCK_ACCOUNT_ADDRESSES,
  total: MOCK_ACCOUNT_ADDRESSES.length,
  error: null,
};

function errorBook(code: string, message: string): AccountAddressBookContext {
  return {
    status: "error",
    addresses: [],
    total: 0,
    error: { code, message },
  };
}

const PREVIEW_BOOK: Record<
  Exclude<AccountAddressPreviewState, "auto">,
  AccountAddressBookContext
> = {
  withAddresses: FIXTURE_BOOK,
  empty: EMPTY_PREVIEW,
  loading: LOADING_BOOK,
  error: errorBook("account_addresses_read_failed", READ_FAILED),
  noSelectedAccount: errorBook("no_selected_account", NO_SELECTED),
  lapsed: errorBook("account_lapsed", LAPSED),
};

function previewBook(
  preview: AccountAddressPreviewState | "auto"
): AccountAddressBookContext {
  if (preview === "auto") return FIXTURE_BOOK;
  return PREVIEW_BOOK[preview] ?? FIXTURE_BOOK;
}

function settledAccountKey(account: AccountContext): string {
  switch (account.state) {
    case "selected":
      return `selected:${account.selectedAccount?.id ?? ""}`;
    case "lapsed":
      return `lapsed:${account.lapsedAccount?.id ?? ""}`;
    case "memberOnly":
      return "member-only";
    case "anonymous":
      return "anonymous";
  }
}

function renderAccountKey(account: AccountContext | undefined): string {
  if (!account) return "no-account-member";
  if (account.isLoading) return "loading";
  return settledAccountKey(account);
}

function errorBookForKey(key: string): AccountAddressBookContext {
  if (key.startsWith("lapsed:")) return errorBook("account_lapsed", LAPSED);
  if (key === "member-only") {
    return errorBook("no_selected_account", NO_SELECTED);
  }
  return errorBook("no_account_member", NO_MEMBER);
}

function bookFromResult(
  result: EpAccountAddressResult
): AccountAddressBookContext {
  return {
    status: result.addresses.length === 0 ? "empty" : "ready",
    addresses: result.addresses,
    total: result.total,
    error: null,
  };
}

function readFailureBook(err: unknown): AccountAddressBookContext {
  const code = epIdentityErrorCode(err) ?? "account_addresses_read_failed";
  const message =
    err instanceof Error && err.message ? err.message : READ_FAILED;
  return errorBook(code, message);
}

interface EPAccountAddressProviderProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: AccountAddressPreviewState;
}

type CommittedBook = {
  key: string;
  book: AccountAddressBookContext;
};

export const epAccountAddressProviderMeta: CodeComponentMeta<EPAccountAddressProviderProps> =
  {
    name: "plasmic-commerce-ep-account-address-provider",
    displayName: "EP Account Address Provider",
    description:
      "Publishes the selected organisation's saved addresses as `$ctx.accountAddresses`. Place inside an EP Account Provider. Studio Preview State uses sample addresses and does not read the shopper's address book.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-account-address-list",
          },
        ],
      },
      previewState: {
        type: "choice",
        options: [
          { label: "Auto", value: "auto" },
          { label: "With addresses", value: "withAddresses" },
          { label: "Empty", value: "empty" },
          { label: "Loading", value: "loading" },
          { label: "Error", value: "error" },
          { label: "No selected account", value: "noSelectedAccount" },
          { label: "Lapsed account", value: "lapsed" },
        ],
        defaultValue: "auto",
        displayName: "Preview State",
        advanced: true,
        description:
          "Studio only. `auto` shows two sample addresses. The other values force a state on the canvas. The canvas does not read saved addresses. Published pages ignore this and follow the selected account.",
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPAccountAddressProvider",
    parentComponentName: "plasmic-commerce-ep-account-provider",
  };

export function EPAccountAddressProvider(
  props: EPAccountAddressProviderProps
) {
  const { children, className, previewState } = props;
  const inEditor = !!usePlasmicCanvasContext();
  const preview = useCanvasPreviewState(previewState);
  const account = useSelector("account") as AccountContext | undefined;
  const identity = useEpIdentity();
  const requestId = useRef(0);
  const heldKeyRef = useRef<string | null>(null);
  const [committed, setCommitted] = useState<CommittedBook | null>(null);

  if (!account) {
    heldKeyRef.current = "no-account-member";
  } else if (!account.isLoading) {
    heldKeyRef.current = settledAccountKey(account);
  }
  const effectKey = heldKeyRef.current;
  const renderKey = renderAccountKey(account);

  useEffect(() => {
    if (inEditor) return;
    if (effectKey == null) return;

    const id = ++requestId.current;
    const key = effectKey;

    if (!key.startsWith("selected:")) {
      setCommitted({ key, book: errorBookForKey(key) });
      return () => {
        requestId.current += 1;
      };
    }

    let cancelled = false;
    identity.accountAddresses().then(
      (result) => {
        if (cancelled || id !== requestId.current) return;
        setCommitted({ key, book: bookFromResult(result) });
      },
      (err: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setCommitted({ key, book: readFailureBook(err) });
      }
    );
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [inEditor, effectKey, identity]);

  const book = inEditor
    ? previewBook(preview)
    : committed?.key === renderKey
      ? committed.book
      : LOADING_BOOK;

  return (
    <DataProvider name="accountAddresses" data={book}>
      <div className={className} data-ep-account-address-provider="">
        {children}
      </div>
    </DataProvider>
  );
}

export function registerEPAccountAddressProvider(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPAccountAddressProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAccountAddressProvider,
    customMeta ?? epAccountAddressProviderMeta
  );
}
