import compression from "compression";
import type express from "express";
import zlib from "zlib";

export function addStudioCompression(app: express.Application) {
  app.use(
    countBytesSent,
    compression({
      threshold: 0,
      level: 6,
      brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
      filter: recordLengthAndFilter,
    })
  );
}

export function loggedResponseSizes(res: express.Response) {
  return {
    contentLength:
      res.locals.uncompressedContentLength ?? res.get("content-length"),
    contentLengthSent: res.locals.contentLengthSent,
  };
}

// Runs before compression removes Content-Length. compression has no check
// of its own for bodiless statuses.
function recordLengthAndFilter(req: express.Request, res: express.Response) {
  res.locals.uncompressedContentLength = res.getHeader("content-length");
  return (
    res.statusCode !== 204 &&
    res.statusCode !== 304 &&
    compression.filter(req, res)
  );
}

function countBytesSent(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  res.locals.contentLengthSent = 0;
  res.write = countingSentBytes(res, res.write);
  res.end = countingSentBytes(res, res.end);
  next();
}

function countingSentBytes<F extends (...args: any[]) => any>(
  res: express.Response,
  send: F
) {
  return function (this: express.Response, ...args: Parameters<F>) {
    res.locals.contentLengthSent += byteLength(args[0], args[1]);
    return send.apply(this, args);
  } as F;
}

function byteLength(chunk: unknown, encoding: unknown) {
  if (typeof chunk === "string") {
    return Buffer.byteLength(
      chunk,
      typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8"
    );
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
}
