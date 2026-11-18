// New-experiment wizard (GrowthBook's flow, mapped onto pages + variants):
//   Overview → Page & variants → Targeting → Metrics → Analysis → Review.
// Also: "Analyze a past experiment" (import), and the power estimate.
import * as S from "../store.js";
import { openModal, closeModal, icon, variantChip, callout, tagPicker } from "../ui.js";
import { esc, slugify, toast, fmtInt, fmtPct, DAY, fmtDate, hash, rng, VARIANT_COLORS } from "../util.js";
import { go } from "../actions.js";
import { sampleSizePerVariant } from "../stats.js";
import { targetingFactor } from "../sim.js";
import { conditionEditor, bindConditions, readConditions, savedGroupPicker, readSavedGroups, namespaceBar, HASH_ATTRS, condText } from "./targeting.js";

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

// Days needed to detect each MDE, from the page's traffic and targeting.
export function powerEstimate(e, mdes = [0.05, 0.1, 0.15, 0.2]) {
  const m = S.metric(e.primaryMetric);
  const p = S.page(e.pageId);
  if (!m || !p) return null;
  const daily = p.traffic * (e.coverage / 100) * targetingFactor(e.targeting, e) * (e.targeting.device === "mobile" ? 0.62 : e.targeting.device === "desktop" ? 0.38 : 1);
  const k = Math.max(2, e.variantIds.length);
  const alpha = 1 - S.settings().ciLevel;
  // More variants = more comparisons; Bonferroni-style alpha split keeps it honest.
  const a = alpha / (k - 1);
  return { daily, metric: m, rows: mdes.map((mde) => {
    const n = sampleSizePerVariant(m, mde, { alpha: a });
    return { mde, n, days: Math.ceil((n * k) / Math.max(1, daily)) };
  }) };
}

