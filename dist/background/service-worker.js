import { Messages } from "../shared/messages.js";
import { createActiveTabPrompt, createSelectionPrompt } from "../shared/prompt.js";
import { FALLBACK_WINDOW_KEY, getSettings, saveSettings, updateSettings } from "../shared/storage.js";


const DNR_RULESET_ID = "allow_framing_ai_sites";
const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/clipboard.html";
const MENU_SELECTION_ID = "ask-anyside-selection";
const MENU_OPEN_ID = "open-anyside";
const LEGACY_FALLBACK_WINDOW_KEY = "aiSidecar.fallbackWindow";

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtension({ resetMenus: true });
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtension({ resetMenus: false });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION_ID && info.selectionText) {
    void handleSelectionContextMenu(info.selectionText, tab);
    return;
  }

  if (info.menuItemId === MENU_OPEN_ID) {
    void openSidePanel(tab?.windowId);
  }
});

chrome.runtime.onMessage.addListener((message                , sender, sendResponse) => {
  if (message?.type === Messages.OFFSCREEN_COPY_TEXT && message.target === "offscreen") {
    return false;
  }

  handleRuntimeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));

  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  void clearFallbackWindowIfNeeded(windowId);
});

void initializeExtension({ resetMenus: false });

async function initializeExtension(options                         )                {
  const settings = await getSettings();
  await saveSettings(settings);
  await configureSidePanel();
  await syncDnrFromStorage();
  if (options.resetMenus) {
    await createContextMenus();
  }
}

async function configureSidePanel()                {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function createContextMenus()                {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: "Ask anyside about selection",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: MENU_OPEN_ID,
    title: "Open anyside",
    contexts: ["all"]
  });
}

async function handleRuntimeMessage(message                , sender                              )                           {
  switch (message?.type) {
    case Messages.SET_DNR_ENABLED: {
      const settings = await setDnrEnabled(message.enabled);
      return { ok: true, settings };
    }

    case Messages.COPY_ACTIVE_TAB_PROMPT: {
      const tab = await getActiveTab();
      const text = createActiveTabPrompt(tab?.title, tab?.url);
      await copyText(text);
      await flashBadge("Copied");
      return { ok: true, text };
    }

    case Messages.COPY_TEXT: {
      await copyText(message.text);
      await flashBadge("Copied");
      return { ok: true, text: message.text };
    }

    case Messages.OPEN_FALLBACK_WINDOW: {
      const windowId = await openFallbackWindow(message.url, sender.tab?.windowId);
      return { ok: true, windowId };
    }

    case Messages.OPEN_SIDE_PANEL: {
      await openSidePanel(sender.tab?.windowId);
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unsupported message." };
  }
}

async function syncDnrFromStorage()                {
  const settings = await getSettings();
  await applyDnrSetting(settings.enableFrameHeaderRelaxation);
}

async function setDnrEnabled(enabled         ) {
  await applyDnrSetting(enabled);
  return updateSettings((settings) => {
    settings.enableFrameHeaderRelaxation = enabled;
  });
}

async function applyDnrSetting(enabled         )                {
  const update = enabled
    ? { enableRulesetIds: [DNR_RULESET_ID], disableRulesetIds: [] }
    : { enableRulesetIds: [], disableRulesetIds: [DNR_RULESET_ID] };
  await chrome.declarativeNetRequest.updateEnabledRulesets(update);
}

async function openSidePanel(windowId         )                {
  if (!chrome.sidePanel?.open) {
    return;
  }

  const resolvedWindowId = windowId ?? (await getActiveTab())?.windowId;
  if (resolvedWindowId !== undefined) {
    await chrome.sidePanel.open({ windowId: resolvedWindowId });
  }
}

async function handleSelectionContextMenu(selectionText        , tab                  )                {
  const panelPromise = tab?.windowId !== undefined
    ? openSidePanel(tab.windowId).catch(() => undefined)
    : Promise.resolve();
  const text = createSelectionPrompt(selectionText);
  await copyText(text, tab);
  await flashBadge("Copied");
  await panelPromise;
}

async function getActiveTab()                                       {
  const currentWindowTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentWindowTabs[0]) {
    return currentWindowTabs[0];
  }

  const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return focusedTabs[0];
}

