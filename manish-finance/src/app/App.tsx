import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CommandPalette } from "../components/CommandPalette";
import { EvidenceProvider } from "../components/Evidence";
import { Layout } from "../components/Layout";
import { Skeleton } from "../components/ui";
import { BriefDetailPage, BriefsPage } from "../pages/BriefsPage";
import { CompaniesPage } from "../pages/CompaniesPage";
import { CompanyDetailPage } from "../pages/CompanyDetailPage";
import { ComparePage } from "../pages/ComparePage";
import { DealDetailPage } from "../pages/DealDetailPage";
import { DealsPage } from "../pages/DealsPage";
import { DeskPage } from "../pages/DeskPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SectorDetailPage } from "../pages/SectorDetailPage";
import { SectorsPage } from "../pages/SectorsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SourcesPage } from "../pages/SourcesPage";
import { PrefsProvider } from "./prefs";
import { useRoute } from "./router";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

const LabPage = lazy(() => import("../pages/lab/LabPage"));
const NotebookPage = lazy(() => import("../pages/notebook/NotebookPage"));
const ResearchMaintenancePage = lazy(() => import("../pages/ResearchMaintenancePage"));

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function Routes() {
  const route = useRoute();
  switch (route.name) {
    case "desk":
      return <DeskPage />;
    case "deals":
      return <DealsPage />;
    case "compare":
      return <ComparePage />;
    case "deal":
      return <DealDetailPage id={route.params.id as string} />;
    case "sectors":
      return <SectorsPage />;
    case "sector":
      return <SectorDetailPage slug={route.params.slug as string} />;
    case "companies":
      return <CompaniesPage />;
    case "company":
      return <CompanyDetailPage id={route.params.id as string} />;
    case "lab":
      return <LabPage />;
    case "briefs":
      return <BriefsPage />;
    case "brief":
      return <BriefDetailPage id={route.params.id as string} />;
    case "notebook":
    case "note":
      return <NotebookPage />;
    case "sources":
      return <SourcesPage />;
    case "settings":
      return <SettingsPage />;
    case "research":
      return <ResearchMaintenancePage />;
    default:
      return <NotFoundPage />;
  }
}

function Shell() {
  const [palette, setPalette] = useState(false);
  const route = useRoute();
  const first = useRef(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Move focus to the new page heading after client-side navigation (not on first load).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const t = window.setTimeout(() => {
      const h = document.getElementById("mf-page-title");
      if (h) h.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [route.name, route.path]);

  return (
    <Layout onOpenPalette={() => setPalette(true)}>
      <Suspense fallback={<Skeleton lines={8} height={18} />}>
        <Routes />
      </Suspense>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </Layout>
  );
}

export function App() {
  return (
    <SessionProvider>
      <PrefsProvider>
        <ToastProvider>
          <EvidenceProvider>
            <Shell />
          </EvidenceProvider>
        </ToastProvider>
      </PrefsProvider>
    </SessionProvider>
  );
}
