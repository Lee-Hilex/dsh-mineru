import { describe, it, expect, vi } from 'vitest';
import { createFallbackLookup, isLoopbackAddress } from '../lib/dns-resolve.js';

/** A system lookup stub that always answers with the given addresses. */
const systemAnswering = (addresses) => (hostname, options, callback) => callback(null, addresses);

/** A public-resolver stub; records calls so caching is observable. */
const publicAnswering = (addresses) => {
  const resolve = vi.fn(async () => addresses);
  return resolve;
};

/** Promise wrapper for the callback-style lookup. */
const lookupAsync = (lookup, hostname, options = {}) => new Promise((resolve, reject) => {
  lookup(hostname, options, (error, address, family) => {
    if (error) reject(error);
    else resolve({ address, family });
  });
});

describe('isLoopbackAddress', () => {
  it('treats loopback and unspecified addresses as unusable', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.9.9.9')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::')).toBe(true);
    expect(isLoopbackAddress('0.0.0.0')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('keeps ordinary public addresses', () => {
    expect(isLoopbackAddress('36.170.26.130')).toBe(false);
    expect(isLoopbackAddress('2409:8c50:a00:208c:103::c')).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe('createFallbackLookup', () => {
  it('trusts a usable system answer and never asks the public resolvers', async () => {
    const resolve = publicAnswering([{ address: '36.170.26.130', family: 4 }]);
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '1.2.3.4', family: 4 }]),
      resolve,
    });
    await expect(lookupAsync(lookup, 'cdn.example.test')).resolves.toEqual({ address: '1.2.3.4', family: 4 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('falls back to the public resolvers when the system answers with loopback', async () => {
    const resolve = publicAnswering([{ address: '36.170.26.130', family: 4 }]);
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]),
      resolve,
    });
    await expect(lookupAsync(lookup, 'cdn.example.test')).resolves.toEqual({ address: '36.170.26.130', family: 4 });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('caches a fallback answer per host', async () => {
    const resolve = publicAnswering([{ address: '36.170.26.130', family: 4 }]);
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '127.0.0.1', family: 4 }]),
      resolve,
    });
    await lookupAsync(lookup, 'cdn.example.test');
    await lookupAsync(lookup, 'cdn.example.test');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('answers the all:true shape undici and autoSelectFamily ask for', async () => {
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '::1', family: 6 }]),
      resolve: publicAnswering([
        { address: '36.170.26.130', family: 4 },
        { address: '2409:8c50:a00:208c:103::c', family: 6 },
      ]),
    });
    const addresses = await new Promise((resolve, reject) => {
      lookup('cdn.example.test', { all: true }, (error, list) => (error ? reject(error) : resolve(list)));
    });
    expect(addresses).toEqual([
      { address: '36.170.26.130', family: 4 },
      { address: '2409:8c50:a00:208c:103::c', family: 6 },
    ]);
  });

  it('honours a requested address family, falling back to the other one', async () => {
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '127.0.0.1', family: 4 }]),
      resolve: publicAnswering([{ address: '36.170.26.130', family: 4 }]),
    });
    await expect(lookupAsync(lookup, 'cdn.example.test', { family: 4 }))
      .resolves.toEqual({ address: '36.170.26.130', family: 4 });
    await expect(lookupAsync(lookup, 'cdn.example.test', { family: 6 }))
      .resolves.toEqual({ address: '36.170.26.130', family: 4 });
  });

  it('reports the original error when neither resolver yields an address', async () => {
    const lookup = createFallbackLookup({
      systemLookup: (hostname, options, callback) => callback(new Error('ENOTFOUND'), []),
      resolve: async () => [],
    });
    await expect(lookupAsync(lookup, 'cdn.example.test')).rejects.toThrow('ENOTFOUND');
  });

  it('reports a public-resolver failure with a readable message', async () => {
    const lookup = createFallbackLookup({
      systemLookup: systemAnswering([{ address: '127.0.0.1', family: 4 }]),
      resolve: async () => {
        throw new Error('public resolvers returned no usable address for cdn.example.test');
      },
    });
    await expect(lookupAsync(lookup, 'cdn.example.test')).rejects.toThrow('no usable address');
  });
});
