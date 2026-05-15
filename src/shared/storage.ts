import { BUILT_IN_PRESETS, CUSTOM_PRESET_ID, DEFAULT_PRESET_ID, isBuiltInPresetId, makeCustomPresetId, parseCustomPresetId } from "./presets.js";
import type { ActivePresetId, CustomUrl, DiagnosticEntry, DiagnosticStatus, Settings } from "./types.js";
import { normalizeUserUrl } from "./url.js";

export const SETTINGS_KEY = "anyside.settings";
export const FALLBACK_WINDOW_KEY = "anyside.fallbackWindow";

const LEGACY_SETTINGS_KEY = "aiSidecar.settings";

function defaultLastUrlByPreset(): Record<string, string> {
  const entries = BUILT_IN_PRESETS.map((preset) => [preset.id, preset.url]);
  entries.push([CUSTOM_PRESET_ID, ""]);
  return Object.fromEntries(entries);
}

export function defaultSettings(): Settings {
  return {
    defaultPresetId: DEFAULT_PRESET_ID,
    activePresetId: DEFAULT_PRESET_ID,
    customUrls: [],
    lastUrlByPreset: defaultLastUrlByPreset(),
    enableFrameHeaderRelaxation: true,
    diagnostics: {}
  };
}

const DIAGNOSTIC_STATUSES: DiagnosticStatus[] = ["untested", "pending", "loaded", "timeout", "manual-pass", "manual-fail"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeCustomUrls(value: unknown): CustomUrl[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const customUrls: CustomUrl[] = [];
  const seenIds = new Set<string>();

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

function isKnownActivePresetId(value: unknown, customUrls: CustomUrl[]): value is ActivePresetId {
  if (typeof value !== "string") {
    return false;
  }

  if (isBuiltInPresetId(value) || value === CUSTOM_PRESET_ID) {
    return true;
  }

  const customId = parseCustomPresetId(value);
  return !!customId && customUrls.some((entry) => entry.id === customId);
}

function normalizeActivePresetId(value: unknown, fallback: ActivePresetId, customUrls: CustomUrl[]): ActivePresetId {
  return isKnownActivePresetId(value, customUrls) ? value : fallback;
}

function normalizeLastUrlByPreset(value: unknown, customUrls: CustomUrl[]): Record<string, string> {
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

function isDiagnosticStatus(value: unknown): value is DiagnosticStatus {
  return typeof value === "string" && DIAGNOSTIC_STATUSES.includes(value as DiagnosticStatus);
}

function normalizeDiagnostics(value: unknown): Record<string, DiagnosticEntry> {
  if (!isRecord(value)) {
    return {};
  }

  const diagnostics: Record<string, DiagnosticEntry> = {};
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

function isKnownDiagnosticEntry(entry: Record<string, unknown>): entry is DiagnosticEntry {
  return (
    typeof entry.presetId === "string" &&
    isBuiltInPresetId(entry.presetId) &&
    typeof entry.url === "string" &&
    typeof entry.dnrEnabled === "boolean" &&
    isDiagnosticStatus(entry.status) &&
    typeof entry.startedAt === "number"
  );
}

export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const input = value as Partial<Settings>;
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

export async function getSettings(): Promise<Settings> {
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

export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function updateSettings(mutator: (settings: Settings) => Settings | void): Promise<Settings> {
  const current = await getSettings();
  const next = mutator(current) ?? current;
  return saveSettings(next);
}
