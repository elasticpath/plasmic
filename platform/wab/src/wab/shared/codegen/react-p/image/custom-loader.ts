/**
 * Generates image loader code with the given optimizer host.
 * Returns a string that can be used for code generation.
 */
export function generateImageLoaderCode(imgOptimizerHost: string): string {
  return `{
    supportsUrl: (src) => {
      return (src.startsWith("http") || /^([a-f0-9]{32})\\..{1,16}$/i.test(src)) && !(src.endsWith(".svg") || src.startsWith("data:image/svg"));
    },
    transformUrl: (opts) => {
      const params = [
        \`src=\${encodeURIComponent(opts.src)}\`,
        opts.width ? \`w=\${opts.width}\` : undefined,
        \`q=\${opts.quality ?? 75}\`,
        opts.format ? \`f=\${opts.format}\` : undefined,
      ].filter((x) => !!x);
      return \`${imgOptimizerHost}/img-optimizer/v1/img?\${params.join("&")}\`;
    }
  }`;
}