# ADR 003: Tauri HTTP Plugin for CORS Bypass

## Status

Accepted

## Date

2025-11-29

## Context

After migrating Notion API calls from server-side Nuxt routes to client-side for Tauri desktop support, we encountered CORS errors in production builds. The browser's native `fetch` API was being blocked by Notion's CORS policy, even though we were running inside a Tauri webview.

### Problem Chain

1. **Initial issue**: Tauri production builds couldn't make direct Notion API calls
2. **Root cause 1**: `isTauri()` detection used `__TAURI__` which doesn't exist in Tauri 2.x (uses `__TAURI_INTERNALS__` instead)
3. **Root cause 2**: Even with correct detection, browser `fetch` in Tauri webview still enforces CORS
4. **Solution**: Use Tauri's HTTP plugin which makes requests at the Rust level, bypassing browser CORS

## Decision

### 1. Tauri Environment Detection

```typescript
const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  // Tauri 2.x uses __TAURI_INTERNALS__, Tauri 1.x uses __TAURI__
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
};
```

### 2. Tauri HTTP Plugin Integration

**Frontend** (`@tauri-apps/plugin-http`):

```typescript
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// In Tauri mode, use tauriFetch instead of native fetch
if (isTauri()) {
  response = await tauriFetch(url, options);
}
```

**Backend** (`tauri-plugin-http` in Rust):

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
  .plugin(tauri_plugin_http::init())
```

**Permissions** (`src-tauri/capabilities/default.json`):

```json
{
  "permissions": [
    "core:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://api.notion.com/**" }
      ]
    }
  ]
}
```

### 3. Dual-Mode API Calls

| Environment | Detection | HTTP Client | CORS |
|-------------|-----------|-------------|------|
| Browser (dev) | `isTauri() = false` | Server proxy routes | N/A (same-origin) |
| Browser (prod) | `isTauri() = false` | Server proxy routes | N/A (same-origin) |
| Tauri (dev) | `isTauri() = true` | `tauriFetch` | Bypassed |
| Tauri (prod) | `isTauri() = true` | `tauriFetch` | Bypassed |

### 4. Notion API Versioning

Different endpoints require different API versions:

- **Standard endpoints** (`/search`, `/databases`, `/pages`): `2022-06-28`
- **Data sources endpoints** (`/data_sources/*`): `2025-09-03`

```typescript
const needsDataSourceVersion = endpoint.includes('data_source') || 
  (endpoint === '/search' && body?.includes('data_source'));
const apiVersion = needsDataSourceVersion ? '2025-09-03' : '2022-06-28';
```

## Consequences

### Positive

- ✅ Tauri production builds can make direct Notion API calls
- ✅ No server required for Tauri desktop app
- ✅ Browser mode continues to work via server proxy
- ✅ Single codebase handles both environments

### Negative

- ⚠️ Additional dependency on Tauri HTTP plugin
- ⚠️ Slightly larger bundle size (~3KB for plugin JS)
- ⚠️ Must maintain permission allowlist for external APIs

### Neutral

- Server proxy routes remain for browser compatibility
- Debug logging available in production (can be removed)

## Files Changed

- `integrations/NotionClientAPI.ts` - Dual-mode fetch with Tauri detection
- `src-tauri/src/lib.rs` - HTTP plugin registration
- `src-tauri/Cargo.toml` - Added `tauri-plugin-http` and `devtools` feature
- `src-tauri/capabilities/default.json` - HTTP permissions for Notion API
- `package.json` - Added `@tauri-apps/plugin-http`

## References

- [Tauri HTTP Plugin Documentation](https://v2.tauri.app/plugin/http-client/)
- [Tauri 2.x Migration Guide](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [Notion API Versioning](https://developers.notion.com/reference/versioning)
