import { Messages } from "../shared/messages.js";
import { BUILT_IN_PRESETS, CUSTOM_PRESET_ID, diagnosticKey, makeCustomPresetId, resolveTarget } from "../shared/presets.js";
import { createActiveTabPrompt } from "../shared/prompt.js";
import { getSettings, normalizeSettings, saveSettings, SETTINGS_KEY } from "../shared/storage.js";
                                                                                                                                                 
import { normalizeUserUrl } from "../shared/url.js";

const LOAD_NOTICE_MS = 4500;
const LOAD_TIMEOUT_MS = 8000;

const presetSelect = element                   ("presetSelect");
const customUrlControls = element             ("customUrlControls");
const customUrlInput = element                  ("customUrlInput");
const applyCustomUrlButton = element                   ("applyCustomUrlButton");
const copyPageButton = element                   ("copyPageButton");
const reloadButton = element                   ("reloadButton");
const openTabButton = element                   ("openTabButton");
const openWindowButton = element                   ("openWindowButton");
const optionsButton = element                   ("optionsButton");
const moreActionsMenu = element                    ("moreActionsMenu");
const statusText = element             ("statusText");
const loadingSpinner = element             ("loadingSpinner");
const elapsedText = element             ("elapsedText");
const dnrToggle = element                  ("dnrToggle");
const customHelp = element             ("customHelp");
const currentUrlInput = element                  ("currentUrlInput");
let aiFrame = element                   ("aiFrame");
const fallbackPanel = element             ("fallbackPanel");
const fallbackServiceName = element             ("fallbackServiceName");
const fallbackOpenTabButton = element                   ("fallbackOpenTabButton");
const fallbackOpenWindowButton = element                   ("fallbackOpenWindowButton");
const fallbackReloadButton = element                   ("fallbackReloadButton");
const diagnosticsDetails = element                    ("diagnosticsDetails");
const diagnosticsTable = element                         ("diagnosticsTable");
const diagnosticsEnabled = isDebugMode();

let settings          ;
let currentUrl = "";
let currentLabel = "";
let loadToken = 0;
let loadNoticeTimer                    ;
let loadTimeoutTimer                    ;
let elapsedTimer                    ;
let loadStartedAt = 0;
let activeDiagnostic                                                                   = null;
let applyingLocalFrameMode = false;

void init();

async function init()                {
  diagnosticsDetails.hidden = !diagnosticsEnabled;
  settings = await getSettings();
  syncSettingsUi();
  bindEvents();

  const target = resolveTarget(settings);
  if (target.url) {
    await loadTarget(target.id, target.label, target.url);
  } else {
    setStatus("Enter a Custom URL, then press Enter.");
  }
  presetSelect.focus({ preventScroll: true });
}

function bindEvents()       {
  presetSelect.addEventListener("change", () => {
    void handlePresetChange();
  });

  applyCustomUrlButton.addEventListener("click", () => {
    void applyCustomUrl();
  });

  customUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void applyCustomUrl();
    }
  });

  reloadButton.addEventListener("click", () => reloadCurrentUrl());
  fallbackReloadButton.addEventListener("click", () => reloadCurrentUrl());
  openTabButton.addEventListener("click", () => {
    closeMoreActions();
    void openCurrentInTab();
  });
  fallbackOpenTabButton.addEventListener("click", () => void openCurrentInTab());
  openWindowButton.addEventListener("click", () => {
    closeMoreActions();
    void openCurrentInFallbackWindow();
  });
  fallbackOpenWindowButton.addEventListener("click", () => void openCurrentInFallbackWindow());
  optionsButton.addEventListener("click", () => {
    closeMoreActions();
    chrome.runtime.openOptionsPage();
  });

  copyPageButton.addEventListener("click", () => {
    void copyActivePagePrompt();
  });

  dnrToggle.addEventListener("change", () => {
    void setDnrEnabled(dnrToggle.checked);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]?.newValue) {
      return;
    }

    const previousFrameMode = settings.enableFrameHeaderRelaxation;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    syncSettingsUi();

    if (previousFrameMode !== settings.enableFrameHeaderRelaxation && !applyingLocalFrameMode) {
      setStatus(`Compatibility mode ${settings.enableFrameHeaderRelaxation ? "enabled" : "disabled"}.`);
      if (currentUrl) {
        reloadCurrentUrl();
      }
    }
  });

  if (diagnosticsEnabled) {
    diagnosticsTable.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const presetId = target.dataset.presetId                        ;
      if (!presetId) {
        return;
      }

      if (target.dataset.runDnr !== undefined) {
        void runDiagnostic(presetId, target.dataset.runDnr === "true");
        return;
      }

      if (target.dataset.markDnr !== undefined && target.dataset.markStatus) {
        void markDiagnostic(presetId, target.dataset.markDnr === "true", target.dataset.markStatus                    );
      }
    });
  }
}

