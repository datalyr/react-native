// Type declarations for modules that might not have proper TypeScript support

declare module 'react-native-device-info' {
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

  const DeviceInfo: {
    getUniqueId(): Promise<string>;
    getModel(): Promise<string>;
    getManufacturer(): Promise<string>;
    getSystemVersion(): Promise<string>;
    getVersion(): Promise<string>;
    getBuildNumber(): Promise<string>;
    getBundleId(): Promise<string>;
    getTimezone(): Promise<string>;
    getDeviceLocale(): Promise<string>;
    getCarrier(): Promise<string>;
    isEmulator(): Promise<boolean>;
    getAndroidId(): Promise<string>;
    getIosIdForVendor(): Promise<string>;
  };

  export default DeviceInfo;
}

declare module 'react-native-idfa' {
  export function getIDFA(): Promise<string>;
  export function getAdvertisingId(): Promise<string>;
}

declare module 'react-native-get-random-values' {
  // This module is imported for side effects only
} 