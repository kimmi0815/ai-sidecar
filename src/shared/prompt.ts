export function createSelectionPrompt(selectionText: string): string {
  return [
    "Please explain the following text clearly.",
    "If helpful, include a concise summary, key terms, caveats, and possible counterarguments.",
    "",
    "---",
    selectionText.trim(),
    "---"
  ].join("\n");
}

export function createActiveTabPrompt(title: string | undefined, url: string | undefined): string {
  return [
    "Please review this web page and explain the main points.",
    "If useful, include context, important details, and what I should investigate next.",
    "",
    "Title:",
    title || "(No title)",
    "",
    "URL:",
    url || "(No URL)"
  ].join("\n");
}
