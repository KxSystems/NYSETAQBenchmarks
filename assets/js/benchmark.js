/// Shared dashboard engine of the benchmark pages.
///
/// Two pages use it, differing only in what they put side by side (the "series" of the
/// comparison):
///   * index.html          — solutions, on one machine
///   * hardware/index.html — machines, running one solution
///
/// Each page loads its own results (data.generated.js), defines the `page` object
/// described below and calls initBenchmark() as its last step. Everything else -
/// summary, charts, details table, load times, URL state, accessibility - lives here.
///
/// Page contract (`page`, a global defined by the page before initBenchmark() runs):
///   base              path prefix from the page to the repository root ('' or '../')
///   series_name       singular noun of one series entry ('solution' / 'machine');
///                     the plural used in texts is this plus an 's'
///   series_key        key of the multi-selection map inside `selectors`
///   series_container  element holding the series selectors
///   unique_series     all series labels, in the order that assigns their chart colours
///   default_baseline  series label used as baseline when the URL carries no state
///   seriesLabel(elem)         series label of a data entry
///   isDefaultSeries(label)    whether the label starts out selected
///   seriesTooltip(label)      optional title text of the series selector
///   decorateSeries(sel, lbl)  optional extra DOM inside a series selector
///   seriesNameNode(label)     the series name as shown in the summary table
///   initialSelectors()        fresh selector state
///   applyStateDefaults()      fill in page-specific keys missing from a decoded URL state
///   buildSelectors()          build and wire the page-specific selectors
///   updateSelectors()         reflect the state on the page-specific selectors
///   reconcile(base)           fix up page-specific single selections
///   rebuildSelectors(base)    rebuild the page-specific dynamic selectors
///   matches(elem)             page-specific data filter (the top selector rows)
///   machineScope(elem)        whether the entry belongs to the displayed machine(s)
///   baselineScope(elem)       whether the entry may serve as the baseline
///   baselineChoices(base)     labels offered as baseline

const constant_time_add = 0.01;
const missing_result_penalty = 2;
const ns_to_s = 1e-9;

const load_phase_order = ['load a partition into memory', 'transform', 'sort', 'index'];

/// Query descriptions and tags, loaded at startup from artifacts/queries/inmemory/querymeta.psv,
/// so newly added queries show up without regenerating anything.
let queries = [];
let query_tags = [];
let query_instrument = [];
let query_complexity = [];

/// Values of the mandatory `instrument` column of querymeta.psv, with their selector labels.
/// They get their own "Instrument filter" selector instead of the generic tag filters.
const instrument_values = {
    'single': 'single',
    'multi': 'multi',
    'all': 'all (no filter)',
};

/// Sub-scopes of `single` and `multi`: queries are tagged single:<frequency>
/// or multi:<size> in querymeta.psv. Each map refines its base selection.
const instrument_freq_values = {
    'infrequent': 'infrequent',
    'frequent': 'frequent',
};
const instrument_multi_values = {
    '50': '50',
    '1000infreq': '1000 infreq',
};

/// Values of the mandatory `complexity` column of querymeta.psv, with their selector labels.
/// They get their own "Complexity filter" selector instead of the generic tag filters.
const complexity_values = {
    'simple': 'simple',
    'advanced': 'advanced',
    'complex': 'complex',
};

/// Tags excluded by default; queries carrying them are hidden until deselected.
const default_excluded_tags = ['manydummyfilters', 'unnecessarycolumnfetch'];

const default_threads = '4';
const default_metric = 'cold';

/// The whole selector state. Decoding the URL hash replaces the object, so it is always
/// addressed through this variable rather than through a captured reference.
let selectors = {};

let theme = 'light';

/// Selector containers shared by the pages; the page-specific ones are looked up by the page.
let sizes, dates, threads, baselines, instruments, complexities, tag_includes, tag_excludes;

function seriesPlural() {
    return page.series_name + 's';
}

function setTheme(new_theme) {
    theme = new_theme;
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('theme', theme);
    render();
    requestAnimationFrame(applyAccessibilityEnhancements);
}

/// The selector map is addressed by key at click time: decoding the URL hash replaces
/// the whole `selectors` object, so a map reference captured at build time goes stale.
function toggle(e, elem, selectors_key) {
    const selectors_map = selectors[selectors_key];
    selectors_map[elem] = !selectors_map[elem];
    e.target.className = selectors_map[elem] ? 'selector selector-active' : 'selector';
    if (selectors_key === 'instrument') refreshInstrumentFreqEnabled();
    render();
    updateHistory();
}

/// Grey out sub-selectors whose base scope (single / multi) is not selected:
/// they only refine that scope's queries, so they are inert otherwise.
function refreshInstrumentFreqEnabled() {
    [...instruments.querySelectorAll('a')].forEach(elem => {
        const parent = elem.dataset.instrumentParent;
        if (parent) elem.classList.toggle('selector-disabled', selectors.instrument[parent] === false);
    });
}

function toggleAll(e, selectors_key) {
    const selectors_map = selectors[selectors_key];
    const new_value = Object.keys(selectors_map).filter(k => selectors_map[k]).length * 2 < Object.keys(selectors_map).length;
    [...e.target.parentElement.querySelectorAll('a')].map(
        elem => { elem.className = new_value ? 'selector selector-active' : 'selector' });

    Object.keys(selectors_map).map(k => { selectors_map[k] = new_value });
    render();
    updateHistory();
}

/// A single-selection row of selectors, rebuilt on every render because its values
/// depend on the rest of the selection.
function buildRadio(container, values, current, onSelect) {
    clearElement(container);
    values.forEach(value => {
        let selector = document.createElement('a');
        selector.className = value == current ? 'selector selector-active' : 'selector';
        selector.dataset.value = value;
        selector.appendChild(document.createTextNode(value));
        container.appendChild(selector);
        selector.addEventListener('click', e => {
            if (value == current) { return; }
            onSelect(value);
            render();
            updateHistory();
        });
    });
}

/// The size selector stands apart from the others: each size's results are a
/// separate data.generated.js picked in <head>, so instead of re-rendering it
/// reloads the page with the new ?size= parameter. The URL hash (and with it
/// the rest of the selector state) survives the navigation.
function buildSizeSelectors() {
    available_sizes.forEach(value => {
        let selector = document.createElement('a');
        selector.className = value == selected_size ? 'selector selector-active' : 'selector';
        selector.appendChild(document.createTextNode(value));
        sizes.appendChild(selector);
        selector.addEventListener('click', e => {
            if (value == selected_size) { return; }
            window.location.search = '?size=' + value;
        });
    });
}

/// The multi-selection group the whole comparison is built around: one selector per
/// series (solution or machine), each toggling its series in and out of the charts.
function buildSeriesSelectors() {
    page.unique_series.forEach(label => {
        let selector = document.createElement('a');
        selectors[page.series_key][label] = page.isDefaultSeries(label);
        selector.className = selectors[page.series_key][label] ? 'selector selector-active' : 'selector';
        selector.dataset.series = label;
        selector.appendChild(document.createTextNode(label));
        const tooltip = page.seriesTooltip?.(label);
        if (tooltip) { selector.title = tooltip; }
        page.series_container.appendChild(selector);
        page.decorateSeries?.(selector, label);
        selector.addEventListener('click', e => toggle(e, label, page.series_key));

        /// Highlighting summary rows and table columns on hovering over the series selector.
        selector.addEventListener('mouseover', e => {
            [...document.querySelectorAll('.summary-row')].map(row => {
                row.className = row.dataset.series == label ? 'summary-row summary-row-hilite' : 'summary-row' });
            [...document.querySelectorAll('.th-entry')].map(th => {
                th.className = th.dataset.series == label ? 'th-entry th-entry-hilite' : 'th-entry' });
        });
        selector.addEventListener('mouseout', e => {
            [...document.querySelectorAll('.summary-row')].map(row => { row.className = 'summary-row' });
            [...document.querySelectorAll('.th-entry')].map(row => { row.className = 'th-entry' });
        });
    });

    document.getElementById('select-all-series')?.addEventListener('click', e => toggleAll(e, page.series_key));
}

