// Capture README screenshots from inside the app itself.
// Electron's capturePage() grabs this window's own pixels, so there is no
// window-manager guesswork and nothing else on the desktop can sneak in.
//
//   npm run shots        (mock mode: no camera, no API credits)

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
// seconds into the smoke autopilot -> file name
const SHOTS = [
  [4.5, 'title'],
  [7.0, 'consent'],
  [12.0, 'worry'],
  [26.0, 'pushback'],
  [44.0, 'breathe'],
  [57.0, 'release'],
];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(false));
  session.defaultSession.registerPreloadScript({
    type: 'frame', filePath: path.join(__dirname, '..', 'preload.js'),
  });
  ipcMain.handle('manndaan:getConfig', () => ({ mode: 'mock', apiKey: null }));
  ipcMain.handle('manndaan:cpu', () => []);

  const win = new BrowserWindow({
    width: 1280, height: 800, show: true, backgroundColor: '#04050d',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'),
    { query: { mode: 'mock', smoke: '1', dev: '0' } });

  const t0 = Date.now();
  for (const [at, name] of SHOTS) {
    const wait = t0 + at * 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
    console.log(`captured ${name}.png`);
  }
  app.quit();
});
