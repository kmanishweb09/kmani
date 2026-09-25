import { useMemo, useState } from "react";
import type { DealSummary, EventView } from "../../shared/api";
import { localDate } from "../../shared/dates";
import { EVENT_TYPE_LABEL, SECTOR_NAMES, SECTOR_SLUGS } from "../../shared/labels";
import { usePrefs } from "../app/prefs";
import { useQuery } from "../app/query";
import { Link } from "../app/router";
import { signInHref, useSession } from "../app/session";
import { readLocal, writeLocal } from "../app/storage";
import { Ev } from "../components/Evidence";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { EmptyState, ErrorState, Skeleton, StatusPill, TableSkeleton } from "../components/ui";
import { dateLabel, formatTimestamp, headlineText } from "../lib/format";
import { BriefItem, type BriefView } from "./BriefsPage";

interface TapeRow {
  dealId: string;
  title: string;
  status: DealSummary["status"];
  sector: DealSummary["sector"];
  event: Pick<EventView, "type" | "date" | "title" | "ev">;
  headline: DealSummary["headline"];
}

interface DeskPrivate {
  today: string;
  timezone: string;
  lastNote: { id: string; title: string; updatedAt: string } | null;
  lastModel: { id: string; title: string; modelType: string; updatedAt: string } | null;
  reviews: { due: number; total: number };
  watched: { changed: number; total: number; items: Array<{ kind: string; entityId: string; title: string; changed: boolean }> };
  savedSearches: Array<{ id: string; name: string; changes: number }>;
  relevantItems: { matching: number; total: number; windowDays: number };
  nextModule: { id: string; title: string; number: number } | null;
  progress: { modulesCompleted: number; modulesTotal: number; questionsAnswered: number };
}

interface TodayResponse {
  today: string;
  brief: BriefView | null;
  latest: BriefView | null;
  scheduleNote: string;
}

type SessionLen = "10" | "30" | "60";

