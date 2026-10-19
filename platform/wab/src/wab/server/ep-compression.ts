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
    compression({
      threshold: 0,
      level: 6,
      brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
    })
  );
}
