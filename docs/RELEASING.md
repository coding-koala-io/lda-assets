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
   - Leave `LICENSE.md` alone: it is the standard Apache License 2.0 text, with no version or date in it.
   - If the stored data format changed, raise `dataVersion` in `src/product.js` and add an upgrade note to the changelog.

3. Run the tests and a local release build:

   ```powershell
   npm test
   npm run release:build
   ```

   Check that `dist/lda-assets-X.Y.Z.zip`, `dist/SHA256SUMS` and `dist/manifest.json` were created. `dist/` is not committed.

   Before finishing every release (including hotfixes), regenerate screenshots from this same checkout, whose server source is packaged by the release build:

   ```powershell
   npm run screenshots
   ```

   Use a machine with an installed Chromium-family browser; `LDA_SCREENSHOT_BROWSER` may select its executable. This required release step stays separate from `release:build`, so ordinary tests and archive builds do not need a browser. A browserless machine must complete this step on a browser-equipped machine before tagging; do not skip it.

   Save the stdout before/after file list in the release review. Have someone other than the screenshot author inspect every generated PNG at its native 360 px or 720 px width: the whole page and footer must be present, text readable, and nothing clipped. Log the reviewer, the image set reviewed and pass/fail in the release review. Correct failures in the live UI and rerun the script; never retouch a capture.

   Include `docs/media/screens/*.png` and `MANIFEST.md` in the release preparation changes. If the UI changes after capture, regenerate and repeat the independent review before tagging. Never replace the README demo GIFs with a hand-made capture.

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
