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

  // ── Tide DPoP resource-server setup (tidecloak-js lib README, steps 3 & 4) ──
  // The Tide Cookie authenticator loads tide_dpop_auth.html cross-origin (popup/iframe)
  // from the CLIENT app origin during login, so it can read the DPoP key the SDK stashed
  // in this origin's IndexedDB and answer the enclave's challenge. The page parses iss/aud
  // out of its own URL path, so a single static file serves every issuer/client combo —
  // we rewrite the documented path to it and ignore the (per-realm, per-client) hex values.
  async headers() {
    return [
      {
        // Step 4: the two mandatory response headers for tide_dpop_auth.html. The CSP hashes
        // whitelist the file's inline <script>/<style>; Allow-CSP-From lets the enclave embed it.
        source: "/tide_dpop/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'sha256-utc6UrebuHOyLd/2aiMXS/p1EDy9UZBDe/XEMKDw9Mc='; " +
              "style-src 'self' 'sha256-1tYy8m3c1KLuGI2eID9TfLkc50Y+iSPJMpI7n/apN/w=' 'sha256-F7OJTdJYct4J+cQfuJUoDauitndqt8pAc8EbA8gwDPU='",
          },
          { key: "Allow-CSP-From", value: "*" },
        ],
      },
    ];
  },

  // Step 3: host tide_dpop_auth.html at /tide_dpop/iss/<iss-hex>/aud/<aud-hex>/tide_dpop_auth.html.
  // The hex values are realm/client specific and need not be static — serve the one public file
  // for any matching path (the page reads iss/aud from window.location itself).
  async rewrites() {
    return [
      { source: "/tide_dpop/:path*", destination: "/tide_dpop_auth.html" },
    ];
  },
};

export default nextConfig;