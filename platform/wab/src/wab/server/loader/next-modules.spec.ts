/** @jest-environment node */
import {
  bundleModules,
  CodeModule,
  LoaderBundleOutput,
} from "@/wab/server/loader/module-bundler";
import { promises as fs } from "fs";
import os from "os";
import React from "react";
import path from "path";

jest.mock("@/wab/server/util/s3-util", () => ({
  uploadFilesToS3: jest.fn(),
}));

type Platform = "react" | "nextjs" | "gatsby" | "tanstack";

const SEARCH_LIBRARY_SOURCE = `
import { headers } from "next/headers.js";
import { useParams, usePathname, useSearchParams } from "next/navigation.js";
const cjsHeaders = require("next/headers");
const cjsNavigation = require("next/navigation");
export const readHeaders = () => headers();
export const readCjsHeaders = () => cjsHeaders.headers();
export const navigation = { useParams, usePathname, useSearchParams, cjsNavigation };
`;

describe("bundling next/headers and next/navigation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "next-modules-test-"));
    await fs.writeFile(path.join(dir, "root-provider.tsx"), SEARCH_LIBRARY_SOURCE);
    await fs.writeFile(path.join(dir, "default.css"), ".x{color:red}");
    await fs.writeFile(
      path.join(dir, "css-entrypoint.tsx"),
      `import "./default.css";`
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function bundle(platform: Platform, loaderVersion: number) {
    return bundleModules(dir, [], {}, [], {
      platform,
      loaderVersion,
      mode: "production",
      browserOnly: false,
    });
  }

  function rootProvider(
    output: LoaderBundleOutput,
    target: "browser" | "server"
  ) {
    const modules = Array.isArray(output.modules)
      ? output.modules
      : output.modules[target];
    return modules.find(
      (m): m is CodeModule =>
        m.type === "code" && m.fileName === "root-provider.js"
    )!;
  }

  function evaluate(
    mod: CodeModule,
    registered: Record<string, unknown>,
    window?: { location: { pathname: string; search: string } }
  ) {
    const required: string[] = [];
    const exports: Record<string, any> = {};
    const requireFn = (name: string) => {
      required.push(name);
      if (!(name in registered)) {
        throw new Error(`Unknown module: ${name}`);
      }
      return registered[name];
    };
    new Function("require", "exports", "Headers", "window", mod.code)(
      requireFn,
      exports,
      undefined,
      window
    );
    return { exports, required };
  }

  const loaderNavigation = {
    usePathname: () => "/search",
    useSearchParams: () => new URLSearchParams("q=shoe"),
  };

  it("hands next/navigation over to a Next.js loader at version 10", async () => {
    const output = await bundle("nextjs", 10);

    expect(output.external).toContain("next/navigation");
    for (const target of ["browser", "server"] as const) {
      const { exports, required } = evaluate(rootProvider(output, target), {
        "next/navigation": loaderNavigation,
      });
      expect([...new Set(required)]).toEqual(["next/navigation"]);
      expect(exports.navigation.usePathname()).toBe("/search");
      expect(exports.navigation.cjsNavigation).toBe(loaderNavigation);
    }
  });

  it("gives browser and server bundles an empty next/headers without a global Headers", async () => {
    const output = await bundle("nextjs", 10);

    expect(output.external).not.toContain("next/headers");
    for (const target of ["browser", "server"] as const) {
      const { exports } = evaluate(rootProvider(output, target), {
        "next/navigation": loaderNavigation,
      });
      for (const read of [exports.readHeaders, exports.readCjsHeaders]) {
        const headers = read();
        expect(headers.get("host")).toBeNull();
        expect(headers.get("x-nonce")).toBeNull();
        expect([...headers.keys()]).toEqual([]);
      }
    }
  });

  it.each([
    ["react", 10],
    ["gatsby", 10],
    ["tanstack", 10],
    ["nextjs", 9],
  ] as const)(
    "never asks a %s loader at version %i for a next module",
    async (platform, loaderVersion) => {
      const output = await bundle(platform, loaderVersion);

      expect(output.external).not.toContain("next/navigation");
      for (const target of ["browser", "server"] as const) {
        const { exports, required } = evaluate(rootProvider(output, target), {
          react: React,
        });
        expect(required.filter((name) => name.startsWith("next"))).toEqual(
          []
        );
        expect(exports.readHeaders().get("host")).toBeNull();
        expect(exports.navigation.usePathname()).toBe("/");
        expect(exports.navigation.useSearchParams().toString()).toBe("");
        expect(exports.navigation.useParams()).toEqual({});
      }
    }
  );

  it.each([
    ["react", 10],
    ["gatsby", 10],
    ["tanstack", 10],
    ["nextjs", 9],
  ] as const)(
    "reads next/navigation from the browser location for a %s loader at version %i",
    async (platform, loaderVersion) => {
      const output = await bundle(platform, loaderVersion);

      const { exports } = evaluate(
        rootProvider(output, "browser"),
        { react: React },
        { location: { pathname: "/search", search: "?q=shoe" } }
      );
      expect(exports.navigation.usePathname()).toBe("/search");
      expect(exports.navigation.useSearchParams().get("q")).toBe("shoe");
      expect(exports.navigation.useParams()).toEqual({});
    }
  );
});