/// The series selectors of a page, without the "All" toggle sharing their container.
function seriesSelectorElements() {
    return [...page.series_container.querySelectorAll('a')].filter(elem => elem.dataset.series);
}

/// Show a machine's environment.yaml (embedded in data.generated.js as
/// machine_environments) as a hover tooltip on its selector. Generated data
/// files predating machine_environments simply get no tooltips.
function attachMachineEnvironment(selector, machine) {
    if (typeof machine_environments === 'undefined') { return; }
    const env = machine_environments[machine];
    if (!env) { return; }
    let tooltip = document.createElement('span');
    tooltip.className = 'tooltip tooltip-machine-env';
    tooltip.appendChild(document.createTextNode(env.trim()));
    selector.appendChild(tooltip);
}

/// Load query descriptions and tags from the PSV. The file is tiny, so parsing it on
/// every page load is free; the benefit is that new queries appear automatically.
/// When the page is opened via file:// the fetch is blocked - fall back to the copy
/// embedded in querymeta.generated.js (refreshed by pysrc/convertToJSFormat.py).
async function loadQueryMeta() {
    let text = null;
    try {
        const response = await fetch(page.base + 'artifacts/queries/inmemory/querymeta.psv');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
    } catch (e) {
        if (typeof querymeta_psv !== 'undefined') {
            text = querymeta_psv;
        } else {
            console.warn('Could not load querymeta.psv, tag filters are disabled:', e);
        }
    }

    if (text !== null) {
        const lines = text.trim().split('\n');
        const header = lines[0].split('|');
        const idx_tags = header.indexOf('tags');
        const idx_instrument = header.indexOf('instrument');
        const idx_complexity = header.indexOf('complexity');
        const idx_description = header.indexOf('description');
        const idx_comment = header.indexOf('comment');
        lines.slice(1).forEach(line => {
            const fields = line.split('|');
            const comment = (fields[idx_comment] ?? '').trim();
            queries.push(fields[idx_description] + (comment ? ` (${comment})` : ''));
            const tags = (fields[idx_tags] ?? '').split(',').map(t => t.trim()).filter(t => t !== '');
            /// The `complexity` column feeds the dedicated "Complexity filter" selector;
            /// legacy complexity:<value> tags are kept out of the generic tag lists.
            query_complexity.push((fields[idx_complexity] ?? '').trim());
            query_tags.push(tags.filter(t => !t.startsWith('complexity:')));
            query_instrument.push((fields[idx_instrument] ?? '').trim());
        });
    }

    const all_tags = [...new Set(query_tags.flat())].sort();
    if (query_tags.length == 0) {
        document.getElementById('instrument-row').style.display = 'none';
        document.getElementById('complexity-row').style.display = 'none';
        document.getElementById('tag-include-row').style.display = 'none';
        document.getElementById('tag-exclude-row').style.display = 'none';
        return;
    }

    Object.entries(instrument_values).forEach(([value, label]) => {
        let selector = document.createElement('a');
        selector.className = 'selector selector-active';
        selector.appendChild(document.createTextNode(label));
        selector.dataset.tag = value;
        instruments.appendChild(selector);
        selectors.instrument[value] = true;
        selector.addEventListener('click', e => toggle(e, value, 'instrument'));
    });

    /// Sub-selectors that further narrow the `single` and `multi` scopes.
    [['single', 'single freq:', instrument_freq_values],
     ['multi', 'multi size:', instrument_multi_values]].forEach(([parent, sep_label, values]) => {
        let sep = document.createElement('span');
        sep.className = 'inline-filter-label';
        sep.style.marginLeft = '1em';
        sep.appendChild(document.createTextNode(sep_label));
        instruments.appendChild(sep);
        Object.entries(values).forEach(([value, label]) => {
            let selector = document.createElement('a');
            selector.className = 'selector selector-active';
            selector.appendChild(document.createTextNode(label));
            selector.dataset.tag = value;
            selector.dataset.instrumentParent = parent;
            instruments.appendChild(selector);
            selectors.instrument[value] = true;
            selector.addEventListener('click', e => toggle(e, value, 'instrument'));
        });
    });

    Object.entries(complexity_values).forEach(([value, label]) => {
        let selector = document.createElement('a');
        selector.className = 'selector selector-active';
        selector.appendChild(document.createTextNode(label));
        selector.dataset.tag = value;
        complexities.appendChild(selector);
        selectors.complexity[value] = true;
        selector.addEventListener('click', e => toggle(e, value, 'complexity'));
    });

    /// Tag descriptions from tags.psv, shown as hover tooltips on the tag selectors.
    /// Same fetch / file:// fallback dance as querymeta.psv above.
    let tags_text = null;
    try {
        const response = await fetch(page.base + 'artifacts/queries/inmemory/tags.psv');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        tags_text = await response.text();
    } catch (e) {
        if (typeof tags_psv !== 'undefined') tags_text = tags_psv;
    }
    const tag_descriptions = {};
    if (tags_text !== null) {
        const lines = tags_text.trim().split('\n');
        const header = lines[0].split('|');
        const idx_tag = header.indexOf('tag');
        const idx_desc = header.indexOf('description');
        lines.slice(1).forEach(line => {
            const fields = line.split('|');
            const tag = (fields[idx_tag] ?? '').trim();
            if (tag) tag_descriptions[tag] = (fields[idx_desc] ?? '').trim();
        });
    }

    [[tag_includes, 'tag_include'], [tag_excludes, 'tag_exclude']].forEach(([container, selectors_key]) => {
        all_tags.forEach(tag => {
            const active = selectors_key === 'tag_exclude' && default_excluded_tags.includes(tag);
            let selector = document.createElement('a');
            selector.className = active ? 'selector selector-active' : 'selector';
            selector.appendChild(document.createTextNode(tag));
            selector.dataset.tag = tag;
            if (tag_descriptions[tag]) selector.title = tag_descriptions[tag];
            container.appendChild(selector);
            selectors[selectors_key][tag] = active;
            selector.addEventListener('click', e => toggle(e, tag, selectors_key));
        });
    });
}

const sql_clauses = ['ASOF LEFT JOIN', 'ASOF JOIN', 'LEFT JOIN', 'INNER JOIN', 'CROSS JOIN',
    'FULL JOIN', 'GROUP BY', 'ORDER BY', 'PARTITION BY', 'FROM', 'WHERE', 'HAVING',
    'QUALIFY', 'WINDOW', 'LIMIT', 'UNION', 'JOIN', 'ON'];

/// Insert a line break before each keyword found outside string literals, indented
/// two spaces per bracket depth (plus extra_indent levels). Shared by the SQL and
/// q formatters; keywords must be uppercase, sources are matched case-insensitively.
function breakBeforeKeywords(query, keywords, extra_indent, string_quotes) {
    let out = '';
    let depth = 0, quote = null, skip_until = 0;
    for (let i = 0; i < query.length; ++i) {
        const c = query[i];
        if (quote) { out += c; if (c == quote) quote = null; continue; }
        if (string_quotes.includes(c)) { quote = c; out += c; continue; }
        if ('([{'.includes(c)) ++depth;
        else if (')]}'.includes(c)) --depth;
        else if (i >= Math.max(skip_until, 1) && /\s/.test(query[i - 1])) {
            const kw = keywords.find(kw =>
                query.substr(i, kw.length).toUpperCase() == kw &&
                !/\w/.test(query[i + kw.length] ?? ' '));
            if (kw) {
                out = out.replace(/[ \t]+$/, '') + '\n' + '  '.repeat(Math.max(0, depth) + extra_indent);
                skip_until = i + kw.length;
            }
        }
        out += c;
    }
    return out;
}

