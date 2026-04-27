import { PLASMIC } from "@/plasmic-init";
import "@/plasmic-register";
import { PlasmicClientRootProvider } from "@/plasmic-init-client";
import { PlasmicComponent } from "@plasmicapp/loader-nextjs";
import { DataProvider } from "@plasmicapp/host";
import { buildEpCtx } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { epAuth, epProviderHeaders } from "@/lib/ep-auth";

export const revalidate = 60;

interface Params {
  catchall: string[] | undefined;
}

export default async function PlasmicLoaderPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const plasmicPath = resolvedParams.catchall
    ? `/${resolvedParams.catchall.join("/")}`
    : "/";

  const prefetchedData = await PLASMIC.maybeFetchComponentData(plasmicPath);
  if (!prefetchedData || prefetchedData.entryCompMetas.length === 0) {
    notFound();
  }

  const pageMeta = prefetchedData.entryCompMetas[0];

  // ---------------------------------------------------------------------------
  // EP Auth: resolve session from cookies (returning) or OAuth (first visit)
  // ---------------------------------------------------------------------------
  const cookieStore = await cookies();
  const session = await epAuth.api.getSession({
    cookies: Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value])
    ),
    headers: await epProviderHeaders(prefetchedData),
  });

  // Next 15 forbids cookie writes in plain RSC pages. Swallow — the
  // `/api/ep/*` handler persists cookies on the next request.
  try {
    session.commitCookies({
      appendHeader(_name: string, value: string) {
        const [nameVal] = value.split(";");
        const [cookieName, ...rest] = nameVal.split("=");
        cookieStore.set(cookieName.trim(), rest.join("=").trim(), {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 2592000,
        });
      },
    });
  } catch {}

  // ---------------------------------------------------------------------------
  // Build $ctx.ep + run Studio Server Queries (PRD #262)
  // ---------------------------------------------------------------------------
  const epCtx = buildEpCtx(prefetchedData, {
    session: {
      accessToken: session.session?.accessToken,
      cartId: session.cart?.id ?? undefined,
      accountId: session.user?.accountId ?? undefined,
    },
  });

  const queryCtx = {
    pageRoute: pageMeta.path,
    pagePath: plasmicPath,
    params: pageMeta.params ?? {},
    query: resolvedSearchParams,
    ep: epCtx,
  };
  // When a page has no Server Queries defined, `unstable__getServerQueriesData`
  // returns `{}` and client-side SWR falls through (backward compatible).
  const prefetchedQueryData = await PLASMIC.unstable__getServerQueriesData(
    prefetchedData,
    queryCtx
  );

  const globalContextsProps = {
    "plasmic-commerce-elastic-path-provider": session.providerProps(),
  };

  return (
    <PlasmicClientRootProvider
      prefetchedData={prefetchedData}
      prefetchedQueryData={prefetchedQueryData}
      globalContextsProps={globalContextsProps}
      pageParams={pageMeta.params}
      pageQuery={queryCtx.query}
    >
      {/* Expose $ctx.ep to the client-side render. Studio Server Queries
          build a cache key that includes $ctx.ep — the client must see the
          same object so its SWR key matches `prefetchedQueryData` and avoids
          an unauthenticated refetch. */}
      <DataProvider name="ep" data={epCtx}>
        <PlasmicComponent component={pageMeta.displayName} />
      </DataProvider>
    </PlasmicClientRootProvider>
  );
}
