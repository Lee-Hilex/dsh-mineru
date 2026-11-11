/**
 * DNS resolution with a public-resolver fallback.
 *
 * Campus and ISP DNS servers sometimes answer public CDN hostnames with a
 * loopback address (captive-DNS / filtering behaviour). When that happens the
 * MinerU API is reachable but the result CDN is not, and the download step
 * fails with a bare `fetch failed`. This module builds a `lookup` callback for
 * `node:http(s)` that keeps trusting the system resolver unless it returns no
 * usable address, and only then asks ordinary public resolvers over UDP 53 —
 * no DNS-over-HTTPS dependency, no proxy, no hosts-file edit.
 *
 * The callback follows the `net.connect` contract: it answers
 * `(err, address, family)` by default and `(err, [{ address, family }])` when
 * `options.all` is set (undici and Node's autoSelectFamily ask that way).
 * @module dsh-mineru/dns-resolve
 */
import { lookup as systemLookup } from 'node:dns';
import { Resolver } from 'node:dns/promises';

/** Public resolvers used only when the system resolver yields nothing usable. */
const DEFAULT_SERVERS = ['223.5.5.5', '119.29.29.29'];
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Whether an address is unusable for reaching a public host.
 * Loopback and unspecified addresses mean a filtered or captive resolver,
 * never a real destination for a remote CDN.
 * @param {unknown} address
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  const value = String(address ?? '').toLowerCase();
  if (value === '::1' || value === '::' || value === '0.0.0.0') return true;
  if (value.startsWith('127.')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isLoopbackAddress(mapped[1]);
  return false;
}

/**
 * Resolve a hostname through explicit public resolvers.
 * @param {string[]} servers
 * @param {number} timeoutMs
 * @returns {(hostname: string) => Promise<{address: string, family: number}[]>}
 */
export function createPublicResolve(servers = DEFAULT_SERVERS, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  resolver.setServers(servers);
  return async function resolve(hostname) {
    const [v4, v6] = await Promise.all([
      resolver.resolve4(hostname).catch(() => []),
      resolver.resolve6(hostname).catch(() => []),
    ]);
    const addresses = [
      ...v4.map((address) => ({ address, family: 4 })),
      ...v6.map((address) => ({ address, family: 6 })),
    ].filter((entry) => !isLoopbackAddress(entry.address));
    if (addresses.length === 0) {
      throw new Error('public resolvers returned no usable address for ' + hostname);
    }
    return addresses;
  };
}

/**
 * Build a `lookup` callback that falls back to public resolvers.
 *
 * Results are cached per hostname for `ttlMs`, so a download loop resolves
 * once. Every injectable seam exists for tests: `systemLookup` and `resolve`.
 * @param {object} [options]
 * @param {string[]} [options.servers] public resolvers to ask on fallback
 * @param {number} [options.ttlMs] fallback-answer cache lifetime
 * @param {number} [options.timeoutMs] per-query timeout for the public resolvers
 * @param {Function} [options.systemLookup] `node:dns` lookup replacement
 * @param {(hostname: string) => Promise<{address: string, family: number}[]>} [options.resolve]
 * @returns {(hostname: string, options: object|Function, callback?: Function) => void}
 */
export function createFallbackLookup(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const system = options.systemLookup ?? systemLookup;
  const resolve = options.resolve ?? createPublicResolve(
    options.servers ?? DEFAULT_SERVERS,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  /** @type {Map<string, {addresses: {address: string, family: number}[], expires: number}>} */
  const cache = new Map();

  return function lookup(hostname, opts, callback) {
    const query = typeof opts === 'function' ? {} : (opts ?? {});
    const done = typeof opts === 'function' ? opts : callback;

    /** @param {{address: string, family: number}[]} addresses @param {Error|null} [fallbackError] */
    const deliver = (addresses, fallbackError) => {
      if (addresses.length === 0) {
        done(fallbackError ?? new Error('no usable address for ' + hostname));
        return;
      }
      const wanted = query.family === 6 ? 6 : query.family === 4 ? 4 : 0;
      const matching = wanted ? addresses.filter((entry) => entry.family === wanted) : addresses;
      const list = matching.length > 0 ? matching : addresses;
      if (query.all) {
        done(null, list);
        return;
      }
      done(null, list[0].address, list[0].family);
    };

    const cached = cache.get(hostname);
    if (cached && cached.expires > Date.now()) {
      deliver(cached.addresses);
      return;
    }
    if (cached) cache.delete(hostname);

    system(hostname, { ...query, all: true }, (error, list) => {
      const usable = (list ?? []).filter((entry) => !isLoopbackAddress(entry.address));
      if (usable.length > 0) {
        deliver(usable);
        return;
      }
      resolve(hostname).then(
        (addresses) => {
          if (addresses.length === 0) {
            deliver([], error);
            return;
          }
          cache.set(hostname, { addresses, expires: Date.now() + ttlMs });
          deliver(addresses);
        },
        (resolveError) => deliver([], error ?? resolveError),
      );
    });
  };
}