/// Break a python query before each top-level `.`, turning `t.f(x).g(y)` into a
/// method chain with one call per line. Dots inside brackets, strings and numbers stay.
function breakMethodChain(query) {
    let out = '';
    let depth = 0, quote = null;
    for (let i = 0; i < query.length; ++i) {
        const c = query[i];
        if (quote) { out += c; if (c == quote) quote = null; continue; }
        if (c == "'" || c == '"') { quote = c; out += c; continue; }
        if ('([{'.includes(c)) ++depth;
        else if (')]}'.includes(c)) --depth;
        else if (c == '.' && depth == 0 && i > 0 &&
                 !(/\d/.test(query[i - 1]) && /\d/.test(query[i + 1] ?? ''))) {
            out += '\n  ';
        }
        out += c;
    }
    return out;
}

/// Best-effort pretty-printer for the single-line queries recorded in each entry:
/// SQL clauses, python method chain calls and q select clauses each get their own
/// line. Short queries are left as they are. The engine comes from results.psv;
/// for engines this page does not know yet, the language is guessed from the text.
function formatEngineQuery(query, engine) {
    engine = engine.toLowerCase();
    if (query.length <= 60) { return query; }
    if (engine == 'q-sql') {
        return breakBeforeKeywords(query, ['BY', 'FROM', 'WHERE'], 1, '"');
    }
    if (engine == 'sql' || engine.startsWith('duckdb') || /^\s*(SELECT|WITH)\b/.test(query)) {
        return breakBeforeKeywords(query, sql_clauses, 0, "'\"");
    }
    if (['pandas', 'polars', 'pykx'].includes(engine) || /^\s*\w+\./.test(query)) {
        return breakMethodChain(query);
    }
    return breakBeforeKeywords(query, ['BY', 'FROM', 'WHERE'], 1, '"');
}

/// A query takes part in the comparison when its instrument scope and complexity are
/// selected, it carries at least one of the included tags (no included tags = no
/// restriction) and none of the excluded ones.
function queryPassesTagFilters(query_num) {
    const tags = query_tags[query_num] ?? [];
    const instrument = query_instrument[query_num];
    const include_active = Object.values(selectors.tag_include).some(x => x);
    /// instrument is a base scope optionally refined by frequency, e.g.
    /// "single:infrequent". The query shows only when both its base scope and
    /// (for single) its frequency sub-scope are selected.
    const [base, sub] = (instrument || '').split(':');
    const instrument_ok = !instrument ||
        (selectors.instrument[base] !== false && (!sub || selectors.instrument[sub] !== false));
    const complexity = query_complexity[query_num];
    const complexity_ok = !complexity || selectors.complexity[complexity] !== false;
    return instrument_ok && complexity_ok &&
        (!include_active || tags.some(tag => selectors.tag_include[tag])) &&
        !tags.some(tag => selectors.tag_exclude[tag]);
}

/// Machines ordered by the number of results, most covered first.
function availableMachines(base) {
    return [... new Set(base.map(elem => elem.machine))].sort((a, b) => {
        const count_diff = base.filter(elem => elem.machine === b).length - base.filter(elem => elem.machine === a).length;
        return count_diff == 0 ? a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}) : count_diff;
    });
}

function availableDates(base) {
    return [... new Set(base.filter(page.machineScope).map(elem => elem.datadate))].sort();
}

function availableThreads(base) {
    return [... new Set(base.filter(elem => page.machineScope(elem) && elem.datadate == selectors.date)
        .flatMap(elem => Object.keys(elem.result)))].sort((a, b) => a - b);
}

/// Data date, Threads and the page's own single selections (the machine on index.html)
/// are interdependent: the available dates depend on the machine, the available thread
/// counts on both. If the current selection becomes unavailable, fall back to a
/// sensible default.
function reconcile() {
    const base = data.filter(page.matches);
    if (base.length == 0) { return; }

    page.reconcile(base);

    const available_dates = availableDates(base);
    if (!available_dates.includes(selectors.date)) {
        selectors.date = available_dates[available_dates.length - 1];
    }

    const available_threads = availableThreads(base);
    if (!available_threads.includes(selectors.threads)) {
        selectors.threads = available_threads.includes(default_threads)
            ? default_threads : available_threads[available_threads.length - 1];
    }

    const baseline_choices = page.baselineChoices(base);
    if (!baseline_choices.includes(selectors.baseline)) {
        selectors.baseline = baseline_choices.includes(page.default_baseline)
            ? page.default_baseline : baseline_choices[0];
    }
}

function rebuildDynamicSelectors(displayed_series) {
    const base = data.filter(page.matches);
    if (base.length == 0) { return; }

    page.rebuildSelectors(base);
    buildRadio(dates, availableDates(base), selectors.date, value => { selectors.date = value; });
    buildRadio(threads, availableThreads(base), selectors.threads, value => { selectors.threads = value; });
    buildRadio(baselines, page.baselineChoices(base), selectors.baseline, value => { selectors.baseline = value; });

    /// A baseline without a result for the current machine/date/threads is shown as passive:
    /// it can be selected, but the first of the displayed series is used instead.
    [...baselines.childNodes].forEach(elem => {
        if (elem.classList.contains('selector-active') && !displayed_series.has(elem.dataset.value)) {
            elem.className = 'selector selector-passive';
        }
    });
}

function findPassiveSelectors(filtered_data) {
    const filtered = new Set(filtered_data.map(page.seriesLabel));
    seriesSelectorElements().forEach(elem => {
        if (elem.classList.contains('selector-active') && !filtered.has(elem.dataset.series)) {
            elem.className = 'selector selector-passive';
        } else if (elem.classList.contains('selector-passive') && filtered.has(elem.dataset.series)) {
            elem.className = 'selector selector-active';
        }
    });
}

function updateSelectors() {
    seriesSelectorElements().forEach(elem => {
        elem.className = selectors[page.series_key][elem.dataset.series] ? 'selector selector-active' : 'selector';
    });

    [...document.getElementById('selectors_run').querySelectorAll('a')].map(elem => {
        elem.className = elem.id == 'selector-metric-' + selectors.metric ? 'selector selector-active' : 'selector' });

    [...instruments.querySelectorAll('a')].map(elem => {
        elem.className = selectors.instrument[elem.dataset.tag] ? 'selector selector-active' : 'selector' });
    refreshInstrumentFreqEnabled();
    [...complexities.querySelectorAll('a')].map(elem => {
        elem.className = selectors.complexity[elem.dataset.tag] ? 'selector selector-active' : 'selector' });
    [...tag_includes.querySelectorAll('a')].map(elem => {
        elem.className = selectors.tag_include[elem.dataset.tag] ? 'selector selector-active' : 'selector' });
    [...tag_excludes.querySelectorAll('a')].map(elem => {
        elem.className = selectors.tag_exclude[elem.dataset.tag] ? 'selector selector-active' : 'selector' });

    [...document.querySelectorAll('.query-checkbox')].map((elem, i) => { elem.checked = selectors.queries[i] });

    page.updateSelectors();
}

function clearElement(elem)
{
    while (elem.firstChild) {
        elem.removeChild(elem.lastChild);
    }
}

/// Pick one of the three runs of a query (values are nanoseconds, returned as seconds).
function selectRun(timings, metric) {
    if (timings == null) return null;
    const timing = metric == 'cold' ? timings[0] : metric == 'hot' ? timings[1] : timings[2];
    return timing == null ? null : timing * ns_to_s;
}

