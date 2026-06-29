const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

const root = path.resolve(__dirname, '..');
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const ok = () => { console.log('ELECTRON_OK', exe); process.exit(0); };
if (fs.existsSync(exe)) ok();

try {
  childProcess.execFileSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'install.js')], { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.warn('Electron install script failed:', e.message);
}
if (fs.existsSync(exe)) ok();

const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache');
function findZip(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const found = findZip(p);
      if (found) return found;
    } else if (ent.name === 'electron-v30.5.1-win32-x64.zip' && fs.statSync(p).size > 50 * 1024 * 1024) return p;
  }
  return null;
}
const zip = findZip(cacheDir);
if (!zip) { console.error('Electron zip cache missing. Run npm install with internet.'); process.exit(1); }
fs.mkdirSync(path.dirname(exe), { recursive: true });
childProcess.execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -Path ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(path.dirname(exe))} -Force`], { cwd: root, stdio: 'inherit' });
if (fs.existsSync(exe)) ok();
console.error('Electron repair failed.');
process.exit(1);
