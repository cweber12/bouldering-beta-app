import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent TF.js and OpenCV from being bundled by the SSR compiler.
  // They are browser-only and loaded exclusively inside 'use client' modules.
  serverExternalPackages: [
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-backend-webgl",
    "@tensorflow-models/pose-detection",
  ],

  webpack(config, { isServer }) {
    if (isServer) {
      // Silence webpack warnings for packages that reference browser globals
      // (canvas, WebGL, etc.) when compiled for the Node.js runtime.
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...externals,
        "@tensorflow/tfjs",
        "@tensorflow/tfjs-backend-webgl",
        "@tensorflow-models/pose-detection",
      ];
    }
    return config;
  },
};

export default nextConfig;
