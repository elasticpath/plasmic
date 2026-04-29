import { initPlasmicLoader } from "@plasmicapp/loader-nextjs/react-server-conditional";

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: "9iSL9GyrJNp9ebWzxaHtM5",
      token:
        "pynBbCn3WCfWB29kaBFMKXDpIVRoWQz1OvgKPxSBJbzhoezqh5tlfF1E9N8n9k4Z02wi27RIYczfh7ffJVNhQ",
    },
  ],
  host: "http://localhost:3003",
  preview: true,
  // Dev-only: bypass loader's in-process cache so MCP / Studio edits take
  // effect on the next request without a Next dev restart. Trade: an extra
  // wab fetch per request. Drop this for prod builds.
  alwaysFresh: process.env.NODE_ENV !== "production",
  // Required to receive server-queries exec modules
  // (serverQueriesExecFuncFileName per page) in the bundle.
  platformOptions: { nextjs: { appDir: true } },
});
