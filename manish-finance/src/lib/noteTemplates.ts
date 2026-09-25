import { NOTE_TEMPLATE_LABEL } from "../../shared/labels";

export type NoteTemplateId = "blank" | "deal_note" | "sector_thesis" | "company_note" | "weekly_reflection" | "research_question";

const section = (titles: string[]) => titles.map((t) => `## ${t}\n\n`).join("\n");

/** Structures from the product brief; the user fills the sections. No facts are pre-filled here. */
export const TEMPLATE_BODIES: Record<NoteTemplateId, string> = {
  blank: "",
  deal_note: section(["Transaction facts", "Strategic rationale", "Price and structure", "Sector context", "Synergies and risks", "My view", "Unanswered questions", "Sources", "Research cutoff"]),
  sector_thesis: section(["Business models", "Value drivers", "Key players", "Valuation logic", "Consolidation thesis", "Catalysts", "Disconfirming evidence", "Watchlist", "Sources and dates"]),
  company_note: section(["How it makes money", "Operating KPIs", "Financial quality", "Competitive position", "Valuation approach", "Recent corporate actions", "Risks", "Questions for management"]),
  weekly_reflection: section(["Three things I learned", "One assumption I revised", "One deal I can explain", "One topic to revisit", "Next research question"]),
  research_question: section(["Question", "Why it matters", "What evidence would answer it", "Sources to check", "Answer so far"]),
};

export const TEMPLATE_OPTIONS: Array<{ id: NoteTemplateId; label: string }> = (Object.keys(TEMPLATE_BODIES) as NoteTemplateId[]).map((id) => ({
  id,
  label: (NOTE_TEMPLATE_LABEL as Record<string, string>)[id] ?? id,
}));

export function isTemplate(x: string | null): x is NoteTemplateId {
  return x !== null && x in TEMPLATE_BODIES;
}

export function templateTitle(id: NoteTemplateId, date: string): string {
  switch (id) {
    case "weekly_reflection":
      return `Weekly reflection — ${date}`;
    case "deal_note":
      return "Deal note";
    case "sector_thesis":
      return "Sector thesis";
    case "company_note":
      return "Company note";
    case "research_question":
      return "Research question";
    default:
      return "Untitled note";
  }
}
