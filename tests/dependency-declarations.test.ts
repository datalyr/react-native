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