/// Geometric mean of per-query time ratios against the baseline series.
/// worst_times[i] is the worst time across the compared series for query i,
/// used to penalize failed queries (footnote [1] at the page bottom).
function relativeQueryTime(num_queries, baseline_runs, runs, metric, worst_times) {
    let accumulator = 0;
    let used_queries = 0;

    const no_queries_selected = selectors.queries.filter(x => x).length == 0;

    for (let i = 0; i < num_queries; ++i) {
        if ((no_queries_selected || selectors.queries[i]) && queryPassesTagFilters(i)) {
            const baseline_timing = selectRun(baseline_runs[i], metric);
            /// Skip queries the baseline fails on - there is no ratio to take.
            if (baseline_timing === null || !isFinite(baseline_timing)) continue;
            const curr_timing = selectRun(runs[i], metric);
            /// Failed query: twice the worst ratio across the compared series for
            /// this query (footnote [1] at the page bottom).
            const ratio = (constant_time_add + (curr_timing ?? worst_times[i])) / (constant_time_add + baseline_timing)
                * (curr_timing === null ? missing_result_penalty : 1);
            accumulator += Math.log(ratio);
            ++used_queries;
        }
    }

    return used_queries > 0 ? Math.exp(accumulator / used_queries) : null;
}

function addNote(text) {
    let note = document.createElement('span');
    note.className = 'note';
    note.appendChild(document.createTextNode('†'));

    let tooltip = document.createElement('span');
    tooltip.className = 'tooltip tooltip-result';
    tooltip.appendChild(document.createTextNode(text));

    note.appendChild(tooltip);
    return note;
}

const chartSeriesColors = [
    'var(--series-1)',
    'var(--series-2)',
    'var(--series-3)',
    'var(--series-4)',
    'var(--series-5)',
    'var(--series-6)',
    'var(--series-7)',
    'var(--series-8)',
];

/// Stable, distinct per-series colours from the controlled chart palette.
function seriesColor(label) {
    const index = page.unique_series.indexOf(label);
    return chartSeriesColors[(index >= 0 ? index : 0) % chartSeriesColors.length];
}

