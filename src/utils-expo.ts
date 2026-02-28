import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Dimensions } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// Storage keys
export const STORAGE_KEYS = {
  VISITOR_ID: '@datalyr/visitor_id',
  ANONYMOUS_ID: '@datalyr/anonymous_id',  // Persistent anonymous identifier
  SESSION_ID: '@datalyr/session_id',
  SESSION_START: '@datalyr/session_start',
  USER_ID: '@datalyr/user_id',
  USER_PROPERTIES: '@datalyr/user_properties',
  EVENT_QUEUE: '@datalyr/event_queue',
  ATTRIBUTION_DATA: '@datalyr/attribution_data',
  INSTALL_TIME: '@datalyr/install_time',
  LAST_APP_VERSION: '@datalyr/last_app_version',
  LAST_SESSION_TIME: '@datalyr/last_session_time',
  DEVICE_ID: '@datalyr/device_id',
} as const;

// Debug logging
export const debugLog = (message: string, ...args: any[]) => {
  if (__DEV__) {
    console.log(`[Datalyr] ${message}`, ...args);
  }
};

export const errorLog = (message: string, error?: Error) => {
  console.error(`[Datalyr Error] ${message}`, error);
};

// UUID generation
export const generateUUID = (): string => {
  return uuidv4();
};

// Storage utilities
export const Storage = {
  async getItem<T>(key: string): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      errorLog(`Failed to get storage item ${key}:`, error as Error);
      return null;
    }
  },

  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      errorLog(`Failed to set storage item ${key}:`, error as Error);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      errorLog(`Failed to remove storage item ${key}:`, error as Error);
    }
  },
};

// Device info using Expo APIs
export interface DeviceInfo {
  deviceId: string;
  model: string;
  manufacturer: string;
  osVersion: string;
  appVersion: string;
  buildNumber: string;
  bundleId: string;
  screenWidth: number;
  screenHeight: number;
  timezone: string;
  locale: string;
  carrier?: string;
  isEmulator: boolean;
}

// Cached device info to avoid repeated async calls (matches utils.ts pattern)
let cachedDeviceInfo: DeviceInfo | null = null;
let deviceInfoPromise: Promise<DeviceInfo> | null = null;

const fetchDeviceInfoInternal = async (): Promise<DeviceInfo> => {
  try {
    const deviceId = await getOrCreateDeviceId();

    return {
      deviceId,
      model: Device.modelName || Device.deviceName || 'Unknown',
      manufacturer: Device.manufacturer || (Platform.OS === 'ios' ? 'Apple' : 'Unknown'),
      osVersion: Device.osVersion || 'Unknown',
      appVersion: Application.nativeApplicationVersion || '1.0.0',
      buildNumber: Application.nativeBuildVersion || '1',
      bundleId: Application.applicationId || 'unknown.bundle.id',
      screenWidth: Dimensions.get('window').width,
      screenHeight: Dimensions.get('window').height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
      carrier: undefined, // Not available in Expo managed workflow
      isEmulator: !Device.isDevice,
    };
  } catch (error) {
    errorLog('Error getting device info:', error as Error);
    return {
      deviceId: await getOrCreateDeviceId(),
      model: 'Unknown',
      manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Unknown',
      osVersion: 'Unknown',
      appVersion: '1.0.0',
      buildNumber: '1',
      bundleId: 'unknown.bundle.id',
      screenWidth: Dimensions.get('window').width,
      screenHeight: Dimensions.get('window').height,
      timezone: 'UTC',
      locale: 'en-US',
      isEmulator: true,
    };
  }
};

export const getDeviceInfo = async (): Promise<DeviceInfo> => {
  if (cachedDeviceInfo) return cachedDeviceInfo;
  if (deviceInfoPromise) return deviceInfoPromise;

  deviceInfoPromise = fetchDeviceInfoInternal();
  try {
    cachedDeviceInfo = await deviceInfoPromise;
    return cachedDeviceInfo;
  } finally {
    deviceInfoPromise = null;
  }
};

// Device ID management
const getOrCreateDeviceId = async (): Promise<string> => {
  try {
    let deviceId = await Storage.getItem<string>(STORAGE_KEYS.DEVICE_ID);
    
    if (!deviceId) {
      deviceId = generateUUID();
      await Storage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
    }
    
    return deviceId;
  } catch (error) {
    errorLog('Error managing device ID:', error as Error);
    return generateUUID();
  }
};

// Visitor ID management
export const getOrCreateVisitorId = async (): Promise<string> => {
  try {
    let visitorId = await Storage.getItem<string>(STORAGE_KEYS.VISITOR_ID);

    if (!visitorId) {
      visitorId = generateUUID();
      await Storage.setItem(STORAGE_KEYS.VISITOR_ID, visitorId);
      debugLog('Created new visitor ID:', visitorId);
    }

    return visitorId;
  } catch (error) {
    errorLog('Error managing visitor ID:', error as Error);
    return generateUUID();
  }
};

// Anonymous ID management - persistent across app reinstalls
export const getOrCreateAnonymousId = async (): Promise<string> => {
  try {
    let anonymousId = await Storage.getItem<string>(STORAGE_KEYS.ANONYMOUS_ID);

    if (!anonymousId) {
      // Generate anonymous_id with anon_ prefix to match web SDK
      anonymousId = `anon_${generateUUID()}`;
      await Storage.setItem(STORAGE_KEYS.ANONYMOUS_ID, anonymousId);
      debugLog('Created new anonymous ID:', anonymousId);
    }

    return anonymousId;
  } catch (error) {
    errorLog('Error managing anonymous ID:', error as Error);
    return `anon_${generateUUID()}`;
  }
};

