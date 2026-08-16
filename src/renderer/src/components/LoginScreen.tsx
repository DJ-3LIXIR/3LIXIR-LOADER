import { useState } from 'react'
import { supabase, OAUTH_REDIRECT_URL } from '../supabase'
import brickBg from '../assets/brick.png'

const GOLD = '#C9A84C'
const GOLD_BRIGHT = '#F0C040'
const GOLD_DIM = '#8B6914'

export default function LoginScreen({ oauthError }: { oauthError?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const displayError = error || oauthError
  // A failed round-trip surfaces via App, which also releases the button.
  const waitingForBrowser = googleLoading && !oauthError

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError(authError.message)
    setLoading(false)
  }

  async function handleGoogleSignIn() {
    setError('')
    setGoogleLoading(true)

    // skipBrowserRedirect keeps Electron from navigating the app window to Google;
    // we hand the URL to the main process and it opens the real browser instead.
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })

    if (oauthError) {
      setError(oauthError.message)
      setGoogleLoading(false)
      return
    }

    if (!data?.url) {
      setError('Could not start Google sign-in.')
      setGoogleLoading(false)
      return
    }

    const result = await window.api.openOAuth(data.url)
    if (!result.success) {
      setError(result.error ?? 'Could not open your browser.')
      setGoogleLoading(false)
      return
    }

    // Stay in the loading state: the deep link back into the app resolves this,
    // and App swaps the screen out once the session lands.
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundImage: `url(${brickBg})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* dark overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)' }} />

      {/* card */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '360px',
        background: '#000',
        border: `1px solid ${GOLD_DIM}`,
        borderRadius: '10px',
        padding: '40px 36px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* branding */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', letterSpacing: '5px', color: GOLD, fontWeight: 700, textTransform: 'uppercase' }}>
            3LIXIR
          </div>
          <div style={{ fontSize: '26px', fontWeight: 900, color: GOLD_BRIGHT, letterSpacing: '4px', textTransform: 'uppercase', lineHeight: 1 }}>
            LOADER
          </div>
          <div style={{ marginTop: '10px', width: '40px', height: '2px', background: GOLD_DIM, margin: '10px auto 0' }} />
        </div>

        <form onSubmit={handleSignIn} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '10px', letterSpacing: '2px', color: GOLD_DIM, textTransform: 'uppercase' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              style={{
                background: '#111',
                border: `1px solid ${GOLD_DIM}`,
                borderRadius: '5px',
                padding: '10px 12px',
                color: GOLD_BRIGHT,
                fontSize: '13px',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '10px', letterSpacing: '2px', color: GOLD_DIM, textTransform: 'uppercase' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              style={{
                background: '#111',
                border: `1px solid ${GOLD_DIM}`,
                borderRadius: '5px',
                padding: '10px 12px',
                color: GOLD_BRIGHT,
                fontSize: '13px',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {displayError && (
            <div style={{
              color: '#ff4444',
              fontSize: '12px',
              background: 'rgba(255,68,68,0.08)',
              border: '1px solid rgba(255,68,68,0.3)',
              borderRadius: '4px',
              padding: '8px 12px',
            }}>
              {displayError}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '6px',
              background: loading ? GOLD_DIM : GOLD,
              border: 'none',
              borderRadius: '6px',
              padding: '11px',
              color: '#000',
              fontWeight: 900,
              fontSize: '13px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
              width: '100%',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* divider */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', margin: '18px 0 14px' }}>
          <div style={{ flex: 1, height: '1px', background: '#222' }} />
          <span style={{ fontSize: '9px', letterSpacing: '2px', color: '#444', textTransform: 'uppercase' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#222' }} />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={waitingForBrowser || loading}
          style={{
            width: '100%',
            background: '#111',
            border: `1px solid ${GOLD_DIM}`,
            borderRadius: '6px',
            padding: '10px',
            color: waitingForBrowser ? GOLD_DIM : GOLD_BRIGHT,
            fontWeight: 700,
            fontSize: '12px',
            letterSpacing: '1px',
            cursor: waitingForBrowser || loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '9px',
            boxSizing: 'border-box',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {waitingForBrowser ? 'Waiting for browser…' : 'Continue with Google'}
        </button>

        {waitingForBrowser && (
          <button
            type="button"
            onClick={() => setGoogleLoading(false)}
            style={{
              marginTop: '10px',
              background: 'none',
              border: 'none',
              color: '#555',
              fontSize: '11px',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Cancel
          </button>
        )}

        <div style={{ marginTop: '20px', fontSize: '11px', color: '#444', textAlign: 'center' }}>
          Don't have an account? Visit{' '}
          <span style={{ color: GOLD_DIM }}>3lixirmusic.com</span>
        </div>
      </div>
    </div>
  )
}
