import { createClient } from 'npm:@supabase/supabase-js@2'
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'

const BUCKET_NAME = '3lixir-plugins'
type DownloadPlatform = 'mac' | 'windows'

function isDownloadPlatform(value: unknown): value is DownloadPlatform {
  return value === 'mac' || value === 'windows'
}

function getStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function storageKeyPlatform(storageKey: string): DownloadPlatform | null {
  const markers: Record<DownloadPlatform, Set<string>> = {
    mac: new Set(['mac', 'macos', 'osx', 'darwin']),
    windows: new Set(['win', 'win32', 'win64', 'windows']),
  }
  const parts = storageKey.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

  if (parts.some(part => markers.mac.has(part))) return 'mac'
  if (parts.some(part => markers.windows.has(part))) return 'windows'
  return null
}

function getPlatformStorageKey(plugin: Record<string, unknown>, platform: DownloadPlatform): string | null {
  const platformKeys = [
    `${platform}_storage_key`,
    `${platform}_download_key`,
    `storage_key_${platform}`,
    `download_key_${platform}`,
  ]

  for (const key of platformKeys) {
    const value = getStringField(plugin, key)
    if (value) return value
  }

  const storageKeys = plugin.storage_keys
  if (storageKeys && typeof storageKeys === 'object' && !Array.isArray(storageKeys)) {
    const value = (storageKeys as Record<string, unknown>)[platform]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }

  const fallbackStorageKey = getStringField(plugin, 'storage_key')
  if (!fallbackStorageKey) return null

  const fallbackPlatform = storageKeyPlatform(fallbackStorageKey)
  return fallbackPlatform === null || fallbackPlatform === platform ? fallbackStorageKey : null
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  },
})

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      },
    })
  }

  // Verify auth header
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Create Supabase client with user's auth token
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Get plugin_id from request body
  const { plugin_id, platform: requestedPlatform } = await req.json()
  if (!plugin_id) {
    return new Response(JSON.stringify({ error: 'Missing plugin_id' }), { status: 400 })
  }
  if (!isDownloadPlatform(requestedPlatform)) {
    return new Response(JSON.stringify({ error: 'Missing or unsupported platform' }), { status: 400 })
  }

  // Get plugin storage key
  const { data: plugin, error: pluginError } = await supabase
    .from('plugins')
    .select('*')
    .eq('id', plugin_id)
    .single()

  if (pluginError || !plugin) {
    return new Response(JSON.stringify({ error: 'Plugin not found' }), { status: 404 })
  }

  const storageKey = getPlatformStorageKey(plugin as Record<string, unknown>, requestedPlatform)
  if (!storageKey) {
    return new Response(JSON.stringify({ error: `No ${requestedPlatform} download available for this plugin` }), { status: 404 })
  }

  // Verify user owns this plugin
  const { data: orders } = await supabase
    .from('orders')
    .select('items')
    .eq('user_id', user.id)
    .eq('status', 'completed')

  const owns = orders?.some(order => {
    const items = order.items as Array<{ id: string; type: string }>
    return Array.isArray(items) && items.some(
      item => item.type === 'plugin' && item.id === plugin_id
    )
  })

  if (!owns) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  // Generate signed URL — expires in 15 minutes
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: storageKey,
  })

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 })

  return new Response(
    JSON.stringify({ url: signedUrl, filename: storageKey.split('/').pop(), platform: requestedPlatform }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
})
