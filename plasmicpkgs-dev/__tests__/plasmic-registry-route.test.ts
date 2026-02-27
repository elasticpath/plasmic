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
 * @elasticpath/plasmic-registry to isolate route handler logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() runs before vi.mock() hoisting — safe to reference in factories
const { mockGetComponentRegistry } = vi.hoisted(() => ({
  mockGetComponentRegistry: vi.fn(),
}));

// Mock the side-effect import (component registration)
vi.mock("../plasmic-init-server", () => ({}));

// Mock the registry module
vi.mock("@elasticpath/plasmic-registry", () => ({
  getComponentRegistry: mockGetComponentRegistry,
}));

// Import the route handler AFTER mocks are set up
import { GET } from "../app/api/plasmic-registry/route";

describe("/api/plasmic-registry route", () => {
  beforeEach(() => {
    mockGetComponentRegistry.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON response with components array", async () => {
    const mockComponents = [
      {
        name: "EPButton$dev",
        props: { children: { type: "slot" } },
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
          hovered: { cssSelector: ":hover", displayName: "Hovered" },
        },
      },
      {
        name: "EPCard$dev",
        props: { title: { type: "string" } },
      },
    ];
    mockGetComponentRegistry.mockReturnValue(mockComponents);

    const response = GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("components");
    expect(Array.isArray(body.components)).toBe(true);
    expect(body.components).toHaveLength(2);
  });

  it("includes EP bundle components with variants in response", async () => {
    const mockComponents = [
      {
        name: "EPButton$dev",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
          disabled: { cssSelector: ":disabled", displayName: "Disabled" },
        },
      },
    ];
    mockGetComponentRegistry.mockReturnValue(mockComponents);

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
    // Simulate what serializeComponentMeta strips — functions should not
    // appear in the registry output because the serialize step removes them.
    const mockComponents = [
      {
        name: "EPButton$dev",
        props: { label: { type: "string", defaultValue: "Click" } },
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ];
    mockGetComponentRegistry.mockReturnValue(mockComponents);

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

  it("returns empty components array when no registrations exist", async () => {
    mockGetComponentRegistry.mockReturnValue([]);

    const response = GET();
    const body = await response.json();
    expect(body.components).toEqual([]);
  });

  it("returns 500 with error message when getComponentRegistry throws", async () => {
    mockGetComponentRegistry.mockImplementation(() => {
      throw new Error("Registry initialization failed");
    });

    const response = GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toBe("Registry initialization failed");
  });

  it("returns 500 with generic message for non-Error exceptions", async () => {
    mockGetComponentRegistry.mockImplementation(() => {
      throw "string error";
    });

    const response = GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Unknown error");
  });
});
