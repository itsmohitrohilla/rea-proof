import { rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCEMAP_COMMENT } from './rules/sourcemaps.mjs';

const GITIGNORE_DONE = 'added .env* to .gitignore';

// Rules only set `autofix` on generated build output or .gitignore, so source files are never edited.
export function applyFixes(root, findings) {
  const done = [];
  for (const f of findings) {
    const abs = join(root, f.file);
    if (f.autofix === 'delete') {
      rmSync(abs, { force: true });
      done.push(`deleted ${f.file}`);
    } else if (f.autofix === 'strip-sourcemap') {
      writeFileSync(abs, readFileSync(abs, 'utf8').replace(SOURCEMAP_COMMENT, ''));
      done.push(`removed sourceMappingURL from ${f.file}`);
    } else if (f.autofix === 'gitignore-env' && !done.includes(GITIGNORE_DONE)) {
      appendFileSync(join(root, '.gitignore'), '\n# rea-proof: never commit env files\n.env\n.env.*\n!.env.example\n');
      done.push(GITIGNORE_DONE);
    }
  }
  return done;
}