async function handlePresetChange()                {
  const activeId = presetSelect.value                  ;
  settings.activePresetId = activeId;
  updateCustomUrlUi(activeId);

  const target = resolveTarget(settings, activeId);
  if (!target.url) {
    await saveSettings(settings);
    setStatus("Enter a Custom URL, then press Enter.");
    return;
  }

  await loadTarget(target.id, target.label, target.url);
}

async function applyCustomUrl()                {
  const normalized = normalizeUserUrl(customUrlInput.value);
  if (!normalized) {
    setStatus("Use HTTPS, or localhost / 127.0.0.1 for local testing.");
    return;
  }

  presetSelect.value = CUSTOM_PRESET_ID;
  settings.activePresetId = CUSTOM_PRESET_ID;
  settings.lastUrlByPreset[CUSTOM_PRESET_ID] = normalized;
  await loadTarget(CUSTOM_PRESET_ID, "Custom URL", normalized);
}

async function loadTarget(id                , label        , url        )                {
  settings.activePresetId = id;
  settings.lastUrlByPreset[id] = url;
  await saveSettings(settings);
  loadUrl(label, url);
}

function loadUrl(label        , url        )       {
  currentUrl = url;
  currentLabel = label;
  currentUrlInput.value = url;
  fallbackServiceName.textContent = label;
  fallbackPanel.hidden = true;

  const token = ++loadToken;
  const frame = replaceFrameForLoad(token, url);
  clearLoadTimers();
  setStatus(`Loading ${label}...`);
  setLoading(true);
  startElapsedTimer();
  loadNoticeTimer = window.setTimeout(() => {
    if (token !== loadToken) {
      return;
    }
    setStatus(`${label} is still loading. You can keep waiting or use the menu to open it outside the frame.`);
  }, LOAD_NOTICE_MS);
  loadTimeoutTimer = window.setTimeout(() => {
    if (token !== loadToken) {
      return;
    }
    setStatus(`${label} is taking longer than expected.`);
    fallbackPanel.hidden = false;
    updateActiveDiagnostic("timeout", "Timed out waiting for the frame to load.");
  }, LOAD_TIMEOUT_MS);

  frame.src = "about:blank";
  window.setTimeout(() => {
    if (token === loadToken) {
      frame.src = url;
    }
  }, 0);
}

function replaceFrameForLoad(token        , expectedUrl        )                    {
  const nextFrame = aiFrame.cloneNode(false)                     ;
  nextFrame.addEventListener("load", () => {
    completeLoad(token, expectedUrl, "loaded");
  });
  aiFrame.replaceWith(nextFrame);
  aiFrame = nextFrame;
  return nextFrame;
}

function completeLoad(token        , expectedUrl        , status                  )       {
  if (token !== loadToken || expectedUrl !== currentUrl || aiFrame.src === "about:blank") {
    return;
  }

  if (canonicalUrl(aiFrame.src) !== canonicalUrl(expectedUrl)) {
    return;
  }

  clearLoadTimers();
  fallbackPanel.hidden = true;
  setLoading(false);
  setStatus(`${currentLabel} loaded. If the frame looks blank, open it in a side window.`);
  updateActiveDiagnostic(status);
}

function reloadCurrentUrl()       {
  if (!currentUrl) {
    setStatus("No URL is selected.");
    return;
  }
  loadUrl(currentLabel || "AI service", currentUrl);
}

async function openCurrentInTab()                {
  if (!currentUrl) {
    return;
  }
  await chrome.tabs.create({ url: currentUrl });
}

async function openCurrentInFallbackWindow()                {
  if (!currentUrl) {
    return;
  }
  const response = await sendMessage({ type: Messages.OPEN_FALLBACK_WINDOW, url: currentUrl });
  setStatus(response.ok ? "Opened right-side fallback window." : response.error || "Could not open fallback window.");
}

async function copyActivePagePrompt()                {
  try {
    const tab = await getActiveTab();
    const text = createActiveTabPrompt(tab?.title, tab?.url);
    await navigator.clipboard.writeText(text);
    setStatus("Current page prompt copied.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Copy failed.");
  }
}

async function getActiveTab()                                       {
  const currentWindowTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentWindowTabs[0]) {
    return currentWindowTabs[0];
  }

  const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return focusedTabs[0];
}

