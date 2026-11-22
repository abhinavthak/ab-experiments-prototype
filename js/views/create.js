// New-experiment wizard (GrowthBook's flow, mapped onto pages + variants):
//   Overview → Page & variants → Targeting → Metrics → Analysis → Review.
// Also: "Analyze a past experiment" (import), and the power estimate.
import * as S from "../store.js";
import { openModal, closeModal, icon, variantChip, chip, callout, tagPicker, multiPicker, infoTip } from "../ui.js";
import { esc, slugify, toast, fmtInt, fmtPct, DAY, fmtDate, hash, rng, VARIANT_COLORS, uid } from "../util.js";
import { go } from "../actions.js";
import { sampleSizePerVariant } from "../stats.js";
import { targetingFactor, totals as simTotals } from "../sim.js";
import { conditionEditor, bindConditions, readConditions, HASH_ATTRS, condText, CONDITIONS_INTRO } from "./targeting.js";

export function eligibility(p, exceptId) {
  if (p.status !== "live") return "Draft page";
  if (p.variants.length < 2) return "Only 1 variant";
  const a = S.activeExpOnPage(p.id, exceptId);
  if (a) return a.status === "running" ? "Running experiment" : "Scheduled experiment";
  return "";
}

export function metricOptions(selected, page, { exclude = [], placeholder = "Choose a metric", onlyBinomial = false } = {}) {
  const st = S.get();
  let html = `<option value="">${esc(placeholder)}</option>`;
  S.METRIC_GROUPS.forEach((g) => {
    const ms = st.metrics.filter((m) => m.group === g && !exclude.includes(m.id));
    if (!ms.length) return;
    html += `<optgroup label="${esc(g)}">${ms
      .map((m) => {
        const na = m.requires === "leadForm" && page && !page.hasLeadForm;
        const nb = onlyBinomial && m.type !== "binomial";
        return `<option value="${m.id}" ${m.id === selected ? "selected" : ""} ${na || nb ? "disabled" : ""}>${esc(m.name)}${na ? " — this page has no lead form" : nb ? " — bandits need a conversion metric" : ""}</option>`;
      })
      .join("")}</optgroup>`;
  });
  return html;
}

// Days needed to detect each MDE. Before start: from the page's traffic,
// rollout and targeting, with the metric's usual baseline. Once running: from
// the visitors and Control conversion rate measured in the current phase.
export function powerEstimate(e, mdes = [0.05, 0.1, 0.15, 0.2]) {
  const m = S.metric(e.primaryMetric);
  const p = S.page(e.pageId);
  if (!m || !p) return null;
  const k = Math.max(2, e.variantIds.length);
  let daily = p.traffic * (e.coverage / 100) * targetingFactor(e.targeting, e) * (e.targeting.device === "mobile" ? 0.62 : e.targeting.device === "desktop" ? 0.38 : 1);
  let base = m.base;
  let sd = null;
  let measured = null;
  const ph = S.phasesOf(e);
  if (ph.length && e.status !== "draft" && e.status !== "scheduled") {
    const cur = ph[ph.length - 1];
    const days = Math.max(0, ((cur.end ?? e.endedAt ?? S.now()) - cur.start) / DAY);
    const tot = simTotals(e, { phase: ph.length - 1 });
    const seen = tot.reduce((a, v) => a + v.n, 0);
    const c = tot[0]?.m?.[m.id];
    if (days >= 1 && seen > 0) {
      daily = seen / days;
      measured = { days, seen, perVariant: Math.min(...tot.map((v) => v.n)), baseMeasured: false };
      if (c && c.n >= 200) {
        if (m.type === "binomial" && c.x >= 10) { base = c.x / c.n; measured.baseMeasured = true; }
        else if (m.type !== "binomial" && c.sum != null) {
          const mean = c.sum / c.n;
          if (mean > 0) { base = mean; sd = Math.sqrt(Math.max(0, c.sumSq / c.n - mean * mean)); measured.baseMeasured = true; }
        }
      }
    }
  }
  const alpha = 1 - S.settings().ciLevel;
  // More variants = more comparisons; Bonferroni-style alpha split keeps it honest.
  const a = alpha / (k - 1);
  return { daily, base, metric: m, measured, k, rows: mdes.map((mde) => {
    const n = sampleSizePerVariant(m, mde, { alpha: a, base, sd });
    const daysTotal = Math.ceil((n * k) / Math.max(1, daily));
    const left = measured ? Math.max(0, Math.ceil(((n - measured.perVariant) * k) / Math.max(1, daily))) : null;
    return { mde, n, days: daysTotal, left };
  }) };
}

export function powerTable(e, { compact = false } = {}) {
  const pe = powerEstimate(e);
  if (!pe) return `<div class="faint">Pick a page and a primary metric to estimate how long this will take.</div>`;
  const planned = e.plannedMde ?? 0.1;
  const bin = pe.metric.type === "binomial";
  const fmtBase = (x) => (bin ? fmtPct(x, x < 0.1 ? 2 : 1) : (Math.round(x * 100) / 100).toLocaleString("en-IN"));
  const dur = (d) => (d > 365 ? "> 1 year" : `${d} day${d === 1 ? "" : "s"}`);
  const ms = pe.measured;
  const running = ms && e.status === "running";
  const conf = fmtPct(S.settings().ciLevel, 0);
  const plannedRow = pe.rows.find((r) => Math.abs(r.mde - planned) < 1e-9);
  const example = plannedRow ? `A ${fmtPct(planned, 0)} lift is relative: ${pe.metric.name} going from ${fmtBase(pe.base)} to ${fmtBase(pe.base * (1 + planned))}.` : "";

  const facts = `<div class="plan-facts">
      <div><span class="k">Visitors entering the test</span><b>${fmtInt(pe.daily)} a day</b><span class="faint">${ms ? `measured over ${Math.floor(ms.days)} day${Math.floor(ms.days) === 1 ? "" : "s"}` : "estimated from page traffic, rollout and targeting"}</span></div>
      <div><span class="k">${esc(pe.metric.name)} on Control</span><b>${fmtBase(pe.base)}</b><span class="faint">${ms?.baseMeasured ? "measured so far" : "usual rate for this metric"}</span></div>
      <div><span class="k">Variants</span><b>${pe.k}</b><span class="faint">${conf} confidence · 80% power</span></div>
    </div>`;

  const table = `<table class="t compact"><thead><tr><th>Smallest lift to detect</th><th class="num">Visitors per variant</th><th class="num">Total days</th>${running ? `<th class="num">Days left</th>` : ""}</tr></thead><tbody>
    ${pe.rows.map((r) => `<tr class="${Math.abs(r.mde - planned) < 1e-9 ? "sel" : ""}"><td>${fmtPct(r.mde, 0)}${Math.abs(r.mde - planned) < 1e-9 ? ` <span class="badge blue">planned</span>` : ""}</td><td class="num">${fmtInt(r.n)}</td><td class="num">${dur(r.days)}</td>${running ? `<td class="num"><b>${r.left === 0 ? "Done" : dur(r.left)}</b></td>` : ""}</tr>`).join("")}</tbody></table>
    <div class="hint" style="margin-top:8px">${esc(example)} Smaller lifts need far more visitors: halving the lift needs about 4× the traffic.</div>`;

  const verdict = (() => {
    if (!plannedRow) return "";
    const p = fmtPct(planned, 0);
    if (running) {
      if (plannedRow.left === 0) return callout("good", `This test already has enough visitors to detect a ${p} lift.`);
      const ranFor = Math.floor(ms.days);
      const stopLeft = e.stopAfterDays ? Math.max(0, e.stopAfterDays - ranFor) : null;
      if (stopLeft != null && plannedRow.left > stopLeft) return callout("warn", `About ${dur(plannedRow.left)} more to detect a ${p} lift, but it stops in ${dur(stopLeft)}. Run it longer, raise the rollout or accept a bigger minimum lift.`);
      return callout("info", `About ${dur(plannedRow.left)} more to detect a ${p} lift.`);
    }
    if (ms) return ""; // stopped: the table is for reference
    if (!e.stopAfterDays) return callout("info", `Plan to run it about ${dur(plannedRow.days)} to detect a ${p} lift.`);
    return plannedRow.days > e.stopAfterDays
      ? callout("warn", `Suggestion: to detect a ${p} lift this test needs about ${dur(plannedRow.days)}, but it runs ${e.stopAfterDays} days. Consider running longer, raising the rollout or accepting a bigger lift. You can keep this plan.`)
      : callout("good", `${e.stopAfterDays} days is enough to detect a ${p} lift (needs about ${dur(plannedRow.days)}).`);
  })();
  const line = `<div class="plan-line">${fmtInt(pe.daily)} visitors a day enter the test · ${esc(pe.metric.name)} ${fmtBase(pe.base)} on Control · ${pe.k} variants · ${conf} confidence, 80% power</div>`;
  return compact ? `${verdict}${line}<details class="adv"><summary>Days needed for other lifts</summary><div style="margin-top:10px">${table}</div></details>` : `${facts}${verdict}${table}`;
}

