import { createClient } from 'npm:@supabase/supabase-js@2'
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'

const BUCKET_NAME = '3lixir-plugins'

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
  const { plugin_id } = await req.json()
  if (!plugin_id) {
    return new Response(JSON.stringify({ error: 'Missing plugin_id' }), { status: 400 })
  }

  // Get plugin storage key
  const { data: plugin, error: pluginError } = await supabase
    .from('plugins')
    .select('storage_key, name')
    .eq('id', plugin_id)
    .single()

  if (pluginError || !plugin?.storage_key) {
    return new Response(JSON.stringify({ error: 'Plugin not found' }), { status: 404 })
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
    Key: plugin.storage_key,
  })

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 })

  return new Response(
    JSON.stringify({ url: signedUrl, filename: plugin.storage_key.split('/').pop() }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
})
