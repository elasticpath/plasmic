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
  // Required to receive server-queries exec modules
  // (serverQueriesExecFuncFileName per page) in the bundle.
  platformOptions: { nextjs: { appDir: true } },
});