async function ensureOffscreenDocument()                {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Copy anyside prompts from context menus and extension UI."
  });
}

async function copyText(text        , tab                  )                {
  if (tab?.id !== undefined && canInjectIntoTab(tab)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (value        ) => {
          await navigator.clipboard.writeText(value);
        },
        args: [text]
      });
      return;
    } catch {
      // Fall back to the offscreen helper for extension pages and restricted tabs.
    }
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: Messages.OFFSCREEN_COPY_TEXT,
    target: "offscreen",
    text
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Clipboard copy failed.");
  }
}

function canInjectIntoTab(tab                 )          {
  const url = tab.url || "";
  return /^(https?:|file:)/.test(url);
}

async function flashBadge(text        )                {
  await chrome.action.setBadgeBackgroundColor({ color: "#126b46" });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, 1400);
}

async function openFallbackWindow(url        , senderWindowId         )                              {
  const state = await getFallbackWindowState();
  const reused = await tryReuseFallbackWindow(state, url);
  if (reused !== undefined) {
    return reused;
  }

  const mainWindow = senderWindowId !== undefined
    ? await chrome.windows.get(senderWindowId).catch(() => undefined)
    : await chrome.windows.getLastFocused().catch(() => undefined);

  const layout = calculateFallbackLayout(mainWindow);
  if (mainWindow?.id !== undefined && layout.main) {
    await chrome.windows.update(mainWindow.id, layout.main).catch(() => undefined);
  }

  const created = await chrome.windows.create({
    url,
    type: "normal",
    focused: true,
    ...layout.fallback
  });

  await saveFallbackWindowState({
    windowId: created.id,
    tabId: created.tabs?.[0]?.id,
    url,
    updatedAt: Date.now()
  });

  return created.id;
}

async function tryReuseFallbackWindow(state                     , url        )                              {
  if (state.windowId === undefined) {
    return undefined;
  }

  try {
    const existing = await chrome.windows.get(state.windowId, { populate: true });
    const tabId = state.tabId ?? existing.tabs?.[0]?.id;
    if (tabId !== undefined) {
      await chrome.tabs.update(tabId, { url, active: true });
    } else {
      await chrome.tabs.create({ windowId: existing.id, url, active: true });
    }
    await chrome.windows.update(existing.id          , { focused: true });
    await saveFallbackWindowState({ ...state, url, updatedAt: Date.now() });
    return existing.id;
  } catch {
    await saveFallbackWindowState({});
    return undefined;
  }
}

function calculateFallbackLayout(window                                   )


  {
  const left = window?.left ?? 80;
  const top = window?.top ?? 80;
  const width = Math.max(window?.width ?? 1280, 900);
  const height = Math.max(window?.height ?? 820, 600);
  const fallbackWidth = Math.min(560, Math.max(420, Math.round(width * 0.34)));
  const mainWidth = Math.max(640, width - fallbackWidth);

  return {
    main: window?.id !== undefined
      ? { left, top, width: mainWidth, height, focused: false }
      : undefined,
    fallback: {
      left: left + mainWidth,
      top,
      width: fallbackWidth,
      height
    }
  };
}

async function getFallbackWindowState()                               {
  const stored = await chrome.storage.local.get([FALLBACK_WINDOW_KEY, LEGACY_FALLBACK_WINDOW_KEY]);
  if (!stored[FALLBACK_WINDOW_KEY] && stored[LEGACY_FALLBACK_WINDOW_KEY]) {
    await chrome.storage.local.set({ [FALLBACK_WINDOW_KEY]: stored[LEGACY_FALLBACK_WINDOW_KEY] });
    await chrome.storage.local.remove(LEGACY_FALLBACK_WINDOW_KEY);
  }

  const state = stored[FALLBACK_WINDOW_KEY] || stored[LEGACY_FALLBACK_WINDOW_KEY];
  return state && typeof state === "object" ? state                        : {};
}

async function saveFallbackWindowState(state                     )                {
  await chrome.storage.local.set({ [FALLBACK_WINDOW_KEY]: state });
}

async function clearFallbackWindowIfNeeded(windowId        )                {
  const state = await getFallbackWindowState();
  if (state.windowId === windowId) {
    await saveFallbackWindowState({});
  }
}

function errorMessage(error         )         {
  return error instanceof Error ? error.message : String(error);
}