/// Pie chart of how many of the compared queries each series wins (has the fastest time).
/// On an exact tie every tied series gets the win.
function renderWinnersPie(filtered_data) {
    const svg = document.getElementById('winners-pie');
    const legend = document.getElementById('winners-legend');
    if (!svg) { return; }
    clearElement(svg);
    clearElement(legend);

    const num_queries = filtered_data[0].runs.length;
    const no_queries_selected = selectors.queries.filter(x => x).length == 0;
    const wins = new Map(filtered_data.map(elem => [page.seriesLabel(elem), 0]));

    for (let i = 0; i < num_queries; ++i) {
        if (!((no_queries_selected || selectors.queries[i]) && queryPassesTagFilters(i))) continue;
        const timings = filtered_data.map(elem => selectRun(elem.runs[i], selectors.metric));
        const best = Math.min(...timings.filter(x => x !== null));
        if (!isFinite(best)) continue;
        filtered_data.forEach((elem, idx) => {
            const label = page.seriesLabel(elem);
            if (timings[idx] === best) { wins.set(label, wins.get(label) + 1); }
        });
    }

    const winners = [...wins.entries()].filter(([label, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    const total = winners.reduce((acc, [label, count]) => acc + count, 0);
    if (total == 0) { return; }

    const svg_ns = 'http://www.w3.org/2000/svg';
    let angle = -Math.PI / 2;
    winners.forEach(([label, count]) => {
        let slice;
        if (winners.length == 1) {
            slice = document.createElementNS(svg_ns, 'circle');
            slice.setAttribute('r', '1');
        } else {
            const sweep = count / total * 2 * Math.PI;
            const x1 = Math.cos(angle), y1 = Math.sin(angle);
            const x2 = Math.cos(angle + sweep), y2 = Math.sin(angle + sweep);
            slice = document.createElementNS(svg_ns, 'path');
            slice.setAttribute('d', `M 0 0 L ${x1} ${y1} A 1 1 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`);
            angle += sweep;
        }
        slice.style.fill = seriesColor(label);
        /// Surface-colored gap between the slices
        slice.style.stroke = 'var(--background-color)';
        slice.style.strokeWidth = '0.035';

        let title = document.createElementNS(svg_ns, 'title');
        title.textContent = `${label}: ${count} wins (${Math.round(count / total * 100)}%)`;
        slice.appendChild(title);
        svg.appendChild(slice);

        let entry = document.createElement('span');
        entry.className = 'winners-legend-entry';
        let swatch = document.createElement('span');
        swatch.className = 'winners-swatch';
        swatch.style.background = seriesColor(label);
        entry.appendChild(swatch);
        entry.appendChild(document.createTextNode(`${label}: ${count}`));
        legend.appendChild(entry);
    });
}

/// Horizontal bar chart of one per-series value in the summary-table anatomy,
/// smallest value first. Returns whether any of the entries carries the value.
function renderBarChart(table_id, entries, value_of, format_value, tooltip_suffix) {
    const table = document.getElementById(table_id);
    if (!table) { return false; }
    clearElement(table);

    const with_value = entries.filter(elem => value_of(elem) != null);
    if (!with_value.length) { return false; }

    /// All-zero values (e.g. no query failures at all) still need a valid bar width.
    const max_value = Math.max(...with_value.map(value_of)) || 1;
    [...with_value].sort((a, b) => value_of(a) - value_of(b)).forEach(elem => {
        const value = value_of(elem);
        const label = page.seriesLabel(elem);
        let tr = document.createElement('tr');
        tr.title = `${label}: ${format_value(value)} ${tooltip_suffix}`;

        let td_name = document.createElement('td');
        td_name.className = 'summary-name';
        let name = document.createElement('span');
        name.style.color = seriesColor(label);
        name.appendChild(document.createTextNode(label));
        td_name.appendChild(name);
        td_name.appendChild(document.createTextNode(': '));

        let td_bar = document.createElement('td');
        td_bar.className = 'summary-bar-cell';
        let bar = document.createElement('div');
        bar.className = 'summary-bar';
        bar.style.width = `${value / max_value * 100}%`;
        bar.style.background = seriesColor(label);
        td_bar.appendChild(bar);

        let td_number = document.createElement('td');
        td_number.className = 'summary-number';
        td_number.appendChild(document.createTextNode(format_value(value)));

        tr.appendChild(td_name);
        tr.appendChild(td_bar);
        tr.appendChild(td_number);
        table.appendChild(tr);
    });
    return true;
}

/// Bar chart of how many of the compared queries each series fails on (no result
/// for the selected run, shown as ☠ in the details table). Absolute counts, no ratios;
/// like the pie, it honors the query checkboxes and tag filters. Pages without a
/// failures panel skip it.
function renderFailuresChart(filtered_data) {
    if (!document.getElementById('failures-table')) { return; }

    const num_queries = filtered_data[0].runs.length;
    const no_queries_selected = selectors.queries.filter(x => x).length == 0;
    const failures = new Map(filtered_data.map(elem => [page.seriesLabel(elem), 0]));

    for (let i = 0; i < num_queries; ++i) {
        if (!((no_queries_selected || selectors.queries[i]) && queryPassesTagFilters(i))) continue;
        filtered_data.forEach(elem => {
            const label = page.seriesLabel(elem);
            if (selectRun(elem.runs[i], selectors.metric) === null) {
                failures.set(label, failures.get(label) + 1);
            }
        });
    }

    renderBarChart('failures-table', filtered_data,
        elem => failures.get(page.seriesLabel(elem)),
        value => value.toLocaleString('en-US'),
        'failed queries');
}

/// Bar charts of each series' peak memory use (max_res_mem_kb) and in-memory data
/// size. Both describe the whole benchmark run, so unlike the pie they are not
/// affected by the query filters. Pages without a memory panel skip them.
function renderMemoryCharts(filtered_data) {
    const panel = document.getElementById('memory-panel');
    if (!panel) { return; }

    const has_mem = renderBarChart('memory-table', filtered_data,
        elem => elem.max_res_mem_kb,
        value => (value / 1024 / 1024).toLocaleString('en-US',
            { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        'GB maximum resident set size');
    document.getElementById('memory-title').style.display = has_mem ? '' : 'none';

    const has_size = renderBarChart('datasize-table', filtered_data,
        elem => elem.data_size,
        value => (value / 1024).toLocaleString('en-US',
            { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        'GB of loaded data');
    document.getElementById('datasize-title').style.display = has_size ? '' : 'none';

    panel.style.display = has_mem || has_size ? '' : 'none';
}

function renderSummary(filtered_data, baseline_runs) {
    let table = document.getElementById('summary');
    clearElement(table);

    /// Generate summary

    /// The algorithm: for each of the queries,
    /// - if there is a result - take query duration, add 10 ms, and divide it to the corresponding value of the baseline,
    /// - if there is no result - take the worst time ratio across the compared series for this query and multiply by 2.
    /// Take geometric mean across the queries.

    const num_queries = baseline_runs.length;

    /// Worst per-query time across the compared series (and the baseline, so the
    /// value is defined whenever the query is compared at all), feeding the penalty
    /// ratio of failed queries.
    const worst_times = [...Array(num_queries).keys()].map(i =>
        Math.max(...[...filtered_data.map(elem => elem.runs[i]), baseline_runs[i]]
            .map(timings => selectRun(timings, selectors.metric)).filter(x => x !== null)));

    const summaries = filtered_data.map(elem => relativeQueryTime(num_queries, baseline_runs, elem.runs, selectors.metric, worst_times));

    const sorted_indices = [...summaries.keys()].sort((a, b) => summaries[a] - summaries[b]);

    /// Scale the bars so that the slowest series fills the row at the innermost zoom level.
    /// All summaries are null when the filters leave no queries to compare.
    const finite_summaries = summaries.filter(x => x !== null && isFinite(x));
    const max_ratio = finite_summaries.length ? Math.max(10, Math.pow(10, Math.ceil(Math.log10(Math.max(...finite_summaries))))) : 10;

    sorted_indices.map(idx => {
        const elem = filtered_data[idx];
        const label = page.seriesLabel(elem);

        let tr = document.createElement('tr');
        tr.className = 'summary-row';

        tr.dataset.series = label;

        let td_name = document.createElement('td');
        td_name.className = 'summary-name';

        let remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-system';
        remove.setAttribute('aria-label', `Remove ${label} from the comparison`);
        remove.title = `Remove ${label} from the comparison`;

        let removeIcon = document.createElement('span');
        removeIcon.setAttribute('aria-hidden', 'true');
        removeIcon.textContent = '×';
        remove.appendChild(removeIcon);
        remove.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            selectors[page.series_key][label] = false;
            seriesSelectorElements().forEach(elem => {
                if (elem.dataset.series === label) { elem.className = 'selector'; }
            });
            render();
            updateHistory();
        });
        td_name.appendChild(remove);

        let name = page.seriesNameNode(label);
        name.style.color = seriesColor(label);
        td_name.appendChild(name);

        if (elem.comment) { td_name.appendChild(addNote(elem.comment)); }
        td_name.appendChild(document.createTextNode(': '));

        const ratio = summaries[idx];
        const percentage = ratio !== null ? ratio / max_ratio * 100 : 0;

        let td_number = document.createElement('td');
        td_number.className = 'summary-number';
        if (ratio !== null) {
            appendRatio(td_number, ratio);
        } else {
            td_number.appendChild(document.createTextNode('—'));
        }

        let td_bar = document.createElement('td');
        td_bar.className = 'summary-bar-cell';

        let bar = document.createElement('div');

        bar.className = `summary-bar`;
        const scale1 = Math.min(100, percentage);
        const scale2 = Math.min(100, percentage * 10);
        bar.style.background = `linear-gradient(to right,
            var(--chart-scale-1) 0%,
            var(--chart-scale-1) ${scale1}%,
            var(--chart-scale-2) ${scale1}%,
            var(--chart-scale-2) ${scale2}%,
            transparent ${scale2}%,
            transparent 100%)`;

        td_bar.appendChild(bar);

        tr.appendChild(td_name);
        tr.appendChild(td_bar);
        tr.appendChild(td_number);
        table.appendChild(tr);
    });

    renderFailuresChart(filtered_data);
    renderWinnersPie(filtered_data);
    renderMemoryCharts(filtered_data);

    return sorted_indices;
}

/// Appends a ratio as "×<n>". Speedups read better inverted, so a ratio of 0.5
/// becomes ×2.0<sup>-1</sup>; the inverse gets one decimal so the extra exponent
/// does not widen the column.
function appendRatio(elem, ratio) {
    if (isFinite(ratio) && ratio > 0 && ratio < 1) {
        elem.appendChild(document.createTextNode(`×${(1 / ratio).toFixed(1)}`));
        let sup = document.createElement('sup');
        sup.appendChild(document.createTextNode('-1'));
        elem.appendChild(sup);
    } else {
        elem.appendChild(document.createTextNode(`×${ratio.toFixed(2)}`));
    }
}

/// Appends "<time>s (×<ratio>)" to a cell, or ☠ when the query produced no timing.
function appendTimingWithRatio(elem, curr_timing, ratio) {
    if (curr_timing === null) {
        elem.appendChild(document.createTextNode('☠'));
        return;
    }

    elem.appendChild(document.createTextNode(`${curr_timing.toFixed(3)}s`));
    if (ratio === null) { return; }

    elem.appendChild(document.createTextNode(' ('));
    appendRatio(elem, ratio);
    elem.appendChild(document.createTextNode(')'));
}

function colorize(elem, ratio) {
    elem.classList.remove('result-much-faster', 'result-faster', 'result-similar',
        'result-slower', 'result-much-slower', 'result-failed');

    let description;
    if (ratio === null || !isFinite(ratio)) {
        elem.classList.add('result-failed');
        description = 'Query failed or no comparable result';
    } else if (ratio < 0.5) {
        elem.classList.add('result-much-faster');
        description = `${Math.round((1 - ratio) * 100)} percent faster than baseline`;
    } else if (ratio < 0.9) {
        elem.classList.add('result-faster');
        description = `${Math.round((1 - ratio) * 100)} percent faster than baseline`;
    } else if (ratio <= 1.1) {
        elem.classList.add('result-similar');
        description = 'Approximately equal to baseline';
        if (ratio === 1) elem.style.fontWeight = 'bold';
    } else if (ratio <= 2) {
        elem.classList.add('result-slower');
        description = `${Math.round((ratio - 1) * 100)} percent slower than baseline`;
    } else {
        elem.classList.add('result-much-slower');
        description = `${ratio.toFixed(2)} times the baseline execution time`;
    }
    elem.setAttribute('aria-label', `${elem.textContent.trim()}. ${description}.`);
}

/// The entries taking part in the comparison: those matching the page filters whose
/// series is selected and which have a result for the selected machine, date and
/// thread count. Each keeps `runs`: the per-query timings for that thread count.
function filterEntries() {
    return data.filter(elem =>
        page.matches(elem) &&
        selectors[page.series_key][page.seriesLabel(elem)] &&
        page.machineScope(elem) &&
        elem.datadate == selectors.date &&
        elem.result[selectors.threads] != null
    ).map(elem => ({...elem, runs: elem.result[selectors.threads]}));
}

/// The baseline entry is looked up independently of the series selection, so ratios
/// stay stable when the baseline series itself is hidden from the charts.
function findBaselineEntry(filtered_data) {
    return data.find(elem =>
        page.matches(elem) &&
        page.seriesLabel(elem) == selectors.baseline &&
        page.baselineScope(elem) &&
        elem.datadate == selectors.date &&
        elem.result[selectors.threads] != null) ?? filtered_data[0];
}

function render() {
    let details_head = document.getElementById('details_head');
    let details_body = document.getElementById('details_body');
    let load_times_head = document.getElementById('load_times_head');
    let load_times_body = document.getElementById('load_times_body');

    clearElement(details_head);
    clearElement(details_body);
    clearElement(load_times_head);
    clearElement(load_times_body);

    reconcile();

    const filtered_data = filterEntries();
    const baseline_entry = findBaselineEntry(filtered_data);

    rebuildDynamicSelectors(new Set(baseline_entry
        ? [...filtered_data.map(page.seriesLabel), page.seriesLabel(baseline_entry)] : []));

    const nothingSelectedElement = document.getElementById('nothing-selected');
    const resultsContent = [...document.querySelectorAll('.results-content')];

    if (filtered_data.length === 0) {
        nothingSelectedElement.hidden = false;
        resultsContent.forEach(element => { element.hidden = true; });
        requestAnimationFrame(applyAccessibilityEnhancements);
        return;
    }

    nothingSelectedElement.hidden = true;
    resultsContent.forEach(element => { element.hidden = false; });

    const baseline_runs = baseline_entry.result[selectors.threads];
    document.getElementById('baseline-name').textContent = page.seriesLabel(baseline_entry);

    const sorted_indices = renderSummary(filtered_data, baseline_runs);

    /// Generate details

    /// Global checkbox
    {
        let th_checkbox = document.createElement('th');
        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', e => {
            [...document.querySelectorAll('.query-checkbox')].map(elem => { elem.checked = e.target.checked });
            selectors.queries.map((_, i) => { selectors.queries[i] = e.target.checked });
            renderSummary(filtered_data, baseline_runs);
            updateHistory();
        });
        th_checkbox.appendChild(checkbox);
        details_head.appendChild(th_checkbox);
        details_head.appendChild(document.createElement('th'));
    }

    /// Table header
    sorted_indices.map(idx => {
        const label = page.seriesLabel(filtered_data[idx]);
        let th = document.createElement('th');
        th.appendChild(document.createTextNode(label));
        th.className = 'th-entry';
        th.dataset.series = label;
        details_head.appendChild(th);
    });

    /// Load times, one row per load phase, in their own table at the bottom of the page
    const load_phases = load_phase_order.filter(phase =>
        filtered_data.some(elem => elem.load_time?.[phase]?.[selectors.threads] != null));

    document.getElementById('load-times-section').style.display = load_phases.length ? '' : 'none';

    if (load_phases.length) {
        load_times_head.appendChild(document.createElement('th'));
        sorted_indices.map(idx => {
            const label = page.seriesLabel(filtered_data[idx]);
            let th = document.createElement('th');
            th.appendChild(document.createTextNode(label));
            th.className = 'th-entry';
            th.dataset.series = label;
            load_times_head.appendChild(th);
        });
    }

    /// Total load time per series. A missing phase counts as zero, so the total is
    /// always a number, even for a series that reported no load times at all.
    const loadTotal = elem => load_phases.reduce(
        (sum, phase) => sum + (elem.load_time?.[phase]?.[selectors.threads] ?? 0), 0) * ns_to_s;

    /// Without any baseline load time there is nothing to compare against, so the
    /// totals are shown without a ratio rather than against a zero-second baseline.
    const hasLoadTimes = elem => load_phases.some(phase => elem.load_time?.[phase]?.[selectors.threads] != null);

    if (load_phases.length) {
        let tr = document.createElement('tr');
        tr.className = 'shadow load-times-total';

        let td_title = document.createElement('td');
        td_title.appendChild(document.createTextNode('Total: '));
        tr.appendChild(td_title);

        const baseline_total = hasLoadTimes(baseline_entry) ? loadTotal(baseline_entry) : null;

        sorted_indices.map(idx => {
            const curr_total = loadTotal(filtered_data[idx]);
            const ratio = baseline_total !== null ? (constant_time_add + curr_total) / (constant_time_add + baseline_total) : null;

            let td = document.createElement('td');
            appendTimingWithRatio(td, curr_total, ratio);

            colorize(td, ratio);
            tr.appendChild(td);
        });

        load_times_body.appendChild(tr);
    }

    load_phases.forEach(phase => {
        let tr = document.createElement('tr');
        tr.className = 'shadow';

        let td_title = document.createElement('td');
        td_title.appendChild(document.createTextNode(`${phase}: `));
        tr.appendChild(td_title);

        const baseline_ns = baseline_entry.load_time?.[phase]?.[selectors.threads];
        const baseline_timing = baseline_ns != null ? baseline_ns * ns_to_s : null;

        sorted_indices.map(idx => {
            /// A phase a series does not report costs it nothing, so it shows as 0.000s.
            const curr_timing = (filtered_data[idx].load_time?.[phase]?.[selectors.threads] ?? 0) * ns_to_s;
            const ratio = baseline_timing !== null ? (constant_time_add + curr_timing) / (constant_time_add + baseline_timing) : null;

            let td = document.createElement('td');
            appendTimingWithRatio(td, curr_timing, ratio);

            colorize(td, ratio);
            tr.appendChild(td);
        });

        load_times_body.appendChild(tr);
    });

    /// Query runtimes
    const num_queries = filtered_data[0].runs.length;

    for (let query_num = 0; query_num < num_queries; ++query_num) {
        if (!queryPassesTagFilters(query_num)) { continue; }

        let tr = document.createElement('tr');
        tr.className = 'shadow';

        let td_checkbox = document.createElement('td');
        let checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'query-checkbox';
        checkbox.checked = selectors.queries[query_num];
        checkbox.addEventListener('change', e => {
            selectors.queries[query_num] = e.target.checked;
            renderSummary(filtered_data, baseline_runs);
            updateHistory();
        });
        td_checkbox.appendChild(checkbox);
        tr.appendChild(td_checkbox);

        let td_query_num = document.createElement('td');
        td_query_num.className = 'note';
        td_query_num.appendChild(document.createTextNode(`Q${query_num + 1}. `));

        let tooltip = document.createElement('span');
        tooltip.className = 'tooltip tooltip-query';
        const tags = query_tags[query_num] ?? [];
        tooltip.appendChild(document.createTextNode(`Query ${query_num + 1}: ${queries[query_num] ?? '(no description)'}`
            + (tags.length ? `\nTags: ${tags.join(', ')}` : '')));
        td_query_num.appendChild(tooltip);

        tr.appendChild(td_query_num);

        sorted_indices.map((idx, col) => {
            const curr_timing = selectRun(filtered_data[idx].runs[query_num], selectors.metric);
            const baseline_timing = selectRun(baseline_runs[query_num], selectors.metric);
            const ratio = curr_timing !== null && baseline_timing !== null ? (constant_time_add + curr_timing) / (constant_time_add + baseline_timing) : null;

            let td = document.createElement('td');
            appendTimingWithRatio(td, curr_timing, ratio);

            colorize(td, ratio);

            /// The query this entry's engine actually ran, shown on hover. Columns
            /// in the left half of the table grow the tooltip rightwards and vice versa.
            const engine_query = filtered_data[idx].queries_tooltip?.[query_num];
            if (engine_query) {
                let tooltip = document.createElement('span');
                tooltip.className = 'tooltip tooltip-engine-query';
                tooltip.appendChild(document.createTextNode(engine_query));
                td.appendChild(tooltip);

                /// Puts the tooltip on whichever side of the cell has room for it. The
                /// scrolling table clips anything outside its box, so the room available
                /// is bounded by that box as well as by the viewport, and the tooltip is
                /// capped to what it gets - otherwise a wide query on a right-hand column
                /// flips leftwards and has its left half cut off.
                const positionEngineTooltip = () => {
                    tooltip.classList.remove('tooltip-engine-query-flipped');
                    tooltip.style.maxWidth = '';

                    /// On narrow screens the tooltip is a fixed, full-width panel instead.
                    if (getComputedStyle(tooltip).position === 'fixed') { return; }

                    const viewportPadding = 16;
                    const tooltipGap = 8; /* the 0.5rem offset from the cell */
                    const scroller = td.closest('.table-scroll');
                    const bounds = scroller ? scroller.getBoundingClientRect() : null;
                    const limit_left = Math.max(viewportPadding, bounds ? bounds.left : 0);
                    const limit_right = Math.min(window.innerWidth - viewportPadding, bounds ? bounds.right : window.innerWidth);

                    const cell = td.getBoundingClientRect();
                    const room_right = limit_right - cell.right - tooltipGap;
                    const room_left = cell.left - tooltipGap - limit_left;

                    if (tooltip.offsetWidth <= room_right) { return; }

                    const flip = room_left > room_right;
                    if (flip) { tooltip.classList.add('tooltip-engine-query-flipped'); }
                    tooltip.style.maxWidth = `${Math.floor(Math.max(flip ? room_left : room_right, 0))}px`;
                };

                td.addEventListener('mouseenter', positionEngineTooltip);
                td.addEventListener('focusin', positionEngineTooltip);
            }

            tr.appendChild(td);
        });

        details_body.appendChild(tr);
    }

    findPassiveSelectors(filtered_data);

    /// The small hint below the column heading
    document.getElementById("scale_hint").textContent = 'Each colour band shows the same ratio range at a different scale: 1x and 10x.';
    requestAnimationFrame(applyAccessibilityEnhancements);
}

function isSubsequence(str, subseq) {
    let i = 0, j = 0;
    while (i < str.length && j < subseq.length) {
        if (str[i] === subseq[j]) j++;
        i++;
    }
    return j === subseq.length;
}

/// A greedy algorithm to find a unique subsequence of a string in a set. Does not necessarily the smallest one.
function findUniqueSubsequence(target, others) {
    const num_matches = others.filter(s => isSubsequence(s, target)).length;
    let num_failures = 0;
    for (let i = 0; i < 1000; ++i) {
        /// We cut characters from pseudorandom places, this gives shorter subsequences than cutting prefix/suffix.
        const cut_idx = (i + 123) * 67601 % target.length;
        const cut = target.substring(0, cut_idx) + target.substring(cut_idx + 1, target.length);
        if (others.filter(s => isSubsequence(s, cut)).length == num_matches) {
            target = cut;
            num_failures = 0;
        } else {
            ++num_failures;
            if (num_failures == target.length) {
                break;
            }
        }
    }
    return target;
}

function encodedStrings(strings) {
    let res = {};
    strings.forEach(s => { res[s] = findUniqueSubsequence(s, strings) });
    return res;
}

let encoded_keys = {};
function encodeState(selectors) {
    return Object.keys(selectors).map(k => {
        let encoded_str = k + '=';
        if (typeof selectors[k] === 'string') {
            return encoded_str + selectors[k];
        }
        /// A single selection with nothing to select (no data for the current filters)
        /// encodes as empty; reconcile() fills it in again once there is a choice.
        if (selectors[k] == null) {
            return encoded_str;
        }
        if (!encoded_keys[k]) {
            encoded_keys[k] = encodedStrings(Object.keys(selectors[k]));
        }
        const count_total = Object.values(selectors[k]).length;
        const count_selected = Object.values(selectors[k]).filter(x => x).length;
        if (count_selected * 2 <= count_total) {
            encoded_str += '+' + Object.keys(selectors[k]).filter(x => selectors[k][x]).map(x => encoded_keys[k][x]).join('|');
        } else {
            encoded_str += '-' + Object.keys(selectors[k]).filter(x => !selectors[k][x]).map(x => encoded_keys[k][x]).join('|');
        }
        return encoded_str;
    }).join('&');
}

function decodeState(state) {
    let decoded = {};
    state.split('&').forEach(kv => {
        let [k, v] = kv.split('=');

        if (typeof selectors[k] === 'string') {
            decoded[k] = v;
        } else if (typeof selectors[k] === 'object' && selectors[k] !== null) {
            decoded[k] = Array.isArray(selectors[k]) ? [] : {};

            const filtered = v.substring(1, v.length).split('|').filter(s => s !== '')
                .map(substr => Object.keys(selectors[k]).filter(x => isSubsequence(x, decodeURIComponent(substr))).reduce((a, b) => a.length <= b.length ? a : b));

            if (v.startsWith('+')) {
                Object.keys(selectors[k]).forEach(x => {
                    decoded[k][x] = filtered.includes(x);
                });
            } else if (v.startsWith('-')) {
                Object.keys(selectors[k]).forEach(x => {
                    decoded[k][x] = !filtered.includes(x);
                });
            }
        } else {
            decoded[k] = v;
        }
    });
    return decoded;
}

function applyStateDefaults() {
    if (!selectors.metric) {
        selectors.metric = default_metric;
    }
    if (!selectors.baseline) {
        selectors.baseline = page.default_baseline;
    }
    if (!selectors.instrument) {
        selectors.instrument = Object.fromEntries(
            [...Object.keys(instrument_values), ...Object.keys(instrument_freq_values),
             ...Object.keys(instrument_multi_values)]
                .map(value => [value, true]));
    }
    if (!selectors.complexity) {
        selectors.complexity = Object.fromEntries(
            Object.keys(complexity_values).map(value => [value, true]));
    }
    if (!selectors.tag_include) {
        selectors.tag_include = allFalseTagMap();
    }
    if (!selectors.tag_exclude) {
        selectors.tag_exclude = tagMap(tag => default_excluded_tags.includes(tag));
    }
    page.applyStateDefaults();
}

function allFalseTagMap() {
    return tagMap(() => false);
}

function tagMap(value) {
    return Object.fromEntries([...new Set(query_tags.flat())].map(tag => [tag, value(tag)]));
}

function updateHistory() {
    history.pushState(selectors, '',
        window.location.pathname + (window.location.search || '') + '#' + encodeState(selectors));
}

window.onpopstate = function(event) {
    if (!event.state) { return; }
    selectors = event.state;
    applyStateDefaults();
    updateSelectors();
    render();
    requestAnimationFrame(applyAccessibilityEnhancements);
};

function prepareExternalLinks(root = document) {
    root.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');

        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            return;
        }

        let targetUrl;
        try {
            targetUrl = new URL(link.href, window.location.href);
        } catch {
            return;
        }

        const isHttpLink = targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:';
        const isDifferentHostname = targetUrl.hostname !== window.location.hostname;

        if (isHttpLink && isDifferentHostname) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    });
}

