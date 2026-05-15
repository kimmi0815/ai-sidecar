export type PresetId = "chatgpt" | "claude" | "gemini" | "notebooklm" | "keep";

export type ActivePresetId = PresetId | "custom" | `custom:${string}`;

export type BuiltInPreset = {
  id: PresetId;
  label: string;
  url: string;
};

export type CustomUrl = {
  id: string;
  label: string;
  url: string;
  createdAt: number;
};

export type DiagnosticStatus = "untested" | "pending" | "loaded" | "timeout" | "manual-pass" | "manual-fail";

export type DiagnosticEntry = {
  presetId: PresetId;
  url: string;
  dnrEnabled: boolean;
  status: DiagnosticStatus;
  startedAt: number;
  finishedAt?: number;
  message?: string;
};

export type Settings = {
  defaultPresetId: ActivePresetId;
  activePresetId: ActivePresetId;
  customUrls: CustomUrl[];
  lastUrlByPreset: Record<string, string>;
  enableFrameHeaderRelaxation: boolean;
  diagnostics: Record<string, DiagnosticEntry>;
};

export type ResolvedTarget = {
  id: ActivePresetId;
  label: string;
  url: string;
  isCustom: boolean;
};

export type FallbackWindowState = {
  windowId?: number;
  tabId?: number;
  url?: string;
  updatedAt?: number;
};

export type RuntimeMessage =
  | { type: "SET_DNR_ENABLED"; enabled: boolean }
  | { type: "COPY_ACTIVE_TAB_PROMPT" }
  | { type: "COPY_TEXT"; text: string }
  | { type: "OPEN_FALLBACK_WINDOW"; url: string }
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "OFFSCREEN_COPY_TEXT"; target: "offscreen"; text: string };

export type RuntimeResponse = {
  ok: boolean;
  error?: string;
  settings?: Settings;
  windowId?: number;
  text?: string;
};
