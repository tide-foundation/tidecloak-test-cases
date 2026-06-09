import type { NextConfig } from "next";
import path from "path";

// The local Tide SDK deps (@tidecloak/js, @tide/js, heimdall-tide) are linked via
// `file:` and resolve to real paths OUTSIDE the test-harness repo
// (/home/sasha/tidecloak-js, /home/sasha/heimdall, /home/sasha/project/tide-js).
// Root must be their common ancestor (/home/sasha) so Next resolves/traces them.
const workspaceRoot = path.resolve(__dirname, "../../../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;