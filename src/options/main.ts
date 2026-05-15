import { Messages } from "../shared/messages.js";
import { BUILT_IN_PRESETS, CUSTOM_PRESET_ID, DEFAULT_PRESET_ID, makeCustomPresetId } from "../shared/presets.js";
import { defaultSettings, getSettings, normalizeSettings, saveSettings, SETTINGS_KEY } from "../shared/storage.js";
import type { ActivePresetId, CustomUrl, RuntimeMessage, RuntimeResponse, Settings } from "../shared/types.js";
import { labelFromUrl, normalizeUserUrl } from "../shared/url.js";

const defaultPresetSelect = element<HTMLSelectElement>("defaultPresetSelect");
const customUrlForm = element<HTMLFormElement>("customUrlForm");
const customLabelInput = element<HTMLInputElement>("customLabelInput");
const customUrlInput = element<HTMLInputElement>("customUrlInput");
const customUrlList = element<HTMLElement>("customUrlList");
const dnrToggle = element<HTMLInputElement>("dnrToggle");
const resetSettingsButton = element<HTMLButtonElement>("resetSettingsButton");
const statusText = element<HTMLElement>("statusText");
const CUSTOM_URL_ERROR = "Enter HTTPS, or http://localhost / http://127.0.0.1 for local testing. You can omit the protocol.";

let settings: Settings;
let editingCustomUrlId: string | null = null;

void init();

async function init(): Promise<void> {
  settings = await getSettings();
  await migrateBareCustomDefault();
  render();
  bindEvents();
}

function bindEvents(): void {
  defaultPresetSelect.addEventListener("change", () => {
    settings.defaultPresetId = defaultPresetSelect.value as ActivePresetId;
    settings.activePresetId = settings.defaultPresetId;
    void persist("Side panel service saved.");
  });

  dnrToggle.addEventListener("change", () => {
    void setDnrEnabled(dnrToggle.checked);
  });

  customUrlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCustomUrl();
  });

  customUrlList.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !target.dataset.editId) {
      return;
    }
    void updateCustomUrl(target.dataset.editId, target);
  });

  customUrlList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    if (target.dataset.editId) {
      editingCustomUrlId = target.dataset.editId;
      renderCustomUrls();
      return;
    }

    if (target.dataset.cancelEditId) {
      editingCustomUrlId = null;
      renderCustomUrls();
      return;
    }

    if (target.dataset.deleteId) {
      void deleteCustomUrl(target.dataset.deleteId);
    }
  });

  resetSettingsButton.addEventListener("click", () => {
    void resetSettings();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]?.newValue) {
      return;
    }

    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    render();
  });
}

function render(): void {
  renderDefaultSelect();
  renderCustomUrls();
  dnrToggle.checked = settings.enableFrameHeaderRelaxation;
}

function renderDefaultSelect(): void {
  defaultPresetSelect.textContent = "";

  for (const preset of BUILT_IN_PRESETS) {
    defaultPresetSelect.append(option(preset.id, preset.label));
  }
  for (const customUrl of settings.customUrls) {
    defaultPresetSelect.append(option(makeCustomPresetId(customUrl.id), customUrl.label));
  }

  defaultPresetSelect.value = settings.defaultPresetId;
}

function renderCustomUrls(): void {
  customUrlList.textContent = "";

  if (settings.customUrls.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "No custom URLs yet";
    const copy = document.createElement("p");
    copy.textContent = "Add a trusted AI workspace or local test page, then choose it as your side panel service.";
    empty.append(title, copy);
    customUrlList.append(empty);
    return;
  }

  for (const customUrl of settings.customUrls) {
    customUrlList.append(customUrl.id === editingCustomUrlId ? editableCustomUrlRow(customUrl) : customUrlRow(customUrl));
  }
}

function customUrlRow(customUrl: CustomUrl): HTMLElement {
  const row = document.createElement("div");
  row.className = "url-row";

  const label = document.createElement("strong");
  label.textContent = customUrl.label;

  const url = document.createElement("span");
  url.textContent = customUrl.url;
  url.title = customUrl.url;

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const editButton = document.createElement("button");
  editButton.className = "button";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.dataset.editId = customUrl.id;

  const deleteButton = document.createElement("button");
  deleteButton.className = "button";
  deleteButton.type = "button";
  deleteButton.textContent = "Remove";
  deleteButton.dataset.deleteId = customUrl.id;

  actions.append(editButton, deleteButton);
  row.append(label, url, actions);
  return row;
}

