# HTTP protocol

The server maintains isolated asset libraries for CMS 13. All CMS-facing routes are relative to `/i/<instanceId>`. Unknown instances return 404. These routes accept supplied credentials without validation and are separate from administration.

## CMS configuration

Use `Optimizely:Cms:DamUI:Endpoint` for the bare DAM origin without a trailing slash, such as `http://localhost:8083`, and `Path` for `i/<id>/cloud/library-picker` (a leading slash is optional). The CMS compares the picker message origin to Endpoint exactly and assigns Path as the popup URL pathname. Endpoint is derived from PUBLIC_BASE_URL with its path and trailing slash stripped. `Optimizely:Cmp:Client` contains `ApiUrl` ending in `/i/<id>/v3/`, `TokenUrl` ending in `/i/<id>/o/oauth2/v1/token`, `ClientId` and `ClientSecret`. Keep the CMS ContentGraph configuration connected to the same Graph instance. Register `services.AddContentGraph().AddDamUI().AddGraphContentSources();`, then enable DAM in CMS admin.

## Picker

`GET /i/<id>/cloud/library-picker` and `GET /i/<id>/` return the same responsive HTML picker. `pickerOptions` is Base64 JSON. Invalid encodings and unknown fields are ignored. Recognised `assetTypes` values are `image`, `video`, `raw_file`; an empty or entirely unknown list imposes no restriction. `multiSelect: true` enables multiple selection; default is single selection.

`q`, `folder` and `type` query parameters filter the displayed asset grid. Search matches title, description and tags without case sensitivity. A folder filter selects that folder's immediate assets. Selected asset IDs are carried through folder and search navigation for the current popup. Selection sends the following array to `window.opener.postMessage(array, '*')`, then closes the popup:

```json
[{"id":"10000000000040008000000000000001","url":"http://localhost:8083/i/example/files/10000000000040008000000000000001.svg","title":"Example image","type":"image"}]
```

The message itself is an array with no top-level `type` property. Without an opener, the page displays the JSON. Picker and CMP paths do not emit CORS headers or apply dashboard origin/auth checks.

## Asset files

`GET /i/<id>/files/<32-lowercase-hex-id>.<ext>` returns exact file bytes and the stored Content-Type. Extension must match the current asset. HEAD returns the same metadata without bytes. Responses include `Cache-Control: public, max-age=60`, `Access-Control-Allow-Origin: *`, and a quoted content-hash ETag. Matching `If-None-Match` (including weak tags and `*`) returns 304. File OPTIONS returns 204 for GET/HEAD/OPTIONS preflight. GET bodies are streamed; ETags are SHA-256 content hashes cached in metadata on upload/replacement. HEAD and 304 responses do not read file bodies. `Accept-Ranges: bytes` advertises single byte ranges: `Range: bytes=a-b`, open-ended and suffix ranges return 206 with Content-Range and the selected Content-Length. Unsatisfiable ranges return 416 with `Content-Range: bytes */<size>`; malformed or multiple ranges are ignored. Raw files use attachment disposition. `?width=N` is accepted and ignored; no local resizing occurs.

## CMP and token endpoints

These endpoints answer only callers on the same machine (127.0.0.0/8, `::1`, `::ffff:127.x`). Other callers receive 403 `{"message":"This local development API only answers this machine. Set LDA_ALLOW_REMOTE_API=true to override (not recommended)."}` unless the server runs with `LDA_ALLOW_REMOTE_API=true`. Asset files and the picker are not restricted.

| Method and instance-relative path | Request | Response |
| --- | --- | --- |
| `POST v3/assets/{assetId}/lineages` | JSON `{name, uri}` | 200 `{"id":"<tracking UUID>"}`. Stores trackingId, assetId, name, uri and ISO at. Unknown assets return 404. |
| `DELETE v3/assets/{assetId}/lineages/{trackingId}` | Content-Type application/json; body optional | 204; removes the matching usage if present. |
| `GET v3/asset-lineages` | None | 200 `{"data":[...usages]}`. |
| `GET v3/asset-urls/{assetId}` | None | 200 `{"url":"<absolute file URL>"}`; unknown asset returns 404. |
| `POST o/oauth2/v1/token` | JSON or form fields client_id, client_secret, grant_type | 200 `{"token_type":"Bearer","access_token":"<random>","expires_in":3600}`; any credentials accepted. |

Lineage POST/DELETE require `Content-Type: application/json`; token POST requires `application/json` or `application/x-www-form-urlencoded`. Parameters such as `charset=utf-8` are accepted. Unsupported or missing media types return 415 before body parsing.

