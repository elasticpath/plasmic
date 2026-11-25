const mockWarn = jest.fn();

jest.mock("@/wab/server/observability", () => ({
  logger: () => ({ warn: mockWarn }),
}));

import { logCodegenFailure } from "@/wab/server/workers/ep-codegen-failure-log";

describe("logCodegenFailure", () => {
  beforeEach(() => mockWarn.mockClear());

  it("logs a warning with the project fields and rethrows the same error", async () => {
    const err = new Error("Codegen failed for component");

    await expect(
      Promise.reject(err).catch(
        logCodegenFailure("loader-codegen-project-failed", {
          project_id: "p1",
          project_version: "latest",
          indirect: false,
        })
      )
    ).rejects.toBe(err);

    expect(mockWarn).toHaveBeenCalledWith("loader-codegen-project-failed", {
      project_id: "p1",
      project_version: "latest",
      indirect: false,
      err,
    });
  });
});
