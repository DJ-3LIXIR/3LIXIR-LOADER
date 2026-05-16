import { app, shell, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { exec } from 'child_process'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: '3LIXIR LOADER',
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(icon),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Allow inline styles (React uses style={{}} extensively)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://*.r2.cloudflarestorage.com; img-src 'self' data:"]
      }
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Plugin install handler ────────────────────────────────────────────────────
ipcMain.handle('install-plugin', async (_event, { filename, data }) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3lixir-'))
  const zipPath = path.join(tempDir, filename)
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  try {
    // 1. Write the downloaded data to disk
    fs.writeFileSync(zipPath, Buffer.from(data))

    // 2. Unzip to temp dir (platform-specific)
    const unzipDir = path.join(tempDir, 'unzipped')
    fs.mkdirSync(unzipDir)
    await new Promise<void>((resolve, reject) => {
      const cmd = isWin
        ? `tar -xf "${zipPath}" -C "${unzipDir}"`
        : `unzip -o "${zipPath}" -d "${unzipDir}"`
      exec(cmd, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // 3. Find all plugin files/bundles recursively inside the unzipped folder
    const PLUGIN_EXTS = isMac
      ? ['.vst3', '.component', '.au', '.aaxplugin']
      : ['.vst3', '.dll', '.aaxplugin']

    const installDirs: Record<string, string> = isMac
      ? {
          '.vst3':      path.join(os.homedir(), 'Library/Audio/Plug-Ins/VST3'),
          '.component': path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
          '.au':        path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
          '.aaxplugin': '/Library/Application Support/Avid/Audio/Plug-Ins',
        }
      : {
          '.vst3':      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'VST3'),
          '.dll':       path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'VST2'),
          '.aaxplugin': path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'Avid', 'Audio', 'Plug-Ins'),
        }

    // Recursively walk the unzipped dir and collect all plugin paths
    function findPlugins(dir: string): string[] {
      const results: string[] = []
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry)
        const ext = path.extname(entry)
        if (PLUGIN_EXTS.includes(ext)) {
          results.push(fullPath)
        } else if (fs.statSync(fullPath).isDirectory()) {
          results.push(...findPlugins(fullPath))
        }
      }
      return results
    }

    const pluginPaths = findPlugins(unzipDir)
    if (pluginPaths.length === 0) throw new Error('No plugin file found in zip')

    // Paths that require admin privileges on macOS
    const systemPaths = ['/Library/Application Support/Avid/Audio/Plug-Ins']

    // Install each plugin found
    for (const src of pluginPaths) {
      const pluginFile = path.basename(src)
      const ext = path.extname(pluginFile)
      const installDir = installDirs[ext]
      if (!installDir) continue

      const dest = path.join(installDir, pluginFile)
      const needsElevation = isMac && systemPaths.some(p => installDir.startsWith(p))

      if (isMac) {
        if (needsElevation) {
          // Use osascript to prompt for admin privileges for system-level paths
          const script = `mkdir -p "${installDir}" && ditto "${src}" "${dest}"`
          await new Promise<void>((resolve, reject) => {
            exec(
              `osascript -e 'do shell script "${script.replace(/"/g, '\\"')}" with administrator privileges'`,
              (err) => {
                if (err) reject(err)
                else resolve()
              }
            )
          })
        } else {
          fs.mkdirSync(installDir, { recursive: true })
          // macOS: use ditto to preserve code signatures and extended attributes
          await new Promise<void>((resolve, reject) => {
            exec(`ditto "${src}" "${dest}"`, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
        }
      } else {
        fs.mkdirSync(installDir, { recursive: true })
        // Windows: use fs.cpSync for reliable cross-platform copy
        fs.cpSync(src, dest, { recursive: true })
      }
    }

    // 4. Copy preset/library folders (e.g. ARK Presets) to ~/Documents/<PluginName>/Presets
    function findPresetFolders(dir: string): string[] {
      const results: string[] = []
      for (const entry of fs.readdirSync(dir)) {
        if (entry.toLowerCase() === 'presets' || entry.toLowerCase() === 'library') {
          const fullPath = path.join(dir, entry)
          if (fs.statSync(fullPath).isDirectory()) {
            results.push(fullPath)
          }
        }
      }
      return results
    }

    // Search for Presets/Library folders inside the unzipped content (one level deep)
    const topLevelDirs = fs.readdirSync(unzipDir).filter(e =>
      fs.statSync(path.join(unzipDir, e)).isDirectory()
    )

    for (const topDir of topLevelDirs) {
      const topPath = path.join(unzipDir, topDir)
      const presetFolders = findPresetFolders(topPath)

      for (const presetSrc of presetFolders) {
        const folderName = path.basename(presetSrc) // "Presets" or "Library"
        const pluginName = topDir // e.g. "ARK"
        const destDir = path.join(os.homedir(), 'Documents', pluginName, folderName)

        if (isMac) {
          fs.mkdirSync(destDir, { recursive: true })
          await new Promise<void>((resolve, reject) => {
            exec(`ditto "${presetSrc}" "${destDir}"`, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
        } else {
          fs.mkdirSync(destDir, { recursive: true })
          fs.cpSync(presetSrc, destDir, { recursive: true })
        }
      }
    }

    // 5. Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true })

    return { success: true }
  } catch (err: unknown) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

// ── Plugin uninstall handler ──────────────────────────────────────────────────
ipcMain.handle('uninstall-plugin', async (_event, { pluginName }) => {
  const isMac = process.platform === 'darwin'
  const PLUGIN_EXTS = isMac
    ? ['.vst3', '.component', '.au', '.aaxplugin']
    : ['.vst3', '.dll', '.aaxplugin']

  const installDirs: Record<string, string> = isMac
    ? {
        '.vst3':      path.join(os.homedir(), 'Library/Audio/Plug-Ins/VST3'),
        '.component': path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
        '.au':        path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
        '.aaxplugin': '/Library/Application Support/Avid/Audio/Plug-Ins',
      }
    : {
        '.vst3':      path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'VST3'),
        '.dll':       path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'VST2'),
        '.aaxplugin': path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'Avid', 'Audio', 'Plug-Ins'),
      }

  const removed: string[] = []

  for (const ext of PLUGIN_EXTS) {
    const dir = installDirs[ext]
    if (!dir || !fs.existsSync(dir)) continue

    for (const entry of fs.readdirSync(dir)) {
      const entryExt = path.extname(entry)
      const entryBase = path.basename(entry, entryExt)
      if (entryExt === ext && entryBase.toLowerCase() === pluginName.toLowerCase()) {
        const fullPath = path.join(dir, entry)
        const needsElevation = isMac && dir.startsWith('/Library/')
        if (needsElevation) {
          const script = `rm -rf "${fullPath}"`
          require('child_process').execSync(
            `osascript -e 'do shell script "${script.replace(/"/g, '\\"')}" with administrator privileges'`
          )
        } else {
          fs.rmSync(fullPath, { recursive: true, force: true })
        }
        removed.push(fullPath)
      }
    }
  }

  return { success: true, removed }
})

app.setName('3LIXIR LOADER')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.3lixir.loader')

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(icon))
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
