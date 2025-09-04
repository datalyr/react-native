import 'react-native-get-random-values';
import { DeviceInfo as DeviceInfoType, FingerprintData } from './types';
export declare const STORAGE_KEYS: {
    VISITOR_ID: string;
    ANONYMOUS_ID: string;
    SESSION_ID: string;
    USER_ID: string;
    USER_PROPERTIES: string;
    EVENT_QUEUE: string;
    ATTRIBUTION_DATA: string;
    LAST_SESSION_TIME: string;
};
/**
 * Generate a UUID v4
 */
export declare const generateUUID: () => string;
/**
 * Generate a session ID with timestamp
 */
export declare const generateSessionId: () => string;
/**
 * Hash a string to create a fingerprint
 */
export declare const hashString: (str: string) => string;
/**
 * Get or create a persistent visitor ID
 */
export declare const getOrCreateVisitorId: () => Promise<string>;
/**
 * Get or create a persistent anonymous ID
 * This ID persists across app reinstalls and never changes
 */
export declare const getOrCreateAnonymousId: () => Promise<string>;
/**
 * Get or create a session ID (with session timeout logic)
 */
export declare const getOrCreateSessionId: () => Promise<string>;
/**
 * Collect comprehensive device information
 */
export declare const getDeviceInfo: () => Promise<DeviceInfoType>;
/**
 * Create fingerprint data for attribution
 */
export declare const createFingerprintData: () => Promise<FingerprintData>;
/**
 * Get network connection type
 */
export declare const getNetworkType: () => string;
/**
 * Validate event name
 */
export declare const validateEventName: (eventName: string) => boolean;
/**
 * Validate event data
 */
export declare const validateEventData: (eventData: any) => boolean;
/**
 * Debug logging utility
 */
export declare const debugLog: (message: string, ...args: any[]) => void;
/**
 * Error logging utility
 */
export declare const errorLog: (message: string, error?: Error) => void;
/**
 * Storage utilities
 */
export declare const Storage: {
    setItem(key: string, value: any): Promise<void>;
    getItem<T>(key: string): Promise<T | null>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
};
