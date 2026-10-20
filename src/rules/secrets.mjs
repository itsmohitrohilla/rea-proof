// API keys and tokens that anyone reading your bundle or repo could steal.
import { first } from '../scan.mjs';
import { isEnvFile } from './deploy.mjs';

const SECRETS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Stripe secret key', /\b[rs]k_live_[0-9a-zA-Z]{20,}/g],
  ['Anthropic API key', /\bsk-ant-[\w-]{20,}/g],
  ['OpenAI API key', /\bsk-(?!ant-)(?=[\w-]*\d)(?:proj-|svcacct-)?[\w-]{20,}/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})/g],
  ['Slack token', /\bxox[abprs]-[\w-]{10,}/g],
  ['SendGrid API key', /\bSG\.[\w-]{22}\.[\w-]{43}\b/g],
  ['Supabase secret key', /\bsb_secret_[\w-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g],
];
// ponytail: naive "key = 'value'" heuristic; requires letter+digit to cut noise, still misses split strings
const GENERIC_SECRET = /(?:secret|passw(?:or)?d|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi;
const PLACEHOLDER = /your|xxx|example|changeme|placeholder|<|\$\{|process\.env|import\.meta/i;
const GOOGLE_KEY = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const JWT = /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g;
// Env vars with these prefixes are inlined into the browser bundle by the framework.
const PUBLIC_SECRET_ENV = /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|GATSBY|PUBLIC)_\w*?(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD|(?:OPENAI|ANTHROPIC|CLAUDE|GEMINI|GROQ|MISTRAL|REPLICATE|ELEVENLABS|DEEPSEEK|PERPLEXITY|RESEND|SENDGRID|TWILIO)\w*KEY)\w*/g;

export function onFile(f, ctx) {
  if (f.text === null) return;
  const pub = first(PUBLIC_SECRET_ENV, f.text);
  if (pub) {
    ctx.add({ sev: 'critical', file: f.rel, line: f.line(pub.index), title: `Secret in a browser-exposed env var (${pub[0]})`,
      fix: 'Frameworks inline these prefixes into the client bundle. Drop the public prefix and call the API from a server route.' });
  }
  if (isEnvFile(f.name)) return; // .env files are where secrets belong

  const sev = f.shipped ? 'critical' : 'high';
  const fix = f.shipped
    ? 'Anyone can read this from your deployed files. Rotate the key now and call that API from your server instead.'
    : 'Hardcoded secrets end up in git and often in your bundle. Move it to a server-side env var and rotate it if it was committed.';
  for (const [label, re] of SECRETS) {
    const m = first(re, f.text);
    if (m) ctx.add({ sev, file: f.rel, line: f.line(m.index), title: `${label} found`, fix });
  }
  for (const m of f.text.matchAll(GENERIC_SECRET)) {
    if (/[a-z]/i.test(m[1]) && /\d/.test(m[1]) && !PLACEHOLDER.test(m[1])) {
      ctx.add({ sev: f.shipped ? 'high' : 'medium', file: f.rel, line: f.line(m.index), title: 'Possible hardcoded secret', fix });
      break;
    }
  }
  for (const m of f.text.matchAll(JWT)) {
    let role;
    try { role = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString()).role; } catch {}
    if (role === 'service_role') {
      ctx.add({ sev, file: f.rel, line: f.line(m.index), title: 'Supabase service_role key found',
        fix: 'This key bypasses all row level security. Rotate it in Supabase now and only use it on the server.' });
      break;
    }
  }
  const google = first(GOOGLE_KEY, f.text);
  if (google && f.shipped) {
    ctx.add({ sev: 'low', file: f.rel, line: f.line(google.index), title: 'Google API key in shipped files',
      fix: 'Fine for Firebase web config, but restrict the key to your domains and APIs in Google Cloud Console.' });
  }
}
