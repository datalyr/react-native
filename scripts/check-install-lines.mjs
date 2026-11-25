#!/usr/bin/env node
// Checks that the README install steps resolve with npm's strict peer rules
// (no --legacy-peer-deps), against today's published versions, in throwaway
// lockfile-only apps. The packed SDK stands in for @datalyr/react-native.
//
// - Bare: an app with the react-native (and react) that an Expo SDK bundles;
//   then that Expo SDK's `expo` package, which is what
//   `npx install-expo-modules` adds for that React Native; then the README's
//   bare `npx expo install` line, each package at the version that expo's
//   bundledNativeModules.json names (what `expo install` picks), or latest
//   when it names none. Run for the newest Expo SDK, SDK 54 (React Native
//   0.81) and SDK 52 (React Native 0.76, the oldest the SDK supports).
// - Expo: an app with that Expo SDK's expo, react and react-native, then the
//   README's Expo line the same way. Newest SDK and SDK 52.
// - The README's react-native-get-random-values@^1 advice, on Expo SDK 54.
//
// Each case fails on ERESOLVE (error or "overriding peer dependency"), on an
// invalid or missing package in `npm ls`, or on a second copy of
// expo-modules-core (an app copy that does not match its Expo SDK; pod
// install then fails). It logs the resolved versions.
//
// Not covered (needs a real app build): what install-expo-modules writes into
// the native projects, CocoaPods resolution in `pod install`, Gradle, and
// autolinking. Only a lockfile is written: nothing beyond package metadata is
// downloaded and no app is built.
//
// Usage: node scripts/check-install-lines.mjs
// INSTALL_CHECK_DIR sets the scratch directory (default: a new temp dir).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8').split('\n');

const INSTALL = 'npx expo install';
const bareStart = readme.indexOf('**Bare React Native:**');
const expoStart = readme.indexOf('**Expo:**');
if (bareStart < 0 || expoStart < bareStart) {
  console.error('README: could not find the Bare React Native and Expo sections');
  process.exit(1);
}
const bareSection = readme.slice(bareStart, expoStart);
const expoSection = readme.slice(expoStart);
const isInstallLine = (line) => line.startsWith(`${INSTALL} @datalyr/react-native `);
const bareLine = bareSection.find(isInstallLine);
const expoLine = expoSection.find(isInstallLine);
const addExpoAt = bareSection.findIndex((line) => line.startsWith('npx install-expo-modules'));
if (!bareLine || !expoLine) {
  console.error(`README: could not find a "${INSTALL} @datalyr/react-native" line in both sections`);
  process.exit(1);
}
if (addExpoAt < 0 || addExpoAt > bareSection.indexOf(bareLine)) {
  console.error('README: the bare steps must run npx install-expo-modules before npx expo install');
  process.exit(1);
}
const pinOne = readme.join('\n').match(/`(react-native-get-random-values@\^1)`/);
if (!pinOne) {
  console.error('README: could not find the react-native-get-random-values@^1 advice');
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

const npmFlags = ['--package-lock-only', '--no-audit', '--no-fund', '--ignore-scripts'];

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

// Every dependency in the resulting lockfile must be valid, and there must be
// one expo-modules-core, the one the Expo SDK uses.
function checkTree(cwd) {
  console.log(`$ (${cwd}) npm ls --all --package-lock-only`);
  const res = spawnSync('npm', ['ls', '--all', '--package-lock-only'], { cwd, encoding: 'utf8' });
  const bad = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => /invalid|ERR|missing/.test(l));
  if (res.status !== 0 || bad.length) {
    console.log(bad.join('\n'));
    throw new Error('npm ls found an invalid or missing dependency');
  }
  const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
  const copies = Object.entries(lock.packages)
    .filter(([path]) => path.endsWith('node_modules/expo-modules-core'))
    .map(([path, meta]) => `${path}@${meta.version}`);
  if (copies.length !== 1) {
    console.log(copies.join('\n'));
    throw new Error(`expected one expo-modules-core, found ${copies.length}`);
  }
}

// The versions the lockfile resolved, so the log shows what was checked.
function logResolved(dir) {
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const names = [
    'react-native',
    'expo',
    'expo-modules-core',
    '@react-native-async-storage/async-storage',
    'react-native-get-random-values',
  ];
  const found = names
    .map((name) => [name, lock.packages[`node_modules/${name}`]?.version])
    .filter(([, version]) => version)
    .map(([name, version]) => `${name}@${version}`);
  console.log(`RESOLVED: ${found.join(' ')}`);
}

// Pack the SDK as a customer receives it.
const packDir = join(base, 'pack');
mkdirSync(packDir, { recursive: true });
const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], repoRoot));
const tarball = join(packDir, packed[0].filename);

const packagesOf = (line) => line.slice(INSTALL.length).trim().split(/\s+/).filter((w) => w && !w.startsWith('-'));
const nameOf = (spec) => spec.replace(/(.)@[^/]*$/, '$1');

function newApp(name) {
  const dir = join(base, name.replace(/[^\w.-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0', private: true }, null, 2));
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

function expoSdk(range, dir) {
  const versions = JSON.parse(run('npm', ['view', `expo@${range}`, 'version', '--json'], dir));
  const version = Array.isArray(versions) ? versions[versions.length - 1] : versions;
  const bundled = fetchBundled(version);
  // `expo install` passes the bundled version, or the bare name when expo
  // names none (npm then takes the latest).
  const pin = (name) => (bundled[name] ? `${name}@${bundled[name]}` : name);
  return { version, pin };
}

function installLine(line, dir, pin, replace = {}) {
  const args = packagesOf(line).map((spec) =>
    spec === '@datalyr/react-native' ? tarball : (replace[nameOf(spec)] ?? pin(nameOf(spec))),
  );
  console.log(`expo install picks: ${args.filter((a) => a !== tarball).join(' ')}`);
  npmInstall(args, dir);
  checkTree(dir);
  logResolved(dir);
}

function bareScenario(range) {
  scenario(`bare README steps on the React Native of expo@${range}`, () => {
    const dir = newApp(`bare-${range}`);
    const { version, pin } = expoSdk(range, dir);
    // The bare app as the customer has it.
    npmInstall([pin('react-native'), pin('react')], dir);
    // npx install-expo-modules: adds the expo package for that React Native.
    npmInstall([`expo@${version}`], dir);
    installLine(bareLine, dir, pin);
  });
}

function expoScenario(range, replace = {}, label = '') {
  scenario(`Expo README line on expo@${range}${label}`, () => {
    const dir = newApp(`expo-${range}${label}`);
    const { version, pin } = expoSdk(range, dir);
    npmInstall([`expo@${version}`, pin('react'), pin('react-native')], dir);
    installLine(expoLine, dir, pin, replace);
  });
}

bareScenario('latest');
bareScenario('^54.0.0');
bareScenario('^52.0.0');
expoScenario('latest');
expoScenario('^52.0.0');
// The README's advice for the New Architecture off (React Native 0.81 can
// still turn it off): the Expo line with react-native-get-random-values@^1.
expoScenario('^54.0.0', { 'react-native-get-random-values': pinOne[1] }, ` with ${pinOne[1]}`);

process.exit(failed ? 1 : 0);
