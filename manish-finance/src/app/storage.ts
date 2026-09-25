/**
 * Browser storage limited to the manish.finance.v1.* namespace. Used only for harmless display
 * preferences, device-local drafts (clearly labelled) and recent-view history. Private research of
 * record lives in D1; device-local drafts are cleared on sign-out/account change.
 */

const PREFIX = "manish.finance.v1.";

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = `${PREFIX}__probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function readLocal<T>(key: string, fallback: T): T {
  const s = safeStorage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeLocal(key: string): void {
  safeStorage()?.removeItem(PREFIX + key);
}

/** Removes every private/device-local key (drafts, history) while keeping display preferences. */
export function clearPrivateLocal(): void {
  const s = safeStorage();
  if (!s) return;
  const keep = new Set([`${PREFIX}theme`, `${PREFIX}prefs`, `${PREFIX}sidebar`, `${PREFIX}dealColumns`]);
  const remove: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(PREFIX) && !keep.has(k)) remove.push(k);
  }
  for (const k of remove) s.removeItem(k);
}

/** The theme key is also read by the inline pre-paint script in finance.html. */
export function writeTheme(theme: "dark" | "light"): void {
  const s = safeStorage();
  try {
    s?.setItem(`${PREFIX}theme`, theme);
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute("data-mf-theme", theme);
}