const INFO = {
  overview: ["Experiment details", ["Name: unique and descriptive", "Hypothesis: If we change X, Y will improve because Z", "Owner is notified on launch, stop and results", "Tags help filter the experiments list"]],
  type: ["Testing type", ["A/B: fixed split for the whole run; best for a clean readout", "Bandit: shifts traffic toward the better variant as data comes in; best for short campaigns"]],
  category: ["Category", ["URL vs URL: two separate live pages; visitors are redirected to the variant URL", "Original vs Variant: versions of one CMS page; same URL, content swapped"]],
  pages: ["Pick pages", ["Only published pages can be selected", "Variant URL must be live and return 200", "A page can be in only one running experiment at a time"]],
  split: ["Traffic split", ["Defaults to an equal split", "Must add up to 100%", "Bandit: starting split only; reallocated after launch"]],
  targeting: ["Targeting", ["Audience and device default to All / Both", "Custom conditions, e.g. UTM source or city, are combined with AND", "Narrower targeting = less traffic = longer run"]],
  rollout: ["Rollout %", ["Share of targeted traffic that enters the experiment; the rest sees the original", "Start at 10–20% for risky changes"]],
  metrics: ["Metrics", ["Primary: decides the winner; bandits support conversion metrics only", "Guardrail: must not get worse than its cutoff", "Secondary: context only, not used to pick the winner"]],
  plan: ["Analysis plan", ["Duration: full weeks, minimum 7 days", "Minimum detectable lift: smallest change worth detecting; a smaller lift needs more traffic and time"]],
  fits: ["Suggested duration", "A suggestion, not a rule. It estimates the days needed from traffic, rollout % and lift. If your plan is shorter you can still continue; the test may end with No clear winner."],
  stats: ["Statistic type", ["Bayesian: probability to beat the original; locked for bandits", "Frequentist: p-value and 95% confidence interval"]],
  sequential: ["Sequential testing", ["On: you can check results and stop early safely", "Off: read results only at the planned end date"]],
  review: ["Review", "Summary of every setting; edit any section before creating the draft."],
};
const tip = (k) => infoTip(INFO[k][0], INFO[k][1]);
// Numbered question heading inside a step, in the order of the setup flowchart.
const q = (n, title, k, optional = false, forId = "") => `<div class="q">${forId ? `<label for="${forId}" class="q-in">` : `<span class="q-in">`}<span class="qn">${n}</span><span class="qt">${title}</span>${optional ? `<span class="opt">optional</span>` : ""}${forId ? "</label>" : "</span>"}${k ? tip(k) : ""}</div>`;
const lowerIsBetter = (m) => m?.higherIsBetter === false;
// What a guardrail cutoff means for this metric, e.g. "48.0% → at most 49.4%".
export function cutoffExample(m, c) {
  if (!m) return "";
  const worse = m.base * (lowerIsBetter(m) ? 1 + c : 1 - c);
  const f = (x) => (m.type === "binomial" ? fmtPct(x, x < 0.1 ? 2 : 1) : `${Math.round(x * 100) / 100}${m.unit || ""}`);
  return `${f(m.base)} today → ${lowerIsBetter(m) ? "at most" : "at least"} ${f(worse)}`;
}
export const DURATIONS = [7, 14, 21, 28, 35, 42, 56];
const weeksLabel = (dd) => `${dd / 7} week${dd === 7 ? "" : "s"} (${dd} days)`;

const STEP_HEAD = {
  basics: ["What are you testing?", "Name it and say what you expect to happen."],
  variants: ["How will you test it?", "Choose the testing type, what you compare, and the traffic split."],
  targeting: ["Who's in the test?", "Everyone who visits the page, unless you narrow it down."],
  metrics: ["How will you pick a winner?", "One metric decides. Guardrails catch harm."],
  analysis: ["How long will it run?", "Set the duration and the smallest lift worth detecting, then the statistics."],
  review: ["Check and create", "Creating saves a draft. Nothing goes live until you start it."],
};
const STEPS = [["basics", "Overview"], ["variants", "Type & variants"], ["targeting", "Targeting"], ["metrics", "Metrics"], ["analysis", "Analysis plan"], ["review", "Review"]];

