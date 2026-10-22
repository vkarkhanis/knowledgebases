#!/usr/bin/env node
/**
 * Traxettle knowledgebase staleness checker.
 *
 * Each document in MANIFEST.json declares the source files it describes. This script
 * fingerprints those files and compares the result with the digest pinned in the manifest.
 * A changed digest means the document may no longer describe reality.
 *
 *   node check-staleness.mjs                 # report; exit 1 if anything is stale
 *   node check-staleness.mjs --verbose       # also list the individual changed files
 *   node check-staleness.mjs --json          # machine-readable report
 *   node check-staleness.mjs --doc 02-architecture/02-api-reference.md    # one document
 *   node check-staleness.mjs --update        # re-pin digests AFTER updating the docs
 *   node check-staleness.mjs --init          # pin digests for the first time
 *
 * Exit codes: 0 fresh · 1 stale · 2 configuration/IO error
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const KB_ROOT = resolve(HERE, '..', '..', '..', '..');
const MANIFEST_PATH = join(KB_ROOT, 'MANIFEST.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const OPT = {
  verbose: has('--verbose') || has('-v'),
  json: has('--json'),
  update: has('--update'),
  init: has('--init'),
  doc: valueOf('--doc'),
};

// ── colours (suppressed when piping or in --json mode) ────────────────────
const tty = process.stdout.isTTY && !OPT.json;
const C = {
  reset: tty ? '\x1b[0m' : '', bold: tty ? '\x1b[1m' : '', dim: tty ? '\x1b[2m' : '',
  red: tty ? '\x1b[31m' : '', green: tty ? '\x1b[32m' : '',
  yellow: tty ? '\x1b[33m' : '', cyan: tty ? '\x1b[36m' : '',
};

function die(msg) {
  process.stderr.write(`${C.red}error${C.reset} ${msg}\n`);
  process.exit(2);
}

// ── manifest ──────────────────────────────────────────────────────────────
if (!existsSync(MANIFEST_PATH)) die(`MANIFEST.json not found at ${MANIFEST_PATH}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
  die(`MANIFEST.json is not valid JSON: ${e.message}`);
}

const REPO_ROOT = resolve(KB_ROOT, manifest.repo.rootRelativeToKb || '.');
if (!existsSync(REPO_ROOT)) {
  die(`repo root does not exist: ${REPO_ROOT}\n` +
      `      Fix "repo.rootRelativeToKb" in MANIFEST.json.`);
}

// ── glob expansion (supports **, *, and literal paths) ────────────────────
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.expo', 'coverage',
  'rush-logs', 'artifacts', 'Pods', 'playwright-report', 'test-results',
  'common/temp', '.firebase',
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function globToRegExp(pattern) {
  // Escape regex metacharacters, then re-introduce glob semantics.
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*\*\//g, '\u0000SLASHSTAR\u0000');
  re = re.replace(/\*\*/g, '\u0000STARSTAR\u0000');
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/\?/g, '[^/]');
  re = re.replace(/\u0000SLASHSTAR\u0000/g, '(?:.*/)?');
  re = re.replace(/\u0000STARSTAR\u0000/g, '.*');
  // Brace expansion: {a,b}
  re = re.replace(/\{([^}]+)\}/g, (_, g) => `(?:${g.split(',').join('|')})`);
  return new RegExp(`^${re}$`);
}

let allFilesCache = null;
function allRepoFiles() {
  if (!allFilesCache) {
    allFilesCache = walk(REPO_ROOT).map((f) => relative(REPO_ROOT, f).split(sep).join('/'));
    allFilesCache.sort();
  }
  return allFilesCache;
}

