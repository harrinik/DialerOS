import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker — generates apps/api/.next/standalone
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: [
    'mongoose',
    // Pino + all its internal worker-thread dependencies.
    // thread-stream spawns a Node.js worker with a hard-coded file path;
    // if webpack rewrites that path into .next/server/vendor-chunks/ the
    // worker thread cannot find the file and the dev server crashes.
    'pino',
    'pino-pretty',
    'pino-std-serializers',
    'pino/file',
    'thread-stream',
    'sonic-boom',
    'real-require',
    'on-exit-leak-free',
    'atomics-wait',
    // Native/system modules that must never be bundled
    'fluent-ffmpeg',
    'ffmpeg-static',
    'net',
    'events',
  ],
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
  },
  // Silence noisy AMI/ffmpeg webpack warnings
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), 'fluent-ffmpeg', 'ffmpeg-static'];
    }
    return config;
  },
};

export default nextConfig;
