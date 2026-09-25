import { useEffect, useMemo, useState } from "react";
import type { DealDetail, TermView } from "../../shared/api";
import type { CompiledAutopsy } from "../../shared/archive/compile";
import { countryName } from "../../shared/geo";
import { BUYER_TYPE_LABEL, CARD_TYPE_LABEL, DEAL_TYPE_LABEL, PAYMENT_LABEL, SECTOR_NAMES } from "../../shared/labels";
import type { Note } from "../../shared/schemas/private";
import { apiSend, errorMessage, newIdempotencyKey } from "../app/api";
import { usePrefs } from "../app/prefs";
import { invalidate, useQuery } from "../app/query";
import { Link, navigate, setQuery, useRoute } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { useToast } from "../app/toast";
import { EventSpine } from "../components/EventSpine";
import { Ev, useRegisterEvidence } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { Dialog } from "../components/Overlay";
import { AiAssist } from "../components/AiAssist";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, ProvTag, SaveState, Segmented, Skeleton, StatusPill, TabPanel, Tabs } from "../components/ui";
import { useAutosave } from "../lib/autosave";
import { type CardDraft, dealNoteDraft, memoryDrafts } from "../lib/dealDrafts";
import { asReported, dateLabel, headlineText } from "../lib/format";

type Mode = "now" | "announced";

const TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "why", label: "Why this deal" },
  { id: "price", label: "Price & structure" },
  { id: "timeline", label: "Timeline" },
  { id: "sector", label: "Sector context" },
  { id: "advisers", label: "Advisers" },
  { id: "after", label: "After the deal" },
  { id: "view", label: "Your view" },
];

interface WatchItem {
  id: string;
  kind: string;
  entityId: string;
  saved: boolean;
  following: boolean;
}

function TermRow({ t, system }: { t: TermView; system: "indian" | "international" }) {
  const value =
    t.amount !== null && t.currency && t.unit
      ? asReported(t.amount, t.currency, t.unit)
      : t.ratio !== null
        ? t.metric === "offer_premium"
          ? `${(t.ratio * 100).toFixed(1)}%`
          : `${t.ratio.toFixed(2)}×`
        : (t.text ?? "—");
  void system;
  return (
    <tr style={t.correction ? { opacity: 0.6 } : undefined}>
      <th scope="row" style={{ position: "static", background: "transparent", color: "var(--mf-text)", fontWeight: 560 }}>
        {t.label}
        {t.correction ? <span className="mf-pill attention" style={{ marginLeft: 6 }}>Superseded</span> : null}
      </th>
      <td className="num">
        {value}
        <Ev ids={t.ev} label={t.label} />
      </td>
      <td>
        {t.valueBasis ? <span className="mf-basis" style={{ marginLeft: 0 }}>{t.valueBasis === "enterprise" ? "EV" : t.valueBasis === "equity" ? "Equity" : t.valueBasis === "stake" ? "Stake" : "Basis unclear"}</span> : null}
        {t.ownershipPct !== null ? <span className="mf-small mf-muted"> {t.ownershipPct}% of target</span> : null}
        {t.amount !== null && t.text ? <div className="mf-xsmall mf-muted">{t.text}</div> : null}
      </td>
      <td className="mf-small">
        <ProvTag kind={t.status === "reported" ? "reported" : "calculated"} /> <span className="mf-muted">{t.kind.replace(/_/g, " ")} · {dateLabel(t.asOf)}</span>
        {t.reference ? <div className="mf-xsmall mf-muted">{t.reference}</div> : null}
        {t.note ? <div className="mf-xsmall mf-muted">{t.note}</div> : null}
        {t.correction ? <div className="mf-xsmall mf-muted">Superseded {t.correction.publishedAt.slice(0, 10)}: {t.correction.note}</div> : null}
      </td>
    </tr>
  );
}

