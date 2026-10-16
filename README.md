> **Development and research use only. Never use in production.**
> LDA Local Assets runs local stand-ins for Optimizely cloud services on a single
> developer machine. It is not a replacement for any Optimizely service: its
> behaviour, limits and performance differ, so always test against the real services
> before release. Keep it bound to localhost and never expose it to a network.
> Provided "as is", without warranty of any kind. Its data folder holds copies of
> your CMS content, including drafts; treat it as sensitive. No telemetry. See
> PRIVACY.md and LEGAL-NOTICE.md.
> LDA Local Assets is an independent project, not affiliated with, sponsored by or
> endorsed by Optimizely. Optimizely® and the Optimizely product names are trademarks
> or registered trademarks of Optimizely North America Inc. or its related entities.

# LDA Local Assets

Part of **Local Developer Accelerator for Optimizely** — by Coding Koala. Compatible with Optimizely DAM for CMS 13.

A single Node.js process that stores an asset library, serves the CMS 13 DAM picker and files, and pushes asset documents into the `cmp` source of a linked Graph gateway (for example LDA Local Graph).

Usage tracking is best-effort, credentials are accepted without validation on the CMS endpoints, and image resizing is not available.

## Install with the LDA CLI

```powershell
npm i -g https://github.com/coding-koala-io/local-developer-accelerator/releases/download/v1.0.0/coding-koala-io-accelerator-1.0.0.tgz
lda install assets
```

Once the CLI is published to npm, you can install it with `npm i -g @coding-koala-io/accelerator` instead. `lda self-update` handles both.

