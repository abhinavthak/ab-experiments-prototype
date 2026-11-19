// New-experiment wizard (GrowthBook's flow, mapped onto pages + variants):
//   Overview → Page & variants → Targeting → Metrics → Analysis → Review.
// Also: "Analyze a past experiment" (import), and the power estimate.
import * as S from "../store.js";
import { openModal, closeModal, icon, variantChip, chip, callout, tagPicker, multiPicker } from "../ui.js";
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
      ? callout("warn", `To detect a ${p} lift this test needs about ${dur(plannedRow.days)}, but it stops after ${e.stopAfterDays} days. Run it longer, raise the rollout or accept a bigger minimum lift.`)
      : callout("good", `${e.stopAfterDays} days is enough to detect a ${p} lift (needs about ${dur(plannedRow.days)}).`);
  })();
  return compact ? `${facts}${verdict}<details class="adv"><summary>Days needed for other lifts</summary><div style="margin-top:10px">${table}</div></details>` : `${facts}${verdict}${table}`;
}

const STEP_HEAD = {
  basics: ["What are you testing?", "Name it and say what you expect to happen."],
  variants: ["What will visitors see?", "Pick the page and the versions to compare."],
  targeting: ["Who's in the test?", "Everyone who visits the page, unless you narrow it down."],
  metrics: ["How will you pick a winner?", "One metric decides. Guardrails catch harm."],
  analysis: ["How long will it run?", "Set a stop date and the smallest lift you care about."],
  review: ["Check and create", "Creating saves a draft. Nothing goes live until you start it."],
};
const STEPS = [["basics", "Overview"], ["variants", "Page & variants"], ["targeting", "Targeting"], ["metrics", "Metrics"], ["analysis", "Analysis"], ["review", "Review"]];

