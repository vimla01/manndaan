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
    fullscreen: process.argv.includes('--fullscreen'),
    backgroundColor: '#05060f',
    show: false,
    webPreferences,
  });

  // F11 toggles fullscreen (for demo recording)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });



  win.once('ready-to-show', () => {
    win.show();
    // The SDK's native runtime is hundreds of MB and loads synchronously, so
    // binding it before the first paint delayed the window by seconds. The
    // renderer cannot start a session until the user consents, which is far
    // later, so the bind happens once the opening screen is already up.
    if (!MOCK) {
      const t0 = Date.now();
      const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
      bindSmartSpectraIpc(win);
      console.log(`[measure] SmartSpectra runtime loaded in ${Date.now() - t0} ms`);
    }
  });
  // --devtools opens the console before the camera starts, so the first
  // [measure] lines are captured rather than scrolled past
  if (process.argv.includes('--devtools')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'), {
    query: {
      mode: MOCK ? 'mock' : 'live',
      smoke: SMOKE ? '1' : '0',
      dev: process.argv.includes('--dev') ? '1' : '0',
    },
  });
  return win;
}

const launchedAt = Date.now();

app.whenReady().then(() => {
  // Camera only, and only for our own bundled file:// page. Everything else: denied.
  // The renderer cannot get the camera until the consent screen tells the main
  // process the user agreed. Until then every media request is denied, so the
  // guarantee holds even if the UI were bypassed.
  let cameraConsented = false;
  ipcMain.handle('manndaan:consent', () => { cameraConsented = true; return true; });
  ipcMain.handle('manndaan:releaseCamera', () => { cameraConsented = false; return true; });

  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' && cameraConsented && wc.getURL().startsWith('file://'));
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

  // CPU of this app's processes, for the NOTES.md measurements. Electron
  // reports usage since the previous call, so prime it and sample a window.
  ipcMain.handle('manndaan:cpu', async () => {
    app.getAppMetrics();
    await new Promise((r) => setTimeout(r, 800));
    return app.getAppMetrics()
      .map((m) => ({ type: m.type, percentCPU: m.cpu ? +m.cpu.percentCPUUsage.toFixed(1) : null }))
      .filter((m) => m.percentCPU !== null);
  });

  if (!MOCK && !process.env.PRESAGE_API_KEY) {
    console.error('No PRESAGE_API_KEY in .env — live mode will not start. (cp .env.example .env)');
  }

  const win = createWindow();
  win.once('show', () => console.log(`[measure] window visible ${Date.now() - launchedAt} ms after launch`));

  // Renderer console goes to the terminal too: a failed live session is then
  // diagnosable from the log alone, without copying out of DevTools.
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') {
      console.error('[renderer error]', e.message);
      if (SMOKE) process.exitCode = 1;
    } else {
      console.log('[renderer]', e.message);
    }
  });

  if (SMOKE) setTimeout(() => app.quit(), 58000);
});

app.on('window-all-closed', () => app.quit());
