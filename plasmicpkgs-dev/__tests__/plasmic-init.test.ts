import { expect, it, vi } from "vitest";

const { initPlasmicLoader } = vi.hoisted(() => ({
  initPlasmicLoader: vi.fn((_opts: unknown) => ({})),
}));

vi.mock("@plasmicapp/loader-nextjs/react-server-conditional", () => ({
  initPlasmicLoader,
}));

it("passes loader options the dev loader cache can serialize", async () => {
  vi.stubEnv("NEXT_PUBLIC_PROJECT_ID", "project-id");
  vi.stubEnv("NEXT_PUBLIC_PROJECT_TOKEN", "project-token");

  await import("../plasmic-init");

  const [opts] = initPlasmicLoader.mock.calls[0];
  expect(() => JSON.stringify(opts)).not.toThrow();
});
