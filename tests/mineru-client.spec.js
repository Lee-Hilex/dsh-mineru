import { describe, it, expect } from 'vitest';
import { DailyCounter, MineruError, RateLimiter, effectiveModelFor, resolveOptions } from '../lib/mineru-client.js';

describe('RateLimiter', () => {
  it('lets capacity tokens through immediately and blocks the rest', async () => {
    const limiter = new RateLimiter(60000, { burst: 3 });
    const t0 = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // the fourth token must wait ~1ms for a refill at 60000/min = 1 token/ms
    await limiter.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(0);
    expect(limiter.tokens).toBeLessThanOrEqual(limiter.capacity);
  });

  it('refills up to capacity only', () => {
    const limiter = new RateLimiter(60000, { burst: 2 });
    limiter.tokens = 0;
    limiter.updatedAt = Date.now() - 3600_000; // one hour ago
    limiter.refill();
    expect(limiter.tokens).toBe(limiter.capacity);
  });

  it('honors an aborted signal', async () => {
    const limiter = new RateLimiter(60, { burst: 1 }); // 1 token per second
    await limiter.acquire();
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('DailyCounter', () => {
  it('throws MINERU_DAILY_LIMIT when the cap is exceeded', () => {
    const counter = new DailyCounter(2);
    counter.add(2);
    let caught = null;
    try {
      counter.add(1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MineruError);
    expect(caught.code).toBe('MINERU_DAILY_LIMIT');
  });

  it('resets the count when the UTC day rolls over', () => {
    const counter = new DailyCounter(1);
    counter.day = '2026-09-12';
    counter.count = 1;
    counter.add(1); // new day starts from zero
    expect(counter.count).toBe(1);
  });
});

describe('resolveOptions', () => {
  const cfg = {
    language: 'ch',
    enableTable: true,
    enableFormula: false,
    isOcr: false,
    modelVersion: 'vlm',
    timeoutMs: 600000,
    pollIntervalMs: 2000,
    pollJitterMs: 0,
    extraFormats: [],
  };

  it('falls back to config defaults', () => {
    const opts = resolveOptions(cfg, {});
    expect(opts.language).toBe('ch');
    expect(opts.modelVersion).toBe('vlm');
    expect(opts.enableTable).toBe(true);
    expect(opts.enableFormula).toBe(false);
    expect(opts.timeoutMs).toBe(600000);
  });

  it('prefers per-call arguments over config', () => {
    const opts = resolveOptions(cfg, { language: 'en', enableFormula: true, timeoutMs: 1234 });
    expect(opts.language).toBe('en');
    expect(opts.enableFormula).toBe(true);
    expect(opts.timeoutMs).toBe(1234);
  });

  it('rejects unknown model versions', () => {
    expect(() => resolveOptions(cfg, { modelVersion: 'gpt-4o' })).toThrowError(MineruError);
  });

  it('sanitizes dataId values to a safe slug', () => {
    const opts = resolveOptions(cfg, { dataId: '../evil/name with spaces.txt' });
    expect(opts.dataId).toBe('.._evil_name_with_spaces.txt');
  });
});

describe('effectiveModelFor', () => {
  it('force-pins HTML files to MinerU-HTML', () => {
    expect(effectiveModelFor('.html', 'vlm')).toEqual({ modelVersion: 'MinerU-HTML', forced: true });
    expect(effectiveModelFor('.htm', 'pipeline')).toEqual({ modelVersion: 'MinerU-HTML', forced: true });
  });

  it('leaves non-HTML files and explicit MinerU-HTML untouched', () => {
    expect(effectiveModelFor('.pdf', 'vlm')).toEqual({ modelVersion: 'vlm', forced: false });
    expect(effectiveModelFor('.html', 'MinerU-HTML')).toEqual({ modelVersion: 'MinerU-HTML', forced: false });
  });
});