function SessionPlan({ len, today, autopsyDeal, sector, isOwner }: { len: SessionLen; today: string; autopsyDeal: string | null; sector: string; isOwner: boolean }) {
  const key = `session.${today}.${len}`;
  const [done, setDone] = useState<number[]>(() => readLocal<number[]>(key, []));
  const toggle = (i: number) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    writeLocal(key, next);
  };
  const steps: Array<{ label: string; to: string }> =
    len === "10"
      ? [
          { label: "Read the brief (latest available)", to: "/finance/briefs" },
          { label: isOwner ? "Answer one recall question from Deal Memory" : "Answer one practice question", to: isOwner ? "/finance/notebook?tab=review" : "/finance/notebook?tab=learn" },
        ]
      : len === "30"
        ? [
            { label: "Read the brief", to: "/finance/briefs" },
            { label: "Work through one deal autopsy (As announced first)", to: autopsyDeal ? `/finance/deals/${autopsyDeal}?mode=announced&tab=why` : "/finance/deals?autopsy=yes&geo=global" },
            { label: "Write a short deal note", to: autopsyDeal ? `/finance/deals/${autopsyDeal}?tab=view` : "/finance/notebook?tab=notes" },
          ]
        : [
            { label: `Sector deep dive: ${SECTOR_NAMES[sector as keyof typeof SECTOR_NAMES] ?? "FIG"}`, to: `/finance/sectors/${sector}` },
            { label: "Model exercise: DCF training case, then change WACC", to: "/finance/lab?tab=dcf" },
            { label: "Reflection: weekly reflection note", to: "/finance/notebook?tab=notes&new=weekly_reflection" },
          ];
  return (
    <div className="mf-panel">
      <div className="mf-panel-body">
        <p className="mf-hint" style={{ marginBottom: 8 }}>
          A bounded sequence for a {len}-minute session. Progress is kept on this device for today only; nothing is scheduled or sent.
        </p>
        <ol className="mf-steps">
          {steps.map((s, i) => (
            <li key={s.label} data-done={done.includes(i)}>
              <div className="mf-row spread">
                <Link to={s.to}>{s.label}</Link>
                <label className="mf-check mf-small">
                  <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} /> Done
                </label>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function DeskPage() {
  const { status, isOwner, signedIn } = useSession();
  const { prefs, update } = usePrefs();
  const [len, setLen] = useState<SessionLen | null>(null);
  const today = useQuery<TodayResponse>(`/api/finance/briefs/today?days=${prefs.newsWindowDays}`, { staleMs: 60_000 });
  const tape = useQuery<{ items: TapeRow[] }>("/api/finance/deals/tape?limit=10");
  const desk = useQuery<DeskPrivate>(isOwner ? `/api/finance/desk?days=${prefs.newsWindowDays}` : null, { scope: "private", staleMs: 30_000 });
  const sectors = useQuery<{ items: Array<{ slug: string; name: string; dealCount: number; latestChange: { date: string; title: string; stage: string } | null }> }>("/api/finance/sectors");
  const autopsies = useQuery<{ items: DealSummary[] }>("/api/finance/deals?autopsy=yes&geo=global&pageSize=20");
  const recent = useMemo(() => readLocal<Array<{ id: string; title: string; at: string }>>("recent", []), []);
  const localToday = status ? localDate(new Date(status.serverTime), prefs.timezone) : null;
  const followed = prefs.followedSectors.length ? prefs.followedSectors : [prefs.highlightSector];
  const autopsyDeal = autopsies.data?.items.find((d) => !recent.some((r) => r.id === d.id))?.id ?? autopsies.data?.items[0]?.id ?? null;
  const brief = today.data?.brief ?? null;
  const shownBrief = brief ?? today.data?.latest ?? null;

  return (
    <div className="mf-stack">
      <PageHead
        title="Finance Desk"
        docTitle="Desk"
        sub={
          <>
            {localToday ? `${dateLabel(localToday)} (${prefs.timezone === "Asia/Kolkata" ? "IST" : prefs.timezone})` : "…"} · research archive cutoff {status ? dateLabel(status.app.archiveCutoff) : "…"}
          </>
        }
        actions={
          <div className="mf-row" role="group" aria-label="Session length">
            <span className="mf-small mf-muted">Session:</span>
            {(["10", "30", "60"] as const).map((l) => (
              <button key={l} type="button" className="mf-chip" aria-pressed={len === l} onClick={() => setLen(len === l ? null : l)}>
                <Icon name="timer" size={14} /> {l} min
              </button>
            ))}
          </div>
        }
      />

      {!prefs.sectorPickerDismissed ? (
        <div className="mf-callout" role="region" aria-label="Choose your sectors">
          <div className="mf-row spread">
            <strong>Choose your sectors (optional).</strong>
            <button type="button" className="mf-btn ghost small" onClick={() => update({ sectorPickerDismissed: true })} aria-label="Dismiss sector chooser">
              <Icon name="close" size={14} />
            </button>
          </div>
          <p className="mf-small" style={{ margin: "4px 0 8px" }}>
            Followed sectors rank the brief and fill your watchlist. FIG is highlighted by default; everything works without choosing.
          </p>
          <div className="mf-row">
            {SECTOR_SLUGS.map((s) => (
              <button
                key={s}
                type="button"
                className="mf-chip"
                aria-pressed={prefs.followedSectors.includes(s)}
                onClick={() => update({ followedSectors: prefs.followedSectors.includes(s) ? prefs.followedSectors.filter((x) => x !== s) : [...prefs.followedSectors, s] })}
              >
                {SECTOR_NAMES[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {len && localToday ? <SessionPlan len={len} today={localToday} autopsyDeal={autopsyDeal} sector={followed[0] ?? "fig"} isOwner={isOwner} /> : null}

      {isOwner && desk.data ? (
        <div className="mf-figures" role="list" aria-label="Summary figures">
          <div className="mf-figure" role="listitem">
            <div className="mf-figure-value">
              {desk.data.relevantItems.matching}
              <span className="mf-muted" style={{ fontSize: 15 }}> / {desk.data.relevantItems.total}</span>
            </div>
            <div className="mf-figure-label">New relevant items</div>
            <div className="mf-figure-def">Source-linked items in the last {desk.data.relevantItems.windowDays} days matching followed sectors, of all items discovered in that window</div>
          </div>
          <div className="mf-figure" role="listitem">
            <div className="mf-figure-value">
              {desk.data.watched.changed}
              <span className="mf-muted" style={{ fontSize: 15 }}> / {desk.data.watched.total}</span>
            </div>
            <div className="mf-figure-label">Watched deals with changes</div>
            <div className="mf-figure-def">Followed deals whose record changed since you last opened them</div>
          </div>
          <div className="mf-figure" role="listitem">
            <div className="mf-figure-value">
              {desk.data.reviews.due}
              <span className="mf-muted" style={{ fontSize: 15 }}> / {desk.data.reviews.total}</span>
            </div>
            <div className="mf-figure-label">Reviews due</div>
            <div className="mf-figure-def">Deal Memory and concept cards due on or before {dateLabel(desk.data.today)} ({desk.data.timezone}), of all active cards</div>
          </div>
        </div>
      ) : null}

      <div className="mf-desk-grid">
        <div className="mf-stack">
          <section className="mf-panel" aria-labelledby="brief-title">
            <div className="mf-panel-head">
              <h2 id="brief-title">{brief ? "Today’s brief" : shownBrief ? "Latest available brief" : "Today’s brief"}</h2>
              {shownBrief ? (
                <Link to={`/finance/briefs/${shownBrief.id}`} className="mf-small">
                  Open full brief
                </Link>
              ) : null}
            </div>
            <div className="mf-panel-body">
              {today.error ? (
                <ErrorState error={today.error} onRetry={() => void today.refetch()} what="the brief" />
              ) : !today.data ? (
                <Skeleton lines={6} />
              ) : !shownBrief ? (
                <EmptyState title="No brief for today yet">{today.data.scheduleNote}</EmptyState>
              ) : (
                <div className="mf-stack tight">
                  {!brief ? (
                    <div className="mf-callout attention">
                      No brief for today ({dateLabel(today.data.today)}) yet. Showing the latest available brief — <strong>{shownBrief.label}</strong>, cutoff {formatTimestamp(shownBrief.cutoffAt)}. {today.data.scheduleNote}
                    </div>
                  ) : null}
                  <ol className="mf-list" style={{ listStyle: "none", paddingLeft: 0 }}>
                    {shownBrief.items.slice(0, 5).map((i) => (
                      <BriefItem key={i.rank} item={i} />
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>

          <section className="mf-panel" aria-labelledby="tape-title">
            <div className="mf-panel-head">
              <h2 id="tape-title">Recent deal tape</h2>
              <Link to="/finance/deals" className="mf-small">
                Deal Terminal
              </Link>
            </div>
            <div className="mf-panel-body flush">
              {tape.error ? (
                <ErrorState error={tape.error} onRetry={() => void tape.refetch()} what="the deal tape" />
              ) : !tape.data ? (
                <TableSkeleton rows={6} cols={4} />
              ) : !tape.data.items.length ? (
                <EmptyState title="No recorded deal events" />
              ) : (
                <div className="mf-table-wrap">
                  <table className="mf-table compact">
                    <caption className="mf-sr-only">Latest recorded announcements and status changes in the covered database</caption>
                    <thead>
                      <tr>
                        <th scope="col">Event date</th>
                        <th scope="col">Deal</th>
                        <th scope="col">Event</th>
                        <th scope="col" className="num">
                          Value (basis)
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tape.data.items.map((r) => {
                        const h = headlineText(r.headline, prefs.inrNumberSystem);
                        return (
                          <tr key={`${r.dealId}-${r.event.date.date}-${r.event.type}`}>
                            <td className="mf-mono nowrap">{dateLabel(r.event.date)}</td>
                            <td className="wrap">
                              <Link className="row-link" to={`/finance/deals/${r.dealId}`}>
                                {r.title}
                              </Link>
                              <span className="mf-xsmall mf-muted" style={{ display: "block" }}>
                                {SECTOR_NAMES[r.sector]}
                              </span>
                            </td>
                            <td className="wrap mf-small">
                              {EVENT_TYPE_LABEL[r.event.type] ?? r.event.type}: {r.event.title}
                              <Ev ids={r.event.ev} label={r.event.title} />
                            </td>
                            <td className="num nowrap">
                              {r.headline ? (
                                <>
                                  {h.value}
                                  <span className="mf-basis">{h.basis}</span>
                                </>
                              ) : (
                                <span className="mf-muted">Undisclosed</span>
                              )}
                            </td>
                            <td>
                              <StatusPill status={r.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="mf-panel-foot">Covered transactions within this database, ordered by event date. Not a market-wide activity feed.</div>
          </section>

          <section className="mf-panel" aria-labelledby="sectors-title">
            <div className="mf-panel-head">
              <h2 id="sectors-title">Sector watchlist</h2>
              <Link to="/finance/sectors" className="mf-small">
                All sectors
              </Link>
            </div>
            <div className="mf-panel-body">
              {!sectors.data ? (
                <Skeleton lines={4} />
              ) : (
                <ul className="mf-list">
                  {sectors.data.items
                    .filter((s) => followed.includes(s.slug as (typeof followed)[number]))
                    .map((s) => (
                      <li key={s.slug}>
                        <div className="mf-row spread">
                          <Link to={`/finance/sectors/${s.slug}`} className="mf-item-title">
                            {s.name}
                          </Link>
                          <span className="mf-xsmall mf-muted">{s.dealCount} covered deals</span>
                        </div>
                        {s.latestChange ? (
                          <p className="mf-small mf-muted" style={{ marginTop: 4 }}>
                            {dateLabel(s.latestChange.date)} · {s.latestChange.stage}: {s.latestChange.title}
                          </p>
                        ) : null}
                      </li>
                    ))}
                </ul>
              )}
              {!prefs.followedSectors.length ? <p className="mf-hint">Showing the highlighted sector. Follow sectors from any sector page.</p> : null}
            </div>
          </section>
        </div>

        <aside className="mf-stack">
          <section className="mf-panel" aria-labelledby="continue-title">
            <div className="mf-panel-head">
              <h2 id="continue-title">Continue research</h2>
            </div>
            <div className="mf-panel-body">
              {recent.length ? (
                <p className="mf-small">
                  Last opened deal (this device): <Link to={`/finance/deals/${recent[0]?.id}`}>{recent[0]?.title}</Link>
                </p>
              ) : null}
              {isOwner ? (
                desk.error ? (
                  <ErrorState error={desk.error} onRetry={() => void desk.refetch()} what="your research" />
                ) : !desk.data ? (
                  <Skeleton lines={3} />
                ) : (
                  <ul className="mf-list">
                    {desk.data.lastNote ? (
                      <li>
                        Note: <Link to={`/finance/notebook/${desk.data.lastNote.id}`}>{desk.data.lastNote.title}</Link>
                        <div className="mf-hint">Updated {formatTimestamp(desk.data.lastNote.updatedAt)}</div>
                      </li>
                    ) : null}
                    {desk.data.lastModel ? (
                      <li>
                        Model: <Link to={`/finance/lab?model=${desk.data.lastModel.id}`}>{desk.data.lastModel.title}</Link>
                        <div className="mf-hint">Updated {formatTimestamp(desk.data.lastModel.updatedAt)}</div>
                      </li>
                    ) : null}
                    {!desk.data.lastNote && !desk.data.lastModel && !recent.length ? <li className="mf-hint">Nothing started yet. Open a deal or a Lab model to begin.</li> : null}
                  </ul>
                )
              ) : !recent.length ? (
                <p className="mf-hint">{signedIn ? "Private notes and models are for the site owner." : "Sign in as the owner to resume notes and saved models."}</p>
              ) : null}
            </div>
          </section>

          <section className="mf-panel" aria-labelledby="review-title">
            <div className="mf-panel-head">
              <h2 id="review-title">Review due</h2>
            </div>
            <div className="mf-panel-body mf-stack tight">
              {isOwner ? (
                desk.data ? (
                  <>
                    <p>
                      <span className="mf-mono" style={{ fontSize: 20 }}>
                        {desk.data.reviews.due}
                      </span>{" "}
                      card{desk.data.reviews.due === 1 ? "" : "s"} due today of {desk.data.reviews.total}
                    </p>
                    <Link className="mf-btn primary small" to="/finance/notebook?tab=review">
                      <Icon name="play" size={14} /> Start 5-minute review
                    </Link>
                  </>
                ) : (
                  <Skeleton lines={2} />
                )
              ) : (
                <>
                  <p className="mf-hint">Deal Memory cards and spaced review are private to the owner.</p>
                  <a className="mf-btn small" href={signInHref()}>
                    Sign in
                  </a>
                </>
              )}
            </div>
          </section>

          {isOwner && desk.data?.savedSearches.length ? (
            <section className="mf-panel" aria-labelledby="ss-title">
              <div className="mf-panel-head">
                <h2 id="ss-title">Saved search changes</h2>
              </div>
              <div className="mf-panel-body">
                <ul className="mf-list">
                  {desk.data.savedSearches.map((s) => (
                    <li key={s.id} className="mf-row spread">
                      <Link to={`/finance/deals?saved=${s.id}`}>{s.name}</Link>
                      {s.changes ? <span className="mf-pill accent">{s.changes} changed</span> : <span className="mf-xsmall mf-muted">no changes</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="mf-panel" aria-labelledby="learn-title">
            <div className="mf-panel-head">
              <h2 id="learn-title">One learning action</h2>
            </div>
            <div className="mf-panel-body mf-stack tight">
              {desk.data?.nextModule ? (
                <>
                  <p className="mf-small">
                    Next module: <strong>{desk.data.nextModule.number}. {desk.data.nextModule.title}</strong>
                  </p>
                  <p className="mf-hint">
                    {desk.data.progress.modulesCompleted} of {desk.data.progress.modulesTotal} modules completed · {desk.data.progress.questionsAnswered} questions answered
                  </p>
                  <Link className="mf-btn small" to={`/finance/notebook?tab=learn&module=${desk.data.nextModule.id}`}>
                    Open module
                  </Link>
                </>
              ) : (
                <>
                  <p className="mf-small">Start with how the three financial statements connect, or jump straight into a deal and open definitions in context.</p>
                  <Link className="mf-btn small" to="/finance/notebook?tab=learn">
                    Learning library
                  </Link>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
