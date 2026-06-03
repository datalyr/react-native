import { EventPayload, QueuedEvent } from './types';
import { Storage, STORAGE_KEYS, debugLog, errorLog } from './utils';
import { HttpClient } from './http-client';

interface QueueConfig {
  maxQueueSize: number;
  batchSize: number;
  flushInterval: number;
  maxRetryCount: number;
}

export class EventQueue {
  private config: QueueConfig;
  private httpClient: HttpClient;
  private queue: QueuedEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private isOnline: boolean = true;

  constructor(httpClient: HttpClient, config: QueueConfig) {
    this.httpClient = httpClient;
    this.config = config;
    this.initializeQueue();
  }

  /**
   * Initialize the queue by loading persisted events
   */
  private async initializeQueue(): Promise<void> {
    try {
      const persistedQueue = await Storage.getItem<QueuedEvent[]>(STORAGE_KEYS.EVENT_QUEUE);
      if (persistedQueue && Array.isArray(persistedQueue)) {
        this.queue = persistedQueue;
        debugLog(`Loaded ${this.queue.length} events from storage`);
      }
      
      // Start the flush timer
      this.startFlushTimer();
    } catch (error) {
      errorLog('Failed to initialize event queue:', error as Error);
    }
  }

  /**
   * Add an event to the queue
   */
  async enqueue(payload: EventPayload): Promise<void> {
    const queuedEvent: QueuedEvent = {
      payload,
      timestamp: Date.now(),
      retryCount: 0,
    };

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      debugLog('Queue is full, removing oldest event');
      this.queue.shift(); // Remove oldest event
    }

    this.queue.push(queuedEvent);
    debugLog(`Event queued: ${payload.eventName} (queue size: ${this.queue.length})`);

    // Persist to storage
    await this.persistQueue();

    // Try to flush immediately if online
    if (this.isOnline && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process the queue and send events
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    debugLog(`Processing queue with ${this.queue.length} events`);

    try {
      // Drain in batches until the queue is empty or a batch makes no forward progress
      // (offline / all events failing-and-requeued). Previously this sent ONE batchSize
      // batch per call, so a flush()/reconnect with a >batchSize backlog left the rest —
      // and on app-background the terminal session_end could sit behind older events and
      // never send. The progress check prevents a busy-loop during a transient outage.
      while (this.isOnline && this.queue.length > 0) {
        const before = this.queue.length;
        const eventsToProcess = this.queue.slice(0, this.config.batchSize);

        for (const queuedEvent of eventsToProcess) {
          try {
            const response = await this.httpClient.sendEvent(queuedEvent.payload);

            if (response.success) {
              debugLog(`Event sent successfully: ${queuedEvent.payload.eventName}`);
              this.removeFromQueue(queuedEvent);
            } else {
              queuedEvent.retryCount++;
              if (queuedEvent.retryCount >= this.config.maxRetryCount) {
                // Don't silently drop revenue/conversion events — park in a capped
                // dead-letter store (errorLog + recoverable) then remove from the queue.
                await this.deadLetter(queuedEvent);
                this.removeFromQueue(queuedEvent);
              } else {
                debugLog(`Event failed, will retry: ${queuedEvent.payload.eventName} (attempt ${queuedEvent.retryCount})`);
              }
            }
          } catch (error) {
            errorLog(`Error processing event: ${queuedEvent.payload.eventName}`, error as Error);
            queuedEvent.retryCount++;
            if (queuedEvent.retryCount >= this.config.maxRetryCount) {
              await this.deadLetter(queuedEvent);
              this.removeFromQueue(queuedEvent);
            }
          }
        }

        // Persist after each batch so a mid-drain kill doesn't resurrect delivered events.
        await this.persistQueue();

        // No net progress (every event in this batch failed-and-requeued, not yet at max
        // retries) → stop and let the timer / next reconnect retry. Avoids a tight loop.
        if (this.queue.length >= before) break;
      }
    } catch (error) {
      errorLog('Error processing event queue:', error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Park a permanently-failed event in a capped dead-letter store instead of silently
   * dropping it — surfaced (errorLog) and recoverable for replay/inspection.
   */
  private async deadLetter(event: QueuedEvent): Promise<void> {
    errorLog(`Event exceeded max retries (${this.config.maxRetryCount}); moved to dead-letter: ${event.payload.eventName}`);
    try {
      const existing = (await Storage.getItem<QueuedEvent[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
      existing.push(event);
      await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, existing.slice(-100));
    } catch (error) {
      errorLog('Failed to persist dead-letter event:', error as Error);
    }
  }

  /**
   * Remove an event from the queue
   */
  private removeFromQueue(eventToRemove: QueuedEvent): void {
    const index = this.queue.findIndex(event => 
      event.payload.eventId === eventToRemove.payload.eventId
    );
    
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Persist queue to storage
   */
  private async persistQueue(): Promise<void> {
    try {
      await Storage.setItem(STORAGE_KEYS.EVENT_QUEUE, this.queue);
    } catch (error) {
      errorLog('Failed to persist event queue:', error as Error);
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.isOnline && this.queue.length > 0) {
        this.processQueue();
      }
    }, this.config.flushInterval);

    debugLog(`Flush timer started with interval: ${this.config.flushInterval}ms`);
  }

  /**
   * Stop the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      debugLog('Flush timer stopped');
    }
  }

  /**
   * Manually flush the queue
   */
  async flush(): Promise<void> {
    debugLog('Manual flush requested');
    await this.processQueue();
  }

  /**
   * Set online/offline status
   */
  setOnlineStatus(isOnline: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = isOnline;
    
    debugLog(`Network status changed: ${isOnline ? 'online' : 'offline'}`);
    
    // If we just came online, try to process the queue
    if (isOnline && !wasOnline && this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    isProcessing: boolean;
    isOnline: boolean;
    oldestEventAge: number | null;
  } {
    const oldestEvent = this.queue.length > 0 ? this.queue[0] : null;
    const oldestEventAge = oldestEvent ? Date.now() - oldestEvent.timestamp : null;

    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      isOnline: this.isOnline,
      oldestEventAge,
    };
  }

  /**
   * Clear all events from the queue
   */
  async clear(): Promise<void> {
    this.queue = [];
    await Storage.removeItem(STORAGE_KEYS.EVENT_QUEUE);
    debugLog('Event queue cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };
    debugLog('Event queue config updated:', this.config);
    
    // Restart flush timer with new interval
    if (config.flushInterval) {
      this.startFlushTimer();
    }
  }

  /**
   * Destroy the queue and cleanup
   */
  destroy(): void {
    this.stopFlushTimer();
    this.queue = [];
    debugLog('Event queue destroyed');
  }
}

/**
 * Default event queue factory
 */
export const createEventQueue = (httpClient: HttpClient, config?: Partial<QueueConfig>): EventQueue => {
  const defaultConfig: QueueConfig = {
    maxQueueSize: 100,
    batchSize: 10,
    flushInterval: 30000, // 30 seconds — matches SDK constructor defaults and docs
    maxRetryCount: 3,
  };

  return new EventQueue(httpClient, { ...defaultConfig, ...config });
}; 