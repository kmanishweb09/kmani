import { usePrefs } from "../app/prefs";
import { useQuery } from "../app/query";
import { Link } from "../app/router";
import { useSession } from "../app/session";
import { PageHead } from "../components/PageHead";
import { ErrorState, Skeleton } from "../components/ui";
import { dateLabel } from "../lib/format";

interface SectorCard {
  slug: string;
  name: string;
  tagline: string;
  subsectors: Array<{ id: string; name: string }>;
  dealCount: number;
  companyCount: number;
  latestChange: { date: string; stage: string; title: string } | null;
}

export function SectorsPage() {
  const q = useQuery<{ items: SectorCard[] }>("/api/finance/sectors");
  const { prefs, update } = usePrefs();
  const { isOwner } = useSession();
  const followed = new Set<string>(prefs.followedSectors);
  const toggle = (slug: string) => {
    const next = followed.has(slug) ? prefs.followedSectors.filter((s) => s !== slug) : [...prefs.followedSectors, slug as (typeof prefs.followedSectors)[number]];
    update({ followedSectors: next, sectorPickerDismissed: true });
  };
  return (
    <div className="mf-stack">
      <PageHead
        title="Sectors"
        sub={
          <>
            Eight playbooks: how each sector makes money, where value accrues, metrics and their limits, valuation approaches and M&A patterns. FIG is highlighted; following a sector is optional
            {isOwner ? " and saved to your account." : " and saved on this device."}
          </>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} what="sectors" />
      ) : !q.data ? (
        <Skeleton lines={8} height={40} />
      ) : (
        <div className="mf-grid-auto">
          {q.data.items.map((s) => (
            <article key={s.slug} className="mf-panel" style={s.slug === prefs.highlightSector ? { borderColor: "var(--mf-accent)" } : undefined}>
              <div className="mf-panel-head">
                <h2 className="mf-panel-title">
                  <Link to={`/finance/sectors/${s.slug}`}>{s.name}</Link>
                </h2>
                <button type="button" className="mf-btn small" aria-pressed={followed.has(s.slug)} onClick={() => toggle(s.slug)}>
                  {followed.has(s.slug) ? "Following" : "Follow"}
                </button>
              </div>
              <div className="mf-panel-body mf-stack tight">
                <p className="mf-small">{s.tagline}</p>
                <p className="mf-xsmall mf-muted">{s.subsectors.map((x) => x.name).join(" · ")}</p>
                <p className="mf-small">
                  {s.dealCount} covered deals · {s.companyCount} companies
                </p>
                {s.latestChange ? (
                  <p className="mf-xsmall mf-muted">
                    Latest dated change: {dateLabel(s.latestChange.date)} — {s.latestChange.title} ({s.latestChange.stage})
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
