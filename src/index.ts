// Main entry point for React Native CLI
// Import this with: import { datalyr } from '@datalyr/react-native-sdk';

export { DatalyrSDK as datalyr } from './datalyr-sdk';
export * from './types';
export { attributionManager } from './attribution';
export { createAutoEventsManager, AutoEventsManager } from './auto-events';

// Re-export utilities for advanced usage
export * from './utils';
export * from './http-client';
export * from './event-queue';

// Default export for compatibility
import { DatalyrSDK } from './datalyr-sdk';
export default DatalyrSDK; 