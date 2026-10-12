import { createContext } from "react";

function unavailable(name) {
  return function () {
    throw new Error(
      "next/navigation " + name + "() is not available in the Studio canvas."
    );
  };
}

export const ServerInsertedHTMLContext = createContext(null);
export const useParams = unavailable("useParams");
export const usePathname = unavailable("usePathname");
export const useSearchParams = unavailable("useSearchParams");
