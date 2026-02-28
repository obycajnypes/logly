const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logly', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload)
});
