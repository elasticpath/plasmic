/**
 * @jest-environment jsdom
 */

// Tests for the SWR-based useLocations hook.
// Verifies query key construction (type filter, "__all__" default), fetcher
// logic (all locations, type-filtered requests), disabled state, and error
// propagation.

import { renderHook } from "@testing-library/react";

// --- Mocks (must come before require() of code under test) ---------------
// NOTE: esbuild hoists `import` to require() at the top, BEFORE jest.mock
// calls. Use require() for modules whose deps need mocking so they load
// AFTER mocks are registered.

let capturedQueryKey: any = null;
let capturedFetcher: (() => Promise<any>) | null = null;
let capturedOptions: any = null;
const mockMutate = jest.fn();

jest.mock("@plasmicapp/query", () => ({
  useMutablePlasmicQueryData: jest.fn(
    (key: any, fetcher: any, options: any) => {
      capturedQueryKey = key;
      capturedFetcher = key ? fetcher : null;
      capturedOptions = options;
      return {
        data: undefined,
        error: undefined,
        isLoading: !!key,
        mutate: mockMutate,
      };
    }
  ),
}));

const mockListLocations = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  listLocations: (...args: any[]) => mockListLocations(...args),
}));

const mockClient = { baseUrl: "https://test.epcc.io" };
jest.mock("../../shopper-context/EpCommerceContext", () => ({
  __esModule: true,
  useEpCommerce: () => ({ client: mockClient }),
}));

jest.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Import under test AFTER mocks — require() is not hoisted by esbuild
const { useLocations } =
  require("../use-locations") as typeof import("../use-locations");

// --- Helpers -------------------------------------------------------------

function makeLocation(id: string, name: string, type = "physical") {
  return {
    id,
    type: "inventory_location",
    attributes: {
      name,
      slug: id,
      type,
    },
  };
}

function makeLocationsResponse(locations: ReturnType<typeof makeLocation>[]) {
  return {
    data: {
      data: locations,
    },
  };
}

// --- Tests ---------------------------------------------------------------

describe("useLocations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedQueryKey = null;
    capturedFetcher = null;
    capturedOptions = null;
  });

  // -- Loading state --

  it("returns loading=true initially when query key is active", () => {
    const { result } = renderHook(() => useLocations());

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.locations).toEqual([]);
  });

  // -- Query key construction --

  it("sets query key to null when disabled", () => {
    renderHook(() => useLocations({ enabled: false }));

    expect(capturedQueryKey).toBeNull();
  });

  it("uses '__all__' as the type segment when no type filter provided", () => {
    renderHook(() => useLocations());

    expect(capturedQueryKey).toEqual(["ep-locations", "__all__"]);
  });

  it("uses '__all__' when called with an empty options object", () => {
    renderHook(() => useLocations({}));

    expect(capturedQueryKey).toEqual(["ep-locations", "__all__"]);
  });

  it("includes the type value in the query key when type is provided", () => {
    renderHook(() => useLocations({ type: "physical" as any }));

    expect(capturedQueryKey).toEqual(["ep-locations", "physical"]);
  });

  it("produces different query keys for different type filters", () => {
    renderHook(() => useLocations({ type: "virtual" as any }));
    const virtualKey = capturedQueryKey;

    renderHook(() => useLocations({ type: "physical" as any }));
    const physicalKey = capturedQueryKey;

    expect(virtualKey).not.toEqual(physicalKey);
  });

  // -- Fetcher: all locations --

  it("fetches all locations when no type filter is provided", async () => {
    const locations = [
      makeLocation("loc-1", "Warehouse One"),
      makeLocation("loc-2", "Store NY"),
    ];
    mockListLocations.mockResolvedValue(makeLocationsResponse(locations));

    renderHook(() => useLocations());
    const result = await capturedFetcher!();

    expect(mockListLocations).toHaveBeenCalledWith({
      client: mockClient,
      query: {},
    });
    expect(result).toEqual(locations);
  });

  it("returns locations array from response data", async () => {
    const locations = [makeLocation("loc-a", "Location A")];
    mockListLocations.mockResolvedValue(makeLocationsResponse(locations));

    renderHook(() => useLocations());
    const result = await capturedFetcher!();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("loc-a");
    expect(result[0].attributes.name).toBe("Location A");
  });

  // -- Fetcher: type filter --

  it("passes type filter as eq() filter query when type is provided", async () => {
    mockListLocations.mockResolvedValue(makeLocationsResponse([]));

    renderHook(() => useLocations({ type: "physical" as any }));
    await capturedFetcher!();

    expect(mockListLocations).toHaveBeenCalledWith({
      client: mockClient,
      query: { filter: "eq(type,physical)" },
    });
  });

  it("does not include filter in query when no type is specified", async () => {
    mockListLocations.mockResolvedValue(makeLocationsResponse([]));

    renderHook(() => useLocations());
    await capturedFetcher!();

    expect(mockListLocations).toHaveBeenCalledWith({
      client: mockClient,
      query: {},
    });
  });

  // -- Fetcher: empty / missing data --

  it("returns empty array when response data is empty", async () => {
    mockListLocations.mockResolvedValue(makeLocationsResponse([]));

    renderHook(() => useLocations());
    const result = await capturedFetcher!();

    expect(result).toEqual([]);
  });

  it("returns empty array when response data.data is null/undefined", async () => {
    mockListLocations.mockResolvedValue({ data: { data: null } });

    renderHook(() => useLocations());
    const result = await capturedFetcher!();

    expect(result).toEqual([]);
  });

  // -- SWR options --

  it("configures SWR with 5 minute dedupingInterval", () => {
    renderHook(() => useLocations());

    expect(capturedOptions).toMatchObject({
      revalidateOnFocus: false,
      dedupingInterval: 5 * 60 * 1000,
    });
  });

  // -- refetch --

  it("refetch triggers SWR mutate", () => {
    const { result } = renderHook(() => useLocations());

    result.current.refetch();

    expect(mockMutate).toHaveBeenCalled();
  });

  // -- Disabled state --

  it("returns empty locations array and loading=false when disabled", () => {
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() =>
      useLocations({ enabled: false })
    );

    expect(result.current.locations).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not call listLocations when disabled", () => {
    renderHook(() => useLocations({ enabled: false }));

    // capturedFetcher is null when queryKey is null
    expect(capturedFetcher).toBeNull();
    expect(mockListLocations).not.toHaveBeenCalled();
  });

  // -- Error state propagation --

  it("propagates SWR error to returned error field", () => {
    const swrError = new Error("Network timeout");
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: swrError,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useLocations());

    expect(result.current.error).toBe(swrError);
    expect(result.current.loading).toBe(false);
    expect(result.current.locations).toEqual([]);
  });

  it("returns empty locations array when SWR returns no data", () => {
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useLocations());

    expect(result.current.locations).toEqual([]);
  });

  it("returns loaded locations when SWR resolves with data", () => {
    const locations = [
      makeLocation("loc-1", "Warehouse"),
      makeLocation("loc-2", "Showroom"),
    ];
    const { useMutablePlasmicQueryData } = require("@plasmicapp/query");
    (useMutablePlasmicQueryData as jest.Mock).mockReturnValueOnce({
      data: locations,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useLocations());

    expect(result.current.locations).toEqual(locations);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
