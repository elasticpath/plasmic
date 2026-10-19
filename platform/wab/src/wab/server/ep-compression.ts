import compression from "compression";
import type express from "express";
import zlib from "zlib";

/**
 * Compresses every Studio server response that has a body: brotli 4 when the
 * client offers br, gzip 6 when it offers only gzip, with no minimum size.
 *
 * Studio only. Mount it on the Studio routes, after the socket proxy routes,
 * so socket.io traffic is never wrapped. The other backends that share
 * createApp stay uncompressed.
 */
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

/**
 * The response sizes for the request log. `contentLength` is the uncompressed
 * size, as it always was. `contentLengthSent` is the size that went out after
 * compression, and is only known for Studio responses.
 */
export function loggedResponseSizes(res: express.Response) {
  return {
    contentLength:
      res.locals.uncompressedContentLength ?? res.get("content-length"),
    contentLengthSent: res.locals.contentLengthSent,
  };
}

// compression drops Content-Length when it encodes a response, so keep it
// first. compression calls the filter before it changes any header.
function keepUncompressedLength(req: express.Request, res: express.Response) {
  res.locals.uncompressedContentLength = res.getHeader("content-length");
  return compression.filter(req, res);
}

// Mounted ahead of compression, so it sees the bytes compression writes out.
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
