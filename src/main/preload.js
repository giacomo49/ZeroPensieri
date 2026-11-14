'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (name) => (arg) => ipcRenderer.invoke(`zp:${name}`, arg);
const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('zp', {
  state: call('state'),
  chooseRoot: call('choose-root'),
  createStarterFolders: call('create-starter-folders'),
  list: call('list'),
  createFolder: call('create-folder'),
  pickFiles: call('pick-files'),
  // File trascinati nella finestra: il percorso vero si può leggere solo da qui.
  registerDroppedFiles: (files) => ipcRenderer.invoke('zp:register-files', [...files].map((f) => webUtils.getPathForFile(f))),
  addDocument: call('add-document'),
  listToPay: call('list-to-pay'),
  setPaid: call('set-paid'),
  setToPay: call('set-to-pay'),
  forget: call('forget'),
  openFile: call('open-file'),
  showInFolder: call('show-in-folder'),
  trashFile: call('trash-file'),
  wordHtml: call('word-html'),
  conversionStatus: call('conversion-status'),
  retryConversion: call('retry-conversion'),
  retryEngine: call('retry-engine'),
  onChanged: listen('zp:changed'),
  onConversionStatus: listen('zp:conversion-status'),
});
