import { Messages } from "../shared/messages.js";


chrome.runtime.onMessage.addListener((message                , _sender, sendResponse) => {
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

