// DEP-01 — options that are accepted and then ignored must say so at runtime.
//
// A @deprecated JSDoc tag only shows in an editor. Several of these also read
// like working aliases ("Use `endpoint` instead") when nothing reads them at
// all — verified: apiUrl, maxEventQueueSize, autoEvents, retryConfig and
// respectDoNotTrack have ZERO reads outside types.ts.

export {};

/**
 * The warning latches once per process by design — a developer needs to see it,
 * not be spammed on every init. That makes a plain top-level import unusable
 * here: the first test to trigger it would silence the rest. Re-require the
 * module per test so each gets a fresh latch.
 */
function freshWarn(): (config: Record<string, any>) => void {
  let fn!: (config: Record<string, any>) => void;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fn = require('../src/utils').warnAboutIgnoredOptions;
  });
  return fn;
}

describe('DEP-01 — ignored config options warn at runtime', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('says nothing for a config that uses only real options', () => {
    freshWarn()({ apiKey: 'k', maxQueueSize: 100, maxRetries: 3 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('names each ignored option rather than warning generically', () => {
    freshWarn()({ apiKey: 'k', apiUrl: 'https://x', retryConfig: { maxRetries: 1, retryDelay: 1 } });
    const msg = warn.mock.calls[0]?.[0] ?? '';
    expect(msg).toContain('apiUrl');
    expect(msg).toContain('retryConfig');
  });

  it('is explicit that respectDoNotTrack does not limit collection', () => {
    // The one that could actually mislead someone about a privacy guarantee.
    freshWarn()({ apiKey: 'k', respectDoNotTrack: false });
    expect(warn.mock.calls[0]?.[0]).toContain('collection is NOT limited');
  });

  it('flags endpoint when it is silently discarded', () => {
    // endpoint IS read — but only with useServerTracking: false. Otherwise
    // http-client hardcodes the ingest URL and the value vanishes.
    freshWarn()({ apiKey: 'k', endpoint: 'https://self-hosted' });
    expect(warn.mock.calls[0]?.[0]).toContain('useServerTracking: false');
  });

  it('does not flag endpoint when it is actually honoured', () => {
    freshWarn()({ apiKey: 'k', endpoint: 'https://self-hosted', useServerTracking: false });
    expect(warn).not.toHaveBeenCalled();
  });
});
