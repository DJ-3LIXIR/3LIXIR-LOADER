import { useState } from 'react'
import { supabase } from '../supabase'
import brickBg from '../assets/brick.png'

const GOLD = '#C9A84C'
const GOLD_BRIGHT = '#F0C040'
const GOLD_DIM = '#8B6914'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError(authError.message)
    setLoading(false)
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

          {error && (
            <div style={{
              color: '#ff4444',
              fontSize: '12px',
              background: 'rgba(255,68,68,0.08)',
              border: '1px solid rgba(255,68,68,0.3)',
              borderRadius: '4px',
              padding: '8px 12px',
            }}>
              {error}
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

        <div style={{ marginTop: '20px', fontSize: '11px', color: '#444', textAlign: 'center' }}>
          Don't have an account? Visit{' '}
          <span style={{ color: GOLD_DIM }}>3lixirmusic.com</span>
        </div>
      </div>
    </div>
  )
}
