/** @type {import('next').Config} */
const { getLocalIp } = require('./scripts/local-ip');

const host = process.env.HOST || getLocalIp();

const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  allowedDevOrigins: [host],
};
module.exports = nextConfig;
