import { useCallback, useEffect, useMemo, useState } from "react";
import { CALC_VERSION } from "../../../shared/calc/result";
import type { SavedModel } from "../../../shared/schemas/private";
import { toCsv } from "../../../shared/text/csv";
import { ApiError, apiGet, apiSend, errorMessage, newIdempotencyKey } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { setQuery, useRoute } from "../../app/router";
import { signInHref, useSession } from "../../app/session";
import { useToast } from "../../app/toast";
import { Icon } from "../../components/Icon";
import { Dialog } from "../../components/Overlay";
import { PageHead } from "../../components/PageHead";
import { type SaveStateKind, SaveState, TabPanel, Tabs } from "../../components/ui";
import { type AccretionAssumptions, AccretionTab, accretionBase, computeAccretion } from "./AccretionTab";
import { type CompsAssumptions, ComparablesTab, compsBase, computeComps } from "./ComparablesTab";
import { computeDcf, type DcfAssumptions, DcfTab, dcfBase } from "./DcfTab";
import { computeFig, type FigAssumptions, FigTab, figBase } from "./FigTab";
import { MAX_SCENARIOS, type ScenarioApi, useScenarios } from "./useScenarios";
import { TRAINING_NOTICE } from "../../../data/training/models";

type LabTab = "comparables" | "dcf" | "accretion" | "fig";
const TABS: Array<{ id: LabTab; label: string; modelType: SavedModel["modelType"] }> = [
  { id: "comparables", label: "Comparables", modelType: "comparables" },
  { id: "dcf", label: "DCF", modelType: "dcf" },
  { id: "accretion", label: "Accretion/Dilution", modelType: "accretion" },
  { id: "fig", label: "FIG", modelType: "fig_residual_income" },
];

function isTab(x: string | null): x is LabTab {
  return x !== null && TABS.some((t) => t.id === x);
}