function applyAccessibilityEnhancements() {
    document.querySelectorAll('.selector').forEach(selector => {
        selector.setAttribute('role', 'button');
        selector.setAttribute('tabindex', selector.classList.contains('selector-disabled') ? '-1' : '0');
        selector.setAttribute('aria-pressed', selector.classList.contains('selector-active') ? 'true' : 'false');
        if (selector.classList.contains('selector-passive') || selector.classList.contains('selector-disabled')) {
            selector.setAttribute('aria-disabled', 'true');
        } else {
            selector.removeAttribute('aria-disabled');
        }
        if (!selector.dataset.keyboardBound) {
            selector.addEventListener('keydown', event => {
                if ((event.key === 'Enter' || event.key === ' ') && selector.getAttribute('aria-disabled') !== 'true') {
                    event.preventDefault();
                    selector.click();
                }
            });
            selector.dataset.keyboardBound = 'true';
        }
    });

    const themeButton = document.getElementById('toggle-theme');
    themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    themeButton.setAttribute('aria-label', theme === 'dark' ? 'Use light theme' : 'Use dark theme');

    const allCheckbox = document.querySelector('#details_head input[type="checkbox"]');
    const queryCheckboxes = [...document.querySelectorAll('.query-checkbox')];
    if (allCheckbox) {
        allCheckbox.setAttribute('aria-label', 'Select all displayed queries');
        const selected = queryCheckboxes.filter(input => input.checked).length;
        allCheckbox.indeterminate = selected > 0 && selected < queryCheckboxes.length;
    }
    queryCheckboxes.forEach((input, index) => {
        input.setAttribute('aria-label', `Include query ${index + 1} in the summary`);
    });

    document.querySelectorAll('.note').forEach((note, index) => {
        note.setAttribute('tabindex', '0');
        const tooltip = note.querySelector('.tooltip');
        if (tooltip) {
            if (!tooltip.id) tooltip.id = `tooltip-${index + 1}`;
            note.setAttribute('aria-describedby', tooltip.id);
            tooltip.setAttribute('role', 'tooltip');
        }
    });

    document.querySelectorAll('#details td').forEach((cell, index) => {
        const tooltip = cell.querySelector('.tooltip-engine-query');
        if (tooltip) {
            cell.setAttribute('tabindex', '0');
            if (!tooltip.id) tooltip.id = `engine-query-tooltip-${index + 1}`;
            cell.setAttribute('aria-describedby', tooltip.id);
            tooltip.setAttribute('role', 'tooltip');
        }
    });

    document.querySelectorAll('.winners-legend-entry').forEach(entry => entry.setAttribute('role', 'listitem'));
    document.getElementById('winners-legend')?.setAttribute('role', 'list');

    const details = document.getElementById('details');
    if (details && !details.querySelector('caption')) {
        const caption = document.createElement('caption');
        caption.textContent = `Execution time and ratio to the selected baseline for each query and ${page.series_name}`;
        details.prepend(caption);
    }
    const load = document.getElementById('load_times');
    if (load && !load.querySelector('caption')) {
        const caption = document.createElement('caption');
        caption.textContent = 'Load phase duration and ratio to the selected baseline';
        load.prepend(caption);
    }
    document.querySelectorAll('#details_head th, #load_times_head th').forEach(th => th.setAttribute('scope', 'col'));

    const visibleSeries = document.querySelectorAll('#summary .summary-row').length;
    const visibleQueries = document.querySelectorAll('#details_body tr').length;
    const status = document.getElementById('results-status');
    if (status) {
        status.textContent = visibleSeries
            ? `${visibleSeries} ${seriesPlural()} and ${visibleQueries} queries displayed. Baseline: ${document.getElementById('baseline-name').textContent}.`
            : 'No results match the selected filters.';
    }

    prepareExternalLinks();
}

