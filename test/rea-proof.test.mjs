import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scan } from '../src/scan.mjs';
import { applyFixes } from '../src/fix.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'rea-proof-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.c2lnbmF0dXJlX2hlcmVfMTIz`;
const titles = (root) => scan(root).findings.map((f) => `${f.sev}: ${f.title}`);

test('flags every leak in a vibe-coded app', () => {
  const root = fixture({
    'package.json': JSON.stringify({ dependencies: { electron: '33.0.0' } }),
    'dist/assets/index.js': `const s="${jwt('service_role')}";fetch("https://api.openai.com/v1/chat/completions",{body:JSON.stringify({messages:[{role:"system",content:"You are"}]})});\n//# sourceMappingURL=index.js.map`,
    'dist/assets/index.js.map': '{"version":3,"sources":["src/App.tsx"],"sourcesContent":["secret logic"]}',
    'dist/.env': 'X=1',
    'dist/backup.sql': 'select 1;',
    'vercel.json': '{"headers":[{"source":"/(.*)","headers":[{"key":"SourceMap","value":"/app.map"}]}]}',
    'vite.config.ts': 'export default { build: { sourcemap: true } }',
    'src/ai.ts': 'const key = import.meta.env.VITE_OPENAI_API_KEY;\nconst aws = "AKIAABCDEFGHIJKLMNOP";\nnew OpenAI({ dangerouslyAllowBrowser: true });',
    'main.js': 'new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false } })',
    'firestore.rules': 'match /{doc=**} { allow read, write: if true; }',
    'supabase/migrations/001.sql': 'create table public.profiles (id uuid);\ncreate table "todos" (id int);\nalter table todos enable row level security;\ncreate policy "edit" on todos for update using (true);\ncreate policy "read" on todos for select using (true);',
    'android/app/src/main/AndroidManifest.xml': '<application android:debuggable="true" />',
    'android/app/build.gradle': 'def enableProguardInReleaseBuilds = false',
    'macos/App.entitlements': '<dict><key>com.apple.security.get-task-allow</key><true/></dict>',
    'pubspec.yaml': 'name: app',
    '.github/workflows/release.yml': 'run: flutter build apk --release',
  });
  const got = titles(root);
  const expected = [
    'critical: Supabase service_role key found',
    'critical: .env file inside a deployed folder',
    'critical: Secret in a browser-exposed env var (VITE_OPENAI_API_KEY)',
    'critical: Firebase rules allow anyone (if true)',
    'high: Source map with your full original source code is deployed',
    'high: Browser calls an AI provider directly (api.openai.com)',
    'high: Build source maps are enabled',
    'high: AWS access key found',
    'high: AI SDK is allowed to run in the browser',
    'high: Electron nodeIntegration: true',
    'high: Electron contextIsolation: false',
    'high: Table "profiles" has no row level security',
    'high: Policy "edit" lets anyone update rows',
    'high: Android app is debuggable',
    'high: get-task-allow entitlement is enabled',
    'medium: sourceMappingURL comment points to a source map',
    'medium: AI system prompt shipped to the browser',
    'medium: .sql file inside a deployed folder',
    'medium: Deploy config sends a SourceMap header',
    'medium: Electron fuses are not configured',
    'medium: Android release build has R8 shrinking/obfuscation turned off',
    'medium: Flutter release build without --obfuscate',
  ];
  for (const e of expected) assert.ok(got.includes(e), `missing: ${e}\ngot:\n${got.join('\n')}`);
  assert.equal(got.length, expected.length, `unexpected extras:\n${got.join('\n')}`);
});

test('clean app has no findings', () => {
  const root = fixture({
    'package.json': JSON.stringify({ dependencies: { react: '19.0.0' } }),
    'dist/assets/index.js': `const anon="${jwt('anon')}";fetch("/api/chat")`,
    'dist/server/index.js': 'fetch("https://api.openai.com/v1/responses")',
    '.reaproofignore': '# server bundle, never sent to browsers\ndist/server/\n',
    'vite.config.ts': 'export default { build: { sourcemap: "hidden" } }',
    'src/api/chat.ts': 'const key = process.env.OPENAI_API_KEY;',
    '.env.example': 'OPENAI_API_KEY=your_key_here',
    'firestore.rules': 'allow read: if request.auth != null;',
    'supabase/migrations/001.sql': 'create table profiles (id uuid);\nalter table public.profiles enable row level security;\ncreate table private.jobs (id int);',
  });
  assert.deepEqual(scan(root).findings, []);
});

test('--fix cleans build output but never touches source folders', () => {
  const root = fixture({
    'dist/app.js': 'console.log(1);\n//# sourceMappingURL=app.js.map\n',
    'dist/app.js.map': '{"version":3,"sourcesContent":["x"]}',
    'dist/.env': 'X=1',
    'public/legacy.js.map': '{"version":3}',
    '.env': 'OPENAI_API_KEY=sk-test',
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  applyFixes(root, scan(root).findings);

  assert.ok(!existsSync(join(root, 'dist/app.js.map')));
  assert.ok(!existsSync(join(root, 'dist/.env')));
  assert.equal(readFileSync(join(root, 'dist/app.js'), 'utf8'), 'console.log(1);\n\n');
  assert.ok(existsSync(join(root, 'public/legacy.js.map')), 'public/ is source, must not be deleted');
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.env$/m);
  assert.deepEqual(titles(root), ['high: Source map is deployed']);
});
