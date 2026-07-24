import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX({
  configPath: "source.config.ts",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trainfabric/shared", "fumadocs-ui", "fumadocs-core", "fumadocs-mdx"],
};

export default withMDX(nextConfig);
