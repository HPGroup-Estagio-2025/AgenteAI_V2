const { execSync } = require('child_process');
try {
  execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3000\') do taskkill /F /PID %a', { stdio: 'ignore', shell: true });
} catch {}
