// MannDaan — Electron main process.
// Mock mode (`--mock`): no SDK, no camera, fake breathing signal in the renderer.
// Live mode (step 3): binds the SmartSpectra SDK IPC and grants camera access
// to our bundled page only.

require('dotenv').config();
const path = require('path');
const { app, BrowserWindow, session, ipcMain } = require('electron');

const MOCK = process.argv.includes('--mock');
const SMOKE = process.argv.includes('--smoke');

function createWindow() {
  const webPreferences = {
    contextIsolation: true,
    sandbox: true,
  };

  // Live mode: the SDK's preload exposes its IPC bridge. Our own tiny preload
  // (config bridge) is registered session-wide in app.whenReady(), so both run.
  if (!MOCK) {
    webPreferences.preload = require.resolve('@smartspectra/node-sdk/preload');
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#05060f',
    show: false,
    webPreferences,
  });

  if (!MOCK) {
    const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(win);
  }

  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), {
    query: { mode: MOCK ? 'mock' : 'live', smoke: SMOKE ? '1' : '0' },
  });
  return win;
}

app.whenReady().then(() => {
  // Camera only, and only for our own bundled file:// page. Everything else: denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const allowed = permission === 'media' && wc.getURL().startsWith('file://');
    callback(allowed);
  });

  // Our config preload runs alongside the SDK preload (which occupies the
  // single webPreferences.preload slot in live mode).
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: path.join(__dirname, 'preload.js'),
  });

  ipcMain.handle('manndaan:getConfig', () => ({
    mode: MOCK ? 'mock' : 'live',
    // Live mode: the renderer constructs the SDK, so it needs the key (.env only).
    apiKey: MOCK ? null : process.env.PRESAGE_API_KEY ?? null,
  }));

  if (!MOCK && !process.env.PRESAGE_API_KEY) {
    console.error('No PRESAGE_API_KEY in .env — live mode will not start. (cp .env.example .env)');
  }

  const win = createWindow();

  if (SMOKE) {
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') {
        console.error('[renderer error]', e.message);
        process.exitCode = 1;
      } else {
        console.log('[renderer]', e.message);
      }
    });
    setTimeout(() => app.quit(), 42000);
  }
});

app.on('window-all-closed', () => app.quit());
