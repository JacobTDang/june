import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Avatar uploads go through a Server Action, and Next caps those bodies
      // at 1 MB by default — which rejected essentially every phone photo with
      // a raw framework error, while the app's own validation advertises 6 MB.
      // Sized above that cap so the friendly message is the one people see.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
