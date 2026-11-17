// Mock-mode preload. Exposes only a tiny config bridge.
// In live mode (step 3) the window uses the SmartSpectra SDK preload instead.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manndaan', {
  getConfig: () => ipcRenderer.invoke('manndaan:getConfig'),
  getCpu: () => ipcRenderer.invoke('manndaan:cpu'),
});
