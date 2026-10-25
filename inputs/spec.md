# KX NYSE TAQ Benchmark dashboard — specification

This document describes **what the site does**. It is the source of truth for the
build. Data comes from `inputs/data/<size>.json` (format: `inputs/schema.md`); look
and feel from `inputs/tokens.md`. Where this document says "should", treat it as a
requirement; where it says "may", it is optional.

## 1. Purpose and audience

The site publishes KX's benchmark results for in-memory query engines (KDB-X, DuckDB,
Polars, Pandas, chDB, PyKX, ...) running 84 queries over one day of NYSE TAQ trade and
quote data. Visitors are engineers and technical decision makers. They want to answer:

- How fast is each solution relative to a baseline, over a set of queries I care about?
- Where does a solution fail, and how often?
- Which solution is fastest on how many queries?
- What does it cost in memory, and how long does loading the data take?
- How does one query perform across solutions, and what code did each solution run?

The site is static: all computation happens in the browser from the JSON files.

## 2. Pages

| Page | Path | Compares | Release |
|---|---|---|---|
| Solution comparison (main) | `/` | solutions, on one machine | **first release** (sections 3–11) |
| Hardware comparison | `/hardware/` | machines, running one solution | later (section 12) |
| Thread scaling | `/threads/` | thread counts of one solution on one machine | later (section 12) |

**Only the main page is in scope for the first release.** The other two pages will
share its layout, filters, charts and tables and differ only in what the compared
**series** are (machines or thread counts instead of solutions). Build the comparison
parameterised by the series from the start, so the later pages are configuration
rather than copies — but do not build them now.

The previous site published the two secondary pages at `/pages/hardware/index.html`
and `/pages/threadscaling/index.html`, and blog posts link to them. Until the new
pages exist, those paths should redirect to `/`.

## 3. Page layout (main page)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ KX logo  NYSE TAQ Benchmark — In-Memory Query Engines          [◐ theme] │  header
│ [Methodology ↗] [Reproduce results ↗] [Add a solution ↗]                  │  resource links
├───────────────────────────────────────────────────────────────────────────┤
│ Intro paragraph (one or two sentences)                                    │
├───────────────────────────────────────────────────────────────────────────┤
│ [Solutions ▾] [Setup ▾] [Queries ▾]   chips: 6 solutions · full · 4 thr … │  sticky filter bar
│                                         [Reset] [Copy link]               │
├───────────────────────────────────────────────────────────────────────────┤
│ Status: Comparing 6 solutions on 57 of 84 queries · AMD_EPYC_9575F · …   │
│ ( Query statistics )  ( Load time statistics )                            │  tabs
├───────────────────────────────────────────────────────────────────────────┤
│ tab content (section 7 or 8)                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ Methodology notes (footnotes)                                             │
│ Footer                                                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

## 4. Header and resource links