export function powerTable(e) {
  const pe = powerEstimate(e);
  if (!pe) return `<div class="faint">Pick a page and a primary metric to estimate how long this will take.</div>`;
  const planned = e.plannedMde ?? 0.1;
  return `<div class="small" style="margin:0 0 8px">${fmtInt(pe.daily)} eligible visitors a day · ${esc(pe.metric.name)} baseline ${pe.metric.type === "binomial" ? fmtPct(pe.metric.base, 1) : pe.metric.base} · 80% power</div>
    <table class="t compact"><thead><tr><th>Smallest lift to detect</th><th class="num">Visitors per variant</th><th class="num">Days needed</th></tr></thead><tbody>
    ${pe.rows.map((r) => `<tr class="${Math.abs(r.mde - planned) < 1e-9 ? "sel" : ""}"><td>${fmtPct(r.mde, 0)}${Math.abs(r.mde - planned) < 1e-9 ? ` <span class="badge blue">planned</span>` : ""}</td><td class="num">${fmtInt(r.n)}</td><td class="num"><b>${r.days > 365 ? "> 1 year" : `${r.days} days`}</b></td></tr>`).join("")}</tbody></table>
    ${(() => {
      const row = pe.rows.find((r) => Math.abs(r.mde - planned) < 1e-9);
      if (!row || !e.stopAfterDays) return "";
      return row.days > e.stopAfterDays ? callout("warn", `To detect a ${fmtPct(planned, 0)} lift this test needs about ${row.days} days, but it stops after ${e.stopAfterDays}. Run it longer, raise the rollout or accept a bigger minimum lift.`) : callout("good", `${e.stopAfterDays} days is enough to detect a ${fmtPct(planned, 0)} lift (needs ~${row.days}).`);
    })()}`;
}

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
  const firstOk = (prefPageId && S.page(prefPageId) && !eligibility(S.page(prefPageId)) && prefPageId) || pages.find((p) => !eligibility(p))?.id || null;
  const setPage = (pid) => {
    const p = S.page(pid);
    d.pageId = pid;
    if (!p) return;
    d.variantIds = [p.defaultVariantId, ...p.variants.filter((v) => v.id !== p.defaultVariantId).map((v) => v.id)];
    const even = Math.floor(100 / d.variantIds.length);
    d.weights = d.variantIds.map((_, i) => (i === 0 ? 100 - even * (d.variantIds.length - 1) : even));
  };
  setPage(firstOk);
  let step = 0;
  let seen = 0;
  let keyTouched = false;
  let dirty = false;

  const steps = {
    basics: () => `
      <div class="field"><span class="label">Experiment type</span><div class="type-cards" role="radiogroup" aria-label="Experiment type">
        ${[["standard", "A/B test", "Fixed split. Compare variants against Control and pick a winner with confidence."], ["bandit", "Multi-armed bandit", "Sends more traffic to the best-performing variant each day, to get more conversions while you learn."]]
          .map(([k, t, s]) => `<label class="check ${d.type === k ? "on" : ""}"><input type="radio" name="type" value="${k}" ${d.type === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${s}</span></span></label>`).join("")}</div></div>
      <div class="field"><label for="c-name">Experiment name</label><input id="c-name" name="name" class="inp" autocomplete="off" value="${esc(d.name)}" placeholder="e.g. Online BBA — banner &amp; sticky CTA"><div data-err="name"></div></div>
      <div class="field"><label for="c-key">Tracking key</label><input id="c-key" name="key" class="inp mono" autocomplete="off" value="${esc(d.trackingKey)}"><div class="hint">Sent with every exposure and lead. Lowercase letters, numbers and hyphens. Locked once started.</div><div data-err="key"></div></div>
      <div class="field"><label for="c-hyp">Hypothesis ${st.settings.requireHypothesis ? "" : `<span class="opt">· optional</span>`}</label><textarea id="c-hyp" name="hypothesis" class="inp" placeholder="If we … then … because …">${esc(d.hypothesis)}</textarea><div data-err="hypothesis"></div></div>
      <div class="field"><label for="c-desc">Description <span class="opt">· optional</span></label><textarea id="c-desc" name="description" class="inp" style="min-height:64px">${esc(d.description)}</textarea></div>
      <div class="row"><div class="grow field"><label for="c-tags">Tags <span class="opt">· optional</span></label>${tagPicker({ id: "c-tags", selected: d.tags })}</div>
        <div class="grow field"><label for="c-owner">Owner</label><select id="c-owner" name="owner" class="inp">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === d.ownerId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div></div>
      ${customFieldInputs(d)}`,
    variants: () => {
      const p = S.page(d.pageId);
      const vs = p ? S.variantsOf(d) : [];
      return `<div class="field"><label for="c-page">Page to test</label>
        <select id="c-page" name="page" class="inp"><option value="">Choose a page</option>${pages.map((x) => {
          const why = eligibility(x);
          return `<option value="${x.id}" ${x.id === d.pageId ? "selected" : ""} ${why ? "disabled" : ""}>${esc(x.name)} · ${esc(x.path)}${why ? ` — ${why}` : ` — ${x.variants.length} variants`}</option>`;
        }).join("")}</select>
        <div class="hint">Only live pages with at least 2 variants and no running or scheduled experiment. Variants are served on the same URL; the CMS swaps sections.</div><div data-err="page"></div></div>
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
      ${p && p.variants.length < 2 ? `<div style="border:1px dashed var(--text-4);border-radius:12px;padding:24px;text-align:center"><b>${esc(p.name)} has only its default variant</b><div class="muted" style="margin:6px 0 14px">Create at least one more variant in the page editor, then come back.</div><a class="btn sm" href="#/page/${p.id}" data-act="modal-close-nav">${icon.ext()} Open page editor</a></div>` : ""}
      ${vs.length ? `<div class="small">Control: ${esc(vs[0].key)} · ${esc(vs[0].name)}</div>` : ""}`;
    },
    targeting: () => {
      const t = d.targeting;
      return `<div class="row"><div class="grow field"><label for="c-aud">Audience</label><select id="c-aud" name="audience" class="inp">${[["all", "All visitors"], ["new", "New visitors"], ["returning", "Returning visitors"]].map(([k, l]) => `<option value="${k}" ${t.audience === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="c-dev">Device</label><select id="c-dev" name="device" class="inp">${[["all", "Mobile + Desktop"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]].map(([k, l]) => `<option value="${k}" ${t.device === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
</div>
      <div class="field"><span class="label">Attribute conditions</span>${conditionEditor(t.conditions || [], { prefix: "cond" })}</div>
      <div class="field"><span class="label">Saved groups</span>${savedGroupPicker(t.savedGroups || [])}</div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" name="excludeLeads" ${t.excludeLeads ? "checked" : ""}><span><span class="t1">Exclude existing leads</span><span class="t2">Visitors who already submitted a form on this page see Control</span></span></label>
      <div class="row"><div class="grow field"><label for="c-cov">Rollout · share of eligible visitors in the test</label><div class="pct-input"><input id="c-cov" name="coverage" type="number" min="1" max="100" class="inp" value="${d.coverage}"><span>%</span></div><div data-err="coverage"></div></div>
        <div class="grow field"><label for="c-ns">Namespace <span class="opt">· optional</span></label><select id="c-ns" name="ns" class="inp"><option value="">None</option>${st.namespaces.map((n) => `<option value="${n.id}" ${d.namespace?.id === n.id ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></div></div>
      ${d.namespace ? `<div class="field"><span class="label">Namespace range</span><div class="row"><div class="pct-input" style="width:110px"><input name="ns0" type="number" class="inp" min="0" max="99" value="${d.namespace.range[0]}" aria-label="From"><span>%</span></div><span>to</span><div class="pct-input" style="width:110px"><input name="ns1" type="number" class="inp" min="1" max="100" value="${d.namespace.range[1]}" aria-label="To"><span>%</span></div></div><div style="margin-top:8px">${namespaceBar(d.namespace.id, d.namespace.range, d.id)}</div><div data-err="ns"></div></div>` : ""}
      <details class="adv"><summary>Assignment</summary>
        <div class="row" style="margin-top:12px"><div class="grow field"><label for="c-hash">Assign variants by</label><select id="c-hash" name="hash" class="inp">${HASH_ATTRS.map(([k, l]) => `<option value="${k}" ${d.assignment.hashAttribute === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="grow field"><label for="c-fb">Fallback <span class="opt">· if missing</span></label><select id="c-fb" name="fallback" class="inp"><option value="">None (skip the visitor)</option>${HASH_ATTRS.filter(([k]) => k !== d.assignment.hashAttribute).map(([k, l]) => `<option value="${k}" ${d.assignment.fallback === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
        <label class="check"><input type="checkbox" name="sticky" ${d.assignment.sticky ? "checked" : ""}><span><span class="t1">Sticky bucketing</span><span class="t2">Keep visitors in their variant even if the split or targeting changes later</span></span></label></details>
      <div class="hint" data-reach></div>`;
    },
    metrics: () => {
      const p = S.page(d.pageId);
      const box = (kind, list) => `<div class="row" style="gap:8px">${st.metrics.filter((m) => !(m.requires === "leadForm" && p && !p.hasLeadForm)).map((m) => `<label class="badge ${list.includes(m.id) ? "blue" : ""}" style="padding:6px 10px;cursor:pointer;font-weight:500"><input type="checkbox" name="${kind}" value="${m.id}" ${list.includes(m.id) ? "checked" : ""} style="accent-color:var(--primary)"> ${esc(m.name)}</label>`).join("")}</div>`;
      return `<div class="field"><label for="c-primary">${d.type === "bandit" ? "Decision metric" : "Primary metric"} <span class="opt">· picks the winner</span></label><select id="c-primary" name="primary" class="inp">${metricOptions(d.primaryMetric, p, { onlyBinomial: d.type === "bandit" })}</select><div data-err="primary"></div></div>
        <div class="field"><span class="label">Secondary metrics <span class="opt">· explain why</span></span>${box("secondary", d.secondaryMetrics)}</div>
        <div class="field"><span class="label">Guardrails <span class="opt">· flagged if a variant makes them worse</span></span>${box("guardrail", d.guardrailMetrics)}</div>
        <div class="field"><label for="c-act">Activation metric <span class="opt">· optional</span></label><select id="c-act" name="activation" class="inp">${metricOptions(d.activationMetric, p, { placeholder: "None · count every visitor" })}</select><div class="hint">Only visitors who did this are analysed, e.g. only those who scrolled to the fee section.</div></div>`;
    },
    analysis: () => `
      <div class="field"><span class="label">Stats engine</span><div class="type-cards">${[["bayesian", "Bayesian", "Chance to beat Control, and risk"], ["frequentist", "Frequentist", "p-values and confidence intervals"]].map(([k, t, s]) => `<label class="check ${d.statsEngine === k ? "on" : ""}"><input type="radio" name="engine" value="${k}" ${d.statsEngine === k ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${s}</span></span></label>`).join("")}</div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" name="sequential" ${d.sequential ? "checked" : ""} ${d.statsEngine === "frequentist" ? "" : "disabled"}><span><span class="t1">Sequential testing</span><span class="t2">Frequentist only. Safe to check results any time.</span></span></label>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" name="cuped" ${d.cuped ? "checked" : ""}><span><span class="t1">CUPED variance reduction</span><span class="t2">Uses pre-test behaviour to tighten intervals</span></span></label>
      <div class="row"><div class="grow field"><label for="c-stop">Stop</label><select id="c-stop" name="stop" class="inp">${[null, 7, 14, 21, 28, 42].map((o) => `<option value="${o ?? ""}" ${o === d.stopAfterDays ? "selected" : ""}>${o ? `${o} days after start` : "Manually"}</option>`).join("")}</select></div>
        <div class="grow field"><label for="c-mde">Smallest lift worth detecting</label><select id="c-mde" name="mde" class="inp">${[0.05, 0.1, 0.15, 0.2].map((m) => `<option value="${m}" ${Math.abs(m - d.plannedMde) < 1e-9 ? "selected" : ""}>${fmtPct(m, 0)}</option>`).join("")}</select></div></div>
      <div class="field"><span class="label">How long will it take?</span>${powerTable(d)}</div>`,
    review: () => {
      const p = S.page(d.pageId);
      const vs = p ? S.variantsOf(d) : [];
      const t = d.targeting;
      const mName = (id) => esc(S.metric(id)?.name || "");
      const none = (txt = "None") => `<span class="faint">${txt}</span>`;
      const sec = (title, i, body, cls = "") => `<section class="rv-sec ${cls}"><div class="rv-h"><h3>${title}</h3><button type="button" class="link-btn" data-goto="${i}">Edit</button></div>${body}</section>`;
      const kv = (k, v) => `<div class="rv-kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
      const color = (v) => VARIANT_COLORS[Math.max(0, v.key.charCodeAt(0) - 65) % VARIANT_COLORS.length];
      const who = [t.audience !== "all" ? `${t.audience === "new" ? "New" : "Returning"} visitors` : "", t.device !== "all" ? `${t.device === "mobile" ? "Mobile" : "Desktop"} only` : "", ...(t.conditions || []).map(condText), ...(t.savedGroups || []).map((g) => `${g.mode === "exclude" ? "Excluding" : "Only"} ${S.savedGroup(g.id)?.name}`), t.excludeLeads ? "Excluding existing leads" : ""].filter(Boolean);
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

          ${sec("Page &amp; variants", 1, `<div class="rv-page">${esc(p?.name || "")} <span class="mono faint">${esc(p?.path || "")}</span></div>
            ${d.type === "bandit" ? "" : `<div class="rv-split" aria-hidden="true">${vs.map((v, i) => `<span style="flex:${Number(d.weights[i]) || 0};background:${color(v)}"></span>`).join("")}</div>`}
            <ul class="rv-vars">${vs.map((v, i) => `<li>${variantChip(v, true)}<span class="grow">${esc(v.name)}${i === 0 ? ` <span class="faint">· control</span>` : ""}</span><b>${d.type === "bandit" ? "auto" : `${d.weights[i]}%`}</b></li>`).join("")}</ul>
            ${d.type === "bandit" ? `<div class="hint">Traffic shifts daily toward the best variant.</div>` : ""}`)}

          ${sec("Targeting", 2, `${kv("Who", who.length ? who.map(esc).join("<br>") : "All visitors")}
            ${kv("Rollout", `${d.coverage}% of eligible visitors`)}
            ${d.namespace ? kv("Namespace", `${esc(S.namespace(d.namespace.id)?.name)} · ${d.namespace.range.join("–")}%`) : ""}`)}

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
      if (!p || eligibility(p)) errs.page = "Choose a page that can be tested";
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
      d.targeting = { audience: fd.get("audience"), device: fd.get("device"), excludeLeads: !!fd.get("excludeLeads"), conditions: readConditions(form, "cond"), savedGroups: readSavedGroups(form) };
      d.coverage = Number(fd.get("coverage"));
      if (!(d.coverage >= 1 && d.coverage <= 100)) errs.coverage = "Enter 1–100";
      const ns = fd.get("ns");
      d.namespace = ns ? { id: ns, range: fd.get("ns0") != null ? [Number(fd.get("ns0")), Number(fd.get("ns1"))] : d.namespace?.id === ns ? d.namespace.range : [0, 50] } : null;
      if (d.namespace) {
        const [a, b] = d.namespace.range;
        if (!(a >= 0 && b <= 100 && a < b)) errs.ns = "The range must go from a lower to a higher number between 0 and 100";
        else {
          const clash = S.namespaceClash(d);
          if (clash) errs.ns = `Overlaps “${clash.name}” (${clash.namespace.range.join("–")}%), which is ${clash.status}. Starting will be blocked until the ranges don't overlap.`;
        }
      }
      d.assignment = { hashAttribute: fd.get("hash"), fallback: fd.get("fallback") || "", sticky: !!fd.get("sticky") };
      if (errs.ns && errs.ns.startsWith("Overlaps")) errs.nsWarn = errs.ns, delete errs.ns;
    } else if (k === "metrics") {
      d.primaryMetric = fd.get("primary") || null;
      d.secondaryMetrics = fd.getAll("secondary").filter((m) => m !== d.primaryMetric);
      d.guardrailMetrics = fd.getAll("guardrail").filter((m) => m !== d.primaryMetric);
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
    form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
    if (errs.nsWarn) form.querySelector("[data-err=ns]").innerHTML = `<div class="err" style="color:#92400E">${icon.warn(14)} ${esc(errs.nsWarn)}</div>`;
    const first = Object.keys(errs).find((k) => k !== "nsWarn");
    if (first) form.querySelector(`[data-err="${first}"]`)?.closest(".field")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return !!first;
  };

  let formRef = null;
  const paint = () => {
    const form = formRef;
    form.querySelector(".modal-b").innerHTML = stepper() + `<div class="step-body">${steps[STEPS[step][0]]()}</div>`;
    form.querySelector(".modal-f").innerHTML = footer();
    form.querySelector("#modal-title").textContent = `New ${d.type === "bandit" ? "bandit" : "A/B test"} · ${STEPS[step][1]}`;
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
        form.querySelector("#modal-title").textContent = `New ${d.type === "bandit" ? "bandit" : "A/B test"} · ${STEPS[step][1]}`;
      }));
      form.name.addEventListener("input", () => {
        if (!keyTouched) form.key.value = S.uniqueKey(slugify(form.name.value));
      });
      form.key.addEventListener("input", () => (keyTouched = true));
    }
    if (k === "variants") {
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
      form.ns.addEventListener("change", () => {
        collect(form);
        paint();
      });
      const reach = () => {
        const tmp = { ...d, targeting: { ...d.targeting, conditions: readConditions(form, "cond"), savedGroups: readSavedGroups(form), audience: form.audience.value, excludeLeads: form.excludeLeads.checked } };
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
      form.addEventListener("change", (ev) => {
        if (["engine", "stop", "mde"].includes(ev.target.name)) {
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
    title: "New A/B test",
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
