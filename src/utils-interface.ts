/**
 * Interface for SDK utilities
 * Both utils.ts and utils-expo.ts implement this interface
 */

import { DeviceInfo, FingerprintData } from './types';

export interface SDKUtils {
  STORAGE_KEYS: {
    VISITOR_ID: string;
    ANONYMOUS_ID: string;
    SESSION_ID: string;
    USER_ID: string;
    USER_PROPERTIES: string;
    EVENT_QUEUE: string;
    ATTRIBUTION_DATA: string;
    LAST_SESSION_TIME: string;
  };

  generateUUID: () => string;
  getOrCreateVisitorId: () => Promise<string>;
  getOrCreateAnonymousId: () => Promise<string>;
  getOrCreateSessionId: () => Promise<string>;
  getDeviceInfo: () => Promise<DeviceInfo>;
  createFingerprintData: () => Promise<FingerprintData>;
  getNetworkType: () => string | Promise<string>;
  validateEventName: (eventName: string) => boolean;
  validateEventData: (eventData: any) => boolean;
  debugLog: (message: string, ...args: any[]) => void;
  errorLog: (message: string, error?: Error) => void;

  Storage: {
    setItem: (key: string, value: any) => Promise<void>;
    getItem: <T>(key: string) => Promise<T | null>;
    removeItem: (key: string) => Promise<void>;
    clear?: () => Promise<void>;
  };
}
