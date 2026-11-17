// Mock-mode preload. Exposes only a tiny config bridge.
// In live mode (step 3) the window uses the SmartSpectra SDK preload instead.
const { contextBridge, ipcRenderer } = require('electron');

// This preload is registered on the whole session (the single
// webPreferences.preload slot belongs to the SmartSpectra SDK in live mode),
// so it also runs in frames we don't own — DevTools, for one, which has no
// context isolation and would throw. The bridge is only for our own page.
try {
  contextBridge.exposeInMainWorld('manndaan', {
    getConfig: () => ipcRenderer.invoke('manndaan:getConfig'),
    getCpu: () => ipcRenderer.invoke('manndaan:cpu'),
    grantCamera: () => ipcRenderer.invoke('manndaan:consent'),
    releaseCamera: () => ipcRenderer.invoke('manndaan:releaseCamera'),
  });
} catch {
  // not our page — nothing to expose
}
