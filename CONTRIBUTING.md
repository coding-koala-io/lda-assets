# Contributing to LDA Local Assets

Thank you for helping. LDA Local Assets is part of Local Developer Accelerator (LDA), compatible with Optimizely CMS 13. Built by Coding Koala. Please read the legal rules below before you open a pull request. Not affiliated with or endorsed by Optimizely. Optimizely is a trade mark of its owner.

## How to run the tests
1. Install Node.js 24 or later.
2. Run `npm ci` (there are no runtime dependencies), then `npm test`.
3. Tests use synthetic data in a temporary `.test-runtime` folder. Windows service tests use mocked UAC, service manager, network and port calls; they never install a service.
4. `npm run release:build` builds the release zip in `dist/` (see docs/RELEASING.md).

## Screenshots
Run `npm run screenshots` with an installed Chrome, Edge or Chromium browser. Set `LDA_SCREENSHOT_BROWSER` to select its executable. The capture server binds to `127.0.0.1:18083`. If port `18083` is in use, the run fails.

The script seeds made-up content through the local server routes in a dedicated `.test-runtime/screenshots-demo` folder. It refuses to reuse an existing demo folder and checks the checkout path and captured page text for personal details. It uses a separate temporary browser profile and attempts to remove both the demo folder it created and its temporary browser files when the run ends.

The script stages full-page captures of the standalone tool screens, including confirmations, at 720 px and 360 px. After all captures pass its checks, it publishes them to `docs/media/screens/<page>-<width>.png`, removes obsolete PNGs from that directory and writes `MANIFEST.md`. Stdout reports added, changed, unchanged and removed images.

Run this for every release after `npm run release:build`, from the same checkout. See [release steps](docs/RELEASING.md) for the required independent visual check and log. Screenshot generation is a separate release step so `npm test` and `release:build` also work without a browser.

## Branches (git flow)
- `main` holds released versions only; each release is tagged `vX.Y.Z`.
- `develop` is the integration branch. Start work from it.
- `feature/<name>` for new work, merged back into `develop` by pull request.
- `release/X.Y.Z` prepares a release; `hotfix/X.Y.Z` fixes a released version. Both finish into `main` and `develop`.
- CI runs `npm test` on Windows for pushes to these branches and for every pull request.

## Legal rules for contributions
By opening a pull request you confirm all of the following.

### You must NOT submit
1. **Vendor code**: any source code, decompiled or disassembled code, IL, binaries, assemblies, NuGet packages or minified scripts from Optimizely or any other vendor, or code written by looking at such material.
2. **Captured traffic or data**: HTTP recordings, HAR files, logs, database dumps or screenshots from real sites, real Optimizely accounts, employers or clients, or anything containing personal information, credentials, keys, tokens or customer content. Tests must use synthetic data.
3. **Vendor text and design**: copied documentation, error-message text longer than a short protocol identifier, user-interface markup or styles, icons or images.
4. **Trademarks**: logos or brand assets of Optimizely or anyone else, or new names that put another company's mark first.
5. **Confidential information**: anything you received under an NDA, partner portal, early-access programme, employment or client agreement.
6. Anything that would make this project work in production or as a hosted service, or that gets around licence checks.

### Describing how you know a behaviour
In the pull request, say briefly where the behaviour comes from (for example "public docs URL", or "observed from my own local CMS 13 site using my own licence"). If it came from analysing vendor binaries, **do not submit code**. Open an issue describing the behaviour in your own words and a maintainer will handle it under the clean-room process (see CLEAN-ROOM.md).

### Developer Certificate of Origin
Every commit must be signed off (`git commit -s`), certifying the Developer Certificate of Origin 1.1 (https://developercertificate.org/): your contribution is original or you have the rights needed to submit it.

### Licence of contributions
Copyright 2026 Coding Koalas Pty Ltd (ACN 668 775 433).

Contributions are licensed to you and us under the same licence as this repository (Apache License 2.0). By contributing you also grant us a perpetual, worldwide, royalty-free licence to use, modify and relicense your contribution, including under other licence terms.

Maintainers may remove any contribution at any time if they believe it breaks these rules.

Questions: legal@codingkoala.io.
