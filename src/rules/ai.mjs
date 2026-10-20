// AI features built in the browser leak the API key and the prompt, which is often the product.
import { first } from '../scan.mjs';

const AI_HOSTS = /\b(?:api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|api\.deepseek\.com|api\.perplexity\.ai|api\.elevenlabs\.io|openrouter\.ai\/api)\b/g;
const SYSTEM_PROMPT = /["']?role["']?\s*:\s*["']system["']/g;
const BROWSER_OPT_IN = /dangerouslyAllowBrowser\s*:\s*true|anthropic-dangerous-direct-browser-access/g;
const CODE_EXT = /^\.(m?[jt]sx?|cjs|html?|vue|svelte|astro)$/;

export function onFile(f, ctx) {
  if (f.text === null || !CODE_EXT.test(f.ext)) return;
  const optIn = first(BROWSER_OPT_IN, f.text);
  if (optIn) {
    ctx.add({ sev: 'high', file: f.rel, line: f.line(optIn.index), title: 'AI SDK is allowed to run in the browser',
      fix: 'This puts your AI key in the client. Call the model from a server route and send only the result to the browser.' });
  }
  if (!f.shipped) return;
  const host = first(AI_HOSTS, f.text);
  if (host) {
    ctx.add({ sev: 'high', file: f.rel, line: f.line(host.index), title: `Browser calls an AI provider directly (${host[0]})`,
      fix: 'The key and prompt must be in the bundle for this to work. Proxy through your own authenticated API route. If this file only runs on your server, add it to .reaproofignore.' });
  }
  const prompt = first(SYSTEM_PROMPT, f.text);
  if (prompt) {
    ctx.add({ sev: 'medium', file: f.rel, line: f.line(prompt.index), title: 'AI system prompt shipped to the browser',
      fix: 'Anyone can copy your prompt from the bundle. Keep prompts on the server and send only user input from the client.' });
  }
}
