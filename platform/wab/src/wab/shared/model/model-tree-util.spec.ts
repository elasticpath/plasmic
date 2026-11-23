<<<<<<< HEAD
import { Bundler } from "@/wab/shared/bundler";
=======
import { generateSiteFromBundle } from "@/wab/shared/__testonly__/site-tests-utils";
import { Bundle, Bundler } from "@/wab/shared/bundler";
>>>>>>> upstream/master
import {
  AssertionError,
  InvalidCodePathError,
  isLiteralObject,
  isPrimitive,
<<<<<<< HEAD
} from "@/wab/shared/common";
import { instUtil } from "@/wab/shared/model/InstUtil";
import { ObjInst, Site, ensureKnownSite } from "@/wab/shared/model/classes";
import { meta } from "@/wab/shared/model/classes-metas";
import { isWeakRefField } from "@/wab/shared/model/model-meta";
import {
  NodeFieldCtx,
  createNodeCtx,
  nextCtx,
  walkModelTree,
} from "@/wab/shared/model/model-tree-util";
import { readFileSync } from "fs";

describe("nextCtx", () => {
  const site = {} as Site;
  const ctx = (
    path: string[],
    keyPath?: (string | undefined)[],
    node: any = {}
  ): NodeFieldCtx =>
    keyPath === undefined
      ? { site, node, path }
      : { site, node, path, keyPath };

  it("returns site, node, path and keyPath, in that key order", () => {
    const next = nextCtx(ctx(["a"], ["x"], { f: 1 }), "f", "k");
    expect(Object.keys(next)).toEqual(["site", "node", "path", "keyPath"]);
    expect(next.site).toBe(site);
  });

  it("reads node[field], or undefined when there is no node", () => {
    const child = {};
    expect(nextCtx(ctx([], [], { f: child }), "f").node).toBe(child);
    expect(nextCtx(ctx([], [], undefined), "f").node).toBeUndefined();
  });

  it("appends the field to a copy of path", () => {
    const parent = ctx(["a", "b"]);
    const next = nextCtx(parent, "c");
    expect(next.path).toEqual(["a", "b", "c"]);
    expect(next.path).not.toBe(parent.path);
  });

  // toStrictEqual fails when keyPath has holes (missing indexes).
  // toEqual does not.
  it.each([
    ["missing", ["a", "b"], undefined, [undefined, undefined, "k"]],
    ["empty", ["a", "b"], [], [undefined, undefined, "k"]],
    [
      "shorter than path",
      ["a", "b", "c"],
      ["x"],
      ["x", undefined, undefined, "k"],
    ],
    ["as long as path", ["a", "b"], ["x", "y"], ["x", "y", "k"]],
  ])(
    "pads a keyPath that is %s with undefined to the path length, then appends key",
    (_shape, path, keyPath, expected) => {
      expect(nextCtx(ctx(path, keyPath), "f", "k").keyPath).toStrictEqual(
        expected
      );
    }
  );

  it("keeps keyPath entries past the end of path", () => {
    expect(
      nextCtx(ctx(["a"], ["x", "y", "z"]), "f", "k").keyPath
    ).toStrictEqual(["x", "y", "z", "k"]);
  });

  it("turns holes in keyPath into undefined entries", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [, "y", , "w"];
    expect(
      nextCtx(ctx(["a", "b", "c", "d"], sparse), "f", "k").keyPath
    ).toStrictEqual([undefined, "y", undefined, "w", "k"]);
  });

  it("appends undefined when no key is given", () => {
    expect(nextCtx(ctx(["a"], ["x"]), "f").keyPath).toStrictEqual([
      "x",
      undefined,
    ]);
  });

  it("leaves the incoming context unchanged", () => {
    const path = ["a", "b"];
    const keyPath = ["x"];
    const parent = ctx(path, keyPath);
    nextCtx(parent, "c", "k");
    expect(parent).toStrictEqual({ site, node: {}, path, keyPath });
    expect(path).toStrictEqual(["a", "b"]);
    expect(keyPath).toStrictEqual(["x"]);
  });
});

