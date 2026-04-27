/**
 * Server-side data fetching for EPProductListProvider.
 *
 * Fetches paginated product list from EP catalog API during prepass.
 */

export interface ProductListServerOptions {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  search?: string;
  sort?: string;
}

export async function fetchProductListForServer(
  serverToken: string,
  host: string,
  options: ProductListServerOptions
): Promise<any> {
  const { page = 0, pageSize = 12, categoryId, search, sort } = options;

  const params = new URLSearchParams({
    "include": "main_image",
    "page[limit]": String(pageSize),
    "page[offset]": String(page * pageSize),
  });

  if (categoryId) {
    params.set("filter", `eq(category.id,${categoryId})`);
  }
  if (search) {
    const existing = params.get("filter");
    const searchFilter = `eq(name,${search})`;
    params.set("filter", existing ? `and(${existing},${searchFilter})` : searchFilter);
  }
  if (sort) {
    params.set("sort", sort);
  }

  const url = `${host}/catalog/products?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${serverToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`EP product list fetch failed (${response.status}): ${text}`);
  }

  return response.json();
}

export function epProductListGetServerInfo(
  props: Record<string, any>,
  ops: any
): any {
  const serverToken = ops.readContext("ep-server-token");
  const host = ops.readContext("ep-host") ?? "https://useast.api.elasticpath.com";

  if (!serverToken) return {};

  const options: ProductListServerOptions = {
    page: props.page ?? 0,
    pageSize: props.pageSize ?? 12,
    categoryId: props.categoryId,
    search: props.search,
    sort: props.sort,
  };

  const cacheKey = [
    "ep-product-list",
    options.categoryId ?? "",
    options.search ?? "",
    options.sort ?? "",
    options.page,
    options.pageSize,
  ];

  const data = ops.fetchData(cacheKey, () =>
    fetchProductListForServer(serverToken, host, options)
  );

  return {
    providedData: [{ name: "epProductList", data }],
  };
}
