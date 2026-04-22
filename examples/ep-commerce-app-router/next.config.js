/** @type {import('next').NextConfig} */
const { withPlasmicRegistry } = require("@elasticpath/plasmic-mcp-registry/next");

const nextConfig = {};

module.exports = withPlasmicRegistry(nextConfig);
