import { ElectronAPI } from '@electron-toolkit/preload'

type LoaderAPI = {
  getPlatform: () => NodeJS.Platform
  installPlugin: (
    filename: string,
    data: Uint8Array,
    meta?: { pluginId?: string; pluginName?: string; version?: string }
  ) => Promise<{
    success: boolean
    error?: string
    installed?: {
      plugins: string[]
      content: string[]
    }
  }>
  uninstallPlugin: (
    pluginName: string,
    pluginId?: string
  ) => Promise<{ success: boolean; removed?: string[]; error?: string }>
  /** What is installed on this machine: exact records plus a filesystem sweep. */
  scanInstalled: () => Promise<{
    manifest: Record<string, { pluginName: string; version: string; paths: string[]; installedAt: string }>
    detected: Record<string, { name: string; path: string }>
  }>
  openOAuth: (url: string) => Promise<{ success: boolean; error?: string }>
  /** Subscribes to OAuth deep links. Returns an unsubscribe function. */
  onAuthCallback: (callback: (url: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: LoaderAPI
  }
}
