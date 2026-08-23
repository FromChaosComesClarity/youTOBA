const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('youtoba', {
  setView: (view) => ipcRenderer.send('set-view', view),
  navHome: () => ipcRenderer.send('nav-home'),
  navBack: () => ipcRenderer.send('nav-back'),
  navForward: () => ipcRenderer.send('nav-forward'),
  navReload: () => ipcRenderer.send('nav-reload'),
  onNavState: (cb) => ipcRenderer.on('nav-state', (_e, state) => cb(state)),
  toggleDownloadPopup: () => ipcRenderer.send('toggle-download-popup')
})
