import { Plugin as EsbuildPlugin } from "esbuild";

type NextModulesOpts = {
  platform: string;
  loaderVersion: number;
};

export function loaderProvidesNextNavigation(opts: NextModulesOpts) {
  return opts.platform === "nextjs" && opts.loaderVersion >= 10;
}

const SHIM_NAMESPACE = "next-module-shim";

const NEXT_HEADERS_SHIM = `
const emptyHeaders = {
  get: () => null,
  has: () => false,
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  entries: () => [][Symbol.iterator](),
  forEach: () => {},
  [Symbol.iterator]: () => [][Symbol.iterator](),
};

export function headers() {
  return emptyHeaders;
}
`;

const NEXT_NAVIGATION_SHIM = `
import { createContext } from "react";

function unavailable(name) {
  return function () {
    throw new Error(
      "next/navigation " + name + "() is not available here. It needs a Next.js loader at loader version 10 or later."
    );
  };
}

export const ServerInsertedHTMLContext = createContext(null);
export const useParams = unavailable("useParams");
export const usePathname = unavailable("usePathname");
export const useSearchParams = unavailable("useSearchParams");
`;

export function nextModulesPlugin(opts: NextModulesOpts): EsbuildPlugin {
  return {
    name: "next-modules",
    setup(build) {
      build.onResolve({ filter: /^next\/headers(\.js)?$/ }, () => ({
        path: "next/headers",
        namespace: SHIM_NAMESPACE,
      }));
      build.onResolve({ filter: /^next\/navigation(\.js)?$/ }, () => {
        if (loaderProvidesNextNavigation(opts)) {
          return { path: "next/navigation", external: true };
        }
        return { path: "next/navigation", namespace: SHIM_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: SHIM_NAMESPACE }, (args) => ({
        contents:
          args.path === "next/headers"
            ? NEXT_HEADERS_SHIM
            : NEXT_NAVIGATION_SHIM,
        loader: "js",
      }));
    },
  };
}
