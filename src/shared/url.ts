export function normalizeUserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = withDefaultProtocol(trimmed);
  if (!withProtocol) {
    return null;
  }

  try {
    const url = new URL(withProtocol);
    if (url.protocol === "https:") {
      return url.href;
    }

    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return url.href;
    }

    return null;
  } catch {
    return null;
  }
}

function withDefaultProtocol(input: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    return input;
  }

  if (/^(localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#].*)?$/i.test(input)) {
    return `http://${input}`;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^[^/:?#]+\.[^/:?#]+:\d+(?:[/?#].*)?$/i.test(input)) {
    return null;
  }

  return `https://${input}`;
}

export function labelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Custom URL";
  }
}
