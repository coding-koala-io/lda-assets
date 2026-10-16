# Releasing LDA Local Assets

Releases use git flow. `main` holds released versions, `develop` is the integration branch, and each release is tagged `vX.Y.Z`. Pushing the tag runs `.github/workflows/release.yml`, which tests, builds and publishes the GitHub release.

## Steps
1. Start the release from `develop`:

   ```powershell
   git flow release start X.Y.Z
   ```

2. Prepare the release on the `release/X.Y.Z` branch:
   - Set `"version": "X.Y.Z"` in `package.json` and `package-lock.json`.
   - In `CHANGELOG.md`, rename `## [X.Y.Z] - unreleased` to `## [X.Y.Z] - YYYY-MM-DD` (today's date).
   - In `LICENSE.md`, set `Licensed Work` to `LDA Local Assets X.Y.Z` and `Change Date` to 4 years after the release date (for example a release on 2026-10-16 has Change Date 2030-10-16).
   - If the stored data format changed, raise `dataVersion` in `src/product.js` and add an upgrade note to the changelog.

3. Run the tests and a local release build:

   ```powershell
   npm test
   npm run release:build
   ```

   Check that `dist/lda-assets-X.Y.Z.zip`, `dist/SHA256SUMS` and `dist/manifest.json` were created. `dist/` is not committed.

4. Finish the release (merges into `main` and `develop` and creates the tag `vX.Y.Z`):

   ```powershell
   git flow release finish X.Y.Z
   ```

5. Push branches and tags:

   ```powershell
   git push origin main develop --tags
   ```

The release workflow fails if the tag does not equal `v` + the `package.json` version. It attaches the zip, `SHA256SUMS` and `manifest.json` to the GitHub release, with the matching `CHANGELOG.md` section as release notes. Release notes fail (exit 1) while that section is still headed `unreleased` or has no `YYYY-MM-DD` date. The manifest records the source commit: `LDA_RELEASE_COMMIT` when set (the release workflow passes the tagged commit), otherwise `git rev-parse HEAD`, otherwise null.

## Hotfixes
Use `git flow hotfix start X.Y.Z` from `main`, make the fix, follow steps 2–3, then `git flow hotfix finish X.Y.Z` and push as in step 5.
