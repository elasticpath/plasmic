import cors from "cors";
import express, { RequestHandler } from "express";
import { safeCast } from "@/wab/shared/common";

// CORS configuration restricted to Commerce Manager origins

// Regex for *.cm.elasticpath.com (any subdomain)
const cmOriginPattern = /^https:\/\/[\w-]+\.cm\.elasticpath\.com$/;

// Regex for Vercel preview deployments: {MR_NUMBER}--{env}-commerce-manager.vercel.app
const cmPreviewOriginPattern =
  /^https:\/\/\d+--[\w-]+-commerce-manager\.vercel\.app$/;

// localhost for development
const cmLocalOrigin = "http://localhost:3000";

function isCmOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === cmLocalOrigin) return true;
  if (cmOriginPattern.test(origin)) return true;
  if (cmPreviewOriginPattern.test(origin)) return true;
  return false;
}

const cmCorsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (isCmOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export const cmCors = cors(cmCorsOptions);

export function cmCorsPreflight() {
  const corsHandler = cors({
    ...cmCorsOptions,
    maxAge: 30 * 24 * 60 * 60,
    allowedHeaders: "*",
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
