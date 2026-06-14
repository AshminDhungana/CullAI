# Code Signing Setup for CullAI

> This document contains placeholder instructions for setting up code signing across platforms.
> **Without valid certificates, builds will still work but will show "untrusted publisher" warnings.**

## macOS (Apple Developer ID)

1. **Join the Apple Developer Program** ($99/year) at https://developer.apple.com
2. **Generate a Developer ID certificate** in Xcode or the Apple Developer Portal
3. **Export the certificate** as a `.p12` file and note the password
4. **Set environment variables** before building:
   ```bash
   export CSC_LINK="path/to/certificate.p12"
   export CSC_KEY_PASSWORD="your-cert-password"
   export APPLE_ID="your-apple-id@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
   export APPLE_TEAM_ID="TEAM123456"
   ```

### GitHub Actions Secrets (macOS)
- `CSC_LINK` - Base64-encoded `.p12` certificate (or download URL)
- `CSC_KEY_PASSWORD` - Certificate password
- `APPLE_ID` - Apple ID email
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password from https://appleid.apple.com
- `APPLE_TEAM_ID` - Apple Team ID (10-character string)

## Windows (Code Signing Certificate)

1. **Purchase a code signing certificate** from a trusted CA (e.g. DigiCert, Sectigo, Certum)
2. **Export the certificate** as a `.p12` or `.pfx` file
3. **Set environment variables** before building:
   ```powershell
   $env:WIN_CSC_LINK="path/to/certificate.p12"
   $env:WIN_CSC_KEY_PASSWORD="your-cert-password"
   ```

### GitHub Actions Secrets (Windows)
- `WIN_CSC_LINK` - Base64-encoded `.p12` certificate (or download URL)
- `WIN_CSC_KEY_PASSWORD` - Certificate password

## Linux (AppImage Signing)

AppImages can be signed with `gpg` using the `appimage-sign` tool. This is optional.

## Local Development

During development, code signing is **automatically skipped** because:
- `app.isPackaged` is `false` (dev mode), or
- The `env.NODE_ENV === 'development'` check

To create unsigned test builds locally:
```bash
npm run build:all
npx electron-builder --publish=never
```

## electron-builder Configuration

code signing is handled automatically by `electron-builder` when the above environment variables are present. The `electron-builder.config.ts` already includes:

```ts
win: {
  verifyUpdateCodeSignature: false,  // allows unsigned updates for testing
},
mac: {
  hardenedRuntime: true,
  gatekeeperAssess: true,
  entitlements: 'build/entitlements.mac.plist',
  entitlementsInherit: 'build/entitlements.mac.plist',
},
```
