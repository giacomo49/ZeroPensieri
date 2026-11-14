'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zpWorker', {
  onJob: (callback) => ipcRenderer.on('zp-worker:job', (_event, job) => callback(job)),
  reply: (result) => ipcRenderer.send('zp-worker:result', result),
});
