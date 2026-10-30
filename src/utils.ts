import { Platform, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Conditional import for react-native-device-info
let DeviceInfo: any = null;
try {
  DeviceInfo = require('react-native-device-info');
} catch (error) {
  console.warn('react-native-device-info not available, using fallback device info');
}
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Required for uuid

import { DeviceInfo as DeviceInfoType, DeviceContext } from './types';

// Storage Keys
export const STORAGE_KEYS = {
  VISITOR_ID: '@datalyr/visitor_id',
  ANONYMOUS_ID: '@datalyr/anonymous_id',  // Persistent anonymous identifier
  SESSION_ID: '@datalyr/session_id',
  USER_ID: '@datalyr/user_id',
  USER_PROPERTIES: '@datalyr/user_properties',
  // 'true' while the persisted USER_ID is a provisional (pre-login) id. Byte-identical
  // in utils.ts and utils-expo.ts (both builds share one AsyncStorage namespace).
  USER_ID_PROVISIONAL: '@datalyr/user_id_provisional',
  EVENT_QUEUE: '@datalyr/event_queue',
  DEAD_LETTER_QUEUE: '@datalyr/dead_letter_queue',  // capped store for events that exhausted retries (vs silent drop)
  ATTRIBUTION_DATA: '@datalyr/attribution_data',
  LAST_SESSION_TIME: '@datalyr/last_session_time',
  // Hash of the last identify() that actually emitted (the stored key string keeps
  // its original name so existing installs keep their dedup state), so a host app
  // calling identify() on every launch/screen does not re-emit unchanged
  // identity. Cleared by reset(). See identifyUser().
  LAST_IDENTITY_HASH: '@datalyr/last_identity_fingerprint',
  // Deferred web→app IP-lookup state, per install: whether the server has given a
  // definitive answer, and how many requests have been issued. `first_launch_time`
  // cannot serve as that state — it records that a launch was OBSERVED, not that the
  // lookup was ANSWERED. See AttributionManager.shouldAttemptDeferredLookup().
  DEFERRED_LOOKUP_RESOLVED: '@datalyr/deferred_lookup_resolved',
  DEFERRED_LOOKUP_ATTEMPTS: '@datalyr/deferred_lookup_attempts',
  // Set when the server declined the lookup for ATT while the native module was missing
  // (no ATT status to send); lookups are skipped until the module reports a status.
  DEFERRED_LOOKUP_NEEDS_ATT_STATUS: '@datalyr/deferred_lookup_needs_att_status',
};

// Constants
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

/**
 * Generate a UUID v4
 */
export const generateUUID = (): string => {
  return uuidv4();
};

/**
 * Derive an ISO-3166-1 alpha-2 country code from a BCP-47 locale tag.
 *
 * Server webhooks (Superwall/RevenueCat) have NULL geo on their own row — only
 * the matched web visitor's lander pageview carries geo via the bridge. For
 * users who land directly in-app (no web prelander), there's no bridge to
 * inherit from. Device locale ('en-US', 'pt_BR') is the only zero-config
 * country signal the SDK can stamp; meta.js USER_DATA_PATHS.country picks up
 * top-level `country` as its first match key, so this hash slots into CAPI's
 * `country` user_data field without further changes.
 *
 * Returns null when the locale doesn't carry a region (e.g. 'en' alone), so
 * the caller can decide whether to omit or fall back.
 */
export const deriveCountryFromLocale = (locale: string | undefined | null): string | null => {
  if (!locale) return null;
  // BCP-47 uses '-', POSIX uses '_'; some platforms return either. A script subtag may
  // sit before the region (e.g. zh-Hant-TW), so scan ALL post-language segments for the
  // first ISO-3166-1 alpha-2 region, not just [1]. Reject script tags ('Latn'/'Hant'),
  // UN M.49 numerics ('001'), and malformed input.
  for (const seg of locale.split(/[-_]/).slice(1)) {
    const upper = seg.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper)) return upper;
  }
  return null;
};

