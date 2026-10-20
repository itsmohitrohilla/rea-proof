// Files that should never be downloadable from your site or committed to git.
import { execFileSync } from 'node:child_process';

const ENV_FILE = /^\.env(\..+)?$/;
const ENV_TEMPLATE = /example|sample|template|defaults?$/;
const JUNK_EXT = new Set(['.sql', '.sqlite', '.db', '.bak', '.old', '.orig', '.swp', '.log']);

export const isEnvFile = (name) => ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);

export function onDir(dir, ctx) {
  if (dir.name === '.git' && dir.shipped) {
    ctx.add({ sev: 'critical', file: dir.rel, title: '.git folder inside a deployed folder',
      fix: 'Anyone can download /.git and rebuild your whole repo history. Remove it from the output and fix your deploy step.' });
  }
}

export function onFile(f, ctx) {
  const autofix = f.output ? 'delete' : undefined;
  if (isEnvFile(f.name)) {
    if (f.shipped) {
      ctx.add({ sev: 'critical', file: f.rel, title: '.env file inside a deployed folder', autofix,
        fix: 'It can be downloaded by anyone. Remove it from the output and rotate every key in it.' });
    } else if (ctx.isGit && !gitIgnored(ctx.root, f.rel)) {
      ctx.add({ sev: 'high', file: f.rel, title: '.env file is not git-ignored (or already committed)', autofix: 'gitignore-env',
        fix: 'Add .env* to .gitignore. If it was ever pushed, run `git rm --cached` on it, rotate the keys and purge it from history.' });
    }
  }
  if (f.shipped && JUNK_EXT.has(f.ext)) {
    ctx.add({ sev: 'medium', file: f.rel, title: `${f.ext} file inside a deployed folder`, autofix,
      fix: 'Backups, logs and databases in a public folder are downloadable. Remove them from the output.' });
  }
  if (f.shipped && f.name === '.DS_Store') {
    ctx.add({ sev: 'low', file: f.rel, title: '.DS_Store inside a deployed folder', autofix,
      fix: 'Leaks your folder listing. Remove it and add .DS_Store to .gitignore.' });
  }
}

function gitIgnored(root, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
