#!/usr/bin/env node
// Checks that the two README install lines resolve with npm's strict peer
// rules (no --legacy-peer-deps), against today's published versions.
//
// - Bare: a throwaway app with react-native@latest, then the README's bare
//   `npm install` line, with the packed SDK in place of @datalyr/react-native.
// - Expo: a throwaway app with expo@latest and the react / react-native it
//   bundles, then the README's `npx expo install` line, each package at the
//   version expo@latest's bundledNativeModules.json names (what
//   `expo install` picks), or latest when it names none.
//
// Only a lockfile is written (--package-lock-only): nothing is downloaded
// beyond package metadata, and no React Native app is built. A peer conflict
// (ERESOLVE) makes npm exit non-zero, which fails this script.
//
// Usage: node scripts/check-install-lines.mjs
// INSTALL_CHECK_DIR sets the scratch directory (default: a new temp dir).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').split('\n');

const bareLine = readme.find((line) => line.startsWith('npm install @datalyr/react-native '));
const expoLine = readme.find((line) => line.startsWith('npx expo install @datalyr/react-native '));
if (!bareLine || !expoLine) {
  console.error('README: could not find both install lines');
  process.exit(1);
}

const base = process.env.INSTALL_CHECK_DIR
  ? resolve(process.env.INSTALL_CHECK_DIR)
  : mkdtempSync(join(tmpdir(), 'install-lines-'));
mkdirSync(base, { recursive: true });

function run(cmd, args, cwd) {
  console.log(`$ (${cwd}) ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
}

// npm either stops on a peer conflict (`npm error ERESOLVE`) or, when the
// conflicting package is named in the same command, installs it anyway with
// `npm warn ERESOLVE overriding peer dependency`. Both are a broken install
// for a customer, so both fail here.
function npmInstall(args, cwd) {
  console.log(`$ (${cwd}) npm install ${args.join(' ')}`);
  const res = spawnSync('npm', ['install', ...npmFlags, ...args], { cwd, encoding: 'utf8' });
  const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => !/npm warn deprecated/.test(l));
  console.log(lines.join('\n').trim());
  if (res.status !== 0) throw new Error(`npm install exited ${res.status}`);
  if (lines.some((l) => l.includes('ERESOLVE'))) throw new Error('npm reported ERESOLVE (peer conflict)');
}

// Every peer in the resulting lockfile must be satisfied.
function checkTree(cwd) {
  console.log(`$ (${cwd}) npm ls --all --package-lock-only`);
  const res = spawnSync('npm', ['ls', '--all', '--package-lock-only'], { cwd, encoding: 'utf8' });
  const bad = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => /invalid|ERR|missing/.test(l));
  if (res.status !== 0 || bad.length) {
    console.log(bad.join('\n'));
    throw new Error('npm ls found an invalid or missing dependency');
  }
}

const npmFlags = ['--package-lock-only', '--no-audit', '--no-fund', '--ignore-scripts'];

// Pack the SDK as a customer receives it.
const packDir = join(base, 'pack');
mkdirSync(packDir, { recursive: true });
const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], repoRoot));
const tarball = join(packDir, packed[0].filename);

// Package names after "@datalyr/react-native" in a README line, with any
// version spec the line gives ("name@^2" stays "name@^2").
function packagesOf(line, prefix) {
  return line
    .slice(prefix.length)
    .trim()
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('-'));
}
const nameOf = (spec) => spec.replace(/(.)@[^/]*$/, '$1');

function newApp(name) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true }, null, 2));
  return dir;
}

let failed = false;
function scenario(title, fn) {
  console.log(`\n=== ${title} ===`);
  try {
    fn();
    console.log(`PASS: ${title}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL: ${title} (${err.message.split('\n')[0]})`);
  }
}

scenario('bare README line on react-native@latest', () => {
  const dir = newApp('bare-app');
  npmInstall(['react-native@latest'], dir);
  const specs = packagesOf(bareLine, 'npm install');
  const args = specs.map((spec) => (spec === '@datalyr/react-native' ? tarball : spec));
  npmInstall(args, dir);
  checkTree(dir);
});

scenario('Expo README line on expo@latest (versions as expo install picks them)', () => {
  const dir = newApp('expo-app');
  const expoVersion = run('npm', ['view', 'expo@latest', 'version'], dir).trim();
  const bundled = fetchBundled(expoVersion);
  // `expo install` passes the bundled version, or the bare name when expo
  // names none (npm then takes the latest).
  const pin = (name) => (bundled[name] ? `${name}@${bundled[name]}` : name);
  npmInstall([`expo@${expoVersion}`, pin('react'), pin('react-native')], dir);
  const specs = packagesOf(expoLine, 'npx expo install');
  const args = specs.map((spec) => (spec === '@datalyr/react-native' ? tarball : pin(nameOf(spec))));
  console.log(`expo ${expoVersion} picks: ${args.filter((a) => a !== tarball).join(' ')}`);
  npmInstall(args, dir);
  checkTree(dir);
});

// expo's bundledNativeModules.json is a file in the package, not in its
// registry metadata: read that one file from a package CDN.
function fetchBundled(version) {
  const urls = [
    `https://cdn.jsdelivr.net/npm/expo@${version}/bundledNativeModules.json`,
    `https://unpkg.com/expo@${version}/bundledNativeModules.json`,
  ];
  for (const url of urls) {
    try {
      return JSON.parse(execFileSync('curl', ['-fsSL', '--retry', '2', url], { encoding: 'utf8' }));
    } catch {
      console.log(`could not read ${url}`);
    }
  }
  throw new Error(`could not read bundledNativeModules.json for expo@${version}`);
}

process.exit(failed ? 1 : 0);