export function openCreate(prefPageId, { type = "standard" } = {}) {
  if (!S.canEdit()) {
    toast("You need Editor access to create experiments", "bad");
    return;
  }
  const st = S.get();
  const d = S.newExperimentDraft();
  d.type = type;
  const pages = [...st.pages].sort((a, b) => (eligibility(a) ? 1 : 0) - (eligibility(b) ? 1 : 0));
  const firstOk = (prefPageId && S.page(prefPageId) && prefPageId) || pages.find((p) => !eligibility(p))?.id || null;
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
    const weight = (v, i) => (bandit ? `<span class="faint" style="font-size:13px">auto</span>` : `<div class="pct-input"><input class="inp" type="number" min="0" max="100" name="w-${v.id}" value="${d.weights[i] ?? 0}" aria-label="Split for ${v.key}"><span>%</span></div>`);
    const paths = st.pages.filter((x) => x.id !== d.pageId).map((x) => `<option value="${esc(x.path)}">${esc(x.name)}</option>`).join("");
    const last = rows[rows.length - 1]?.key;
    return `<div class="field"><span class="label">URLs ${bandit ? "· arms" : "&amp; split"}</span>
      <datalist id="cms-paths">${paths}</datalist>
      ${rows.map((v, i) => i === 0
        ? `<div class="url-row">${chip(0)}<div class="url-main"><b>Original</b> <span class="badge">Control</span><div class="small mono" style="margin:2px 0 0">${esc(v.url)}</div></div>${weight(v, i)}<span></span></div>`
        : `<div class="url-row">${chip(i)}<div class="url-main url-inputs"><input class="inp mono" name="uurl-${i}" list="cms-paths" value="${esc(v.url)}" placeholder="/new-landing-page or https://…" aria-label="URL for ${v.key}" autocomplete="off"><input class="inp" name="uname-${i}" value="${esc(v.name)}" placeholder="Name, e.g. Redesigned page" aria-label="Name for ${v.key}"></div>${weight(v, i)}${rows.length > 2 ? `<button type="button" class="btn xs ghost" data-local="u-del" data-i="${i}" aria-label="Remove ${v.key}">${icon.x(16)}</button>` : "<span></span>"}</div><div data-err="uurl-${i}"></div>`).join("")}
      <div class="row" style="justify-content:space-between;margin-top:10px"><div class="row" style="gap:8px">${rows.length < 5 ? `<button type="button" class="btn xs" data-local="u-add">${icon.plus(14)} Add URL</button>` : ""}${bandit ? "" : `<button type="button" class="btn xs" data-local="even">Split evenly</button>`}</div>${bandit ? `<span class="hint" style="margin:0">Starts even, then re-weights daily toward the best URL.</span>` : `<b data-total>Total ${Math.round(d.weights.reduce((a, b) => a + Number(b || 0), 0))}%</b>`}</div>
      <div data-err="split"></div>
      <div class="hint">Choose another CMS page from the list or paste any URL. Visitors assigned to ${rows.length > 2 ? `B–${last}` : "B"} get a temporary (302) redirect and keep their UTM parameters. Each URL needs the lead form so conversions are counted.</div></div>`;
  };
  setPage(firstOk);
  let step = 0;
  let seen = 0;
  let keyTouched = false;
  let statsOpen = false;
  let dirty = false;

  const steps = {
    basics: () => {
      const cfs = st.customFields;
      const needCf = cfs.some((f) => f.required);
      return `
      <div class="field"><span class="label">Type</span><div class="type-cards compact" role="radiogroup" aria-label="Experiment type">
        ${[["standard", "A/B test", "Fixed split; pick a winner with confidence."], ["bandit", "Multi-armed bandit", "Shifts traffic to the best variant each day."]]
          .map(([k, t, sub]) => `<label class="check ${d.type === k ? "on" : ""}"><input type="radio" name="type" value="${k}" ${d.type === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${sub}</span></span></label>`).join("")}</div></div>
      <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" class="inp" autocomplete="off" value="${esc(d.name)}" placeholder="e.g. Online BBA — banner &amp; sticky CTA">
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
      const kindCards = `<div class="field"><span class="label">What are you comparing?</span><div class="type-cards compact" role="radiogroup" aria-label="What are you comparing">
        ${[["variants", "Original vs variant", "Same URL; the CMS swaps sections of the page."], ["url", "URL vs URL", "Split URL; some visitors are redirected to another page."]]
          .map(([k, t, sub]) => `<label class="check ${d.testKind === k ? "on" : ""}"><input type="radio" name="kind" value="${k}" ${d.testKind === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${sub}</span></span></label>`).join("")}</div></div>`;
      const pageWhy = (x) => {
        if (isUrl) {
          const a = S.activeExpOnPage(x.id, d.id);
          return a ? `${a.status} experiment` : x.status !== "live" ? "draft page" : x.path;
        }
        const why = eligibility(x);
        return why ? why.toLowerCase() : `${x.variants.length} variants`;
      };
      const pageField = `<div class="field"><label for="c-page">${isUrl ? "Original page · A (Control)" : "Page to test"}</label>
        <select id="c-page" name="page" class="inp"><option value="">Choose a page</option>${pages.map((x) => `<option value="${x.id}" ${x.id === d.pageId ? "selected" : ""}>${esc(x.name)} — ${esc(pageWhy(x))}</option>`).join("")}</select>`;
      const conflict = (() => {
        if (!p) return "";
        const other = S.activeExpOnPage(p.id, d.id);
        if (other) return callout("warn", `“${esc(other.name)}” is ${other.status} on this page. You can set this up now as a draft and start it once that one ends.`);
        if (p.status !== "live") return callout("warn", `${esc(p.name)} is a draft page. You can set this up now; publish the page before starting.`);
        return "";
      })();
      if (isUrl) return `${kindCards}${pageField}
        ${p ? `<div class="hint">Visitors land on <span class="mono">${esc(p.path)}</span>. A stays there; the others are redirected.</div>` : ""}<div data-err="page"></div></div>
        ${conflict}${p ? urlStep() : ""}`;
      return `${kindCards}${pageField}
        ${p ? `<div class="hint mono">${esc(p.path)}</div>` : ""}<div data-err="page"></div></div>
      ${conflict}
      ${!p ? "" : p.variants.length < 2 ? "" : `<div class="field"><span class="label">Variants ${d.type === "bandit" ? "· arms" : "& split"}</span>
        ${p.variants.map((v) => {
          const i = d.variantIds.indexOf(v.id);
          const on = i >= 0;
          const isDef = v.id === p.defaultVariantId;
          return `<div class="var-row">${variantChip(v)}<label class="row" style="gap:8px;min-width:0;cursor:${isDef ? "default" : "pointer"}"><input type="checkbox" name="variant" value="${v.id}" ${on ? "checked" : ""} ${isDef ? "disabled" : ""} style="accent-color:var(--primary)"><span><b>${esc(v.name)}</b>${isDef ? ` <span class="badge">Control · page default</span>` : ""}<span class="small" style="display:block;margin:2px 0 0">${isDef ? `What everyone sees today · ${p.sections} sections` : `${v.changes} change${v.changes === 1 ? "" : "s"} vs default`}</span></span></label>
            ${d.type === "bandit" ? `<span class="faint" style="font-size:13px">${on ? "auto" : ""}</span>` : `<div class="pct-input"><input class="inp" type="number" min="0" max="100" name="w-${v.id}" value="${on ? d.weights[i] : 0}" ${on ? "" : "disabled"} aria-label="Split for ${esc(v.key)}"><span>%</span></div>`}<span></span></div>`;
        }).join("")}
        <div class="row" style="justify-content:space-between;margin-top:10px">${d.type === "bandit" ? `<span class="hint" style="margin:0">Starts even, then re-weights daily toward the best arm (never below 2%).</span>` : `<button type="button" class="btn xs" data-local="even">Split evenly</button><b data-total>Total ${Math.round(d.weights.reduce((a, b) => a + Number(b || 0), 0))}%</b>`}</div>
        <div data-err="variants"></div><div data-err="split"></div>
        <a href="#/page/${p.id}" data-act="modal-close-nav" class="hint" style="display:inline-block">Create or edit variants in the page editor →</a></div>`}
      ${p && p.variants.length < 2 ? `<div style="border:1px dashed var(--text-4);border-radius:12px;padding:24px;text-align:center"><b>${esc(p.name)} has only its default variant</b><div class="muted" style="margin:6px 0 14px">Create at least one more variant in the page editor, then come back.</div><a class="btn sm" href="#/page/${p.id}" data-act="modal-close-nav">${icon.ext()} Open page editor</a></div>` : ""}`;
    },
    targeting: () => {
      const t = d.targeting;
      const hashLabel = HASH_ATTRS.find(([k]) => k === d.assignment.hashAttribute)?.[1] || "";
      return `<div class="row"><div class="grow field"><label for="c-aud">Audience</label><select id="c-aud" name="audience" class="inp">${[["all", "All visitors"], ["new", "New visitors"], ["returning", "Returning visitors"]].map(([k, l]) => `<option value="${k}" ${t.audience === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="c-dev">Device</label><select id="c-dev" name="device" class="inp">${[["all", "Mobile + Desktop"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]].map(([k, l]) => `<option value="${k}" ${t.device === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field" style="width:150px"><label for="c-cov">Rollout</label><div class="pct-input"><input id="c-cov" name="coverage" type="number" min="1" max="100" class="inp" value="${d.coverage}"><span>%</span></div></div></div>
      <div data-err="coverage"></div>
      <div class="reach" data-reach></div>
      <div class="field"><span class="label">Only include visitors who match <span class="opt">· optional</span></span><div class="hint" style="margin:0 0 10px">Each rule reads as a sentence. A visitor must match every rule; everyone else sees the original and isn't counted.</div>${conditionEditor(t.conditions || [], { prefix: "cond" })}</div>
      <details class="adv"><summary>Advanced <span class="opt">· ${t.excludeLeads ? "excluding existing leads · " : ""}assigned by ${esc(hashLabel.toLowerCase())}${d.assignment.sticky ? ", sticky" : ""}</span></summary>
        <label class="check" style="margin:12px 0"><input type="checkbox" name="excludeLeads" ${t.excludeLeads ? "checked" : ""}><span><span class="t1">Exclude existing leads</span><span class="t2">Visitors who already submitted a form on this page see Control</span></span></label>
        <div class="row"><div class="grow field"><label for="c-hash">Assign variants by</label><select id="c-hash" name="hash" class="inp">${HASH_ATTRS.map(([k, l]) => `<option value="${k}" ${d.assignment.hashAttribute === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="grow field"><label for="c-fb">Fallback <span class="opt">· if missing</span></label><select id="c-fb" name="fallback" class="inp"><option value="">None (skip the visitor)</option>${HASH_ATTRS.filter(([k]) => k !== d.assignment.hashAttribute).map(([k, l]) => `<option value="${k}" ${d.assignment.fallback === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
        <label class="check"><input type="checkbox" name="sticky" ${d.assignment.sticky ? "checked" : ""}><span><span class="t1">Sticky bucketing</span><span class="t2">Keep visitors in their variant even if the split or targeting changes later</span></span></label></details>`;
    },
    metrics: () => {
      const p = S.page(d.pageId);
      const opts = st.metrics.filter((m) => !(m.requires === "leadForm" && p && !p.hasLeadForm)).map((m) => [m.id, m.name]);
      return `<div class="field"><label for="c-primary">${d.type === "bandit" ? "Decision metric" : "Primary metric"}</label><select id="c-primary" name="primary" class="inp">${metricOptions(d.primaryMetric, p, { onlyBinomial: d.type === "bandit" })}</select><div class="hint">The one number that decides the winner.</div><div data-err="primary"></div></div>
        <div class="row"><div class="grow field"><label for="c-guard">Guardrails <span class="opt">· optional</span></label>${multiPicker({ id: "c-guard", name: "guardrail", options: opts, selected: d.guardrailMetrics, placeholder: "e.g. Bounce rate" })}<div class="hint">Fail if a variant is clearly worse by more than each metric's cutoff (e.g. Bounce rate 3%).</div></div>
          <div class="grow field"><label for="c-sec">Secondary <span class="opt">· optional</span></label>${multiPicker({ id: "c-sec", name: "secondary", options: opts, selected: d.secondaryMetrics, placeholder: "Add metrics" })}<div class="hint">Help explain why the winner won.</div></div></div>
        <details class="adv" ${d.activationMetric ? "open" : ""}><summary>Activation metric <span class="opt">· optional</span></summary>
          <div class="field" style="margin:12px 0 0"><label class="sr-only" for="c-act">Activation metric</label><select id="c-act" name="activation" class="inp">${metricOptions(d.activationMetric, p, { placeholder: "None · count every visitor" })}</select><div class="hint">Only analyse visitors who did this, e.g. scrolled to the fee section.</div></div></details>`;
    },
    analysis: () => {
      const engine = d.statsEngine === "bayesian" ? "Bayesian" : `Frequentist${d.sequential ? ", sequential" : ""}`;
      return `<div class="row"><div class="grow field"><label for="c-stop">Stop</label><select id="c-stop" name="stop" class="inp">${[null, 7, 14, 21, 28, 42].map((o) => `<option value="${o ?? ""}" ${o === d.stopAfterDays ? "selected" : ""}>${o ? `${o} days after start` : "Manually"}</option>`).join("")}</select></div>
        <div class="grow field"><label for="c-mde">Smallest lift worth detecting</label><select id="c-mde" name="mde" class="inp">${[0.05, 0.1, 0.15, 0.2].map((m) => `<option value="${m}" ${Math.abs(m - d.plannedMde) < 1e-9 ? "selected" : ""}>${fmtPct(m, 0)}</option>`).join("")}</select></div></div>
      ${powerTable(d, { compact: true })}
      <details class="adv" data-stats ${statsOpen ? "open" : ""}><summary>Statistics <span class="opt">· ${engine}${d.cuped ? ", CUPED" : ""}</span></summary>
        <div style="margin-top:12px"><div class="type-cards compact" style="margin-bottom:10px">${[["bayesian", "Bayesian", "Chance to beat Control, and risk"], ["frequentist", "Frequentist", "p-values and confidence intervals"]].map(([k, t, sub]) => `<label class="check ${d.statsEngine === k ? "on" : ""}"><input type="radio" name="engine" value="${k}" ${d.statsEngine === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${sub}</span></span></label>`).join("")}</div>
        <label class="check" style="margin-bottom:8px"><input type="checkbox" name="sequential" ${d.sequential ? "checked" : ""} ${d.statsEngine === "frequentist" ? "" : "disabled"}><span><span class="t1">Sequential testing</span><span class="t2">Frequentist only. Safe to check results any time.</span></span></label>
        <label class="check"><input type="checkbox" name="cuped" ${d.cuped ? "checked" : ""}><span><span class="t1">CUPED variance reduction</span><span class="t2">Uses pre-test behaviour to tighten intervals</span></span></label></div></details>`;
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
            ${kv("Guardrails", d.guardrailMetrics.length ? d.guardrailMetrics.map(mName).join(", ") : none())}
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

  const stepper = () => `<ol class="stepper">${STEPS.map(([k, l], i) => `<li class="${i === step ? "on" : i < step || i <= seen ? "done" : ""}"><button type="button" data-goto="${i}" ${i <= seen ? "" : "disabled"}><span class="n">${i < step ? "✓" : i + 1}</span>${l}</button></li>`).join("")}</ol>`;
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
      if (!p) errs.page = "Choose a page";
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
        d.weights = d.type === "bandit" ? evenWeights(rows.length) : rows.map((v) => Number(fd.get(`w-${v.id}`)) || 0);
        const sum = Math.round(d.weights.reduce((a, b) => a + b, 0));
        if (d.type !== "bandit" && sum !== 100) errs.split = `The split adds up to ${sum}%, not 100%`;
        else if (d.type !== "bandit" && d.weights.some((w) => w <= 0)) errs.split = "Every URL needs some traffic";
      } else if (p.variants.length < 2) errs.page = "This page has only its default variant. Add a variant in the page editor first.";
      else {
        const picked = fd.getAll("variant");
        const ids = [p.defaultVariantId, ...p.variants.filter((v) => picked.includes(v.id)).map((v) => v.id)];
        d.variantIds = ids;
        if (d.type !== "bandit") d.weights = ids.map((id) => Number(fd.get(`w-${id}`)) || 0);
        else d.weights = ids.map((_, i) => (i === 0 ? 100 - Math.floor(100 / ids.length) * (ids.length - 1) : Math.floor(100 / ids.length)));
        if (ids.length < 2) errs.variants = "Select at least one variant besides Control";
        else if (d.type !== "bandit" && Math.round(d.weights.reduce((a, b) => a + b, 0)) !== 100) errs.split = `The split adds up to ${Math.round(d.weights.reduce((a, b) => a + b, 0))}%, not 100%`;
        else if (d.type !== "bandit" && d.weights.some((w) => w <= 0)) errs.split = "Every variant needs some traffic";
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
      if (!d.primaryMetric) errs.primary = "Choose a primary metric";
    } else if (k === "analysis") {
      d.statsEngine = fd.get("engine");
      d.sequential = d.statsEngine === "frequentist" && !!fd.get("sequential");
      d.cuped = !!fd.get("cuped");
      d.stopAfterDays = fd.get("stop") ? Number(fd.get("stop")) : null;
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
  const paint = () => {
    const form = formRef;
    const [hq, hs] = STEP_HEAD[STEPS[step][0]];
    form.querySelector(".modal-b").innerHTML = stepper() + `<div class="step-head"><h3>${hq}</h3><p>${hs}</p></div><div class="step-body">${steps[STEPS[step][0]]()}</div>`;
    form.querySelector(".modal-f").innerHTML = footer();
    form.querySelector("#modal-title").textContent = "New experiment";
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
      form.querySelectorAll("input[name=type]").forEach((r) => r.addEventListener("change", () => {
        d.type = r.value;
        if (d.type === "bandit" && S.metric(d.primaryMetric)?.type !== "binomial") d.primaryMetric = null;
        form.querySelectorAll(".type-cards .check").forEach((c) => c.classList.toggle("on", c.querySelector("input").checked));
        form.querySelector("#modal-title").textContent = "New experiment";
      }));
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
    if (k === "analysis") {
      form.querySelector("[data-stats]")?.addEventListener("toggle", (ev) => (statsOpen = ev.target.open));
      form.addEventListener("change", (ev) => {
        if (STEPS[step][0] === "analysis" && ["engine", "stop", "mde"].includes(ev.target.name)) {
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
    f.innerHTML = `<span style="margin-right:auto;display:flex;gap:8px;align-items:center;color:#92400E">${icon.warn(16)} Discard this experiment? Your details won't be saved.</span>
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
