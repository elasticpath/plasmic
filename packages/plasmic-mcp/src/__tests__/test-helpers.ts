/**
 * Shared test helpers for domain test files.
 *
 * Extracted from edit-tools.test.ts to avoid duplication across domain test files.
 * These helpers create mock objects needed by most edit-tool function tests:
 *   - mockApiClient: fake API client with saveRevision spy
 *   - makeSession: fake session with required fields
 *   - mkTag: quick TplTag node builder
 *   - mkComponent: component fixture builder
 *   - setupEditToolsSession: common beforeEach pattern for edit-tool tests
 */

import { vi } from "vitest";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

/** Create a mock PlasmicApiClient with a saveRevision spy */
export function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as unknown as PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };
}

/** Create a Session object with sensible defaults */
export function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test",
    site: { components: [] },
    bundler: {
      fastBundle: mockFastBundle,
      addrOf: mockAddrOf,
      bundle: vi.fn().mockReturnValue({ map: {}, root: "0" }),
    },
    revisionNum: 10,
    modelVersion: 5,
    hostlessDataVersion: 2,
    projectUuid: "proj1",
    ...overrides,
  };
}

/** Build a TplTag node with optional children and text */
export function mkTag(opts: {
  uuid?: string;
  name?: string;
  tag?: string;
  text?: string;
  children?: any[];
  styles?: Record<string, string>;
}): any {
  const vs: any = {
    rs: { values: { ...(opts.styles ?? {}) } },
  };
  if (opts.text !== undefined) {
    vs.text = { _type: "RawText", text: opts.text, markers: [] };
  }
  return {
    _type: "TplTag",
    uuid: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2, 8)}`,
    name: opts.name,
    tag: opts.tag ?? "div",
    vsettings: [vs],
    children: opts.children ?? [],
  };
}

/** Build a component with a tplTree */
export function mkComponent(opts: {
  uuid?: string;
  name?: string;
  tplTree: any;
}): any {
  return {
    uuid: opts.uuid ?? "comp-uuid",
    name: opts.name ?? "TestComponent",
    tplTree: opts.tplTree,
    pageMeta: undefined,
  };
}