- KX logo (links to https://kx.com, new tab) and the title
  "NYSE TAQ Benchmark — In-Memory Query Engines".
- Theme toggle (light / dark), see section 11.
- Resource links, displayed as a row of **modern link buttons or cards** (not plain
  underlined text): each has an icon, a short label and, on wider screens, a one-line
  description. External links show an "opens in new tab" icon. On phones the row
  wraps or scrolls horizontally.

| Label | Description | Target |
|---|---|---|
| Methodology and motivation | Why and how we benchmark | https://kx.com/blog/the-kx-nyse-taq-benchmark/ (external) |
| Reproduce and validate results | Run the benchmark yourself | https://github.com/KxSystems/NYSETAQBenchmarks (external) |
| Add a solution | Benchmark your own engine | https://github.com/KxSystems/NYSETAQBenchmarks#adding-a-new-python-based-in-memory-query-engine (external) |

When the hardware and thread-scaling pages are added (section 12), they get two more
links here ("Hardware comparison — One solution across machines", "Thread scaling —
One solution across thread counts"); the link row should accommodate that without a
redesign.

Intro text (main page): "Query and data load performance of in-memory query engines
on NYSE TAQ data. Use the filters to choose what to compare; the charts and tables
update as you go."

## 5. Concepts and calculations

These definitions are used throughout. Use them exactly.

**Run (of the data).** An entry of `runs[]` in the data file: one solution on one
machine, data date and NUMA node, with measurements per thread count.

**Setup.** The current choice of data size, machine, data date, NUMA nodes, thread
count and timing (section 6.3). A run *matches the setup* when its machine and data
date are the selected ones, its NUMA node is selected, and it has measurements for
the selected thread count.

**Compared solutions.** The solutions that are selected in the Solutions filter,
pass the open-source and sort-column filters, and have a run matching the setup.
If more than one run of a solution matches (several NUMA nodes selected), use the
run with node `"all"` if present, otherwise the lowest node number, and say so in
the status line.

**Failed runs.** A selected solution whose matching run has `exit_code ≠ 0` (it
failed before running any query, typically killed for running out of memory; it
has no thread counts) is *not* a compared solution, but is listed in the geometric
mean chart (section 7.1) as failed. A failed run matches the setup when its machine,
data date and NUMA node match, regardless of thread count.

**Compared queries.** Queries that pass the query filters (section 6.4) and are
ticked in the query breakdown (section 7.4; all are ticked by default).

**Timing.** Each successful query has three times `[cold, warm1, warm2]` in
nanoseconds. The selected timing (Cold run / Hot run / Second hot run) picks one.
Times are shown in seconds.

**Failure (of a query).** A compared solution *fails* a compared query when its
thread-count measurements have no `query_ns` entry for the query. The reason, if any,
is in `query_status`: `error`, `skip` (not run), `emptyquery` (not implemented); a
query in neither is "not run".

**Baseline.** One solution chosen by the visitor (default `KDB-X`), see section 7.1.
If the chosen baseline has no run matching the setup (or its run failed), the
first compared solution in alphabetical order is used instead and a notice says so
("KDB-X has no results for this setup; using DuckDB (Index) as the baseline"). The
choice itself is kept, so changing the setup back restores it.

**Ratio.** For a solution S, query q and baseline B: `ratio = time(S, q) / time(B, q)`.
Undefined when either time is missing or the baseline time is 0. Lower is better;
1 means equal to the baseline.

**Geometric mean of ratios (score).** For each compared solution S, over the compared
queries q for which the baseline has a time:

- if S has a time: use `time(S, q) / time(B, q)`;
- if S fails q: use the **penalty ratio** `2 × worst(q) / time(B, q)`, where
  `worst(q)` is the largest time posted for q by any compared solution or the baseline.

The score is the geometric mean (`exp(mean(log(ratio)))`) of these values. Queries the
baseline fails are left out for everyone. A solution with no usable query has no score
("—"). The baseline's own score is ≤ 1 and is 1 when it has no failures.

**Wins.** For each compared query, the compared solutions with the smallest time win
it; on an exact tie every tied solution gets the win. Queries no compared solution has
a time for are left out.

**Display formats.**

- Time: seconds with three decimals (`0.276s`); below 1 ms use milliseconds
  (`0.42ms`).
- Ratio: two significant decimals with a multiplication sign, phrased for reading:
  `×1.00`, `2.15× slower`, `3.40× faster` (a ratio of 0.294 reads `3.40× faster`).
  In compact table cells, `×2.15` and `×0.29` are fine, with the phrased form in the
  cell's accessible label and tooltip.
- Memory and data size: GB with one decimal (`peak_memory_kb / 1024²`,
  `data_size_mb / 1024`).

## 6. Filters

### 6.1 Behaviour

- Filters are organised in **three groups**: Solutions, Setup, Queries. Each group
  has a button in a **sticky filter bar** that stays at the top of the viewport while
  the page scrolls.
- **All filter panels are hidden initially.** Clicking a group button opens that
  group's panel as a floating, non-modal panel just below the bar; clicking it again
  (or the panel's close button, or Esc) closes it.
- Groups are **independent**: each opens and closes on its own, and several may be
  open at once (side by side on wide screens). Open panels float with the sticky bar,
  so the charts behind them stay visible and update live as filters change. Panels are
  not draggable.
- On phones (< 640px) only one panel is open at a time and it appears as a bottom
  sheet.
- Next to the buttons, the bar shows **chips summarising the active filters**
  (e.g. `6 solutions`, `full`, `AMD_EPYC_9575F`, `4 threads`, `Cold run`,
  `57/84 queries`). Clicking a chip opens the group it belongs to.
- The bar also has **Reset filters** (restores every default in section 13) and
  **Copy link** (copies the URL that reproduces the current view, section 10; shows a
  brief "Link copied" confirmation).
- Every change takes effect immediately; there is no Apply button.
- Values that would give no results under the current setup stay visible but
  **dimmed** with a tooltip explaining why (e.g. "No results for 64 threads on this
  machine"). They remain clickable: selecting one is allowed, and the status line
  explains what is missing.
- Single-choice filters behave like segmented controls; multi-choice filters behave
  like toggle chips. Multi-choice groups have "All" and "None" shortcuts.
- A short help text (tooltip or info icon) on each filter explains it; the texts
  below are a starting point.

### 6.2 Solutions group

| Filter | Kind | Values | Default | Help text |
|---|---|---|---|---|
| Solution | multi | every solution in the data file, alphabetical (numbers sorted numerically) | `DuckDB (Index)`, `KDB-X`, `KDB-X (Manual Opt)`, `Pandas`, `Polars (Lazy)`, `chDB (Memory)` (those present) | Solutions to compare. |
| Open source | multi | Yes, No | both | Restrict to open-source or proprietary engines. |
| Sort columns | multi | one chip per distinct `sort_columns` value, labelled `Time`, `Sym, Time` | all | Columns the trade and quote tables were sorted by when loaded. |

- Hovering a solution chip shows its engine, engine version(s) and language.
- Each solution has a stable colour (section 11) shown as a dot on its chip; the same
  colour is used for it in every chart.

### 6.3 Setup group

| Filter | Kind | Values | Default | Help text |
|---|---|---|---|---|
| Data size | single | sizes with a data file (`full`, `xlarge`, `large`) | `full` | Amount of TAQ data loaded. |
| Machine | single | machines with runs in the current size, most measured first | the one with the most successful runs | Hardware the benchmark ran on. |
| Data date | single | `datadate` values for the machine | latest | Trading day of the TAQ data. |
| NUMA node | multi | distinct `numa_node` values, numbers first, then `all` | all | NUMA node the process was pinned to; "all" means not pinned. |
| Threads | single | thread counts measured for the machine and date | `4` | Number of threads the engine was allowed to use. |
| Timing | single | Cold run, Hot run, Second hot run | Cold run | Which of the three consecutive executions to compare. The cold run follows a cache flush. |

- Hovering a machine shows its full specification from `machines[m].environment`, as
  a formatted list grouped by `os`, `cpu` and `memory` (nested objects indented), plus
  `cpu_model` and the date the specification was taken. Show every key present.
- Changing the data size loads `data/<size>.json` without a page reload; the other
  filters are kept where still valid and fall back to defaults otherwise.
- Data date, threads and machine depend on each other: when a selection becomes
  unavailable after another change, fall back to the default rule for that filter.

### 6.4 Queries group

| Filter | Kind | Values | Default | Help text |
|---|---|---|---|---|
| Instrument | multi, two levels | `single` (refinements `frequent`, `infrequent`), `multi` (refinements `50`, `1000 infreq`), `all (no filter)` | all | How many instruments the query works on: one, a list, or the full universe. |
| Complexity | multi | simple, advanced, complex | all | How involved the query logic is. |
| Include tags | multi | every tag in `tags` | none | Only queries carrying at least one selected tag. None selected = no restriction. |
| Exclude tags | multi | every tag in `tags` | `manydummyfilters`, `unnecessarycolumnfetch` | Queries carrying any selected tag are left out. |

- A query's instrument is `<scope>` or `<scope>:<refinement>`. It passes when its scope
  is selected and, if it has a refinement, that refinement is selected. Refinement chips
  are disabled while their scope is deselected.
- Hovering a tag chip shows the tag's description from `tags`.
- The group shows a live count: "57 of 84 queries match".

## 7. Tab: Query statistics (default)

Two tabs sit below the status line: **Query statistics** (default) and **Load time
statistics**. The selected tab is part of the URL state. Tabs are keyboard accessible
(arrow keys move between them).

The Query statistics tab shows three charts (7.1–7.3) and the query breakdown (7.4).
All three charts respect every filter, including the query filters.

Layout: 7.1 full width; below it 7.2 and 7.3 side by side; everything stacks on
phones.

Every chart: a title, a one-line subtitle saying what is measured, a hover/focus
tooltip per mark with the exact value, and an accessible text alternative (a visually
hidden table or a description listing the values).

### 7.1 Geometric mean of ratios — horizontal bars

- Title: "Geometric mean of per-query time ratios, relative to [baseline ▾]". The
  baseline is chosen **here**, with a dropdown in the title listing every solution
  (solutions without results for the setup are dimmed). Subtitle: "Lower is better.
  Failed queries count with a penalty [1]." ([1] links to the methodology note.)
- One horizontal bar per compared solution, sorted by score, best (lowest) first.
  Bar length proportional to the score on a **single scale** (no second, zoomed
  band); a vertical reference line marks 1 (the baseline). Bars are in the
  solution's colour; the baseline's bar is marked (e.g. a "baseline" badge).
- A **Linear / Log** scale toggle next to the chart title; default **Linear**
  (starting at 0). Log scale lets scores far apart stay readable; in log mode bars
  start at the smallest score shown (rounded down to a power of 10), tick labels show
  ratios (`×0.1`, `×1`, `×10`, ...), and the reference line at 1 stays. The scale
  choice is part of the URL state.
- At the end of each bar: the score in the phrased ratio format (section 5).
- Tooltip: score, number of compared queries used, number of them counted with the
  penalty.
- Failed runs (section 5) follow the scored rows: a full-length neutral grey bar with
  the label `Failed — exit 137` (the run's exit code; 137 is explained in the tooltip
  as "killed by the operating system, usually out of memory"), and the solution name
  dimmed.
- Each row has a small "remove" control that deselects the solution (same as
  toggling it in the Solutions filter).
- Clicking a bar (or pressing Enter on it) opens the query breakdown (7.4) with that
  solution's column highlighted.

### 7.2 Query failures — vertical bars

- Title "Query failures", subtitle "Compared queries without a result for the selected
  timing".
- One vertical bar per compared solution (same order as 7.1), height = number of
  compared queries the solution fails.
- Bars are stacked by reason: error, not run (`skip` or absent), not implemented
  (`emptyquery`), using neutral shades plus a legend. Tooltip shows the count per reason.
- Solutions with zero failures show an empty bar with "0".
- Clicking a bar opens the query breakdown with that solution's column highlighted and
  the rows filtered to the queries it fails (a removable "Showing failures of X" chip
  appears above the table).

### 7.3 Wins per solution — pie chart

- Title "Wins per solution", subtitle "Number of compared queries on which the solution
  posts the fastest time".
- One slice per compared solution with at least one win, in the solution's colour,
  largest first, with a legend listing solution and count. Tooltip: count and share
  of compared queries.
- Clicking a slice opens the query breakdown with that solution's column highlighted
  and the rows filtered to the queries it wins.

### 7.4 Query breakdown — table

- Heading "Query breakdown". **Hidden initially.** It opens when the visitor clicks a
  "Show query breakdown" button below the charts, or a mark in 7.1–7.3 as described
  above. When it opens, the page scrolls to it. A "Hide query breakdown" button closes
  it. Whether it is open, the highlighted column and the row filter are part of the
  URL state.
- **Columns** are the compared solutions, in the order of 7.1, headed by the solution
  name in its colour; the baseline column is marked. **Rows** are the queries that
  pass the query filters, in `idx` order.
- First column (sticky while scrolling horizontally): a checkbox and the query label
  `Q<idx>` followed by its description, truncated with ellipsis if long.
  - The checkbox includes the query in the compared queries; unticking it removes the
    query from every aggregate (7.1–7.3) immediately. A checkbox in the header ticks or
    unticks all rows. Unticked rows stay in the table, dimmed.
  - Hovering the query label shows the full description, tags, instrument and
    complexity, and the comment if any.
- The header row is sticky while scrolling vertically.
- **Cells** show the time for the selected timing and, except in the baseline column,
  the ratio to the baseline: `0.276s ×1.32`. A failed query shows a clear failure mark
  with its reason (`error`, `not run`, `not implemented`).
- Cell background encodes the ratio in five bands, consistent in both themes, with a
  legend above the table:

  | Band | Ratio |
  |---|---|
  | much faster | < 0.5 |
  | faster | 0.5 – < 0.9 |
  | similar | 0.9 – 1.1 |
  | slower | > 1.1 – 2 |
  | much slower | > 2 |

  Failures get their own neutral style. Do not rely on colour alone: the ratio text
  is always present, and the accessible label of the cell says e.g. "0.276 seconds,
  1.32 times slower than KDB-X".
- **Hovering (or focusing) a cell shows the query text that solution ran**:
  `solutions[S].query_text[idx]`, in a monospace block, preserving line breaks and
  indentation, wrapping lines longer than the available width, with the language
  (q / SQL / Python) as a small label. The tooltip stays inside the viewport (flip
  sides as needed); on touch devices a tap opens it and a tap elsewhere closes it. It
  includes a "Copy" button.
- Hovering a column header or a solution anywhere else on the page (filter chip,
  chart mark, legend) highlights that solution's column.
- The table scrolls horizontally on narrow screens; it never makes the page itself
  scroll horizontally.

## 8. Tab: Load time statistics

This tab describes the loaded data and the cost of loading it. It shows, in this
order: two memory charts (8.1, 8.2) side by side, then the load time chart (8.3) full
width, then the load time table (8.4). Everything stacks on phones.

These charts describe whole runs, so the query filters do not apply; a note under the
tab heading says so. Loading is measured once per thread count (no cold/hot
distinction), so the Timing filter does not apply either; its chip shows "n/a on this
tab". The solution, setup and baseline filters apply as on the other tab.

### 8.1 Max resident memory — vertical bars

- Title "Max resident memory (GB)", subtitle "Peak memory of the benchmark process".
- One vertical bar per compared solution from `peak_memory_kb`, sorted ascending.
  Solutions without the value are listed with "n/a".

### 8.2 Data size — vertical bars

- Title "Data size in memory (GB)", subtitle "Size of the loaded tables, as reported
  by the engine".
- One vertical bar per compared solution from `data_size_mb`, sorted ascending.
  Solutions without the value are listed with "n/a".

### 8.3 Load time chart — stacked horizontal bars

- Title "Total load time, relative to [baseline ▾]" (same baseline as 7.1).
- One horizontal bar per compared solution, sorted by total load time ascending, the
  bar divided into the load phases present (`load`, `transform`, `sort`, `index`;
  labels "Load into memory", "Transform", "Sort", "Index") in a sequential colour
  scheme with a legend. Label at the end: total in seconds and the ratio to the
  baseline's total.

### 8.4 Load time table

- Columns: compared solutions in the order of 8.3. Rows: **Total** first (bold), then
  one row per phase present in any compared solution.
- Cells: time and ratio to the baseline, coloured with the bands of 7.4. A phase a
  solution does not have counts as 0 in the total and shows "—" in its row.

## 9. Status line and empty states

- Above the tabs, a live status line (announced to screen readers) summarises the
  view: "Comparing 6 solutions on 57 of 84 queries · AMD_EPYC_9575F · full ·
  2026-04-01 · 4 threads · cold run · baseline KDB-X". It also carries the notices of
  section 5 (baseline substitution, several NUMA runs).
- **No compared solution:** the tab content is replaced with a message "No results
  match the selected filters" and buttons to open the Solutions filter or reset
  filters.
- **No compared query:** the charts show "No queries match the query filters" with a
  button opening the Queries filter.
- **Data file fails to load or has an unknown `schema_version`:** an error message
  with the size name and a retry button; nothing else renders.
- While a data file loads, show a skeleton of the charts, not a blank page.

## 10. URL state and sharing

- The full view state is encoded in the URL so any view can be shared and restored:
  every filter value, the baseline, the geometric mean chart's scale, the selected
  tab, breakdown open/closed,
  highlighted column, breakdown row filter and unticked queries.
- Use readable query parameters (e.g. `?size=full&solutions=KDB-X,Pandas&threads=4`);
  omit parameters equal to their default so the default view has a clean URL.
- Each change replaces the current history entry; changing the data size, tab or
  machine pushes a new one, so Back steps through meaningful views.
- Unknown or invalid values in the URL are ignored (fall back to defaults), never an
  error.

## 11. Look and feel, accessibility, responsiveness

- Colours, typography and spacing from `inputs/tokens.md` (KX design tokens) for both
  themes. Font: Inter.
- **Theme:** follows the operating system by default; the toggle overrides it and the
  choice is remembered on the device. Both themes must meet WCAG AA contrast for
  text and chart marks.
- **Solution colours:** a fixed categorical palette assigned to solutions in
  alphabetical order of all solutions in the data file, so a solution keeps its colour
  whatever is selected. KDB-X variants may share a hue family.
- **Accessibility:** WCAG 2.2 AA. Skip link to the results; all controls keyboard
  operable with visible focus; panels and tooltips reachable by keyboard and closable
  with Esc; charts have text alternatives; respect `prefers-reduced-motion`.
- **Responsive:** works from 360px wide; 16px side gutter on phones; no horizontal
  page scroll (wide tables scroll inside their own container).
- Performance: first render of the default view within 1 second on a mid-range laptop
  once the data file is loaded.

## 12. Hardware comparison and thread scaling pages (later release)

**Not part of the first release.** Recorded here so the main page is built in a
way that makes these pages configuration rather than new code.

Same layout, filters, tabs, charts and breakdown as the main page, with the compared
series replaced:

**Hardware comparison** (`/hardware/`)

- Title "NYSE TAQ Benchmark — Hardware Comparison"; intro: "Query and data load
  performance of one solution on different machines."
- Series: machines. A **Solution** single choice (default `KDB-X`) replaces the
  Solution multi-choice; the open-source and sort-column filters are dropped. The
  Machine filter becomes a multi choice (default: all) and the baseline is a machine
  (default `AMD_EPYC_9575F`).
- Default data size: the largest size with runs on more than one machine (currently
  `large`).
- Charts 8.1 and 8.2 and the hover specification apply per machine.

**Thread scaling** (`/threads/`)

- Title "NYSE TAQ Benchmark — Thread Scaling"; intro: "How one solution's query and
  data load performance scales with the number of threads."
- Series: the thread counts of one run. **Solution** and **Machine** are single
  choices (defaults `KDB-X` and the machine with the most results); the Threads filter
  becomes a multi choice (default: all measured); the baseline is a thread count
  (default: the smallest).
- Default data size: `large`.

## 13. Defaults (main page)

| Setting | Default |
|---|---|
| Data size | `full` |
| Solutions | `DuckDB (Index)`, `KDB-X`, `KDB-X (Manual Opt)`, `Pandas`, `Polars (Lazy)`, `chDB (Memory)` |
| Open source / Sort columns | all |
| Machine | most successful runs |
| Data date | latest |
| NUMA node | all values |
| Threads | 4 (else the smallest available) |
| Timing | Cold run |
| Baseline | `KDB-X` |
| Instrument / Complexity | all |
| Include tags | none |
| Exclude tags | `manydummyfilters`, `unnecessarycolumnfetch` |
| Geometric mean chart scale | Linear |
| Tab | Query statistics |
| Filter panels | closed |
| Query breakdown | hidden |

## 14. Methodology notes and footer

Below the tab content, short numbered notes referenced from the charts:

1. "A failed query counts in the geometric mean with a penalty ratio: twice the worst
   time posted for that query by any compared solution, divided by the baseline's
   time. Queries the baseline fails are left out. A solution whose run failed before
   producing any result is listed with its exit code instead of a score."
2. "Times are wall-clock times of each query; the cold run follows a cache flush, the
   hot runs repeat the query immediately."
3. "Benchmark methodology: see Methodology and motivation." (link)

Footer:

- "KX® and kdb+ are registered trademarks of KX Systems, Inc., a subsidiary of KX
  Software Limited."
- Links: Privacy Policy (https://kx.com/privacy-policy/), Cookie Settings (a button
  that opens the cookie preference centre of the consent manager when it is present on
  the page — `window.OneTrust.ToggleInfoDisplay()` — and otherwise does nothing
  visible).
- The site loads the KX Google Tag Manager container `GTM-PG938LS`.

## 15. Design decisions (requested changes)

These were requested explicitly and take precedence over any convention:

1. Five aggregate charts: geometric mean of ratios (horizontal bars), query failures
   (vertical bars) and wins per solution (pie) on the Query statistics tab; max
   resident memory and data size in GB (vertical bars) on the Load time statistics
   tab, before the load times.
2. The geometric mean chart uses a single scale (no second, zoomed scale band),
   linear by default with an optional log-scale toggle.
3. Resource links in the header are modern link buttons/cards, not plain text links.
4. Filters live in floating panels, hidden initially, one panel per filter group,
   each opened and closed independently.
5. The per-query table is called "Query breakdown" and is hidden initially; clicking
   a button or a chart mark reveals it.
6. Two tabs: "Query statistics" (default) and "Load time statistics".
7. First release: the solution comparison page only; hardware comparison and
   thread scaling come later.
