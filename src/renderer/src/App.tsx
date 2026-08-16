import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import brickBg from './assets/brick.png'
import { supabase } from './supabase'
import LoginScreen from './components/LoginScreen'

type Plugin = {
  id: string
  name: string
  file_size: string
  version: string
  status: string
  category: string
  description: string
}

type NavItem = 'all' | 'not-installed' | 'updates' | 'installed' | 'hidden'
type Category = 'Apps' | 'Content' | 'Plugins' | 'Instruments' | 'Audio Units'
type DownloadPlatform = 'mac' | 'windows'

const GOLD = '#C9A84C'
const GOLD_BRIGHT = '#F0C040'
const GOLD_DIM = '#8B6914'

function getDownloadPlatform(): DownloadPlatform {
  return window.api.getPlatform() === 'darwin' ? 'mac' : 'windows'
}

function normalizePluginStatus(status: string): 'update' | 'installed' | 'not-installed' | 'coming soon' | 'available' | 'unknown' {
  const normalized = status.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (normalized === 'coming-soon') return 'coming soon'
  if (normalized === 'update' || normalized === 'installed' || normalized === 'not-installed' || normalized === 'coming-soon' || normalized === 'available') {
    return normalized === 'coming-soon' ? 'coming soon' : normalized
  }
  return 'unknown'
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [oauthError, setOauthError] = useState('')

  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [ownedPluginIds, setOwnedPluginIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadLabel, setDownloadLabel] = useState<string>('')
  const [activeNav, setActiveNav] = useState<NavItem>('all')
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<Category[]>(['Apps', 'Content', 'Plugins', 'Instruments', 'Audio Units'])

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // ── OAuth deep link ───────────────────────────────────────────────────────
  // The browser sends the user back to 3lixir-loader://auth-callback?code=…, which
  // the main process forwards here. The exchange has to run in the renderer because
  // that is where the PKCE code verifier was stored when the flow started.
  useEffect(() => {
    return window.api.onAuthCallback(async (url) => {
      try {
        const params = new URL(url).searchParams
        const providerError = params.get('error_description') ?? params.get('error')
        if (providerError) {
          setOauthError(providerError)
          return
        }

        const code = params.get('code')
        if (!code) return

        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) setOauthError(error.message)
        else setOauthError('')
      } catch {
        setOauthError('Sign-in failed. Please try again.')
      }
    })
  }, [])

  // ── Plugins ───────────────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchPlugins() {
      const { data, error } = await supabase.from('plugins').select('*')
      if (!error && data) setPlugins(data)
      setLoading(false)
    }
    fetchPlugins()

    const channel = supabase
      .channel('plugins-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plugins' }, (payload) => {
        setPlugins(prev => {
          const newRow = payload.new as Plugin | Record<string, never>
          const oldRow = payload.old as Plugin | Record<string, never>

          if (payload.eventType === 'INSERT' && 'id' in newRow) {
            const exists = prev.some(p => p.id === newRow.id)
            return exists ? prev : [...prev, newRow as Plugin]
          }

          if (payload.eventType === 'UPDATE' && 'id' in newRow) {
            return prev.map(p => (p.id === newRow.id ? (newRow as Plugin) : p))
          }

          if (payload.eventType === 'DELETE' && 'id' in oldRow) {
            return prev.filter(p => p.id !== oldRow.id)
          }

          return prev
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ── Owned plugins from orders ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    async function fetchOwnedPlugins() {
      console.log('[DEBUG] Fetching orders for user:', user!.id)
      const { data, error } = await supabase
        .from('orders')
        .select('items')
        .eq('user_id', user!.id)
        .eq('status', 'completed')

      console.log('[DEBUG] Orders response:', { data, error })

      if (!error && data) {
        const ids = new Set<string>()
        data.forEach(order => {
          const items = order.items as Array<{ id: string; type: string }>
          console.log('[DEBUG] Order items:', items)
          if (Array.isArray(items)) {
            items.forEach(item => {
              if (item.type === 'plugin' && item.id) ids.add(item.id)
            })
          }
        })
        console.log('[DEBUG] Owned plugin IDs:', [...ids])
        setOwnedPluginIds(ids)
      }
    }
    fetchOwnedPlugins()
  }, [user])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleDownload(plugin: Plugin) {
    if (downloading) return
    setDownloading(plugin.id)
    setDownloadProgress(0)
    setDownloadLabel(`Downloading ${plugin.name}…`)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Not authenticated')

      // Use raw fetch so we can track stream progress
      const response = await fetch('https://tciugratutxxrdtbsxim.supabase.co/functions/v1/get-download-url', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjaXVncmF0dXR4eHJkdGJzeGltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NzYwMDgsImV4cCI6MjA4MzA1MjAwOH0.-yif_fwvYOwE6kG4nkSc1HXyF-cHTlZGWGJ91YXsPuM',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plugin_id: plugin.id, platform: getDownloadPlatform() }),
      })

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}))
        throw new Error(errJson.error || `Server error ${response.status}`)
      }

      // The edge function may return JSON with a signed URL, or the zip directly
      const contentType = response.headers.get('Content-Type') || ''
      let fileResponse: Response

      if (contentType.includes('application/json')) {
        const { url: signedUrl, filename: signedFilename } = await response.json()
        if (!signedUrl) throw new Error('No download URL returned')
        fileResponse = await fetch(signedUrl)
        if (!fileResponse.ok) throw new Error(`Download failed: ${fileResponse.status}`)
        fileResponse = new Response(fileResponse.body, {
          headers: fileResponse.headers,
          status: fileResponse.status,
          statusText: fileResponse.statusText,
        })
        if (signedFilename) fileResponse.headers.set('X-3lixir-Filename', signedFilename)
      } else {
        fileResponse = response
      }

      // Stream the response body and track progress
      const contentLength = fileResponse.headers.get('Content-Length')
      const total = contentLength ? parseInt(contentLength) : 0
      const reader = fileResponse.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (total > 0) {
          setDownloadProgress(Math.round((received / total) * 90)) // 90% = download done
        } else {
          // No content-length — pulse based on bytes received (indeterminate)
          setDownloadProgress(prev => Math.min(prev + 2, 85))
        }
      }

      // Combine chunks into single Uint8Array
      const allBytes = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) { allBytes.set(chunk, offset); offset += chunk.length }

      setDownloadProgress(92)
      setDownloadLabel(`Installing ${plugin.name}…`)

      const filename = fileResponse.headers.get('X-3lixir-Filename') || `${plugin.name.replace(/\s+/g, '_')}.zip`
      const result = await window.api.installPlugin(filename, allBytes)

      if (result.success) {
        setDownloadProgress(100)
        setDownloadLabel(`${plugin.name} installed`)
        await supabase.from('plugins').update({ status: 'installed' }).eq('id', plugin.id)
        setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, status: 'installed' } : p))
        setTimeout(() => { setDownloadProgress(0); setDownloadLabel('') }, 2000)
      } else {
        throw new Error(result.error)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setDownloadLabel(`Failed: ${message}`)
      setDownloadProgress(0)
      setTimeout(() => setDownloadLabel(''), 3000)
    } finally {
      setDownloading(null)
    }
  }

  async function handleUninstall(plugin: Plugin) {
    if (uninstalling) return
    setUninstalling(plugin.id)
    try {
      const result = await window.api.uninstallPlugin(plugin.name)
      if (result.success) {
        await supabase.from('plugins').update({ status: 'not-installed' }).eq('id', plugin.id)
        setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, status: 'not-installed' } : p))
      }
    } catch (err: unknown) {
      console.error('Uninstall failed:', err)
    } finally {
      setUninstalling(null)
    }
  }

  const toggleCategory = (cat: Category) => {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const filtered = plugins.filter(p => {
    if (!ownedPluginIds.has(p.id)) return false
    const status = normalizePluginStatus(p.status)
    const matchesNav =
      activeNav === 'all' ||
      (activeNav === 'updates' && status === 'update') ||
      (activeNav === 'installed' && status === 'installed') ||
      (activeNav === 'not-installed' && (status === 'not-installed' || status === 'available' || status === 'unknown')) ||
      (activeNav === 'hidden' && false)
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = categories.includes(p.category as Category)
    return matchesNav && matchesSearch && matchesCategory
  })

  const owned = plugins.filter(p => ownedPluginIds.has(p.id))

  const navItems: { key: NavItem; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: owned.length },
    { key: 'not-installed', label: 'Not installed', count: owned.filter(p => {
      const status = normalizePluginStatus(p.status)
      return status === 'not-installed' || status === 'available' || status === 'unknown'
    }).length },
    { key: 'updates', label: 'Available updates', count: owned.filter(p => normalizePluginStatus(p.status) === 'update').length },
    { key: 'installed', label: 'Installed products', count: owned.filter(p => normalizePluginStatus(p.status) === 'installed').length },
    { key: 'hidden', label: 'Hidden products', count: 0 },
  ]

  // ── Guards ────────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ background: '#000', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: GOLD_DIM, fontSize: '13px', letterSpacing: '2px' }}>LOADING…</div>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen oauthError={oauthError} />
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      fontFamily: "'Segoe UI', sans-serif",
      overflow: 'hidden',
      background: '#000',
    }}>
      {/* SIDEBAR */}
      <div style={{
        width: '220px',
        minWidth: '220px',
        background: '#000',
        borderRight: `1px solid ${GOLD_DIM}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
      }}>
        <div style={{
          padding: '0 20px 24px',
          borderBottom: `1px solid ${GOLD_DIM}`,
          marginBottom: '16px',
        }}>
          <div style={{ fontSize: '11px', letterSpacing: '4px', color: GOLD, fontWeight: 700, textTransform: 'uppercase' }}>3LIXIR</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: GOLD_BRIGHT, letterSpacing: '2px', textTransform: 'uppercase' }}>LOADER</div>
        </div>

        <div style={{ padding: '0 20px 8px', fontSize: '10px', letterSpacing: '2px', color: GOLD_DIM, textTransform: 'uppercase' }}>Software</div>

        {navItems.map(item => (
          <button
            key={item.key}
            onClick={() => setActiveNav(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 20px',
              background: activeNav === item.key ? `${GOLD}22` : 'transparent',
              border: 'none',
              borderLeft: activeNav === item.key ? `2px solid ${GOLD_BRIGHT}` : '2px solid transparent',
              cursor: 'pointer',
              color: activeNav === item.key ? GOLD_BRIGHT : '#888',
              fontSize: '13px',
              textAlign: 'left',
              width: '100%',
              transition: 'all 0.15s',
            }}
          >
            <span>{item.label}</span>
            {item.count > 0 && (
              <span style={{ color: activeNav === item.key ? GOLD_BRIGHT : GOLD_DIM, fontSize: '12px', fontWeight: 600 }}>{item.count}</span>
            )}
          </button>
        ))}

        <div style={{ padding: '24px 20px 8px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: GOLD_DIM, textTransform: 'uppercase', marginBottom: '8px' }}>Search</div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              width: '100%',
              background: '#111',
              border: `1px solid ${GOLD_DIM}`,
              borderRadius: '4px',
              padding: '6px 10px',
              color: GOLD_BRIGHT,
              fontSize: '12px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ padding: '16px 20px 8px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: GOLD_DIM, textTransform: 'uppercase', marginBottom: '10px' }}>Categories</div>
          {(['Apps', 'Content', 'Plugins', 'Instruments', 'Audio Units'] as Category[]).map(cat => (
            <div key={cat} onClick={() => toggleCategory(cat)} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', cursor: 'pointer' }}>
              <div style={{
                width: '16px', height: '16px',
                border: `2px solid ${categories.includes(cat) ? GOLD_BRIGHT : GOLD_DIM}`,
                borderRadius: '3px',
                background: categories.includes(cat) ? GOLD : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', flexShrink: 0,
              }}>
                {categories.includes(cat) && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span style={{ color: categories.includes(cat) ? GOLD_BRIGHT : '#666', fontSize: '13px' }}>{cat}</span>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{
        flex: 1,
        backgroundImage: `url(${brickBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', zIndex: 0 }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* HEADER */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 28px', borderBottom: `1px solid ${GOLD_DIM}`,
            background: '#000', minHeight: '78px', boxSizing: 'border-box',
          }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: GOLD_BRIGHT, letterSpacing: '1px' }}>
              {navItems.find(n => n.key === activeNav)?.label}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {activeNav === 'updates' && filtered.length > 0 && (
                <button style={{
                  background: GOLD, border: 'none', borderRadius: '6px',
                  padding: '8px 20px', color: '#000', fontWeight: 800, fontSize: '13px',
                  cursor: 'pointer', letterSpacing: '1px',
                }}>Update All</button>
              )}

              {/* ── USER / SIGN OUT ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: GOLD_DIM, fontSize: '12px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${GOLD_DIM}`,
                    borderRadius: '6px',
                    padding: '8px 16px',
                    color: GOLD,
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    letterSpacing: '1px',
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>

          {/* PLUGIN LIST */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px', paddingBottom: '8px' }}>
            {loading ? (
              <div style={{ color: GOLD_DIM, textAlign: 'center', marginTop: '60px', fontSize: '14px' }}>
                Loading plugins...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ color: GOLD_DIM, textAlign: 'center', marginTop: '60px', fontSize: '14px' }}>
                No plugins found
              </div>
            ) : (
              filtered.map(plugin => {
                const status = normalizePluginStatus(plugin.status)
                return (
                <div key={plugin.id} style={{
                  display: 'flex', alignItems: 'center',
                  padding: '14px 18px', marginBottom: '8px',
                  background: 'rgba(0,0,0,0.6)', border: `1px solid ${GOLD_DIM}`,
                  borderRadius: '6px', backdropFilter: 'blur(4px)',
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '8px',
                    background: `${GOLD}33`, border: `1px solid ${GOLD_DIM}`,
                    marginRight: '16px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: GOLD, fontSize: '16px', fontWeight: 900,
                  }}>
                    {plugin.name[0]}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>{plugin.name}</div>
                    <div style={{ color: GOLD_DIM, fontSize: '11px', marginTop: '2px' }}>{plugin.description}</div>
                  </div>

                  <div style={{ color: '#888', fontSize: '13px', marginRight: '24px', minWidth: '80px', textAlign: 'right' }}>
                    {plugin.file_size}
                  </div>

                  <div style={{
                    color: status === 'update' ? GOLD_BRIGHT : '#666',
                    fontSize: '13px', marginRight: '20px', minWidth: '50px',
                    textAlign: 'right', fontWeight: status === 'update' ? 700 : 400,
                  }}>
                    {plugin.version}
                  </div>

                  {/* ── ACTION BUTTONS ── */}
                  {status === 'update' && (
                    <button
                      onClick={() => handleDownload(plugin)}
                      disabled={!!downloading}
                      style={{
                        background: downloading === plugin.id ? GOLD_DIM : GOLD,
                        border: 'none', borderRadius: '5px',
                        padding: '6px 18px', color: '#000', fontWeight: 800,
                        fontSize: '12px',
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        minWidth: '80px',
                        opacity: downloading && downloading !== plugin.id ? 0.5 : 1,
                      }}
                    >{downloading === plugin.id ? 'Updating…' : 'Update'}</button>
                  )}

                  {(status === 'not-installed' || status === 'available' || status === 'unknown') && (
                    <button
                      onClick={() => handleDownload(plugin)}
                      disabled={!!downloading}
                      style={{
                        background: downloading === plugin.id ? GOLD_DIM : 'transparent',
                        border: `1px solid ${GOLD}`,
                        borderRadius: '5px',
                        padding: '6px 18px',
                        color: downloading === plugin.id ? '#000' : GOLD,
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        minWidth: '80px',
                        opacity: downloading && downloading !== plugin.id ? 0.5 : 1,
                      }}
                    >
                      {downloading === plugin.id ? 'Installing…' : 'Download'}
                    </button>
                  )}

                  {status === 'coming soon' && (
                    <div style={{ color: GOLD_DIM, fontSize: '12px', minWidth: '80px', textAlign: 'center' }}>
                      Coming Soon
                    </div>
                  )}

                  {status === 'installed' && (
                    <button
                      onClick={() => handleUninstall(plugin)}
                      disabled={!!uninstalling}
                      style={{
                        background: 'transparent',
                        border: `1px solid #555`,
                        borderRadius: '5px',
                        padding: '6px 18px',
                        color: uninstalling === plugin.id ? '#555' : '#888',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: uninstalling ? 'not-allowed' : 'pointer',
                        minWidth: '80px',
                        opacity: uninstalling && uninstalling !== plugin.id ? 0.5 : 1,
                      }}
                    >
                      {uninstalling === plugin.id ? 'Removing…' : 'Uninstall'}
                    </button>
                  )}
                </div>
                )
              })
            )}
          </div>
          {/* PROGRESS BAR STRIP — only visible during download */}
          <div style={{
            borderTop: `1px solid ${GOLD}`,
            background: '#000',
            height: downloadLabel ? '48px' : '0px',
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '20px',
            transition: 'height 0.25s ease',
          }}>
            {/* Gold fill */}
            <div style={{
              position: 'absolute',
              left: 0, top: 0, bottom: 0,
              width: `${downloadProgress}%`,
              background: `linear-gradient(90deg, ${GOLD_DIM}, ${GOLD}, ${GOLD_BRIGHT})`,
              transition: 'width 0.3s ease',
              opacity: downloadProgress > 0 ? 1 : 0,
            }} />
            {/* Label */}
            <span style={{
              position: 'relative',
              zIndex: 1,
              fontSize: '11px',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color: downloadProgress > 0 ? '#000' : GOLD_DIM,
              fontWeight: 700,
              mixBlendMode: downloadProgress > 50 ? 'multiply' : 'normal',
            }}>
              {downloadLabel || '3LIXIR LOADER'}
            </span>
            {downloadProgress > 0 && downloadProgress < 100 && (
              <span style={{
                position: 'absolute',
                right: '16px',
                fontSize: '11px',
                letterSpacing: '1px',
                color: downloadProgress > 85 ? '#000' : GOLD,
                fontWeight: 700,
                zIndex: 1,
              }}>
                {downloadProgress}%
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
