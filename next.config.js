/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/trust-queue",
        destination: "/review/inbox",
        permanent: false
      },
      {
        source: "/approved-answers",
        destination: "/review/library",
        permanent: false
      },
      {
        source: "/documents",
        destination: "/evidence",
        permanent: false
      },
      {
        source: "/settings/members",
        destination: "/settings",
        permanent: false
      }
    ];
  }
};

module.exports = nextConfig;
