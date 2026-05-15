import { Messages } from "../shared/messages.js";
import type { RuntimeMessage } from "../shared/types.js";

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message?.type !== Messages.OFFSCREEN_COPY_TEXT || message.target !== "offscreen") {
    return false;
  }

  navigator.clipboard.writeText(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: message });
    });

  return true;
});
