import { EventPayload } from './types';
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
export declare class HttpClient {
    private config;
    private endpoint;
    constructor(endpoint: string, config: HttpClientConfig);
    /**
     * Send a single event with retry logic
     */
    sendEvent(payload: EventPayload): Promise<HttpResponse>;
    /**
     * Send multiple events in a batch
     */
    sendBatch(payloads: EventPayload[]): Promise<HttpResponse[]>;
    /**
     * Send request with exponential backoff retry
     */
    private sendWithRetry;
    /**
     * Determine if an error should trigger a retry
     */
    private shouldRetry;
    /**
     * Calculate exponential backoff delay
     */
    private calculateRetryDelay;
    /**
     * Promise-based delay
     */
    private delay;
    /**
     * Test connectivity to the endpoint
     */
    testConnection(): Promise<boolean>;
    /**
     * Update endpoint URL
     */
    updateEndpoint(endpoint: string): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<HttpClientConfig>): void;
}
/**
 * Default HTTP client factory
 */
export declare const createHttpClient: (endpoint: string, config?: Partial<HttpClientConfig>) => HttpClient;
export {};