function expand(pattern) {
  if (!/[*?{]/.test(pattern)) {
    const abs = join(REPO_ROOT, pattern);
    if (!existsSync(abs)) return { files: [], missing: [pattern] };
    if (statSync(abs).isDirectory()) {
      return {
        files: walk(abs).map((f) => relative(REPO_ROOT, f).split(sep).join('/')).sort(),
        missing: [],
      };
    }
    return { files: [pattern], missing: [] };
  }
  const re = globToRegExp(pattern);
  const files = allRepoFiles().filter((f) => re.test(f));
  return { files, missing: files.length === 0 ? [pattern] : [] };
}

// ── fingerprinting ────────────────────────────────────────────────────────
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function fileHash(rel) {
  try {
    return sha256(readFileSync(join(REPO_ROOT, rel)));
  } catch {
    return 'MISSING';
  }
}

/** Digest over the sorted set of `path:contenthash` pairs. */
function digestFor(sources) {
  const files = [];
  const missing = [];
  for (const pattern of sources) {
    const { files: f, missing: m } = expand(pattern);
    files.push(...f);
    missing.push(...m);
  }
  const unique = [...new Set(files)].sort();
  const per = unique.map((rel) => ({ path: rel, hash: fileHash(rel) }));
  const digest = sha256(per.map((p) => `${p.path}:${p.hash}`).join('\n'));
  return { digest, files: per, missing: [...new Set(missing)] };
}

// ── git context ───────────────────────────────────────────────────────────
function git(...args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const gitNow = {
  commit: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  committedAt: git('log', '-1', '--format=%cI'),
  dirty: (git('status', '--porcelain') || '') !== '',
};

// ── evaluate ──────────────────────────────────────────────────────────────
const docEntries = Object.entries(manifest.documents || {});
if (docEntries.length === 0) die('MANIFEST.json has no "documents"');

const selected = OPT.doc
  ? docEntries.filter(([d]) => d === OPT.doc || d.endsWith(OPT.doc))
  : docEntries;

if (selected.length === 0) die(`no document in the manifest matches "${OPT.doc}"`);

const results = [];
for (const [doc, entry] of selected) {
  const docPath = join(KB_ROOT, doc);
  const docExists = existsSync(docPath);
  const { digest, files, missing } = digestFor(entry.sources || []);
  const pinned = entry.digest || null;
  const stale = pinned !== null && pinned !== digest;

  let changedFiles = [];
  if (stale && entry.fileHashes) {
    const before = entry.fileHashes;
    const after = Object.fromEntries(files.map((f) => [f.path, f.hash]));
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const k of keys) {
      if (before[k] === after[k]) continue;
      if (!(k in before)) changedFiles.push({ path: k, change: 'added' });
      else if (!(k in after)) changedFiles.push({ path: k, change: 'removed' });
      else changedFiles.push({ path: k, change: 'modified' });
    }
  }

  results.push({
    doc, docExists, pinned, digest, stale,
    unpinned: pinned === null,
    sourceCount: files.length,
    missingPatterns: missing,
    changedFiles,
    criticality: entry.criticality || 'normal',
    note: entry.note,
    files,
  });
}

// ── re-pin ────────────────────────────────────────────────────────────────
if (OPT.update || OPT.init) {
  for (const r of results) {
    const entry = manifest.documents[r.doc];
    if (OPT.init && entry.digest) continue;   // --init only fills blanks
    entry.digest = r.digest;
    entry.fileHashes = Object.fromEntries(r.files.map((f) => [f.path, f.hash]));
    entry.pinnedAt = new Date().toISOString();
  }
  manifest.repo.pinnedCommit = gitNow.commit || manifest.repo.pinnedCommit;
  manifest.repo.pinnedBranch = gitNow.branch || manifest.repo.pinnedBranch;
  manifest.repo.pinnedCommittedAt = gitNow.committedAt || manifest.repo.pinnedCommittedAt;
  manifest.lastVerifiedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const verb = OPT.init ? 'initialised' : 'updated';
  process.stdout.write(
    `${C.green}✔${C.reset} ${verb} digests for ${results.length} document(s) ` +
    `at ${gitNow.commit ? gitNow.commit.slice(0, 7) : 'unknown commit'}\n`,
  );
  process.exit(0);
}

// ── report ────────────────────────────────────────────────────────────────
const stale = results.filter((r) => r.stale);
const unpinned = results.filter((r) => r.unpinned);
const missingDocs = results.filter((r) => !r.docExists);
const missingSources = results.filter((r) => r.missingPatterns.length > 0);

if (OPT.json) {
  process.stdout.write(`${JSON.stringify({
    kbRoot: KB_ROOT,
    repoRoot: REPO_ROOT,
    pinned: {
      commit: manifest.repo.pinnedCommit,
      branch: manifest.repo.pinnedBranch,
      at: manifest.repo.pinnedCommittedAt,
    },
    current: gitNow,
    fresh: stale.length === 0,
    summary: {
      total: results.length,
      stale: stale.length,
      unpinned: unpinned.length,
      missingDocs: missingDocs.length,
      missingSourcePatterns: missingSources.length,
    },
    documents: results.map(({ files, ...rest }) => rest),
  }, null, 2)}\n`);
  process.exit(stale.length > 0 ? 1 : 0);
}

const line = '─'.repeat(74);
process.stdout.write(`\n${C.bold}Traxettle knowledgebase — staleness check${C.reset}\n${line}\n`);
process.stdout.write(`KB    ${C.dim}${KB_ROOT}${C.reset}\n`);
process.stdout.write(`repo  ${C.dim}${REPO_ROOT}${C.reset}\n`);
process.stdout.write(
  `pinned  ${manifest.repo.pinnedBranch || '?'} @ ` +
  `${(manifest.repo.pinnedCommit || '?').slice(0, 7)}  ${C.dim}${manifest.repo.pinnedCommittedAt || ''}${C.reset}\n`,
);
process.stdout.write(
  `current ${gitNow.branch || '?'} @ ${(gitNow.commit || '?').slice(0, 7)}` +
  `${gitNow.dirty ? `  ${C.yellow}(working tree dirty)${C.reset}` : ''}\n${line}\n`,
);

if (missingDocs.length > 0) {
  process.stdout.write(`\n${C.red}Missing knowledgebase documents${C.reset}\n`);
  for (const r of missingDocs) process.stdout.write(`  ✗ ${r.doc}\n`);
}

if (missingSources.length > 0) {
  process.stdout.write(`\n${C.yellow}Source patterns matching nothing${C.reset} ${C.dim}(renamed or deleted?)${C.reset}\n`);
  for (const r of missingSources) {
    process.stdout.write(`  ${r.doc}\n`);
    for (const p of r.missingPatterns) process.stdout.write(`      ${C.dim}${p}${C.reset}\n`);
  }
}

if (unpinned.length > 0) {
  process.stdout.write(`\n${C.yellow}Not yet pinned${C.reset} ${C.dim}(run with --init)${C.reset}\n`);
  for (const r of unpinned) process.stdout.write(`  ? ${r.doc}\n`);
}

if (stale.length === 0) {
  process.stdout.write(`\n${C.green}✔ All ${results.length} document(s) are up to date.${C.reset}\n\n`);
  process.exit(0);
}

const order = { critical: 0, high: 1, normal: 2, low: 3 };
stale.sort((a, b) => (order[a.criticality] ?? 2) - (order[b.criticality] ?? 2));

process.stdout.write(`\n${C.red}${C.bold}${stale.length} document(s) may be stale${C.reset}\n\n`);
for (const r of stale) {
  const tag = r.criticality === 'critical' ? `${C.red}[critical]${C.reset}`
    : r.criticality === 'high' ? `${C.yellow}[high]${C.reset}`
      : `${C.dim}[${r.criticality}]${C.reset}`;
  process.stdout.write(`  ${C.bold}${r.doc}${C.reset} ${tag}\n`);
  if (r.note) process.stdout.write(`      ${C.dim}${r.note}${C.reset}\n`);
  const show = OPT.verbose ? r.changedFiles : r.changedFiles.slice(0, 6);
  for (const c of show) {
    const mark = c.change === 'added' ? '+' : c.change === 'removed' ? '-' : '~';
    process.stdout.write(`      ${mark} ${c.path}\n`);
  }
  const hidden = r.changedFiles.length - show.length;
  if (hidden > 0) {
    process.stdout.write(`      ${C.dim}… ${hidden} more (use --verbose)${C.reset}\n`);
  }
  if (r.changedFiles.length === 0) {
    process.stdout.write(`      ${C.dim}digest changed (no per-file baseline pinned)${C.reset}\n`);
  }
  process.stdout.write('\n');
}

process.stdout.write(`${line}\nNext:\n`);
process.stdout.write(`  1. review each stale document against its changed sources\n`);
process.stdout.write(`  2. update the document(s)\n`);
process.stdout.write(`  3. re-pin:  node ${relative(process.cwd(), fileURLToPath(import.meta.url))} --update\n`);
process.stdout.write(`${C.dim}  (or invoke the traxettle-kb-refresh skill)${C.reset}\n\n`);

process.exit(1);
