// W6 — what package.json tells a customer's package manager.
//
// These tests read package.json and the installed uuid, so a regression in the
// declarations fails CI instead of failing on a customer's device.

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { generateUUID } from '../src/utils';

const repoRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

describe('W6 — uuid', () => {
  test('uuid is declared at ^11.1.1 (clears the production advisory)', () => {
    expect(pkg.dependencies.uuid).toBe('^11.1.1');
    // uuid 11 ships its own types; @types/uuid would shadow nothing and only drift.
    expect(pkg.devDependencies['@types/uuid']).toBeUndefined();
  });

  test('the installed uuid is 11.x', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installed = require('uuid/package.json').version as string;
    expect(installed.split('.')[0]).toBe('11');
  });

  test('generateUUID still returns distinct RFC 4122 v4 ids', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = generateUUID();
    const b = generateUUID();
    expect(a).toMatch(v4);
    expect(b).toMatch(v4);
    expect(a).not.toBe(b);
  });
});

describe('W6 — optional Expo peers', () => {
  // src/utils-expo.ts imports these three statically (the Expo entry);
  // src/expo.ts requires expo-router lazily; app.plugin.js requires
  // expo/config-plugins, falling back to @expo/config-plugins.
  const expoPeers = [
    'expo-application',
    'expo-device',
    'expo-network',
    'expo-router',
    'expo',
    '@expo/config-plugins',
  ];

  test.each(expoPeers)('%s is an optional peer dependency', (name) => {
    expect(typeof pkg.peerDependencies[name]).toBe('string');
    expect(pkg.peerDependenciesMeta[name]).toEqual({ optional: true });
  });

  test('every peerDependenciesMeta entry has a peerDependencies entry (npm ignores it otherwise)', () => {
    const orphans = Object.keys(pkg.peerDependenciesMeta).filter(
      (name) => !(name in pkg.peerDependencies),
    );
    expect(orphans).toEqual([]);
  });

  test('every Expo module imported statically by the Expo entry is declared', () => {
    const src = readFileSync(join(repoRoot, 'src', 'utils-expo.ts'), 'utf8');
    const imported = [...src.matchAll(/^import [^;]* from '(expo-[^']+)';$/gm)].map((m) => m[1]);
    expect(imported.length).toBeGreaterThan(0);
    for (const name of imported) {
      expect(pkg.peerDependencies[name]).toBeDefined();
    }
  });
});

describe('W6 — native modules the app must list itself', () => {
  // React Native CLI autolinking links only packages in the app's own
  // package.json; Expo autolinking did the same before SDK 54. A nested
  // dependency loads its JavaScript without its native code.
  const nativeModules = [
    '@react-native-async-storage/async-storage',
    'react-native-get-random-values',
  ];

  test.each(nativeModules)('%s is a required peer, not a dependency', (name) => {
    expect(pkg.dependencies[name]).toBeUndefined();
    expect(typeof pkg.peerDependencies[name]).toBe('string');
    expect(pkg.peerDependenciesMeta?.[name]?.optional).not.toBe(true);
  });

  test.each(nativeModules)('%s stays in devDependencies for the tests and the build', (name) => {
    expect(typeof pkg.devDependencies[name]).toBe('string');
  });

  test('AsyncStorage peer range is 1.17+ or 2.x, not 3.x (3.x renames multiRemove, which the SDK calls)', () => {
    // Expo SDK 52 ships AsyncStorage 1.23.1; the SDK calls only getItem,
    // setItem, removeItem and multiRemove, which 1.x has.
    expect(pkg.peerDependencies['@react-native-async-storage/async-storage']).toBe('^1.17.0 || ^2.0.0');
  });

  test('get-random-values peer range is 1.8+ or 2.x (the unpinned README lines take 2.x)', () => {
    // 2.x needs React Native 0.81+; the SDK only imports it for its
    // crypto.getRandomValues polyfill, which 1.x and 2.x install the same way.
    expect(pkg.peerDependencies['react-native-get-random-values']).toBe('^1.8.0 || ^2.0.0');
  });

  test.each(nativeModules)('the README install lines name %s', (name) => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const installLines = readme
      .split('\n')
      .filter((line) => /^(npm install|npx expo install) @datalyr\/react-native/.test(line));
    expect(installLines.length).toBe(2);
    for (const line of installLines) {
      const packages = line.split(' ').map((word) => word.replace(/(.)@[^/]*$/, '$1'));
      expect(packages).toContain(name);
    }
  });

  test('the bare install line pins AsyncStorage to 2.x (latest is 3.x, outside the peer range)', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const bare = readme.split('\n').find((line) => line.startsWith('npm install @datalyr/react-native'));
    expect(bare?.split(' ')).toContain('@react-native-async-storage/async-storage@^2');
  });
});
