// Rodar com Electron, não com Node. O perfil original é apenas lido;
// Chromium abre uma cópia temporária para recuperar o localStorage.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackup } = require('../utils/data-backup');
const argument = name => process.argv[process.argv.indexOf(name) + 1];
const sourceArg = process.argv.includes('--profile') && argument('--profile');
const outputArg = process.argv.includes('--output') && argument('--output');
if (!sourceArg || !outputArg) {
  console.error('Uso: electron scripts/export-profile-backup.js --profile PASTA --output BACKUP.json');
  app.exit(1);
} else {
  const source = fs.realpathSync(path.resolve(sourceArg));
  const output = path.join(fs.realpathSync(path.dirname(path.resolve(outputArg))), path.basename(outputArg));
  if (!fs.statSync(source).isDirectory() || output === source || output.startsWith(`${source}${path.sep}`)) throw new Error('Salve o backup fora da pasta de origem.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-profile-export-'));
  const profile = path.join(temporary, 'profile');
  fs.cpSync(source, profile, { recursive: true, filter: file => !['SingletonLock', 'SingletonSocket', 'SingletonCookie'].includes(path.basename(file)) });
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('disable-gpu');
  app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));
  app.whenReady().then(async () => {
    const blank = path.join(temporary, 'blank.html');
    fs.writeFileSync(blank, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
    await win.loadFile(blank);
    const values = await win.webContents.executeJavaScript(`Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('sigma_')).map(key => [key, localStorage.getItem(key)]))`);
    const bundle = createBackup(source, values);
    fs.writeFileSync(output, JSON.stringify(bundle), { mode: 0o600, flag: 'wx' });
    const leads = JSON.parse(bundle.data.localStorage.sigma_leads || '[]');
    console.log(JSON.stringify({ exported: true, leads: leads.length, files: Object.keys(bundle.data.files).length, checksum: bundle.checksum }));
    app.quit();
  }).catch(error => { console.error(error.message); app.exit(1); });
}