export function openCreate(prefPageId, { type = "standard" } = {}) {
  if (!S.canEdit()) {
    toast("You need Editor access to create experiments", "bad");
    return;
  }
  const st = S.get();
  const d = S.newExperimentDraft();
  d.type = type;
  const pages = [...st.pages].sort((a, b) => (eligibility(a) ? 1 : 0) - (eligibility(b) ? 1 : 0));
  const firstOk = (prefPageId && S.page(prefPageId)?.status === "live" && prefPageId) || pages.find((p) => !eligibility(p))?.id || null;
  const evenWeights = (n) => Array.from({ length: n }, (_, i) => (i === 0 ? 100 - Math.floor(100 / n) * (n - 1) : Math.floor(100 / n)));
  const KEYS = "ABCDE";
  // Split URL: A is the chosen page's own URL; B.. are URLs visitors get redirected to.
  const urlRows = () => d.urlVariants || [];
  const syncUrl = () => {
    const p = S.page(d.pageId);
    if (!d.urlVariants?.length) d.urlVariants = [{ id: uid("uv"), key: "A", name: "Original", url: "", changes: 0 }, { id: uid("uv"), key: "B", name: "", url: "", changes: 1 }];
    d.urlVariants[0] = { ...d.urlVariants[0], name: "Original", url: p?.path || "" };
    d.urlVariants.forEach((v, i) => (v.key = KEYS[i]));
    d.variantIds = d.urlVariants.map((v) => v.id);
    if (d.weights.length !== d.variantIds.length) d.weights = evenWeights(d.variantIds.length);
  };
  const setPage = (pid) => {
    const p = S.page(pid);
    d.pageId = pid;
    if (!p) return;
    if (d.testKind === "url") return syncUrl();
    d.variantIds = [p.defaultVariantId, ...p.variants.filter((v) => v.id !== p.defaultVariantId).map((v) => v.id)];
    d.weights = evenWeights(d.variantIds.length);
  };
  const urlStep = () => {
    const rows = urlRows();
    const bandit = d.type === "bandit";
    const weight = (v, i) => (`<div class="pct-input"><input class="inp" type="number" min="0" max="100" name="w-${v.id}" value="${d.weights[i] ?? 0}" aria-label="Split for ${v.key}"><span>%</span></div>`);
    const paths = st.pages.filter((x) => x.id !== d.pageId).map((x) => `<option value="${esc(x.path)}">${esc(x.name)}</option>`).join("");
    const last = rows[rows.length - 1]?.key;
    return `<div class="field">${q(4, `Variant URLs &amp; ${bandit ? "starting split" : "traffic split"}`, "split")}
      <datalist id="cms-paths">${paths}</datalist>
      ${rows.map((v, i) => i === 0
        ? `<div class="url-row">${chip(0)}<div class="url-main"><b>Original</b> <span class="badge">Control</span><div class="small mono" style="margin:2px 0 0">${esc(v.url)}</div></div>${weight(v, i)}<span></span></div>`
        : `<div class="url-row">${chip(i)}<div class="url-main url-inputs"><input class="inp mono" name="uurl-${i}" list="cms-paths" value="${esc(v.url)}" placeholder="/new-landing-page or https://…" aria-label="URL for ${v.key}" autocomplete="off"><input class="inp" name="uname-${i}" value="${esc(v.name)}" placeholder="Name, e.g. Redesigned page" aria-label="Name for ${v.key}"></div>${weight(v, i)}${rows.length > 2 ? `<button type="button" class="btn xs ghost" data-local="u-del" data-i="${i}" aria-label="Remove ${v.key}">${icon.x(16)}</button>` : "<span></span>"}</div><div data-err="uurl-${i}"></div>`).join("")}
      <div class="row" style="justify-content:space-between;margin-top:10px"><div class="row" style="gap:8px">${rows.length < 5 ? `<button type="button" class="btn xs" data-local="u-add">${icon.plus(14)} Add URL</button>` : ""}<button type="button" class="btn xs" data-local="even">Split evenly</button></div><b data-total>Total ${Math.round(d.weights.reduce((a, b) => a + Number(b || 0), 0))}%</b></div>${bandit ? `<div class="hint">Bandit: this is the starting split. After launch, traffic is reallocated daily toward the better URL (never below 2%).</div>` : ""}
      <div data-err="split"></div>
      <div class="hint">Choose another CMS page from the list or paste any URL. Visitors assigned to ${rows.length > 2 ? `B–${last}` : "B"} get a temporary (302) redirect and keep their UTM parameters. Each URL must be live (return 200) and have the lead form so conversions are counted.</div></div>`;
  };
  setPage(firstOk);
  let step = 0;
  let seen = 0;
  let keyTouched = false;
  const completed = new Set(); // steps the user has passed with Next
  let dirty = false;

  const cutRows = () => d.guardrailMetrics.map((mid) => {
    const m = S.metric(mid);
    if (!m) return "";
    const c = d.guardrailCutoffs?.[mid] ?? m.guardrailCutoff ?? 0.02;
    return `<div class="gc-row"><b>${esc(m.name)}</b><span class="gc-mid">may get ${lowerIsBetter(m) ? "higher" : "lower"} by at most</span><div class="pct-input"><input class="inp" type="number" name="gc-${mid}" min="0.5" max="50" step="0.5" value="${Math.round(c * 1000) / 10}" aria-label="Cutoff for ${esc(m.name)}"><span>%</span></div><span class="gc-ex" data-gc-ex="${mid}">${esc(cutoffExample(m, c))}</span></div>`;
  }).join("");
  const steps = {
    basics: () => {
      const cfs = st.customFields;
      const needCf = cfs.some((f) => f.required);
      return `
      <div class="field"><label for="c-name">Name ${tip("overview")}</label><input id="c-name" name="name" class="inp" autocomplete="off" value="${esc(d.name)}" placeholder="e.g. Online BBA — banner &amp; sticky CTA">
        <div class="key-line">Tracking key <span class="mono" data-keytext>${esc(d.trackingKey) || "—"}</span> <button type="button" class="link-btn" data-local="key-edit">Edit</button></div><div data-err="name"></div></div>
      <div class="field" data-keyfield ${keyTouched ? "" : "hidden"}><label for="c-key">Tracking key</label><input id="c-key" name="key" class="inp mono" autocomplete="off" value="${esc(d.trackingKey)}"><div class="hint">Sent with every exposure and lead. Lowercase letters, numbers and hyphens. Locked once started.</div><div data-err="key"></div></div>
      <div class="field"><label for="c-hyp">Hypothesis ${st.settings.requireHypothesis ? "" : `<span class="opt">· optional</span>`}</label><textarea id="c-hyp" name="hypothesis" class="inp" rows="3" placeholder="If we … then … because …">${esc(d.hypothesis)}</textarea><div data-err="hypothesis"></div></div>
      <div class="row"><div class="grow field"><label for="c-owner">Owner</label><select id="c-owner" name="owner" class="inp">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === d.ownerId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
        <div class="grow field"><label for="c-tags">Tags <span class="opt">· optional</span></label>${tagPicker({ id: "c-tags", selected: d.tags })}</div></div>
      <details class="adv" ${needCf || d.description ? "open" : ""}><summary>More details <span class="opt">· description${cfs.length ? `, ${cfs.map((f) => esc(f.name.toLowerCase())).join(", ")}` : ""}</span></summary>
        <div style="margin-top:12px"><div class="field"><label for="c-desc">Description <span class="opt">· optional</span></label><textarea id="c-desc" name="description" class="inp" rows="2">${esc(d.description)}</textarea></div>
        ${customFieldInputs(d)}</div></details>`;
    },
    variants: () => {
      const p = S.page(d.pageId);
      const vs = p ? S.variantsOf(d) : [];
      const isUrl = d.testKind === "url";
      const typeCards = `<div class="field">${q(1, "Testing type", "type")}<div class="type-cards compact" role="radiogroup" aria-label="Testing type">
        ${[["standard", "A/B test", "Fixed split for the whole run; a clean readout."], ["bandit", "Multi-armed bandit", "Shifts traffic toward the better variant as data comes in."]]
          .map(([k, t, sub]) => `<label class="check ${d.type === k ? "on" : ""}"><input type="radio" name="type" value="${k}" ${d.type === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${sub}</span></span></label>`).join("")}</div></div>`;
      const kindCards = typeCards + `<div class="field">${q(2, "Category of testing", "category")}<div class="type-cards compact" role="radiogroup" aria-label="What are you comparing">
        ${[["variants", "Original vs variant", "Same URL; the CMS swaps sections of the page."], ["url", "URL vs URL", "Split URL; some visitors are redirected to another page."]]
          .map(([k, t, sub]) => `<label class="check ${d.testKind === k ? "on" : ""}"><input type="radio" name="kind" value="${k}" ${d.testKind === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${sub}</span></span></label>`).join("")}</div></div>`;
      const pageWhy = (x) => {
        if (isUrl) {
          const a = S.activeExpOnPage(x.id, d.id);
          return x.status !== "live" ? "draft page, publish first" : a ? `${a.status} experiment` : x.path;
        }
        if (x.status !== "live") return "draft page, publish first";
        const why = eligibility(x);
        return why ? why.toLowerCase() : `${x.variants.length} variants`;
      };
      const pageField = `<div class="field">${q(3, isUrl ? "Original page (A, Control)" : "Page to test", "pages", false, "c-page")}
        <select id="c-page" name="page" class="inp"><option value="">Choose a published page</option>${pages.map((x) => `<option value="${x.id}" ${x.id === d.pageId ? "selected" : ""} ${x.status !== "live" ? "disabled" : ""}>${esc(x.name)} — ${esc(pageWhy(x))}</option>`).join("")}</select>`;
      const conflict = (() => {
        if (!p) return "";
        const other = S.activeExpOnPage(p.id, d.id);
        if (other) return callout("warn", `“${esc(other.name)}” is ${other.status} on this page. You can set this up now as a draft and start it once that one ends.`);
        return "";
      })();
      if (isUrl) return `${kindCards}${pageField}
        ${p ? `<div class="hint">Visitors land on <span class="mono">${esc(p.path)}</span>. A stays there; the others are redirected.</div>` : ""}<div data-err="page"></div></div>
        ${conflict}${p ? urlStep() : ""}`;
      return `${kindCards}${pageField}
        ${p ? `<div class="hint mono">${esc(p.path)}</div>` : ""}<div data-err="page"></div></div>
      ${conflict}
      ${!p ? "" : p.variants.length < 2 ? "" : `<div class="field">${q(4, `Variants &amp; ${d.type === "bandit" ? "starting split" : "traffic split"}`, "split")}
        ${p.variants.map((v) => {
          const i = d.variantIds.indexOf(v.id);
          const on = i >= 0;
          const isDef = v.id === p.defaultVariantId;
          return `<div class="var-row">${variantChip(v)}<label class="row" style="gap:8px;min-width:0;cursor:${isDef ? "default" : "pointer"}"><input type="checkbox" name="variant" value="${v.id}" ${on ? "checked" : ""} ${isDef ? "disabled" : ""} style="accent-color:var(--primary)"><span><b>${esc(v.name)}</b>${isDef ? ` <span class="badge">Control · page default</span>` : ""}<span class="small" style="display:block;margin:2px 0 0">${isDef ? `What everyone sees today · ${p.sections} sections` : `${v.changes} change${v.changes === 1 ? "" : "s"} vs default`}</span></span></label>
            <div class="pct-input"><input class="inp" type="number" min="0" max="100" name="w-${v.id}" value="${on ? d.weights[i] : 0}" ${on ? "" : "disabled"} aria-label="Split for ${esc(v.key)}"><span>%</span></div><span></span></div>`;
        }).join("")}
        <div class="row" style="justify-content:space-between;margin-top:10px"><button type="button" class="btn xs" data-local="even">Split evenly</button><b data-total>Total ${Math.round(d.weights.reduce((a, b) => a + Number(b || 0), 0))}%</b></div>
        ${d.type === "bandit" ? `<div class="hint">Bandit: this is the starting split. After launch, traffic is reallocated daily toward the better variant (never below 2%).</div>` : ""}
        <div data-err="variants"></div><div data-err="split"></div>
        <a href="#/page/${p.id}" data-act="modal-close-nav" class="hint" style="display:inline-block">Create or edit variants in the page editor →</a></div>`}
      ${p && p.variants.length < 2 ? `<div style="border:1px dashed var(--text-4);border-radius:12px;padding:24px;text-align:center"><b>${esc(p.name)} has only its default variant</b><div class="muted" style="margin:6px 0 14px">Create at least one more variant in the page editor, then come back.</div><a class="btn sm" href="#/page/${p.id}" data-act="modal-close-nav">${icon.ext()} Open page editor</a></div>` : ""}`;
    },
    targeting: () => {
      const t = d.targeting;
      const hashLabel = HASH_ATTRS.find(([k]) => k === d.assignment.hashAttribute)?.[1] || "";
      return `<div class="field">${q(1, "Audience and device", "targeting")}
        <div class="row"><div class="grow"><label class="sub-l" for="c-aud">Audience</label><select id="c-aud" name="audience" class="inp">${[["all", "All visitors"], ["new", "New visitors"], ["returning", "Returning visitors"]].map(([k, l]) => `<option value="${k}" ${t.audience === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow"><label class="sub-l" for="c-dev">Device</label><select id="c-dev" name="device" class="inp">${[["all", "Mobile and desktop"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]].map(([k, l]) => `<option value="${k}" ${t.device === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div></div>
      <div class="field">${q(2, "Custom conditions", "", true)}<div class="hint" style="margin:0 0 10px">e.g. UTM source or city. Visitors must match every rule.</div>${conditionEditor(t.conditions || [], { prefix: "cond" })}</div>
      <div class="field">${q(3, "Rollout", "rollout", false, "c-cov")}
        <div class="row" style="align-items:center"><div class="pct-input" style="width:140px"><input id="c-cov" name="coverage" type="number" min="1" max="100" class="inp" value="${d.coverage}"><span>%</span></div><div class="reach grow" data-reach style="margin:0"></div></div><div data-err="coverage"></div></div>
      <details class="adv"><summary>Advanced <span class="opt">· ${t.excludeLeads ? "excluding existing leads · " : ""}assigned by ${esc(hashLabel.toLowerCase())}${d.assignment.sticky ? ", sticky" : ""}</span></summary>
        <label class="check" style="margin:12px 0"><input type="checkbox" name="excludeLeads" ${t.excludeLeads ? "checked" : ""}><span><span class="t1">Exclude existing leads</span><span class="t2">Visitors who already submitted a form on this page see Control</span></span></label>
        <div class="row"><div class="grow field"><label for="c-hash">Assign variants by</label><select id="c-hash" name="hash" class="inp">${HASH_ATTRS.map(([k, l]) => `<option value="${k}" ${d.assignment.hashAttribute === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="grow field"><label for="c-fb">Fallback <span class="opt">· if missing</span></label><select id="c-fb" name="fallback" class="inp"><option value="">None (skip the visitor)</option>${HASH_ATTRS.filter(([k]) => k !== d.assignment.hashAttribute).map(([k, l]) => `<option value="${k}" ${d.assignment.fallback === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
        <label class="check"><input type="checkbox" name="sticky" ${d.assignment.sticky ? "checked" : ""}><span><span class="t1">Sticky bucketing</span><span class="t2">Keep visitors in their variant even if the split or targeting changes later</span></span></label></details>`;
    },
    metrics: () => {
      const p = S.page(d.pageId);
      const opts = st.metrics.filter((m) => !(m.requires === "leadForm" && p && !p.hasLeadForm)).map((m) => [m.id, m.name]);
      return `<div class="field">${q(1, d.type === "bandit" ? "Decision metric" : "Primary metric", "metrics", false, "c-primary")}<select id="c-primary" name="primary" class="inp">${metricOptions(d.primaryMetric, p, { onlyBinomial: d.type === "bandit" })}</select><div class="hint">The one number that decides the winner.${d.type === "bandit" ? " Bandits support conversion metrics only." : ""}</div><div data-err="primary"></div></div>
        <div class="field">${q(2, "Guardrail metrics and cutoffs", "", true, "c-guard")}${multiPicker({ id: "c-guard", name: "guardrail", options: opts, selected: d.guardrailMetrics, placeholder: "Add a guardrail, e.g. Bounce rate" })}
          <div class="hint">For each guardrail, decide how much worse it may get before it blocks a winner.</div>
          <div class="guard-cuts" data-guard-cuts>${cutRows()}</div><div data-err="gc"></div></div>
        <div class="field">${q(3, "Secondary metrics", "", true, "c-sec")}${multiPicker({ id: "c-sec", name: "secondary", options: opts, selected: d.secondaryMetrics, placeholder: "Add metrics" })}<div class="hint">Context only; not used to pick the winner.</div></div>
        <details class="adv" ${d.activationMetric ? "open" : ""}><summary>Activation metric <span class="opt">· optional</span></summary>
          <div class="field" style="margin:12px 0 0"><label class="sr-only" for="c-act">Activation metric</label><select id="c-act" name="activation" class="inp">${metricOptions(d.activationMetric, p, { placeholder: "None · count every visitor" })}</select><div class="hint">Only analyse visitors who did this, e.g. scrolled to the fee section.</div></div></details>`;
    },
    analysis: () => {
      const bandit = d.type === "bandit";
      const pe = powerEstimate(d);
      const row = pe?.rows.find((r) => Math.abs(r.mde - d.plannedMde) < 1e-9);
      const short = row && row.days > d.stopAfterDays;
      const fixes = (() => {
        if (!short) return "";
        const out = [];
        const dur = DURATIONS.find((x) => x >= row.days);
        if (dur) out.push(`<button type="button" class="btn xs" data-local="plan-fix" data-stop="${dur}">Run ${weeksLabel(dur)}</button>`);
        const lift = pe.rows.find((r) => r.mde > d.plannedMde && r.days <= d.stopAfterDays);
        if (lift) out.push(`<button type="button" class="btn xs" data-local="plan-fix" data-mde="${lift.mde}">Detect a ${fmtPct(lift.mde, 0)} lift instead</button>`);
        if (d.coverage < 100) out.push(`<button type="button" class="btn xs" data-goto="2">Raise rollout (now ${d.coverage}%)</button>`);
        return `<div class="plan-fix"><span class="faint" style="font-size:13px;align-self:center">Optional fixes:</span>${out.join("")}</div>`;
      })();
      return `<div class="field">${q(1, "Duration and minimum detectable lift", "plan")}<div class="row"><div class="grow"><label class="sub-l" for="c-stop">Experiment duration</label><select id="c-stop" name="stop" class="inp">${DURATIONS.map((o) => `<option value="${o}" ${o === d.stopAfterDays ? "selected" : ""}>${weeksLabel(o)}</option>`).join("")}</select></div>
        <div class="grow"><label class="sub-l" for="c-mde">Minimum detectable lift</label><select id="c-mde" name="mde" class="inp">${[0.05, 0.1, 0.15, 0.2].map((m) => `<option value="${m}" ${Math.abs(m - d.plannedMde) < 1e-9 ? "selected" : ""}>${fmtPct(m, 0)}</option>`).join("")}</select></div></div></div>
      <div class="field">${q(2, "Suggested duration", "fits", true)}
      ${powerTable(d, { compact: true })}
      <div data-err="plan"></div>
      ${fixes}</div>
      <div class="field">${q(3, "Statistic type", "stats")}<div class="type-cards compact stat-cards">${[["bayesian", "Bayesian", "Probability to beat the original, and risk"], ["frequentist", "Frequentist", "p-value and 95% confidence interval"]].map(([k, t, sub]) => {
        const off = bandit && k === "frequentist";
        return `<label class="check ${d.statsEngine === k ? "on" : ""} ${off ? "disabled" : ""}"><input type="radio" name="engine" value="${k}" ${d.statsEngine === k ? "checked" : ""} ${off ? "disabled" : ""}><span><span class="t1">${t}</span><span class="t2">${off ? "Not available for bandits" : sub}</span></span></label>`;
      }).join("")}</div>${bandit ? `<div class="hint">Bandits always use Bayesian.</div>` : ""}</div>
      ${d.statsEngine === "frequentist" ? `<label class="check"><input type="checkbox" name="sequential" ${d.sequential ? "checked" : ""}><span><span class="t1">Enable sequential testing ${tip("sequential")}</span><span class="t2">${d.sequential ? "On: you can check results and stop early safely." : "Off: read results only at the planned end date."}</span></span></label>` : ""}`;
    },
    review: () => {
      const p = S.page(d.pageId);
      const vs = p ? S.variantsOf(d) : [];
      const t = d.targeting;
      const mName = (id) => esc(S.metric(id)?.name || "");
      const none = (txt = "None") => `<span class="faint">${txt}</span>`;
      const sec = (title, i, body, cls = "") => `<section class="rv-sec ${cls}"><div class="rv-h"><h3>${title}</h3><button type="button" class="link-btn" data-goto="${i}">Edit</button></div>${body}</section>`;
      const kv = (k, v) => `<div class="rv-kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
      const color = (v) => VARIANT_COLORS[Math.max(0, v.key.charCodeAt(0) - 65) % VARIANT_COLORS.length];
      const who = [t.audience !== "all" ? `${t.audience === "new" ? "New" : "Returning"} visitors` : "", t.device !== "all" ? `${t.device === "mobile" ? "Mobile" : "Desktop"} only` : "", ...(t.conditions || []).map(condText), t.excludeLeads ? "Excluding existing leads" : ""].filter(Boolean);
      const pe = powerEstimate(d);
      const prow = pe?.rows.find((r) => Math.abs(r.mde - d.plannedMde) < 1e-9);
      const owner = S.USERS.find((u) => u.id === d.ownerId)?.name || "";

      const checks = S.startChecks(d);
      const fix = checks.items.filter((x) => !x.ok && !x.manual);
      const todo = checks.items.filter((x) => x.manual && (!x.ok || x.warn));
      const warns = checks.items.filter((x) => x.warn && !x.manual);
      const passed = checks.items.filter((x) => x.ok && !x.warn);
      const li = (x, cls, ic) => `<li class="${cls}"><span class="ic" aria-hidden="true">${ic}</span><span>${esc(x.label)}${x.optional ? ` <span class="faint">· optional</span>` : ""}${cls === "bad" && x.fix ? `<span class="rv-fix">${esc(x.fix)}</span>` : ""}</span></li>`;

      return `<div class="rv">
        <div class="rv-hero">
          <div class="rv-title">${esc(d.name)}</div>
          <div class="rv-meta"><span class="badge ${d.type === "bandit" ? "blue" : ""}">${d.type === "bandit" ? "Multi-armed bandit" : "A/B test"}</span><span class="mono">${esc(d.trackingKey)}</span></div>
        </div>
        ${fix.length ? callout("bad", `<b>${fix.length} ${fix.length === 1 ? "thing" : "things"} to fix before this can start.</b> You can still save it as a draft.`) : ""}

        <div class="rv-grid">
          ${sec("Overview", 0, `<p class="rv-hyp">${d.hypothesis ? esc(d.hypothesis) : none("No hypothesis")}</p>
            ${kv("Owner", esc(owner))}
            ${kv("Tags", d.tags.length ? d.tags.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ") : none())}`)}

          ${sec(d.testKind === "url" ? "URLs" : "Page &amp; variants", 1, `<div class="rv-page">${esc(p?.name || "")} <span class="mono faint">${esc(p?.path || "")}</span>${d.testKind === "url" ? `<div class="faint small" style="margin:2px 0 0">Split URL · B${vs.length > 2 ? `–${vs[vs.length - 1].key}` : ""} redirect from here</div>` : ""}</div>
            ${d.type === "bandit" ? "" : `<div class="rv-split" aria-hidden="true">${vs.map((v, i) => `<span style="flex:${Number(d.weights[i]) || 0};background:${color(v)}"></span>`).join("")}</div>`}
            <ul class="rv-vars">${vs.map((v, i) => `<li>${variantChip(v, true)}<span class="grow">${esc(v.name)}${i === 0 ? ` <span class="faint">· control</span>` : ""}${d.testKind === "url" ? `<span class="mono faint" style="display:block;font-size:12.5px;overflow-wrap:anywhere">${esc(v.url)}</span>` : ""}</span><b>${d.type === "bandit" ? "auto" : `${d.weights[i]}%`}</b></li>`).join("")}</ul>
            ${d.type === "bandit" ? `<div class="hint">Traffic shifts daily toward the best variant.</div>` : ""}`)}

          ${sec("Targeting", 2, `${kv("Who", who.length ? who.map(esc).join("<br>") : "All visitors")}
            ${kv("Rollout", `${d.coverage}% of eligible visitors`)}
`)}

          ${sec("Metrics", 3, `${kv("Primary", d.primaryMetric ? `<b>${mName(d.primaryMetric)}</b>` : `<span class="down">Not selected</span>`)}
            ${kv("Secondary", d.secondaryMetrics.length ? d.secondaryMetrics.map(mName).join(", ") : none())}
            ${kv("Guardrails", d.guardrailMetrics.length ? d.guardrailMetrics.map((m) => `${mName(m)} <span class="faint">(≤ ${fmtPct(d.guardrailCutoffs?.[m] ?? S.metric(m)?.guardrailCutoff ?? 0.02, 1).replace(".0%", "%")} worse)</span>`).join("<br>") : none())}
            ${d.activationMetric ? kv("Activation", mName(d.activationMetric)) : ""}`)}

          ${sec("Analysis", 4, `${kv("Statistics", `${d.statsEngine === "bayesian" ? "Bayesian" : `Frequentist${d.sequential ? ", sequential" : ""}`}${d.cuped ? " · CUPED" : ""}`)}
            ${kv("Stops", d.stopAfterDays ? `After ${d.stopAfterDays} days` : "Manually")}
            ${prow ? kv("Estimate", `~${prow.days} days to detect a ${fmtPct(d.plannedMde, 0)} lift${d.stopAfterDays && prow.days > d.stopAfterDays ? ` <span class="badge amber">longer than the stop date</span>` : ""}`) : ""}`)}

          <section class="rv-sec">
            <div class="rv-h"><h3>Launch checklist</h3><span class="faint small">${passed.length} of ${checks.items.length} done</span></div>
            ${fix.length || warns.length || todo.length ? `<ul class="rv-checks">${fix.map((x) => li(x, "bad", "✕")).join("")}${warns.map((x) => li(x, "warn", "!")).join("")}${todo.map((x) => li(x, "todo", "")).join("")}</ul>` : `<p style="margin:0;color:var(--up)">All checks pass.</p>`}
            ${todo.length ? `<div class="hint">Manual checks are ticked on the experiment's Overview after you create it.</div>` : ""}
            ${passed.length ? `<details class="rv-passed"><summary>${passed.length} passed</summary><ul class="rv-checks">${passed.map((x) => li(x, "ok", "✓")).join("")}</ul></details>` : ""}
          </section>
        </div>
        <p class="hint" style="margin:12px 0 0">Creating saves a draft. You can start or schedule it from its page.</p>
      </div>`;
    },
  };

  const summary = (k) => {
    const t = d.targeting;
    if (k === "basics") return d.name;
    if (k === "variants") return `${d.type === "bandit" ? "Bandit" : "A/B test"} · ${d.testKind === "url" ? "URL vs URL" : "Original vs variant"}`;
    if (k === "targeting") return `${t.audience === "all" ? "All visitors" : t.audience === "new" ? "New visitors" : "Returning"} · ${t.device === "all" ? "all devices" : t.device} · ${d.coverage}%`;
    if (k === "metrics") return S.metric(d.primaryMetric)?.name || "";
    if (k === "analysis") return `${d.stopAfterDays / 7} wk · ${fmtPct(d.plannedMde, 0)} lift · ${d.statsEngine === "bayesian" ? "Bayesian" : "Frequentist"}`;
    return "";
  };
  const stepper = () => `<ol class="stepper">${STEPS.map(([k, l], i) => {
    const sm = i !== step && i <= seen ? summary(k) : "";
    return `<li class="${i === step ? "on" : i < step || i <= seen ? "done" : ""}"><button type="button" data-goto="${i}" ${i <= seen ? "" : "disabled"}><span class="n">${i < step ? "✓" : i + 1}</span><span class="st"><span class="sl">${l}</span>${sm ? `<span class="ss">${esc(sm)}</span>` : ""}</span></button></li>`;
  }).join("")}</ol>`;
  const footer = () => `<button type="button" class="btn sm" data-local="cancel">Cancel</button><span style="flex:1"></span>${step > 0 ? `<button type="button" class="btn sm" data-local="back">Back</button>` : ""}${step < STEPS.length - 1 ? `<button type="submit" class="btn sm primary" value="next">Next: ${STEPS[step + 1][1]}</button>` : `<button type="submit" class="btn sm primary" value="create">Create draft</button>`}`;

  // Read the current step's fields into d. Returns an errors map.
  const collect = (form) => {
    const k = STEPS[step][0];
    const fd = new FormData(form);
    const errs = {};
    if (k === "basics") {
      d.type = fd.get("type") || d.type;
      d.name = String(fd.get("name") || "").trim();
      d.trackingKey = String(fd.get("key") || "").trim();
      d.hypothesis = String(fd.get("hypothesis") || "").trim();
      d.description = String(fd.get("description") || "").trim();
      d.tags = String(fd.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      d.ownerId = fd.get("owner");
      st.customFields.forEach((f) => (d.customFields[f.id] = String(fd.get(`cf-${f.id}`) || "").trim()));
      if (!d.name) errs.name = "Enter a name";
      if (!d.trackingKey) errs.key = "Enter a tracking key";
      else if (!/^[a-z0-9-]+$/.test(d.trackingKey)) errs.key = "Lowercase letters, numbers and hyphens only";
      else {
        const clash = st.experiments.find((x) => x.trackingKey === d.trackingKey);
        if (clash) errs.key = `Already used by “${clash.name}”`;
      }
      if (st.settings.requireHypothesis && !d.hypothesis) errs.hypothesis = "Your settings require a hypothesis";
      st.customFields.filter((f) => f.required).forEach((f) => !d.customFields[f.id] && (errs[`cf-${f.id}`] = `Enter ${f.name}`));
    } else if (k === "variants") {
      const p = S.page(d.pageId);
      d.testKind = fd.get("kind") || d.testKind;
      d.type = fd.get("type") || d.type;
      if (!p) errs.page = "Choose a page";
      else if (p.status !== "live") errs.page = "Only published pages can be tested. Publish this page first.";
      else if (d.testKind === "url") {
        syncUrl();
        const rows = d.urlVariants;
        const norm = (u) => u.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
        rows.forEach((v, i) => {
          if (i === 0) return;
          if (fd.has(`uurl-${i}`)) v.url = String(fd.get(`uurl-${i}`)).trim();
          if (fd.has(`uname-${i}`)) v.name = String(fd.get(`uname-${i}`)).trim();
          if (!v.name && v.url) v.name = st.pages.find((x) => x.path === v.url)?.name || "";
          if (!v.url) errs[`uurl-${i}`] = "Enter a URL";
          else if (!/^(\/|https?:\/\/)/.test(v.url)) errs[`uurl-${i}`] = "Start with / for a page on this site, or https:// for another site";
          else if (norm(v.url) === norm(rows[0].url)) errs[`uurl-${i}`] = "That's the original page's URL. Variants need a different URL.";
          else if (rows.slice(1, i).some((x) => norm(x.url) === norm(v.url))) errs[`uurl-${i}`] = "Same URL as another variant";
        });
        rows.forEach((v, i) => { if (i > 0 && !v.name) v.name = `URL ${v.key}`; });
        rows.forEach((v, i) => {
          if (i === 0 || errs[`uurl-${i}`] || !v.url.startsWith("/")) return;
          const pg = st.pages.find((x) => norm(x.path) === norm(v.url));
          if (!pg) errs[`uurl-${i}`] = "No published CMS page at this URL. Publish it first, or use a full https:// address.";
          else if (pg.status !== "live") errs[`uurl-${i}`] = `${pg.name} is a draft. Only published pages can be used.`;
        });
        d.weights = rows.map((v) => Number(fd.get(`w-${v.id}`)) || 0);
        const sum = Math.round(d.weights.reduce((a, b) => a + b, 0));
        if (sum !== 100) errs.split = `The split adds up to ${sum}%, not 100%`;
        else if (d.weights.some((w) => w <= 0)) errs.split = "Every URL needs some traffic";
      } else if (p.variants.length < 2) errs.page = "This page has only its default variant. Add a variant in the page editor first.";
      else {
        const picked = fd.getAll("variant");
        const ids = [p.defaultVariantId, ...p.variants.filter((v) => picked.includes(v.id)).map((v) => v.id)];
        d.variantIds = ids;
        d.weights = ids.map((id) => Number(fd.get(`w-${id}`)) || 0);
        if (ids.length < 2) errs.variants = "Select at least one variant besides Control";
        else if (Math.round(d.weights.reduce((a, b) => a + b, 0)) !== 100) errs.split = `The split adds up to ${Math.round(d.weights.reduce((a, b) => a + b, 0))}%, not 100%`;
        else if (d.weights.some((w) => w <= 0)) errs.split = "Every variant needs some traffic";
      }
    } else if (k === "targeting") {
      d.targeting = { audience: fd.get("audience"), device: fd.get("device"), excludeLeads: !!fd.get("excludeLeads"), conditions: readConditions(form, "cond") };
      d.coverage = Number(fd.get("coverage"));
      if (!(d.coverage >= 1 && d.coverage <= 100)) errs.coverage = "Enter 1–100";
      d.assignment = { hashAttribute: fd.get("hash"), fallback: fd.get("fallback") || "", sticky: !!fd.get("sticky") };
    } else if (k === "metrics") {
      d.primaryMetric = fd.get("primary") || null;
      const list = (n) => String(fd.get(n) || "").split(",").filter((m) => m && m !== d.primaryMetric);
      d.secondaryMetrics = list("secondary");
      d.guardrailMetrics = list("guardrail");
      d.activationMetric = fd.get("activation") || null;
      d.guardrailCutoffs = Object.fromEntries(d.guardrailMetrics.map((mid) => {
        const raw = fd.get(`gc-${mid}`);
        const v = raw == null || raw === "" ? (d.guardrailCutoffs?.[mid] ?? S.metric(mid)?.guardrailCutoff ?? 0.02) : Number(raw) / 100;
        if (!(v >= 0.005 && v <= 0.5)) errs.gc = "Set each guardrail cutoff between 0.5% and 50%";
        return [mid, v];
      }));
      if (!d.primaryMetric) errs.primary = "Choose a primary metric";
    } else if (k === "analysis") {
      d.statsEngine = d.type === "bandit" ? "bayesian" : fd.get("engine") || d.statsEngine;
      d.sequential = d.statsEngine === "frequentist" && !!fd.get("sequential");
      d.stopAfterDays = Number(fd.get("stop")) || 21;
      d.plannedMde = Number(fd.get("mde"));
    }
    return errs;
  };

  const showErrs = (form, errs) => {
    if (errs.key) form.querySelector("[data-keyfield]")?.removeAttribute("hidden");
    form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
    const first = Object.keys(errs)[0];
    if (first) form.querySelector(`[data-err="${first}"]`)?.closest(".field")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return !!first;
  };

  let formRef = null;
  // Live preview panel: rebuilt from the draft as the user types.
  const side = () => {
    const p = S.page(d.pageId);
    const t = d.targeting;
    const vs = p ? S.variantsOf(d) : [];
    const color = (i) => VARIANT_COLORS[i % VARIANT_COLORS.length];
    const devShare = t.device === "mobile" ? 0.62 : t.device === "desktop" ? 0.38 : 1;
    const traffic = p?.traffic || 0;
    const eligible = traffic * targetingFactor(t, d) * devShare;
    const inTest = eligible * (Number(d.coverage) || 0) / 100;
    const pct = (x) => `${Math.max(2, Math.min(100, traffic ? (x / traffic) * 100 : 0))}%`;
    const wsum = d.weights.reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    const flow = !p ? `<div class="wz-empty">Pick a page in step 2 to see how many visitors this test reaches.</div>` : `
      <div class="wz-flow">
        <div class="wz-fr"><span>Visit the page</span><b>${fmtInt(traffic)}/day</b></div><div class="wz-bar"><i style="width:100%"></i></div>
        <div class="wz-fr"><span>Match targeting</span><b>${fmtInt(eligible)}/day</b></div><div class="wz-bar"><i style="width:${pct(eligible)}"></i></div>
        <div class="wz-fr"><span>Enter the test · ${Number(d.coverage) || 0}% rollout</span><b>${fmtInt(inTest)}/day</b></div><div class="wz-bar"><i class="on" style="width:${pct(inTest)}"></i></div>
        <div class="wz-split">${vs.map((v, i) => `<i style="flex:${Math.max(0, Number(d.weights[i]) || 0)};background:${color(Math.max(0, v.key.charCodeAt(0) - 65))}"></i>`).join("")}</div>
        <ul class="wz-vars">${vs.map((v, i) => `<li><span class="dot" style="background:${color(Math.max(0, v.key.charCodeAt(0) - 65))}"></span><b>${esc(v.key)}</b><span class="grow">${esc(v.name || (d.testKind === "url" ? v.url || "URL not set" : ""))}</span><span class="faint">${d.type === "bandit" ? "start " : ""}${Math.round(((Number(d.weights[i]) || 0) / wsum) * 100)}% · ~${fmtInt(inTest * (Number(d.weights[i]) || 0) / wsum)}/day</span></li>`).join("")}</ul>
      </div>`;
    const pm = S.metric(d.primaryMetric);
    const pe = powerEstimate(d);
    const row = pe?.rows.find((r) => Math.abs(r.mde - d.plannedMde) < 1e-9);
    const fits = row && row.days <= d.stopAfterDays;
    const sum100 = Math.round(d.weights.reduce((a, b) => a + (Number(b) || 0), 0)) === 100;
    const urlsSet = d.testKind !== "url" || (d.urlVariants || []).slice(1).every((v) => v.url);
    const cutsOk = d.guardrailMetrics.every((m) => { const c = d.guardrailCutoffs?.[m] ?? S.metric(m)?.guardrailCutoff ?? 0.02; return c >= 0.005 && c <= 0.5; });
    // One item per step: done only once the step was passed with Next AND it is still valid.
    const items = [
      ["Overview", !!d.name, "Add a name"],
      ["Type & variants", !!p && p.status === "live" && vs.length >= 2 && sum100 && urlsSet, !p ? "Pick a page" : !sum100 ? "Split must add up to 100%" : "Add a variant"],
      ["Targeting", d.coverage >= 1 && d.coverage <= 100, "Set a rollout between 1% and 100%"],
      ["Metrics", !!pm && cutsOk, !pm ? "Choose a primary metric" : "Check guardrail cutoffs"],
      ["Analysis plan", !!d.stopAfterDays, "Set a duration"],
    ];
    const state = (i, ok) => (completed.has(i) ? (ok ? "ok" : "warn") : i === step ? "now" : "todo");
    const done = items.filter(([, ok], i) => state(i, ok) === "ok").length;
    return `<div class="wz-card">
      <div class="wz-eyebrow">Live preview</div>
      <div class="wz-title">${esc(d.name || "Untitled experiment")}</div>
      <div class="wz-badges"><span class="badge ${d.type === "bandit" ? "blue" : ""}">${d.type === "bandit" ? "Multi-armed bandit" : "A/B test"}</span><span class="badge">${d.testKind === "url" ? "URL vs URL" : "Original vs variant"}</span></div>
      ${d.hypothesis ? `<p class="wz-hyp">${esc(d.hypothesis)}</p>` : ""}
      <div class="wz-sec"><div class="wz-h">Traffic</div>${flow}</div>
      <div class="wz-sec"><div class="wz-h">Decides the winner</div>${pm ? `<div class="wz-metric">${esc(pm.name)}</div>` : `<div class="wz-empty">Choose a primary metric in step 4.</div>`}
        ${d.guardrailMetrics.length ? `<div class="wz-guards">${d.guardrailMetrics.map((m) => `<span class="wz-g">${esc(S.metric(m)?.name || m)} <b>≤ ${Math.round((d.guardrailCutoffs?.[m] ?? S.metric(m)?.guardrailCutoff ?? 0.02) * 1000) / 10}%</b></span>`).join("")}</div>` : ""}</div>
      <div class="wz-sec"><div class="wz-h">Duration</div>${!pe ? `<div class="wz-empty">Appears once a page and primary metric are set.</div>` : `<div class="wz-dur ${fits ? "ok" : "short"}"><b>${d.stopAfterDays / 7} week${d.stopAfterDays === 7 ? "" : "s"}</b> to detect a ${fmtPct(d.plannedMde, 0)} lift<div>${fits ? `Enough: needs about ${row.days} days` : `Suggested: about ${row.days > 365 ? "a year+" : `${row.days} days`}. You can still continue.`}</div></div>`}</div>
      <div class="wz-ready"><div class="wz-rh"><span>Ready to create</span><b>${done} of ${items.length} steps</b></div><div class="wz-meter"><i style="width:${(done / items.length) * 100}%"></i></div>
        <ul>${items.map(([l, ok, fix], i) => {
          const stt = state(i, ok);
          const note = stt === "warn" ? fix : stt === "now" ? "In progress" : stt === "todo" ? "" : "";
          return `<li class="${stt}"><button type="button" data-goto="${i}" ${i <= seen ? "" : "disabled"}><span class="mk">${stt === "ok" ? "✓" : stt === "warn" ? "!" : ""}</span><span class="lb">${l}${note ? `<small>${esc(note)}</small>` : ""}</span></button></li>`;
        }).join("")}</ul></div>
    </div>`;
  };
  const refreshSide = (form) => {
    const el = form.querySelector("[data-side]");
    if (!el || STEPS[step][0] === "review") return;
    collect(form);
    el.innerHTML = side();
  };

  const paint = () => {
    const form = formRef;
    const [hq, hs] = STEP_HEAD[STEPS[step][0]];
    form.querySelector(".modal-b").innerHTML = stepper() + `<div class="step-main"><div class="step-head"><div class="step-of">Step ${step + 1} of ${STEPS.length}</div><h3>${hq}</h3><p>${hs}</p></div><div class="step-body">${steps[STEPS[step][0]]()}</div></div>${STEPS[step][0] === "review" ? "" : `<aside class="wz-side" data-side>${side()}</aside>`}`;
    form.querySelector(".modal-b").classList.toggle("no-side", STEPS[step][0] === "review");
    if (!form.dataset.sideWired) {
      form.dataset.sideWired = "1";
      let tmr = null;
      const later = () => { clearTimeout(tmr); tmr = setTimeout(() => refreshSide(form), 120); };
      form.addEventListener("input", later);
      form.addEventListener("change", later);
      form.addEventListener("click", (ev) => {
        const g = ev.target.closest("[data-side] [data-goto]");
        if (!g || g.disabled) return;
        collect(form);
        step = Number(g.dataset.goto);
        paint();
      });
    }
    form.querySelector(".modal-f").innerHTML = footer();
    form.querySelector("#modal-title").textContent = d.name ? `New experiment · ${d.name}` : "New experiment";
    wire(form);
    form.querySelector(".modal-b").scrollTop = 0;
    form.querySelector(".step-body input:not([type=hidden]):not([disabled]):not([type=radio]), .step-body select, .step-body textarea")?.focus();
  };

  const wireFooter = (form) => {
    form.querySelector("[data-local=back]")?.addEventListener("click", () => {
      collect(form);
      step--;
      paint();
    });
    form.querySelector("[data-local=cancel]").addEventListener("click", () => cancel(form));
  };
  const wire = (form) => {
    form.querySelectorAll(".modal-b [data-goto]").forEach((b) => b.addEventListener("click", () => {
      collect(form);
      step = Number(b.dataset.goto);
      paint();
    }));
    wireFooter(form);
    const k = STEPS[step][0];
    if (k === "basics") {
      const keyText = form.querySelector("[data-keytext]");
      form.name.addEventListener("input", () => {
        if (!keyTouched) form.key.value = S.uniqueKey(slugify(form.name.value));
        keyText.textContent = form.key.value || "—";
      });
      form.key.addEventListener("input", () => {
        keyTouched = true;
        keyText.textContent = form.key.value || "—";
      });
      form.querySelector("[data-local=key-edit]").addEventListener("click", () => {
        const f = form.querySelector("[data-keyfield]");
        f.hidden = false;
        form.key.focus();
      });
    }
    if (k === "variants") {
      form.querySelectorAll("input[name=type]").forEach((r) => r.addEventListener("change", () => {
        collect(form);
        d.type = r.value;
        if (d.type === "bandit") {
          d.statsEngine = "bayesian";
          d.sequential = false;
          if (S.metric(d.primaryMetric) && S.metric(d.primaryMetric).type !== "binomial") d.primaryMetric = null;
        }
        paint();
      }));
      form.querySelectorAll("input[name=kind]").forEach((r) => r.addEventListener("change", () => {
        d.testKind = r.value;
        d.weights = [];
        if (r.value === "url") syncUrl();
        else setPage(d.pageId);
        paint();
      }));
      form.querySelector("[data-local=u-add]")?.addEventListener("click", () => {
        collect(form);
        d.urlVariants.push({ id: uid("uv"), key: "", name: "", url: "", changes: 1 });
        d.weights = [];
        syncUrl();
        paint();
      });
      form.querySelectorAll("[data-local=u-del]").forEach((b) => b.addEventListener("click", () => {
        collect(form);
        d.urlVariants.splice(Number(b.dataset.i), 1);
        d.weights = [];
        syncUrl();
        paint();
      }));
      form.querySelectorAll("input[name^=uurl-]").forEach((inp) => inp.addEventListener("change", () => {
        const nm = form.querySelector(`[name="uname-${inp.name.split("-")[1]}"]`);
        const pg = st.pages.find((x) => x.path === inp.value.trim());
        if (nm && !nm.value.trim() && pg) nm.value = pg.name;
      }));
      form.page?.addEventListener("change", () => {
        setPage(form.page.value || null);
        paint();
      });
      const total = () => {
        const t = [...form.querySelectorAll("input[name^=w-]:not([disabled])")].reduce((a, i) => a + (Number(i.value) || 0), 0);
        const el = form.querySelector("[data-total]");
        if (el) {
          el.textContent = `Total ${Math.round(t)}%`;
          el.className = Math.round(t) === 100 ? "" : "down";
        }
      };
      form.querySelectorAll("input[name=variant]").forEach((cb) => cb.addEventListener("change", () => {
        collect(form);
        const n = d.variantIds.length;
        const even = Math.floor(100 / n);
        d.weights = d.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
        paint();
      }));
      form.querySelectorAll("input[name^=w-]").forEach((i) => i.addEventListener("input", total));
      form.querySelector("[data-local=even]")?.addEventListener("click", () => {
        const n = d.variantIds.length;
        const even = Math.floor(100 / n);
        d.weights = d.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
        paint();
      });
      total();
    }
    if (k === "targeting") {
      bindConditions(form, "cond", () => d.targeting.conditions, (c) => (d.targeting.conditions = c));
      const reach = () => {
        if (STEPS[step][0] !== "targeting" || !form.querySelector("[data-reach]")) return;
        const tmp = { ...d, targeting: { ...d.targeting, conditions: readConditions(form, "cond"), audience: form.audience.value, excludeLeads: form.excludeLeads.checked } };
        const p = S.page(d.pageId);
        const dev = form.device.value === "mobile" ? 0.62 : form.device.value === "desktop" ? 0.38 : 1;
        const daily = (p?.traffic ?? 0) * (Number(form.coverage.value) / 100) * targetingFactor(tmp.targeting, tmp) * dev;
        form.querySelector("[data-reach]").textContent = p ? `About ${fmtInt(daily)} of ${fmtInt(p.traffic)} daily visitors will enter the test.` : "";
      };
      form.addEventListener("change", reach);
      form.addEventListener("input", reach);
      reach();
    }
    if (k === "metrics") {
      const box = form.querySelector("[data-guard-cuts]");
      form.querySelector("input[name=guardrail]")?.addEventListener("change", () => {
        collect(form);
        box.innerHTML = cutRows();
      });
      box.addEventListener("input", (ev) => {
        const mid = ev.target.name?.replace(/^gc-/, "");
        const ex = box.querySelector(`[data-gc-ex="${mid}"]`);
        if (ex) ex.textContent = cutoffExample(S.metric(mid), (Number(ev.target.value) || 0) / 100);
      });
    }
    if (k === "analysis") {
      form.querySelectorAll("[data-local=plan-fix]").forEach((b) => b.addEventListener("click", () => {
        collect(form);
        if (b.dataset.stop) d.stopAfterDays = Number(b.dataset.stop);
        if (b.dataset.mde) d.plannedMde = Number(b.dataset.mde);
        paint();
      }));
      form.addEventListener("change", (ev) => {
        if (STEPS[step][0] === "analysis" && ["engine", "stop", "mde", "sequential"].includes(ev.target.name)) {
          collect(form);
          paint();
        }
      });
    }
  };

  const cancel = (form) => {
    if (!dirty) return closeModal();
    const f = form.querySelector(".modal-f");
    const original = f.innerHTML;
    f.innerHTML = `<span style="margin-right:auto;display:flex;gap:8px;align-items:center;color:var(--amber-fg)">${icon.warn(16)} Discard this experiment? Your details won't be saved.</span>
      <button type="button" class="btn sm" data-local="keep">Keep editing</button><button type="button" class="btn sm danger" data-act="modal-close">Discard</button>`;
    f.querySelector("[data-local=keep]").addEventListener("click", () => {
      f.innerHTML = original;
      wireFooter(form);
    });
  };

  openModal({
    title: "New experiment",
    wide: true,
    body: "",
    footer: " ",
    onOpen: (form) => {
      formRef = form;
      form.classList.add("wizard");
      form.addEventListener("input", () => (dirty = true));
      paint();
    },
    onSubmit: (fd, form, submitter) => {
      const errs = collect(form);
      if (showErrs(form, errs)) return;
      completed.add(step);
      if (submitter?.value !== "create") {
        step++;
        seen = Math.max(seen, step);
        paint();
        return;
      }
      d.history.push({ at: S.now(), by: st.currentUserId, text: "Created the experiment" });
      st.experiments.unshift(d);
      S.save();
      closeModal();
      toast("Draft created. Work through the launch checklist, then start it.", "good");
      go(`#/experiment/${d.id}/overview`);
    },
  });
}

export function customFieldInputs(e) {
  const st = S.get();
  if (!st.customFields.length) return "";
  return `<div class="row">${st.customFields.map((f) => `<div class="grow field"><label for="cf-${f.id}">${esc(f.name)} ${f.required ? "" : `<span class="opt">· optional</span>`}</label>${f.type === "select"
    ? `<select id="cf-${f.id}" name="cf-${f.id}" class="inp"><option value="">—</option>${f.options.map((o) => `<option ${e.customFields?.[f.id] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : `<input id="cf-${f.id}" name="cf-${f.id}" class="inp" value="${esc(e.customFields?.[f.id] || "")}" placeholder="${esc(f.placeholder || "")}">`}<div data-err="cf-${f.id}"></div></div>`).join("")}</div>`;
}

// "Analyze a past experiment": bring in a test that already ran, by its
// dates. Results are simulated from the page's traffic for that window.
export function openImport() {
  if (!S.canEdit()) return toast("You need Editor access", "bad");
  const st = S.get();
  const pages = st.pages.filter((p) => p.variants.length >= 2);
  const pad = (n) => String(n).padStart(2, "0");
  const ds = (t) => {
    const x = new Date(t);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  openModal({
    title: "Analyze a past experiment",
    wide: true,
    ic: icon.pulse(18), tone: "blue",
    body: `<p class="muted" style="margin-top:0">For a test that already ran on a page (for example before this tool existed). It's added as a stopped experiment so you can read its results and record a result.</p>
      <div class="field"><label for="im-name">Name</label><input id="im-name" name="name" class="inp"><div data-err="name"></div></div>
      <div class="row"><div class="grow field"><label for="im-page">Page</label><select id="im-page" name="page" class="inp">${pages.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
        <div class="grow field"><label for="im-key">Tracking key used</label><input id="im-key" name="key" class="inp mono"><div data-err="key"></div></div></div>
      <div class="row"><div class="grow field"><label for="im-from">Started</label><input id="im-from" name="from" type="date" class="inp" value="${ds(S.now() - 45 * DAY)}"></div>
        <div class="grow field"><label for="im-to">Ended</label><input id="im-to" name="to" type="date" class="inp" value="${ds(S.now() - 25 * DAY)}"><div data-err="to"></div></div></div>
      <div class="field"><label for="im-metric">Primary metric</label><select id="im-metric" name="primary" class="inp">${metricOptions(null, null)}</select><div data-err="primary"></div></div>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Import &amp; analyze</button>`,
    onOpen: (form) => form.name.addEventListener("input", () => (form.key.value = S.uniqueKey(slugify(form.name.value)))),
    onSubmit: (fd, form) => {
      const errs = {};
      const name = String(fd.get("name")).trim();
      const key = String(fd.get("key")).trim();
      const from = new Date(`${fd.get("from")}T09:00`).getTime();
      const to = new Date(`${fd.get("to")}T09:00`).getTime();
      if (!name) errs.name = "Enter a name";
      if (!/^[a-z0-9-]+$/.test(key)) errs.key = "Lowercase letters, numbers and hyphens only";
      else if (st.experiments.some((x) => x.trackingKey === key)) errs.key = "Already used by another experiment";
      if (!(from < to) || to > S.now()) errs.to = "End must be after the start and not in the future";
      if (!fd.get("primary")) errs.primary = "Choose a primary metric";
      form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
      if (Object.keys(errs).length) return;
      const p = S.page(fd.get("page"));
      const e = S.newExperimentDraft();
      const ids = [p.defaultVariantId, ...p.variants.filter((v) => v.id !== p.defaultVariantId).map((v) => v.id)];
      const even = Math.floor(100 / ids.length);
      const r = rng(hash(key));
      Object.assign(e, { name, trackingKey: key, pageId: p.id, variantIds: ids, weights: ids.map((_, i) => (i === 0 ? 100 - even * (ids.length - 1) : even)), primaryMetric: fd.get("primary"),
        status: "stopped", startedAt: from, endedAt: to, imported: true, stopAfterDays: null, tags: ["imported"] });
      e.sim = { seed: hash(key) % 1000, lifts: Object.fromEntries(S.variantsOf(e).slice(1).map((v) => [v.key, { [e.primaryMetric]: -0.05 + r() * 0.2 }])) };
      e.phases = [{ start: from, end: to, weights: [...e.weights], coverage: 100, targeting: structuredClone(e.targeting), reason: "Imported" }];
      e.history.push({ at: S.now(), by: st.currentUserId, text: `Imported a past experiment (${fmtDate(from)} – ${fmtDate(to)})` });
      st.experiments.unshift(e);
      S.save();
      closeModal();
      toast("Imported. Review the results, then record a result.", "good");
      go(`#/experiment/${e.id}/results`);
    },
  });
}