// Session management
export const getOrCreateSessionId = async (): Promise<string> => {
  try {
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    
    const [sessionId, sessionStart] = await Promise.all([
      Storage.getItem<string>(STORAGE_KEYS.SESSION_ID),
      Storage.getItem<number>(STORAGE_KEYS.SESSION_START),
    ]);
    
    // Check if session is still valid
    if (sessionId && sessionStart && (now - sessionStart) < sessionTimeout) {
      return sessionId;
    }
    
    // Create new session
    const newSessionId = generateUUID();
    await Promise.all([
      Storage.setItem(STORAGE_KEYS.SESSION_ID, newSessionId),
      Storage.setItem(STORAGE_KEYS.SESSION_START, now),
    ]);
    
    debugLog('Created new session:', newSessionId);
    return newSessionId;
  } catch (error) {
    errorLog('Error managing session ID:', error as Error);
    return generateUUID();
  }
};

// Fingerprint data creation using Expo APIs
export const createFingerprintData = async () => {
  try {
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
    };
  } catch (error) {
    errorLog('Error creating fingerprint data:', error as Error);
    const deviceInfo = await getDeviceInfo();
    return {
      deviceId: deviceInfo.deviceId,
      deviceInfo: {
        model: deviceInfo.model,
        manufacturer: deviceInfo.manufacturer,
        osVersion: deviceInfo.osVersion,
        screenSize: '0x0',
        timezone: deviceInfo.timezone,
        locale: deviceInfo.locale,
        isEmulator: deviceInfo.isEmulator,
      },
    };
  }
};

// IDFA/GAID collection has been removed for privacy compliance
// Modern attribution tracking relies on privacy-safe methods:

// Cached network type to avoid per-event native bridge calls
let cachedNetworkType = 'unknown';
let networkTypeLastFetched = 0;
const NETWORK_TYPE_CACHE_MS = 30000; // Refresh every 30s

// Network type detection using Expo Network — cached to avoid per-event async calls
export const getNetworkType = (): string => {
  // Trigger background refresh if stale, but always return cached value synchronously
  const now = Date.now();
  if (now - networkTypeLastFetched > NETWORK_TYPE_CACHE_MS) {
    networkTypeLastFetched = now;
    refreshNetworkType();
  }
  return cachedNetworkType;
};

const refreshNetworkType = async (): Promise<void> => {
  try {
    const networkState = await Network.getNetworkStateAsync();

    if (!networkState.isConnected) {
      cachedNetworkType = 'none';
      return;
    }

    switch (networkState.type) {
      case Network.NetworkStateType.WIFI:
        cachedNetworkType = 'wifi';
        break;
      case Network.NetworkStateType.CELLULAR:
        cachedNetworkType = 'cellular';
        break;
      case Network.NetworkStateType.ETHERNET:
        cachedNetworkType = 'ethernet';
        break;
      case Network.NetworkStateType.BLUETOOTH:
        cachedNetworkType = 'bluetooth';
        break;
      default:
        cachedNetworkType = 'unknown';
    }
  } catch (error) {
    debugLog('Error getting network type:', error);
  }
};

// Event validation
export const validateEventName = (eventName: string): boolean => {
  if (!eventName || typeof eventName !== 'string') {
    return false;
  }
  
  if (eventName.length > 100) {
    return false;
  }
  
  // Allow letters, numbers, underscores, and hyphens
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(eventName);
};

export const validateEventData = (eventData?: Record<string, any>): boolean => {
  if (!eventData) {
    return true;
  }
  
  if (typeof eventData !== 'object' || Array.isArray(eventData)) {
    return false;
  }
  
  try {
    // Check if data can be serialized
    JSON.stringify(eventData);
    return true;
  } catch {
    return false;
  }
};

// Install detection
export const isFirstLaunch = async (): Promise<boolean> => {
  try {
    const installTime = await Storage.getItem<string>(STORAGE_KEYS.INSTALL_TIME);
    
    if (!installTime) {
      // First launch - record install time
      await Storage.setItem(STORAGE_KEYS.INSTALL_TIME, new Date().toISOString());
      return true;
    }
    
    return false;
  } catch (error) {
    errorLog('Error checking first launch:', error as Error);
    return false;
  }
};

// App version tracking
export const checkAppVersion = async (): Promise<{ isUpdate: boolean; previousVersion?: string; currentVersion: string }> => {
  try {
    const currentVersion = Application.nativeApplicationVersion || '1.0.0';
    const currentBuild = Application.nativeBuildVersion || '1';
    const versionString = `${currentVersion}-${currentBuild}`;
    
    const lastVersion = await Storage.getItem<string>(STORAGE_KEYS.LAST_APP_VERSION);
    
    if (lastVersion && lastVersion !== versionString) {
      await Storage.setItem(STORAGE_KEYS.LAST_APP_VERSION, versionString);
      return {
        isUpdate: true,
        previousVersion: lastVersion,
        currentVersion: versionString,
      };
    }
    
    if (!lastVersion) {
      await Storage.setItem(STORAGE_KEYS.LAST_APP_VERSION, versionString);
    }
    
    return {
      isUpdate: false,
      currentVersion: versionString,
    };
  } catch (error) {
    errorLog('Error checking app version:', error as Error);
    return {
      isUpdate: false,
      currentVersion: '1.0.0-1',
    };
  }
}; 