// KNOWN_EXTERNAL_NAMESPACES must equal the server's list in
// datalyr-v2/infra/cloudflare/lib/person-contract.js. If this test fails because the
// server added a namespace, update src/provider-namespaces.ts AND this list together.

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test',
  getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });

jest.mock('expo-device', () => ({
  modelName: 'Test Device',
  deviceName: 'Test Device',
  manufacturer: 'Test',
  osVersion: '17.0',
  isDevice: true,
}), { virtual: true });

import * as fs from 'fs';
import * as path from 'path';
import { KNOWN_EXTERNAL_NAMESPACES } from '../src/provider-namespaces';

const SERVER_NAMESPACES = [
  'revenuecat', 'superwall', 'stripe', 'shopify', 'whop', 'checkoutchamp',
  'clickfunnels', 'firebase', 'klaviyo', 'iclosed', 'commas', 'hubspot', 'calendly',
];

test('the namespace list equals the server list (13)', () => {
  expect([...KNOWN_EXTERNAL_NAMESPACES].sort()).toEqual([...SERVER_NAMESPACES].sort());
  expect(KNOWN_EXTERNAL_NAMESPACES).toHaveLength(13);
});

test('both entry points use the shared constant, not their own copy', () => {
  for (const file of ['datalyr-sdk.ts', 'datalyr-sdk-expo.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    expect(source).toContain("import { KNOWN_EXTERNAL_NAMESPACES } from './provider-namespaces';");
    expect(source).not.toMatch(/const KNOWN_EXTERNAL_NAMESPACES/);
  }
});

test.each([
  ['bare React Native', '../src/datalyr-sdk', 'DatalyrSDK'],
  ['Expo', '../src/datalyr-sdk-expo', 'DatalyrSDKExpo'],
])('%s: no unknown-namespace warning for the new namespaces', async (_name, modulePath, className) => {
  const SDK = require(modulePath)[className];
  const sdk = new SDK();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(sdk, 'track').mockResolvedValue(undefined);
  try {
    for (const ns of ['iclosed', 'commas', 'hubspot', 'calendly']) {
      await sdk.bindProviderIdentity(ns, 'id_1');
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('unknown provider namespace'))).toHaveLength(0);
  } finally {
    jest.restoreAllMocks();
  }
});
