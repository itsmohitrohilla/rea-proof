// Source maps let anyone rebuild your original, readable source code from the bundle.
import { first } from '../scan.mjs';

export const SOURCEMAP_COMMENT = /\/\/[#@]\s*sourceMappingURL=[^\n]*|\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g;
const HEADER_FILES = new Set(['vercel.json', 'netlify.toml', '_headers', 'nginx.conf', 'firebase.json']);
const SOURCEMAP_HEADER = /\b(?:x-)?sourcemap\b["']?\s*[:,]|add_header\s+(?:x-)?sourcemap\b/i;
const MAP_FIX = 'Anyone can rebuild your readable source from it. Turn off production source maps (or upload them only to your error tracker) and delete .map files from the output.';

export function start(ctx) {
  ctx.craSourcemapOff = /GENERATE_SOURCEMAP=false/.test(JSON.stringify(ctx.pkg.scripts ?? {}));
}

export function onFile(f, ctx) {
  const t = f.text;
  if (f.shipped && f.ext === '.map') {
    ctx.add({ sev: 'high', file: f.rel, fix: MAP_FIX, autofix: f.output ? 'delete' : undefined,
      title: t?.includes('"sourcesContent"') ? 'Source map with your full original source code is deployed' : 'Source map is deployed' });
  }
  if (t === null) return;
  if (/GENERATE_SOURCEMAP=false/.test(t)) ctx.craSourcemapOff = true;

  if (f.shipped && /^\.(m?js|css)$/.test(f.ext)) {
    const m = first(SOURCEMAP_COMMENT, t);
    if (m) {
      const inline = m[0].includes('=data:');
      ctx.add({ sev: inline ? 'high' : 'medium', file: f.rel, line: f.line(m.index), autofix: f.output ? 'strip-sourcemap' : undefined,
        title: inline ? 'Inline source map embedded in a shipped file' : 'sourceMappingURL comment points to a source map',
        fix: 'Turn off production source maps, or use "hidden" source maps so nothing is referenced publicly.' });
    }
    const lines = t.split('\n').length;
    if (f.ext !== '.css' && f.size > 50_000 && lines > 500 && f.size / lines < 120) {
      ctx.add({ sev: 'low', file: f.rel, title: 'Shipped JavaScript is not minified', fix: 'Build in production mode so names and comments are stripped.' });
    }
  }

  if (/\.config\.[cm]?[jt]s$/.test(f.name)) {
    if (/productionBrowserSourceMaps\s*:\s*true/.test(t)) ctx.add({ sev: 'high', file: f.rel, title: 'Next.js productionBrowserSourceMaps is on', fix: 'Remove it; it publishes your original source.' });
    if (/sourcemap\s*:\s*(?:true|['"]inline['"])/.test(t)) ctx.add({ sev: 'high', file: f.rel, title: 'Build source maps are enabled', fix: 'Remove it, or use sourcemap: "hidden" and upload maps only to your error tracker.' });
    if (/devtool\s*:\s*['"](?!(?:hidden|nosources)-)[\w-]*source-map/.test(t)) ctx.add({ sev: 'high', file: f.rel, title: 'Webpack devtool emits public source maps', fix: 'Use devtool: false or "hidden-source-map" for production.' });
  }
  if (HEADER_FILES.has(f.name) && SOURCEMAP_HEADER.test(t)) {
    ctx.add({ sev: 'medium', file: f.rel, title: 'Deploy config sends a SourceMap header', fix: 'Remove the SourceMap / X-SourceMap header; it tells browsers where your source maps are.' });
  }
}

export function finish(ctx) {
  if ('react-scripts' in ctx.deps && !ctx.craSourcemapOff) {
    ctx.add({ sev: 'high', file: 'package.json', title: 'Create React App ships source maps by default', fix: 'Set GENERATE_SOURCEMAP=false in .env.production or in the build script.' });
  }
}