/**
 * Dependency-free query-string parser.
 *
 * React Native core (Hermes) ships THROWING stubs for `URL.searchParams` /
 * `URLSearchParams.get/forEach` on bare RN (>=0.72), and its URLSearchParams
 * constructor ignores string input — so `new URL(url).searchParams` and
 * `new URLSearchParams(str)` silently drop EVERY deep-link / Play-referrer
 * attribution parameter (lyr, fbclid, gclid, ttclid, utm_*, gbraid, wbraid).
 * This parser avoids WHATWG URL entirely: it splits on '?'/'#', then '&'/'=',
 * and decodeURIComponent's each component individually (so encoded '&'/'=' in a
 * value survive, and one malformed '%' only loses that single value, not all).
 *
 * Pass a full URL (everything before the first '?'/'#' is ignored) or a bare
 * query string ("a=1&b=2"). Keys are lower-cased; later duplicates win.
 */
export const parseQueryString = (input: string | undefined | null): Record<string, string> => {
  const params: Record<string, string> = {};
  if (!input) return params;

  // Collect the query (after '?') and the fragment (after '#') — some platforms
  // pass attribution params in the hash. A bare "a=1&b=2" has neither delimiter,
  // so fall back to treating the whole string as the query.
  const segments: string[] = [];
  const qIndex = input.indexOf('?');
  const hIndex = input.indexOf('#');
  if (qIndex === -1 && hIndex === -1) {
    segments.push(input);
  } else {
    if (qIndex !== -1) {
      const end = hIndex !== -1 && hIndex > qIndex ? hIndex : input.length;
      segments.push(input.substring(qIndex + 1, end));
    }
    if (hIndex !== -1) {
      segments.push(input.substring(hIndex + 1));
    }
  }

  for (const segment of segments) {
    if (!segment) continue;
    for (const pair of segment.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.substring(0, eq);
      const rawValue = eq === -1 ? '' : pair.substring(eq + 1);
      if (!rawKey) continue;
      let key: string;
      let value: string;
      try {
        // '+' is a legacy space encoding in query strings.
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        key = rawKey;
      }
      try {
        value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      } catch {
        // A stray '%' only corrupts THIS value; keep the raw form rather than
        // dropping the whole parse.
        value = rawValue;
      }
      params[key.toLowerCase()] = value;
    }
  }

  return params;
};

/**
 * Generate a session ID with timestamp
 */
export const generateSessionId = (): string => {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Hash a string to a short non-cryptographic digest
 */
export const hashString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
};

/**
 * Get or create a persistent visitor ID
 */
export const getOrCreateVisitorId = async (): Promise<string> => {
  try {
    let visitorId = await AsyncStorage.getItem(STORAGE_KEYS.VISITOR_ID);
    if (!visitorId) {
      visitorId = generateUUID();
      await AsyncStorage.setItem(STORAGE_KEYS.VISITOR_ID, visitorId);
    }
    return visitorId;
  } catch (error) {
    console.warn('Failed to get/create visitor ID:', error);
    return generateUUID(); // Fallback to memory-only ID
  }
};

/**
 * Get or create a persistent anonymous ID
 * This ID persists across app reinstalls and never changes
 */
export const getOrCreateAnonymousId = async (): Promise<string> => {
  try {
    let anonymousId = await AsyncStorage.getItem(STORAGE_KEYS.ANONYMOUS_ID);
    if (!anonymousId) {
      // Generate anonymous_id with anon_ prefix to match web SDK
      anonymousId = `anon_${generateUUID()}`;
      await AsyncStorage.setItem(STORAGE_KEYS.ANONYMOUS_ID, anonymousId);
    }
    return anonymousId;
  } catch (error) {
    console.warn('Failed to get/create anonymous ID:', error);
    return `anon_${generateUUID()}`; // Fallback to memory-only ID
  }
};

/**
 * Rotate the persistent anonymous ID — generate a fresh `anon_...` and persist it.
 *
 * Used by reset() (logout) so the next user does NOT share the previous user's
 * anonymousId. Without rotation, reset()+identify(userB) links the SAME anon_xxx to
 * BOTH users in visitor_user_links, and the Meta CAPI identity bridge then resolves
 * across both — leaking click-ids/PII between users. (RN analog of the web SDK's
 * privacy rotation and Node's NODE-6 fix.) Returns the new id (memory-only on failure).
 */
