const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('masscienceElectron', {
  platform: process.platform,
  version: process.versions.electron,
});
