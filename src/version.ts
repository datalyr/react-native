/**
 * The one place the SDK version is written in TypeScript.
 *
 * RN-20. There used to be six independent hardcoded literals: `package.json`,
 * the transport envelope's `context.version`, the `User-Agent` header,
 * `properties.sdk_version` in the bare build, the same in the Expo build, and a
 * *third* `sdk_version` stamped only on `app_install` (×2, one per build). All
 * happened to agree at 1.7.15 — but nothing enforced that, and the identical
 * structure on iOS drifted badly: a single production request there carried
 * envelope `2.1.1`, payload `2.1.3` and User-Agent `2.0.2` at the same time,
 * because `context.version` sat frozen across four releases.
 *
 * Why a literal rather than `import pkg from '../package.json'`:
 * `tsconfig.json` sets `rootDir: "src"`, so importing above it breaks the
 * declaration build (TS6059), and Metro/Hermes cannot be relied on to bundle
 * `package.json` at runtime. Instead the literal is checked against
 * `package.json` and the podspec by `tests/version-parity.test.ts`, which fails
 * the build on any mismatch.
 *
 * **When releasing, change TWO things:** this constant and `package.json`.
 * The podspec is NOT one of them — `datalyr-react-native.podspec:7` reads
 * `s.version = package['version']`, and `tests/version-parity.test.ts` asserts
 * it stays derived. Hardcoding a version there would make it a third drift site
 * and fail that test.
 */
export const SDK_VERSION = '1.7.17';

/**
 * Library identifier sent as `context.library`. Server-side platform detection
 * keys on this exact string (`detectSource` in the ingest worker maps
 * `@datalyr/react-native` → `source: 'mobile_app'`), so it must not change
 * without a coordinated server change. Note the Expo build ships under this
 * same name and is distinguished by `sdk_variant: 'expo'` in the payload.
 */
export const SDK_LIBRARY_NAME = '@datalyr/react-native';

/** `User-Agent` header value, e.g. `@datalyr/react-native/1.7.16`. */
export const SDK_USER_AGENT = `${SDK_LIBRARY_NAME}/${SDK_VERSION}`;
