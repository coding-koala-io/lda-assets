// Prints the CHANGELOG.md section for one version (used as GitHub release notes). No dependencies.
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`);
  // A release must carry its date; "unreleased" or an undated heading blocks publishing.
  const heading = lines[start].trim();
  if (/unreleased/i.test(heading) || !/ - \d{4}-\d{2}-\d{2}$/.test(heading) || heading.slice(0, heading.length - 13) !== `## [${version}]`) {
    throw new Error(`CHANGELOG.md section for ${version} is not dated ("${heading}"). Change its heading to "## [${version}] - YYYY-MM-DD" before releasing.`);
  }
  const length = lines.slice(start + 1).findIndex(line => line.startsWith('## '));
  return lines.slice(start + 1, length < 0 ? undefined : start + 1 + length).join('\n').trim() + '\n';
}

// Usage: node scripts/release-notes.mjs <version> <output file>
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(import.meta.dirname, '..');
    writeFileSync(process.argv[3], releaseNotes(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), process.argv[2]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
