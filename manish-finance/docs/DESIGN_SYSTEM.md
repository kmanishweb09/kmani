# Design system

A quiet, data-dense research tool: system fonts, a dark default with a full light theme, one accent, and
colour reserved for meaning (status, provenance, charts). No custom fonts or images.

## Isolation

- Styles ship as `finance.css`, loaded only by `finance.html`; the existing Atlas stylesheet and other pages
  are untouched. Component classes are prefixed `mf-`; the app renders inside `.finance-root`.
- Browser storage is limited to `manish.finance.v1.*` (theme, device preferences, Lab drafts, UI state).
- The theme is applied before first paint by a hashed inline script (allowed by the finance CSP) from
  `manish.finance.v1.theme`; signed-in owners' account preference takes over after load.

## Tokens (`src/styles/tokens.css`)

| Group | Dark | Light | Use |
|---|---|---|---|
| `--mf-page` / `--mf-surface` / `--mf-raised` | #080c12 / #101721 / #16202c | #f3f6fa / #ffffff / #eaf0f6 | Page, panels, raised controls |
| `--mf-border` / `--mf-border-strong` | #2b3948 / #3d4f63 | #cbd5e1 / #a9b7c8 | Dividers, inputs |
| `--mf-text` / `--mf-muted` | #edf3f8 / #a8b6c6 | #172334 / #536477 | Body and secondary text |
| `--mf-accent` (+ `-ink`, `-soft`) | #59d7f1 | #006d88 | Links, primary actions, focus ring (`--mf-focus`) |
| `--mf-positive` / `--mf-attention` / `--mf-negative` | #55cea2 / #f4ba63 / #ff7885 | #076a49 / #885200 / #b42336 | Completed/approved, pending/uncertain, failed/terminated |
| `--mf-chart-1…5`, `--mf-grid` | cyan, amber, violet, green, red | darker equivalents | Charts; every chart also has a data table |
| Spacing `--mf-s1…s6` | 4, 8, 12, 16, 24, 32 px | | Layout rhythm |
| Radius | 10 px (panels), 6 px (controls) | | |
| Layout | sidebar 216 px, rail 64 px, top bar 60 px, drawer 440 px | | |
| Motion | `--mf-fast` 140 ms, 0 ms with `prefers-reduced-motion` | | |

Text/background pairs meet WCAG 2.1 AA; axe checks (serious/critical) pass on the audited pages
(`release/reports/axe/`).

## Typography

System UI stack (`--mf-font`) for text; `--mf-mono` (tabular) for figures, dates in tables and IDs. Page title
~28 px, section headings 20–22 px, panel titles 16–18 px, body 14–15 px, dense tables 12.5–13.5 px. Numbers are
right-aligned in tables.

## Layout and responsive rules

- Desktop: fixed left navigation (collapsible to a rail), top bar with search (Ctrl/⌘ K command palette),
  archive/source status and theme toggle, content max-width with a two-column grid on detail pages
  (main + aside).
- ≤ 1200/1100/1000 px: asides stack under the main column; Lab result grids reflow.
- ≤ 900 px: navigation becomes a drawer behind the menu button; filters wrap; tables scroll horizontally
  inside `.mf-table-wrap` (never the page).
- ≤ 700/600 px: single column, full-width controls, tabs scroll horizontally.
- Print (`print.css`): A4, black on white, no navigation chrome, visible source URLs, sensible page breaks —
  used for notes, briefs and Lab models.

Verified at 390, 768, 1440 and 1920 px in both themes (`release/reports/screenshots/`).

## Components (`src/components/`)

| Component | Conventions |
|---|---|
| `PageHead` | Breadcrumbs, eyebrow, title (h1), subtitle, actions |
| `Tabs` / `TabPanel` | ARIA tabs with roving focus (arrows, Home/End); ids derived from the tablist label |
| `Segmented` | Radio group for 2–4 mutually exclusive options |
| `MultiSelect` | Filter popover of checkboxes; Escape/outside click close; focus returns to trigger |
| `Dialog`, `Drawer` | Focus trapped and restored, Escape closes, scrim click closes, labelled by the title |
| `useConfirm` | Dialog-based confirmation for destructive actions (never `window.confirm`) |
| `Ev` / evidence drawer | Small source icon next to a value; opens the claim, document, locator, status and method. "Unsourced" icon when none |
| `VerificationBadge`, `ProvTag` | Truthful labels: Source checked, Search-corroborated, Pending, Conflict, Human reviewed; Reported / Calculated / Assumed / Training example / Analysis |
| `StatusPill` | Deal status with as-of date nearby |
| `EmptyState`, `ErrorState`, `Skeleton`, `SaveState` | Every data view has loading, empty, error (with retry) and save states |
| `AiAssist` | Optional; preview-before-send dialog, fact/analysis/question labels, held-back section, cost labelled as estimate |
| Charts (`src/pages/lab/charts.tsx`) | SVG bar, waterfall and scatter with an accessible data table; real data only |

## Interaction conventions

- Facts, analysis and questions are visibly separated; training data is always badged.
- Missing values show "Not disclosed" / "—" with a reason, never 0.
- Undisclosed or unclear value bases are labelled (EV, equity, stake, basis unclear).
- Destructive actions confirm; deletes of notes require confirmation and archive is offered first.
- Private actions for signed-out users lead to sign-in rather than failing silently.
- Autosave shows Unsaved → Saving → Saved; conflicts show both versions to reconcile.
- Keyboard: skip link, visible focus ring, command palette, review ratings on keys 1–4.
