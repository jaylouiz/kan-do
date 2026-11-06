# ADR: Tauri Client-Side API Migration

## Status

**Approved** — Tauri-only mode (no browser support)

## Context

The Kan-Do application routes Notion API calls through Nuxt server routes (`/server/api/notion/*`). For Tauri desktop deployment, this requires bundling a Nitro server sidecar, adding complexity and latency.

**Decision**: Remove server proxy layer. Call Notion REST API directly from client.

## Implementation Plan (Tauri-Only)

### Phase 1: Create Direct Notion API Client

Create `integrations/NotionClientAPI.ts` — lightweight wrapper using `fetch()` to call Notion REST API directly.

### Phase 2: Refactor NotionIntegration.ts

Replace all `/api/notion/*` proxy calls with direct Notion API calls.

### Phase 3: Refactor WizardController.vue

Replace `$fetch('/api/notion/...')` with direct API calls via `NotionClientAPI`.

### Phase 4: Refactor useNotionDataSource.ts

Replace `fetch('/api/notion/...')` with direct API calls.

### Phase 5: Archive Server Routes

Move `server/api/notion/*.ts` to `server/api/notion/_archived/` (preserved for future browser support).

## API Mapping

| Server Route | Notion REST API | Method |
|--------------|-----------------|--------|
| `databases.get` | `POST /v1/search` | Search databases |
| `database-schema.post` | `GET /v1/databases/{id}` | Get schema |
| `database.get` | `GET /v1/databases/{id}` | Verify access |
| `tasks.get` | `POST /v1/data_sources/{id}/query` | Query tasks |
| `update-task` | `PATCH /v1/pages/{id}` | Update task |
| `pages` | `GET /v1/pages/{id}` | Get page |
| `create-task.post` | `POST /v1/pages` | Create task |
| `data-sources.get` | `POST /v1/search` | List data sources |
| `archived-tasks.get` | `POST /v1/data_sources/{id}/query` | Query archived |

## Files to Create/Modify

### New

- `integrations/NotionClientAPI.ts` — Direct Notion REST API client

### Modified

- `integrations/NotionIntegration.ts` — Use direct API calls
- `components/notion/setup/wizard/WizardController.vue` — Use direct API calls
- `composables/useNotionDataSource.ts` — Use direct API calls

### Archived

- `server/api/notion/*.ts` → `server/api/notion/_archived/`

## Implementation Checklist

- [x] Create `NotionClientAPI.ts` with fetch wrapper
- [x] Migrate `NotionIntegration.ts` (9 API calls)
- [x] Migrate `WizardController.vue` (2 API calls)
- [x] Migrate `useNotionDataSource.ts` (1 API call)
- [x] Archive server routes to `server/api/notion/_archived/`
- [ ] Update `NotionIntegration.test.ts` to mock direct Notion API calls
- [x] Verify build works without server routes

---

## Future: Re-enabling Browser Support

If browser deployment is needed later:

### 1. Platform Detection

```typescript
// utils/platform.ts
export const isTauri = () => 
  typeof window !== 'undefined' && '__TAURI__' in window;
```

### 2. Conditional Routing in NotionClientAPI

```typescript
async function notionFetch(endpoint: string, options: RequestInit) {
  if (isTauri()) {
    // Direct API call
    return fetch(`https://api.notion.com${endpoint}`, options);
  } else {
    // Proxy through server (avoids CORS)
    return fetch(`/api/notion/proxy`, {
      method: 'POST',
      body: JSON.stringify({ endpoint, options })
    });
  }
}
```

### 3. Restore Server Routes

Un-archive `server/api/notion/_archived/*.ts` and create a generic proxy endpoint.

### 4. Build-time Flag

```typescript
// nuxt.config.ts
runtimeConfig: {
  public: {
    apiMode: process.env.NUXT_API_MODE || 'tauri' // 'tauri' | 'web'
  }
}
```
