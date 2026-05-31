import { ElectronAPI } from '@electron-toolkit/preload'

type LoaderAPI = {
  getPlatform: () => NodeJS.Platform
  installPlugin: (filename: string, data: Uint8Array) => Promise<{
    success: boolean
    error?: string
    installed?: {
      plugins: string[]
      content: string[]
    }
  }>
  uninstallPlugin: (pluginName: string) => Promise<{ success: boolean; removed?: string[]; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: LoaderAPI
  }
}
