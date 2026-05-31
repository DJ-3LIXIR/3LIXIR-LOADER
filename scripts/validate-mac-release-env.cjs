const hasApiKeyAuth =
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER

const hasAppleIdAuth =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID

const hasKeychainAuth = process.env.APPLE_KEYCHAIN_PROFILE

if (!hasApiKeyAuth && !hasAppleIdAuth && !hasKeychainAuth) {
  console.error(
    [
      'Missing Apple notarization credentials for a distributable macOS build.',
      '',
      'Set one of these before running npm run build:mac:',
      '- APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER',
      '- APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID',
      '- APPLE_KEYCHAIN_PROFILE, optionally APPLE_KEYCHAIN',
      '',
      'For local-only unsigned testing, run npm run build:mac:local.',
    ].join('\n')
  )
  process.exit(1)
}
