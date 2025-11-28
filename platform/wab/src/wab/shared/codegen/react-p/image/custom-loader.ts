/**
 * Creates a custom image loader object with the given optimizer host
 */
export function createImageLoaderObject(imgOptimizerHost: string) {
  return {
    supportsUrl: (src: string) => {
      return (src.startsWith("http") || /^([a-f0-9]{32})\..{1,16}$/i.test(src)) && !(src.endsWith(".svg") || src.startsWith("data:image/svg"));
    },
    transformUrl: (opts: { src: string; width?: number; quality?: number; format?: string }) => {
      const params = [
        `src=${encodeURIComponent(opts.src)}`,
        opts.width ? `w=${opts.width}` : undefined,
        `q=${opts.quality ?? 75}`,
        opts.format ? `f=${opts.format}` : undefined,
      ].filter((x) => !!x);
      return `${imgOptimizerHost}/img-optimizer/v1/img?${params.join("&")}`;
    }
  };
}

/**
 * Generates image loader code string for code generation
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