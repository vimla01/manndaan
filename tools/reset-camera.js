// Restore the webcam's automatic exposure / white balance / focus.
//
// The SmartSpectra SDK locks AE, AWB and focus while it measures (its README
// says so). On Linux those are device-level V4L2 controls, so if an app exits
// without restoring them the camera can stay locked at a dark exposure for
// every other app. This opens the camera, asks for continuous/auto modes,
// then releases it.
//
//   npm run camera:reset        (close Meet/Zoom etc. first — one app at a time)

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  // the page needs camera permission
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) =>
    cb(permission === 'media'));
  win.loadFile(path.join(__dirname, 'reset-camera.html'));
  win.webContents.on('console-message', (e) => {
    console.log(e.message);
    if (e.message.includes('[done]')) app.quit();
  });
  setTimeout(() => app.quit(), 15000);
});
