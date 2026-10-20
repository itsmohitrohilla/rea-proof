// Release settings for Android, iOS/macOS and Flutter that leave the app debuggable or readable.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const FLUTTER_BUILD = /flutter\s+build\s+(?:apk|appbundle|ipa|ios|macos|windows|linux)\b/;

export function start(ctx) {
  ctx.flutter = existsSync(join(ctx.root, 'pubspec.yaml'));
}

export function onFile(f, ctx) {
  // Build output contains debug variants (e.g. merged debug manifests), so only source config is checked.
  if (f.text === null || f.output) return;
  const t = f.text;
  if (f.name === 'AndroidManifest.xml') {
    const m = /android:debuggable\s*=\s*"true"/.exec(t);
    if (m) ctx.add({ sev: 'high', file: f.rel, line: f.line(m.index), title: 'Android app is debuggable', fix: 'Remove android:debuggable; Gradle sets it correctly per build type.' });
  }
  if (f.name === 'build.gradle' || f.name === 'build.gradle.kts') {
    const m = /enableProguardInReleaseBuilds\s*=\s*false/.exec(t) ?? /release\s*\{[^}]*?(?:minifyEnabled\s+false|isMinifyEnabled\s*=\s*false)/.exec(t);
    if (m) ctx.add({ sev: 'medium', file: f.rel, line: f.line(m.index), title: 'Android release build has R8 shrinking/obfuscation turned off', fix: 'Set minifyEnabled true (React Native: enableProguardInReleaseBuilds = true) and test the release build.' });
  }
  if (f.ext === '.entitlements' || f.ext === '.plist') {
    const m = /<key>com\.apple\.security\.get-task-allow<\/key>\s*<true\s*\/>/.exec(t);
    if (m) ctx.add({ sev: 'high', file: f.rel, line: f.line(m.index), title: 'get-task-allow entitlement is enabled', fix: 'Lets any debugger attach to your app. Ship release builds without it, with the hardened runtime on.' });
  }
  if (ctx.flutter && /^\.(ya?ml|sh|json)$/.test(f.ext)) {
    const lines = t.split('\n');
    const i = lines.findIndex((l) => FLUTTER_BUILD.test(l) && !l.includes('--obfuscate'));
    if (i >= 0) ctx.add({ sev: 'medium', file: f.rel, line: i + 1, title: 'Flutter release build without --obfuscate', fix: 'Add --obfuscate --split-debug-info=<dir> and keep the symbol files private.' });
  }
}
