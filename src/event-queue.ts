import { EventPayload, QueuedEvent } from './types';
import { Storage, STORAGE_KEYS, debugLog, errorLog } from './utils';
import { HttpClient } from './http-client';

/** Why the SDK gave up on an event. Every such event is counted (getStats().dropped). */
export type DropReason =
  | 'rejected'            // the server refused it for good (a final 4xx)
  | 'dead_letter_full'    // the capped dead-letter store pushed out its oldest entry
  | 'dead_letter_expired';// replayed too often, or older than 7 days, in the dead-letter store

/** Entries kept in the dead-letter store; older ones are pushed out (and counted). */
export const DEAD_LETTER_CAP = 100;
/** Backoff after a temporary failure (5xx, 503, 429, 408, timeout, network): base, cap. */
export const TRANSIENT_BACKOFF_BASE_MS = 5000;
export const TRANSIENT_BACKOFF_MAX_MS = 5 * 60 * 1000;
/** Longest Retry-After the queue honours; a larger value is treated as this. */
export const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;

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
  // Set by destroy(). A pre-init/orphan queue (built with an empty key in the SDK
  // constructor) is destroy()'d once initialize() installs the configured queue; this
  // flag stops its async storage-load and timer from resurrecting it afterwards.
  private destroyed: boolean = false;
  // Temporary-failure backoff: no send before this time; how many failures in a row.
  private retryNotBefore: number = 0;
  private consecutiveTransientFailures: number = 0;
  // Serialises updates of the persisted drop counter.
  private dropCountWrite: Promise<void> = Promise.resolve();
  // Serialises every read-modify-write of the dead-letter store (deadLetter, replay), so
  // un-awaited track() calls cannot overwrite each other's entries.
  private deadLetterChain: Promise<void> = Promise.resolve();
  private droppedCounts: Partial<Record<DropReason, number>> = {};

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
      // destroy() may have run while this async load was in flight (the orphan-queue
      // teardown race). Bail so it can't repopulate the queue or restart the flush timer
      // and resurrect leftover events through an empty-key client.
      if (this.destroyed) return;
      if (persistedQueue && Array.isArray(persistedQueue)) {
        // Filter out corrupted entries (null / missing payload / no eventName) — a partial
        // write or cross-version schema drift would otherwise throw inside processQueue's
        // catch handler and jam the queue head every cycle (head-of-line blockage).
        const loaded = persistedQueue.filter(
          (e) => e && e.payload && typeof e.payload.eventName === 'string'
        );
        if (loaded.length !== persistedQueue.length) {
          errorLog(`Dropped ${persistedQueue.length - loaded.length} corrupted queue entr(ies) on load`);
        }
        // Prepend: events enqueued while this load was in flight (pre-init replay,
        // app_install) must survive, and the persisted backlog is older.
        const inFlight = new Set(this.queue.map((e) => e.payload.eventId));
        this.queue = [...loaded.filter((e) => !inFlight.has(e.payload.eventId)), ...this.queue];
        debugLog(`Loaded ${this.queue.length} events from storage`);
      }

      try {
        const counts = await Storage.getItem<Partial<Record<DropReason, number>>>(STORAGE_KEYS.DROPPED_EVENT_COUNTS);
        if (counts && typeof counts === 'object') this.droppedCounts = { ...counts, ...this.droppedCounts };
      } catch {
        // Counts are diagnostics; a read failure must not stop the queue.
      }

      // Re-enqueue any dead-lettered events (exhausted retries / overflow) so a transient
      // outage doesn't permanently strand them. Bounded by replayCount + age (see replayDeadLetter).
      await this.replayDeadLetter();

      // Start the flush timer
      this.startFlushTimer();

      // Drain immediately if we loaded/replayed anything and we're online — don't wait a
      // full flush interval to deliver persisted/replayed events.
      if (this.isOnline && this.queue.length > 0) {
        void this.processQueue();
      }
    } catch (error) {
      errorLog('Failed to initialize event queue:', error as Error);
    }
  }

  /**
   * Re-enqueue dead-lettered events for another delivery attempt. Called on init and on
   * offline→online reconnect. Each replay resets retryCount and increments replayCount;
   * events that exhaust MAX_REPLAYS or exceed MAX_DEAD_LETTER_AGE_MS are dropped for good
   * (genuinely undeliverable), so this can't loop a permanently-bad event forever.
   */
  private replayDeadLetter(): Promise<void> {
    return this.serialDeadLetter(() => this.replayDeadLetterNow());
  }

  /** Run one dead-letter store operation after every earlier one has finished. */
  private serialDeadLetter(op: () => Promise<void>): Promise<void> {
    const run = this.deadLetterChain.then(op, op);
    this.deadLetterChain = run.catch(() => undefined);
    return run;
  }

  private async replayDeadLetterNow(): Promise<void> {
    if (this.destroyed) return;
    const MAX_REPLAYS = 3;
    const MAX_DEAD_LETTER_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    try {
      const stored = (await Storage.getItem<QueuedEvent[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
      if (!Array.isArray(stored) || stored.length === 0) return;

      const now = Date.now();
      let replayed = 0;
      let expired = 0;
      // Entries that are still replayable but do not fit under the queue limit stay in
      // the dead-letter store for the next replay.
      const kept: QueuedEvent[] = [];
      for (const event of stored) {
        if (!event || !event.payload || typeof event.payload.eventName !== 'string') continue;
        // Permanent entries (413 payload-too-large) can never deliver; never replay them.
        if (event.permanent) continue;
        const replayCount = event.replayCount || 0;
        const age = now - (event.timestamp || now);
        if (replayCount >= MAX_REPLAYS || age > MAX_DEAD_LETTER_AGE_MS) {
          expired++;
          continue;
        }
        if (this.queue.length >= this.config.maxQueueSize) {
          kept.push(event);
          continue;
        }
        // Reset retryCount for a fresh delivery window; bump replayCount to bound retries.
        this.queue.push({ ...event, retryCount: 0, replayCount: replayCount + 1 });
        replayed++;
      }

      // Clear the dead-letter store — anything not replayed was too old / too-often-retried
      // and is intentionally dropped (it would never deliver).
      if (kept.length > 0) {
        await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, kept);
      } else {
        await Storage.removeItem(STORAGE_KEYS.DEAD_LETTER_QUEUE);
      }
      if (expired > 0) {
        errorLog(`Dropped ${expired} dead-letter event(s) past their replay limit or age`);
        await this.countDropped('dead_letter_expired', expired);
      }
      if (replayed > 0) {
        debugLog(`Replayed ${replayed} dead-letter event(s) back into the queue`);
        await this.persistQueue();
      }
    } catch (error) {
      errorLog('Failed to replay dead-letter queue:', error as Error);
    }
  }

  /**
   * Connectivity-class failures (aborted/timed-out/offline) are NOT the event's fault — a
   * sustained outage shouldn't burn the retry budget and dead-letter a perfectly-good
   * event. Only definitive server rejections consume retryCount.
   */
  private isConnectivityError(error: unknown): boolean {
    const msg = (error as Error)?.message || '';
    const name = (error as Error)?.name || '';
    return (
      name === 'AbortError' ||
      name === 'TimeoutError' ||
      msg.includes('AbortError') ||
      msg.includes('TimeoutError') ||
      msg.includes('NetworkError') ||
      msg.includes('Network request failed') ||
      msg.includes('fetch is not defined')
    );
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

    // Push and enforce the limit with no await in between, so un-awaited concurrent
    // enqueues can never take the queue past it. Queue full — the OLDEST events are
    // evicted. Don't drop them silently: often the earliest, highest-value events
    // (session_start / app_install / a purchase queued while offline). Park them in the
    // capped dead-letter store (serialised; its own overflow is counted).
    this.queue.push(queuedEvent);
    const evicted: QueuedEvent[] = [];
    while (this.queue.length > Math.max(1, this.config.maxQueueSize)) {
      const oldest = this.queue.shift();
      if (oldest) evicted.push(oldest);
    }
    debugLog(`Event queued: ${payload.eventName} (queue size: ${this.queue.length})`);
    for (const e of evicted) {
      errorLog(`Queue full (max ${this.config.maxQueueSize}); oldest event moved to dead-letter: ${e.payload.eventName}`);
      await this.deadLetter(e);
    }

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
    if (this.destroyed || this.isProcessing || this.queue.length === 0) {
      return;
    }
    if (Date.now() < this.retryNotBefore) {
      // Backing off after a temporary failure (or the server's Retry-After).
      debugLog(`Send paused for ${this.retryNotBefore - Date.now()}ms after a temporary failure`);
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
        // Count forward progress as REMOVALS made by THIS batch (delivered or dead-lettered),
        // not total queue length before/after — concurrent enqueues (e.g. session_end queued
        // mid-flush on app-background) must not be counted against progress and strand the
        // just-queued event for the unreliable background timer.
        let removedThisBatch = 0;
        const eventsToProcess = this.queue.slice(0, this.config.batchSize);

        for (const queuedEvent of eventsToProcess) {
          try {
            const response = await this.httpClient.sendEvent(queuedEvent.payload);

            if (response.success) {
              debugLog(`Event sent successfully: ${queuedEvent.payload.eventName}`);
              this.consecutiveTransientFailures = 0;
              this.removeFromQueue(queuedEvent);
              removedThisBatch++;
            } else if (response.transient) {
              // 5xx (503 included), 429, 408, a timeout or a network error: the event is
              // kept as it is (same eventId, no retry burned) and the whole drain backs
              // off, honouring the server's Retry-After. Sending the rest of the batch
              // into the same outage would only add load.
              this.scheduleBackoff(response.retryAfterMs);
              debugLog(`Temporary failure (status ${response.status}); keeping event queued: ${queuedEvent.payload.eventName}`);
              // Events delivered earlier in this batch must not stay on disk.
              await this.persistQueue();
              return;
            } else if (response.rejected) {
              // A final 4xx: the server will never accept this event. Drop it and count it.
              errorLog(`Event '${queuedEvent.payload.eventName}' refused by the server (HTTP ${response.status}); dropped`);
              this.removeFromQueue(queuedEvent);
              removedThisBatch++;
              await this.countDropped('rejected');
            } else if (response.authPending) {
              // No API key configured yet (a flush fired before initialize() applied the
              // key, or a stray pre-init client). Leave the event queued WITHOUT burning a
              // retry, and stop this drain — otherwise valid cold-start events (session_start,
              // $identify, $att_status, the first pageviews) would 401 and dead-letter for a
              // transient missing key. The flush timer retries once the key is set.
              debugLog(`Auth not ready; keeping event queued: ${queuedEvent.payload.eventName}`);
              await this.persistQueue();
              return;
            } else if (response.payloadTooLarge) {
              // 413: the server will never accept this body. Dead-letter NOW (no retry
              // budget, no replay) and say so unconditionally — a silently-parked
              // purchase is the worst outcome.
              const bytes = response.bodyBytes != null ? `${response.bodyBytes} bytes` : 'size unknown';
              errorLog(`Event '${queuedEvent.payload.eventName}' rejected by server as too large (HTTP 413, ${bytes}); moved to dead-letter permanently (will not be replayed)`);
              await this.deadLetter({ ...queuedEvent, permanent: true }, 'payload too large (HTTP 413)');
              this.removeFromQueue(queuedEvent);
              removedThisBatch++;
            } else {
              // Connectivity-class failures (httpClient surfaces them as success:false with
              // an error message after its internal retries) are NOT the event's fault —
              // keep it queued WITHOUT burning a retry; the timer / reconnect re-tries.
              if (this.isConnectivityError({ message: response.error } as Error)) {
                debugLog(`Connectivity failure; keeping event queued without burning retry: ${queuedEvent.payload?.eventName}`);
              } else {
                queuedEvent.retryCount++;
                if (queuedEvent.retryCount >= this.config.maxRetryCount) {
                  // Don't silently drop revenue/conversion events — park in a capped
                  // dead-letter store (errorLog + recoverable) then remove from the queue.
                  await this.deadLetter(queuedEvent);
                  this.removeFromQueue(queuedEvent);
                  removedThisBatch++;
                } else {
                  debugLog(`Event failed, will retry: ${queuedEvent.payload?.eventName} (attempt ${queuedEvent.retryCount})`);
                }
              }
            }
          } catch (error) {
            // Optional-chain the eventName — a corrupted entry must NOT throw from the
            // catch handler (that would abort the whole drain and jam the queue head).
            errorLog(`Error processing event: ${queuedEvent?.payload?.eventName}`, error as Error);
            // Don't burn the retry budget on a connectivity-class throw.
            if (this.isConnectivityError(error)) {
              debugLog(`Connectivity throw; keeping event queued without burning retry: ${queuedEvent?.payload?.eventName}`);
            } else {
              queuedEvent.retryCount = (queuedEvent.retryCount || 0) + 1;
              if (queuedEvent.retryCount >= this.config.maxRetryCount) {
                await this.deadLetter(queuedEvent);
                this.removeFromQueue(queuedEvent);
                removedThisBatch++;
              }
            }
          }
        }

        // Persist after each batch so a mid-drain kill doesn't resurrect delivered events.
        await this.persistQueue();

        // No forward progress this batch (every event failed-and-requeued, not yet at max
        // retries) → stop and let the timer / next reconnect retry. Avoids a tight loop.
        // Counting removals (not total length) ignores concurrent mid-batch enqueues.
        if (removedThisBatch === 0) break;
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
  private deadLetter(event: QueuedEvent, reason?: string): Promise<void> {
    return this.serialDeadLetter(() => this.deadLetterNow(event, reason));
  }

  private async deadLetterNow(event: QueuedEvent, reason?: string): Promise<void> {
    if (reason) {
      errorLog(`Event moved to dead-letter (${reason}): ${event.payload.eventName}`);
    } else {
      errorLog(`Event exceeded max retries (${this.config.maxRetryCount}); moved to dead-letter: ${event.payload.eventName}`);
    }
    try {
      const existing = (await Storage.getItem<QueuedEvent[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
      existing.push(event);
      const pushedOut = Math.max(0, existing.length - DEAD_LETTER_CAP);
      await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, existing.slice(-DEAD_LETTER_CAP));
      if (pushedOut > 0) {
        errorLog(`Dead-letter store full (max ${DEAD_LETTER_CAP}); ${pushedOut} oldest event(s) dropped`);
        await this.countDropped('dead_letter_full', pushedOut);
      }
    } catch (error) {
      errorLog('Failed to persist dead-letter event:', error as Error);
    }
  }

  /**
   * Back off after a temporary failure: exponential from TRANSIENT_BACKOFF_BASE_MS, with
   * jitter, capped at TRANSIENT_BACKOFF_MAX_MS; never sooner than the server's Retry-After
   * (itself capped at MAX_RETRY_AFTER_MS).
   */
  private scheduleBackoff(retryAfterMs?: number): void {
    this.consecutiveTransientFailures++;
    const exp = TRANSIENT_BACKOFF_BASE_MS * Math.pow(2, Math.min(this.consecutiveTransientFailures - 1, 16));
    // Jitter spreads phones out after a shared outage: the plain backoff lands anywhere
    // in 0.5x to 1.0x, and a Retry-After gets 0 to 25% added (never less than asked).
    const backoff = Math.min(exp, TRANSIENT_BACKOFF_MAX_MS) * (0.5 + Math.random() * 0.5);
    const serverWait = retryAfterMs != null && Number.isFinite(retryAfterMs)
      ? Math.min(Math.max(retryAfterMs, 0), MAX_RETRY_AFTER_MS) * (1 + Math.random() * 0.25)
      : 0;
    this.retryNotBefore = Date.now() + Math.max(backoff, serverWait);
  }

  /**
   * Count events the SDK gave up on, persisted across launches, by reason.
   */
  private countDropped(reason: DropReason, n: number = 1): Promise<void> {
    this.dropCountWrite = this.dropCountWrite.then(async () => {
      try {
        const stored = (await Storage.getItem<Partial<Record<DropReason, number>>>(STORAGE_KEYS.DROPPED_EVENT_COUNTS)) || {};
        const next = { ...stored, [reason]: (stored[reason] || 0) + n };
        this.droppedCounts = next;
        await Storage.setItem(STORAGE_KEYS.DROPPED_EVENT_COUNTS, next);
      } catch (error) {
        this.droppedCounts = { ...this.droppedCounts, [reason]: (this.droppedCounts[reason] || 0) + n };
        errorLog('Failed to persist dropped-event count:', error as Error);
      }
    });
    return this.dropCountWrite;
  }

  /**
   * Events the SDK gave up on since install, by reason (persisted).
   */
  async getDroppedCounts(): Promise<Partial<Record<DropReason, number>>> {
    await this.dropCountWrite;
    try {
      return (await Storage.getItem<Partial<Record<DropReason, number>>>(STORAGE_KEYS.DROPPED_EVENT_COUNTS)) || {};
    } catch {
      return { ...this.droppedCounts };
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
    if (this.destroyed) return;
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

    // If we just came online, replay any dead-lettered events (likely stranded BY the
    // outage we just recovered from) and then drain the queue.
    if (isOnline && !wasOnline) {
      // The network is back: the backoff was for the outage, not for the server.
      this.retryNotBefore = 0;
      this.consecutiveTransientFailures = 0;
      void this.replayDeadLetter().then(() => {
        if (this.isOnline && this.queue.length > 0) {
          this.processQueue();
        }
      });
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
    dropped: Partial<Record<DropReason, number>>;
    retryInMs: number;
  } {
    const oldestEvent = this.queue.length > 0 ? this.queue[0] : null;
    const oldestEventAge = oldestEvent ? Date.now() - oldestEvent.timestamp : null;

    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      isOnline: this.isOnline,
      oldestEventAge,
      dropped: { ...this.droppedCounts },
      retryInMs: Math.max(0, this.retryNotBefore - Date.now()),
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
    this.destroyed = true;
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