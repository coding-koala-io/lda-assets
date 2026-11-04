# Changelog

All notable changes to LDA Local Assets are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - unreleased

### Changed
- README: "Our senior developer reviews and tests every change." (singular).

## [1.1.0] - 2026-11-04

### Changed
- Licence changed to Apache 2.0; earlier versions stay under the Business Source License 1.1. Versions up to and including 1.0.2 keep that licence. LICENSE.md is now the standard Apache License 2.0 text, and a NOTICE file ships with every release.
- Product name is now "Local Developer Accelerator (LDA), compatible with Optimizely CMS 13" in the documents, About page and page banner.
- Legal notice: production wording now reads "Not designed or tested for production use. Provided 'as is', without warranties, under sections 7 and 8 of the Apache License 2.0. Nothing here limits rights you have under law that cannot be excluded."
- README: new top section with a 2-minute quick start through the one-line installer, what it does not do, and the licence section for Apache 2.0.

## [1.0.2] - 2026-10-16

### Fixed
- Release build on GitHub: the permission test no longer assumes a non-admin file owner. The 1.0.1 tag was never released; 1.0.2 contains all 1.0.1 fixes.

## [1.0.1] - 2026-10-16

### Fixed
- Windows service script: paths with 8.3 short names are canonicalised before comparison; Windows PowerShell 5.1 child processes no longer inherit PowerShell 7's module path.
- Re-applying permissions to an already locked folder no longer needs the audit privilege.

## [1.0.0] - 2026-10-16

### Changed
- Rebrand: the project is now **LDA Local Assets**, part of Local Developer Accelerator for Optimizely by Coding Koala (package `lda-assets`). Every page shows a development-only banner and a legal footer. The Windows service is now `LdaAssets` with the default runtime folder `C:\ProgramData\Coding Koala\Local Developer Accelerator\Assets`.
- Licence: Business Source License 1.1 (free for development and other non-production use; converts to Apache 2.0 on the Change Date) replaces PolyForm Noncommercial 1.0.0.

### Added
- About pages: `/about`, `/about/privacy`, `/about/licence` and `/about/legal`.
- `/health` reports `product`, `version` and `dataVersion` to every caller.
- Data version guard: `tenants.json` records `dataVersion`; data written by a newer version stops startup with exit code 3 instead of being overwritten.
- Loopback-only CMP API: the token, lineage and asset URL endpoints answer only this machine unless `LDA_ALLOW_REMOTE_API=true`. Asset files and the picker are unchanged.
- A loud startup warning when `HOST` is not a loopback address.
- Release packaging: `npm run release:build` creates the release zip, `SHA256SUMS` and `manifest.json`; GitHub Actions run tests and publish tagged releases.
- Legal and contribution documents: LEGAL-NOTICE.md, PRIVACY.md, CLEAN-ROOM.md, TAKEDOWN-AND-CONTACT.md and CONTRIBUTING.md.