export const rotateAnonymousId = async (): Promise<string> => {
  const anonymousId = `anon_${generateUUID()}`;
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ANONYMOUS_ID, anonymousId);
  } catch (error) {
    console.warn('Failed to rotate anonymous ID:', error);
  }
  return anonymousId;
};

/**
 * Rotate the persistent visitor ID — generate a fresh UUID and persist it (9.C.1).
 *
 * Used by reset() (logout): visitorId rides every event payload and is what the
 * attribution read-path resolves through, so keeping it across logout→login stitches the
 * next user's events to the previous user's device history/attribution. (iOS reset()
 * regenerates visitorId alongside anonymousId.) Stored as a RAW string — must match
 * getOrCreateVisitorId's non-JSON AsyncStorage encoding. Returns the new id
 * (memory-only on storage failure).
 */
export const rotateVisitorId = async (): Promise<string> => {
  const visitorId = generateUUID();
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.VISITOR_ID, visitorId);
  } catch (error) {
    console.warn('Failed to rotate visitor ID:', error);
  }
  return visitorId;
};

/**
 * Force a brand-new session — clear the stored session id + last-activity time so the
 * next getOrCreateSessionId() creates (not resumes) one. reset() needs this because the
 * plain getOrCreateSessionId() resumes any session <30min old (always true at logout),
 * so post-logout events would otherwise share the previous user's session id.
 */
export const clearSession = async (): Promise<void> => {
  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.SESSION_ID),
      AsyncStorage.removeItem(STORAGE_KEYS.LAST_SESSION_TIME),
    ]);
  } catch (error) {
    console.warn('Failed to clear session:', error);
  }
};

/**
 * Get or create a session ID (with session timeout logic)
 */
export const getOrCreateSessionId = async (): Promise<string> => {
  try {
    const lastSessionTime = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SESSION_TIME);
    const currentTime = Date.now();
    
    // Check if session has expired
    if (lastSessionTime) {
      const timeDiff = currentTime - parseInt(lastSessionTime, 10);
      if (timeDiff < SESSION_TIMEOUT) {
        // Session is still valid, get existing session ID
        const existingSessionId = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_ID);
        if (existingSessionId) {
          // Update last session time
          await AsyncStorage.setItem(STORAGE_KEYS.LAST_SESSION_TIME, currentTime.toString());
          return existingSessionId;
        }
      }
    }
    
    // Create new session
    const sessionId = generateSessionId();
    await AsyncStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_SESSION_TIME, currentTime.toString());
    return sessionId;
  } catch (error) {
    console.warn('Failed to get/create session ID:', error);
    return generateSessionId(); // Fallback to memory-only ID
  }
};

// TR-08: in-memory throttle so track() refreshes the session-activity time at most once per 60s
// (avoids an AsyncStorage write per event while keeping the idle-timeout window honest).
let lastSessionTouchAt = 0;

/**
 * Refresh LAST_SESSION_TIME on real event activity. getOrCreateSessionId (init / foreground /
 * reset) was the ONLY writer, so >30 min of continuous foreground use with no foreground event
 * left the stored activity time stale → the next background→foreground wrongly rotated the
 * session id mid-use while auto-events resumed the old session, so events carried a session id
 * that never got a session_start and session_end fired with the old id. Throttled to one write
 * per 60s; best-effort (a missed write only risks an early rotation, never a crash).
 */
export const touchSession = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastSessionTouchAt < 60_000) return;
  lastSessionTouchAt = now;
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_SESSION_TIME, now.toString());
  } catch {
    /* best-effort */
  }
};

// Cached device info to avoid repeated async calls
let cachedDeviceInfo: DeviceInfoType | null = null;
let deviceInfoPromise: Promise<DeviceInfoType> | null = null;

/**
 * Best-effort real runtime locale. Used by the device-info fallbacks instead of a
 * hardcoded 'en-US' — that fabricated country='US' on EVERY event for degraded installs
 * (Expo Go via the plain-RN entry, missing peer dep, or any DeviceInfo getter throw),
 * overriding accurate Cloudflare geo for Meta CAPI matching. Returns undefined if the
 * runtime can't resolve one (so country is omitted, not fabricated).
 */
