import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://tciugratutxxrdtbsxim.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjaXVncmF0dXR4eHJkdGJzeGltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NzYwMDgsImV4cCI6MjA4MzA1MjAwOH0.-yif_fwvYOwE6kG4nkSc1HXyF-cHTlZGWGJ91YXsPuM'

export const OAUTH_REDIRECT_URL = 'com.3lixirmusic.loader://auth-callback'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE is required: the OAuth round-trip happens in the system browser, so the
    // code verifier stays here in the renderer and never leaves the app.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // The renderer loads from file://, so there is never a session in the page URL.
    // The deep-link handler in the main process delivers the code instead.
    detectSessionInUrl: false
  }
})