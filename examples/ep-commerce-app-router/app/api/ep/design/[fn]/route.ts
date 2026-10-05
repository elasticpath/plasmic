import { createEpDesignRoutes } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

const routes = createEpDesignRoutes(epAuth);

export const POST = routes.handle;
export const OPTIONS = routes.options;