The CLI installs the latest release as the Windows service `LdaAssets` and prints the CMS settings for the first instance. To work on the code itself, see [Getting started from source](#getting-started-from-source).

## Why this exists

- **Faster inner loop.** Upload an asset, select it in the CMS and inspect its metadata on your own machine.
- **Works locally.** Develop with your own files or generated sample images and a sample PDF.
- **Everything is visible.** Inspect Graph synchronization status, optional usage tracking and individual requests.
- **Several sites, one process.** Give each development site its own assets, credentials, folders and linked Graph instance.
- **Easy to reset.** Clear one asset library and try the CMS integration again.

It is for development and research use only.

## Getting started from source

1. **Requirements:** Node.js 24 or later, a local Graph gateway, and a CMS 13 site with the `EPiServer.Cms.DamIntegration.UI` package.
2. **Install and start:**

   ```powershell
   git clone https://github.com/coding-koala-io/lda-assets.git
   cd lda-assets
   npm install
   npm start
   ```

   Open <http://localhost:8083/>. There are no runtime dependencies.
3. **Create and prepare an instance.** Enter a name under **New instance**. On its page, fill in **Graph link** with the gateway address (default `http://localhost:8082`) and that Graph instance's push `appKey` and `secret`. Upload files or click **Add sample assets**, then **Sync all to Graph now**. **Check DAM visibility** must show **yes**.
4. **Connect the CMS.** Copy the instance's **Connect** snippet into `appsettings.Development.json`. Its shape is:

   ```json
   {
     "Optimizely": {
       "Cms": { "DamUI": {
         "Endpoint": "http://localhost:8083",
         "Path": "i/my-site/cloud/library-picker"
       } },
       "Cmp": { "Client": {
         "ApiUrl": "http://localhost:8083/i/my-site/v3/",
         "TokenUrl": "http://localhost:8083/i/my-site/o/oauth2/v1/token",
         "ClientId": "<generated client ID>",
         "ClientSecret": "<generated Base64 secret>"
       } }
     }
   }
   ```

   Keep your existing `Optimizely:ContentGraph` settings pointing to the same Graph instance. Register the integration:

   ```csharp
   services.AddContentGraph().AddDamUI().AddGraphContentSources();
   ```

   Start the CMS after synchronizing, then enable DAM in its admin UI. The CMS caches “DAM not available” for 30 minutes; restart the CMS if it was started before the first successful sync.
5. **Use and inspect it.** Open a DAM asset property in the CMS, choose an asset and save/publish. Use **Assets** to edit metadata, replace files and move assets between folders. **Usage**, **Requests**, and **Graph link** show tracking records, request details, and synchronization results. **Open picker preview** also works without a CMS: selection displays its JSON when there is no opener.

## Troubleshooting

Picked asset does not appear in the field → Endpoint must have no trailing slash; hard-reload the CMS edit UI after changing settings.

- **DAM is missing in the CMS.** Save the Graph link, synchronize assets and check visibility before starting the CMS. Restart the CMS to clear its negative availability cache. Enable DAM in CMS admin and include `AddGraphContentSources()`.
- **Synchronization fails.** Check the last HTTP status and error in **Graph link**. Use the linked Graph instance's push credentials. Assets stay local and failed deletions remain queued; retry with **Sync all to Graph now**.
- **Images do not load.** Set `PUBLIC_BASE_URL` to the origin reachable by the CMS and browser, then sync again. A port change requires updating the CMS settings and resynchronizing the file URLs.
- **Port 8083 is in use.** Choose another port, for example `$env:PORT = '8093'; npm start`.
- **An edited tenants.json is rejected.** Fix the reported validation error and save again. Invalid hot reloads retain the previous configuration. Dashboard edits refuse to overwrite unprocessed manual changes.

## Configuration

| Variable | Default | Behavior |
| --- | --- | --- |
| `PORT` | `8083` | Listen port; `0` selects a free port, printed at startup. |
| `HOST` | `127.0.0.1` | Bind address. Non-loopback bindings require both admin credentials. |
| `TENANTS_FILE` | `./tenants.json` | Instance registry; a missing file starts with an empty directory. |
| `DATA_DIR` | `./data` | Per-instance `assets.json` and `files/`. `:memory:` disables disk persistence. |
| `LOG_DIR` | `./logs` | Per-instance `requests.ndjson`; `:memory:` keeps only recent entries. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | empty | Independent Basic credentials for the dashboard on a non-loopback binding. |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | HTTP(S) URL normalized to its origin (path and trailing slash stripped) for asset URLs and CMS snippets. Actual selected port is used with `PORT=0`. |
| `PUBLIC_HOSTNAMES` | empty | Comma-separated trusted admin proxy hostnames/origins, like `dam.lan,https://proxy.example`. |
| `LOG_BODIES` | `true` | Record bodies up to 64 KB each; `false` records null bodies. Binary uploads and HTML responses are summarized. |
| `LDA_ALLOW_REMOTE_API` | empty | `true` lets callers other than this machine use the CMP token, lineage and asset URL API. Not recommended. |

A non-loopback `HOST` prints a loud startup warning: anyone on the network can reach the server, so never point a shared or production site at it.

`GET /health` always returns `status`, `product` (`assets`), `version` and `dataVersion`; instance details are added for loopback or administrator callers. `tenants.json` records `"dataVersion": 1`. The server refuses to start, with exit code 3 and without changing the file, when it was written by a newer version (`Data in <path> was written by a newer version (dataVersion <n>). Upgrade LDA Local Assets or restore a backup.`) or when `dataVersion` is not a positive whole number (`Data in <path> has an invalid dataVersion (<value>).`). Upgrade, restore a backup or correct the value, then start again.

The dashboard accepts loopback administration without credentials. Non-loopback administration requires independent ADMIN Basic credentials. Tenant CMP credentials do not grant administrator rights. Admin Host/Origin checks prevent cross-origin form submissions and unexpected loopback Host names; every mutation requires CSRF. Destructive actions use a separate confirmation page and an exact typed instance or asset ID.

CMS-facing picker, CMP and token paths are instance-scoped and bypass admin authentication and browser-origin rules. The CMP token, lineage and asset URL API (`/i/<id>/o/oauth2/v1/token`, `/i/<id>/v3/...`) answers only callers on this machine (127.0.0.0/8, `::1`) and returns 403 to others unless `LDA_ALLOW_REMOTE_API=true`; files and the picker are unchanged. CMP credentials are accepted without verification and only their auth kind is recorded. File GET/HEAD/OPTIONS has wildcard CORS; other SDK endpoints do not emit CORS headers. This is intentionally a local development stand-in.

## Instances and routing

Name-only creation generates a lowercase slug, a `dam-<id>-<8hex>` client ID and a 32-byte Base64 secret. Duplicate names get `-2`, `-3` and so on, skipping existing data/log folders. The Graph link starts empty.

```json
{
  "tenants": [{
    "id": "my-site", "name": "My site",
    "clientId": "dam-my-site-0123abcd",
    "clientSecret": "<generated Base64 secret>",
    "graph": {}
  }]
}
```

A configured `graph` has `gatewayAddress`, `appKey` and `secret`, all required together. IDs use 1–63 lowercase letters, digits and hyphens and cannot start with a hyphen. Client IDs are unique, 1–200 letters/digits or `._~-`. Names are 1–100 characters. Secrets must be nonempty without edge whitespace.

Configuration is validated at startup and hot reloaded after 300 ms. Renaming an instance ID while retaining its client ID moves data/log folders; collisions are refused. Update CMS settings afterward. Deletion offers retained folders or permanent local removal, and optionally removes the instance's Graph documents first. A failed requested Graph cleanup retains the instance for retry.

## Dashboard

Every page shows a development-only banner and a footer with links to **About** (`/about`: product, version, data version, publisher and licence), **Privacy**, **Licence** and **Legal notice**, which display PRIVACY.md, LICENSE.md and LEGAL-NOTICE.md from the installation folder. About pages follow the same access rules as the dashboard. In the asset picker, which the CMS opens for editors, the footer links open in a new tab.

The home page lists instance names, asset counts, Graph links and last synchronization. Each instance page provides **Connect**, **Graph link**, **Assets**, **Folders**, **Usage**, **Requests**, and **Danger zone** sections. Asset pages expose metadata, folder movement, file replacement and usage. Folders can be created, renamed and deleted only when empty; the root folder is permanent.

Request logs retain 500 entries in memory and show the latest 200 on the instance page. Numbered detail pages display bounded request/response data. Log files rotate at 50 MB with three archives. Authentication headers, SSO identity, cookies, keys, CSRF values and token credentials are redacted. HTML responses are summarized so connection secrets are not written to logs.

## Asset library and Graph synchronization

Each asset has a random 32-character lowercase hexadecimal ID. Uploads support multiple files, 50 MB per file and 256 MB total per request. Type is inferred from MIME/extension: image, video or raw_file. PNG, JPEG, GIF, WebP (VP8/VP8L/VP8X) and SVG dimensions are detected without libraries. Unknown image and video dimensions are omitted. File replacement retains the asset ID and metadata; its URL changes when the extension changes. The sample button adds three generated SVG rectangles with title text and one small PDF.

Asset changes synchronize after a one-second debounce when Graph is linked. **Sync all to Graph now** immediately pushes the `cmp` model and all assets. Fixed public asset/rendition types inherit Graph's media interfaces; documents use `_itemMetadata`, `_assetMetadata`, image dimensions and Everyone-read ACLs. Deleted IDs remain in persistent retry state until Graph accepts their deletion. HTTP or indexing-journal failures are shown on the instance page and do not break local asset editing.

The picker supports title/description/tag search, folder and type filters, single selection by default and `pickerOptions.multiSelect`. `pickerOptions.assetTypes` limits recognised image/video/raw_file types; unrecognised values and invalid Base64 are tolerated. Selection posts an array of `{id, url, title, type}` objects to the opener and closes; without an opener it displays the JSON.

Files stream GET bodies, support single byte ranges (206/416), and cache content-hash ETags in asset metadata. Conditional GET and HEAD do not read file bodies. Files use wildcard CORS with a 60-second public cache. `?width=N` is accepted and ignored: **no image resizing is performed locally**. Lineage tracking is stored per instance; token responses are random local Bearer tokens with a one-hour expiry.

Metadata is saved atomically to `assets.json`, debounced by 100 ms, and flushed on server close/SIGINT/SIGTERM/SIGBREAK. File writes use a temporary file and atomic rename. Corrupt metadata refuses to load and preserves its bytes for repair.

## Run as a Windows service

The Windows service is a convenience for your own development machine. It is not a server deployment and does not change the development-only scope above.

With Node.js 24 installed, run from the repository:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 install
```

Install requests Windows UAC when necessary, downloads WinSW v2.12.0 x64 and verifies SHA-256 `05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA`. Existing wrappers must match the same hash. The service ID is `LdaAssets`, display name **Local Developer Accelerator — Assets (development only)**, account `NT AUTHORITY\LocalService`, with delayed automatic start, crash restart and 15-second shutdown timeout.

Runtime lives at `C:\ProgramData\Coding Koala\Local Developer Accelerator\Assets` (quote this path in your own commands because it contains spaces): `tenants.json`, `data\`, `logs\` and `service\`. SYSTEM and Administrators have Full control, LocalService has Modify on runtime data. Users have Read/Execute only on `service\`; LocalService has Read/Execute on the service/repository and Modify on wrapper log paths. Grants are applied to folders with inherited file permissions. Before install, uninstall, start, stop or restart changes anything, the script checks every folder from below the drive root down to the runtime folder and its `service` folder: none may be a junction or symbolic link; each must be owned by SYSTEM, Administrators, TrustedInstaller or the current elevated user (ProgramData and Program Files themselves by SYSTEM, Administrators or TrustedInstaller); and no account other than SYSTEM, Administrators, TrustedInstaller or CREATOR OWNER (inherit-only) may write, delete, change permissions or take ownership. LocalService may write only to the runtime folder, `data`, `logs` and `service\logs`. The command refuses otherwise and names the folder and the account (for example a folder on a second drive that Authenticated Users can modify, which is the Windows default for new top-level folders there). Missing folders are created with restricted permissions from the start (SYSTEM and Administrators Full control; Users and LocalService Read/Execute on created parent folders), and `service`, `data`, `logs` and `service\logs` are checked again right before use. Node.js must be installed system-wide (for example `C:\Program Files\nodejs`): install refuses a `node.exe` whose folder other accounts can change, such as an nvm or AppData install. `icacls.exe`, `sc.exe` and the UAC `powershell.exe` always run from the Windows system folder. A fresh install creates a Default instance and prints its `appsettings.Development.json` snippet. Link Graph and synchronize assets before starting the CMS.

Install replaces the runtime and service directory DACLs completely, removing unrelated explicit grants as well as inherited permissions, before generating or importing credentials and data. Child permissions are reset before those writes and again after installation files are written.

Choose a custom runtime/port or import an existing developer runtime on first install:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 install -Port 9083 -RuntimeRoot D:\DamRuntime -ImportFrom D:\PreviousDamRuntime
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 plan -RuntimeRoot D:\DamPlan
```

`plan` is read-only and performs no download, elevation, service or port changes. `-ImportFrom` copies configuration/data/logs only into an empty destination; existing tenants or data/log content cause refusal. Reinstall preserves credentials and the configured port unless `-Port` is explicit. Later commands without `-RuntimeRoot` use the folder of the installed service, so `npm run service:*` keeps working after a move to another folder or drive.

Upgrade with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 stop
git pull
npm install
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 start
```

`npm run service:status` reports service/PID, listeners and health. When `LdaAssets` is not installed but the old `OptimizelyDamLocal` service is, status says so and points to [Upgrading from an older install](#upgrading-from-an-older-install-optimizelydamlocal). `npm run service:logs` tails wrapper/stdout/stderr logs; `npm run service:restart` restarts the service. Start or stop manually through `scripts\service.ps1 start` or `stop`. Install/start/stop/restart/uninstall request UAC when needed.

`npm run service:uninstall` retains runtime data. `powershell -ExecutionPolicy Bypass -File scripts\service.ps1 uninstall -RemoveData` explicitly deletes that runtime; drive roots, repository paths and junctions/symlinks are refused. A port conflict reports its PID/name and never stops the other process. Check logs after a health timeout (20 seconds); moving the repository requires reinstalling from its new location.

Service tests use isolated runtimes with mocked UAC, SCM, network, port inspection and wrapper calls. Signal tests exercise production CLI shutdown; Windows delivers process signal events through test-only IPC. Real WinSW installation and SCM signal delivery require a separate elevated manual check.

## Upgrading from an older install (OptimizelyDamLocal)

Installs made before the rename to LDA Local Assets run as the Windows service `OptimizelyDamLocal`. The current script manages the service `LdaAssets` and does not see the old one.

**Recommended:** run `lda adopt` from the LDA CLI. It keeps your existing data folder and port and registers the service under the new id `LdaAssets`.

**Manual:** `powershell -ExecutionPolicy Bypass -File scripts\service.ps1 uninstall` cannot see the old service id, so stop and remove the old service yourself from an elevated (Run as administrator) prompt. This removes only the service registration; the data folder is not touched:

```powershell
sc.exe stop OptimizelyDamLocal
sc.exe delete OptimizelyDamLocal
```

Then install the new service on the old runtime folder (the folder that holds `tenants.json`, `data\`, `logs\` and `service\`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\service.ps1 install -RuntimeRoot "<old runtime folder>"
```

Install does not read the old service's settings, so also pass `-Port <n>` if the old service did not use port 8083. Existing instances, assets and logs are kept. The old `OptimizelyDamLocal.exe` and `OptimizelyDamLocal.xml` files in `service\` are no longer used and can be deleted.

## Limitations

- Local development only; CMS/CMP endpoint credentials are deliberately permissive. Token values are not validated on later requests.
- No image resizing, renditions generation, transcoding, video dimension extraction, CDN, cloud upload APIs or full-screen Embeddable DAM.
- Usage list and asset URL responses implement a small best-effort CMP surface. There is no cloud authentication, authorization, or tracking reconciliation.
- A linked Graph gateway must support the `cmp` source, media interfaces and public asset visibility. Sync before starting the CMS. Changing the linked Graph gateway does not purge the former gateway; remove its documents before relinking if needed.
- File writes and metadata writes are individually atomic, not a transaction across a filesystem crash. Small local libraries are intended; file reads and JSON snapshots run in-process.

## Files

`src/server.js` owns HTTP dispatch and CLI shutdown. `product.js` holds the product name and version (read from `package.json`); `product-ui.js` and `about.js` provide the banner, footer and about pages. `tenants.js` handles configuration and instance runtimes; `tenant-create.js` generates credentials. `store.js` persists assets/folders/usage and file bytes. `multipart.js` parses uploads; `dimensions.js` reads image headers. `graph-sync.js` pushes models/documents and records failures. `dashboard.js`, `dashboard-style.js` and `dashboard-routes.js` provide administration; `picker.js` serves the popup. `cms-settings.js` builds CMS snippets; `admin-access.js` checks browser administration; `request-log.js` handles rotated redacted logs. `scripts/` contains Windows service tooling and the release build (`build-release.mjs`, `release-notes.mjs`); `test/` contains synthetic protocol, media, admin, persistence, synchronization and mocked service tests.

## Releases

`npm run release:build` creates `dist/lda-assets-<version>.zip`, `dist/SHA256SUMS` and `dist/manifest.json`. Tagged releases are built and published by GitHub Actions; see [docs/RELEASING.md](docs/RELEASING.md) and [CHANGELOG.md](CHANGELOG.md).

## Licence

LDA Local Assets is published by Coding Koalas Pty Ltd under the **Business Source License 1.1**:

- Free for development, testing, demos and other non-production use, by anyone, including companies (agencies, in-house teams and consultants).
- Production use is not permitted.
- Each version converts to the Apache License 2.0 on its Change Date (four years after release; see [LICENSE.md](LICENSE.md)).

Legal documents: [LICENSE.md](LICENSE.md) · [LEGAL-NOTICE.md](LEGAL-NOTICE.md) · [PRIVACY.md](PRIVACY.md) · [CLEAN-ROOM.md](CLEAN-ROOM.md) · [TAKEDOWN-AND-CONTACT.md](TAKEDOWN-AND-CONTACT.md) · [CONTRIBUTING.md](CONTRIBUTING.md).

## Protocol details

The HTTP API and CMS client behaviour are described in [docs/protocol.md](docs/protocol.md).
