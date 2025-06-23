import { EventPayload, QueuedEvent } from './types';
import { debugLog, errorLog } from './utils';

interface HttpClientConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  apiKey?: string;
}

interface HttpResponse {
  success: boolean;
  status: number;
  data?: any;
  error?: string;
}

export class HttpClient {
  private config: HttpClientConfig;
  private endpoint: string;

  constructor(endpoint: string, config: HttpClientConfig) {
    this.endpoint = endpoint;
    this.config = config;
  }

  /**
   * Send a single event with retry logic
   */
  async sendEvent(payload: EventPayload): Promise<HttpResponse> {
    return this.sendWithRetry(payload, 0);
  }

  /**
   * Send multiple events in a batch
   */
  async sendBatch(payloads: EventPayload[]): Promise<HttpResponse[]> {
    // For now, send events individually
    // In production, you might want to implement true batching
    return Promise.all(payloads.map(payload => this.sendEvent(payload)));
  }

  /**
   * Send request with exponential backoff retry
   */
  private async sendWithRetry(payload: EventPayload, retryCount: number): Promise<HttpResponse> {
    try {
      debugLog(`Sending event: ${payload.eventName} (attempt ${retryCount + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': `datalyr-react-native-sdk/1.0.5`,
      };

      // Add API key if provided
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }
      
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog(`Event sent successfully: ${payload.eventName}`, responseData);

      return {
        success: true,
        status: response.status,
        data: responseData,
      };

    } catch (error) {
      errorLog(`Event send failed (attempt ${retryCount + 1}):`, error as Error);

      // Check if we should retry
      if (retryCount < this.config.maxRetries && this.shouldRetry(error as Error)) {
        const delay = this.calculateRetryDelay(retryCount);
        debugLog(`Retrying in ${delay}ms...`);
        
        await this.delay(delay);
        return this.sendWithRetry(payload, retryCount + 1);
      }

      return {
        success: false,
        status: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetry(error: Error): boolean {
    const retryableErrors = [
      'NetworkError',
      'TimeoutError',
      'AbortError',
      'fetch is not defined', // Fallback for environments without fetch
    ];

    return retryableErrors.some(retryableError => 
      error.message.includes(retryableError) || error.name === retryableError
    );
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = Math.pow(2, retryCount) * baseDelay;
    const jitter = Math.random() * 1000; // Add some jitter to prevent thundering herd
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Promise-based delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test connectivity to the endpoint
   */
  async testConnection(): Promise<boolean> {
    try {
      const testPayload: EventPayload = {
        workspaceId: 'test', 
        visitorId: 'test',
        sessionId: 'test',
        eventId: 'test',
        eventName: 'connection_test',
        source: 'mobile_app',
        timestamp: new Date().toISOString(),
      };

      const response = await this.sendEvent(testPayload);
      return response.success;
    } catch (error) {
      errorLog('Connection test failed:', error as Error);
      return false;
    }
  }

  /**
   * Update endpoint URL
   */
  updateEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
    debugLog(`Updated endpoint to: ${endpoint}`);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HttpClientConfig>): void {
    this.config = { ...this.config, ...config };
    debugLog('Updated HTTP client config:', this.config);
  }
}

/**
 * Default HTTP client factory
 */
export const createHttpClient = (endpoint: string, config?: Partial<HttpClientConfig>): HttpClient => {
  const defaultConfig: HttpClientConfig = {
    maxRetries: 3,
    retryDelay: 1000, // 1 second base delay
    timeout: 15000, // 15 seconds
    apiKey: undefined,
  };

  return new HttpClient(endpoint, { ...defaultConfig, ...config });
}; 