/** Flattens an object into CSV rows (key path, value) for export. */
function flatten(obj: unknown, prefix = ""): Array<[string, string | number | boolean | null]> {
  if (obj === null || obj === undefined) return [[prefix, null]];
  if (typeof obj !== "object") return [[prefix, obj as string | number | boolean]];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => flatten(v, `${prefix}[${i}]`));
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const aEl = document.createElement("a");
  aEl.href = url;
  aEl.download = name;
  document.body.appendChild(aEl);
  aEl.click();
  aEl.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LabPage() {
  const route = useRoute();
  const tabParam = route.query.get("tab");
  const tab: LabTab = isTab(tabParam) ? tabParam : "comparables";
  const dealId = route.query.get("deal");
  const modelId = route.query.get("model");

  const comps = useScenarios<CompsAssumptions>("lab.comparables", compsBase);
  const dcf = useScenarios<DcfAssumptions>("lab.dcf", dcfBase);
  const acc = useScenarios<AccretionAssumptions>("lab.accretion", accretionBase);
  const fig = useScenarios<FigAssumptions>("lab.fig", figBase);

  const active: ScenarioApi<unknown> = (tab === "comparables" ? comps : tab === "dcf" ? dcf : tab === "accretion" ? acc : fig) as unknown as ScenarioApi<unknown>;

  const outputsFor = useCallback(
    (t: LabTab, assumptions: unknown): Record<string, unknown> => {
      if (t === "dcf") {
        const r = computeDcf(assumptions as DcfAssumptions);
        return { wacc: r.wacc, enterpriseValue: r.dcf?.enterpriseValue ?? null, equityValue: r.equity?.bridge.equityValue ?? null, perShare: r.equity?.perShare ?? null, terminalShare: r.dcf?.terminalShare ?? null, errors: r.errors.map((e) => e.code) };
      }
      if (t === "accretion") {
        const r = computeAccretion(assumptions as AccretionAssumptions);
        return r.ok ? { proFormaEps: r.value.proFormaEps, standaloneEps: r.value.standaloneEps, accretionPct: r.value.accretionPct, newShares: r.value.newShares } : { errors: r.errors.map((e) => e.code) };
      }
      if (t === "fig") {
        const r = computeFig(assumptions as FigAssumptions);
        return { equityValue: r.ri.ok ? r.ri.value.equityValue : null, impliedPriceToBook: r.ri.ok ? r.ri.value.impliedPriceToBook : null, justifiedPb: r.justified.ok ? r.justified.value : null };
      }
      const r = computeComps(assumptions as CompsAssumptions);
      return { evEbitdaMedian: r.stats.evEbitda.median, peMedian: r.stats.pe.median, n: r.stats.evEbitda.n, impliedEquityMedian: r.impliedEquityFromEbitda.median, enterpriseValue: r.bridge.ok ? r.bridge.value.enterpriseValue : null };
    },
    [],
  );

  const exportCsv = () => {
    const rows: Array<[string, string, string | number | boolean | null]> = [];
    active.state.scenarios.forEach((s) => {
      for (const [k, v] of flatten(s.assumptions)) rows.push([s.name, `input.${k}`, v]);
      for (const [k, v] of flatten(outputsFor(tab, s.assumptions))) rows.push([s.name, `output.${k}`, v]);
    });
    const csv = toCsv(["scenario", "field", "value"], rows);
    download(`finance-lab-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  };

  return (
    <div className="mf-page mf-lab">
      <PageHead
        title="Lab"
        docTitle={`Lab — ${TABS.find((t) => t.id === tab)?.label}`}
        sub="Test valuation and transaction assumptions with deterministic calculators. Reported, calculated, assumed and training values are labelled."
        actions={
          <>
            <button type="button" className="mf-btn small" onClick={exportCsv}>
              <Icon name="download" size={15} /> CSV
            </button>
            <button type="button" className="mf-btn small" onClick={() => window.print()}>
              <Icon name="print" size={15} /> Print
            </button>
          </>
        }
      />
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} active={tab} onChange={(t) => setQuery({ tab: t === "comparables" ? null : t, model: null })} label="Lab models" />
      <TabPanel>
        <ScenarioBar tab={tab} sc={active} outputsFor={outputsFor} modelId={modelId} dealId={dealId} />
        <p className="mf-callout attention mf-small" role="note">
          <Icon name="flask" size={16} /> {TRAINING_NOTICE} Inputs marked “Training example” are fictional; your edits are “Assumed”. Calculation version {CALC_VERSION}.
        </p>
        {tab === "comparables" ? <ComparablesTab sc={comps} dealId={dealId} /> : null}
        {tab === "dcf" ? <DcfTab sc={dcf} /> : null}
        {tab === "accretion" ? <AccretionTab sc={acc} /> : null}
        {tab === "fig" ? <FigTab sc={fig} /> : null}
      </TabPanel>
    </div>
  );
}

function ScenarioBar({ tab, sc, outputsFor, modelId, dealId }: { tab: LabTab; sc: ScenarioApi<unknown>; outputsFor: (t: LabTab, a: unknown) => Record<string, unknown>; modelId: string | null; dealId: string | null }) {
  const session = useSession();
  const toast = useToast();
  const [saveState, setSaveState] = useState<SaveStateKind>("idle");
  const [loaded, setLoaded] = useState<SavedModel | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [title, setTitle] = useState("");
  const modelType = TABS.find((t) => t.id === tab)?.modelType ?? "comparables";
  const saved = useQuery<{ items: SavedModel[] }>(session.isOwner ? "/api/finance/models" : null, { scope: "private" });
  const mine = useMemo(() => (saved.data?.items ?? []).filter((m) => m.modelType === modelType), [saved.data, modelType]);

  useEffect(() => {
    if (!modelId || !session.isOwner) return;
    let cancelled = false;
    apiGet<{ model: SavedModel }>(`/api/finance/models/${encodeURIComponent(modelId)}`)
      .then((res) => {
        if (cancelled) return;
        const m = res.model;
        const targetTab = TABS.find((t) => t.modelType === m.modelType)?.id;
        if (targetTab && targetTab !== tab) {
          setQuery({ tab: targetTab === "comparables" ? null : targetTab });
          return;
        }
        setLoaded(m);
        setTitle(m.title);
        const scen = m.scenarios.length ? m.scenarios : [{ name: "Base case", assumptions: m.assumptions }];
        sc.replaceAll(scen);
        setSaveState("saved");
      })
      .catch((e: unknown) => toast.notify(`Could not load the model: ${errorMessage(e)}`, "error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per model id
  }, [modelId, session.isOwner]);

  const save = async (asNew: boolean) => {
    const body = {
      modelType,
      title: title.trim() || `${TABS.find((t) => t.id === tab)?.label} model`,
      calcVersion: CALC_VERSION,
      sourceSnapshot: { kind: dealId ? ("deal" as const) : ("training" as const), refId: dealId, archiveVersion: session.status?.app.archiveVersion ?? "unknown", reported: {} },
      assumptions: sc.current.assumptions as Record<string, unknown>,
      outputs: outputsFor(tab, sc.current.assumptions),
      scenarios: sc.state.scenarios.map((s) => ({ name: s.name, assumptions: s.assumptions as Record<string, unknown> })),
    };
    setSaveState("saving");
    try {
      if (loaded && !asNew) {
        const res = await apiSend<{ model: SavedModel }>("PATCH", `/api/finance/models/${loaded.id}`, { ...body, revision: loaded.revision });
        setLoaded(res.model);
      } else {
        const res = await apiSend<{ model: SavedModel }>("POST", "/api/finance/models", body, { idempotencyKey: newIdempotencyKey() });
        setLoaded(res.model);
        setQuery({ model: res.model.id });
      }
      invalidate("/api/finance/models");
      invalidate("/api/finance/desk");
      setSaveState("saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState("conflict");
        toast.notify("This model changed elsewhere. Reload it or save as a new model.", "error");
      } else {
        setSaveState("failed");
        toast.notify(`Save failed: ${errorMessage(e)}`, "error");
      }
    }
  };

  return (
    <div className="mf-lab-bar">
      <div className="mf-lab-scenarios" role="group" aria-label="Scenarios">
        {sc.state.scenarios.map((s, i) => (
          <button key={i} type="button" className={`mf-chip${i === sc.state.active ? " active" : ""}`} aria-pressed={i === sc.state.active} onClick={() => sc.select(i)}>
            {s.name}
          </button>
        ))}
        <button type="button" className="mf-btn small ghost" onClick={sc.duplicate} disabled={sc.state.scenarios.length >= MAX_SCENARIOS} title={`Up to ${MAX_SCENARIOS} scenarios`}>
          <Icon name="copy" size={14} /> Duplicate
        </button>
        {sc.state.active > 0 ? (
          <>
            <button
              type="button"
              className="mf-btn small ghost"
              onClick={() => {
                const name = window.prompt("Scenario name", sc.current.name);
                if (name) sc.rename(sc.state.active, name);
              }}
            >
              <Icon name="edit" size={14} /> Rename
            </button>
            <button type="button" className="mf-btn small ghost" onClick={() => sc.remove(sc.state.active)}>
              <Icon name="trash" size={14} /> Remove
            </button>
          </>
        ) : null}
        <button type="button" className="mf-btn small ghost" onClick={() => setCompareOpen(true)} disabled={sc.state.scenarios.length < 2}>
          <Icon name="compare" size={14} /> Compare
        </button>
        <button
          type="button"
          className="mf-btn small ghost"
          onClick={() => {
            if (window.confirm("Reset all scenarios on this tab to the training base case? Unsaved changes on this device will be lost.")) {
              sc.reset();
              setLoaded(null);
              setQuery({ model: null });
              setSaveState("idle");
            }
          }}
        >
          <Icon name="refresh" size={14} /> Reset
        </button>
      </div>
      <div className="mf-lab-save">
        {session.isOwner ? (
          <>
            <label className="mf-sr-only" htmlFor="lab-title">
              Model title
            </label>
            <input id="lab-title" className="mf-input mf-inline-input" placeholder="Model title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
            <button type="button" className="mf-btn small primary" onClick={() => void save(false)}>
              <Icon name="check" size={14} /> {loaded ? "Save changes" : "Save model"}
            </button>
            {loaded ? (
              <button type="button" className="mf-btn small" onClick={() => void save(true)}>
                Save as new
              </button>
            ) : null}
            <SaveState state={saveState === "idle" ? "local" : saveState} detail={saveState === "idle" ? "Draft saved on this device" : undefined} />
            {mine.length ? (
              <select className="mf-select small" aria-label="Open a saved model" value={loaded?.id ?? ""} onChange={(e) => e.target.value && setQuery({ model: e.target.value })}>
                <option value="">Open saved…</option>
                {mine.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : (
          <span className="mf-small mf-muted">
            Drafts stay on this device. <a href={signInHref()}>Sign in</a> as the owner to save models to your account.
          </span>
        )}
      </div>
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} title="Compare scenarios">
        <CompareScenarios tab={tab} sc={sc} outputsFor={outputsFor} />
      </Dialog>
    </div>
  );
}

function CompareScenarios({ tab, sc, outputsFor }: { tab: LabTab; sc: ScenarioApi<unknown>; outputsFor: (t: LabTab, a: unknown) => Record<string, unknown> }) {
  const outs = sc.state.scenarios.map((s) => ({ name: s.name, out: outputsFor(tab, s.assumptions) }));
  const keys = [...new Set(outs.flatMap((o) => Object.keys(o.out)))].filter((k) => k !== "errors");
  const fmt = (v: unknown) => (typeof v === "number" ? (Math.abs(v) < 1 && v !== 0 ? `${(v * 100).toFixed(2)}%` : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })) : v === null || v === undefined ? "—" : String(v));
  return (
    <div className="mf-table-wrap">
      <table className="mf-table compact">
        <caption className="mf-sr-only">Scenario outputs side by side</caption>
        <thead>
          <tr>
            <th scope="col">Output</th>
            {outs.map((o) => (
              <th key={o.name} scope="col" className="num">
                {o.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              {outs.map((o) => (
                <td key={o.name} className="num">
                  {fmt(o.out[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mf-xsmall mf-muted">Ratios below 1 are shown as percentages. Each scenario keeps its own assumptions; reported values are identical across scenarios.</p>
    </div>
  );
}