const getRuntimeLocale = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Android SDK API level -> the marketing version a user agent reports.
 *
 * `Platform.Version` on Android is the API LEVEL (34), not the marketing version
 * (14) — and the device-info fallbacks below have no other source for it. The
 * deferred-lookup device signal is compared server-side against a version parsed
 * out of the CLICK's user agent, which is always the marketing form, so sending
 * "34" guarantees disagreement: neither the exact nor the major-version
 * comparison can ever match, and the strongest single corroborating signal
 * (+2) is dead for every app on this path.
 *
 * Unknown levels return undefined so the field is omitted rather than sent
 * wrong — an absent signal costs nothing, a mismatched one costs the match.
 */
const ANDROID_API_TO_RELEASE: Record<number, string> = {
  21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1',
  28: '9', 29: '10', 30: '11', 31: '12', 32: '12', 33: '13', 34: '14', 35: '15',
  36: '16',
};

/**
 * The OS version to send as a device signal, in the marketing form the
 * click side reports. Returns undefined when it cannot be determined.
 */
export const deviceOsVersion = (osVersion: string | undefined): string | undefined => {
  if (!osVersion) return undefined;
  if (Platform.OS !== 'android') return osVersion;
  // A bare integer on Android is an API level (react-native-device-info's
  // getSystemVersion already returns the marketing form, e.g. "14", which is
  // also a bare integer — but every marketing version in use is <= 20 while
  // every supported API level is >= 21, so the ranges do not overlap).
  const n = Number(osVersion);
  if (Number.isInteger(n) && n >= 21) return ANDROID_API_TO_RELEASE[n];
  return osVersion;
};

/** Placeholder device models the fallbacks emit; never a real hardware model. */
const PLACEHOLDER_MODELS = new Set(['android', 'unknown', 'iphone', 'ipad', 'test device']);

/**
 * The device model to send as a device signal. The device-info fallbacks
 * emit literals like 'Android' / 'Unknown' when the real model is unavailable;
 * those can never match a click-side model ("SM-S918B") and would only ever be
 * noise in the corroboration score.
 */
export const deviceModelName = (model: string | undefined): string | undefined => {
  if (!model) return undefined;
  return PLACEHOLDER_MODELS.has(model.trim().toLowerCase()) ? undefined : model;
};

/**
 * The device-context id: a random UUID generated on first use and persisted in
 * AsyncStorage, so it is stable across launches and resets on reinstall (the app
 * sandbox, and with it AsyncStorage, is removed on uninstall).
 *
 * It used to be react-native-device-info's getUniqueId() whenever that module was
 * installed. On iOS that is the IDFV kept in the Keychain, which survives a reinstall;
 * on Android it is ANDROID_ID. The Expo build already used a stored UUID. The storage
 * key is the one the no-device-info fallback already used, so installs that were on
 * that path keep their id. Ingest stores this id as fingerprint_hash only; no SDK or
 * server identity (visitor_id / anonymous_id) is derived from it.
 */
const DEVICE_ID_KEY = '@datalyr/fallback_device_id';
export const getOrCreateDeviceId = async (): Promise<string> => {
  try {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateUUID();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return generateUUID();
  }
};

/**
 * Collect comprehensive device information (cached after first call)
 * Device info is cached because it rarely changes during app session
 */
export const getDeviceInfo = async (): Promise<DeviceInfoType> => {
  // Return cached info if available
  if (cachedDeviceInfo) {
    return cachedDeviceInfo;
  }

  // If a fetch is already in progress, wait for it (prevents concurrent fetches)
  if (deviceInfoPromise) {
    return deviceInfoPromise;
  }

  // Start fetching and cache the promise
  deviceInfoPromise = fetchDeviceInfoInternal();

  try {
    cachedDeviceInfo = await deviceInfoPromise;
    return cachedDeviceInfo;
  } finally {
    deviceInfoPromise = null;
  }
};

/**
 * Clear the cached device info (useful for testing or after app update)
 */
export const clearDeviceInfoCache = (): void => {
  cachedDeviceInfo = null;
  deviceInfoPromise = null;
};

/**
 * Internal function to fetch device info
 */
