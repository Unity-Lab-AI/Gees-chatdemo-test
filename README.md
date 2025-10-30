# chatdemo

Static browser demo for interacting with [Pollinations](https://pollinations.ai) using the bundled
[PolliLib](./Libs/pollilib/) client. The Vite application now lives entirely under
[`demo2/`](./demo2/) so the same source tree powers both the desktop chat and the mobile, voice-first
Unity persona experience. It features:

## Main branch status

[![Build status](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml/badge.svg?branch=main&job=Build%20and%20Upload%20Artifacts)](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml)
[![Test status](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml/badge.svg?branch=main&job=Run%20Tests)](https://github.com/Unity-Lab-AI/chatdemo/actions/workflows/main.yml)

- Text chat powered by PolliLib's `chat()` helper.
- Assistant-guided and manual (`/image`) Pollinations image generation.
- Model selector populated from the Pollinations text model catalog.
- Voice selector paired with an optional playback toggle for text-to-speech responses.
- Browser voice capture (Web Speech API) with an automatic 0.5 second silence timeout.

## Development

```bash
npm install
npm run dev
```

The `dev` script delegates to the Vite config in `demo2/`, so the desktop UI renders at
`http://localhost:5173/` while mobile browsers are redirected to the hands-free experience at
`http://localhost:5173/mobile/`.

## Building for static hosting

```bash
npm run build
```

Artifacts are written to `demo2/dist/`. Deploy that folder to your static host (for example GitHub
Pages). The desktop entry point is `index.html` and the mobile shell lives at `mobile/index.html`.

## Configuring the Pollinations token

Pollinations models that require tiered access expect the token to be supplied as a request
parameter. The demo can resolve the token at runtime (via URL parameters, meta tags, or injected
globals) and also honours build-time environment variables when you want to bake the token into the
bundle.

- **GitHub Pages / production** – Provide the `POLLI_TOKEN` secret in the repository (or Pages
  environment). You can surface the token to the client by setting `window.__POLLINATIONS_TOKEN__`,
  defining a `<meta name="pollinations-token" content="...">` tag, adding a `token=...` query
  parameter to the published URL (e.g. `https://example.github.io/chatdemo/?token=your-secret`), or
  injecting `POLLI_TOKEN`/`VITE_POLLI_TOKEN` during the build so the token ships with the bundle.
  The token is removed from the visible URL after it is captured.
- **Local development** – Define `POLLI_TOKEN`/`VITE_POLLI_TOKEN` in your shell when running
  `npm run dev`, add a meta tag as above, or inject `window.__POLLINATIONS_TOKEN__` before the
  application bootstraps. Build-time environment variables also work in development.
- **Optional runtime endpoint** – If you expose the token via a custom endpoint, configure its URL
  with `POLLI_TOKEN_ENDPOINT`/`VITE_POLLI_TOKEN_ENDPOINT` (environment variables),
  `window.__POLLINATIONS_TOKEN_ENDPOINT__`, or a `<meta name="pollinations-token-endpoint" ...>` tag.
  When present, the client will fetch the token from that endpoint.

If the token cannot be resolved the application continues without one, allowing you to browse public
models while gated Pollinations models remain unavailable until a token is supplied.

All chat and image requests automatically include a random eight-digit `seed` parameter so they
match Pollinations' expected request format.


## Project structure

- `demo2/` — Vite application containing both the desktop chat (`index.html`) and mobile voice shell
  (`mobile/index.html`). Assets are emitted to `demo2/dist/` during builds.
- `demo2/src/` — app entrypoints and styles; core helpers live under `demo2/src/lib/`.
- `Libs/pollilib/` — compatibility import surface for the bundled PolliLib client.
- `libs/PolliLib/` — vendored PolliLib submodule (JavaScript + Python sources).
- `demo2/public/` — static assets served at the web root (e.g. `sw.js`).
- `tools/` — local build/test utilities invoked by CI and npm scripts.
- `tests/` — self-contained integration tests (run via `npm test`).
- `reports/` — artifacts from tests and model checks.
- `docs/` — API docs and miscellaneous notes.
