import { debugLog, errorLog } from './utils';

export type NetworkState = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'vpn' | 'none' | 'unknown';
};

export type NetworkStateListener = (state: NetworkState) => void;

/**
 * Network status manager that detects online/offline status
 * Uses @react-native-community/netinfo for React Native or expo-network for Expo
 */
class NetworkStatusManager {
  private state: NetworkState = {
    isConnected: true, // Default to true until we know otherwise
    isInternetReachable: null,
    type: 'unknown',
  };

  private listeners: Set<NetworkStateListener> = new Set();
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private netInfoModule: any = null;
  private expoNetworkModule: any = null;

  /**
   * Initialize network status monitoring
   * Call this during SDK initialization
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Try @react-native-community/netinfo first (most common in RN apps)
    try {
      this.netInfoModule = require('@react-native-community/netinfo').default;
      await this.initializeWithNetInfo();
      this.initialized = true;
      debugLog('Network status initialized with @react-native-community/netinfo');
      return;
    } catch {
      // Module not available, try expo-network
    }

    // Try expo-network (for Expo apps)
    try {
      this.expoNetworkModule = require('expo-network');
      await this.initializeWithExpoNetwork();
      this.initialized = true;
      debugLog('Network status initialized with expo-network');
      return;
    } catch {
      // Module not available
    }

    // Fallback: assume online (no network monitoring available)
    debugLog('No network status module available, defaulting to online');
    this.state = {
      isConnected: true,
      isInternetReachable: true,
      type: 'unknown',
    };
    this.initialized = true;
  }

  /**
   * Initialize with @react-native-community/netinfo
   */
  private async initializeWithNetInfo(): Promise<void> {
    const NetInfo = this.netInfoModule;

    // Get initial state
    try {
      const netState = await NetInfo.fetch();
      this.updateStateFromNetInfo(netState);
    } catch (error) {
      errorLog('Failed to fetch initial network state:', error as Error);
    }

    // Subscribe to changes
    this.unsubscribe = NetInfo.addEventListener((netState: any) => {
      this.updateStateFromNetInfo(netState);
    });
  }

  /**
   * Update state from NetInfo response
   */
  private updateStateFromNetInfo(netState: any): void {
    const previouslyConnected = this.state.isConnected;

    this.state = {
      isConnected: netState.isConnected ?? true,
      isInternetReachable: netState.isInternetReachable,
      type: this.mapNetInfoType(netState.type),
    };

    // Notify listeners if connection status changed
    if (previouslyConnected !== this.state.isConnected) {
      debugLog(`Network status changed: ${this.state.isConnected ? 'online' : 'offline'} (${this.state.type})`);
      this.notifyListeners();
    }
  }

  /**
   * Map NetInfo type to our simplified type
   */
  private mapNetInfoType(type: string): NetworkState['type'] {
    switch (type) {
      case 'wifi':
        return 'wifi';
      case 'cellular':
        return 'cellular';
      case 'ethernet':
        return 'ethernet';
      case 'bluetooth':
        return 'bluetooth';
      case 'vpn':
        return 'vpn';
      case 'none':
        return 'none';
      default:
        return 'unknown';
    }
  }

  /**
   * Initialize with expo-network
   */
  private async initializeWithExpoNetwork(): Promise<void> {
    const Network = this.expoNetworkModule;

    // Get initial state
    try {
      const networkState = await Network.getNetworkStateAsync();
      this.updateStateFromExpoNetwork(networkState);
    } catch (error) {
      errorLog('Failed to fetch initial network state from expo-network:', error as Error);
    }

    // Note: expo-network doesn't have a listener API like netinfo
    // We'll poll periodically or rely on app state changes
    this.startExpoNetworkPolling();
  }

  /**
   * Update state from expo-network response
   */
  private updateStateFromExpoNetwork(networkState: any): void {
    const previouslyConnected = this.state.isConnected;

    this.state = {
      isConnected: networkState.isConnected ?? true,
      isInternetReachable: networkState.isInternetReachable ?? null,
      type: this.mapExpoNetworkType(networkState.type),
    };

    if (previouslyConnected !== this.state.isConnected) {
      debugLog(`Network status changed: ${this.state.isConnected ? 'online' : 'offline'} (${this.state.type})`);
      this.notifyListeners();
    }
  }

  /**
   * Map expo-network type to our simplified type
   */
  private mapExpoNetworkType(type: string): NetworkState['type'] {
    switch (type) {
      case 'WIFI':
        return 'wifi';
      case 'CELLULAR':
        return 'cellular';
      case 'ETHERNET':
        return 'ethernet';
      case 'BLUETOOTH':
        return 'bluetooth';
      case 'VPN':
        return 'vpn';
      case 'NONE':
        return 'none';
      default:
        return 'unknown';
    }
  }

  /**
   * Poll expo-network for changes (since it doesn't have a listener API)
   */
  private pollingInterval: NodeJS.Timeout | null = null;

  private startExpoNetworkPolling(): void {
    // Poll every 5 seconds for network changes
    this.pollingInterval = setInterval(async () => {
      try {
        if (this.expoNetworkModule) {
          const networkState = await this.expoNetworkModule.getNetworkStateAsync();
          this.updateStateFromExpoNetwork(networkState);
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 5000);
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (error) {
        errorLog('Error in network state listener:', error as Error);
      }
    });
  }

  /**
   * Get current network state
   */
  getState(): NetworkState {
    return { ...this.state };
  }

  /**
   * Check if device is currently online
   */
  isOnline(): boolean {
    // Consider online if connected OR if we're not sure about internet reachability
    return this.state.isConnected && (this.state.isInternetReachable !== false);
  }

  /**
   * Get current network type
   */
  getNetworkType(): NetworkState['type'] {
    return this.state.type;
  }

  /**
   * Subscribe to network state changes
   * Returns an unsubscribe function
   */
  subscribe(listener: NetworkStateListener): () => void {
    this.listeners.add(listener);

    // Immediately call with current state
    try {
      listener(this.state);
    } catch (error) {
      errorLog('Error calling network state listener:', error as Error);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Refresh network state manually
   * Useful when returning from background
   */
  async refresh(): Promise<NetworkState> {
    if (this.netInfoModule) {
      try {
        const netState = await this.netInfoModule.fetch();
        this.updateStateFromNetInfo(netState);
      } catch (error) {
        errorLog('Failed to refresh network state:', error as Error);
      }
    } else if (this.expoNetworkModule) {
      try {
        const networkState = await this.expoNetworkModule.getNetworkStateAsync();
        this.updateStateFromExpoNetwork(networkState);
      } catch (error) {
        errorLog('Failed to refresh network state from expo-network:', error as Error);
      }
    }

    return this.state;
  }

  /**
   * Cleanup and stop monitoring
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.listeners.clear();
    this.initialized = false;

    debugLog('Network status manager destroyed');
  }
}

// Export singleton instance
export const networkStatusManager = new NetworkStatusManager();

// Export for direct access
export default networkStatusManager;
