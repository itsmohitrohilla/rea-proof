# rea-proof

**Make reverse engineering your app worthless.** Find what your landing page, web app, desktop app or mobile app gives away before you ship it, and fix it.

Tools like [REA (Reverse Engineer Anything)](https://github.com/morluto/rea), browser DevTools and AI agents can pull a lot out of a deployed app:

- your original source code, rebuilt from source maps
- API keys baked into the bundle
- AI prompts
- databases left open to anyone holding your public config

AI-built ("vibe-coded") apps leak these constantly. `rea-proof` finds them in seconds and auto-fixes what it safely can.

```bash
npm run build
npx rea-proof .          # scan the project and its build output
npx rea-proof . --fix    # also clean build output (source maps, .env, backups)
npx rea-proof init       # add a CI check + postbuild guard to your project
```

It exits with code `1` when it finds anything critical or high, so it blocks bad deploys in CI or as a `postbuild` script.

> **The honest part:** nothing can stop someone from reading code that runs on their own device. `rea-proof` makes sure that reading it gets them nothing: no source, no keys, no prompts, no open data. The [hardening guide](docs/hardening-guide.md) shows how for Next.js, Vite, Supabase, Firebase, Electron, React Native, Flutter and .NET.

## What it checks

| Area | Finds | Why it matters |
| --- | --- | --- |
| **Source maps** | `.map` files, `sourceMappingURL`, inline maps, `SourceMap` headers; `sourcemap: true` (Vite), `productionBrowserSourceMaps` (Next.js), webpack `devtool`, CRA defaults | Anyone can rebuild your readable original source |
| **Secrets** | OpenAI, Anthropic, AWS, Stripe, GitHub, Slack, SendGrid, Supabase secret keys, private keys, generic `apiKey = "..."` | Stolen keys mean someone else spends your money |
| **Supabase** | `service_role` key anywhere; tables without row level security; `using (true)` write policies | Your anon key is public, so RLS is the only lock |
| **Firebase** | `if true` rules, test-mode rules, open Realtime Database rules | Anyone can read or write your data |
| **Public env vars** | `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` / `EXPO_PUBLIC_` / `PUBLIC_` vars named like secrets | Frameworks paste these into the browser bundle |
| **AI features** | Browser calls to OpenAI / Anthropic / Gemini / Groq / etc., `dangerouslyAllowBrowser`, system prompts in the bundle | Your key and your prompt (often the whole product) are public |
| **Deploy leaks** | `.env`, `.git`, `.sql`, `.bak`, `.log`, `.DS_Store` in deployed folders; `.env` not git-ignored | Directly downloadable from your site |
| **Electron** | `nodeIntegration`, `contextIsolation: false`, `webSecurity: false`, `sandbox: false`, no asar, no fuses | Debugger attach, run-as-Node, code tampering |
| **Mobile / desktop** | `android:debuggable`, R8 off in release, `get-task-allow` entitlement, Flutter builds without `--obfuscate` | Release builds that are easy to debug and read |
| **Builds** | Unminified shipped JavaScript | Readable names and comments ship to users |

## Auto-fix (`--fix`)

`--fix` only touches **generated build output** (`dist/`, `build/`, `out/`, `.next/`, `.output/`, `.svelte-kit/output/`) and `.gitignore`. It never edits your source files or `public/`.

- deletes `.map`, `.env`, backup, log and `.DS_Store` files from build output
- strips `sourceMappingURL` comments from shipped JS/CSS
- adds `.env*` to `.gitignore`

Leaked keys still have to be **rotated** by you. Once a key has shipped, deleting it isn't enough.

## Use it on every deploy

`npx rea-proof init` adds two things:

1. `.github/workflows/rea-proof.yml`: builds and scans on every push and pull request.
2. A `postbuild` script that runs `rea-proof . --fix` after every `npm run build`. This also runs on Vercel and Netlify, so a leaky build fails instead of deploying.

## False positives

Add path prefixes to `.reaproofignore`, one per line:

```text
# server-only bundle, never sent to browsers
dist/server/
```

## Project layout

```text
bin/rea-proof.mjs         CLI: scan, --fix, --json, init
src/scan.mjs              walks the project and runs every rule
src/fix.mjs               safe auto-fixes for build output
src/rules/                deploy, secrets, sourcemaps, ai, backend, electron, mobile
templates/                GitHub Action installed by `init`
test/                     node:test suite (leaky app, clean app, --fix)
docs/hardening-guide.md   per-stack guide for what a scanner can't fix
```

Zero dependencies. Node.js 20+.

## Development

```bash
npm test
node bin/rea-proof.mjs path/to/app
```

To add a check, add a rule module in `src/rules/` (exporting any of `start`, `onDir`, `onFile`, `finish`), register it in `src/scan.mjs`, and extend the fixtures in `test/`.

## License

MIT