describe("walkModelTree", () => {
  const loadStarter = () => {
    const tuples: [string, any][] = JSON.parse(
      readFileSync(
        "src/wab/shared/web-exporter/bundles/starter-project-desktop-first.json",
        "utf8"
      )
    );
    const bundler = new Bundler();
    const roots = tuples.map(([uuid, bundle]) =>
      bundler.unbundle(bundle, uuid)
    );
    return ensureKnownSite(roots[roots.length - 1]);
  };

  const walkWithContexts = (
    ctx: NodeFieldCtx,
    walked: ObjInst[] = []
=======
  jsonClone,
  mkUuid,
} from "@/wab/shared/common";
import { instUtil } from "@/wab/shared/model/InstUtil";
import {
  ObjInst,
  Site,
  ensureKnownSite,
  isKnownProjectDependency,
} from "@/wab/shared/model/classes";
import { meta } from "@/wab/shared/model/classes-metas";
import { isWeakRefField } from "@/wab/shared/model/model-meta";
import { NodeCtx, walkModelTree } from "@/wab/shared/model/model-tree-util";
import { tryMerge } from "@/wab/shared/site-diffs/merge-core";
import _starterBundle from "@/wab/shared/web-exporter/bundles/starter-project-desktop-first.json";
import { readFileSync } from "fs";

const PRINT_BENCHMARKS = false;

const starterBundle = _starterBundle as [string, Bundle][];
const loadStarter = () => generateSiteFromBundle(starterBundle);
// require cannot resolve the @/ alias for this file, so read it from disk.
const plexusBundle = (): [string, Bundle][] =>
  JSON.parse(
    readFileSync("src/wab/server/pkg-mgr/data/plexus-master-pkg.json", "utf8"),
  );
const loadPlexus = () => generateSiteFromBundle(plexusBundle());

describe("NodeCtx", () => {
  const site = {} as Site;
  const at = (path: string[], node: any = {}) =>
    NodeCtx.at({ site, node, path });

  it("roots a ctx at the site", () => {
    const realSite = loadStarter();
    const root = NodeCtx.root(realSite);
    expect(root.site).toBe(realSite);
    expect(root.node).toBe(realSite);
    expect(root.path()).toEqual([]);
    expect(root.keyedPath()).toEqual([]);
  });

  it("starts a ctx at a given path", () => {
    const node = {};
    const ctx = at(["components", "iid=1"], node);
    expect(ctx.site).toBe(site);
    expect(ctx.node).toBe(node);
    expect(ctx.path()).toEqual(["components", "iid=1"]);
    expect(ctx.keyedPath()).toEqual(["components", "iid=1"]);
  });

  it("reads a child's node from the parent's node", () => {
    const child = {};
    expect(at([], { f: child }).child("f").node).toBe(child);
    expect(
      at([], { f: [1, child] })
        .child("f")
        .child("1").node,
    ).toBe(child);
    expect(at([], undefined).child("f").node).toBeUndefined();
    expect(at([], null).child("f").node).toBeUndefined();
    expect(at([], {}).child("f").child("g").node).toBeUndefined();
  });

  it("gives a child the parent's site", () => {
    expect(at(["a"]).child("f").child("g").site).toBe(site);
  });

  it("uses keys in keyedPath and indexes in path", () => {
    const ctx = at(["components", "3"])
      .child("tplTree")
      .child("children")
      .child("2", "iid=abc")
      .child("vsettings")
      .child("0", "iid=def")
      .child("attrs");
    expect(ctx.path()).toEqual([
      "components",
      "3",
      "tplTree",
      "children",
      "2",
      "vsettings",
      "0",
      "attrs",
    ]);
    expect(ctx.keyedPath()).toEqual([
      "components",
      "3",
      "tplTree",
      "children",
      "iid=abc",
      "vsettings",
      "iid=def",
      "attrs",
    ]);
  });

  it("keeps an empty key, like a key of any other value", () => {
    expect(at([]).child("0", "").keyedPath()).toEqual([""]);
  });

  it("leaves the parent's path unchanged", () => {
    const path = ["a", "b"];
    const parent = at(path);
    parent.child("c", "k").child("d");
    expect(parent.path()).toEqual(["a", "b"]);
    expect(parent.keyedPath()).toEqual(["a", "b"]);
    expect(path).toEqual(["a", "b"]);
  });

  it.each([{ prefix: [] }, { prefix: ["a"] }])(
    "returns fresh paths with root prefix $prefix",
    ({ prefix }) => {
      const parent = at(prefix);
      const ctx = parent.child("b", "key-b");
      ctx.path().push("x");
      ctx.keyedPath().push("x");
      expect(ctx.path()).toEqual([...prefix, "b"]);
      expect(ctx.keyedPath()).toEqual([...prefix, "key-b"]);
      expect(ctx.path()).not.toBe(ctx.path());
      expect(ctx.keyedPath()).not.toBe(ctx.keyedPath());
      expect(parent.path()).toEqual(prefix);
    },
  );
});

describe("walkModelTree", () => {
  const walkWithContexts = (
    ctx: NodeCtx,
    walked: ObjInst[] = [],
>>>>>>> upstream/master
  ): ObjInst[] => {
    const val = ctx.node;
    if (isPrimitive(val)) {
      return walked;
    } else if (Array.isArray(val)) {
<<<<<<< HEAD
      val.forEach((_v, i) => walkWithContexts(nextCtx(ctx, `${i}`), walked));
    } else if (isLiteralObject(val)) {
      Object.keys(val).forEach((k) =>
        walkWithContexts(nextCtx(ctx, k), walked)
      );
=======
      val.forEach((_v, i) => walkWithContexts(ctx.child(`${i}`), walked));
    } else if (isLiteralObject(val)) {
      Object.keys(val).forEach((k) => walkWithContexts(ctx.child(k), walked));
>>>>>>> upstream/master
    } else if (instUtil.isObjInst(val)) {
      walked.push(val);
      meta
        .allFields(instUtil.getInstClass(val))
        .filter((field) => !isWeakRefField(field))
<<<<<<< HEAD
        .forEach((field) => walkWithContexts(nextCtx(ctx, field.name), walked));
=======
        .forEach((field) => walkWithContexts(ctx.child(field.name), walked));
>>>>>>> upstream/master
    }
    return walked;
  };

<<<<<<< HEAD
  it("returns the instances in the order a nextCtx walk reaches them", () => {
    const site = loadStarter();
    const walked = walkModelTree(createNodeCtx(site));
    const expected = walkWithContexts(createNodeCtx(site));
    expect(walked[0]).toBe(site);
    expect(walked.length).toBe(expected.length);
    expect(walked.findIndex((inst, i) => inst !== expected[i])).toBe(-1);
  });

  it("does not follow weak references", () => {
    const site = loadStarter();
    const walked = walkModelTree(createNodeCtx(site));
=======
  it.each([
    ["starter", loadStarter],
    ["plexus", loadPlexus],
  ])(
    "returns the %s instances in the order a NodeCtx walk reaches them",
    (_name, load) => {
      const site = load();
      const walked = walkModelTree(NodeCtx.root(site));
      const expected = walkWithContexts(NodeCtx.root(site));
      expect(walked[0]).toBe(site);
      expect(walked.length).toBe(expected.length);
      expect(walked.findIndex((inst, i) => inst !== expected[i])).toBe(-1);
    },
  );

  it("does not follow weak references", () => {
    const site = loadStarter();
    const walked = walkModelTree(NodeCtx.root(site));
>>>>>>> upstream/master
    expect(site.projectDependencies).not.toHaveLength(0);
    // site.activeTheme is a weak reference to a theme in site.themes. If the
    // walk followed weak references, that theme would appear twice.
    site.projectDependencies.forEach((dep) => {
      expect(walked).not.toContain(dep);
      expect(walked).not.toContain(dep.site);
    });
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("throws an AssertionError when the context has no node", () => {
    const walk = () =>
<<<<<<< HEAD
      walkModelTree({ node: undefined, site: {} as Site, path: [] });
=======
      walkModelTree(
        NodeCtx.at<ObjInst>({ site: {} as Site, node: undefined, path: [] }),
      );
>>>>>>> upstream/master
    expect(walk).toThrow(AssertionError);
    expect(walk).toThrow("inst must be defined");
  });

  it("throws an InvalidCodePathError on a value that is not part of the model", () => {
    const site = loadStarter();
    site.components[0].metadata = { k: new Date(0) } as any;
<<<<<<< HEAD
    expect(() => walkModelTree(createNodeCtx(site))).toThrow(
      InvalidCodePathError
    );
  });
});
=======
    expect(() => walkModelTree(NodeCtx.root(site))).toThrow(
      InvalidCodePathError,
    );
  });
});

describe("benchmarks", () => {
  function bench(name: string, f: () => void) {
    if (!PRINT_BENCHMARKS) {
      f();
      return;
    }
    for (let i = 0; i < 5; i++) {
      f();
    }
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      f();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = (times[9] + times[10]) / 2;
    console.log(`${name}: ${median.toFixed(1)} ms (median of 20)`);
  }

  it.each([
    ["starter", loadStarter],
    ["plexus", loadPlexus],
  ])("walkModelTree(%s)", (name, load) => {
    const site = load();
    bench(`walkModelTree(${name})`, () => {
      walkModelTree(NodeCtx.root(site));
    });
  });

  // One branch edits every component and the other edits every component's
  // root, so the merge takes both sides' changes without conflicts. Merges
  // skip components whose updatedAt is unchanged.
  const editComponents = (site: Site, updatedAt: number) =>
    site.components.forEach((component) => {
      component.metadata = { ...component.metadata, bench: "left" };
      component.updatedAt = updatedAt;
    });
  const editRoots = (site: Site, updatedAt: number) =>
    site.components.forEach((component) => {
      const vs = component.tplTree.vsettings[0];
      vs.rs.values = { ...vs.rs.values, "margin-top": "123px" };
      component.updatedAt = updatedAt;
    });

  describe.each([
    ["starter", starterBundle, it],
    // Plexus merges take about a second, so only run them to print timings.
    ["plexus", plexusBundle(), it.skipIf(!PRINT_BENCHMARKS)],
  ] as const)("tryMerge(%s)", (name, bundles, maybeIt) => {
    // Unbundle the deps once, then the site under a fresh uuid for each copy.
    const freshSites = () => {
      const bundler = new Bundler();
      bundles
        .slice(0, -1)
        .forEach(([uuid, bundle]) => bundler.unbundle(jsonClone(bundle), uuid));
      const [, siteBundle] = bundles[bundles.length - 1];
      const freshSite = () => {
        const inst = bundler.unbundle(jsonClone(siteBundle), mkUuid());
        return ensureKnownSite(
          isKnownProjectDependency(inst) ? inst.site : inst,
        );
      };
      return { bundler, freshSite };
    };

    maybeIt("no-op", () => {
      const { bundler, freshSite } = freshSites();
      const ancestor = freshSite();
      const left = freshSite();
      const right = freshSite();
      bench(`no-op tryMerge(${name})`, () => {
        const merged = freshSite();
        expect(
          tryMerge(ancestor, left, right, merged, bundler, undefined).status,
        ).toBe("merged");
      });
    });

    maybeIt("edited components", () => {
      const { bundler, freshSite } = freshSites();
      const ancestor = freshSite();
      const left = freshSite();
      const right = freshSite();
      editComponents(left, 1);
      editRoots(right, 2);
      expect(left.components).not.toHaveLength(0);
      bench(`edited components tryMerge(${name})`, () => {
        const merged = freshSite();
        expect(
          tryMerge(ancestor, left, right, merged, bundler, undefined).status,
        ).toBe("merged");
        merged.components.forEach((component) => {
          expect(component.metadata.bench).toBe("left");
          expect(component.tplTree.vsettings[0].rs.values["margin-top"]).toBe(
            "123px",
          );
        });
      });
    });
  });
});
>>>>>>> upstream/master
