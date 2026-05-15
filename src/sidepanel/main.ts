import { Messages } from "../shared/messages.js";
import { BUILT_IN_PRESETS, diagnosticKey, resolveTarget } from "../shared/presets.js";
import { getSettings, normalizeSettings, saveSettings, SETTINGS_KEY } from "../shared/storage.js";
import type { ActivePresetId, DiagnosticEntry, DiagnosticStatus, PresetId, RuntimeMessage, RuntimeResponse, Settings } from "../shared/types.js";

const LOAD_NOTICE_MS = 4500;
const LOAD_TIMEOUT_MS = 8000;

const reloadButton = element<HTMLButtonElement>("reloadButton");
const moreActionsButton = element<HTMLButtonElement>("moreActionsButton");
const statusText = element<HTMLElement>("statusText");
const loadingSpinner = element<HTMLElement>("loadingSpinner");
const elapsedText = element<HTMLElement>("elapsedText");
const currentUrlInput = element<HTMLInputElement>("currentUrlInput");
let aiFrame = element<HTMLIFrameElement>("aiFrame");
const fallbackPanel = element<HTMLElement>("fallbackPanel");
const fallbackServiceName = element<HTMLElement>("fallbackServiceName");
const fallbackOpenTabButton = element<HTMLButtonElement>("fallbackOpenTabButton");
const fallbackOpenWindowButton = element<HTMLButtonElement>("fallbackOpenWindowButton");
const fallbackReloadButton = element<HTMLButtonElement>("fallbackReloadButton");
const setupPanel = element<HTMLElement>("setupPanel");
const setupOptionsButton = element<HTMLButtonElement>("setupOptionsButton");
const diagnosticsDetails = element<HTMLDetailsElement>("diagnosticsDetails");
const diagnosticsTable = element<HTMLTableSectionElement>("diagnosticsTable");
const diagnosticsEnabled = isDebugMode();

let settings: Settings;
let currentUrl = "";
let currentLabel = "";
let loadToken = 0;
let loadNoticeTimer: number | undefined;
let loadTimeoutTimer: number | undefined;
let elapsedTimer: number | undefined;
let loadStartedAt = 0;
let activeDiagnostic: { key: string; token: number; restoreFrameMode: boolean } | null = null;
let applyingLocalFrameMode = false;

void init();

async function init(): Promise<void> {
  diagnosticsDetails.hidden = !diagnosticsEnabled;
  settings = await getSettings();
  syncSettingsUi();
  bindEvents();

  await loadConfiguredTarget();
}

function bindEvents(): void {
  reloadButton.addEventListener("click", () => reloadCurrentUrl());
  fallbackReloadButton.addEventListener("click", () => reloadCurrentUrl());
  fallbackOpenTabButton.addEventListener("click", () => void openCurrentInTab());
  fallbackOpenWindowButton.addEventListener("click", () => void openCurrentInFallbackWindow());
  setupOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  moreActionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]?.newValue) {
      return;
    }

    const previousFrameMode = settings.enableFrameHeaderRelaxation;
    const previousDefaultPresetId = settings.defaultPresetId;
    const previousConfiguredUrl = resolveTarget(settings, settings.defaultPresetId).url;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    syncSettingsUi();

    const target = resolveTarget(settings, settings.defaultPresetId);
    if (previousDefaultPresetId !== settings.defaultPresetId || target.url !== previousConfiguredUrl) {
      void loadConfiguredTarget();
      return;
    }

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

      const presetId = target.dataset.presetId as PresetId | undefined;
      if (!presetId) {
        return;
      }

      if (target.dataset.runDnr !== undefined) {
        void runDiagnostic(presetId, target.dataset.runDnr === "true");
        return;
      }

      if (target.dataset.markDnr !== undefined && target.dataset.markStatus) {
        void markDiagnostic(presetId, target.dataset.markDnr === "true", target.dataset.markStatus as DiagnosticStatus);
      }
    });
  }
}

async function loadConfiguredTarget(): Promise<void> {
  const target = resolveTarget(settings, settings.defaultPresetId);
  if (!target.url) {
    await showSetupState();
    return;
  }

  await loadTarget(target.id, target.label, target.url);
}

async function loadTarget(id: ActivePresetId, label: string, url: string): Promise<void> {
  settings.activePresetId = id;
  settings.lastUrlByPreset[id] = url;
  loadUrl(label, url);
  await saveSettings(settings);
}

