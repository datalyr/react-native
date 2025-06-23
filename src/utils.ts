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

import { DeviceInfo as DeviceInfoType, FingerprintData } from './types';

// Storage Keys
export const STORAGE_KEYS = {
  VISITOR_ID: '@datalyr/visitor_id',
  SESSION_ID: '@datalyr/session_id',
  USER_ID: '@datalyr/user_id',
  USER_PROPERTIES: '@datalyr/user_properties',
  EVENT_QUEUE: '@datalyr/event_queue',
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

/**
 * Collect comprehensive device information
 */
export const getDeviceInfo = async (): Promise<DeviceInfoType> => {
  const { width, height } = Dimensions.get('window');
  
  // If DeviceInfo is not available (like in Expo Go), use fallback
  if (!DeviceInfo) {
    return {
      deviceId: generateUUID(),
      model: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Google',
      osVersion: Platform.Version.toString(),
      appVersion: '1.0.0',
      buildNumber: '1',
      bundleId: 'expo.app',
      screenWidth: width,
      screenHeight: height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      locale: 'en-US',
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
      deviceId: generateUUID(),
      model: 'Unknown',
      manufacturer: Platform.OS === 'ios' ? 'Apple' : 'Android',
      osVersion: Platform.Version.toString(),
      appVersion: '1.0.0',
      buildNumber: '1',
      bundleId: 'unknown',
      screenWidth: width,
      screenHeight: height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      locale: 'en-US',
      isEmulator: false,
    };
  }
};

/**
 * Create fingerprint data for attribution
 */
export const createFingerprintData = async (): Promise<FingerprintData> => {
  const deviceInfo = await getDeviceInfo();
  
  let advertisingId: string | undefined = undefined;
  
  // Only try to get advertising ID if DeviceInfo is available
  if (DeviceInfo) {
    try {
      advertisingId = await DeviceInfo.getAndroidId().catch(() => 
        DeviceInfo.getIosIdForVendor().catch(() => undefined)
      );
    } catch (error) {
      console.warn('Failed to get advertising ID:', error);
    }
  }
  
  return {
    deviceId: deviceInfo.deviceId,
    advertisingId,
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

/**
 * Get network connection type
 */
export const getNetworkType = (): string => {
  // This will be enhanced with react-native-netinfo if needed
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