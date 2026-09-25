import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PREFERENCES } from "../../shared/defaults";
import type { Preferences } from "../../shared/schemas/private";
import { ApiError, apiGet, apiSend } from "./api";
import { useSession } from "./session";
import { readLocal, readTheme, writeLocal, writeTheme } from "./storage";

/**
 * Preferences. Visitors keep display preferences on this device; the owner's preferences are stored
 * server-side (D1) and mirrored locally for the pre-paint theme. Saves report truthful state.
 */

export type PrefsSaveState = "idle" | "saving" | "saved" | "failed" | "local";

interface PrefsValue {
  prefs: Preferences;
  update: (patch: Partial<Preferences>) => void;
  saveState: PrefsSaveState;
  source: "device" | "account";
}

const PrefsContext = createContext<PrefsValue | null>(null);

function initialPrefs(): Preferences {
  const local = readLocal<Partial<Preferences>>("prefs", {});
  const theme = readTheme();
  const merged = { ...DEFAULT_PREFERENCES, ...local };
  if (theme === "light" || theme === "dark") merged.theme = theme;
  return merged;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { isOwner, status } = useSession();
  const [prefs, setPrefs] = useState<Preferences>(initialPrefs);
  const [saveState, setSaveState] = useState<PrefsSaveState>("idle");
  const revision = useRef<number>(0);
  const pending = useRef<Partial<Preferences>>({});
  const timer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    writeTheme(prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    const key = status?.viewer.key ?? null;
    if (!isOwner || !key || loadedFor.current === key) return;
    loadedFor.current = key;
    apiGet<{ prefs: Preferences; revision: number }>("/api/finance/preferences")
      .then((r) => {
        revision.current = r.revision;
        setPrefs((cur) => ({ ...cur, ...r.prefs }));
      })
      .catch(() => setSaveState("failed"));
  }, [isOwner, status?.viewer.key]);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaveState("saving");
    try {
      const r = await apiSend<{ prefs: Preferences; revision: number }>("PATCH", "/api/finance/preferences", { ...patch, revision: revision.current });
      revision.current = r.revision;
      setSaveState("saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Another tab saved first: reload, then re-apply this change on top.
        try {
          const cur = await apiGet<{ prefs: Preferences; revision: number }>("/api/finance/preferences");
          revision.current = cur.revision;
          const r = await apiSend<{ prefs: Preferences; revision: number }>("PATCH", "/api/finance/preferences", { ...patch, revision: cur.revision });
          revision.current = r.revision;
          setPrefs((p) => ({ ...cur.prefs, ...patch, theme: p.theme }));
          setSaveState("saved");
          return;
        } catch {
          /* fall through */
        }
      }
      setSaveState("failed");
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((cur) => {
        const next = { ...cur, ...patch };
        writeLocal("prefs", next);
        return next;
      });
      if (isOwner) {
        pending.current = { ...pending.current, ...patch };
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void flush(), 600);
      } else {
        setSaveState("local");
      }
    },
    [isOwner, flush],
  );

  const value = useMemo<PrefsValue>(() => ({ prefs, update, saveState, source: isOwner ? "account" : "device" }), [prefs, update, saveState, isOwner]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsContext);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}
