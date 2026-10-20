// Electron settings that let anyone attach a debugger, run your app as plain Node, or swap its code.
const PREFS = [
  [/nodeIntegration\s*:\s*true/, 'high', 'Electron nodeIntegration: true', 'Any XSS becomes full system access. Set nodeIntegration: false and expose only what you need via contextBridge in a preload.'],
  [/contextIsolation\s*:\s*false/, 'high', 'Electron contextIsolation: false', 'Page scripts can reach your preload internals. Remove it (true is the default).'],
  [/webSecurity\s*:\s*false/, 'high', 'Electron webSecurity: false', 'Disables the same-origin policy. Remove it.'],
  [/sandbox\s*:\s*false/, 'medium', 'Electron sandbox: false', 'Renderer runs unsandboxed. Remove it (sandbox is on by default since Electron 20).'],
];
const ASAR_FIX = 'Your app code ships as loose files anyone can edit. Enable asar plus the EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar fuses.';

export function start(ctx) {
  ctx.electron = 'electron' in ctx.deps ? { fuses: '@electron/fuses' in ctx.deps } : null;
}

export function onFile(f, ctx) {
  if (!ctx.electron || f.text === null) return;
  if (/\.[cm]?[jt]sx?$/.test(f.name)) {
    for (const [re, sev, title, fix] of PREFS) {
      const m = re.exec(f.text);
      if (m) ctx.add({ sev, file: f.rel, line: f.line(m.index), title, fix });
    }
    if (/FuseV1Options|FusesPlugin/.test(f.text)) ctx.electron.fuses = true;
  }
  if ((/^electron-builder\.(ya?ml|json)$/.test(f.name) || /^forge\.config\./.test(f.name)) && /asar\s*:\s*false/.test(f.text)) {
    ctx.add({ sev: 'medium', file: f.rel, title: 'Electron app is packaged without asar', fix: ASAR_FIX });
  }
}

export function finish(ctx) {
  if (!ctx.electron) return;
  if (ctx.pkg.build?.asar === false) ctx.add({ sev: 'medium', file: 'package.json', title: 'Electron app is packaged without asar', fix: ASAR_FIX });
  if (!ctx.electron.fuses) {
    ctx.add({ sev: 'medium', file: 'package.json', title: 'Electron fuses are not configured',
      fix: 'Use @electron/fuses (or the Forge FusesPlugin): disable RunAsNode, EnableNodeOptionsEnvironmentVariable and EnableNodeCliInspectArguments; enable EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar.' });
  }
}
