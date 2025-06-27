// Main entry point for React Native CLI
// Import this with: import { datalyr } from '@datalyr/react-native-sdk';

import { DatalyrSDK, Datalyr } from './datalyr-sdk';

// Create singleton instance for easy usage
export const datalyr = new DatalyrSDK();

// Export enhanced static class for SKAdNetwork usage
export { Datalyr };

// Export types and utilities
export * from './types';
export { attributionManager } from './attribution';
export { createAutoEventsManager, AutoEventsManager } from './auto-events';

// Re-export utilities for advanced usage
export * from './utils';
export * from './http-client';
export * from './event-queue';

// Also export the SDK class for advanced usage
export { DatalyrSDK };

// Export SKAdNetwork components
export { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
export { SKAdNetworkBridge } from './native/SKAdNetworkBridge';

// Default export for compatibility  
export default DatalyrSDK; 