async function setDnrEnabled(enabled         )                {
  dnrToggle.disabled = true;
  const response = await requestDnrEnabled(enabled, true);
  dnrToggle.disabled = false;

  if (!response.ok || !response.settings) {
    dnrToggle.checked = settings.enableFrameHeaderRelaxation;
    setStatus(response.error || "Could not update compatibility mode.");
    return;
  }

  settings = response.settings;
  dnrToggle.checked = settings.enableFrameHeaderRelaxation;
  setStatus(`Compatibility mode ${settings.enableFrameHeaderRelaxation ? "enabled" : "disabled"}.`);
  renderDiagnostics();
  if (currentUrl) {
    reloadCurrentUrl();
  }
}

async function requestDnrEnabled(enabled         , suppressStorageReload         )                           {
  if (suppressStorageReload) {
    applyingLocalFrameMode = true;
  }

  try {
    return await sendMessage({ type: Messages.SET_DNR_ENABLED, enabled });
  } finally {
    if (suppressStorageReload) {
      applyingLocalFrameMode = false;
    }
  }
}

async function restoreFrameModeAfterDiagnostic(enabled         )                {
  if (settings.enableFrameHeaderRelaxation === enabled) {
    dnrToggle.checked = enabled;
    return;
  }

  const response = await requestDnrEnabled(enabled, true);
  if (!response.ok || !response.settings) {
    dnrToggle.checked = settings.enableFrameHeaderRelaxation;
    setStatus(response.error || "Diagnostic saved, but compatibility mode could not be restored.");
    return;
  }

  settings = response.settings;
  dnrToggle.checked = settings.enableFrameHeaderRelaxation;
  renderDiagnostics();
}

async function runDiagnostic(presetId          , dnrEnabled         )                {
  const preset = BUILT_IN_PRESETS.find((item) => item.id === presetId);
  if (!preset) {
    return;
  }

  if (activeDiagnostic) {
    const restoreFrameMode = activeDiagnostic.restoreFrameMode;
    activeDiagnostic = null;
    await restoreFrameModeAfterDiagnostic(restoreFrameMode);
  }

  const restoreFrameMode = settings.enableFrameHeaderRelaxation;
  const response = await requestDnrEnabled(dnrEnabled, true);
  if (!response.ok || !response.settings) {
    dnrToggle.checked = settings.enableFrameHeaderRelaxation;
    setStatus(response.error || "Could not update compatibility mode for diagnostics.");
    return;
  }

  settings = response.settings;
  dnrToggle.checked = settings.enableFrameHeaderRelaxation;

  const key = diagnosticKey(presetId, dnrEnabled);
  const token = loadToken + 1;
  activeDiagnostic = { key, token, restoreFrameMode };
  settings.diagnostics[key] = {
    presetId,
    url: preset.url,
    dnrEnabled,
    status: "pending",
    startedAt: Date.now(),
    message: `Diagnostic started with compatibility mode ${dnrEnabled ? "on" : "off"}.`
  };
  await saveSettings(settings);
  renderDiagnostics();
  setStatus(`Testing ${preset.label} with compatibility mode ${dnrEnabled ? "on" : "off"}...`);

  presetSelect.value = presetId;
  updateCustomUrlUi(presetId);
  await loadTarget(presetId, preset.label, preset.url);
  if (activeDiagnostic?.key === key) {
    activeDiagnostic = { ...activeDiagnostic, token: loadToken };
  }
}

async function markDiagnostic(presetId          , dnrEnabled         , status                  )                {
  const key = diagnosticKey(presetId, dnrEnabled);
  const entry = settings.diagnostics[key];
  const preset = BUILT_IN_PRESETS.find((item) => item.id === presetId);
  settings.diagnostics[key] = {
    presetId,
    dnrEnabled,
    url: entry?.url || preset?.url || "",
    status,
    startedAt: entry?.startedAt || Date.now(),
    finishedAt: Date.now(),
    message: status === "manual-pass" ? "Marked visible by user." : "Marked failed by user."
  };
  await saveSettings(settings);
  renderDiagnostics();
  setStatus("Diagnostic result saved.");
}

function updateActiveDiagnostic(status                  , message         )       {
  const diagnostic = activeDiagnostic;
  if (!diagnostic || diagnostic.token !== loadToken) {
    return;
  }

  const entry = settings.diagnostics[diagnostic.key];
  if (!entry) {
    return;
  }

  settings.diagnostics[diagnostic.key] = {
    ...entry,
    status,
    finishedAt: Date.now(),
    message
  };
  activeDiagnostic = null;
  void saveSettings(settings)
    .then((saved) => {
      settings = saved;
      renderDiagnostics();
      return restoreFrameModeAfterDiagnostic(diagnostic.restoreFrameMode);
    })
    .catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
}

