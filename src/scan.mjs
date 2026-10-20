import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as deploy from './rules/deploy.mjs';
import * as secrets from './rules/secrets.mjs';
import * as sourcemaps from './rules/sourcemaps.mjs';
import * as ai from './rules/ai.mjs';
import * as backend from './rules/backend.mjs';
import * as electron from './rules/electron.mjs';
import * as mobile from './rules/mobile.mjs';

// Each rule module may export start(ctx), onDir(dir, ctx), onFile(file, ctx) and finish(ctx).
const RULES = [deploy, secrets, sourcemaps, ai, backend, electron, mobile];

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
// Folders whose contents end up on a public server or inside the shipped app.
export const SHIPPED = /(^|\/)(dist|build|out|public|www|static|\.svelte-kit\/output\/client)\//;
// Generated build output: --fix may change it because the next build recreates it.
export const BUILD_OUTPUT = /(^|\/)(dist|build|out|\.next|\.output|\.svelte-kit\/output)\//;

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', '.cache', 'coverage', 'Pods', '.gradle', '.dart_tool']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro',
  '.html', '.htm', '.css', '.json', '.map', '.txt', '.yml', '.yaml', '.toml', '.sql', '.rules', '.xml',
  '.plist', '.entitlements', '.gradle', '.kts', '.conf', '.py', '.go', '.rs', '.rb', '.php', '.sh']);
const TEXT_NAMES = new Set(['_headers']);
const MAX_BYTES = 15 * 1024 * 1024; // ponytail: bigger files are not read; stream them if real bundles exceed this

export function scan(root) {
  const findings = [];
  const seen = new Set();
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch {}
  let isGit = false;
  try { execFileSync('git', ['rev-parse'], { cwd: root, stdio: 'ignore' }); isGit = true; } catch {}
  let ignore = [];
  try {
    ignore = readFileSync(join(root, '.reaproofignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {}

  const ctx = {
    root, pkg, isGit,
    deps: { ...pkg.dependencies, ...pkg.devDependencies },
    add(finding) {
      const key = `${finding.file}|${finding.title}`;
      if (seen.has(key) || ignore.some((prefix) => finding.file.startsWith(prefix))) return;
      seen.add(key);
      findings.push({ line: 0, ...finding });
    },
  };
  let scanned = 0;

  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      const rel = relative(root, abs).split(sep).join('/');
      const shipped = SHIPPED.test(rel);
      if (ent.isDirectory()) {
        for (const rule of RULES) rule.onDir?.({ rel, name: ent.name, shipped }, ctx);
        if (!SKIP_DIRS.has(ent.name) && rel !== '.next/cache') walk(abs);
        continue;
      }
      if (!ent.isFile() || SKIP_FILES.has(ent.name)) continue;
      const ext = extname(ent.name);
      const size = statSync(abs).size;
      const file = { abs, rel, name: ent.name, ext, size, shipped, output: BUILD_OUTPUT.test(rel), text: null };
      if ((TEXT_EXT.has(ext) || TEXT_NAMES.has(ent.name) || ent.name.startsWith('.env')) && size <= MAX_BYTES) {
        file.text = readFileSync(abs, 'utf8');
        scanned++;
      }
      file.line = (index) => file.text.slice(0, index).split('\n').length;
      for (const rule of RULES) rule.onFile?.(file, ctx);
    }
  };

  for (const rule of RULES) rule.start?.(ctx);
  walk(root);
  for (const rule of RULES) rule.finish?.(ctx);

  findings.sort((a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) || a.file.localeCompare(b.file));
  return { findings, scanned };
}

// Resets a global regex and returns its first match.
export function first(re, text) {
  re.lastIndex = 0;
  return re.exec(text);
}
