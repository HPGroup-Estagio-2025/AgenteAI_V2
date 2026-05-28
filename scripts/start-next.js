const { spawn } = require('child_process');
const { getLocalIp } = require('./local-ip');

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = process.env.PORT || '3000';
const host = process.env.HOST || getLocalIp();

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, mode, '--hostname', host, '--port', port], {
  stdio: 'inherit',
  shell: false,
});

console.log(`Servidor a iniciar em http://${host}:${port}`);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
