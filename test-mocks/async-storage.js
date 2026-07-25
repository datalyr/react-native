// In-memory AsyncStorage mock (default export).
//
// Keys are VALIDATED, deliberately. The real
// @react-native-async-storage/async-storage `checkValidInput` only console.warns
// on a non-string key and then passes it across the bridge, so an `undefined`
// key degrades to a silent no-op on device. This mock used to be a bare Map,
// which happily stored `undefined` as a key — so a storage-key typo looked like
// a WORKING feature under test.
//
// That is exactly how the 1.7.15 identify dedupe shipped broken on Expo:
// `STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT` was missing from utils-expo.ts, the
// Expo build read and wrote `undefined`, and every test still passed. Throwing
// here turns that class of bug into a red test instead of a production no-op.
const store = new Map();

const assertValidKey = (k) => {
  if (typeof k !== 'string') {
    throw new TypeError(
      `[async-storage mock] key must be a string, got ${k === undefined ? 'undefined' : typeof k}. ` +
      'This usually means a STORAGE_KEYS entry is missing from one of the two ' +
      'utils implementations (utils.ts vs utils-expo.ts).',
    );
  }
};

module.exports = {
  getItem: async (k) => { assertValidKey(k); return store.has(k) ? store.get(k) : null; },
  setItem: async (k, v) => { assertValidKey(k); store.set(k, v); },
  removeItem: async (k) => { assertValidKey(k); store.delete(k); },
  // Storage.clear() in both utils implementations calls multiRemove; the mock
  // was missing it entirely, so that path threw instead of clearing.
  multiRemove: async (keys) => { for (const k of keys) { assertValidKey(k); store.delete(k); } },
  clear: async () => { store.clear(); },
  __store: store,
};