function renderPresetSelect()       {
  presetSelect.textContent = "";

  for (const preset of BUILT_IN_PRESETS) {
    presetSelect.append(option(preset.id, preset.label));
  }

  presetSelect.append(option(CUSTOM_PRESET_ID, "Custom URL"));

  for (const customUrl of settings.customUrls) {
    presetSelect.append(option(makeCustomPresetId(customUrl.id), customUrl.label));
  }
}

function syncSettingsUi()       {
  renderPresetSelect();
  presetSelect.value = settings.activePresetId;
  updateCustomUrlUi(settings.activePresetId);
  dnrToggle.checked = settings.enableFrameHeaderRelaxation;
  renderDiagnostics();
}

function updateCustomUrlUi(activeId                )       {
  const target = resolveTarget(settings, activeId);
  const show = activeId === CUSTOM_PRESET_ID;
  customUrlControls.hidden = !show;
  customHelp.hidden = !show;
  if (show) {
    customUrlInput.value = target.url;
    customUrlInput.focus({ preventScroll: true });
  } else {
    customUrlInput.value = "";
  }
}

function renderDiagnostics()       {
  diagnosticsTable.textContent = "";
  if (!diagnosticsEnabled) {
    return;
  }

  for (const preset of BUILT_IN_PRESETS) {
    const row = document.createElement("tr");
    row.append(cell(preset.label));
    row.append(statusCell(settings.diagnostics[diagnosticKey(preset.id, false)]));
    row.append(statusCell(settings.diagnostics[diagnosticKey(preset.id, true)]));
    row.append(runButtons(preset.id));
    row.append(markButtons(preset.id));
    diagnosticsTable.append(row);
  }
}

function statusCell(entry                             )                       {
  const td = document.createElement("td");
  const span = document.createElement("span");
  const status = entry?.status || "untested";
  span.className = `status-pill status-${status}`;
  span.textContent = status.replace("manual-", "");
  td.append(span);
  return td;
}

function runButtons(presetId          )                       {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "mini-actions";
  wrap.append(diagnosticButton("Run off", presetId, false, "runDnr"));
  wrap.append(diagnosticButton("Run on", presetId, true, "runDnr"));
  td.append(wrap);
  return td;
}

function markButtons(presetId          )                       {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "mini-actions";
  wrap.append(markButton("Off visible", presetId, false, "manual-pass"));
  wrap.append(markButton("Off blocked", presetId, false, "manual-fail"));
  wrap.append(markButton("On visible", presetId, true, "manual-pass"));
  wrap.append(markButton("On blocked", presetId, true, "manual-fail"));
  td.append(wrap);
  return td;
}

function diagnosticButton(label        , presetId          , dnrEnabled         , dataKey        )                    {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.presetId = presetId;
  button.dataset[dataKey] = String(dnrEnabled);
  return button;
}

function markButton(label        , presetId          , dnrEnabled         , status                  )                    {
  const button = diagnosticButton(label, presetId, dnrEnabled, "markDnr");
  button.dataset.markStatus = status;
  return button;
}

function option(value        , label        )                    {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function cell(text        )                       {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function sendMessage(message                )                           {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function closeMoreActions()       {
  moreActionsMenu.open = false;
}

function clearLoadTimers()       {
  if (loadNoticeTimer !== undefined) {
    window.clearTimeout(loadNoticeTimer);
    loadNoticeTimer = undefined;
  }
  if (loadTimeoutTimer !== undefined) {
    window.clearTimeout(loadTimeoutTimer);
    loadTimeoutTimer = undefined;
  }
  if (elapsedTimer !== undefined) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }
  elapsedText.hidden = true;
  elapsedText.textContent = "";
}

function setLoading(loading         )       {
  loadingSpinner.hidden = !loading;
  if (!loading) {
    elapsedText.hidden = true;
  }
}

function startElapsedTimer()       {
  loadStartedAt = Date.now();
  updateElapsedText();
  elapsedText.hidden = false;
  elapsedTimer = window.setInterval(updateElapsedText, 1000);
}

function updateElapsedText()       {
  const seconds = Math.max(0, Math.floor((Date.now() - loadStartedAt) / 1000));
  elapsedText.textContent = `${seconds}s`;
}

function canonicalUrl(value        )         {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

function setStatus(text        )       {
  statusText.textContent = text;
}

function isDebugMode()          {
  const debug = new URLSearchParams(window.location.search).get("debug");
  return debug !== null && debug !== "0" && debug.toLowerCase() !== "false";
}

function element                       (id        )    {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element: ${id}`);
  }
  return found     ;
}

