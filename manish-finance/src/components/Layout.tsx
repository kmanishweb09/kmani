import { type ReactNode, useEffect, useState } from "react";
import { relativeAge } from "../../shared/dates";
import { usePrefs } from "../app/prefs";
import { Link, type RouteName, useRoute } from "../app/router";
import { signInHref, signOutHref, useSession } from "../app/session";
import { Icon, type IconName } from "./Icon";

const NAV: Array<{ to: string; label: string; icon: IconName; match: RouteName[] }> = [
  { to: "/finance", label: "Desk", icon: "desk", match: ["desk"] },
  { to: "/finance/deals", label: "Deals", icon: "deals", match: ["deals", "deal", "compare"] },
  { to: "/finance/sectors", label: "Sectors", icon: "sectors", match: ["sectors", "sector"] },
  { to: "/finance/companies", label: "Companies", icon: "companies", match: ["companies", "company"] },
  { to: "/finance/lab", label: "Lab", icon: "lab", match: ["lab"] },
  { to: "/finance/briefs", label: "Briefs", icon: "briefs", match: ["briefs", "brief"] },
  { to: "/finance/notebook", label: "Notebook", icon: "notebook", match: ["notebook", "note"] },
];

const UTIL: Array<{ to: string; label: string; icon: IconName; match: RouteName[] }> = [
  { to: "/finance/sources", label: "Sources", icon: "sources", match: ["sources", "research"] },
  { to: "/finance/settings", label: "Settings", icon: "settings", match: ["settings"] },
];

function NavLink({ item, collapsed, active, onNavigate }: { item: (typeof NAV)[number]; collapsed: boolean; active: boolean; onNavigate: () => void }) {
  return (
    <Link to={item.to} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined} onClick={onNavigate}>
      <Icon name={item.icon} size={19} />
      <span className="mf-nav-text">{item.label}</span>
    </Link>
  );
}

/** Source-status control: last successful refresh, never "Live" merely because a timer runs. */
export function SourceStatusControl() {
  const { status } = useSession();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!status) {
    return (
      <Link to="/finance/sources" className="mf-btn ghost small" aria-label="Source status loading">
        <Icon name="signal" size={16} /> Sources…
      </Link>
    );
  }
  const s = status.sources;
  const ok = s.summary.working;
  const problems = s.summary.failed + s.summary.access_unavailable + s.summary.rate_limited + s.summary.stale;
  const tone = problems ? "attention" : ok ? "positive" : "muted";
  const label = s.lastSuccessAt ? `Sources updated ${relativeAge(s.lastSuccessAt, now)}${s.fixtureUpstreams ? " (test fixtures)" : ""}` : "No source refresh yet";
  return (
    <Link to="/finance/sources" className="mf-btn ghost small" title={`${label}. Archive cutoff ${status.app.archiveCutoff}. Background schedule: ${status.capabilities.maintenance.scheduler.replace("_", " ")}.`}>
      <span className={`mf-pill ${tone}`} style={{ height: 20, padding: "0 6px" }}>
        <Icon name="signal" size={12} />
        <span className="mf-desktop-only">{problems ? `${problems} issue${problems > 1 ? "s" : ""}` : ok ? `${ok} working` : "Archive only"}</span>
      </span>
      <span className="mf-desktop-only mf-small">{label}</span>
    </Link>
  );
}

export function Layout({ children, onOpenPalette }: { children: ReactNode; onOpenPalette: () => void }) {
  const route = useRoute();
  const { prefs, update } = usePrefs();
  const { status, isOwner, signedIn } = useSession();
  const [mobileNav, setMobileNav] = useState(false);
  const collapsed = prefs.sidebarCollapsed;
  useEffect(() => setMobileNav(false), [route.path]);
  useEffect(() => {
    if (!mobileNav) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileNav(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNav]);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const close = () => setMobileNav(false);
  return (
    <div className="mf-shell" data-collapsed={collapsed} data-mobile-nav={mobileNav ? "open" : "closed"}>
      <a className="mf-skip" href="#mf-main">
        Skip to content
      </a>
      <nav className="mf-sidebar" aria-label="Finance Desk">
        <Link to="/finance" className="mf-brand" onClick={close}>
          <span className="mf-brand-mark">FD</span>
          <span className="mf-brand-text">Finance Desk</span>
        </Link>
        <div className="mf-nav">
          {NAV.map((item) => (
            <NavLink key={item.to} item={item} collapsed={collapsed} active={item.match.includes(route.name)} onNavigate={close} />
          ))}
          <div className="mf-nav-label">Utility</div>
          {UTIL.map((item) => (
            <NavLink key={item.to} item={item} collapsed={collapsed} active={item.match.includes(route.name)} onNavigate={close} />
          ))}
        </div>
        <div className="mf-sidebar-foot">
          <button
            type="button"
            className="mf-btn ghost small mf-desktop-only"
            style={{ width: "100%", justifyContent: collapsed ? "center" : "flex-start" }}
            onClick={() => update({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
            aria-pressed={collapsed}
          >
            <Icon name={collapsed ? "expand" : "collapse"} size={16} />
            <span className="mf-sidebar-foot-text">Collapse</span>
          </button>
          <p className="mf-xsmall mf-muted mf-sidebar-foot-text" style={{ padding: "8px 8px 0" }}>
            Curated research archive, not a complete market database.
          </p>
        </div>
      </nav>
      {mobileNav ? <div className="mf-mobile-scrim" onClick={close} aria-hidden="true" /> : null}
      <div className="mf-main-col">
        <header className="mf-topbar">
          <button type="button" className="mf-btn ghost icon mf-mobile-only" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}>
            <Icon name="menu" />
          </button>
          <div className="mf-topbar-search">
            <button type="button" className="mf-input" style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "text", color: "var(--mf-muted)" }} onClick={onOpenPalette} aria-label="Search deals, companies, sectors and concepts" aria-keyshortcuts="Control+K Meta+K /">
              <Icon name="search" size={16} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Search deals, companies, sectors, concepts…</span>
              <span className="mf-kbd mf-desktop-only">{isMac ? "⌘K" : "Ctrl K"}</span>
            </button>
          </div>
          <div className="mf-topbar-actions">
            <SourceStatusControl />
            <button
              type="button"
              className="mf-btn ghost icon"
              onClick={() => update({ theme: prefs.theme === "dark" ? "light" : "dark" })}
              aria-label={prefs.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={prefs.theme === "dark" ? "Light theme" : "Dark theme"}
            >
              <Icon name={prefs.theme === "dark" ? "sun" : "moon"} />
            </button>
            {status ? (
              signedIn ? (
                <a className="mf-btn ghost small" href={signOutHref()} title={isOwner ? "Signed in as the site owner" : "Signed in (not the configured owner)"}>
                  <Icon name="user" size={16} />
                  <span className="mf-desktop-only">{isOwner ? "Owner" : "Signed in"}</span>
                  <span className="mf-sr-only">— sign out</span>
                </a>
              ) : (
                <a className="mf-btn small" href={signInHref()}>
                  Sign in
                </a>
              )
            ) : null}
          </div>
        </header>
        <main id="mf-main" className="mf-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
