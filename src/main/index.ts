import { app, shell, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { exec, execFile, execFileSync, execSync } from 'child_process'

type InstallSummary = {
  plugins: string[]
  content: string[]
}

function isPermissionError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ('code' in err ? err.code === 'EACCES' || err.code === 'EPERM' : false)
  )
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function resolveWindowsVst2InstallDir(): string {
  const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files'

  if (fs.existsSync(programFiles)) {
    const existingVstPluginsDir = fs
      .readdirSync(programFiles, { withFileTypes: true })
      .find(entry => entry.isDirectory() && entry.name.toLowerCase() === 'vstplugins')

    if (existingVstPluginsDir) {
      return path.join(programFiles, existingVstPluginsDir.name)
    }
  }

  return path.join(os.homedir(), 'Documents', 'VSTPlugins')
}

async function runElevatedPowerShell(command: string): Promise<void> {
  const logFile = path.join(os.homedir(), 'Desktop', '3lixir-debug.log')
  const log = (msg: string) => fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')

  const innerArgs = `-NoProfile -ExecutionPolicy Bypass -Command ${powershellQuote(command)}`
  const startProcessCommand = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList ${powershellQuote(innerArgs)}`

  log(`elevated command: ${command}`)

  await new Promise<void>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', startProcessCommand],
      (err, stdout, stderr) => {
        log(`elevated stdout: ${stdout}`)
        log(`elevated stderr: ${stderr}`)
        if (err) {
          log(`elevated error: ${String(err)}`)
          reject(err)
        } else {
          resolve()
        }
      }
    )
  })
}

async function copyWindowsPath(src: string, dest: string, installDir: string): Promise<void> {
  const originalSrc = src
  try {
    src = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `(Get-Item -LiteralPath ${powershellQuote(src)}).FullName`,
      ],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    // Keep the original path if PowerShell cannot resolve it.
  }

  const logFile = path.join(os.homedir(), 'Desktop', '3lixir-debug.log')
  const log = (msg: string) => fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  const stat = fs.statSync(src)

  log(`original src: ${originalSrc}`)
  log(`src: ${src}`)
  log(`dest: ${dest}`)
  log(`installDir: ${installDir}`)
  log(`src exists: ${fs.existsSync(src)}`)

  try {
    fs.mkdirSync(installDir, { recursive: true })
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true })
    } else {
      fs.copyFileSync(src, dest)
    }
    log('copied without elevation')
  } catch (err) {
    log(`copy error: ${String(err)}`)
    if (!isPermissionError(err)) throw err
    log('trying elevated copy...')
    await runElevatedPowerShell(
      [
        `New-Item -ItemType Directory -Force -Path ${powershellQuote(installDir)} | Out-Null`,
        stat.isDirectory()
          ? `Copy-Item -LiteralPath ${powershellQuote(src)} -Destination ${powershellQuote(dest)} -Recurse -Force`
          : `Copy-Item -LiteralPath ${powershellQuote(src)} -Destination ${powershellQuote(dest)} -Force`,
      ].join('; ')
    )
    await new Promise(resolve => setTimeout(resolve, 500))
    log(`dest exists after elevation: ${fs.existsSync(dest)}`)
    if (!fs.existsSync(dest)) throw new Error(`Failed to install ${path.basename(dest)}`)
  }
}

async function copyWindowsDirectory(src: string, dest: string): Promise<void> {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
  } catch (err) {
    if (!isPermissionError(err)) throw err

    await runElevatedPowerShell(
      [
        `New-Item -ItemType Directory -Force -Path ${powershellQuote(path.dirname(dest))} | Out-Null`,
        `Copy-Item -LiteralPath ${powershellQuote(src)} -Destination ${powershellQuote(dest)} -Recurse -Force`,
      ].join('; ')
    )
    if (!fs.existsSync(dest)) throw new Error(`Failed to copy ${path.basename(dest)}`)
  }
}

async function removeWindowsPath(fullPath: string): Promise<void> {
  try {
    fs.rmSync(fullPath, { recursive: true, force: true })
  } catch (err) {
    if (!isPermissionError(err)) throw err

    await runElevatedPowerShell(`Remove-Item -LiteralPath ${powershellQuote(fullPath)} -Recurse -Force`)
    if (fs.existsSync(fullPath)) throw new Error(`Failed to remove ${path.basename(fullPath)}`)
  }
}

// ── OAuth deep linking ────────────────────────────────────────────────────────
const PROTOCOL = '3lixir-loader'

let mainWindow: BrowserWindow | null = null
// A deep link can arrive before the renderer is ready to receive it (most often on
// Windows/Linux, where the callback launches a second instance). Hold it until then.
let pendingAuthUrl: string | null = null

function deliverAuthCallback(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return

  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth-callback', url)
  } else {
    pendingAuthUrl = url
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

function findDeepLink(argv: string[]): string | undefined {
  return argv.find(arg => arg.startsWith(`${PROTOCOL}://`))
}

