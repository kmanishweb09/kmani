import type { EventView } from "../../shared/api";
import { EVENT_TYPE_LABEL } from "../../shared/labels";
import { countryName } from "../../shared/geo";
import { dateLabel } from "../lib/format";
import { Ev } from "./Evidence";

/** Restrained event spine: horizontal on wide screens, vertical on narrow ones. Each event has its own source. */
export function EventSpine({ events, hiddenAfter }: { events: EventView[]; hiddenAfter?: string | null }) {
  const visible = hiddenAfter ? events.filter((e) => e.date.date <= hiddenAfter) : events;
  const hiddenCount = events.length - visible.length;
  return (
    <div>
      <ol className="mf-spine" aria-label="Deal timeline" style={{ listStyle: "none", margin: 0 }}>
        {visible.map((e) => (
          <li key={e.id} className="mf-spine-event" data-kind={e.type}>
            <span className="mf-spine-dot" aria-hidden="true" />
            <div className="mf-spine-date">
              {dateLabel(e.date)}
              {e.publishedDate && e.publishedDate !== e.date.date ? <span title="Publication date"> · pub. {dateLabel(e.publishedDate)}</span> : null}
            </div>
            <div className="mf-spine-title">
              {e.title}
              <Ev ids={e.ev} label={e.title} />
            </div>
            <div className="mf-spine-detail">
              {EVENT_TYPE_LABEL[e.type] ?? e.type}
              {e.authority ? ` · ${e.authority}` : ""}
              {e.jurisdiction ? ` · ${countryName(e.jurisdiction)}` : ""}
              {e.origin === "published_update" ? " · published update" : ""}
            </div>
            {e.detail ? <div className="mf-spine-detail">{e.detail}</div> : null}
          </li>
        ))}
      </ol>
      {hiddenCount > 0 ? (
        <p className="mf-hint" style={{ marginTop: 8 }}>
          {hiddenCount} later event{hiddenCount > 1 ? "s are" : " is"} hidden in “As announced” mode.
        </p>
      ) : null}
    </div>
  );
}
