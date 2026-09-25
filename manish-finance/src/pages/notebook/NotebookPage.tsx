import { setQuery, useRoute } from "../../app/router";
import { useSession } from "../../app/session";
import { PageHead } from "../../components/PageHead";
import { SignInPrompt, TabPanel, Tabs } from "../../components/ui";
import { InterviewTab } from "./InterviewTab";
import { LearnTab } from "./LearnTab";
import { MemoryTab, ReviewTab } from "./MemoryTabs";
import { NoteEditor } from "./NoteEditor";
import { NotesTab } from "./NotesTab";

const TABS = [
  { id: "notes", label: "Notes" },
  { id: "memory", label: "Deal Memory" },
  { id: "review", label: "Review" },
  { id: "learn", label: "Learn" },
  { id: "interview", label: "Interview" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PRIVATE_COPY: Record<Exclude<TabId, "learn">, string> = {
  notes: "research notes",
  memory: "Deal Memory",
  review: "your review queue",
  interview: "interview practice",
};

export default function NotebookPage() {
  const route = useRoute();
  const session = useSession();
  if (route.name === "note") {
    const id = route.params.id ?? "";
    if (session.loading && !session.status) return <PageHead title="Notebook" />;
    if (!session.isOwner) {
      return (
        <div className="mf-page">
          <PageHead title="Private note" />
          <SignInPrompt what="this note" />
        </div>
      );
    }
    return <NoteEditor id={id} />;
  }
  const t = route.query.get("tab");
  const tab: TabId = TABS.some((x) => x.id === t) ? (t as TabId) : session.isOwner ? "notes" : "learn";
  return (
    <div className="mf-page">
      <PageHead title="Notebook" sub="Save analysis, build Deal Memory, review with spaced repetition, study the learning library and practise interviews." />
      <Tabs tabs={TABS.map((x) => ({ id: x.id, label: x.label }))} active={tab} onChange={(id) => setQuery({ tab: id, new: null, q: null, tag: null, template: null, archived: null, module: null, term: null, view: null })} label="Notebook sections" />
      <TabPanel>
        {tab === "learn" ? (
          <LearnTab />
        ) : session.loading && !session.status ? null : !session.isOwner ? (
          <SignInPrompt what={PRIVATE_COPY[tab]} />
        ) : tab === "notes" ? (
          <NotesTab />
        ) : tab === "memory" ? (
          <MemoryTab />
        ) : tab === "review" ? (
          <ReviewTab />
        ) : (
          <InterviewTab />
        )}
      </TabPanel>
    </div>
  );
}
