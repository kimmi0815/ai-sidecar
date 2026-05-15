import { BUILT_IN_PRESETS, CUSTOM_PRESET_ID, DEFAULT_PRESET_ID, isBuiltInPresetId, makeCustomPresetId, parseCustomPresetId } from "./presets.js";

import { normalizeUserUrl } from "./url.js";

export const SETTINGS_KEY = "anyside.settings";
export const FALLBACK_WINDOW_KEY = "anyside.fallbackWindow";

const LEGACY_SETTINGS_KEY = "aiSidecar.settings";

function defaultLastUrlByPreset()                         {
  const entries = BUILT_IN_PRESETS.map((preset) => [preset.id, preset.url]);
  entries.push([CUSTOM_PRESET_ID, ""]);
  return Object.fromEntries(entries);
}

export function defaultSettings()           {
  return {
    defaultPresetId: DEFAULT_PRESET_ID,
    activePresetId: DEFAULT_PRESET_ID,
    customUrls: [],
    lastUrlByPreset: defaultLastUrlByPreset(),
    enableFrameHeaderRelaxation: true,
    diagnostics: {}
  };
}

const DIAGNOSTIC_STATUSES                     = ["untested", "pending", "loaded", "timeout", "manual-pass", "manual-fail"];

function isRecord(value         )                                   {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeCustomUrls(value         )              {
  if (!Array.isArray(value)) {
    return [];
  }

  const customUrls              = [];
  const seenIds = new Set        ();

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") {
      continue;
    }

    const id = item.id.trim();
    if (!id || seenIds.has(id)) {
      continue;
    }

    const url = typeof item.url === "string" ? normalizeUserUrl(item.url) : null;
    if (!url) {
      continue;
    }

    seenIds.add(id);
    customUrls.push({
      id,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : url,
      url,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now()
    });
  }

  return customUrls;
}

function isKnownActivePresetId(value         , customUrls             )                          {
  if (typeof value !== "string") {
    return false;
  }

  if (isBuiltInPresetId(value) || value === CUSTOM_PRESET_ID) {
    return true;
  }

  const customId = parseCustomPresetId(value);
  return !!customId && customUrls.some((entry) => entry.id === customId);
}

function normalizeActivePresetId(value         , fallback                , customUrls             )                 {
  return isKnownActivePresetId(value, customUrls) ? value : fallback;
}

function normalizeLastUrlByPreset(value         , customUrls             )                         {
  const output = defaultLastUrlByPreset();
  const input = isRecord(value) ? value : {};

  for (const preset of BUILT_IN_PRESETS) {
    const storedUrl = input[preset.id];
    output[preset.id] = typeof storedUrl === "string" && storedUrl ? storedUrl : preset.url;
  }

  output[CUSTOM_PRESET_ID] = typeof input[CUSTOM_PRESET_ID] === "string" ? normalizeUserUrl(input[CUSTOM_PRESET_ID]) || "" : "";

  for (const customUrl of customUrls) {
    const presetId = makeCustomPresetId(customUrl.id);
    output[presetId] = typeof input[presetId] === "string" ? normalizeUserUrl(input[presetId]) || customUrl.url : customUrl.url;
  }

  return output;
}

function isDiagnosticStatus(value         )                            {
  return typeof value === "string" && DIAGNOSTIC_STATUSES.includes(value                    );
}

function normalizeDiagnostics(value         )                                  {
  if (!isRecord(value)) {
    return {};
  }

  const diagnostics                                  = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isKnownDiagnosticEntry(entry)) {
      continue;
    }

    diagnostics[key] = {
      presetId: entry.presetId,
      url: entry.url,
      dnrEnabled: entry.dnrEnabled,
      status: entry.status,
      startedAt: entry.startedAt,
      finishedAt: typeof entry.finishedAt === "number" ? entry.finishedAt : undefined,
      message: typeof entry.message === "string" ? entry.message : undefined
    };
  }

  return diagnostics;
}

function isKnownDiagnosticEntry(entry                         )                           {
  return (
    typeof entry.presetId === "string" &&
    isBuiltInPresetId(entry.presetId) &&
    typeof entry.url === "string" &&
    typeof entry.dnrEnabled === "boolean" &&
    isDiagnosticStatus(entry.status) &&
    typeof entry.startedAt === "number"
  );
}

export function normalizeSettings(value         )           {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const input = value                     ;
  const customUrls = normalizeCustomUrls(input.customUrls);
  const defaultPresetId = normalizeActivePresetId(input.defaultPresetId, defaults.defaultPresetId, customUrls);
  const activePresetId = normalizeActivePresetId(input.activePresetId, defaultPresetId, customUrls);

  return {
    defaultPresetId,
    activePresetId,
    customUrls,
    lastUrlByPreset: normalizeLastUrlByPreset(input.lastUrlByPreset, customUrls),
    enableFrameHeaderRelaxation:
      typeof input.enableFrameHeaderRelaxation === "boolean"
        ? input.enableFrameHeaderRelaxation
        : defaults.enableFrameHeaderRelaxation,
    diagnostics: normalizeDiagnostics(input.diagnostics)
  };
}

export async function getSettings()                    {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  if (stored[SETTINGS_KEY]) {
    return normalizeSettings(stored[SETTINGS_KEY]);
  }

  if (stored[LEGACY_SETTINGS_KEY]) {
    const migrated = normalizeSettings(stored[LEGACY_SETTINGS_KEY]);
    await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
    await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
    return migrated;
  }

  return defaultSettings();
}

export async function saveSettings(settings          )                    {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function updateSettings(mutator                                         )                    {
  const current = await getSettings();
  const next = mutator(current) ?? current;
  return saveSettings(next);
}

