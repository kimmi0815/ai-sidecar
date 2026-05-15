# AI Sidecar

AI Sidecar is a Manifest V3 Chrome extension that keeps AI services in Chrome's Side Panel while you browse normally in the main tab.

It displays a local extension page in the Side Panel and loads the selected AI service inside an iframe. It never sets `side_panel.default_path` to an external URL.

## Included services

- ChatGPT: `https://chatgpt.com/`
- Claude: `https://claude.ai/`
- Gemini: `https://gemini.google.com/`
- NotebookLM: `https://notebooklm.google.com/`
- Google Keep: `https://keep.google.com/`
- Custom URL

## Build

If your machine has npm:

```sh
npm install
npm run build
```

This repository also includes prebuilt `dist/` JavaScript after local development. In this Codex workspace, `npm` was not available, so `npm run typecheck` could not be executed here. A local fallback build helper is available:

```sh
node scripts/build.mjs
```

## Load as an unpacked extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project folder.
5. Click the AI Sidecar extension icon, or press `Command+Shift+Y` on macOS / `Ctrl+Shift+Y` elsewhere.

## Developer diagnostics

Developer diagnostics are hidden from the normal Side Panel UI. Open the side panel page with `?debug=1` to test each bundled AI service with iframe compatibility mode off and on.

Chrome extensions cannot inspect the inside of cross-origin iframes, so diagnostics record load/timeout signals and let you manually mark whether the service was visibly usable.

## Iframe compatibility mode

Some AI sites block iframe embedding with `X-Frame-Options` or `Content-Security-Policy`. AI Sidecar includes a Declarative Net Request ruleset at `rules/allow-framing-ai-sites.json` that removes:

- `x-frame-options`
- `content-security-policy`
- `content-security-policy-report-only`

This compatibility mode is intentionally limited:

- It only applies to the allowlisted AI domains.
- It only applies to `sub_frame` requests.
- It does not apply to all URLs.
- It does not apply to `main_frame` browsing.
- It is not applied to arbitrary Custom URL domains.

The mode is on by default and can be disabled from Options or the Side Panel toggle.

## Login guidance

AI services may still fail inside an iframe because of login, third-party cookie, storage, or service-specific restrictions. If an AI site appears blank or cannot log in, first log in from a normal Chrome tab, then reload the Side Panel.

## Fallback window mode

If an iframe does not load or login is unreliable, use Open in side window. AI Sidecar creates or reuses a normal Chrome window on the right side and loads the selected AI service there. This usually behaves more like a normal browser session than an embedded iframe.

## Privacy and safety

- AI Sidecar does not send browsing content to any external server.
- It does not read or manipulate AI service DOMs.
- It does not auto-type into ChatGPT, Claude, Gemini, NotebookLM, or Keep.
- It does not auto-submit prompts.
- The context menu and Copy prompt button only create a prompt and copy it to your clipboard after a user action.

## Files

- `manifest.json`
- `src/background/service-worker.ts`
- `src/sidepanel/index.html`
- `src/sidepanel/main.ts`
- `src/sidepanel/sidepanel.css`
- `src/options/index.html`
- `src/options/main.ts`
- `src/options/options.css`
- `src/offscreen/clipboard.html`
- `src/offscreen/clipboard.ts`
- `src/shared/*.ts`
- `rules/allow-framing-ai-sites.json`