function editableCustomUrlRow(customUrl: CustomUrl): HTMLElement {
  const form = document.createElement("form");
  form.className = "url-row url-row-editing";
  form.dataset.editId = customUrl.id;

  const label = document.createElement("input");
  label.name = "label";
  label.type = "text";
  label.value = customUrl.label;
  label.placeholder = "Research workspace";

  const url = document.createElement("input");
  url.name = "url";
  url.type = "text";
  url.inputMode = "url";
  url.setAttribute("autocomplete", "url");
  url.spellcheck = false;
  url.value = customUrl.url;
  url.placeholder = "example.com or https://example.com/";

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const saveButton = document.createElement("button");
  saveButton.className = "button primary";
  saveButton.type = "submit";
  saveButton.textContent = "Save";

  const cancelButton = document.createElement("button");
  cancelButton.className = "button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.dataset.cancelEditId = customUrl.id;

  actions.append(saveButton, cancelButton);
  form.append(label, url, actions);
  return form;
}

async function addCustomUrl(): Promise<void> {
  const url = normalizeUserUrl(customUrlInput.value);
  if (!url) {
    setStatus(CUSTOM_URL_ERROR);
    return;
  }

  const label = customLabelInput.value.trim() || labelFromUrl(url);
  settings.customUrls.push({
    id: crypto.randomUUID(),
    label,
    url,
    createdAt: Date.now()
  });

  customLabelInput.value = "";
  customUrlInput.value = "";
  await persist("Custom URL added.");
  render();
}

async function updateCustomUrl(id: string, form: HTMLFormElement): Promise<void> {
  const formData = new FormData(form);
  const url = normalizeUserUrl(String(formData.get("url") || ""));
  if (!url) {
    setStatus(CUSTOM_URL_ERROR);
    return;
  }

  const customUrl = settings.customUrls.find((entry) => entry.id === id);
  if (!customUrl) {
    setStatus("That custom URL is no longer available.");
    editingCustomUrlId = null;
    render();
    return;
  }

  customUrl.label = String(formData.get("label") || "").trim() || labelFromUrl(url);
  customUrl.url = url;
  settings.lastUrlByPreset[makeCustomPresetId(id)] = url;

  editingCustomUrlId = null;
  await persist("Custom URL saved.");
  render();
}

async function deleteCustomUrl(id: string): Promise<void> {
  const presetId = makeCustomPresetId(id);
  settings.customUrls = settings.customUrls.filter((customUrl) => customUrl.id !== id);
  delete settings.lastUrlByPreset[presetId];
  if (editingCustomUrlId === id) {
    editingCustomUrlId = null;
  }

  if (settings.defaultPresetId === presetId) {
    settings.defaultPresetId = DEFAULT_PRESET_ID;
  }
  if (settings.activePresetId === presetId) {
    settings.activePresetId = settings.defaultPresetId;
  }

  await persist("Custom URL removed.");
  render();
}

async function resetSettings(): Promise<void> {
  const defaults = defaultSettings();
  resetSettingsButton.disabled = true;

  try {
    if (settings.enableFrameHeaderRelaxation !== defaults.enableFrameHeaderRelaxation) {
      const response = await sendMessage({
        type: Messages.SET_DNR_ENABLED,
        enabled: defaults.enableFrameHeaderRelaxation
      });

      if (!response.ok) {
        setStatus(response.error || "Could not reset iframe compatibility mode.");
        return;
      }
    }

    settings = await saveSettings(defaults);
    editingCustomUrlId = null;
    customLabelInput.value = "";
    customUrlInput.value = "";
    render();
    setStatus("Settings reset to defaults.");
  } finally {
    resetSettingsButton.disabled = false;
  }
}

async function setDnrEnabled(enabled: boolean): Promise<void> {
  dnrToggle.disabled = true;
  const response = await sendMessage({ type: Messages.SET_DNR_ENABLED, enabled });
  dnrToggle.disabled = false;

  if (!response.ok || !response.settings) {
    dnrToggle.checked = settings.enableFrameHeaderRelaxation;
    setStatus(response.error || "Could not update iframe compatibility mode.");
    return;
  }

  settings = response.settings;
  render();
  setStatus(`Iframe compatibility mode ${enabled ? "enabled" : "disabled"}.`);
}

async function persist(message: string): Promise<void> {
  settings = await saveSettings(settings);
  setStatus(message);
}

async function migrateBareCustomDefault(): Promise<void> {
  if (settings.defaultPresetId !== CUSTOM_PRESET_ID) {
    return;
  }

  const url = normalizeUserUrl(settings.lastUrlByPreset[CUSTOM_PRESET_ID] || "");
  if (!url) {
    settings.defaultPresetId = DEFAULT_PRESET_ID;
    if (settings.activePresetId === CUSTOM_PRESET_ID) {
      settings.activePresetId = DEFAULT_PRESET_ID;
    }
    settings = await saveSettings(settings);
    return;
  }

  const id = crypto.randomUUID();
  const presetId = makeCustomPresetId(id);
  settings.customUrls.push({
    id,
    label: labelFromUrl(url),
    url,
    createdAt: Date.now()
  });
  settings.defaultPresetId = presetId;
  settings.activePresetId = presetId;
  settings.lastUrlByPreset[presetId] = url;
  settings = await saveSettings(settings);
}

async function sendMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function option(value: string, label: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element: ${id}`);
  }
  return found as T;
}
