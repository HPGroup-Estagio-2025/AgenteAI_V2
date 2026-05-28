const fs = require('fs');
const path = require('path');

const target = path.resolve(process.cwd(), '.next');
const workspace = path.resolve(process.cwd());

if (!target.startsWith(workspace + path.sep)) {
  throw new Error(`Refusing to delete outside workspace: ${target}`);
}

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log('Cache .next removida.');
}
