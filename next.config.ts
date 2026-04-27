import type {NextConfig} from 'next';

// Canonical domain — kansailive.com and kansai.live 301 to osaka-live.net
async function redirects() {
  const canonical = "https://osaka-live.net";
  const aliases = ["kansailive.com", "www.kansailive.com", "kansai.live", "www.kansai.live"];
  return aliases.map((host) => ({
    source: "/(.*)",
    has: [{ type: "host" as const, value: host }],
    destination: `${canonical}/:1`,
    permanent: true,
  }));
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  redirects,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
