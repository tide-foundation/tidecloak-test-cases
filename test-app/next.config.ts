import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Explicitly set the turbopack root to this directory only
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
