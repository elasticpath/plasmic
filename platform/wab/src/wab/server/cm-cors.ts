import cors from "cors";
import express, { RequestHandler } from "express";
import { safeCast } from "@/wab/shared/common";
import { logger } from "@/wab/server/observability";

// CORS configuration restricted to Commerce Manager origins

// Regex for *.cm.elasticpath.com (any subdomain, alphanumerics and hyphens only)
const cmOriginPattern = /^https:\/\/[a-zA-Z0-9-]+\.cm\.elasticpath\.com$/;

// Regex for Vercel preview deployments: {MR_NUMBER}--{env}-commerce-manager.vercel.app
const cmPreviewOriginPattern =
  /^https:\/\/\d+--[a-zA-Z0-9-]+-commerce-manager\.vercel\.app$/;

// Regex for Vercel production deployments: {env}-commerce-manager.vercel.app
// Used by main branch CI pipelines that test against Vercel URLs directly
const cmVercelProdOriginPattern =
  /^https:\/\/[a-zA-Z0-9]+-commerce-manager\.vercel\.app$/;

// localhost for development
const cmLocalOrigin = "http://localhost:3000";

export function isCmOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === cmLocalOrigin) return true;
  if (cmOriginPattern.test(origin)) return true;
  if (cmPreviewOriginPattern.test(origin)) return true;
  if (cmVercelProdOriginPattern.test(origin)) return true;
  logger().warn(`CM CORS rejected origin: ${origin}`);
  return false;
}

const cmCorsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isCmOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
};

export const cmCors = cors(cmCorsOptions);

export function cmCorsPreflight() {
  const corsHandler = cors({
    ...cmCorsOptions,
    maxAge: 30 * 24 * 60 * 60,
    // Must explicitly list headers - wildcards don't work with credentials: true
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "Pragma",
    ],
  });

  const handler: express.RequestHandler = safeCast<RequestHandler>(
    async (req, res, next) => {
      res.set(
        "Cache-Control",
        `max-age=${30 * 24 * 60 * 60}, s-maxage=${30 * 24 * 60 * 60}`
      );
      corsHandler(req, res, next);
    }
  );
  return handler;
}
