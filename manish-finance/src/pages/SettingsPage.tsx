import { useState } from "react";
import { SECTOR_NAMES, SECTOR_SLUGS } from "../../shared/labels";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { usePrefs } from "../app/prefs";
import { invalidate } from "../app/query";
import { signInHref, signOutHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { SaveState, Segmented, SignInPrompt } from "../components/ui";

interface PreviewRecord {
  key: string;
  collection: string;
  id: string;
  title: string;
  status: "new" | "duplicate" | "conflict" | "invalid";
  reason: string | null;
}

interface Preview {
  previewId: string;
  summary: Record<string, { new: number; duplicate: number; conflict: number; invalid: number }>;
  records: PreviewRecord[];
  errors: Array<{ path: string; message: string }>;
}

function ImportPanel() {
  const { notify } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "skip" | "import_as_copy" | "replace">>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    if (file.size > 5 * 1024 * 1024) {
      notify("File is larger than 5 MB.", "error");
      return;
    }
    let bundle: unknown;
    try {
      bundle = JSON.parse(await file.text());
    } catch {
      notify("The file is not valid JSON.", "error");
      return;
    }
    setBusy(true);
    try {
      const p = await apiSend<Preview>("POST", "/api/finance/import/preview", bundle, { idempotencyKey: newIdempotencyKey() });
      setPreview(p);
      setDecisions({});
    } catch (e) {
      notify(`Preview failed: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await apiSend<{ summary: Record<string, unknown> }>("POST", "/api/finance/import/commit", { previewId: preview.previewId, decisions }, { idempotencyKey: `commit-${preview.previewId}` });
      setResult(r.summary);
      setPreview(null);
      invalidate("/api/finance/");
      notify("Import committed. Nothing existing was deleted.", "success");
    } catch (e) {
      notify(`Import failed: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const conflicts = preview?.records.filter((r) => r.status === "conflict") ?? [];
  return (
    <div className="mf-stack tight">
      <div className="mf-field">
        <label htmlFor="imp-file">Import a Finance Desk export (JSON)</label>
        <input id="imp-file" type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} />
        <p className="mf-hint">Preview first: schema errors, duplicates and conflicts are listed before anything is written. Conflicts are skipped unless you choose otherwise. Existing records are never deleted by an import.</p>
      </div>
      {preview ? (
        <div className="mf-panel">
          <div className="mf-panel-head">
            <h3>Import preview</h3>
          </div>
          <div className="mf-panel-body mf-stack tight">
            {preview.errors.length ? (
              <div className="mf-callout negative">
                {preview.errors.length} schema error(s):{" "}
                {preview.errors
                  .slice(0, 5)
                  .map((e) => `${e.path}: ${e.message}`)
                  .join("; ")}
              </div>
            ) : null}
            <div className="mf-table-wrap">
              <table className="mf-table compact">
                <thead>
                  <tr>
                    <th scope="col">Collection</th>
                    <th scope="col" className="num">
                      New
                    </th>
                    <th scope="col" className="num">
                      Duplicate
                    </th>
                    <th scope="col" className="num">
                      Conflict
                    </th>
                    <th scope="col" className="num">
                      Invalid
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(preview.summary).map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{v.new}</td>
                      <td className="num">{v.duplicate}</td>
                      <td className="num">{v.conflict}</td>
                      <td className="num">{v.invalid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {conflicts.length ? (
              <div className="mf-stack tight">
                <strong>Conflicts (same ID, different content)</strong>
                {conflicts.map((c) => (
                  <div key={c.key} className="mf-row spread">
                    <span className="mf-small">
                      {c.collection}: {c.title} <span className="mf-muted">({c.reason})</span>
                    </span>
                    <select className="mf-select" style={{ width: "auto" }} value={decisions[c.key] ?? "skip"} onChange={(e) => setDecisions({ ...decisions, [c.key]: e.target.value as "skip" })} aria-label={`Decision for ${c.title}`}>
                      <option value="skip">Keep existing (skip)</option>
                      <option value="import_as_copy">Import as a copy</option>
                      <option value="replace">Replace existing</option>
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mf-row">
              <button type="button" className="mf-btn" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button type="button" className="mf-btn primary" disabled={busy} onClick={() => void commit()}>
                {busy ? "Importing…" : "Confirm import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {result ? <pre className="mf-formula">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}

export function SettingsPage() {
  const { prefs, update, saveState, source } = usePrefs();
  const { status, isOwner, signedIn } = useSession();
  return (
    <div className="mf-stack" style={{ maxWidth: 920 }}>
      <PageHead title="Settings" sub={<>Preferences are saved {source === "account" ? "to your account" : "on this device"}. <SaveState state={saveState === "idle" ? "idle" : saveState === "local" ? "local" : saveState} /></>} />
      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2>Display</h2>
        </div>
        <div className="mf-panel-body mf-stack">
          <div className="mf-row spread">
            <span className="mf-label">Theme</span>
            <Segmented label="Theme" value={prefs.theme} onChange={(v) => update({ theme: v })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          </div>
          <div className="mf-row spread">
            <span className="mf-label">Indian rupee units</span>
            <Segmented label="INR units" value={prefs.inrNumberSystem} onChange={(v) => update({ inrNumberSystem: v })} options={[{ value: "indian", label: "Lakh / crore" }, { value: "international", label: "Million / billion" }]} />
          </div>
          <div className="mf-row spread">
            <span className="mf-label">Currency display</span>
            <Segmented label="Currency display" value={prefs.displayCurrency} onChange={(v) => update({ displayCurrency: v })} options={[{ value: "original", label: "Original" }, { value: "INR", label: "INR" }, { value: "USD", label: "USD" }]} />
          </div>
          <p className="mf-hint">Original reported currency is always shown first. Converted INR/USD figures appear only where a dated FX rate with a source exists; the archive does not yet include dated FX rates, so values stay in their reported currency.</p>
          <div className="mf-row spread">
            <label className="mf-label" htmlFor="tz">
              Timezone
            </label>
            <select id="tz" className="mf-select" style={{ width: "auto" }} value={prefs.timezone} onChange={(e) => update({ timezone: e.target.value })}>
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="UTC">UTC</option>
              <option value="Asia/Singapore">Asia/Singapore</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </div>
        </div>
      </section>

      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2>Research defaults</h2>
        </div>
        <div className="mf-panel-body mf-stack">
          <div className="mf-row spread">
            <span className="mf-label">Default geography</span>
            <Segmented label="Default geography" value={prefs.geography} onChange={(v) => update({ geography: v })} options={[{ value: "india", label: "India" }, { value: "apac", label: "APAC" }, { value: "global", label: "Global" }]} />
          </div>
          <div className="mf-row spread">
            <span className="mf-label">Cross-border rule</span>
            <Segmented label="Cross-border rule" value={prefs.geoMode} onChange={(v) => update({ geoMode: v })} options={[{ value: "either", label: "Either party" }, { value: "target", label: "Target" }, { value: "acquirer", label: "Acquirer" }]} />
          </div>
          <div className="mf-row spread">
            <label className="mf-label" htmlFor="news-window">
              News window
            </label>
            <select id="news-window" className="mf-select" style={{ width: "auto" }} value={prefs.newsWindowDays} onChange={(e) => update({ newsWindowDays: Number(e.target.value) })}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="mf-label" style={{ marginBottom: 8 }}>
              Followed sectors (optional)
            </legend>
            <div className="mf-row">
              {SECTOR_SLUGS.map((s) => (
                <label key={s} className="mf-chip" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    style={{ accentColor: "var(--mf-accent)" }}
                    checked={prefs.followedSectors.includes(s)}
                    onChange={() => update({ followedSectors: prefs.followedSectors.includes(s) ? prefs.followedSectors.filter((x) => x !== s) : [...prefs.followedSectors, s], sectorPickerDismissed: true })}
                  />
                  {SECTOR_NAMES[s]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2>Your data</h2>
        </div>
        <div className="mf-panel-body mf-stack">
          {!isOwner ? (
            <SignInPrompt what="Exporting and importing notes, models, watches and review history" />
          ) : (
            <>
              <div className="mf-row">
                <a className="mf-btn small" href="/api/finance/export" download>
                  <Icon name="download" size={15} /> Export everything (JSON)
                </a>
                <a className="mf-btn small" href="/api/finance/export/notes.md" download>
                  <Icon name="download" size={15} /> Notes (Markdown)
                </a>
                <a className="mf-btn small" href="/api/finance/export/reviews.csv" download>
                  <Icon name="download" size={15} /> Review history (CSV)
                </a>
              </div>
              <p className="mf-hint">Versioned JSON with notes, models, watches, saved searches, preferences, Deal Memory cards and review history. Exports are private and never cached.</p>
              <ImportPanel />
            </>
          )}
        </div>
      </section>

      <section className="mf-panel">
        <div className="mf-panel-head">
          <h2>Account and providers</h2>
        </div>
        <div className="mf-panel-body">
          <dl className="mf-dl">
            <dt>Signed in</dt>
            <dd>
              {signedIn ? (isOwner ? "Yes — site owner" : "Yes — not the configured owner (published research only)") : "No"} ·{" "}
              {signedIn ? <a href={signOutHref()}>Sign out</a> : <a href={signInHref()}>Sign in</a>}
            </dd>
            <dt>Owner configured</dt>
            <dd>{status ? (status.viewer.ownerConfigured ? "Yes" : "No — private features fail closed until FINANCE_OWNER_USER_ID is set") : "…"}</dd>
            <dt>AI assistance</dt>
            <dd>{status ? status.capabilities.ai.reason : "…"}</dd>
            <dt>Background refresh</dt>
            <dd>{status ? (status.capabilities.maintenance.scheduler === "observed" ? "Scheduler observed" : status.capabilities.maintenance.scheduler === "stale" ? "Scheduler stale" : "Background schedule not configured") : "…"}</dd>
            <dt>Versions</dt>
            <dd className="mf-mono mf-small">
              app {status?.app.version} · {status?.app.archiveVersion} · calc {status?.app.calcVersion}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
