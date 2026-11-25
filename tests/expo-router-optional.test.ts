// The Expo entry must bundle in an app without expo-router.
//
// Metro resolves every literal require() when it bundles, wherever the call
// is, and treats one as optional only inside a try block
// (allowOptionalDependencies, on in Metro's, React Native's and Expo's default
// config). Metro reads src/expo.ts (the "react-native" export condition), and
// lib/expo.js is the tsc build of it.

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import * as ts from 'typescript';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test', getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });
jest.mock('expo-device', () => ({
  modelName: 'Test Device', deviceName: 'Test Device', manufacturer: 'Test',
  osVersion: '17.0', isDevice: true,
}), { virtual: true });
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
}), { virtual: true });
// An app without expo-router: requiring it throws, as Metro's optional
// dependency stub does.
jest.mock('expo-router', () => {
  throw new Error("Cannot find module 'expo-router'");
}, { virtual: true });

const repoRoot = resolve(__dirname, '..');

// Each require('expo-router') call in the file, and whether it sits inside the
// try block of a try statement.
function expoRouterRequires(file: string): boolean[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: boolean[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'expo-router'
    ) {
      let inTry = false;
      for (let child: ts.Node = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (ts.isTryStatement(parent) && parent.tryBlock === child) {
          inTry = true;
          break;
        }
        if (ts.isFunctionLike(parent)) {
          // A try outside the enclosing function does not guard the call.
          if (ts.isTryStatement(parent.parent) && parent.parent.tryBlock === parent) inTry = true;
          break;
        }
      }
      found.push(inTry);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('expo-router is optional for the Expo entry', () => {
  test('every require of expo-router in src/expo.ts is inside a try block', () => {
    const found = expoRouterRequires(join(repoRoot, 'src', 'expo.ts'));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(Boolean)).toBe(true);
  });

  const built = join(repoRoot, 'lib', 'expo.js');
  (existsSync(built) ? test : test.skip)('the same holds in the built lib/expo.js', () => {
    const found = expoRouterRequires(built);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(Boolean)).toBe(true);
  });

  test('without expo-router the entry loads, and only the hook fails, with a clear message', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require('../src/expo');
    expect(typeof expo.useDatalyrScreenTracking).toBe('function');
    expect(() => expo.useDatalyrScreenTracking()).toThrow(/needs expo-router/);
  });
});
