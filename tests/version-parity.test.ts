// RN-20 — the SDK version must be written in exactly one place.
//
// There used to be six independent hardcoded literals (package.json, the
// envelope's context.version, the User-Agent, properties.sdk_version on the bare
// build, the same on Expo, and a third stamp used only by app_install on each).
// They all happened to agree at 1.7.15, but nothing enforced it — and the
// identical structure on iOS drifted for four straight releases, so a single
// production request carried envelope 2.1.1, payload 2.1.3 and User-Agent 2.0.2
// at once (measured 2026-07-25).
//
// These tests make a half-bumped release a hard failure.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { SDK_VERSION, SDK_LIBRARY_NAME, SDK_USER_AGENT } from '../src/version';

const repoRoot = resolve(__dirname, '..');
const srcDir = join(repoRoot, 'src');

function tsFilesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFilesBelow(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

describe('RN-20 — single source of truth for the SDK version', () => {
  test('SDK_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });

  test('the podspec derives its version from package.json, not a literal', () => {
    // If someone replaces this with a hardcoded string, the podspec becomes a
    // seventh drift site and this test must start comparing values instead.
    const podspec = readFileSync(join(repoRoot, 'datalyr-react-native.podspec'), 'utf8');
    expect(podspec).toMatch(/s\.version\s*=\s*package\[['"]version['"]\]/);
  });

  test('SDK_VERSION is a plain semver', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the User-Agent is derived, not typed out again', () => {
    expect(SDK_USER_AGENT).toBe(`${SDK_LIBRARY_NAME}/${SDK_VERSION}`);
  });

  test('the library name is the exact string server-side platform detection keys on', () => {
    // The ingest worker's detectSource() maps this literal to
    // source: 'mobile_app'. Changing it silently reclassifies every mobile
    // event as 'api'. The Expo build ships under the same name and is
    // distinguished by sdk_variant.
    expect(SDK_LIBRARY_NAME).toBe('@datalyr/react-native');
  });

  test('no source or test file hardcodes the current version outside version.ts', () => {
    // The guard that actually prevents regression: re-adding a literal
    // anywhere fails here instead of drifting for four releases.
    //
    // tests/ is scanned too, and that is not paranoia — the first run of this
    // suite caught `expect(wire.context.version).toBe('1.7.15')` in
    // e2e-review.test.ts, whose own comment claimed it "tracks package
    // version". A literal in a test breaks on every single release, in the very
    // place meant to catch stale versions.
    const offenders: string[] = [];

    for (const file of [...tsFilesBelow(srcDir), ...tsFilesBelow(join(repoRoot, 'tests'))]) {
      if (file.endsWith(`${join('src', 'version.ts')}`)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes(SDK_VERSION)) return;
        // Comments legitimately cite version numbers when explaining history.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        offenders.push(`${file.replace(repoRoot + '/', '')}:${i + 1}: ${trimmed}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
