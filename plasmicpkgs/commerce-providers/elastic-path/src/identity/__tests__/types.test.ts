/**
 * Neither test runner type-checks, and `tsdx build` only walks the entry
 * graph, so nothing would otherwise notice the client's methods widening to
 * `any`. Compiling the fixture requires every `@ts-expect-error` to fire.
 */
import * as ts from "typescript";
import * as path from "path";

const FIXTURE = path.join(__dirname, "fixtures", "call-sites.ts");

describe("the identity client's types at a call site", () => {
  it("accepts every valid call and rejects every invalid one", () => {
    const program = ts.createProgram([FIXTURE], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2020,
      lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.ESNext,
      esModuleInterop: true,
    });

    const complaints = ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? "?"}: ${ts.flattenDiagnosticMessageText(
            d.messageText,
            " "
          )}`
      );

    expect(complaints).toEqual([]);
  });
});
