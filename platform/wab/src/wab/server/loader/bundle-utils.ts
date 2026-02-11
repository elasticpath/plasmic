/**
 * Utility functions for loader bundling.
 * Extracted to a separate file to allow unit testing without esbuild dependency.
 */

/**
 * Replaces hardcoded data.plasmic.app URL with custom DATA_HOST.
 * Used by esbuild plugin to allow self-hosted deployments to route
 * data source operations to their own data service.
 *
 * @param content - The file content to process
 * @param dataHost - The replacement host URL (defaults to DATA_HOST env var or original URL)
 * @returns The content with URLs replaced, or null if no replacement needed
 */
export function replaceDataPlasmicHost(
  content: string,
  dataHost?: string
): string | null {
  if (!content.includes("data.plasmic.app")) {
    return null;
  }

  const host = dataHost || process.env.DATA_HOST || "https://data.plasmic.app";
  return content.replace(/https:\/\/data\.plasmic\.app/g, host);
}

/**
 * Determines the esbuild loader type based on file extension.
 */
export function getLoaderForPath(filePath: string): "tsx" | "ts" | "js" {
  if (filePath.endsWith(".tsx")) {
    return "tsx";
  } else if (filePath.endsWith(".ts")) {
    return "ts";
  }
  return "js";
}
