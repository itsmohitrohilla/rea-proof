#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, SEVERITIES } from '../src/scan.mjs';
import { applyFixes } from '../src/fix.mjs';

const HELP = `rea-proof: find what your app gives away before you ship it.

Usage:
  rea-proof [dir]          scan a project and its build output (default: .)
  rea-proof [dir] --fix    also clean build output: delete .map/.env/backup files,
                           strip sourceMappingURL comments, git-ignore .env files
  rea-proof [dir] --json   machine-readable output
  rea-proof init [dir]     add a GitHub Action and a postbuild check to a project

Exits 1 when any critical or high finding remains, so it can gate CI and deploys.
Silence a false positive by adding its path prefix to .reaproofignore.`;

const TEMPLATE = fileURLToPath(new URL('../templates/github-action.yml', import.meta.url));
const POSTBUILD = 'npx -y rea-proof . --fix';

function init(root) {
  const workflow = join(root, '.github', 'workflows', 'rea-proof.yml');
  if (existsSync(workflow)) {
    console.log(`exists   ${workflow}`);
  } else {
    mkdirSync(dirname(workflow), { recursive: true });
    copyFileSync(TEMPLATE, workflow);
    console.log(`created  ${workflow}`);
  }
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.scripts?.build && !pkg.scripts.postbuild) {
    pkg.scripts.postbuild = POSTBUILD;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`added    "postbuild": "${POSTBUILD}" to package.json`);
  } else {
    console.log(`skipped  postbuild (no build script, or one already exists). Add it yourself: "postbuild": "${POSTBUILD}"`);
  }
}

function report(root, { findings, scanned }) {
  const tty = process.stdout.isTTY;
  const color = { critical: '\x1b[41;97m', high: '\x1b[31m', medium: '\x1b[33m', low: '\x1b[36m' };
  const paint = (sev) => (tty ? `${color[sev]}${sev.toUpperCase().padEnd(8)}\x1b[0m` : sev.toUpperCase().padEnd(8));
  console.log(`rea-proof: scanned ${scanned} files in ${root}\n`);
  for (const f of findings) {
    console.log(`${paint(f.sev)}  ${f.file}${f.line ? `:${f.line}` : ''}\n          ${f.title}\n          fix: ${f.fix}${f.autofix ? ' (--fix can do this)' : ''}\n`);
  }
  const count = (sev) => findings.filter((f) => f.sev === sev).length;
  console.log(findings.length ? `Summary: ${SEVERITIES.map((s) => `${count(s)} ${s}`).join(', ')}` : 'No findings. Nice.');
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('-')));
const [command, ...rest] = args.filter((a) => !a.startsWith('-'));

if (flags.has('-h') || flags.has('--help')) {
  console.log(HELP);
} else if (command === 'init') {
  init(rest[0] ?? '.');
} else {
  const root = command ?? '.';
  if (!existsSync(root)) {
    console.error(`rea-proof: ${root} does not exist`);
    process.exit(2);
  }
  let result = scan(root);
  if (flags.has('--fix')) {
    const done = applyFixes(root, result.findings);
    for (const d of done) console.error(`fixed    ${d}`);
    if (done.length) result = scan(root);
  }
  if (flags.has('--json')) console.log(JSON.stringify(result, null, 2));
  else report(root, result);
  process.exitCode = result.findings.some((f) => f.sev === 'critical' || f.sev === 'high') ? 1 : 0;
}
