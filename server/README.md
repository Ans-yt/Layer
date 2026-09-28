# Layer local service contract

The service is a dependency-free Node backend. Start it from the repository
root with:

```sh
node server/index.mjs
```

It listens on `127.0.0.1:8787` by default and serves `dist/` when that folder
exists. Set `PORT`, `LAYER_HOST`, `LAYER_DATA_DIR`, `LAYER_ALLOWED_ORIGINS`,
`LAYER_ALLOW_LOCALHOST_MCP=true`, and/or `LAYER_SECRET_KEY` to configure it.
`LAYER_SECRET_KEY` may be a 32-byte hex/base64 key; other values are SHA-256
derived. If it is omitted, a random 32-byte key is generated in
`.layer-data/master.key`.

`.layer-data/` is gitignored. Provider keys and MCP bearer tokens are encrypted
with AES-256-GCM before being written. They are never included in public API
responses. Do not copy `master.key` into source control or backups that are
accessible to untrusted users.

## Browser security

The backend accepts same-origin requests and loopback browser origins. A
non-loopback origin must be listed in `LAYER_ALLOWED_ORIGINS` (comma-separated).
Mutating requests that carry an `Origin` or `Referer` must include the
`x-layer-csrf` header. `GET /api/health` returns the per-process CSRF token so
the browser helpers can obtain it; non-browser local clients may omit the
browser headers. Responses use `no-store` and `nosniff` headers.

## JSON API

- `GET /api/health`
- `GET /api/providers`
- `POST /api/providers` — `{id,name?,kind,endpoint?,model?,key?,imageInput?,videoInput?}`
- `POST /api/providers/:id/test`
- `POST /api/providers/:id/models`
- `DELETE /api/providers/:id`
- `GET /api/connections`
- `POST /api/connections` — `{id,name,url,enabled?,authToken?,allowedTools?}`
- `POST /api/connections/:id/test`
- `POST /api/connections/:id/call` — `{name,arguments?}`
- `DELETE /api/connections/:id`
- `POST /api/ai`
- `GET /api/projects` — public project summaries
- `POST /api/projects` — persist `{project}` after stripping secrets
- `GET /api/projects/:id`
- `PUT /api/projects/:id` — replace a bounded project snapshot
- `POST /api/projects/:id/snapshots` — `{name?}` stores one bounded history entry
- `DELETE /api/projects/:id`
- `POST /api/shares` — `{project}` or `{projectId}`; returns `/?share=<token>`
- `GET /api/shares/:token` — immutable public snapshot without configurations

`POST /api/ai` requires `providerId`, `prompt`, a Layer `document`, and a
`scope` (`selection`, `page`, or `project`). It returns `{text,operations,
findings,rounds,toolTrace}`. Operations are strictly `{op:'update'|'create'|
'delete', id?, pageId?, patch?, element?}`. The server validates scope, IDs,
allowed fields, hierarchy cycles, locked/hidden intent, and applies no document
mutation itself. The frontend `applyOperations` helper performs an atomic,
undoable-ready clone after validation.

`visionProviderId` may select a separate saved provider. `visionConfig.enabled`
enables its bounded vision tool; image URLs/data URLs and labeled sampled image
frames are accepted. Native video is rejected explicitly until a verified
provider protocol is implemented. Slash commands expand only when enabled and
their declared scope permits the request.

Provider adapters are explicit: Anthropic uses `/messages` and Anthropic
headers/content, while OpenAI, OpenRouter, NVIDIA NIM, and custom providers use
their OpenAI-compatible `/chat/completions` protocol. Model discovery is
attempted through `/models`; an empty successful list or a 404/405/501 listing
endpoint is reported as a manual model fallback rather than fabricated model
data, and provider test then sends a real completion request.

Vision accepts only HTTPS image URLs or image data URLs and returns structured
findings. Video and other media are rejected with `UNSUPPORTED_MEDIA` unless a
provider-specific implementation is added. AI tool execution is bounded to six
model rounds and twelve MCP calls. MCP tools are callable only when the
connection is enabled, connected, discovered, and in `allowedTools`.

MCP uses streamable HTTP JSON-RPC with `initialize`,
`notifications/initialized`, `tools/list`, and `tools/call`, preserving the
`mcp-session-id` header. stdio is intentionally unsupported. HTTP MCP URLs are
HTTPS-only except when `LAYER_ALLOW_LOCALHOST_MCP=true` explicitly enables
localhost use. Requests are rate-limited per local client; request bodies,
project sizes, model lists, MCP schemas, tool calls, and AI rounds are bounded.

## Module exports

- `server/index.mjs`: `createServer`, `startServer`
- `server/security.mjs`: `SecureConfigStore`, AES-GCM helpers, request/body
  security helpers, public redaction helpers
- `server/network.mjs`: `safeFetch`, DNS/private-address checks, and bounded
  upstream response reads
- `server/projects.mjs`: bounded durable project store, credential stripping,
  and immutable share snapshots
- `server/providers.mjs`: `createProviderAdapter`, `discoverModels`,
  `testProvider`, provider normalization and adapter classes
- `server/mcp-client.mjs`: `StreamableHttpMcpClient`, `discoverMcpTools`,
  `callMcpTool`, MCP validation helpers
- `server/operations.mjs`: `validateOperations`, `applyOperations`,
  `parseOperations`
- `server/ai.mjs`: `runAi`, `buildAiMessages`, bounded tool/vision constants
- `src/lib/ai.ts`: typed browser API helpers plus `validateOperations` and
  atomic `applyOperations`
- `src/lib/mcp.ts`: typed browser connection/test/list/call helpers

The server uses only Node built-ins. No new package dependency is required.
Run the backend fixtures with `node --test tests/server*.mjs`; run the existing
frontend suite with `npm test -- --run`.
