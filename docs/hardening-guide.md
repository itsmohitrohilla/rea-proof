# Hardening guide: make reverse engineering worthless

Any code you send to a browser, phone or desktop can be read, because the device has to read it to run it. A determined person or AI agent with tools like [REA](https://github.com/morluto/rea) will get your client code eventually. Minifying and obfuscating it only slows them down.

So the goal isn't "nobody can read my code". It's **"reading my code gets you nothing you can use."** You get there by keeping everything valuable on a server you control:

| What attackers want | Where it must live |
| --- | --- |
| API keys (AI, payments, email) | Server env vars only |
| AI prompts, pricing rules, scoring, algorithms | Server routes / edge functions |
| Your data | A database that checks *who* is asking (RLS / security rules) |
| Paid features | Checked on the server on every request, not with a client `if (isPro)` |
| Your original source | Never published: no public source maps |

Run `npx rea-proof .` after every build to check the parts that can be automated. The rest of this guide covers each stack.

---

## 1. The architecture rule (every stack)

```
Browser / app  ──(user input + session token)──▶  Your server  ──(secret key)──▶  OpenAI / Stripe / DB
               ◀─────────(result only)──────────
```

- The client sends **what the user did**. The server decides **what happens**.
- Every server route checks the session (`auth.getUser()`, NextAuth `getServerSession`, Clerk `auth()`), then checks that this user may do this thing.
- Rate-limit server routes that cost money (AI calls), or someone will run your bill up with your own UI's requests.

## 2. Next.js

- Secrets in `process.env.X` **without** `NEXT_PUBLIC_`, read only in Route Handlers, Server Actions or Server Components.
- Add `import 'server-only'` at the top of any module that touches secrets; the build fails if a client component imports it.
- Leave `productionBrowserSourceMaps` off (the default). If you use Sentry, upload maps from CI and turn on its "delete after upload" option.
- Server Actions are public HTTP endpoints. Check auth inside every one.

## 3. Vite / React / Vue / Svelte SPAs

- **Everything in a SPA is public.** `VITE_*` variables are pasted into the bundle at build time.
- You need a backend for anything secret: Supabase Edge Functions, Firebase Cloud Functions, Vercel/Netlify functions, or a small API.
- `build.sourcemap`: leave it unset, or set it to `'hidden'` if you upload maps to an error tracker.

## 4. Supabase

- The anon key is public by design. **Row level security is what protects you.**
- Every table in `public`: `alter table <t> enable row level security;` and add policies like `using ((select auth.uid()) = user_id)`.
- Never write `using (true)` on insert/update/delete policies.
- The `service_role` key bypasses RLS. Use it only in Edge Functions or your server, never in the client.
- Put internal tables in a non-exposed schema (e.g. `private`).

## 5. Firebase

- The web `apiKey` is public by design. **Security rules are what protect you.**
- Replace test-mode rules before launch: `allow read, write: if request.auth != null && request.auth.uid == userId;`
- Restrict the API key to your domains in Google Cloud Console, and turn on App Check.

## 6. AI features

- Never call `api.openai.com` / `api.anthropic.com` from the browser. Never set `dangerouslyAllowBrowser: true`.
- Keep the system prompt on the server. The client sends only the user's message.
- Validate and cap input length on the server; rate-limit per user.

## 7. Electron

In your packaging config:

- `asar: true`
- Fuses (`@electron/fuses` or the Forge `FusesPlugin`):
  - `RunAsNode: false`
  - `EnableNodeOptionsEnvironmentVariable: false`
  - `EnableNodeCliInspectArguments: false`
  - `EnableEmbeddedAsarIntegrityValidation: true`
  - `OnlyLoadAppFromAsar: true`

In `webPreferences`, keep the safe defaults: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Never set `webSecurity: false`.

In preloads, expose narrow functions through `contextBridge`, never `ipcRenderer` itself. In every `ipcMain.handle`, check `event.senderFrame.url`.

Distribution:

- Code-sign the app. Notarize on macOS, with the hardened runtime on and no `get-task-allow` in release entitlements.
- Serve the UI from a custom protocol (`protocol.handle('app', ...)`) instead of `file://`.
- Keep license checks and paid features on your server.

## 8. React Native / Expo

- `EXPO_PUBLIC_*` values are bundled into the app. Treat them like `VITE_*`.
- Keep the Hermes engine on (the default). It ships bytecode, not readable JS.
- Android: R8 on for release (`enableProguardInReleaseBuilds = true`), no `android:debuggable`.

## 9. Flutter

- Release builds: `flutter build apk --obfuscate --split-debug-info=build/symbols`. Keep the symbol files private.
- `--dart-define` values are compiled into the binary and can be extracted. Don't put secrets there.

## 10. .NET desktop

- Every string literal in your code can be read straight out of the assembly. Keep secrets out of code.
- Publishing with NativeAOT removes the IL, so there is nothing to decompile back to C#. The binary can still be analyzed natively.

## 11. Obfuscation (optional speed bump)

`javascript-obfuscator` (or `vite-plugin-javascript-obfuscator` / `webpack-obfuscator`) renames identifiers, encrypts strings and flattens control flow.

- **Good for:** making casual copying tedious.
- **Costs:** bigger bundles, slower code, harder debugging, and occasional breakage.
- **Not good for:** protecting secrets. An encrypted string still decrypts in the browser, so a key in obfuscated code is still a leaked key.

Apply it last, only to your own app code, and only after sections 1–6 are done.

---

## Launch checklist

- [ ] `npx rea-proof .` passes after a production build
- [ ] No secret key starts with `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_` or `PUBLIC_`
- [ ] Every AI or payment call goes through a server route that checks the session
- [ ] RLS is on for every Supabase table, or Firebase rules require auth
- [ ] No `.map` files on the live site (open `https://yoursite.com/assets/<file>.js.map`: it should 404)
- [ ] Any key that was ever committed or shipped has been **rotated**
- [ ] `npx rea-proof init` added the CI check, so this stays true