function TermsTable({ terms, system, caption }: { terms: TermView[]; system: "indian" | "international"; caption: string }) {
  if (!terms.length) return <EmptyState title="No terms recorded">No sourced price or structure terms are in the archive for this view.</EmptyState>;
  return (
    <div className="mf-table-wrap">
      <table className="mf-table compact">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col" className="num">
              As reported
            </th>
            <th scope="col">Basis / scope</th>
            <th scope="col">Kind · as of</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((t) => (
            <TermRow key={t.id} t={t} system={system} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutopsyAnnounced({ a }: { a: CompiledAutopsy }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="mf-stack">
      <div className="mf-callout attention">
        <strong>As announced (information cutoff {dateLabel(a.asAnnounced.cutoff)}).</strong> Later outcomes are hidden so the original decision can be judged on what was knowable.
      </div>
      <section className="mf-section">
        <h3>The situation</h3>
        <p>{a.asAnnounced.situation}</p>
      </section>
      <section className="mf-section">
        <h3>What was the buyer actually buying?</h3>
        <p>{a.asAnnounced.whatBuyerIsBuying}</p>
      </section>
      <section className="mf-section">
        <h3>Assumptions that drive the price</h3>
        <ul className="mf-bullets">
          {a.asAnnounced.keyAssumptions.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section className="mf-section">
        <h3>Risks visible at announcement</h3>
        <ul className="mf-bullets">
          {a.asAnnounced.risksAtAnnouncement.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section className="mf-section">
        <h3>What would falsify the thesis</h3>
        <ul className="mf-bullets">
          {a.asAnnounced.falsifiers.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section className="mf-panel">
        <div className="mf-panel-head">
          <h3>Think first</h3>
          <span className="mf-hint">Optional prompts before reading the interpretation</span>
        </div>
        <div className="mf-panel-body">
          <ol className="mf-bullets">
            {a.prompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
          {!revealed ? (
            <button type="button" className="mf-btn" style={{ marginTop: 12 }} onClick={() => setRevealed(true)}>
              Reveal analytical interpretation
            </button>
          ) : (
            <div className="mf-callout analysis" style={{ marginTop: 12 }}>
              <ProvTag kind="analysis" /> <strong>Interpretation.</strong> {a.analysis.thesis}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function YourView({ deal }: { deal: DealDetail }) {
  const { isOwner, status } = useSession();
  const q = useQuery<{ note: Note | null }>(isOwner ? `/api/finance/notes/view?dealId=${deal.id}` : null, { scope: "private", staleMs: 5_000 });
  const fields = ["My thesis", "Main risk", "What I need to verify", "Interview talking point"] as const;
  type V = Record<(typeof fields)[number], string>;
  const empty: V = { "My thesis": "", "Main risk": "", "What I need to verify": "", "Interview talking point": "" };
  const parse = (body: string): V => {
    const v: V = { ...empty };
    for (const f of fields) {
      const m = new RegExp(`## ${f}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
      if (m) v[f] = (m[1] ?? "").trim();
    }
    return v;
  };
  const serialize = (v: V) => fields.map((f) => `## ${f}\n${v[f].trim()}\n`).join("\n");
  const serverValue = q.data ? (q.data.note ? parse(q.data.note.body) : empty) : undefined;
  const auto = useAutosave<V>({
    draftKey: status?.viewer.key ? `draft.view.${status.viewer.key}.${deal.id}` : null,
    serverValue,
    serverRevision: q.data?.note?.revision ?? null,
    empty,
    enabled: isOwner,
    equals: (a, b) => fields.every((f) => a[f] === b[f]),
    save: async (v, revision) => {
      const r = await apiSend<{ note: Note }>("PUT", "/api/finance/notes/view", { dealId: deal.id, title: `My view: ${deal.title}`, body: serialize(v), revision });
      invalidate("/api/finance/notes");
      return { revision: r.note.revision, value: parse(r.note.body) };
    },
  });
  if (!isOwner) {
    return (
      <EmptyState title="Your private view" icon="lock" action={<a className="mf-btn" href={signInHref()}>Sign in as owner</a>}>
        Thesis, main risk, open verification items and an interview talking point are saved privately for the site owner.
      </EmptyState>
    );
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} what="your view" />;
  if (!q.data) return <Skeleton lines={6} />;
  return (
    <div className="mf-stack">
      <div className="mf-row spread">
        <p className="mf-hint">Private to you. Saved to your account as you type; a device-local copy is kept if a save fails.</p>
        <SaveState state={auto.state} />
      </div>
      {auto.conflict ? (
        <div className="mf-callout negative">
          <strong>This view was edited in another tab or device.</strong> Choose which version to keep.
          <div className="mf-row" style={{ marginTop: 8 }}>
            <button type="button" className="mf-btn small" onClick={() => auto.resolveConflict("mine")}>
              Keep my edits
            </button>
            <button type="button" className="mf-btn small" onClick={() => auto.resolveConflict("theirs")}>
              Use the saved version
            </button>
          </div>
        </div>
      ) : null}
      {auto.state === "local" || auto.state === "failed" ? (
        <div className="mf-callout attention">
          Not saved to your account yet. {auto.state === "local" ? "A copy is kept on this device." : ""}
          <button type="button" className="mf-btn small" style={{ marginLeft: 8 }} onClick={auto.retry}>
            Retry save
          </button>
        </div>
      ) : null}
      {fields.map((f) => (
        <div className="mf-field" key={f}>
          <label htmlFor={`view-${f}`}>{f}</label>
          <textarea id={`view-${f}`} className="mf-textarea" style={{ minHeight: 90 }} value={auto.value[f]} onChange={(e) => auto.setValue((p) => ({ ...p, [f]: e.target.value }))} />
        </div>
      ))}
    </div>
  );
}

function MemoryDialog({ deal, open, onClose }: { deal: DealDetail; open: boolean; onClose: () => void }) {
  const { notify } = useToast();
  const [cards, setCards] = useState<CardDraft[]>(() => memoryDrafts(deal));
  const [extra, setExtra] = useState({ valuation_insight: "", risk: "", sixty_second: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setCards(memoryDrafts(deal));
  }, [open, deal]);
  const save = async () => {
    setBusy(true);
    try {
      const all = [
        ...cards.filter((c) => c.answer.trim()),
        ...(extra.valuation_insight.trim() ? [{ cardType: "valuation_insight" as const, prompt: `One valuation insight about “${deal.title}”?`, answer: extra.valuation_insight.trim(), sourceRefs: [{ kind: "claim" as const, id: deal.headline?.ev[0] ?? deal.announced.ev[0] ?? "" }].filter((r) => r.id) }] : []),
        ...(extra.risk.trim() ? [{ cardType: "risk" as const, prompt: `One risk in “${deal.title}”?`, answer: extra.risk.trim(), sourceRefs: [{ kind: "claim" as const, id: deal.announced.ev[0] ?? "" }].filter((r) => r.id) }] : []),
        ...(extra.sixty_second.trim() ? [{ cardType: "sixty_second" as const, prompt: `Explain “${deal.title}” in 60 seconds.`, answer: extra.sixty_second.trim(), sourceRefs: [{ kind: "claim" as const, id: deal.announced.ev[0] ?? "" }].filter((r) => r.id) }] : []),
      ].filter((c) => c.sourceRefs.length);
      const r = await apiSend<{ created: boolean; updateAvailable: boolean }>("POST", "/api/finance/memory", { subject: { type: "deal", id: deal.id }, cards: all }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/memory");
      invalidate("/api/finance/review");
      notify(r.created ? "Added to Deal Memory. First review is due today." : "Deal Memory updated (one record per deal).", "success");
      onClose();
    } catch (e) {
      notify(`Failed to save Deal Memory: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to Deal Memory"
      footer={
        <>
          <button type="button" className="mf-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="mf-btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save cards"}
          </button>
        </>
      }
    >
      <div className="mf-stack tight">
        <p className="mf-hint">Cards are drafted from sourced facts; edit before saving. Saving again updates the same record rather than duplicating it. Recall is self-assessed.</p>
        {cards.map((c, i) => (
          <div key={c.cardType} className="mf-field">
            <label htmlFor={`card-${i}`}>{CARD_TYPE_LABEL[c.cardType]}</label>
            <p className="mf-hint">{c.prompt}</p>
            <textarea id={`card-${i}`} className="mf-textarea" style={{ minHeight: 80 }} value={c.answer} onChange={(e) => setCards((cs) => cs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
          </div>
        ))}
        <div className="mf-field">
          <label htmlFor="card-val">One valuation insight (your words)</label>
          <textarea id="card-val" className="mf-textarea" style={{ minHeight: 70 }} value={extra.valuation_insight} onChange={(e) => setExtra((x) => ({ ...x, valuation_insight: e.target.value }))} />
        </div>
        <div className="mf-field">
          <label htmlFor="card-risk">One risk (your words)</label>
          <textarea id="card-risk" className="mf-textarea" style={{ minHeight: 70 }} value={extra.risk} onChange={(e) => setExtra((x) => ({ ...x, risk: e.target.value }))} />
        </div>
        <div className="mf-field">
          <label htmlFor="card-60">60-second explanation (your words)</label>
          <textarea id="card-60" className="mf-textarea" style={{ minHeight: 90 }} value={extra.sixty_second} onChange={(e) => setExtra((x) => ({ ...x, sixty_second: e.target.value }))} />
        </div>
      </div>
    </Dialog>
  );
}

function DealActions({ deal }: { deal: DealDetail }) {
  const { isOwner, status } = useSession();
  const { notify } = useToast();
  const watches = useQuery<{ items: WatchItem[] }>(isOwner ? "/api/finance/watchlist" : null, { scope: "private" });
  const w = watches.data?.items.find((x) => x.kind === "deal" && x.entityId === deal.id);
  const [memOpen, setMemOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOwner && w) void apiSend("POST", "/api/finance/watchlist/viewed", { kind: "deal", entityId: deal.id }).catch(() => undefined);
  }, [isOwner, w?.id, deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setWatch = async (patch: { saved?: boolean; following?: boolean }) => {
    if (!isOwner) {
      location.assign(signInHref());
      return;
    }
    setBusy(true);
    try {
      await apiSend("PUT", "/api/finance/watchlist", { kind: "deal", entityId: deal.id, saved: patch.saved ?? w?.saved ?? false, following: patch.following ?? w?.following ?? false });
      invalidate("/api/finance/watchlist");
      notify(patch.saved !== undefined ? (patch.saved ? "Deal saved." : "Removed from saved deals.") : patch.following ? "Following status changes." : "Stopped following.", "success");
    } catch (e) {
      notify(`Failed to save: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const draftNote = async () => {
    if (!isOwner) {
      location.assign(signInHref());
      return;
    }
    const d = dealNoteDraft(deal, status?.app.archiveCutoff ?? deal.researchCutoff);
    try {
      const r = await apiSend<{ note: Note }>("POST", "/api/finance/notes", { title: d.title, body: d.body, template: "deal_note", tags: [SECTOR_NAMES[deal.sector]], links: [{ type: "deal", id: deal.id }], evidenceIds: d.evidenceIds.slice(0, 100) }, { idempotencyKey: newIdempotencyKey() });
      invalidate("/api/finance/notes");
      notify("Draft deal note created.", "success");
      navigate(`/finance/notebook/${r.note.id}`);
    } catch (e) {
      notify(`Failed to create note: ${errorMessage(e)}`, "error");
    }
  };
  const compareWith = deal.comparables[0]?.dealId;
  return (
    <>
      <button type="button" className="mf-btn small" aria-pressed={Boolean(w?.saved)} disabled={busy} onClick={() => void setWatch({ saved: !w?.saved })}>
        <Icon name="bookmark" size={15} /> {w?.saved ? "Saved" : "Save"}
      </button>
      <button type="button" className="mf-btn small" aria-pressed={Boolean(w?.following)} disabled={busy} onClick={() => void setWatch({ following: !w?.following })}>
        <Icon name="bell" size={15} /> {w?.following ? "Following status" : "Follow status"}
      </button>
      <button type="button" className="mf-btn small" onClick={() => navigate(`/finance/deals/compare?ids=${[deal.id, compareWith].filter(Boolean).join(",")}`)}>
        <Icon name="compare" size={15} /> Compare
      </button>
      <button type="button" className="mf-btn small" onClick={() => navigate(`/finance/lab?tab=${deal.sector === "fig" ? "fig" : "comparables"}&deal=${deal.id}`)}>
        <Icon name="lab" size={15} /> Open in Lab
      </button>
      <button type="button" className="mf-btn small" onClick={() => (isOwner ? setMemOpen(true) : location.assign(signInHref()))}>
        <Icon name="layers" size={15} /> Add to Deal Memory
      </button>
      <button type="button" className="mf-btn small primary" onClick={() => void draftNote()}>
        <Icon name="edit" size={15} /> Draft Deal Note
      </button>
      {isOwner ? <MemoryDialog deal={deal} open={memOpen} onClose={() => setMemOpen(false)} /> : null}
    </>
  );
}

export function DealDetailPage({ id }: { id: string }) {
  const route = useRoute();
  const { prefs } = usePrefs();
  const q = useQuery<DealDetail>(`/api/finance/deals/${id}`);
  const deal = q.data;
  useRegisterEvidence(deal?.evidence);
  const tab = TABS.some((t) => t.id === route.query.get("tab")) ? (route.query.get("tab") as string) : "snapshot";
  const mode: Mode = route.query.get("mode") === "announced" ? "announced" : "now";
  const system = prefs.inrNumberSystem;

  useEffect(() => {
    if (deal) {
      try {
        const hist = JSON.parse(localStorage.getItem("manish.finance.v1.recent") ?? "[]") as Array<{ id: string; title: string; at: string }>;
        const next = [{ id: deal.id, title: deal.title, at: new Date().toISOString() }, ...hist.filter((h) => h.id !== deal.id)].slice(0, 10);
        localStorage.setItem("manish.finance.v1.recent", JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    }
  }, [deal]);

  const cutoff = deal?.autopsy ? (deal.autopsy as CompiledAutopsy).asAnnounced.cutoff : deal?.announced.date;
  const visibleTerms = useMemo(() => {
    if (!deal) return [];
    if (mode === "announced") return deal.terms.filter((t) => t.asOf <= (cutoff ?? deal.announced.date) && t.kind !== "final");
    return deal.terms;
  }, [deal, mode, cutoff]);

  if (q.error) {
    return (
      <div className="mf-stack">
        <PageHead title="Deal" crumbs={[{ to: "/finance/deals", label: "Deals" }]} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="this deal" />
      </div>
    );
  }
  if (!deal) {
    return (
      <div className="mf-stack">
        <PageHead title="Loading deal…" crumbs={[{ to: "/finance/deals", label: "Deals" }]} />
        <Skeleton lines={10} height={18} />
      </div>
    );
  }
  const autopsy = deal.autopsy as CompiledAutopsy | null;
  const h = headlineText(deal.headline, system);
  const announcedMode = mode === "announced";

  return (
    <div className="mf-stack">
      <PageHead
        title={deal.title}
        crumbs={[
          { to: "/finance/deals", label: "Deals" },
          { to: `/finance/sectors/${deal.sector}`, label: SECTOR_NAMES[deal.sector] },
        ]}
        eyebrow={`${DEAL_TYPE_LABEL[deal.dealType]} · ${deal.subsector}`}
        sub={
          <span className="mf-row" style={{ gap: 8 }}>
            {announcedMode ? <span className="mf-pill accent">Announced (as of {dateLabel(cutoff)})</span> : <StatusPill status={deal.status} />}
            {!announcedMode ? <Ev ids={deal.statusEv} label="status" /> : null}
            <span>
              Announced {dateLabel(deal.announced)}
              <Ev ids={deal.announced.ev} label="announcement date" />
            </span>
            {deal.headline ? (
              <span>
                · {h.value} <span className="mf-basis">{h.basis}</span>
                <Ev ids={deal.headline.ev} label="headline value" />
              </span>
            ) : (
              <span>· Value undisclosed</span>
            )}
          </span>
        }
        actions={<DealActions deal={deal} />}
      />

      <div className="mf-row spread">
        <Segmented<Mode>
          label="Hindsight mode"
          value={mode}
          onChange={(m) => setQuery({ mode: m === "announced" ? "announced" : null })}
          options={[
            { value: "announced", label: "As announced" },
            { value: "now", label: "What we know now" },
          ]}
        />
        <span className="mf-hint">
          Research cutoff {dateLabel(deal.researchCutoff)} · record updated {dateLabel(deal.recordUpdated)}
        </span>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(t) => setQuery({ tab: t === "snapshot" ? null : t })} label="Deal sections" />
      <TabPanel>
        {tab === "snapshot" ? (
          <div className="mf-detail-layout">
            <section className="mf-panel">
              <div className="mf-panel-body">
                <dl className="mf-dl">
                  <dt>Acquirer / investor</dt>
                  <dd>
                    {deal.acquirer.companyId ? <Link to={`/finance/companies/${deal.acquirer.companyId}`}>{deal.acquirer.name}</Link> : deal.acquirer.name} ({countryName(deal.acquirer.country)})
                    <Ev ids={deal.acquirer.ev} label="acquirer" />
                  </dd>
                  <dt>Target</dt>
                  <dd>
                    {deal.target.companyId ? <Link to={`/finance/companies/${deal.target.companyId}`}>{deal.target.name}</Link> : deal.target.name} ({countryName(deal.target.country)})
                    <Ev ids={deal.target.ev} label="target" />
                  </dd>
                  {deal.otherParties.map((p) => (
                    <FragmentRow key={`${p.role}-${p.name}`} label={p.role.replace(/_/g, " ")}>
                      {p.companyId ? <Link to={`/finance/companies/${p.companyId}`}>{p.name}</Link> : p.name} ({countryName(p.country)})
                      <Ev ids={p.ev} label={p.role} />
                    </FragmentRow>
                  ))}
                  <dt>Perimeter</dt>
                  <dd>{deal.perimeter}</dd>
                  <dt>Structure</dt>
                  <dd>
                    {DEAL_TYPE_LABEL[deal.dealType]} · {BUYER_TYPE_LABEL[deal.buyerType]} buyer
                  </dd>
                  <dt>Stake</dt>
                  <dd>
                    {deal.stake.acquiredPct !== null ? `${deal.stake.acquiredPct}% acquired` : "Not disclosed"}
                    {deal.stake.resultingPct !== null ? ` · ${deal.stake.resultingPct}% held after` : ""}
                    <Ev ids={deal.stakeEv} label="stake" />
                    {deal.stakeNote ? <div className="mf-hint">{deal.stakeNote}</div> : null}
                  </dd>
                  <dt>Value</dt>
                  <dd>
                    {deal.headline ? (
                      <>
                        {h.value} <span className="mf-basis">{h.basis}</span> <Ev ids={deal.headline.ev} label="value" />
                        <div className="mf-hint">See Price & structure for every disclosed term with its basis.</div>
                      </>
                    ) : (
                      "Undisclosed"
                    )}
                  </dd>
                  <dt>Consideration</dt>
                  <dd>
                    {deal.paymentMix.map((p) => PAYMENT_LABEL[p]).join(", ")} — {deal.payment.text}
                    <Ev ids={deal.payment.ev} label="consideration" />
                  </dd>
                  <dt>Financing</dt>
                  <dd>
                    {deal.financing ? (
                      <>
                        {deal.financing.text}
                        <Ev ids={deal.financing.ev} label="financing" />
                      </>
                    ) : (
                      <span className="mf-muted">Not disclosed / not researched</span>
                    )}
                  </dd>
                  <dt>Announced</dt>
                  <dd>
                    {dateLabel(deal.announced)}
                    <Ev ids={deal.announced.ev} label="announcement" />
                  </dd>
                  <dt>Effective / completed</dt>
                  <dd>
                    {announcedMode ? (
                      <span className="mf-muted">Hidden in As announced mode</span>
                    ) : deal.effective ? (
                      <>
                        {dateLabel(deal.effective)}
                        <Ev ids={deal.effective.ev} label="effective date" />
                      </>
                    ) : (
                      <span className="mf-muted">Not completed or not recorded</span>
                    )}
                  </dd>
                  <dt>Countries</dt>
                  <dd>
                    Target {countryName(deal.target.country)} · Acquirer {countryName(deal.acquirer.country)} {deal.crossBorder ? "· cross-border" : "· domestic"}
                  </dd>
                </dl>
              </div>
            </section>
            <aside className="mf-stack tight">
              <section className="mf-panel">
                <div className="mf-panel-head">
                  <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                    Evidence coverage
                  </h2>
                </div>
                <div className="mf-panel-body mf-small">
                  <ul className="mf-bullets" style={{ paddingLeft: 18 }}>
                    <li>{deal.verification.source_checked} source checked</li>
                    <li>{deal.verification.search_corroborated} search-corroborated</li>
                    <li>{deal.verification.pending} pending check</li>
                    <li>{deal.verification.conflict} conflicting</li>
                    <li>{deal.verification.human_reviewed} human reviewed</li>
                  </ul>
                  <p className="mf-hint" style={{ marginTop: 8 }}>
                    Click the evidence icon next to any value to see its source, locator and verification method.
                  </p>
                </div>
              </section>
              <section className="mf-panel">
                <div className="mf-panel-head">
                  <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
                    Comparable transactions
                  </h2>
                </div>
                <div className="mf-panel-body">
                  {deal.comparables.length ? (
                    <ul className="mf-list">
                      {deal.comparables.map((c) => (
                        <li key={c.dealId}>
                          <Link to={`/finance/deals/${c.dealId}`}>{c.title ?? c.dealId}</Link>
                          <div className="mf-hint">{c.reason}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mf-hint">No comparable deals linked yet.</p>
                  )}
                </div>
              </section>
              <AiAssist subject={{ type: "deal", id: deal.id }} subjectTitle={deal.title} ops={["summarize", "questions", "explain", "draft_note"]} />
            </aside>
          </div>
        ) : null}

        {tab === "why" ? (
          <div className="mf-stack">
            <section className="mf-section">
              <h2>Management’s stated rationale</h2>
              {deal.rationale.length ? (
                <ul className="mf-bullets">
                  {deal.rationale.map((r) => (
                    <li key={r.text}>
                      <ProvTag kind="management" /> {r.text}
                      <Ev ids={r.ev} label="stated rationale" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mf-muted">No stated rationale recorded.</p>
              )}
            </section>
            {autopsy ? (
              announcedMode ? (
                <AutopsyAnnounced a={autopsy} />
              ) : (
                <>
                  <section className="mf-callout analysis">
                    <ProvTag kind="analysis" /> <strong>Analytical interpretation.</strong> {autopsy.analysis.thesis}
                  </section>
                  <div className="mf-grid-3">
                    <section className="mf-panel">
                      <div className="mf-panel-head">
                        <h3>Alternative explanations</h3>
                      </div>
                      <div className="mf-panel-body">
                        <ul className="mf-bullets">{autopsy.analysis.alternatives.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    </section>
                    <section className="mf-panel">
                      <div className="mf-panel-head">
                        <h3>Key risks</h3>
                      </div>
                      <div className="mf-panel-body">
                        <ul className="mf-bullets">{autopsy.analysis.risks.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    </section>
                    <section className="mf-panel">
                      <div className="mf-panel-head">
                        <h3>What would falsify it</h3>
                      </div>
                      <div className="mf-panel-body">
                        <ul className="mf-bullets">{autopsy.analysis.falsifiers.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    </section>
                  </div>
                  <section className="mf-panel">
                    <div className="mf-panel-head">
                      <h3>Self-review rubric</h3>
                      <span className="mf-hint">Assesses evidence, logic, valuation and risk coverage — not whether an opinion is “correct”.</span>
                    </div>
                    <div className="mf-panel-body flush">
                      <div className="mf-table-wrap">
                        <table className="mf-table compact">
                          <thead>
                            <tr>
                              <th scope="col">Criterion</th>
                              <th scope="col">Strong answer</th>
                              <th scope="col">Weak answer</th>
                            </tr>
                          </thead>
                          <tbody>
                            {autopsy.rubric.map((r) => (
                              <tr key={r.criterion}>
                                <td className="strong">{r.criterion}</td>
                                <td className="wrap">{r.strong}</td>
                                <td className="wrap">{r.weak}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                </>
              )
            ) : (
              <div className="mf-callout">This record is not a deep autopsy. Stated rationale and sourced facts are shown; use Your view to write your interpretation.</div>
            )}
          </div>
        ) : null}

        {tab === "price" ? (
          <div className="mf-stack">
            <TermsTable terms={visibleTerms} system={system} caption={announcedMode ? `Terms known at announcement (cutoff ${dateLabel(cutoff)})` : "All recorded terms, including revisions; superseded terms stay visible"} />
            {autopsy && !announcedMode ? (
              <section className="mf-section">
                <h3>How the price and structure work</h3>
                <p>
                  <ProvTag kind="analysis" /> {autopsy.asAnnounced.priceAndStructure}
                </p>
              </section>
            ) : null}
            {autopsy && announcedMode ? (
              <section className="mf-section">
                <h3>Price and structure at announcement</h3>
                <p>{autopsy.asAnnounced.priceAndStructure}</p>
              </section>
            ) : null}
            <div className="mf-callout">
              Multiples appear only where a sourced denominator exists for a comparable period. Missing values are shown as unavailable, never as zero. Price reaction is not shown: no licensed price source is connected.
            </div>
          </div>
        ) : null}

        {tab === "timeline" ? (
          <section className="mf-panel">
            <div className="mf-panel-body">
              <EventSpine events={deal.events} hiddenAfter={announcedMode ? (cutoff ?? deal.announced.date) : null} />
            </div>
          </section>
        ) : null}

        {tab === "sector" ? (
          <div className="mf-stack">
            {deal.sectorContext ? <p style={{ maxWidth: 820 }}>{deal.sectorContext}</p> : <p className="mf-muted">No deal-specific sector note recorded.</p>}
            <p>
              Read the <Link to={`/finance/sectors/${deal.sector}`}>{SECTOR_NAMES[deal.sector]} playbook</Link> for economics, metrics, valuation approaches and diligence questions.
            </p>
          </div>
        ) : null}

        {tab === "advisers" ? (
          <div className="mf-stack">
            {deal.advisers.list.length ? (
              <div className="mf-table-wrap">
                <table className="mf-table compact">
                  <thead>
                    <tr>
                      <th scope="col">Side</th>
                      <th scope="col">Role</th>
                      <th scope="col">Adviser</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deal.advisers.list.map((a) => (
                      <tr key={`${a.side}-${a.role}-${a.name}`}>
                        <td>{a.side}</td>
                        <td>{a.role.replace(/_/g, " ")}</td>
                        <td>
                          {a.name}
                          <Ev ids={a.ev} label={`${a.name} role`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={deal.advisers.disclosure === "not_researched" ? "Advisers not yet researched" : "Advisers not disclosed in the sources reviewed"}>
                Advisers are listed only with a source for their role. Banks and law firms are never inferred.
              </EmptyState>
            )}
            {deal.advisers.note ? <p className="mf-hint">{deal.advisers.note}</p> : null}
          </div>
        ) : null}

        {tab === "after" ? (
          announcedMode ? (
            <div className="mf-callout attention">After-the-deal outcomes are hidden in As announced mode. Switch to What we know now.</div>
          ) : (
            <div className="mf-stack">
              {autopsy ? (
                <>
                  <section className="mf-section">
                    <h2>What we know now (cutoff {dateLabel(autopsy.whatWeKnowNow.cutoff)})</h2>
                    <ul className="mf-bullets">
                      {autopsy.whatWeKnowNow.facts.map((f) => (
                        <li key={f.text}>
                          <ProvTag kind="fact" /> {f.text}
                          <Ev ids={f.ev} label="outcome" />
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="mf-section">
                    <h3>Interpretation</h3>
                    <ul className="mf-bullets">
                      {autopsy.whatWeKnowNow.interpretation.map((x) => (
                        <li key={x}>
                          <ProvTag kind="analysis" /> {x}
                        </li>
                      ))}
                    </ul>
                    {autopsy.whatWeKnowNow.evidenceLimits ? <p className="mf-hint">Evidence limits: {autopsy.whatWeKnowNow.evidenceLimits}</p> : null}
                  </section>
                </>
              ) : null}
              {deal.afterDeal.length ? (
                <ul className="mf-list">
                  {deal.afterDeal.map((a) => (
                    <li key={a.text}>
                      <ProvTag kind={a.kind === "fact" ? "fact" : "analysis"} /> {a.date ? <span className="mf-mono mf-small">{dateLabel(a.date)} · </span> : null}
                      {a.text}
                      <Ev ids={a.ev} label="after the deal" />
                    </li>
                  ))}
                </ul>
              ) : !autopsy ? (
                <EmptyState title="No post-deal observations recorded">Integration outcomes are added only with sources.</EmptyState>
              ) : null}
            </div>
          )
        ) : null}

        {tab === "view" ? <YourView deal={deal} /> : null}
      </TabPanel>
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ textTransform: "capitalize" }}>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
