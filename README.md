# anyside

anyside is a Manifest V3 Chrome extension that keeps AI services in Chrome's Side Panel while you browse normally in the main tab.

It displays a local extension page in the Side Panel and loads the selected AI service inside an iframe. It never sets `side_panel.default_path` to an external URL.

## Included services

- ChatGPT: `https://chatgpt.com/`
- Claude: `https://claude.ai/`
- Gemini: `https://gemini.google.com/`
- NotebookLM: `https://notebooklm.google.com/`
- Google Keep: `https://keep.google.com/`
- Custom URL

## Build

Install dependencies, typecheck, and build the extension JavaScript into `dist/`:

```sh
npm install
npm run typecheck
npm run build
```

For local development without invoking the TypeScript compiler output pipeline directly, the fallback build helper strips TypeScript into `dist/`:

```sh
npm run build:local
```

To create a Chrome extension zip from only the files needed at runtime:

```sh
npm run release:zip
```

## Load as an unpacked extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project folder.
5. Click the anyside extension icon, or press `Command+Shift+Y` on macOS / `Ctrl+Shift+Y` elsewhere.

## Side Panel UI

The Side Panel keeps the AI frame visually primary. Its top bar shows a compact address pill with the selected service host, while full URLs remain available through the field title and accessibility label. Successful loads do not leave a visible status message; loading, timeout, and error states use a small transient banner or fallback actions.

Custom URLs are managed in Options. HTTPS URLs can be entered with or without `https://`; local testing URLs may use `http://localhost`, `http://127.0.0.1`, or the same localhost inputs without a protocol.

## Developer diagnostics

Developer diagnostics are hidden from the normal Side Panel UI. Open the side panel page with `?debug=1` to test each bundled AI service with iframe compatibility mode off and on.

Chrome extensions cannot inspect the inside of cross-origin iframes, so diagnostics record load/timeout signals and let you manually mark whether the service was visibly usable.

Each diagnostic temporarily changes iframe compatibility mode for the tested service, restores the previous setting afterward, and returns the visible Side Panel service to what was shown before the diagnostic run.

## Iframe compatibility mode

Some AI sites block iframe embedding with `X-Frame-Options` or `Content-Security-Policy`. anyside includes a Declarative Net Request ruleset at `rules/allow-framing-ai-sites.json` that removes:

- `x-frame-options`
- `content-security-policy`
- `content-security-policy-report-only`

This compatibility mode is intentionally limited:

- It only applies to the allowlisted AI domains.
- It only applies to `sub_frame` requests.
- It does not apply to all URLs.
- It does not apply to `main_frame` browsing.
- It is not applied to arbitrary Custom URL domains.

Because DNR rules operate at the browser request level, the rule can affect allowlisted `sub_frame` requests made by extension pages while the ruleset is enabled. The mode is on by default and can be disabled from Options.

## Login guidance

AI services may still fail inside an iframe because of login, third-party cookie, storage, or service-specific restrictions. If an AI site appears blank or cannot log in, first log in from a normal Chrome tab, then reload the Side Panel.

## Fallback window mode

If an iframe does not load or login is unreliable, use Open in side window. anyside creates or reuses a normal Chrome window on the right side and loads the selected AI service there. This usually behaves more like a normal browser session than an embedded iframe.

## Privacy and safety

- anyside does not send browsing content to any external server.
- It does not read or manipulate AI service DOMs.
- It does not auto-type into ChatGPT, Claude, Gemini, NotebookLM, or Keep.
- It does not auto-submit prompts.
- The context menu only creates a prompt and copies it to your clipboard after a user action.

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
