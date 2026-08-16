import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getPlatform: () => process.platform,
  installPlugin: (filename: string, data: Uint8Array) =>
    ipcRenderer.invoke('install-plugin', { filename, data }),
  uninstallPlugin: (pluginName: string) =>
    ipcRenderer.invoke('uninstall-plugin', { pluginName }),
  openOAuth: (url: string) => ipcRenderer.invoke('open-oauth', url),
  onAuthCallback: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
    ipcRenderer.on('auth-callback', listener)
    return () => ipcRenderer.removeListener('auth-callback', listener)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
