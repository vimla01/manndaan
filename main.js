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
    preload: path.join(__dirname, 'preload.js'),
  };

  // Live mode (step 3) will instead use the SDK preload:
  //   webPreferences.preload = require.resolve('@smartspectra/node-sdk/preload');

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#05060f',
    show: false,
    webPreferences,
  });

  if (!MOCK) {
    // Step 3: const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk');
    // bindSmartSpectraIpc(win);
  }

  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), {
    query: { mode: MOCK ? 'mock' : 'live' },
  });
  return win;
}

app.whenReady().then(() => {
  // Camera only, and only for our own bundled file:// page. Everything else: denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const allowed = permission === 'media' && wc.getURL().startsWith('file://');
    callback(allowed);
  });

  ipcMain.handle('manndaan:getConfig', () => ({
    mode: MOCK ? 'mock' : 'live',
    // The API key never reaches the renderer in mock mode; in live mode it is
    // read from .env here and handed to the SDK binding, not to page JS.
    hasApiKey: Boolean(process.env.PRESAGE_API_KEY),
  }));

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
    setTimeout(() => app.quit(), 6000);
  }
});

app.on('window-all-closed', () => app.quit());
