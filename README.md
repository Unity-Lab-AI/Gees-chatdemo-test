# Polli Voice Studio

A streamlined, static voice assistant for [Pollinations](https://pollinations.ai)
using the bundled [PolliLib](./Libs/pollilib/) client. The application captures
speech, sends messages through PolliLib, and speaks the assistant response using
built-in browser speech synthesis.

## Features

- Voice capture with the Web Speech API and real-time transcription preview.
- Text fallback with keyboard shortcut (`Ctrl`/`Cmd` + `Enter`) for quick
  submission.
- Spoken responses with automatic truncation for lengthy answers.
- Clear conversation control for fresh sessions.
- Static build suitable for GitHub Pages deployment.

> **Browser support:** Voice capture relies on the Web Speech API, which is
> available in current versions of Chromium-based browsers (Chrome, Edge, Brave).
> Other desktop browsers such as Firefox gracefully fall back to text-only input
> and disable the microphone button so the app remains fully usable.

The previous multi-tool chat experience is preserved under [`demo2/`](./demo2)
for reference only.

## Development

```bash
npm install
npm run dev
```

## Building for static hosting

```bash
npm run build
```

The generated assets are written to `dist/` and can be published directly.

## Testing

```bash
npm test
```

The custom test runner executes the modules in `tests/` and writes a summary to
`reports/test-results.json`.

## Deployment workflow

The GitHub Actions workflow in `.github/workflows/pages.yml` runs the full test
suite before building and deploying to GitHub Pages. A dedicated test job sits
alongside the build job so test results are visible next to the deployment
report.
