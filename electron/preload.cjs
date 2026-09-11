const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bloom', {
  getState: () => ipcRenderer.invoke('board:state'),
  apply: (operations, revision) => ipcRenderer.invoke('board:apply', operations, revision),
  command: (name, value) => ipcRenderer.invoke('board:command', name, value),
  session: () => ipcRenderer.invoke('session:info'),
  viewport: value => ipcRenderer.send('board:viewport', value),
  flushed: (id, ok) => ipcRenderer.send('board:flushed', id, ok),
  onState: callback => { const fn = (_, value) => callback(value); ipcRenderer.on('board:state', fn); return () => ipcRenderer.removeListener('board:state', fn); },
  onAction: callback => { const fn = (_, value) => callback(value); ipcRenderer.on('board:action', fn); return () => ipcRenderer.removeListener('board:action', fn); },
  onAgent: callback => { const fn = (_, value) => callback(value); ipcRenderer.on('session:activity', fn); return () => ipcRenderer.removeListener('session:activity', fn); }
});