Authorization `epi-hmac`, Bearer, and X-USER-SSO-ID are accepted but never verified. Logs identify auth kind and redact values. No token or HMAC validation is performed.

## Graph synchronization

Graph link credentials are independent of CMP credentials. Every Graph request uses `Authorization: Basic <base64(appKey:secret)>` against the configured gateway address.

`PUT /api/content/v3/types?id=cmp` supplies a model with empty propertyTypes and these content types:

- `cmp_Asset`: abstract, inherits `_Item`, defines Id, Url, Title, Description, AltText, MimeType, CreatedAt, ModifiedAt.
- `cmp_PublicImageAsset` and `cmp_PublicImageAssetRendition`: inherit cmp_Asset and `_ImageItem`, define Width and Height.
- `cmp_PublicVideoAsset`: inherits cmp_Asset and `_AssetItem`, defines Width and Height.
- `cmp_PublicRawFileAsset` and `cmp_PublicVideoAssetRendition`: inherit cmp_Asset and `_AssetItem`.

The stream at `POST /_stream` uses `application/x-ndjson`, with an index action followed by its document. Deletes occupy one line without a source document:

```json
{"index":{"_id":"cmp_10000000000040008000000000000001","_snapshotTime":"2026-01-02T12:00:00.000Z"}}
{"__typename":"cmp_PublicImageAsset","_itemMetadata":{"key":"10000000000040008000000000000001","displayName":"Example image","type":"cmp_PublicImageAsset","lastModified":"2026-01-02T12:00:00.000Z"},"_assetMetadata":{"url":"http://localhost:8083/i/example/files/10000000000040008000000000000001.svg","mimeType":"image/svg+xml","fileSize":200},"_imageMetadata":{"width":640,"height":360},"_rbac":["r:Everyone:Read"],"Id":"10000000000040008000000000000001","Url":"http://localhost:8083/i/example/files/10000000000040008000000000000001.svg","Title":"Example image","Description":"","AltText":"","MimeType":"image/svg+xml","CreatedAt":"2026-01-02T12:00:00.000Z","ModifiedAt":"2026-01-02T12:00:00.000Z","Width":640,"Height":360}
{"delete":{"_id":"cmp_20000000000040008000000000000001"}}
```

Image metadata is present for images, with unknown dimensions omitted. Width/Height are emitted only for image and video types when detected, rounded with Math.round to positive signed 32-bit integers; zero, negative and out-of-range values are omitted. SVG dimensions require MIME image/svg+xml. Unsupported video dimensions are omitted. File URLs use PUBLIC_BASE_URL or `http://localhost:<actual PORT>`. Models and all current documents synchronize after a one-second asset-change debounce or an explicit sync. Runs are serialized. Pending deletions persist until successful synchronization. If Graph returns a journalId, `GET /journal/stream/{journalId}` is checked for operation errors. HTTP failures, timeouts and journal errors update lastSync with ISO at, HTTP status when available, and error text.

The visibility check requests `GET /api/content/v3/sources?id=cmp`. Success means “DAM visible to CMS: yes”; failure means no. The CMS caches a negative availability result for 30 minutes; synchronize before CMS startup or restart after the first sync.

## Administration and health

`GET /health` returns `{"status":"ok","tenants":{...}}` on loopback or with valid admin credentials. On non-loopback without valid admin credentials it returns only `{"status":"ok"}`. Health does not load stores.

Admin HTML uses CSP `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`. The popup picker uses `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Uploaded HTML retains the file route's sandbox CSP.

Administration is at `/` and `/tenants/<id>`. It uses Graph-style Host/Origin checks and independent ADMIN Basic credentials for non-loopback bindings. Every POST requires the per-process CSRF token emitted by forms. Instance and asset deletions, and instance clear, require an exact typed ID. Browser form actions redirect with HTTP 303; invalid fields return 400, CSRF/Origin/Host failures 403, missing admin authentication 401, unknown resources 404.

Name-only instance creation is `POST /tenants`. Instance edit, Graph linking, sync, visibility check, upload, sample generation, folder management, asset metadata/replacement, and confirmation/clear/delete use forms on the instance page. Multipart uploads have 50 MB per-file and 256 MB request limits and at most 200 parts. A root folder always exists. Folders with assets or child folders cannot be deleted.

`GET /tenants/<id>/stats` returns asset/folder/usage counts and lastSync. `GET /tenants/<id>/request/<n>` renders a numbered request detail. Request logs are instance-scoped NDJSON, contain bounded redacted bodies, restore 500 recent records and rotate at 50 MB with three archives. Requests without an instance route use `_unrouted` logs.
