/** @type {import('next').NextConfig} */
const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");

const nextConfig = {
  reactStrictMode: true,
};

module.exports = withPlasmicRegistry(nextConfig);
