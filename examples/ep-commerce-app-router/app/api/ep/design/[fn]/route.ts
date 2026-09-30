/**
 * Session-free catalog route for Studio design time (ADR-0003).
 *
 * Separate from `/api/ep/proxy/[fn]` on purpose: this one never reads the
 * shopper session, so it works in Studio's editing frame, where better-auth's
 * `SameSite=Lax` cookie does not travel once the app host is served from the
 * storefront's own registrable domain. It serves four catalog reads under a
 * bare implicit token and nothing else.
 */
import { createEpDesignRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createEpDesignRoutes(epAuth);

export const POST = routes.handle;
export const OPTIONS = routes.options;
