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
      filter: keepUncompressedLength,
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

// Runs before compression removes Content-Length.
function keepUncompressedLength(req: express.Request, res: express.Response) {
  res.locals.uncompressedContentLength = res.getHeader("content-length");
  return compression.filter(req, res);
}

function countBytesSent(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const write = res.write;
  const end = res.end;
  res.locals.contentLengthSent = 0;
  res.write = function (
    this: express.Response,
    chunk: unknown,
    encoding?: unknown
  ) {
    res.locals.contentLengthSent += byteLength(chunk, encoding);
    return write.apply(this, arguments as any);
  } as typeof res.write;
  res.end = function (
    this: express.Response,
    chunk?: unknown,
    encoding?: unknown
  ) {
    res.locals.contentLengthSent += byteLength(chunk, encoding);
    return end.apply(this, arguments as any);
  } as typeof res.end;
  next();
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
