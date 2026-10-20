// Database rules that let anyone holding your public client config read or write data.

const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/gi;
const ENABLE_RLS = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+enable\s+row\s+level\s+security/gi;
const CREATE_POLICY = /create\s+policy\s+("[^"]+"|\w+)[\s\S]*?;/gi;

export function start(ctx) {
  ctx.supabase = { tables: new Map(), rls: new Set() };
}

export function onFile(f, ctx) {
  if (f.text === null) return;
  const t = f.text;
  if (f.name === 'firestore.rules' || f.name === 'storage.rules') {
    const open = /allow\s+[\w\s,]+:\s*if\s+true\s*;/.exec(t);
    if (open) ctx.add({ sev: 'critical', file: f.rel, line: f.line(open.index), title: 'Firebase rules allow anyone (if true)', fix: 'Require request.auth != null and check ownership, e.g. request.auth.uid == userId.' });
    const test = /request\.time\s*<\s*timestamp\.date\(/.exec(t);
    if (test) ctx.add({ sev: 'high', file: f.rel, line: f.line(test.index), title: 'Firebase test-mode rules (open until a date)', fix: 'Replace test-mode rules with auth-based rules before launch.' });
  }
  if (f.name === 'database.rules.json') {
    const open = /"\.(?:read|write)"\s*:\s*(?:true|"true")/.exec(t);
    if (open) ctx.add({ sev: 'critical', file: f.rel, line: f.line(open.index), title: 'Realtime Database rules allow anyone', fix: 'Use "auth != null" and per-user paths.' });
  }
  if (f.ext !== '.sql' || f.shipped) return;

  const norm = (name) => name.replace(/"/g, '').toLowerCase();
  for (const m of t.matchAll(CREATE_TABLE)) {
    const name = norm(m[1]);
    // Only the public schema is exposed through the Supabase API.
    if (name.includes('.') && !name.startsWith('public.')) continue;
    const table = name.replace(/^public\./, '');
    if (!ctx.supabase.tables.has(table)) ctx.supabase.tables.set(table, { file: f.rel, line: f.line(m.index) });
  }
  for (const m of t.matchAll(ENABLE_RLS)) ctx.supabase.rls.add(norm(m[1]).replace(/^public\./, ''));
  for (const m of t.matchAll(CREATE_POLICY)) {
    const command = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(m[0])?.[1].toLowerCase() ?? 'all';
    if (command !== 'select' && /(?:using|with\s+check)\s*\(\s*true\s*\)/i.test(m[0])) {
      ctx.add({ sev: 'high', file: f.rel, line: f.line(m.index), title: `Policy ${m[1]} lets anyone ${command === 'all' ? 'change' : command} rows`,
        fix: 'Replace (true) with an ownership check, e.g. using ((select auth.uid()) = user_id).' });
    }
  }
}

export function finish(ctx) {
  for (const [table, where] of ctx.supabase.tables) {
    if (ctx.supabase.rls.has(table)) continue;
    ctx.add({ sev: 'high', ...where, title: `Table "${table}" has no row level security`,
      fix: `Your anon key is public, so anyone can query this table. Run: alter table public.${table} enable row level security; then add policies.` });
  }
}
