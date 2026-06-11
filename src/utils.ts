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
  EVENT_QUEUE: '@datalyr/event_queue',
  DEAD_LETTER_QUEUE: '@datalyr/dead_letter_queue',  // capped store for events that exhausted retries (vs silent drop)
  ATTRIBUTION_DATA: '@datalyr/attribution_data',
  LAST_SESSION_TIME: '@datalyr/last_session_time',
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
 * Hash a string to create a fingerprint
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
 * A STABLE fallback device id, persisted in AsyncStorage so fingerprint_hash doesn't churn
 * on every launch when react-native-device-info is unavailable / throws. Reuses the
 * VISITOR_ID storage namespace via a dedicated key.
 */
const FALLBACK_DEVICE_ID_KEY = '@datalyr/fallback_device_id';
const getOrCreateFallbackDeviceId = async (): Promise<string> => {
  try {
    let id = await AsyncStorage.getItem(FALLBACK_DEVICE_ID_KEY);
    if (!id) {
      id = generateUUID();
      await AsyncStorage.setItem(FALLBACK_DEVICE_ID_KEY, id);
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
      // Persisted so fingerprint_hash is stable across launches (was a fresh UUID each run).
      deviceId: await getOrCreateFallbackDeviceId(),
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
      deviceId,
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
      DeviceInfo.getUniqueId(),
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
      deviceId,
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
      // Persisted so fingerprint_hash is stable across launches (was a fresh UUID each run).
      deviceId: await getOrCreateFallbackDeviceId(),
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
export const validateEventName = (eventName: string): boolean => {
  return !!(eventName && typeof eventName === 'string' && eventName.trim().length > 0);
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
  if (__DEV__) {
    console.error(`[Datalyr Error] ${message}`, error);
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