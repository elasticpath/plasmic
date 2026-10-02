import {
  Class,
  Field,
  MetaRuntime,
  Type,
  withoutUids,
} from "@/wab/shared/model/model-meta";

describe("model-meta", () => {
  it("should stamp seen references", function () {
    let x = { uid: 111 } as any;
    x.x = x;
    expect(withoutUids(x)).toEqual({ x: "[seen@0]" });
    x = { uid: 111 } as any;
    x.x = { uid: 222 } as any;
    x.y = x.x;
    return expect(withoutUids(x)).toEqual({ x: {}, y: "[seen@1]" });
  });

  describe("initializers", () => {
    const field = (name: string, annotations: Field["annotations"] = []) =>
      new Field({ name, type: new Type({ type: "Any", params: [] }), annotations });
    const mkSchema = () => [
      new Class({
        name: "Base",
        base: null,
        concrete: false,
        fields: [field("c")],
      }),
      new Class({
        name: "Foo",
        base: "Base",
        concrete: true,
        fields: [field("a"), field("b"), field("t", ["Transient"])],
      }),
    ];
    const mkRt = () => new MetaRuntime(mkSchema(), 0);

    class FooInst {}

    // The behavior before __type was left out: assign everything, then delete.
    const oldInit = (args: any) => {
      const inst: any = Object.assign(new FooInst(), args);
      if ("__type" in args) {
        delete inst["__type"];
      }
      inst.uid = 1;
      return inst;
    };

    const shape = (inst: any) => ({
      keys: Reflect.ownKeys(inst),
      descriptors: Object.getOwnPropertyDescriptors(inst),
      proto: Object.getPrototypeOf(inst),
    });

    const orders: Record<string, any>[] = [
      { __type: "Foo", a: 1, b: 2, c: 3 },
      { a: 1, __type: "Foo", b: 2, c: 3 },
      { a: 1, b: 2, c: 3, __type: "Foo" },
      { c: { x: 1 }, b: [1], __type: "Foo", a: "s" },
    ];

    it.each(orders.map((o) => [Object.keys(o).join(","), o]))(
      "ends like assign-then-delete, __type order %s",
      (_name, args) => {
        const rt = mkRt();
        const before = JSON.stringify(args);
        // Run twice so the second call takes the cache-hit path.
        for (let i = 0; i < 2; i++) {
          const inst = rt.initializers.Foo(new FooInst(), args);
          const expected = oldInit(args);
          expected.uid = inst.uid;
          expect(shape(inst)).toEqual(shape(expected));
          expect(Object.getOwnPropertyDescriptor(inst, "__type")).toBeUndefined();
          expect("__type" in inst).toBe(false);
        }
        expect(JSON.stringify(args)).toEqual(before);
        expect("__type" in args).toBe(true);
      }
    );

    it("takes the unchanged path without __type", () => {
      const inst = mkRt().initializers.Foo(new FooInst(), { a: 1, b: 2, c: 3 });
      expect(Object.keys(inst)).toEqual(["a", "b", "c", "uid"]);
    });

    it("treats null args as empty and reports missing fields", () => {
      expect(() => mkRt().initializers.Foo(new FooInst(), null)).toThrow(
        "Unexpected fields on [Foo]:\n- a\n- b\n- c"
      );
    });

    it("keeps error class and message for crafted bundle data", () => {
      const rt = mkRt();
      const args = { __type: "Foo", a: 1, b: 2, c: 3, zzz: 4 };
      let err: any;
      try {
        rt.initializers.Foo(new FooInst(), args);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toEqual("Unexpected fields on [Foo]:\n+ zzz");
      expect(() => rt.initializers.Base(new FooInst(), {})).toThrow(
        "cannot instantiate abstract class"
      );
    });

    describe("non-strict mode", () => {
      let warn: jest.SpyInstance;
      beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      });
      afterEach(() => warn.mockRestore());

      it("still ends like assign-then-delete, including a JSON __proto__ key", () => {
        const rt = mkRt();
        rt.setStrict(false);
        const args = JSON.parse(
          '{"a":1,"__type":"Foo","__proto__":{"p":1},"b":2,"c":3,"zzz":4}'
        );
        const inst = rt.initializers.Foo(new FooInst(), args);
        const expected = oldInit(args);
        expected.uid = inst.uid;
        expect(shape(inst)).toEqual(shape(expected));
        expect(Object.getPrototypeOf(inst)).toEqual({ p: 1 });
        expect(warn).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("field caches", () => {
    const mk = () => {
      const base = new Class({
        name: "Base",
        base: null,
        concrete: false,
        fields: [
          new Field({
            name: "c",
            type: new Type({ type: "Any", params: [] }),
            annotations: [],
          }),
        ],
      });
      const foo = new Class({
        name: "Foo",
        base: "Base",
        concrete: true,
        fields: [
          new Field({
            name: "t",
            type: new Type({ type: "Any", params: [] }),
            annotations: ["Transient"],
          }),
        ],
      });
      return { rt: new MetaRuntime([base, foo], 0), foo };
    };

    it("returns the same values on a cache miss and a cache hit", () => {
      const { rt, foo } = mk();
      const miss = [
        rt.allFields(foo),
        rt.allFieldKeys(foo),
        rt.allTransientFieldKeys(foo),
      ];
      const hit = [
        rt.allFields(foo),
        rt.allFieldKeys(foo),
        rt.allTransientFieldKeys(foo),
      ];
      expect(hit[0]).toBe(miss[0]);
      expect(hit[1]).toBe(miss[1]);
      expect(hit[2]).toBe(miss[2]);
      expect(hit[0].map((f) => f.name)).toEqual(["t", "c"]);
      expect([...(hit[1] as Set<string>)]).toEqual(["t", "c"]);
      expect([...(hit[2] as Set<string>)]).toEqual(["t"]);
    });

    it("throws on an undefined class as before", () => {
      expect(() => mk().rt.allFields(undefined as any)).toThrow(TypeError);
    });
  });
});
