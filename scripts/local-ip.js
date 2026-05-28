const { networkInterfaces } = require('os');

function getLocalIp() {
  const nets = networkInterfaces();

  for (const addresses of Object.values(nets)) {
    for (const net of addresses || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

module.exports = { getLocalIp };