const fetchDeviceInfoInternal = async (): Promise<DeviceInfoType> => {
  const { width, height } = Dimensions.get('window');

  // If DeviceInfo is not available (like in Expo Go), use fallback
  if (!DeviceInfo) {
    return {
      deviceId: await getOrCreateDeviceId(),
      model: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Google',
      osVersion: Platform.Version.toString(),
      appVersion: '1.0.0',
      buildNumber: '1',
      bundleId: 'expo.app',
      screenWidth: width,
      screenHeight: height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      // Real runtime locale (was hardcoded 'en-US', fabricating country='US' for everyone).
      locale: getRuntimeLocale(),
      isEmulator: false,
    };
  }

  try {
    const [
      model,
      manufacturer,
      osVersion,
      appVersion,
      buildNumber,
      bundleId,
      timezone,
      locale,
      carrier,
      isEmulator,
    ] = await Promise.all([
      DeviceInfo.getModel(),
      DeviceInfo.getManufacturer(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.getVersion(),
      DeviceInfo.getBuildNumber(),
      DeviceInfo.getBundleId(),
      DeviceInfo.getTimezone(),
      DeviceInfo.getDeviceLocale(),
      DeviceInfo.getCarrier().catch(() => undefined),
      DeviceInfo.isEmulator(),
    ]);

    return {
      deviceId: await getOrCreateDeviceId(),
      model,
      manufacturer,
      osVersion,
      appVersion,
      buildNumber,
      bundleId,
      screenWidth: width,
      screenHeight: height,
      timezone,
      locale,
      carrier,
      isEmulator,
    };
  } catch (error) {
    console.warn('Failed to collect device info:', error);

    // Fallback device info
    return {
      deviceId: await getOrCreateDeviceId(),
      model: 'Unknown',
      manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Android',
      osVersion: Platform.Version.toString(),
      appVersion: '1.0.0',
      buildNumber: '1',
      bundleId: 'unknown',
      screenWidth: width,
      screenHeight: height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      // Real runtime locale (was hardcoded 'en-US', fabricating country='US' for everyone).
      locale: getRuntimeLocale(),
      isEmulator: false,
    };
  }
};

/**
 * Create device context for attribution
 */
export const createDeviceContext = async (): Promise<DeviceContext> => {
  const deviceInfo = await getDeviceInfo();
  
  return {
    deviceId: deviceInfo.deviceId,
    deviceInfo: {
      model: deviceInfo.model,
      manufacturer: deviceInfo.manufacturer,
      osVersion: deviceInfo.osVersion,
      screenSize: `${deviceInfo.screenWidth}x${deviceInfo.screenHeight}`,
      timezone: deviceInfo.timezone,
      locale: deviceInfo.locale,
      carrier: deviceInfo.carrier,
      isEmulator: deviceInfo.isEmulator,
    },
  }
};

// Import network status manager for network type detection
let networkStatusManagerRef: any = null;

// Lazy load to avoid circular dependencies
const getNetworkStatusManager = () => {
  if (!networkStatusManagerRef) {
    try {
      networkStatusManagerRef = require('./network-status').networkStatusManager;
    } catch {
      // Module not loaded yet
    }
  }
  return networkStatusManagerRef;
};

/**
 * Get network connection type
 */
export const getNetworkType = (): string => {
  const manager = getNetworkStatusManager();
  if (manager) {
    return manager.getNetworkType();
  }
  return 'unknown';
};

/**
 * Validate event name
 */
// TR-20 / fleet charset (matches iOS): alphanumerics + _ - . and $ (system events like
// $identify), max 100 chars. The bare build silently ACCEPTED any string while Expo silently
// DROPPED anything with a space — track('Order Completed') recorded on bare, vanished on Expo.
const EVENT_NAME_PATTERN = /^[\p{L}\p{N}_.$-]+$/u;

// Normalize spaces → underscores (with a one-line warn) rather than dropping the event, so
// track('Order Completed') → 'Order_Completed' on BOTH variants instead of diverging.
export const normalizeEventName = (eventName: string): string => {
  if (typeof eventName !== 'string') return eventName;
  // Map any run of out-of-charset chars (spaces, ':', '/', emoji, …) to a single '_', so a
  // previously-valid name like 'checkout:step_1' or 'Order Completed' is RECORDED, not dropped by
  // validateEventName on upgrade. Unicode letters/numbers ARE in the charset ('購入完了' passes
  // through unchanged), matching iOS's Unicode alphanumerics.
  const normalized = eventName.trim().replace(/[^\p{L}\p{N}_.$-]+/gu, '_');
  if (normalized !== eventName) {
    console.warn(`[Datalyr] Event name "${eventName}" normalized to "${normalized}".`);
  }
  return normalized;
};

export const validateEventName = (eventName: string): boolean => {
  return typeof eventName === 'string'
    && eventName.length > 0
    && eventName.length <= 100
    && EVENT_NAME_PATTERN.test(eventName);
};

/**
 * Validate event data
 */
export const validateEventData = (eventData: any): boolean => {
  return !eventData || (typeof eventData === 'object' && eventData !== null);
};

/**
 * Debug logging utility
 */
export const debugLog = (message: string, ...args: any[]): void => {
  if (__DEV__) {
    console.log(`[Datalyr] ${message}`, ...args);
  }
};

/**
 * Error logging utility
 */
export const errorLog = (message: string, error?: Error): void => {
  // Unconditional: dropped events, dead-letter moves and bad keys must be
  // visible in release builds, not only under __DEV__.
  if (error !== undefined) {
    console.warn(`[Datalyr Error] ${message}`, error);
  } else {
    console.warn(`[Datalyr Error] ${message}`);
  }
};

/**
 * Storage utilities
 */
export const Storage = {
  async setItem(key: string, value: any): Promise<void> {
    try {
      const jsonValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, jsonValue);
    } catch (error) {
      errorLog(`Failed to store item ${key}:`, error as Error);
    }
  },
  
  async getItem<T>(key: string): Promise<T | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue != null ? JSON.parse(jsonValue) : null;
    } catch (error) {
      errorLog(`Failed to get item ${key}:`, error as Error);
      return null;
    }
  },
  
  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      errorLog(`Failed to remove item ${key}:`, error as Error);
    }
  },
  
  async clear(): Promise<void> {
    try {
      const keys = Object.values(STORAGE_KEYS);
      await AsyncStorage.multiRemove(keys);
    } catch (error) {
      errorLog('Failed to clear storage:', error as Error);
    }
  },
};

