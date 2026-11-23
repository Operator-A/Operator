import type { NextConfig } from "next";
import { existsSync } from "node:fs";

// Agent jobs behind /api/agents/[agent] (Vercel Schedules or by hand), and the Control Room dashboard.
// The Docker image (Dockerfile, docs/self-host.md) builds with NEXT_OUTPUT=standalone; Vercel builds as usual.
// OPERATOR_EDITION=cloud builds the paid layer in: "operator-extensions" becomes ee/index.ts instead of
// core/extensions/none.ts (tsconfig.json), the only switch between editions (docs/extensions.md).
const cloud = process.env.OPERATOR_EDITION === "cloud";
if (cloud && !existsSync("ee/index.ts")) throw new Error("OPERATOR_EDITION=cloud needs ee/index.ts (the paid layer in ee/). Unset it to build the open edition.");
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  ...(cloud ? { turbopack: { resolveAlias: { "operator-extensions": "./ee/index.ts" } } } : {}),
  // an uploaded export may be up to 1 MB (core/export-rules.ts EXPORT_LIMITS), plus the form around it
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // card 301 (docs/speed.md): a page seen in the last 30 s comes back from the browser at once, and so does
    // one an IntentLink loaded on hover. Every save still shows fresh data: an action's revalidatePath, and
    // the live-run refresher, clear this cache. check:speed keeps both between 1 and 60 s.
    staleTimes: { dynamic: 30, static: 30 },
  },
};

export default nextConfig;
