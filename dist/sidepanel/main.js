import { Messages } from "../shared/messages.js";
import { BUILT_IN_PRESETS, diagnosticKey, resolveTarget } from "../shared/presets.js";
import { getSettings, normalizeSettings, saveSettings, SETTINGS_KEY } from "../shared/storage.js";
const LOAD_NOTICE_MS = 4500;
const LOAD_TIMEOUT_MS = 8000;
const LOCAL_FRAME_MODE_SUPPRESSION_MS = 2000;
const statusLive = element("statusLive");
const statusBanner = element("statusBanner");
const statusBannerText = element("statusBannerText");
const reloadButton = element("reloadButton");
const moreActionsButton = element("moreActionsButton");
const statusText = element("statusText");
const loadingSpinner = element("loadingSpinner");
const elapsedText = element("elapsedText");
const currentUrlInput = element("currentUrlInput");
let aiFrame = element("aiFrame");
const fallbackPanel = element("fallbackPanel");
const fallbackServiceName = element("fallbackServiceName");
const fallbackReason = element("fallbackReason");
const fallbackOpenTabButton = element("fallbackOpenTabButton");
const fallbackOpenWindowButton = element("fallbackOpenWindowButton");
const fallbackReloadButton = element("fallbackReloadButton");
const setupPanel = element("setupPanel");
const setupOptionsButton = element("setupOptionsButton");
const diagnosticsDetails = element("diagnosticsDetails");
const diagnosticsTable = element("diagnosticsTable");
const diagnosticsEnabled = isDebugMode();
let settings;
let currentUrl = "";
let currentLabel = "";
let loadToken = 0;
let settledLoadToken;
let loadNoticeTimer;
let loadTimeoutTimer;
let elapsedTimer;
let loadStartedAt = 0;
let activeDiagnostic = null;
let localFrameModeReloadSuppression = null;
void init();
async function init() {
    diagnosticsDetails.hidden = !diagnosticsEnabled;
    settings = await getSettings();
    syncSettingsUi();
    bindEvents();
    await loadConfiguredTarget();
}
function bindEvents() {
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
        const previousConfiguredTarget = resolveTarget(settings, settings.defaultPresetId);
        settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
        syncSettingsUi();
        const target = resolveTarget(settings, settings.defaultPresetId);
        if (previousDefaultPresetId !== settings.defaultPresetId || target.url !== previousConfiguredTarget.url) {
            void loadConfiguredTarget();
            return;
        }
        if (currentUrl === target.url && currentLabel !== target.label) {
            currentLabel = target.label;
            fallbackServiceName.textContent = target.label;
        }
        if (previousFrameMode !== settings.enableFrameHeaderRelaxation) {
            if (shouldSuppressLocalFrameModeReload(settings.enableFrameHeaderRelaxation)) {
                return;
            }
            if (diagnosticsEnabled) {
                setStatus(`Frame compatibility mode ${settings.enableFrameHeaderRelaxation ? "enabled" : "disabled"}.`, "diagnostic");
            }
            else {
                setStatus("Settings updated.", "idle");
            }
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
            const presetId = target.dataset.presetId;
            if (!presetId) {
                return;
            }
            if (target.dataset.runDnr !== undefined) {
                void runDiagnostic(presetId, target.dataset.runDnr === "true");
                return;
            }
            if (target.dataset.markDnr !== undefined && target.dataset.markStatus) {
                void markDiagnostic(presetId, target.dataset.markDnr === "true", target.dataset.markStatus);
            }
        });
    }
}
async function loadConfiguredTarget() {
    const target = resolveTarget(settings, settings.defaultPresetId);
    if (!target.url) {
        await showSetupState();
        return;
    }
    await loadTarget(target.id, target.label, target.url);
}
async function loadTarget(id, label, url) {
    settings.activePresetId = id;
    settings.lastUrlByPreset[id] = url;
    loadUrl(label, url);
    await saveSettings(settings);
}
function loadUrl(label, url, options = {}) {
    currentUrl = url;
    currentLabel = label;
    updateCurrentUrlDisplay(url);
    fallbackServiceName.textContent = label;
    fallbackReason.textContent = defaultFallbackReason();
    fallbackPanel.hidden = true;
    setupPanel.hidden = true;
    const token = ++loadToken;
    settledLoadToken = undefined;
    const frame = replaceFrameForLoad(token, url);
    clearLoadTimers();
    setStatus(loadingStatusMessage(label, options), options.diagnostic ? "diagnostic" : "loading");
    setLoading(true);
    startElapsedTimer();
    loadNoticeTimer = window.setTimeout(() => {
        if (token !== loadToken || settledLoadToken === token) {
            return;
        }
        setStatus(loadNoticeMessage(label, options), options.diagnostic ? "diagnostic" : "loading");
        elapsedText.hidden = false;
    }, LOAD_NOTICE_MS);
    loadTimeoutTimer = window.setTimeout(() => {
        if (token !== loadToken || settledLoadToken === token) {
            return;
        }
        settledLoadToken = token;
        clearLoadTimers();
        setLoading(false);
        setStatus(timeoutStatusMessage(label, options), "warning");
        fallbackReason.textContent = timeoutFallbackReason(options);
        fallbackPanel.hidden = false;
        updateActiveDiagnostic("timeout", "Timed out waiting for the frame to load.");
    }, LOAD_TIMEOUT_MS);
    frame.src = "about:blank";
    window.setTimeout(() => {
        if (token === loadToken) {
            frame.src = url;
        }
    }, 0);
    return token;
}
async function showSetupState() {
    clearLoadTimers();
    settledLoadToken = undefined;
    currentUrl = "";
    currentLabel = "";
    updateCurrentUrlDisplay("");
    fallbackPanel.hidden = true;
    setupPanel.hidden = false;
    setLoading(false);
    setStatus("Choose a side panel service in Options.", "idle");
    aiFrame.src = "about:blank";
    settings.activePresetId = settings.defaultPresetId;
    await saveSettings(settings);
}
function replaceFrameForLoad(token, expectedUrl) {
    const nextFrame = aiFrame.cloneNode(false);
    nextFrame.addEventListener("load", () => {
        completeLoad(token, expectedUrl, "loaded");
    });
    aiFrame.replaceWith(nextFrame);
    aiFrame = nextFrame;
    return nextFrame;
}
function completeLoad(token, expectedUrl, status) {
    if (token !== loadToken || settledLoadToken === token || expectedUrl !== currentUrl || aiFrame.src === "about:blank") {
        return;
    }
    if (canonicalUrl(aiFrame.src) !== canonicalUrl(expectedUrl)) {
        return;
    }
    settledLoadToken = token;
    clearLoadTimers();
    fallbackPanel.hidden = true;
    setLoading(false);
    if (updateActiveDiagnostic(status)) {
        setStatus("Diagnostic finished. Restoring the previous service...", "diagnostic");
        return;
    }
    setStatus(`${currentLabel || "Service"} loaded.`, "success");
}
function reloadCurrentUrl() {
    if (!currentUrl) {
        setStatus("No URL is selected.", "warning");
        return;
    }
    loadUrl(currentLabel || "AI service", currentUrl);
}
async function openCurrentInTab() {
    if (!currentUrl) {
        return;
    }
    await chrome.tabs.create({ url: currentUrl });
}
async function openCurrentInFallbackWindow() {
    if (!currentUrl) {
        return;
    }
    const response = await sendMessage({ type: Messages.OPEN_FALLBACK_WINDOW, url: currentUrl });
    setStatus(response.ok ? "Opened right-side fallback window." : response.error || "Could not open fallback window.", response.ok ? "success" : "error");
}
async function requestDnrEnabled(enabled, suppressStorageReload) {
    if (suppressStorageReload) {
        suppressLocalFrameModeReload(enabled);
    }
    return sendMessage({ type: Messages.SET_DNR_ENABLED, enabled });
}
function suppressLocalFrameModeReload(enabled) {
    if (localFrameModeReloadSuppression) {
        window.clearTimeout(localFrameModeReloadSuppression.timer);
    }
    const suppression = {
        enabled,
        expiresAt: Date.now() + LOCAL_FRAME_MODE_SUPPRESSION_MS,
        timer: window.setTimeout(() => {
            if (localFrameModeReloadSuppression === suppression) {
                localFrameModeReloadSuppression = null;
            }
        }, LOCAL_FRAME_MODE_SUPPRESSION_MS)
    };
    localFrameModeReloadSuppression = suppression;
}
function shouldSuppressLocalFrameModeReload(enabled) {
    const suppression = localFrameModeReloadSuppression;
    return !!suppression && suppression.enabled === enabled && Date.now() <= suppression.expiresAt;
}
async function restoreFrameModeAfterDiagnostic(enabled) {
    if (settings.enableFrameHeaderRelaxation === enabled) {
        return;
    }
    const response = await requestDnrEnabled(enabled, true);
    if (!response.ok || !response.settings) {
        setStatus(response.error || "Diagnostic saved, but compatibility mode could not be restored.", "error");
        return;
    }
    settings = response.settings;
    syncSettingsUi();
}
function currentDisplayTarget() {
    if (currentUrl) {
        return {
            id: settings.activePresetId,
            label: currentLabel || "AI service",
            url: currentUrl
        };
    }
    const target = resolveTarget(settings, settings.defaultPresetId);
    return target.url ? { id: target.id, label: target.label, url: target.url } : undefined;
}
function restoreDisplayAfterDiagnostic(target) {
    if (!target?.url) {
        void showSetupState();
        return;
    }
    loadUrl(target.label, target.url);
}
async function runDiagnostic(presetId, dnrEnabled) {
    const preset = BUILT_IN_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
        return;
    }
    let returnTarget = currentDisplayTarget();
    if (activeDiagnostic) {
        const restoreFrameMode = activeDiagnostic.restoreFrameMode;
        returnTarget = activeDiagnostic.returnTarget ?? returnTarget;
        activeDiagnostic = null;
        await restoreFrameModeAfterDiagnostic(restoreFrameMode);
    }
    const restoreFrameMode = settings.enableFrameHeaderRelaxation;
    const response = await requestDnrEnabled(dnrEnabled, true);
    if (!response.ok || !response.settings) {
        setStatus(response.error || "Could not update compatibility mode for diagnostics.", "error");
        return;
    }
    settings = response.settings;
    syncSettingsUi();
    const key = diagnosticKey(presetId, dnrEnabled);
    settings.diagnostics[key] = {
        presetId,
        url: preset.url,
        dnrEnabled,
        status: "pending",
        startedAt: Date.now(),
        message: `Diagnostic started with compatibility mode ${dnrEnabled ? "on" : "off"}.`
    };
    settings = await saveSettings(settings);
    renderDiagnostics();
    const token = loadUrl(preset.label, preset.url, { diagnostic: { dnrEnabled } });
    activeDiagnostic = { key, token, restoreFrameMode, returnTarget };
}
async function markDiagnostic(presetId, dnrEnabled, status) {
    const key = diagnosticKey(presetId, dnrEnabled);
    const entry = settings.diagnostics[key];
    const preset = BUILT_IN_PRESETS.find((item) => item.id === presetId);
    const active = activeDiagnostic?.key === key ? activeDiagnostic : null;
    if (active) {
        settledLoadToken = loadToken;
        clearLoadTimers();
        setLoading(false);
        activeDiagnostic = null;
    }
    settings.diagnostics[key] = {
        presetId,
        dnrEnabled,
        url: entry?.url || preset?.url || "",
        status,
        startedAt: entry?.startedAt || Date.now(),
        finishedAt: Date.now(),
        message: status === "manual-pass" ? "Marked visible by user." : "Marked failed by user."
    };
    settings = await saveSettings(settings);
    renderDiagnostics();
    setStatus(active ? "Diagnostic result saved. Restoring the previous service..." : "Diagnostic result saved.", "success");
    if (active) {
        await restoreFrameModeAfterDiagnostic(active.restoreFrameMode);
        restoreDisplayAfterDiagnostic(active.returnTarget);
    }
}
function updateActiveDiagnostic(status, message) {
    const diagnostic = activeDiagnostic;
    if (!diagnostic || diagnostic.token !== loadToken) {
        return false;
    }
    const entry = settings.diagnostics[diagnostic.key];
    if (!entry) {
        return false;
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
        .then(() => {
        restoreDisplayAfterDiagnostic(diagnostic.returnTarget);
    })
        .catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error), "error");
    });
    return true;
}
function syncSettingsUi() {
    const compatibilityState = settings.enableFrameHeaderRelaxation ? "on" : "off";
    const settingsLabel = `Open settings. Frame compatibility mode is ${compatibilityState}.`;
    moreActionsButton.title = settingsLabel;
    moreActionsButton.setAttribute("aria-label", settingsLabel);
    renderDiagnostics();
}
function renderDiagnostics() {
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
function statusCell(entry) {
    const td = document.createElement("td");
    const span = document.createElement("span");
    const status = entry?.status || "untested";
    span.className = `status-pill status-${status}`;
    span.textContent = status.replace("manual-", "");
    td.append(span);
    return td;
}
function runButtons(presetId) {
    const td = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "mini-actions";
    wrap.append(diagnosticButton("Run off", presetId, false, "runDnr"));
    wrap.append(diagnosticButton("Run on", presetId, true, "runDnr"));
    td.append(wrap);
    return td;
}
function markButtons(presetId) {
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
function diagnosticButton(label, presetId, dnrEnabled, dataKey) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.presetId = presetId;
    button.dataset[dataKey] = String(dnrEnabled);
    return button;
}
function markButton(label, presetId, dnrEnabled, status) {
    const button = diagnosticButton(label, presetId, dnrEnabled, "markDnr");
    button.dataset.markStatus = status;
    return button;
}
function cell(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
}
async function sendMessage(message) {
    try {
        return await chrome.runtime.sendMessage(message);
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
function clearLoadTimers() {
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
function setLoading(loading) {
    loadingSpinner.hidden = !loading;
    if (!loading) {
        elapsedText.hidden = true;
    }
}
function startElapsedTimer() {
    loadStartedAt = Date.now();
    updateElapsedText();
    elapsedText.hidden = true;
    elapsedTimer = window.setInterval(updateElapsedText, 1000);
}
function updateElapsedText() {
    const seconds = Math.max(0, Math.floor((Date.now() - loadStartedAt) / 1000));
    elapsedText.textContent = `${seconds}s`;
}
function loadingStatusMessage(label, options) {
    if (options.diagnostic) {
        return `Diagnostic: loading ${label} with compatibility mode ${modeLabel(options.diagnostic.dnrEnabled)}.`;
    }
    return `Loading ${label}...`;
}
function loadNoticeMessage(label, options) {
    if (options.diagnostic) {
        return `Diagnostic is still loading ${label} with compatibility mode ${modeLabel(options.diagnostic.dnrEnabled)}.`;
    }
    return `${label} is still loading. You can keep waiting or open it outside the frame.`;
}
function timeoutStatusMessage(label, options) {
    if (options.diagnostic) {
        return `Diagnostic timed out for ${label} with compatibility mode ${modeLabel(options.diagnostic.dnrEnabled)}.`;
    }
    return `${label} timed out. Fallback options are available.`;
}
function timeoutFallbackReason(options) {
    const timing = `The frame did not finish loading within ${Math.round(LOAD_TIMEOUT_MS / 1000)} seconds.`;
    if (options.diagnostic) {
        return `${timing} This diagnostic result was saved as a timeout, and anyside will restore the previous service.`;
    }
    return `${timing} Sign-in, cookies, or embed restrictions may be blocking the frame. Try again, or open it in a side window.`;
}
function defaultFallbackReason() {
    return "Sign-in, cookies, or embed restrictions can block the frame. Try again, or open it in a side window when the frame stays blank.";
}
function modeLabel(enabled) {
    return enabled ? "on" : "off";
}
function updateCurrentUrlDisplay(url) {
    currentUrlInput.value = url ? compactUrl(url) : "";
    currentUrlInput.title = url;
    currentUrlInput.setAttribute("aria-label", url ? `Current service URL: ${url}` : "No service URL selected");
}
function compactUrl(value) {
    try {
        const url = new URL(value);
        return url.host || url.hostname || value;
    }
    catch {
        const withoutProtocol = value.replace(/^[a-z][a-z\d+\-.]*:\/\//i, "");
        return withoutProtocol.split(/[/?#]/, 1)[0] || value;
    }
}
function canonicalUrl(value) {
    try {
        return new URL(value).href;
    }
    catch {
        return value;
    }
}
function setStatus(text, tone = "idle") {
    statusText.textContent = text;
    statusLive.dataset.tone = tone;
    statusBanner.dataset.tone = tone;
    statusBannerText.textContent = text;
    const showBanner = shouldShowStatusBanner(tone, text);
    statusBanner.hidden = !showBanner;
    statusBanner.setAttribute("aria-hidden", showBanner ? "false" : "true");
    if (tone === "loading" || tone === "diagnostic") {
        loadingSpinner.hidden = false;
        return;
    }
    loadingSpinner.hidden = true;
}
function shouldShowStatusBanner(tone, text) {
    if (!text) {
        return false;
    }
    return tone === "loading" || tone === "warning" || tone === "error" || (tone === "diagnostic" && diagnosticsEnabled);
}
function isDebugMode() {
    const debug = new URLSearchParams(window.location.search).get("debug");
    return debug !== null && debug !== "0" && debug.toLowerCase() !== "false";
}
function element(id) {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`Missing element: ${id}`);
    }
    return found;
}
