import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../app/api";
import { readLocal, removeLocal, writeLocal } from "../app/storage";
import type { SaveStateKind } from "../components/ui";

/**
 * Autosave with truthful states. Edits are debounced to the server with optimistic concurrency
 * (revision). A 409 surfaces a conflict for reconciliation instead of silently overwriting; a failed
 * save keeps a device-local draft (labelled "Saved on this device only") with retry.
 */

export interface Conflict<T> {
  server: T;
  serverRevision: number;
}

export interface AutosaveResult<T> {
  value: T;
  setValue: (updater: T | ((prev: T) => T)) => void;
  state: SaveStateKind;
  conflict: Conflict<T> | null;
  resolveConflict: (choice: "mine" | "theirs") => void;
  retry: () => void;
  hasLocalDraft: boolean;
  discardLocalDraft: () => void;
}

export function useAutosave<T>(opts: {
  draftKey: string | null;
  serverValue: T | undefined;
  serverRevision: number | null;
  empty: T;
  save: (value: T, revision: number | null) => Promise<{ revision: number; value: T }>;
  equals: (a: T, b: T) => boolean;
  delayMs?: number;
  enabled: boolean;
}): AutosaveResult<T> {
  const { draftKey, serverValue, serverRevision, empty, save, equals, enabled } = opts;
  const delay = opts.delayMs ?? 1200;
  const [value, setValueState] = useState<T>(() => serverValue ?? empty);
  const [state, setState] = useState<SaveStateKind>("idle");
  const [conflict, setConflict] = useState<Conflict<T> | null>(null);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const revision = useRef<number | null>(serverRevision);
  const saved = useRef<T>(serverValue ?? empty);
  const timer = useRef<number | null>(null);
  const saving = useRef(false);
  const latest = useRef<T>(value);
  const initialized = useRef(false);

  // Initialise from server once it arrives, preferring an unsaved device-local draft if one exists.
  useEffect(() => {
    if (serverValue === undefined || initialized.current) return;
    initialized.current = true;
    revision.current = serverRevision;
    saved.current = serverValue;
    const local = draftKey ? readLocal<{ value: T; baseRevision: number | null } | null>(draftKey, null) : null;
    if (local && !equals(local.value, serverValue)) {
      setValueState(local.value);
      latest.current = local.value;
      setHasLocalDraft(true);
      setState("local");
    } else {
      setValueState(serverValue);
      latest.current = serverValue;
    }
  }, [serverValue, serverRevision, draftKey, equals]);

  const doSave = useCallback(async () => {
    if (!enabled || saving.current) return;
    const v = latest.current;
    if (equals(v, saved.current) && !hasLocalDraft) {
      setState((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    saving.current = true;
    setState("saving");
    try {
      const r = await save(v, revision.current);
      revision.current = r.revision;
      saved.current = r.value;
      if (draftKey) removeLocal(draftKey);
      setHasLocalDraft(false);
      setState(equals(latest.current, v) ? "saved" : "dirty");
      setConflict(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const cur = (e.details as { current?: { value: T; revision: number } } | undefined)?.current;
        if (cur) setConflict({ server: cur.value, serverRevision: cur.revision });
        if (draftKey) writeLocal(draftKey, { value: v, baseRevision: revision.current });
        setState("conflict");
      } else {
        if (draftKey && writeLocal(draftKey, { value: v, baseRevision: revision.current })) {
          setHasLocalDraft(true);
          setState("local");
        } else setState("failed");
      }
    } finally {
      saving.current = false;
    }
  }, [enabled, equals, save, draftKey, hasLocalDraft]);

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
        latest.current = next;
        return next;
      });
      setState("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void doSave(), delay);
    },
    [delay, doSave],
  );

  useEffect(() => {
    const flush = () => {
      if (draftKey && !equals(latest.current, saved.current)) writeLocal(draftKey, { value: latest.current, baseRevision: revision.current });
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [draftKey, equals]);

  const resolveConflict = useCallback(
    (choice: "mine" | "theirs") => {
      if (!conflict) return;
      revision.current = conflict.serverRevision;
      if (choice === "theirs") {
        saved.current = conflict.server;
        latest.current = conflict.server;
        setValueState(conflict.server);
        if (draftKey) removeLocal(draftKey);
        setHasLocalDraft(false);
        setState("saved");
        setConflict(null);
      } else {
        saved.current = conflict.server;
        setConflict(null);
        void doSave();
      }
    },
    [conflict, doSave, draftKey],
  );

  return {
    value,
    setValue,
    state,
    conflict,
    resolveConflict,
    retry: () => void doSave(),
    hasLocalDraft,
    discardLocalDraft: () => {
      if (draftKey) removeLocal(draftKey);
      setHasLocalDraft(false);
      latest.current = saved.current;
      setValueState(saved.current);
      setState("idle");
    },
  };
}
