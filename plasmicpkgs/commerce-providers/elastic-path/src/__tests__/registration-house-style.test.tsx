/**
 * @jest-environment jsdom
 *
 * Guard: ADR-0004 house style for inert registrations, package-wide.
 */
import { render } from "@testing-library/react";
import React from "react";
import { registerAll } from "../index";
import { DEPRECATED_LEAD as LEAD } from "../utils/deprecated-lead";

/** Props hidden on purpose that still work. Any other always-hidden prop is inert. */
const LIVE_HIDDEN = new Set([
  "EP Cart (Inline) › inline",
  "EP Search Autocomplete › plugins",
]);

type Registered = { kind: string; component: any; meta: any };

function registered(): Registered[] {
  const collected: Registered[] = [];
  registerAll({
    registerComponent: (component: any, meta: any) =>
      collected.push({ kind: "component", component, meta }),
    registerGlobalContext: (component: any, meta: any) =>
      collected.push({ kind: "global context", component, meta }),
  } as never);
  return collected;
}

const all = registered();

type Prop = { where: string; prop: any };

function props(): Prop[] {
  return all.flatMap(({ meta }) =>
    Object.entries(meta.props ?? {}).map(([name, prop]) => ({
      where: `${meta.displayName ?? meta.name} › ${name}`,
      prop: typeof prop === "string" ? { type: prop } : prop,
    }))
  );
}

function refActions(): { where: string; description?: string }[] {
  return all.flatMap(({ meta }) =>
    Object.entries(meta.refActions ?? {}).map(([name, action]: [string, any]) => ({
      where: `${meta.displayName ?? meta.name} › ${name}`,
      description: action.description,
    }))
  );
}

const isDeprecated = (description: unknown) =>
  typeof description === "string" && description.startsWith("Deprecated");

const alwaysHidden = (prop: any) =>
  typeof prop.hidden === "function" && prop.hidden.length === 0 && prop.hidden() === true;

const hidden = (prop: any) =>
  typeof prop.hidden === "function" && prop.hidden({}, null, {}) === true;

describe("registration house style (ADR-0004)", () => {
  it("registers components to check", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("hides every deprecated prop and slot, and marks deprecated event handlers advanced", () => {
    const bad = props()
      .filter(({ prop }) => isDeprecated(prop.description))
      .filter(
        ({ prop }) =>
          !hidden(prop) || (prop.type === "eventHandler" && prop.advanced !== true)
      )
      .map(({ where }) => where);
    expect(bad).toEqual([]);
  });

  it(`leads every deprecated or always-hidden prop description with "${LEAD}"`, () => {
    const bad = props()
      .filter(
        ({ where, prop }) =>
          isDeprecated(prop.description) ||
          (alwaysHidden(prop) && !LIVE_HIDDEN.has(where))
      )
      .filter(({ prop }) => !String(prop.description ?? "").startsWith(LEAD))
      .map(({ where, prop }) => `${where}: ${prop.description ?? "(no description)"}`);
    expect(bad).toEqual([]);
  });

  it(`leads every deprecated ref action description with "${LEAD}"`, () => {
    const bad = refActions()
      .filter(({ description }) => isDeprecated(description))
      .filter(({ description }) => !description!.startsWith(LEAD))
      .map(({ where, description }) => `${where}: ${description}`);
    expect(bad).toEqual([]);
  });

  const deprecated = all.filter(({ meta }) =>
    String(meta.displayName ?? "").includes("(deprecated)")
  );

  it("finds the deprecated components", () => {
    expect(deprecated.length).toBeGreaterThan(0);
  });

  it.each(deprecated.map((r) => [r.meta.displayName, r] as const))(
    "%s renders without throwing",
    (_name, { component }) => {
      expect(() =>
        render(React.createElement(component, {}, React.createElement("span")))
      ).not.toThrow();
    }
  );
});
