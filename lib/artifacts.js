/**
 * Artifact management: per-run directories under
 * <workspace>/.dsh-mineru/artifacts/, metadata writing, and HMAC-signed
 * capability URLs the Web host serves for preview/download.
 * @module dsh-mineru/artifacts
 */
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, stat, readdir, realpath } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** MIME map for artifact serving. */
export const MIME_MAP = Object.freeze({
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jp2': 'image/jp2',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xls': 'application/vnd.ms-excel',
  '.zip': 'application/zip',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
});

/** Inline-previewable kinds (everything else serves as attachment). */
const INLINE_KINDS = new Set(['.md', '.json', '.txt', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function mimeFor(name) {
  return MIME_MAP[extOf(name)] ?? 'application/octet-stream';
}

export function inlineable(name) {
  return INLINE_KINDS.has(extOf(name));
}

export class ArtifactError extends Error {
  constructor(message, code = 'ARTIFACT_ERROR') {
    super(message);
    this.name = 'ArtifactError';
    this.code = code;
  }
}

/** @param {string} value @returns {string} */
export function sanitizeRunName(value) {
  const v = String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return v || 'parse';
}

/** @param {string} value @returns {string} */
export function sanitizeFileName(value) {
  const v = String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!v || v === '.' || v === '..') throw new ArtifactError('invalid file name');
  return v;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/**
 * Artifact store rooted at <workspace>/.dsh-mineru.
 */
export class ArtifactManager {
  /**
   * @param {{rootDir: string, urlTtlSec?: number, pluginVersion?: string}} opts
   */
  constructor(opts) {
    this.rootDir = resolve(opts.rootDir);
    this.urlTtlSec = opts.urlTtlSec ?? 86400;
    this.pluginVersion = opts.pluginVersion ?? '0.1.0';
    this.secret = randomBytes(32);
  }

  async init() {
    await mkdir(join(this.rootDir, 'artifacts'), { recursive: true });
    await mkdir(join(this.rootDir, 'tmp'), { recursive: true });
  }

  /** @returns {string} tmp directory under the managed root */
  get tmpDir() { return join(this.rootDir, 'tmp'); }

  /**
   * Create a fresh run directory and return its paths.
   * @param {string} baseName sanitized base for the run name
   * @returns {Promise<{dir: string, relDir: string, runName: string}>}
   */
  async createRun(baseName) {
    await this.init();
    const safe = sanitizeRunName(baseName);
    const runName = safe + '_' + stamp() + '_' + randomBytes(2).toString('hex');
    const dir = join(this.rootDir, 'artifacts', runName);
    await mkdir(dir, { recursive: true });
    return { dir, relDir: join('artifacts', runName), runName };
  }

  /** rel path of an artifact inside its run dir. */
  relIn(relDir, fileName) {
    return join(relDir, fileName);
  }

  /**
   * @param {string} relPath forward-slash path relative to the managed root
   * @param {string} [expSec] explicit expiry override
   * @returns {string} base64url token: hmac(relPath + '.' + exp) + '.' + exp
   */
  capabilityToken(relPath, expSec) {
    const exp = expSec ?? (Math.floor(Date.now() / 1000) + this.urlTtlSec);
    const normalized = relPath.replace(/\\/g, '/');
    const mac = createHmac('sha256', this.secret).update(normalized + '.' + exp).digest('base64url');
    return mac + '.' + exp;
  }

  /**
   * Verify a capability token for a relative path.
   * @param {string} relPath
   * @param {string} token
   * @returns {{ok:boolean, expired?:boolean}}
   */
  verifyCapability(relPath, token) {
    if (typeof token !== 'string' || typeof relPath !== 'string') return { ok: false };
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return { ok: false };
    const mac = token.slice(0, dot);
    const exp = Number(token.slice(dot + 1));
    if (!Number.isFinite(exp)) return { ok: false };
    const normalized = relPath.replace(/\\/g, '/');
    const expected = createHmac('sha256', this.secret).update(normalized + '.' + exp).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    if (exp < Math.floor(Date.now() / 1000)) return { ok: true, expired: true };
    return { ok: true };
  }

  /**
   * Resolve and validate a relative artifact path for serving.
   * @param {string} relPath
   * @param {{maxBytes?: number}} [opts]
   * @returns {Promise<{abs: string, bytes: number, mime: string}>}
   */
  async resolveServe(relPath, opts = {}) {
    const normalized = String(relPath ?? '').replace(/\\/g, '/');
    if (!normalized || normalized.includes('..') || normalized.startsWith('/')) {
      throw new ArtifactError('invalid artifact path', 'ARTIFACT_BAD_PATH');
    }
    const abs = resolve(this.rootDir, normalized);
    const root = this.rootDir + sep;
    if (!abs.startsWith(root)) throw new ArtifactError('artifact path escapes managed root', 'ARTIFACT_BAD_PATH');
    let st;
    try { st = await stat(abs); } catch { throw new ArtifactError('artifact not found', 'ARTIFACT_NOT_FOUND'); }
    if (!st.isFile()) throw new ArtifactError('artifact is not a file', 'ARTIFACT_NOT_FOUND');
    if (opts.maxBytes && st.size > opts.maxBytes) throw new ArtifactError('artifact too large to serve', 'ARTIFACT_TOO_LARGE');
    return { abs, bytes: st.size, mime: mimeFor(basename(abs)) };
  }

  /**
   * Write a UTF-8 metadata/text file inside a run dir.
   * @returns {Promise<string>} absolute path
   */
  async writeFile(runDir, fileName, content) {
    const safe = sanitizeFileName(fileName);
    const abs = join(runDir, safe);
    await writeFile(abs, content, 'utf8');
    return abs;
  }

  /**
   * Build the artifact descriptor list for one run dir.
   * @param {string} relDir run dir relative to managed root
   * @param {{capabilityFor: (rel: string) => string}} [urls]
   * @returns {Promise<object[]>}
   */
  async describeRun(relDir, urls) {
    const dir = join(this.rootDir, relDir);
    const names = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of names) {
      if (!entry.isFile()) continue;
      const rel = join(relDir, entry.name);
      const abs = join(dir, entry.name);
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      // capabilityFor may be async (the Web urlBuilder is) and may throw when
      // the HTTP host is unavailable; a preview URL is optional metadata and
      // must never fail or pollute the canonical result with a non-JSON value.
      let url;
      try {
        url = urls ? await urls.capabilityFor(rel.replace(/\\/g, '/')) : undefined;
      } catch {
        url = undefined;
      }
      out.push({
        name: entry.name,
        path: abs,
        rel: rel.replace(/\\/g, '/'),
        kind: kindFor(entry.name),
        mime: mimeFor(entry.name),
        bytes: st.size,
        ...(url !== undefined ? { url } : {}),
      });
    }
    return out;
  }
}

/** @param {string} name @returns {string} artifact kind label */
export function kindFor(name) {
  const lower = name.toLowerCase();
  if (lower === 'full.md' || lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.zip')) return 'zip';
  if (/.(png|jpe?g|jp2|webp|gif|bmp)$/.test(lower)) return 'image';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.tex') || lower.endsWith('.latex')) return 'latex';
  return 'other';
}/**
 * Workspace-keyed artifact stores: one ArtifactManager per canonical session
 * workspace, shared between tool execution (writing + capability URLs) and the
 * Web host (serving + verification).
 */
export class WorkspaceArtifactStore {
  /**
   * @param {{artifactRootName: string, urlTtlSec?: number, pluginVersion?: string}} opts
   */
  constructor(opts) {
    this.artifactRootName = opts.artifactRootName;
    this.urlTtlSec = opts.urlTtlSec ?? 86400;
    this.pluginVersion = opts.pluginVersion ?? '0.1.0';
    /** @type {Map<string, ArtifactManager>} */
    this.managers = new Map();
  }

  /**
   * @param {string} cwd session workspace
   * @returns {Promise<ArtifactManager>}
   */
  async managerFor(cwd) {
    let canon;
    try { canon = await realpath(resolve(cwd)); } catch { canon = resolve(cwd); }
    let m = this.managers.get(canon);
    if (!m) {
      m = new ArtifactManager({
        rootDir: join(canon, this.artifactRootName),
        urlTtlSec: this.urlTtlSec,
        pluginVersion: this.pluginVersion,
      });
      await m.init();
      this.managers.set(canon, m);
    }
    return m;
  }

  /** @returns {ArtifactManager[]} */
  list() { return [...this.managers.values()]; }

  /** @param {number} index @returns {ArtifactManager|null} */
  managerByIndex(index) {
    const all = this.list();
    const i = Number(index);
    return Number.isInteger(i) && i >= 0 && i < all.length ? all[i] : null;
  }

  /**
   * @param {string} cwd session workspace
   * @returns {Promise<number>} workspace index (stable while the map is unchanged)
   */
  async indexFor(cwd) {
    const m = await this.managerFor(cwd);
    return this.list().indexOf(m);
  }

  /**
   * Build a capability URL for one artifact relative path.
   * @param {string} cwd session workspace
   * @param {string} rel relative path inside the managed root
   * @returns {Promise<string>}
   */
  async capabilityUrl(cwd, rel) {
    const idx = await this.indexFor(cwd);
    const m = this.managerByIndex(idx);
    const normalized = rel.replace(/\\/g, '/');
    const token = m.capabilityToken(idx + '|' + normalized);
    return '/plugin/mineru/artifact?w=' + idx + '&p=' + encodeURIComponent(normalized) + '&t=' + encodeURIComponent(token);
  }
}