import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [
        { source: "/api/:path*", destination: "http://localhost:3000/api/:path*" },
        { source: "/platform-shell/:userId/:name", destination: "/platform-shell-preview?userId=:userId&name=:name" },
        { source: "/_localapp/raw/:userId/:name", destination: "http://localhost:3000/serve/:userId/:name/" },
        { source: "/_localapp/raw/:userId/:name/:path*", destination: "http://localhost:3000/serve/:userId/:name/:path*" },
      ];
    }
    return [];
  },
};

export default nextConfig;
