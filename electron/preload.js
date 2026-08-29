import electron from 'electron';

const { contextBridge } = electron;

contextBridge.exposeInMainWorld('masscienceElectron', {
  platform: process.platform,
  version: process.versions.electron,
});
