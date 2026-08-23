const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('youtobaDownload', {
  getUrl: () => new URLSearchParams(window.location.search).get('url'),
  start: (opts) => ipcRenderer.invoke('start-download', opts),
  showDownloadsFolder: () => ipcRenderer.send('show-downloads-folder'),
  onStatus: (cb) => ipcRenderer.on('download-status', (_e, text) => cb(text)),
  onProgress: (cb) => ipcRenderer.on('download-progress', (_e, progress) => cb(progress)),
  onComplete: (cb) => ipcRenderer.on('download-complete', (_e, info) => cb(info))
})