function createWindow(): void {
  const win = new BrowserWindow({
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
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in wss://*.supabase.in https://*.r2.cloudflarestorage.com; img-src 'self' data:"]
      }
    })
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Flush a deep link that arrived while the renderer was still booting.
  win.webContents.on('did-finish-load', () => {
    if (pendingAuthUrl) {
      win.webContents.send('auth-callback', pendingAuthUrl)
      pendingAuthUrl = null
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = win
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
        ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${unzipDir}' -Force"`
        : `unzip -o "${zipPath}" -d "${unzipDir}"`
      exec(cmd, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    // 3. Find all plugin files/bundles recursively inside the unzipped folder
    const PLUGIN_EXTS = isMac
      ? ['.vst3', '.component', '.au', '.aaxplugin']
      : ['.vst3', '.vst', '.dll', '.aaxplugin', '.clap']
    const currentPlatform = isMac ? 'mac' : 'windows'
    const platformMarkers = {
      mac: new Set(['mac', 'macos', 'osx', 'darwin', 'macosx']),
      windows: new Set(['win', 'win32', 'win64', 'windows', 'visualstudio', 'visualstudio2026', 'x64']),
    }

    const installDirs: Record<string, string> = isMac
      ? {
          '.vst3':      path.join(os.homedir(), 'Library/Audio/Plug-Ins/VST3'),
          '.component': path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
          '.au':        path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
          '.aaxplugin': '/Library/Application Support/Avid/Audio/Plug-Ins',
        }
      : {
          '.vst3':      path.join(os.homedir(), 'Documents', 'VST3'),
          '.vst':       resolveWindowsVst2InstallDir(),
          '.dll':       path.join(os.homedir(), 'Documents', 'VSTPlugins'),
          '.aaxplugin': path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'Avid', 'Audio', 'Plug-Ins'),
          '.clap':      path.join(process.env['COMMONPROGRAMFILES'] || path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files'), 'CLAP'),
        }
    const installSummary: InstallSummary = { plugins: [], content: [] }

    function isBuildArtifact(entry: string): boolean {
      const name = entry.toLowerCase()
      return (
        name.endsWith('.dll.recipe') ||
        name.endsWith('.lib') ||
        name.endsWith('.pdb') ||
        name.endsWith('.exp') ||
        name.endsWith('.iobj') ||
        name.endsWith('.ipdb') ||
        name.endsWith('.obj') ||
        name.endsWith('.res') ||
        name.endsWith('.log') ||
        name.endsWith('.tlog')
      )
    }

    // Recursively walk the unzipped dir and collect all plugin paths
    function findPlugins(dir: string, depth = 0): string[] {
      const results: string[] = []
      if (depth > 8) return results

      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry)
        const ext = path.extname(entry).toLowerCase()
        const stat = fs.statSync(fullPath)

        if (PLUGIN_EXTS.includes(ext)) {
          if (!isBuildArtifact(entry)) {
            results.push(fullPath)
          }
        } else if (stat.isDirectory()) {
          results.push(...findPlugins(fullPath, depth + 1))
        }
      }
      return results
    }

    function segmentMatchesPlatform(segment: string, platform: 'mac' | 'windows'): boolean {
      const normalized = segment.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const tokens = segment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      return platformMarkers[platform].has(normalized) || tokens.some(token => platformMarkers[platform].has(token))
    }

    function pathPlatform(filePath: string): 'mac' | 'windows' | null {
      const segments = path.relative(unzipDir, filePath).split(path.sep)

      for (const segment of segments) {
        if (segmentMatchesPlatform(segment, 'mac')) return 'mac'
        if (segmentMatchesPlatform(segment, 'windows')) return 'windows'
      }

      return null
    }

    function filePlatform(filePath: string): 'mac' | 'windows' | 'both' | null {
      const ext = path.extname(filePath).toLowerCase()

      if (ext === '.component' || ext === '.au') return 'mac'
      if (ext === '.dll') return 'windows'

      if (ext === '.vst3') {
        const contentsDir = path.join(filePath, 'Contents')
        if (fs.existsSync(contentsDir) && fs.statSync(contentsDir).isDirectory()) {
          const subfolders = fs.readdirSync(contentsDir)
          const hasWin = subfolders.some((folder) => folder.toLowerCase().includes('win'))
          const hasMac = subfolders.some((folder) => {
            const normalized = folder.toLowerCase()
            return normalized.includes('mac') || normalized.includes('macos')
          })

          if (hasWin && hasMac) return 'both'
          if (hasWin) return 'windows'
          if (hasMac) return 'mac'
        }

        return pathPlatform(filePath) ?? 'both'
      }

      return pathPlatform(filePath) ?? 'both'
    }

    const discoveredPluginPaths = findPlugins(unzipDir)
    const pluginPaths = discoveredPluginPaths.filter((src) => {
      const pluginPlatform = filePlatform(src)
      return pluginPlatform === currentPlatform || pluginPlatform === 'both'
    })

    // Paths that require admin privileges on macOS
    const systemPaths = ['/Library/Application Support/Avid/Audio/Plug-Ins']

    // Install each plugin found
    for (const src of pluginPaths) {
      const pluginFile = path.basename(src)
      const ext = path.extname(pluginFile).toLowerCase()
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
        await copyWindowsPath(src, dest, installDir)
      }
      installSummary.plugins.push(dest)
    }

    // 4. Copy preset/library folders (e.g. ARK Presets) to ~/Documents/<PluginName>/Presets
    function findContentFolders(dir: string): string[] {
      const results: string[] = []
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry)
        if (!fs.statSync(fullPath).isDirectory()) continue

        if (['presets', 'preset', 'library', 'libraries', 'samples', 'sample', 'content'].includes(entry.toLowerCase())) {
          if (pathPlatform(fullPath) === currentPlatform || pathPlatform(fullPath) === null) {
            results.push(fullPath)
          }
        } else {
          results.push(...findContentFolders(fullPath))
        }
      }
      return results
    }

    function packageNameForContent(contentPath: string): string {
      const relativeParts = path.relative(unzipDir, contentPath).split(path.sep)
      const contentIndex = relativeParts.length - 1
      const parent = relativeParts[contentIndex - 1]

      if (parent && !segmentMatchesPlatform(parent, 'mac') && !segmentMatchesPlatform(parent, 'windows')) {
        return parent
      }

      const firstMeaningfulPart = relativeParts.find(part =>
        !segmentMatchesPlatform(part, 'mac') &&
        !segmentMatchesPlatform(part, 'windows') &&
        !['presets', 'preset', 'library', 'libraries', 'samples', 'sample', 'content'].includes(part.toLowerCase())
      )
      return firstMeaningfulPart || path.basename(contentPath)
    }

    const contentFolders = findContentFolders(unzipDir)
    for (const contentSrc of contentFolders) {
      const folderName = path.basename(contentSrc)
      const pluginName = packageNameForContent(contentSrc)
      const destDir = path.join(os.homedir(), 'Documents', pluginName, folderName)

      if (isMac) {
        fs.mkdirSync(destDir, { recursive: true })
        await new Promise<void>((resolve, reject) => {
          exec(`ditto "${contentSrc}" "${destDir}"`, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      } else {
        await copyWindowsDirectory(contentSrc, destDir)
      }
      installSummary.content.push(destDir)
    }

    if (installSummary.plugins.length === 0 && installSummary.content.length === 0) {
      throw new Error(`No installable plugins or content folders found in ${filename}`)
    }

    // 5. Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true })

    return { success: true, installed: installSummary }
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
    : ['.vst3', '.vst', '.dll', '.aaxplugin', '.clap']

  const installDirs: Record<string, string> = isMac
    ? {
        '.vst3':      path.join(os.homedir(), 'Library/Audio/Plug-Ins/VST3'),
        '.component': path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
        '.au':        path.join(os.homedir(), 'Library/Audio/Plug-Ins/Components'),
        '.aaxplugin': '/Library/Application Support/Avid/Audio/Plug-Ins',
      }
    : {
        '.vst3':      path.join(os.homedir(), 'Documents', 'VST3'),
        '.vst':       resolveWindowsVst2InstallDir(),
        '.dll':       path.join(os.homedir(), 'Documents', 'VSTPlugins'),
        '.aaxplugin': path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files', 'Avid', 'Audio', 'Plug-Ins'),
        '.clap':      path.join(process.env['COMMONPROGRAMFILES'] || path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Common Files'), 'CLAP'),
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
          execSync(
            `osascript -e 'do shell script "${script.replace(/"/g, '\\"')}" with administrator privileges'`
          )
        } else if (!isMac) {
          await removeWindowsPath(fullPath)
        } else {
          fs.rmSync(fullPath, { recursive: true, force: true })
        }
        removed.push(fullPath)
      }
    }
  }

  return { success: true, removed }
})

// ── OAuth handoff to the system browser ───────────────────────────────────────
// Google refuses to authenticate inside an embedded webview, so the provider URL
// has to open in the user's real browser and come back via the custom protocol.
ipcMain.handle('open-oauth', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
    return { success: false, error: 'Invalid OAuth URL' }
  }
  await shell.openExternal(url)
  return { success: true }
})

app.setName('3LIXIR LOADER')

// On Windows and Linux the deep link starts a second copy of the app; the lock
// funnels that callback into the instance the user is already looking at.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = findDeepLink(argv)
    if (deepLink) deliverAuthCallback(deepLink)

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // macOS delivers deep links through this event rather than argv.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliverAuthCallback(url)
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.3lixir.loader')

    // Register 3lixir-loader:// so Supabase can redirect back into the app.
    if (is.dev && process.platform === 'win32') {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL)
    }

    // Set dock icon on macOS
    if (process.platform === 'darwin') {
      app.dock?.setIcon(nativeImage.createFromPath(icon))
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    // A cold start from a deep link carries the callback in argv.
    const launchDeepLink = findDeepLink(process.argv)
    if (launchDeepLink) deliverAuthCallback(launchDeepLink)

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
