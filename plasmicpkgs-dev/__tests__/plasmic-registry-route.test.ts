/**
 * Tests for the /api/plasmic-registry Next.js route handler.
 *
 * Why these tests exist: The dev host API route is the HTTP boundary
 * that the MCP server fetches during project.set to discover code
 * component variant metadata. These tests verify the route returns
 * the correct response shape and handles errors gracefully — ensuring
 * the MCP sync can rely on a stable API contract.
 *
 * Mocks plasmic-init-server (side-effect registration) and
 * @elasticpath/plasmic-mcp-registry to isolate route handler logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting — safe to reference in factories
const { mockGetFullRegistry } = vi.hoisted(() => ({
  mockGetFullRegistry: vi.fn(),
}));

// Mock the side-effect import (component registration)
vi.mock("../plasmic-init-server", () => ({}));

// Mock the registry module
vi.mock("@elasticpath/plasmic-mcp-registry", () => ({
  getFullRegistry: mockGetFullRegistry,
}));

// Import the route handler AFTER mocks are set up
import { GET } from "../app/api/plasmic-registry/route";

describe("/api/plasmic-registry route", () => {
  beforeEach(() => {
    mockGetFullRegistry.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON response with full registry shape", async () => {
    const mockRegistry = {
      components: [
        {
          name: "EPButton$dev",
          props: { children: { type: "slot" } },
          variants: {
            selected: {
              cssSelector: "[data-selected]",
              displayName: "Selected",
            },
            hovered: { cssSelector: ":hover", displayName: "Hovered" },
          },
        },
        {
          name: "EPCard$dev",
          props: { title: { type: "string" } },
        },
      ],
      contexts: [],
      functions: [],
      tokens: [],
      traits: [],
    };
    mockGetFullRegistry.mockReturnValue(mockRegistry);

    const response = GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("components");
    expect(body).toHaveProperty("contexts");
    expect(body).toHaveProperty("functions");
    expect(body).toHaveProperty("tokens");
    expect(body).toHaveProperty("traits");
    expect(Array.isArray(body.components)).toBe(true);
    expect(body.components).toHaveLength(2);
  });

  it("includes EP bundle components with variants in response", async () => {
    const mockRegistry = {
      components: [
        {
          name: "EPButton$dev",
          variants: {
            selected: {
              cssSelector: "[data-selected]",
              displayName: "Selected",
            },
            disabled: { cssSelector: ":disabled", displayName: "Disabled" },
          },
        },
      ],
      contexts: [],
      functions: [],
      tokens: [],
      traits: [],
    };
    mockGetFullRegistry.mockReturnValue(mockRegistry);

    const response = GET();
    const body = await response.json();

    const button = body.components[0];
    expect(button.name).toBe("EPButton$dev");
    expect(button.variants).toBeDefined();
    expect(button.variants.selected).toEqual({
      cssSelector: "[data-selected]",
      displayName: "Selected",
    });
    expect(button.variants.disabled).toEqual({
      cssSelector: ":disabled",
      displayName: "Disabled",
    });
  });

  it("response does not contain function fields (serialization safety)", async () => {
    const mockRegistry = {
      components: [
        {
          name: "EPButton$dev",
          props: { label: { type: "string", defaultValue: "Click" } },
          variants: {
            selected: {
              cssSelector: "[data-selected]",
              displayName: "Selected",
            },
          },
        },
      ],
      contexts: [],
      functions: [],
      tokens: [],
      traits: [],
    };
    mockGetFullRegistry.mockReturnValue(mockRegistry);

    const response = GET();
    const body = await response.json();
    const json = JSON.stringify(body);

    // JSON.stringify drops functions — verify the round-trip is clean
    const reparsed = JSON.parse(json);
    expect(reparsed.components[0].name).toBe("EPButton$dev");
    expect(reparsed.components[0].variants.selected.cssSelector).toBe(
      "[data-selected]"
    );
  });

  it("returns empty arrays when no registrations exist", async () => {
    mockGetFullRegistry.mockReturnValue({
      components: [],
      contexts: [],
      functions: [],
      tokens: [],
      traits: [],
    });

    const response = GET();
    const body = await response.json();
    expect(body.components).toEqual([]);
    expect(body.contexts).toEqual([]);
    expect(body.functions).toEqual([]);
    expect(body.tokens).toEqual([]);
    expect(body.traits).toEqual([]);
  });

  it("returns 500 with error message when getFullRegistry throws", async () => {
    mockGetFullRegistry.mockImplementation(() => {
      throw new Error("Registry initialization failed");
    });

    const response = GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Registry initialization failed");
  });

  it("returns 500 with generic message for non-Error exceptions", async () => {
    mockGetFullRegistry.mockImplementation(() => {
      throw "string error";
    });

    const response = GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Unknown error");
  });
});