/**
 * DEP-01: warn once about config options that are accepted and then ignored.
 *
 * A `@deprecated` JSDoc tag only shows in an editor — it does not reach a
 * developer who copied a config from an old README, and several of these read
 * like working aliases ("Use `endpoint` instead") when in fact nothing reads
 * them at all. This is the signal that actually surfaces at runtime.
 *
 * Deliberately NOT __DEV__-gated: the whole point is that the developer holds a
 * false belief about what the SDK is doing, and a release build is exactly where
 * that belief goes unchallenged. Fires at most once per process.
 */
let didWarnAboutIgnoredOptions = false;
export function warnAboutIgnoredOptions(config: Record<string, any>): void {
  if (didWarnAboutIgnoredOptions) return;

  const ignored: string[] = [];
  if (config.apiUrl !== undefined) ignored.push('apiUrl (not an alias for endpoint — ignored)');
  if (config.maxEventQueueSize !== undefined) ignored.push('maxEventQueueSize (use maxQueueSize)');
  if (config.autoEvents !== undefined) ignored.push('autoEvents (use autoEventConfig)');
  if (config.retryConfig !== undefined) ignored.push('retryConfig (use maxRetries / retryDelay)');
  if (config.respectDoNotTrack === false) {
    ignored.push('respectDoNotTrack (no consent gate exists — collection is NOT limited)');
  }
  const auto = config.autoEventConfig ?? config.autoEvents;
  if (auto?.trackAppUpdates === false) {
    ignored.push('trackAppUpdates (app_update is manual-only via trackAppUpdate())');
  }
  if (auto?.trackPerformance === true) {
    ignored.push('trackPerformance (the SDK emits no performance events)');
  }
  // `endpoint` is read ONLY when server tracking is off — silently discarded
  // otherwise (http-client.ts hardcodes the ingest URL).
  if (config.endpoint !== undefined && config.useServerTracking !== false) {
    ignored.push('endpoint (only honoured with useServerTracking: false)');
  }

  if (ignored.length === 0) return;
  didWarnAboutIgnoredOptions = true;
  console.warn(
    '[Datalyr] Ignored configuration option(s) — accepted but never read: ' +
    ignored.join('; '),
  );
}
