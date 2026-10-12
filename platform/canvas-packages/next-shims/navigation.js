import { createContext } from "react";

export const ServerInsertedHTMLContext = createContext(null);

export function usePathname() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function useSearchParams() {
  return new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search
  );
}

export function useParams() {
  return {};
}
