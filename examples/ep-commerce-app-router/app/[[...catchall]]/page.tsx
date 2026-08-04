import { PLASMIC } from "@/plasmic-init";
import "@/plasmic-register";
import { PlasmicClientRootProvider } from "@/plasmic-init-client";
import { PlasmicComponent } from "@plasmicapp/loader-nextjs";
import {
  buildEpCtx,
  withEpSession,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { epAuth, EP_HOST_ALLOWLIST } from "@/lib/ep-auth";

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
  });

  // No cookie writes here: Next forbids them in plain RSC pages, so session
  // bootstrap belongs to `epAuthMiddleware`, which runs before this page.

  // ---------------------------------------------------------------------------
  // Build EP session context + run Studio Server Queries (PRD #262 / #272)
  // ---------------------------------------------------------------------------
  const epCtx = buildEpCtx(prefetchedData, {
    session: {
      accessToken: session.session?.accessToken,
      cartId: session.cart?.id ?? undefined,
      accountId: session.user?.accountId ?? undefined,
    },
    hostAllowlist: EP_HOST_ALLOWLIST,
  });

  const queryCtx = {
    pageRoute: pageMeta.path,
    pagePath: plasmicPath,
    params: pageMeta.params ?? {},
    query: resolvedSearchParams,
  };
  // EP session flows via AsyncLocalStorage (PRD #272). Each `ep.*` server
  // function reads the active session via `getCurrentEpSession()` — no
  // `auth: $ctx.ep` binding needed in Studio Server Queries, no
  // `<DataProvider name="ep">` wrap needed for SWR cache-key parity.
  const prefetchedQueryData = await withEpSession(epCtx, () =>
    PLASMIC.unstable__getServerQueriesData(prefetchedData, queryCtx)
  );

  // The `$dev` suffix matches `registerWithDevMeta`'s convention in
  // plasmic-register-dev-meta.ts. When registering for production
  // (without dev-meta), drop the suffix here too so the component name
  // matches what's actually registered.
  const globalContextsProps = {
    "plasmic-commerce-elastic-path-provider$dev": session.providerProps(),
  };

  return (
    <PlasmicClientRootProvider
      prefetchedData={prefetchedData}
      prefetchedQueryData={prefetchedQueryData}
      globalContextsProps={globalContextsProps}
      pageParams={pageMeta.params}
      pageQuery={queryCtx.query}
    >
      <PlasmicComponent component={pageMeta.displayName} />
    </PlasmicClientRootProvider>
  );
}