/// Build the selectors, restore any state carried by the URL and draw the page.
/// Called by each page once its `page` object is in place.
async function initBenchmark() {
    let stored_theme = window.localStorage.getItem('theme');
    if (stored_theme && stored_theme != theme) {
        theme = stored_theme;
        document.documentElement.setAttribute('data-theme', theme);
    }

    document.getElementById('toggle-theme').addEventListener('click', e => setTheme(theme == 'dark' ? 'light' : 'dark'));

    /// The [1] marker jumps to the footnote at the page bottom. The default anchor
    /// navigation must not run: the URL hash carries the encoded selector state,
    /// which "#geomean-footnote" would overwrite. Pages whose series never fail a
    /// query carry no footnote at all.
    document.getElementById('goto-footnote')?.addEventListener('click', e => {
        e.preventDefault();
        const footnote = document.getElementById('geomean-footnote');
        footnote.scrollIntoView({behavior: 'smooth', block: 'center'});
        footnote.focus({preventScroll: true});
    });

    document.getElementById('goto-load-footnote')?.addEventListener('click', e => {
        e.preventDefault();
        const footnote = document.getElementById('load-footnote');
        footnote.scrollIntoView({behavior: 'smooth', block: 'center'});
        footnote.focus({preventScroll: true});
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.classList.add('force-hidden'));
            document.activeElement?.blur();
        }
    });

    document.addEventListener('focusin', () => {
        document.querySelectorAll('.tooltip.force-hidden').forEach(tooltip => tooltip.classList.remove('force-hidden'));
    });

    document.getElementById('reset-filters').addEventListener('click', () => {
        window.location.href = window.location.pathname + '?size=' + selected_size;
    });

    document.getElementById('copy-comparison-link').addEventListener('click', async event => {
        const button = event.currentTarget;
        try {
            await navigator.clipboard.writeText(window.location.href);
            button.textContent = 'Link copied';
        } catch {
            window.prompt('Copy this comparison link:', window.location.href);
        }
        setTimeout(() => { button.textContent = 'Copy comparison link'; }, 2000);
    });

    const cookieSettingsButton = document.getElementById('footer-cookie-settings');
    cookieSettingsButton?.addEventListener('click', () => {
        if (window.OneTrust && typeof window.OneTrust.ToggleInfoDisplay === 'function') {
            window.OneTrust.ToggleInfoDisplay();
            return;
        }

        if (window.Optanon && typeof window.Optanon.ToggleInfoDisplay === 'function') {
            window.Optanon.ToggleInfoDisplay();
            return;
        }

        console.warn('OneTrust Preference Center is unavailable. Confirm that the OneTrust CMP script is loaded and published for this domain.');
    });

    sizes = document.getElementById('selectors_size');
    dates = document.getElementById('selectors_date');
    threads = document.getElementById('selectors_threads');
    baselines = document.getElementById('selectors_baseline');
    instruments = document.getElementById('selectors_instrument');
    complexities = document.getElementById('selectors_complexity');
    tag_includes = document.getElementById('selectors_tag_include');
    tag_excludes = document.getElementById('selectors_tag_exclude');

    selectors = page.initialSelectors();

    buildSizeSelectors();
    buildSeriesSelectors();
    page.buildSelectors();

    [...document.getElementById('selectors_run').querySelectorAll('a')].map(elem => elem.addEventListener('click', e => {
        [...e.target.parentElement.querySelectorAll('a')].map(elem => { elem.className = elem == e.target ? 'selector selector-active' : 'selector' });
    }));

    document.getElementById('selector-metric-cold').addEventListener('click', e => { selectors.metric = 'cold'; render(); updateHistory(); });
    document.getElementById('selector-metric-hot').addEventListener('click', e => { selectors.metric = 'hot'; render(); updateHistory(); });
    document.getElementById('selector-metric-hot2').addEventListener('click', e => { selectors.metric = 'hot2'; render(); updateHistory(); });

    selectors.queries = Object.values(data[0].result)[0].map(k => true);

    /// Pre-format the per-cell tooltip texts from the query texts and engine name
    /// recorded in each entry by pysrc/convertToJSFormat.py.
    data.forEach(elem => {
        if (elem.queries) {
            elem.queries_tooltip = elem.queries.map(query => formatEngineQuery(query, elem.engine ?? ''));
        }
    });

    /// The tag selectors must exist before the URL hash is decoded,
    /// otherwise a shared link cannot restore the tag filters.
    await loadQueryMeta();

    if (window.location.hash) {
        try {
            selectors = decodeState(decodeURIComponent(window.location.hash.substring(1)));
            applyStateDefaults();
        } catch {}
    }

    updateSelectors();
    render();
    prepareExternalLinks();
}

function startBenchmark() {
    initBenchmark().catch(error => {
        console.error('Benchmark initialisation failed:', error);
        const status = document.getElementById('results-status');
        if (status) {
            status.textContent = 'The benchmark data could not be displayed. Check the browser console and confirm the site is being served over HTTP.';
        }
    });
}
