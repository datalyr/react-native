// Automatic Events Configuration
export interface AutoEventConfig {
  trackSessions?: boolean;
  trackScreenViews?: boolean;
  trackAppUpdates?: boolean;
  trackPerformance?: boolean;
  sessionTimeoutMs?: number;
}

// Core SDK Configuration
export interface DatalyrConfig {
  workspaceId: string;
  apiKey: string;
  debug?: boolean;
  apiUrl?: string;
  endpoint?: string;
  maxRetries?: number;
  retryDelay?: number;
  batchSize?: number;
  flushInterval?: number;
  maxQueueSize?: number;
  maxEventQueueSize?: number;
  respectDoNotTrack?: boolean;
  enableAutoEvents?: boolean;
  enableAttribution?: boolean;
  autoEvents?: AutoEventConfig;
  autoEventConfig?: AutoEventConfig;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
  };
}

// Event Types
export interface EventData {
  [key: string]: any;
  userId?: string;
  value?: number;
  currency?: string;
  screen?: string;
  app_version?: string;
  platform?: 'ios' | 'android' | 'windows' | 'macos' | 'web';
  os_version?: string;
  device_model?: string;
  app_build?: string;
  network_type?: string;
}

export interface FingerprintData {
  deviceId?: string;
  advertisingId?: string;
  deviceInfo?: {
    model: string;
    manufacturer: string;
    osVersion: string;
    screenSize: string;
    timezone: string;
    locale?: string;
    carrier?: string;
    isEmulator?: boolean;
  };
}

export interface EventPayload {
  workspaceId: string;
  visitorId: string;
  sessionId: string;
  eventId: string;
  eventName: string;
  eventData?: EventData;
  fingerprintData?: FingerprintData;
  source: 'mobile_app';
  timestamp: string;
  userId?: string;
  userProperties?: Record<string, any>;
}

// User Properties
export interface UserProperties {
  [key: string]: any;
  email?: string;
  name?: string;
  phone?: string;
  age?: number;
  gender?: string;
}

// SDK State
export interface SDKState {
  initialized: boolean;
  config: DatalyrConfig;
  visitorId: string;
  sessionId: string;
  currentUserId?: string;
  userProperties: UserProperties;
  eventQueue: QueuedEvent[];
  isOnline: boolean;
}

export interface QueuedEvent {
  payload: EventPayload;
  timestamp: number;
  retryCount: number;
}

// App State - Updated for React Native 0.80
export type AppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
export type AppStateType = AppState;

// Network State
export interface NetworkState {
  isConnected: boolean;
  type: string;
}

// Device Information
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

// Attribution Data
export interface AttributionData {
  campaign?: string;
  source?: string;
  medium?: string;
  term?: string;
  content?: string;
  clickId?: string;
  installTime?: string;
} 