function loadUrl(label: string, url: string): void {
  currentUrl = url;
  currentLabel = label;
  currentUrlInput.value = url;
  fallbackServiceName.textContent = label;
  fallbackPanel.hidden = true;
  setupPanel.hidden = true;

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

async function showSetupState(): Promise<void> {
  clearLoadTimers();
  currentUrl = "";
  currentLabel = "";
  currentUrlInput.value = "";
  fallbackPanel.hidden = true;
  setupPanel.hidden = false;
  setLoading(false);
  setStatus("Choose a side panel service in Options.");
  aiFrame.src = "about:blank";
  settings.activePresetId = settings.defaultPresetId;
  await saveSettings(settings);
}

function replaceFrameForLoad(token: number, expectedUrl: string): HTMLIFrameElement {
  const nextFrame = aiFrame.cloneNode(false) as HTMLIFrameElement;
  nextFrame.addEventListener("load", () => {
    completeLoad(token, expectedUrl, "loaded");
  });
  aiFrame.replaceWith(nextFrame);
  aiFrame = nextFrame;
  return nextFrame;
}

function completeLoad(token: number, expectedUrl: string, status: DiagnosticStatus): void {
  if (token !== loadToken || expectedUrl !== currentUrl || aiFrame.src === "about:blank") {
    return;
  }

  if (canonicalUrl(aiFrame.src) !== canonicalUrl(expectedUrl)) {
    return;
  }

  clearLoadTimers();
  fallbackPanel.hidden = true;
  setLoading(false);
  setStatus("");
  updateActiveDiagnostic(status);
}

function reloadCurrentUrl(): void {
  if (!currentUrl) {
    setStatus("No URL is selected.");
    return;
  }
  loadUrl(currentLabel || "AI service", currentUrl);
}

async function openCurrentInTab(): Promise<void> {
  if (!currentUrl) {
    return;
  }
  await chrome.tabs.create({ url: currentUrl });
}

async function openCurrentInFallbackWindow(): Promise<void> {
  if (!currentUrl) {
    return;
  }
  const response = await sendMessage({ type: Messages.OPEN_FALLBACK_WINDOW, url: currentUrl });
  setStatus(response.ok ? "Opened right-side fallback window." : response.error || "Could not open fallback window.");
}

async function requestDnrEnabled(enabled: boolean, suppressStorageReload: boolean): Promise<RuntimeResponse> {
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

async function restoreFrameModeAfterDiagnostic(enabled: boolean): Promise<void> {
  if (settings.enableFrameHeaderRelaxation === enabled) {
    return;
  }

  const response = await requestDnrEnabled(enabled, true);
  if (!response.ok || !response.settings) {
    setStatus(response.error || "Diagnostic saved, but compatibility mode could not be restored.");
    return;
  }

  settings = response.settings;
  renderDiagnostics();
}

async function runDiagnostic(presetId: PresetId, dnrEnabled: boolean): Promise<void> {
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
    setStatus(response.error || "Could not update compatibility mode for diagnostics.");
    return;
  }

  settings = response.settings;

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

  await loadTarget(presetId, preset.label, preset.url);
  if (activeDiagnostic?.key === key) {
    activeDiagnostic = { ...activeDiagnostic, token: loadToken };
  }
}

async function markDiagnostic(presetId: PresetId, dnrEnabled: boolean, status: DiagnosticStatus): Promise<void> {
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

function updateActiveDiagnostic(status: DiagnosticStatus, message?: string): void {
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

function syncSettingsUi(): void {
  renderDiagnostics();
}

function renderDiagnostics(): void {
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

function statusCell(entry: DiagnosticEntry | undefined): HTMLTableCellElement {
  const td = document.createElement("td");
  const span = document.createElement("span");
  const status = entry?.status || "untested";
  span.className = `status-pill status-${status}`;
  span.textContent = status.replace("manual-", "");
  td.append(span);
  return td;
}

function runButtons(presetId: PresetId): HTMLTableCellElement {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "mini-actions";
  wrap.append(diagnosticButton("Run off", presetId, false, "runDnr"));
  wrap.append(diagnosticButton("Run on", presetId, true, "runDnr"));
  td.append(wrap);
  return td;
}

function markButtons(presetId: PresetId): HTMLTableCellElement {
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

function diagnosticButton(label: string, presetId: PresetId, dnrEnabled: boolean, dataKey: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.presetId = presetId;
  button.dataset[dataKey] = String(dnrEnabled);
  return button;
}

function markButton(label: string, presetId: PresetId, dnrEnabled: boolean, status: DiagnosticStatus): HTMLButtonElement {
  const button = diagnosticButton(label, presetId, dnrEnabled, "markDnr");
  button.dataset.markStatus = status;
  return button;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function sendMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function clearLoadTimers(): void {
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

function setLoading(loading: boolean): void {
  loadingSpinner.hidden = !loading;
  if (!loading) {
    elapsedText.hidden = true;
  }
}

function startElapsedTimer(): void {
  loadStartedAt = Date.now();
  updateElapsedText();
  elapsedText.hidden = false;
  elapsedTimer = window.setInterval(updateElapsedText, 1000);
}

function updateElapsedText(): void {
  const seconds = Math.max(0, Math.floor((Date.now() - loadStartedAt) / 1000));
  elapsedText.textContent = `${seconds}s`;
}

function canonicalUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

function setStatus(text: string): void {
  statusText.textContent = text;
}

function isDebugMode(): boolean {
  const debug = new URLSearchParams(window.location.search).get("debug");
  return debug !== null && debug !== "0" && debug.toLowerCase() !== "false";
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element: ${id}`);
  }
  return found as T;
}
