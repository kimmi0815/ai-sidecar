                                                                                                    

export const BUILT_IN_PRESETS                  = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
  { id: "notebooklm", label: "NotebookLM", url: "https://notebooklm.google.com/" },
  { id: "keep", label: "Google Keep", url: "https://keep.google.com/" }
];

export const DEFAULT_PRESET_ID           = "chatgpt";
export const CUSTOM_PRESET_ID = "custom";

export function isBuiltInPresetId(value        )                    {
  return BUILT_IN_PRESETS.some((preset) => preset.id === value);
}

export function getBuiltInPreset(id          )                {
  const preset = BUILT_IN_PRESETS.find((item) => item.id === id);
  return preset ?? BUILT_IN_PRESETS[0];
}

export function makeCustomPresetId(customUrlId        )                 {
  return `custom:${customUrlId}`;
}

export function parseCustomPresetId(id        )                {
  return id.startsWith("custom:") ? id.slice("custom:".length) : null;
}

export function resolveTarget(settings          , activeId                 = settings.activePresetId)                 {
  if (isBuiltInPresetId(activeId)) {
    const preset = getBuiltInPreset(activeId);
    return {
      id: activeId,
      label: preset.label,
      url: settings.lastUrlByPreset[activeId] || preset.url,
      isCustom: false
    };
  }

  if (activeId === CUSTOM_PRESET_ID) {
    return {
      id: CUSTOM_PRESET_ID,
      label: "Custom URL",
      url: settings.lastUrlByPreset[CUSTOM_PRESET_ID] || "",
      isCustom: true
    };
  }

  const customId = parseCustomPresetId(activeId);
  const customUrl = customId ? settings.customUrls.find((entry) => entry.id === customId) : undefined;
  if (customUrl) {
    return {
      id: activeId,
      label: customUrl.label,
      url: settings.lastUrlByPreset[activeId] || customUrl.url,
      isCustom: true
    };
  }

  const fallback = getBuiltInPreset(DEFAULT_PRESET_ID);
  return {
    id: DEFAULT_PRESET_ID,
    label: fallback.label,
    url: fallback.url,
    isCustom: false
  };
}

export function diagnosticKey(presetId          , dnrEnabled         )         {
  return `${presetId}:${dnrEnabled ? "dnr-on" : "dnr-off"}`;
}

