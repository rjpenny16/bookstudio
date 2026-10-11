import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image sets NEXT_OUTPUT=standalone; `npm start` uses the regular build.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
};

export default nextConfig;
