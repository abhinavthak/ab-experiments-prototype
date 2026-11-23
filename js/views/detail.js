import * as S from "../store.js";
import { analyze, statusPill, metricBlock, statOpts, guardCutoff } from "../analysis.js";
import { can, why } from "../rules.js";
import { acts, checklistHtml, createReport } from "../actions.js";
import { icon, pill, variantChip, avatar, menu, menuItem, callout, lock, openModal, closeModal, tagPicker } from "../ui.js";
import { esc, fmtDate, fmtDateTime, fmtInt, fmtPct, fmtLift, timeAgo, DAY, daysBetween, toast, uid, VARIANT_COLORS, copyText } from "../util.js";
import { lineChart } from "../chart.js";
import * as Sim from "../sim.js";
import { compare } from "../stats.js";
import { metricOptions, powerTable, customFieldInputs, cutoffExample } from "./create.js";
import { conditionEditor, bindConditions, HASH_ATTRS, condText, CONDITIONS_INTRO } from "./targeting.js";
import { RESULT_LABEL } from "../store.js";

// Results view settings, per experiment (reports keep their own).
const resUi = new Map();
export const defaultRes = () => ({ phase: null, baseline: 0, difference: "relative", dimension: "", chart: "cumulative" });
const uiFor = (e) => {
  if (!resUi.has(e.id)) resUi.set(e.id, defaultRes());
  return resUi.get(e.id);
};

const colorOf = (v) => VARIANT_COLORS[Math.max(0, v.key.charCodeAt(0) - 65) % VARIANT_COLORS.length];
const ENGINE_TEXT = (e) => (e.statsEngine === "bayesian" ? "Bayesian" : `Frequentist${e.sequential ? " · sequential" : ""}`) + (e.cuped ? " · CUPED" : "");

function header(e, tab) {
  const p = S.page(e.pageId);
  const st = statusPill(e);
  const btns = [];
  const started = S.phasesOf(e).length > 0;
  if (!e.archived) {
    if (e.status === "draft" || e.status === "scheduled") {
      btns.push(`<button type="button" class="btn sm" data-act="exp-schedule" ${can(e, "schedule") ? "" : `disabled title="${esc(why(e, "schedule"))}"`}>${icon.calendar()} ${e.status === "scheduled" ? "Reschedule" : "Schedule"}</button>`);
      btns.push(`<button type="button" class="btn sm primary" data-act="exp-start" ${can(e, "startNow") ? "" : `disabled title="${esc(why(e, "startNow"))}"`}>${icon.play()} Start experiment</button>`);
    }
    if (e.status === "running") {
      btns.push(`<button type="button" class="btn sm" data-act="exp-make-changes" ${S.canEdit() ? "" : 'disabled title="You need Editor access"'}>${icon.edit()} Make changes</button>`);
      btns.push(`<button type="button" class="btn sm primary" data-act="exp-stop" ${can(e, "stop") ? "" : `disabled title="${esc(why(e, "stop"))}"`}>${icon.stop()} Stop experiment</button>`);
    }
    if (e.status === "stopped" && !e.result) btns.push(`<button type="button" class="btn sm primary" data-act="exp-stop">Record result</button>`);
  }
  const ed = S.canEdit() ? "" : "You need Editor access";
  const items = [
    menuItem("exp-edit-info", "Edit name & details", { ic: icon.edit(), disabled: why(e, "editText") }),
    menuItem("exp-watch", e.watched ? "Stop watching" : "Watch", { ic: icon.eye() }),
    menuItem("exp-copykey", "Copy tracking key", { ic: icon.copy() }),
    started ? menuItem("exp-report", "Create report", { ic: icon.form(18), disabled: ed }) : "",
    menuItem("exp-duplicate", "Duplicate", { ic: icon.copy(), disabled: ed }),
    e.status === "scheduled" && !e.archived ? menuItem("exp-unschedule", "Unschedule", { ic: icon.clock() }) : "",
    e.archived ? menuItem("exp-unarchive", "Unarchive", { ic: icon.archive(), disabled: why(e, "unarchive") }) : menuItem("exp-archive", "Archive", { ic: icon.archive(), disabled: why(e, "archive") }),
    "<hr>",
    menuItem("exp-delete", "Delete", { ic: icon.trash(), danger: true, disabled: ed }),
  ].join("");
  const phases = S.phasesOf(e);
  const cur = phases[phases.length - 1];
  const sub =
    e.status === "running" ? `Started ${fmtDate(e.startedAt)} · day ${daysBetween(e.startedAt, S.now()) + 1}${S.stopDate(e) ? ` of ${Math.round((S.stopDate(e) - e.startedAt) / DAY)}` : ""}${phases.length > 1 ? ` · phase ${phases.length} since ${fmtDate(cur.start)}` : ""}`
    : e.status === "scheduled" ? `Starts ${fmtDateTime(e.scheduledStart)}`
    : e.status === "stopped" ? `Ran ${fmtDate(e.startedAt)} – ${fmtDate(e.endedAt)}${e.result ? ` · ${RESULT_LABEL[e.result]}` : ""}${e.imported ? " · imported" : ""}`
    : `Created ${fmtDate(e.createdAt)} by ${S.user(e.ownerId).name}`;
  const tabs = [["overview", "Overview"], ["results", "Results"], ["health", "Health"], ["history", "History & comments"]];
  return `
  <div class="crumbs"><a href="#/experiments">Experiments</a> / <a href="#/page/${p?.id}">${esc(p?.name || "Deleted page")}</a></div>
  <div class="page-head" style="margin-bottom:12px">
    <div style="min-width:0"><div class="row" style="gap:12px"><h1 style="font-size:28px">${esc(e.name)}</h1>${pill(st.tone, st.label)}${S.isUrlTest(e) ? `<span class="badge">Split URL</span>` : ""}${e.type === "bandit" ? `<span class="badge blue">Bandit</span>` : ""}${e.watched ? `<span class="badge amber">★ Watching</span>` : ""}</div>
      <div class="sub" style="font-size:14px">${esc(sub)} · tracking key <button type="button" class="link-btn mono" data-act="exp-copykey" title="Copy">${esc(e.trackingKey)}</button> · ${avatar(e.ownerId)} ${esc(S.user(e.ownerId).name)}</div></div>
    <div class="head-actions">${btns.join("")}${menu("⋯", items, { label: "More actions" })}</div>
  </div>
  ${e.notice ? callout(e.notice.tone, esc(e.notice.text), `<button type="button" class="btn xs" data-act="exp-dismiss-notice">Dismiss</button>`) : ""}
  ${e.archived ? callout("info", "This experiment is archived and read-only. Unarchive it to make changes.", `<button type="button" class="btn xs" data-act="exp-unarchive">Unarchive</button>`) : ""}
  <nav class="tabs" aria-label="Experiment sections">${tabs.map(([k, l]) => `<a href="#/experiment/${e.id}/${k}" class="${tab === k ? "on" : ""}" ${tab === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
}

/* ---------- Overview ---------- */
export function targetingSummary(t) {
  return [t.audience !== "all" ? `${t.audience} visitors` : "All visitors", t.device !== "all" ? `${t.device} only` : "", ...(t.conditions || []).map(condText), t.excludeLeads ? "excluding existing leads" : ""].filter(Boolean).join(" · ");
}

function overview(e) {
  const p = S.page(e.pageId);
  const vs = S.variantsOf(e);
  const edV = can(e, "editVariants");
  const total = e.weights.reduce((a, b) => a + Number(b || 0), 0);
  const notIn = p ? p.variants.filter((v) => !e.variantIds.includes(v.id)) : [];
  const active = p && S.activeExpOnPage(p.id, e.id);
  const st = S.get();
  const phases = S.phasesOf(e);
  const isBandit = e.type === "bandit";
  const banditW = isBandit && phases.length ? analyze(e).bandit?.weights : null;

  const isUrl = S.isUrlTest(e);
  const variantRows = isUrl
    ? vs.map((v, i) => `<div class="var-row">${variantChip(v)}<div style="min-width:0"><b>${esc(v.name)}</b>${i === 0 ? ` <span class="badge">Control</span>` : ""}<div class="small mono" style="margin-top:2px;overflow-wrap:anywhere">${esc(v.url)}</div></div>
      ${isBandit ? `<div class="num" style="font-size:14px">${banditW ? `<b>${fmtPct(banditW[i], 0)}</b><div class="small" style="margin:0">today</div>` : `<span class="faint">auto</span>`}</div>` : `<div class="pct-input"><input class="inp" type="number" min="0" max="100" step="1" data-weight="${i}" value="${esc(e.weights[i])}" aria-label="Traffic split for ${esc(v.key)}" ${edV ? "" : "disabled"}><span>%</span></div>`}
      <div class="row" style="gap:6px;justify-content:flex-end"><button type="button" class="btn xs" data-act="exp-preview" data-vid="${v.id}">Open</button></div></div>`).join("")
    : vs
    .map((v, i) => `<div class="var-row">${variantChip(v)}<div style="min-width:0"><b>${esc(v.name)}</b>${i === 0 ? ` <span class="badge">Control</span>` : ""}<div class="small" style="margin-top:2px">${i === 0 ? `Default variant · ${p?.sections ?? 0} sections` : `${v.changes} change${v.changes === 1 ? "" : "s"} vs default`}</div></div>
      ${isBandit ? `<div class="num" style="font-size:14px">${banditW ? `<b>${fmtPct(banditW[i], 0)}</b><div class="small" style="margin:0">today</div>` : `<span class="faint">auto</span>`}</div>` : `<div class="pct-input"><input class="inp" type="number" min="0" max="100" step="1" data-weight="${i}" value="${esc(e.weights[i])}" aria-label="Traffic split for ${esc(v.key)}" ${edV ? "" : "disabled"}><span>%</span></div>`}
      <div class="row" style="gap:6px;justify-content:flex-end">${i > 0 && edV ? `<button type="button" class="btn xs" data-act="exp-remove-variant" data-vid="${v.id}" aria-label="Remove ${esc(v.key)} from test">Remove</button>` : ""}<a class="btn xs" href="#/page/${e.pageId}?v=${v.id}">${i === 0 ? "View" : "Edit sections"}</a></div></div>`)
    .join("");

  const checks = !e.archived && (e.status === "draft" || e.status === "scheduled") ? S.startChecks(e) : null;

  const metricBox = (kind, list, label, help, editable) => `
    <div class="field"><span class="label">${label}</span><div class="hint" style="margin:-4px 0 8px">${help}</div>
      <div class="row" style="gap:8px">${st.metrics
        .filter((m) => m.id !== e.primaryMetric && !(m.requires === "leadForm" && p && !p.hasLeadForm))
        .map((m) => `<label class="badge ${list.includes(m.id) ? "blue" : ""}" style="padding:6px 10px;cursor:${editable ? "pointer" : "default"};font-weight:500"><input type="checkbox" data-mlist="${kind}" value="${m.id}" ${list.includes(m.id) ? "checked" : ""} ${editable ? "" : "disabled"} style="accent-color:var(--primary)"> ${esc(m.name)}</label>`)
        .join("")}</div></div>`;
  const runningLock = e.status === "running" && S.canEdit() ? `<button type="button" class="btn xs" data-act="exp-make-changes">${icon.edit(14)} Make changes</button>` : edV ? "" : lock(why(e, "editVariants"));
  const cf = st.customFields.filter((f) => e.customFields?.[f.id]);
  const t = e.targeting;

  return `<div class="grid2"><div>
    <section class="card pad">
      <div class="card-head"><div><h2>Page under test</h2></div><a class="btn sm" href="#/page/${e.pageId}">${icon.ext()} Open page editor</a></div>
      ${e.hypothesis ? `<p style="margin:12px 0"><b>Hypothesis:</b> ${esc(e.hypothesis)}</p>` : `<p class="faint" style="margin:12px 0">No hypothesis yet. <button type="button" class="link-btn" data-act="exp-edit-info">Add one</button></p>`}
      ${e.description ? `<p class="muted" style="margin:0 0 12px">${esc(e.description)}</p>` : ""}
      <div class="row" style="padding:14px;border:1px solid var(--border);border-radius:12px"><span style="color:var(--primary)">${icon.page()}</span><div class="grow"><b>${esc(p?.name || "Deleted page")}</b><div class="small" style="margin:0"><span class="mono">${esc(p?.path || "")}</span> · ${esc(p?.type || "")} · ${p?.sections ?? 0} sections · ~${fmtInt(p?.traffic ?? 0)} visitors/day</div></div>${p ? pill(p.status === "live" ? "green" : "gray", p.status === "live" ? "Live" : "Draft") : ""}</div>
      <p class="hint">While the test runs, the page's default variant can't be changed, and variants in the test can't be deleted. Blocks (like Common Header) are shared by every variant.</p>
      <div class="row" style="gap:6px">${e.tags.map((x) => `<span class="badge">${esc(x)}</span>`).join("")}${cf.map((f) => `<span class="badge">${esc(f.name)}: ${esc(e.customFields[f.id])}</span>`).join("")}</div>
    </section>

    <section class="card pad">
      <div class="card-head"><div><h2>${isUrl ? "URLs &amp; split" : isBandit ? "Arms" : "Variants &amp; split"}</h2><div class="card-sub">${isBandit ? "A bandit starts with an even split and re-weights daily toward the best arm on the decision metric (never below 2%)." : isUrl ? "Split URL test: A is the original page; visitors assigned to the other URLs are redirected." : "Variants are created in the page editor. Control is the page's default variant."}</div></div>${runningLock}</div>
      ${variantRows}
      <div class="row" style="justify-content:space-between;margin-top:12px">
        <div class="row" style="gap:8px">${edV && !isBandit ? `<button type="button" class="btn xs" data-act="exp-split-even">Split evenly</button>` : ""}${edV && notIn.length && !isUrl ? menu(`${icon.plus(16)} Add page variant`, notIn.map((v) => menuItem("exp-add-variant", `${v.key} · ${v.name}`, { data: `data-vid="${v.id}"` })).join(""), { cls: "btn xs", label: "Add page variant" }) : ""}${edV && p ? `<a class="btn xs" href="#/page/${p.id}?new=1">New variant in page editor</a>` : ""}</div>
        ${isBandit ? "" : `<b class="${Math.round(total) === 100 ? "" : "down"}">Total ${Math.round(total)}%</b>`}</div>
      <div class="field" style="margin-top:16px;margin-bottom:0"><span class="label">How variants are served</span><div class="muted" style="font-size:14px">${isUrl ? `Split URL. Everyone lands on <span class="mono">${esc(p?.path || "")}</span>; visitors in ${vs.slice(1).map((v) => esc(v.key)).join(", ")} get a temporary (302) redirect that keeps UTM parameters. Variant pages point their canonical tag at the original, so SEO is unaffected.` : `Same URL — the CMS swaps sections. Visitors stay on <span class="mono">${esc(p?.path || "")}</span>. Variants keep Control's canonical tag and aren't indexed separately, so SEO is unaffected.`}</div></div>
    </section>

    <section class="card pad">
      <div class="card-head"><div><h2>Targeting &amp; traffic</h2><div class="card-sub">${esc(targetingSummary(t))} · rollout ${e.coverage}%</div></div>${runningLock}</div>
      <div class="row"><div class="grow field"><label for="t-aud">Audience</label><select id="t-aud" class="inp" data-t="audience" ${edV ? "" : "disabled"}>${[["all", "All visitors"], ["new", "New visitors"], ["returning", "Returning visitors"]].map(([k, l]) => `<option value="${k}" ${t.audience === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="t-dev">Device</label><select id="t-dev" class="inp" data-t="device" ${edV ? "" : "disabled"}>${[["all", "Mobile + Desktop"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]].map(([k, l]) => `<option value="${k}" ${t.device === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="t-cov">Rollout · share of visitors in test</label><div class="pct-input"><input id="t-cov" class="inp" type="number" min="0" max="100" data-coverage value="${e.coverage}" ${edV ? "" : "disabled"}><span>%</span></div></div></div>
      <div class="field"><span class="label">Attribute conditions</span>${edV ? CONDITIONS_INTRO : ""}${conditionEditor(t.conditions || [], { disabled: !edV, prefix: "ov" })}</div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" data-t="excludeLeads" ${t.excludeLeads ? "checked" : ""} ${edV ? "" : "disabled"}><span><span class="t1">Exclude existing leads</span><span class="t2">Visitors who already submitted a form on this page see Control</span></span></label>
      <div class="row"><div class="grow field"><label for="t-hash">Assign variants by</label><select id="t-hash" class="inp" data-asg="hashAttribute" ${edV ? "" : "disabled"}>${HASH_ATTRS.map(([k, l]) => `<option value="${k}" ${e.assignment.hashAttribute === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="t-fb">Fallback</label><select id="t-fb" class="inp" data-asg="fallback" ${edV ? "" : "disabled"}><option value="">None (skip the visitor)</option>${HASH_ATTRS.filter(([k]) => k !== e.assignment.hashAttribute).map(([k, l]) => `<option value="${k}" ${e.assignment.fallback === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <label class="check"><input type="checkbox" data-asg="sticky" ${e.assignment.sticky ? "checked" : ""} ${edV ? "" : "disabled"}><span><span class="t1">Sticky bucketing</span><span class="t2">Keep visitors in the same variant even if the split or targeting changes. After a form submit they're matched by lead ID.</span></span></label>
      <p class="hint">Outside the rollout %, cookies blocked, or bots: they see the default and aren't counted. CMS admins and preview links are never counted.</p>
    </section>

    <section class="card pad">
      <h2>Metrics</h2><div class="card-sub">One primary metric picks the winner. Secondary metrics help explain why; guardrails catch harm.</div>
      <div class="field"><label for="m-primary">${isBandit ? "Decision metric" : "Primary"} · one only</label>${can(e, "changePrimary") ? "" : `<div style="margin-bottom:6px">${lock(why(e, "changePrimary"))}</div>`}<select id="m-primary" class="inp" data-primary ${can(e, "changePrimary") ? "" : "disabled"}>${metricOptions(e.primaryMetric, p, { onlyBinomial: isBandit })}</select><div class="hint">Counted once per visitor, credited to the variant they saw, within ${S.metric(e.primaryMetric)?.windowHours ?? 72} hours of first exposure.</div></div>
      ${metricBox("secondaryMetrics", e.secondaryMetrics, `Secondary · ${e.secondaryMetrics.length}`, "Tracked for context.", can(e, "editSecondary"))}
      ${metricBox("guardrailMetrics", e.guardrailMetrics, `Guardrails · ${e.guardrailMetrics.length}`, `Fail when a variant is clearly worse by more than its cutoff${st.settings.guardrailsBlockShip ? "; a failing guardrail blocks a “Ship now” call" : ""}.`, can(e, "editSecondary"))}
      ${e.guardrailMetrics.length ? `<div class="field"><span class="label">Guardrail cutoffs</span><div class="guard-cuts">${e.guardrailMetrics.map((mid) => {
        const m = S.metric(mid);
        const c = guardCutoff(m, e);
        const editable = can(e, "editVariants");
        return `<div class="gc-row"><b>${esc(m?.name || mid)}</b><span class="gc-mid">may get ${m?.higherIsBetter === false ? "higher" : "lower"} by at most</span>${editable ? `<div class="pct-input"><input class="inp" type="number" min="0.5" max="50" step="0.5" data-gcut="${mid}" value="${Math.round(c * 1000) / 10}" aria-label="Cutoff for ${esc(m?.name || mid)}"><span>%</span></div>` : `<b>${fmtPct(c, 1)}</b>`}<span class="gc-ex">${esc(cutoffExample(m, c))}</span></div>`;
      }).join("")}</div>${can(e, "editVariants") ? "" : `<div class="hint">Locked once the test starts, so the bar can't move after results come in.</div>`}</div>` : ""}
      <div class="field"><label for="m-act">Activation metric</label><select id="m-act" class="inp" data-activation ${can(e, "changePrimary") ? "" : "disabled"}>${metricOptions(e.activationMetric, p, { placeholder: "None · count every visitor" })}</select><div class="hint">Only visitors who did this are analysed.</div></div>
      <label class="check"><input type="checkbox" data-flag="leadAttribution" ${e.leadAttribution ? "checked" : ""} ${can(e, "editText") ? "" : "disabled"}><span><span class="t1">Tag leads with experiment and variant</span><span class="t2">Adds exp_key and variant to every lead from this page, so counsellors and CRM reports can split by variant.</span></span></label>
    </section>

    <section class="card pad">
      <h2>Analysis</h2><div class="card-sub">How results are calculated. You can change this at any time; results recalculate.</div>
      <div class="field"><span class="label">Stats engine</span><div class="seg" role="group" aria-label="Stats engine" style="display:inline-flex">${[["bayesian", "Bayesian"], ["frequentist", "Frequentist"]].map(([k, l]) => `<button type="button" aria-pressed="${e.statsEngine === k}" data-act="exp-engine" data-engine="${k}" ${can(e, "analysis") ? "" : "disabled"}>${l}</button>`).join("")}</div>
        <div class="hint">${e.statsEngine === "bayesian" ? `Shows the chance each variant beats Control, its risk, and a ${fmtPct(st.settings.ciLevel, 0)} credible interval. Called at ${fmtPct(st.settings.ctw, 0)}.` : `Shows p-values and ${fmtPct(st.settings.ciLevel, 0)} confidence intervals. Significant at p < ${st.settings.alpha}${st.settings.correction !== "none" ? `, ${st.settings.correction === "holm" ? "Holm-Bonferroni" : "Benjamini-Hochberg"} corrected` : ""}.`} <a href="#/settings">Organization settings</a></div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-flag="sequential" ${e.sequential ? "checked" : ""} ${can(e, "analysis") && e.statsEngine === "frequentist" ? "" : "disabled"}><span><span class="t1">Sequential testing</span><span class="t2">Safe to check results any time (frequentist only). Intervals are wider early on.</span></span></label>
      <label class="check"><input type="checkbox" data-flag="cuped" ${e.cuped ? "checked" : ""} ${can(e, "analysis") ? "" : "disabled"}><span><span class="t1">CUPED variance reduction</span><span class="t2">Uses visitors' pre-test behaviour to tighten intervals.</span></span></label>
    </section>

    <section class="card pad">
      <div class="card-head"><div><h2>Plan</h2><div class="card-sub">How long the test needs to reliably detect the lift you care about.</div></div>
        <div class="field plan-mde" style="margin:0"><label for="p-mde">Smallest lift worth detecting</label><select id="p-mde" class="inp" data-mde ${can(e, "editText") ? "" : "disabled"}>${[0.05, 0.1, 0.15, 0.2].map((m) => `<option value="${m}" ${Math.abs(m - (e.plannedMde ?? 0.1)) < 1e-9 ? "selected" : ""}>${fmtPct(m, 0)}</option>`).join("")}</select></div></div>
      ${powerTable(e)}
    </section>

    <section class="card pad">
      <h2>Schedule</h2><div class="card-sub">Draft · Scheduled · Running · Stopped. Tests can't be paused; use Make changes for a new phase.</div>
      <dl class="kv"><dt>Start</dt><dd>${e.startedAt ? fmtDateTime(e.startedAt) : e.scheduledStart ? `Scheduled · ${fmtDateTime(e.scheduledStart)}` : "Manually"}</dd>
        <dt>Stop</dt><dd>${e.endedAt ? fmtDateTime(e.endedAt) : e.stopAfterDays ? `${e.stopAfterDays} days after start${S.stopDate(e) ? ` · ${fmtDate(S.stopDate(e))}` : ""}` : "Manually"} ${can(e, "stopDate") ? `<button type="button" class="link-btn" data-act="exp-stopdate">Change</button>` : ""}</dd>
        <dt>When it stops</dt><dd class="muted">You record a result (Won, Lost, No clear winner or Did not finish), write a conclusion and choose which variant becomes the page default.</dd></dl>
    </section>

    ${phases.length ? `<section class="card"><div class="toolbar"><div><b>Phases</b><div class="small" style="margin:2px 0 0">A new phase re-randomizes visitors. Results show the latest phase by default.</div></div>${e.status === "running" && S.canEdit() ? `<div class="end"><button type="button" class="btn xs" data-act="exp-make-changes">New phase</button></div>` : ""}</div>
      <div class="table-wrap"><table class="t compact"><thead><tr><th>Phase</th><th>Dates</th><th>Split</th><th class="num">Rollout</th><th>Targeting</th><th>Reason</th></tr></thead><tbody>
      ${phases.map((ph, i) => `<tr><td><b>${i + 1}</b>${i === phases.length - 1 && !ph.end ? ` <span class="badge green">Current</span>` : ""}</td><td>${fmtDate(ph.start)} – ${ph.end ? fmtDate(ph.end) : "now"}</td><td>${isBandit ? "Adaptive" : ph.weights.join("/")}</td><td class="num">${ph.coverage}%${(ph.steps || []).map((x) => ` → ${x.coverage}%`).join("")}</td><td><span class="small" style="margin:0">${esc(targetingSummary(ph.targeting || e.targeting))}</span></td><td>${esc(ph.reason || "")}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
  </div>

  <aside class="stack">
    ${checks ? `<section class="card pad"><h2>${checks.blocked ? `Launch checklist · ${checks.items.filter((i) => !i.ok && !i.warn).length} to fix` : "Launch checklist · ready"}</h2><div class="card-sub">Automatic checks plus your team's manual QA items. Tick manual items as you do them.</div>
      ${checklistHtml(e, checks.items, { interactive: true })}
      <div class="row" style="margin-top:12px"><button type="button" class="btn sm primary" data-act="exp-start" ${checks.blocked || !S.canEdit() ? "disabled" : ""}>Start experiment</button><button type="button" class="btn sm" data-act="exp-schedule" ${S.canEdit() ? "" : "disabled"}>Schedule</button></div></section>` : ""}
    ${active ? callout("warn", `“${esc(active.name)}” is ${active.status} on this page. Only one running or scheduled experiment per page.`) : ""}
    <section class="card pad"><h2>Tracking key</h2>
      <div class="field" style="margin:12px 0 0"><label class="sr-only" for="k-key">Tracking key</label><input id="k-key" class="inp mono" data-key value="${esc(e.trackingKey)}" ${can(e, "changeKey") ? "" : "readonly"}><div id="k-err"></div>
      <div class="hint">${can(e, "changeKey") ? "Unique across all experiments. Lowercase letters, numbers and hyphens." : esc(why(e, "changeKey"))}</div></div></section>
    <section class="card pad"><h2>Implementation</h2><div class="card-sub">The CMS assigns and renders variants server-side. Each exposure is sent to analytics like this:</div>
      <pre class="code">dataLayer.push({
  event: "experiment_viewed",
  experiment_id: "${esc(e.trackingKey)}",
  variation_id: "${esc(vs[1]?.key || "B")}",
  hash_attribute: "${esc(e.assignment.hashAttribute)}"
});</pre>
      <div class="hint">Leads submitted on the page get <span class="mono">exp_key=${esc(e.trackingKey)}</span> and <span class="mono">variant</span>${e.leadAttribution ? "" : " (turned off)"}.</div></section>
    <section class="card pad"><h2>Preview</h2><div class="card-sub">Preview links show a chosen variant without assigning or counting the visitor. Click to copy.</div>
      <div class="stack-sm">${vs.map((v) => `<button type="button" class="btn sm" style="width:100%;justify-content:flex-start" data-act="exp-preview" data-vid="${v.id}">${variantChip(v, true)} Preview ${esc(v.key)} · ${esc(v.name)}</button>`).join("")}</div></section>
  </aside></div>`;
}

/* ---------- Results ---------- */
function diffOf(r, mode, metric, scale) {
  if (!r) return null;
  if (mode === "absolute" || (mode === "scaled" && metric.type !== "binomial")) return { pt: r.abs, lo: r.ciAbs[0], hi: r.ciAbs[1] };
  if (mode === "scaled") return { pt: r.abs * scale, lo: r.ciAbs[0] * scale, hi: r.ciAbs[1] * scale };
  return { pt: r.lift, lo: r.ci[0], hi: r.ci[1] };
}
function fmtDiff(x, mode, metric) {
  if (x == null || !isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (mode === "relative") return fmtLift(x);
  if (metric.type === "binomial") return mode === "scaled" ? `${sign}${a.toFixed(1)}/day` : `${sign}${(a * 100).toFixed(2)} pp`;
  return `${sign}${a.toFixed(2)}${metric.unit || ""}`;
}

function ciBar(d, verdict, span, mode, metric) {
  if (!d) return "";
  const pos = (x) => `${((x + span) / (2 * span)) * 100}%`;
  const lo = Math.max(-span, d.lo), hi = Math.min(span, d.hi);
  return `<div class="ci" aria-label="Interval ${fmtDiff(d.lo, mode, metric)} to ${fmtDiff(d.hi, mode, metric)}"><div class="axis"></div><div class="zero" style="left:50%"></div><div class="bar ${verdict}" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></div><div class="pt" style="left:calc(${pos(Math.max(-span, Math.min(span, d.pt)))} - 1px)"></div></div><div class="small" style="margin-top:2px">${fmtDiff(d.lo, mode, metric)} to ${fmtDiff(d.hi, mode, metric)}</div>`;
}
const fmtP = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));

export function metricTable(e, block, engine, ui, { compact = false, scale = 1 } = {}) {
  const { metric, rows } = block;
  const mode = ui.difference;
  const ds = rows.map((r) => diffOf(r.r, mode, metric, scale));
  const span = Math.max(mode === "relative" ? 0.1 : 1e-9, ...ds.filter(Boolean).map((d) => Math.max(Math.abs(d.lo), Math.abs(d.hi)))) * 1.1;
  const val = (s) => (!s || !s.n ? "—" : metric.type === "binomial" ? fmtPct(s.x / s.n, 2) : `${(s.sum / s.n).toFixed(2)}${metric.unit || ""}`);
  const bayes = engine === "bayesian";
  const corr = !bayes && rows.some((r) => r.r?.pAdj != null);
  const base = rows.find((r) => r.verdict === "baseline");
  const head = { relative: "Change", absolute: "Absolute change", scaled: metric.type === "binomial" ? "Scaled impact · conversions/day at 100%" : "Absolute change" }[mode];
  return `<div class="table-wrap"><table class="t ${compact ? "compact" : ""}" style="min-width:${bayes ? 860 : 780}px">
    <thead><tr><th>Variant</th><th class="num">Visitors</th><th class="num">${metric.type === "binomial" ? "Conversions" : "Average"}</th><th class="num">${metric.type === "binomial" ? "Conv. rate" : "Value"}</th>
      <th>${head} vs ${esc(base?.v.key || "A")} ${metric.higherIsBetter === false ? "<span class='faint'>(lower is better)</span>" : ""}</th>
      <th class="num">${bayes ? "Chance to beat" : corr ? "p-value (adjusted)" : "p-value"}</th>${bayes ? `<th class="num" title="Expected relative loss if you ship this variant and it's actually worse">Risk</th>` : ""}</tr></thead>
    <tbody>${rows.map(({ v, s, r, verdict, enough, suspicious }, k) => {
      const d = ds[k];
      const isBase = verdict === "baseline";
      return `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${variantChip(v)}<div><b>${esc(v.name)}</b>${isBase ? `<div class="small" style="margin:0">Baseline</div>` : ""}</div>${verdict === "won" ? `<span class="badge green">${metric.higherIsBetter === false ? "Better" : "Winning"}</span>` : verdict === "lost" ? `<span class="badge red">Worse</span>` : ""}${suspicious ? `<span class="badge amber" title="Changes above ${fmtPct(metric.maxChange ?? 0.5, 0)} are usually a tracking bug">Suspicious</span>` : ""}</div></td>
      <td class="num">${fmtInt(s?.n || 0)}</td><td class="num">${metric.type === "binomial" ? fmtInt(s?.x || 0) : val(s)}</td><td class="num"><b>${val(s)}</b></td>
      <td>${isBase ? `<span class="faint">—</span>` : !enough ? `<span class="faint">Not enough data</span><div class="small" style="margin:0">Needs ${metric.minSample ?? 100} ${metric.type === "binomial" ? "conversions" : "visitors"} across both</div>` : d ? `<b class="${verdict === "won" ? "up" : verdict === "lost" ? "down" : ""}">${fmtDiff(d.pt, mode, metric)}</b>${ciBar(d, verdict === "won" ? "won" : verdict === "lost" ? "lost" : "neutral", span, mode, metric)}` : "—"}</td>
      <td class="num">${isBase || !enough || !r ? "—" : bayes ? `<b>${fmtPct(r.chanceToWin, 0)}</b>` : `<b>${fmtP(r.pAdj ?? r.pValue)}</b>${r.pAdj != null ? `<div class="small" style="margin:0">raw ${fmtP(r.pValue)}</div>` : ""}`}</td>
      ${bayes ? `<td class="num">${isBase || !enough || !r ? "—" : `<span class="${r.riskB > 0.005 ? "down" : ""}">${fmtPct(r.riskB, 2)}</span>`}</td>` : ""}</tr>`;
    }).join("")}</tbody></table></div>`;
}

function sel(k, label, opts, v) {
  return `<label class="ctl"><span>${label}</span><select class="inp" data-res="${k}">${opts.map(([a, b]) => `<option value="${a}" ${String(v) === String(a) ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>`;
}

export function resultsControls(e, ui, a) {
  const phases = S.phasesOf(e);
  const curPhase = ui.phase ?? phases.length - 1;
  return `<div class="res-ctl">
    ${phases.length > 1 ? sel("phase", "Phase", phases.map((ph, i) => [i, `${i + 1}: ${fmtDate(ph.start)} – ${ph.end ? fmtDate(ph.end) : "now"}`]), curPhase) : ""}
    ${e.type === "bandit" ? "" : sel("baseline", "Baseline", a.vs.map((v, i) => [i, `${v.key} · ${v.name}`]), a.baseline)}
    ${e.type === "bandit" ? "" : sel("difference", "Difference", [["relative", "Relative"], ["absolute", "Absolute"], ["scaled", "Scaled impact"]], ui.difference)}
    ${e.type === "bandit" ? "" : sel("dimension", "Dimension", [["", "None"], ...Object.entries(Sim.DIMENSIONS).map(([k, d]) => [k, d.label])], ui.dimension)}
  </div>`;
}

function liftSeries(e, mid, a) {
  const metric = S.metric(mid);
  const ser = Sim.series(e, mid, { phase: a.phase });
  const opts = statOpts(e);
  return a.vs.map((v, i) => {
    if (i === a.baseline) return null;
    const pts = ser.map((d) => compare(metric, d.s[a.baseline], d.s[i], opts));
    return { label: `${v.key} vs ${a.vs[a.baseline].key}`, color: colorOf(v), values: pts.map((r) => (r ? r.lift : null)), band: { lo: pts.map((r) => (r ? r.ci[0] : null)), hi: pts.map((r) => (r ? r.ci[1] : null)) }, x: ser.map((d) => d.t) };
  }).filter(Boolean);
}

function chartFor(e, ui, a) {
  const metric = a.primary?.metric;
  if (!metric) return "";
  const mode = ui.chart;
  let x;
  let series;
  let fmt;
  let title;
  let extra = {};
  if (mode === "lift") {
    series = liftSeries(e, metric.id, a);
    x = series[0]?.x || [];
    fmt = (v) => fmtLift(v, 0);
    title = `Change vs ${a.vs[a.baseline].key} over time`;
    extra = { allowNeg: true, zero: true };
  } else {
    const ser = Sim.series(e, metric.id, { phase: a.phase, cumulative: mode === "cumulative" });
    x = ser.map((d) => d.t);
    series = a.vs.map((v, i) => ({ label: `${v.key} · ${v.name}`, color: colorOf(v), values: ser.map((d) => { const s = d.s[i]; return !s || !s.n ? null : metric.type === "binomial" ? s.x / s.n : s.sum / s.n; }) }));
    fmt = (v) => (metric.type === "binomial" ? fmtPct(v, 1) : v.toFixed(2));
    title = `${metric.name} ${mode === "cumulative" ? "cumulative" : "per day"}`;
  }
  return `<section class="card pad"><div class="card-head"><div><h2>${esc(metric.name)} over time</h2><div class="card-sub">${mode === "lift" ? `Cumulative change with its ${fmtPct(S.settings().ciLevel, 0)} interval. Early swings are normal; watch it settle.` : mode === "cumulative" ? "Cumulative rate per variant." : "Each day on its own. Noisier, but shows day-of-week patterns."}</div></div>
    <div class="seg" role="group" aria-label="Chart">${[["cumulative", "Cumulative"], ["daily", "Daily"], ["lift", "Change"]].map(([k, l]) => `<button type="button" aria-pressed="${mode === k}" data-res-chart="${k}">${l}</button>`).join("")}</div></div>
    ${lineChart({ x, series, fmt, title, ...extra })}</section>`;
}

const scaleFor = (e) => {
  const p = S.page(e.pageId);
  return (e.traffic ?? p?.traffic ?? 0) * Sim.targetingFactor(e.targeting, e);
};

function dimensionBlock(e, ui, a) {
  if (!ui.dimension || !a.primary) return "";
  const D = Sim.DIMENSIONS[ui.dimension];
  const cells = Sim.dimensionTotals(e, ui.dimension, { phase: a.phase });
  return `<section class="card"><div class="toolbar"><div><b>${esc(a.primary.metric.name)} by ${esc(D.label.toLowerCase())}</b><div class="small" style="margin:2px 0 0">Breakdowns are for exploring. Smaller groups are noisier, and many slices make false positives likely.</div></div></div>
    ${cells.map((c) => `<div style="padding:12px 20px 0" class="eyebrow">${esc(c.label)} · ${fmtInt(c.per.reduce((x, y) => x + y.n, 0))} visitors</div>${metricTable(e, metricBlock(e, e.primaryMetric, c.per, { baseline: a.baseline, kind: "primary" }), a.engine, ui, { compact: true, scale: scaleFor(e) })}`).join("")}</section>`;
}

function banditView(e, a, ui) {
  const metric = a.primary.metric;
  const daily = a.daily.filter((d) => d.weights);
  const wChart = lineChart({ x: daily.map((d) => d.t), series: a.vs.map((v, i) => ({ label: `${v.key} · ${v.name}`, color: colorOf(v), values: daily.map((d) => d.weights[i] / 100) })), fmt: (v) => fmtPct(v, 0), title: "Traffic share per arm", height: 220 });
  const top = Math.max(...a.bandit.best);
  return `<section class="card"><div class="toolbar"><div><b>Arms · ${esc(metric.name)}</b><div class="small" style="margin:2px 0 0">Bandit · chance each arm is the best, from all data in this phase · ${ENGINE_TEXT(e)}</div></div>${resultsControls(e, ui, a)}</div>
    <div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Arm</th><th class="num">Traffic today</th><th class="num">Visitors</th><th class="num">Conversions</th><th class="num">Conv. rate</th><th>Chance to be best</th></tr></thead><tbody>
    ${a.primary.rows.map((r, i) => `<tr><td><div class="row" style="gap:10px">${variantChip(r.v)} <b>${esc(r.v.name)}</b>${a.bandit.best[i] === top ? ` <span class="badge green">Leading</span>` : ""}</div></td><td class="num">${fmtPct(a.bandit.weights[i], 0)}</td><td class="num">${fmtInt(r.s?.n || 0)}</td><td class="num">${fmtInt(r.s?.x || 0)}</td><td class="num"><b>${r.s?.n ? fmtPct(r.s.x / r.s.n, 2) : "—"}</b></td>
      <td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="track" style="width:140px;margin:0"><div class="fill ${a.bandit.best[i] >= S.settings().ctw ? "green" : ""}" style="width:${a.bandit.best[i] * 100}%"></div></div><b>${fmtPct(a.bandit.best[i], 0)}</b></div></td></tr>`).join("")}</tbody></table></div></section>
  <section class="card pad"><h2>Traffic share over time</h2><div class="card-sub">Even for the first 2 days, then re-weighted daily toward the arm most likely to be best.</div>${wChart}</section>`;
}

export function resultsBody(e, ui, { report = false } = {}) {
  if (!S.phasesOf(e).length) {
    return `<div class="card"><div class="empty"><h3>No results yet</h3><div>Results show once the experiment starts and each variant has a conversion.</div>${!e.archived && S.canEdit() && !report ? `<div style="margin-top:14px"><button type="button" class="btn sm primary" data-act="exp-start">Start experiment</button></div>` : ""}</div></div>`;
  }
  const a = analyze(e, { phase: ui.phase, baseline: ui.baseline });
  const vs = a.vs;
  const banners = [];
  const phases = a.phases;
  if (!report) {
    if (e.status === "stopped" && !e.result) banners.push(callout("warn", `${e.imported ? "Imported." : `Stopped automatically on ${fmtDate(e.endedAt)}. Visitors now see the page default again.`} Record a result to finish.`, `<button type="button" class="btn xs" data-act="exp-stop">Record result</button>`));
    if (phases.length > 1 && a.phase !== phases.length - 1) banners.push(callout("info", `Showing phase ${a.phase + 1} of ${phases.length} (${fmtDate(phases[a.phase].start)} – ${fmtDate(phases[a.phase].end)}).`));
    else if (phases.length > 1) banners.push(callout("info", `Phase ${phases.length} started ${fmtDate(phases[phases.length - 1].start)} (${esc(phases[phases.length - 1].reason || "")}). Results count from then; earlier phases are under Phase.`));
  }
  if (a.collecting) banners.push(callout("info", `<b>Collecting data.</b> ${fmtInt(a.visitors)} visitors · ${fmtInt(a.primaryConversions.reduce((x, y) => x + y, 0))} conversions so far. Results show once each variant has a conversion. Check back tomorrow.`));
  if (a.srm.bad) banners.push(callout("bad", `<b>Traffic doesn't match the planned split.</b> ${vs.map((v, i) => `${v.key} ${fmtPct(a.srm.observed[i] / Math.max(1, a.visitors), 0)}`).join(" · ")}, expected ${a.srm.expected.map((x) => Math.round(x)).join("/")}. Results may be unreliable. Common causes: cached pages, redirects, bots.`, report ? "" : `<a class="btn xs" href="#/experiment/${e.id}/health">View health</a>`));
  if (a.multi.bad) banners.push(callout("bad", `<b>${fmtPct(a.multi.rate, 1)} of visitors saw more than one variant.</b> Usually caused by cookies being cleared or the hash attribute changing. They're kept in their first variant.`));
  if (a.noTraffic) banners.push(callout("bad", `<b>No visitors for 3 days.</b> Check that ${esc(S.page(e.pageId)?.name)} is live and the experiment script is on the page.`));
  if (!report) e.midTestEdits.forEach((m) => banners.push(callout("warn", `<b>${esc(m.variantKey)} was edited on ${fmtDateTime(m.at)}</b> (${esc(m.section)} section). Visitors before and after saw different versions of ${esc(m.variantKey)}.`)));
  a.guardFail.forEach((g) => banners.push(callout("bad", `<b>Guardrail failing:</b> ${esc(g.v.key)} makes <b>${esc(g.metric.name)}</b> ${fmtPct(g.harm, 1)} worse, past its ${fmtPct(g.cut, 0)} cutoff.`)));
  if (a.primary?.rows.some((r) => r.suspicious)) banners.push(callout("warn", `<b>Suspiciously large change.</b> A change above ${fmtPct(a.primary.metric.maxChange ?? 0.5, 0)} on ${esc(a.primary.metric.name)} is usually a tracking problem. Check the variant before trusting it.`));

  const metric = a.primary?.metric;
  const others = a.primary ? a.primary.rows.filter((r) => r.i !== a.baseline && r.r && r.enough) : [];
  const best = [...others].sort((x, y) => (metric.higherIsBetter === false ? x.r.lift - y.r.lift : y.r.lift - x.r.lift))[0];
  const topSec = a.secondary.flatMap((b) => b.rows.filter((r) => r.i !== a.baseline && r.r && r.enough).map((r) => ({ ...r, metric: b.metric }))).sort((x, y) => Math.abs(y.r.lift) - Math.abs(x.r.lift))[0];
  const conv = a.primary ? a.primary.rows.reduce((s, r) => s + (r.s?.x ?? 0), 0) : 0;
  const winnerFromResult = e.result === "won" ? vs.find((v) => v.id === e.winnerVariantId) : null;

  let decision = "";
  if (!report && e.status === "running" && a.decision) {
    const d = a.decision;
    const tone = d.kind === "ship" ? "good" : d.kind === "rollback" || d.kind === "unhealthy" ? "bad" : d.kind === "review" ? "warn" : "info";
    const act = d.kind === "ship" && can(e, "stop") ? `<button type="button" class="btn sm primary" data-act="exp-stop" data-winner="${d.best.v.id}">Stop &amp; make ${esc(d.best.v.key)} the default</button>`
      : d.kind === "rollback" && can(e, "stop") ? `<button type="button" class="btn sm" data-act="exp-stop">Stop &amp; keep Control</button>` : "";
    decision = `<div class="card decision"><span class="modal-ic ${tone === "good" ? "blue" : tone === "bad" ? "red" : tone === "warn" ? "amber" : "gray"}">${tone === "good" ? icon.check(18) : tone === "bad" || tone === "warn" ? icon.warn(18) : icon.clock(18)}</span><div class="grow"><h3>${esc(d.label)}</h3><div class="muted" style="font-size:14px">${esc(d.text)}${d.kind === "ship" ? `. Declaring ${esc(d.best.v.key)} makes it the page's default, so every visitor sees it. A stays as a variant you can switch back to.` : ""}</div>${d.warn ? `<div class="decision-warn">${icon.warn(14)} ${esc(d.warn)}</div>` : ""}</div>${act}</div>`;
  } else if (e.status === "stopped" && e.result) {
    const rel = vs.find((v) => v.id === e.releasedVariantId);
    decision = `<div class="card decision"><span class="modal-ic blue">${icon.check(18)}</span><div class="grow"><h3>${esc(RESULT_LABEL[e.result])}${winnerFromResult ? ` · ${esc(winnerFromResult.key)}` : ""}</h3><div class="muted" style="font-size:14px">${rel ? `${esc(rel.key)} · ${esc(rel.name)} is the page default.` : ""} ${report ? "" : "A stopped test can't restart; duplicate it to run again."}</div></div>${report ? "" : `<button type="button" class="btn sm" data-act="exp-duplicate">Duplicate</button>`}</div>`;
  }
  const conclusion = e.status === "stopped" ? `<section class="card pad"><div class="card-head"><div><h2>Conclusion</h2><div class="card-sub">What the team learned. Shown in reports made from this test.</div></div>${!report && can(e, "editText") ? `<button type="button" class="btn xs" data-act="exp-edit-summary">${e.analysisSummary ? "Edit" : "Write conclusion"}</button>` : ""}</div>${e.analysisSummary ? `<p style="white-space:pre-wrap;margin:8px 0 0">${esc(e.analysisSummary)}</p>` : `<p class="faint" style="margin:8px 0 0">No conclusion written yet.</p>`}</section>` : "";

  const scale = scaleFor(e);
  const reports = report ? [] : S.get().reports.filter((r) => r.expId === e.id);
  const tools = report ? "" : `<div class="row" style="justify-content:flex-end;gap:8px;margin-bottom:12px"><span class="faint" style="font-size:13px;margin-right:auto">${ENGINE_TEXT(e)} · simulated data, updated ${timeAgo(Math.floor(S.now() / 600000) * 600000, S.now())}</span><button type="button" class="btn xs" data-act="res-refresh">${icon.clock(14)} Update</button><button type="button" class="btn xs" data-act="res-csv">Export CSV</button>${S.canEdit() ? `<button type="button" class="btn xs" data-act="exp-report">Create report</button>` : ""}</div>`;

  if (e.type === "bandit" && a.primary) {
    return `${banners.join("")}${tools}${decision}${a.collecting ? "" : banditView(e, a, ui)}${conclusion}`;
  }

  return `${banners.join("")}${tools}
  <div class="stats4">
    <div class="card stat"><div class="k">Visitors in test</div><div class="v">${fmtInt(a.visitors)}</div><div class="s">Across ${vs.length} variants${phases.length > 1 ? ` · phase ${a.phase + 1}` : ""}</div></div>
    <div class="card stat"><div class="k">${esc(metric?.type === "binomial" ? "Conversions (primary)" : "Primary metric")}</div><div class="v">${metric ? fmtInt(conv) : "—"}</div><div class="s">${esc(metric?.name || "No primary metric")}</div></div>
    <div class="card stat"><div class="k">Best variant</div><div class="v ${best?.verdict === "won" ? "up" : ""}">${best ? `${esc(best.v.key)} · ${fmtLift(best.r.lift)}` : "—"}</div><div class="s">${best ? (a.engine === "bayesian" ? `${fmtPct(best.r.chanceToWin, 0)} chance to beat ${esc(vs[a.baseline].key)}` : `p = ${fmtP(best.r.pAdj ?? best.r.pValue)}`) : "Waiting for data"}</div></div>
    <div class="card stat"><div class="k">Top secondary</div><div class="v">${topSec ? `${esc(topSec.v.key)} · ${fmtLift(topSec.r.lift, 0)}` : "—"}</div><div class="s">${topSec ? `${esc(topSec.metric.name)} vs ${esc(vs[a.baseline].key)}` : "No secondary metrics"}</div></div>
  </div>
  ${decision}
  ${a.primary ? `<section class="card"><div class="toolbar"><div><b>Primary metric · ${esc(metric.name)}</b><div class="small" style="margin:2px 0 0">${a.engine === "bayesian" ? `Bayesian · ${fmtPct(S.settings().ciLevel, 0)} credible interval` : `Frequentist · ${fmtPct(S.settings().ciLevel, 0)} confidence interval${e.sequential ? " · sequential" : ""}${S.settings().correction !== "none" ? ` · ${S.settings().correction === "holm" ? "Holm-Bonferroni" : "Benjamini-Hochberg"} correction` : ""}`}${e.cuped ? " · CUPED" : ""}${e.activationMetric ? ` · activated by ${esc(S.metric(e.activationMetric)?.name)}` : ""}</div></div>
      ${resultsControls(e, ui, a)}</div>
    ${metricTable(e, a.primary, a.engine, ui, { scale })}</section>
  ${dimensionBlock(e, ui, a)}
  ${chartFor(e, ui, a)}` : callout("warn", "No primary metric is set, so there's nothing to decide on.")}
  ${a.secondary.length ? `<section class="card"><div class="toolbar"><b>Secondary metrics</b></div>${a.secondary.map((b) => `<div style="padding:12px 20px 0" class="eyebrow">${esc(b.metric.name)}</div>${metricTable(e, b, a.engine, ui, { compact: true, scale })}`).join("")}</section>` : ""}
  ${a.guardrails.length ? `<section class="card"><div class="toolbar"><b>Guardrails</b><span class="faint" style="font-size:13px">Fails when a variant is clearly worse by more than its cutoff</span></div>${a.guardrails.map((b) => `<div style="padding:12px 20px 0" class="eyebrow">${esc(b.metric.name)} · may get up to ${fmtPct(guardCutoff(b.metric, e), 0)} worse</div><div class="guard-states">${b.rows.filter((r) => r.guard || (r.i !== a.baseline && !r.enough)).map((r) => guardChip(r)).join("")}</div>${metricTable(e, b, a.engine, ui, { compact: true, scale })}`).join("")}</section>` : ""}
  ${conclusion}
  ${reports.length ? `<section class="card pad"><h2>Reports</h2><div class="card-sub">Saved views of these results with fixed settings, for sharing.</div><ul class="timeline">${reports.map((r) => `<li>${avatar(r.by)}<div><a href="#/report/${r.id}"><b>${esc(r.title)}</b></a><div class="when">${fmtDate(r.createdAt)}</div></div></li>`).join("")}</ul></section>` : ""}`;
}

function guardChip(r) {
  const g = r.guard;
  if (!g || g.status === "pending") return `<span class="gchip pending">${esc(r.v.key)} · not enough data</span>`;
  const worse = g.harm > 0 ? `${fmtPct(g.harm, 1)} worse` : `${fmtPct(-g.harm, 1)} better`;
  const label = { pass: "Within cutoff", watch: "Watch", fail: "Failing" }[g.status];
  const tip = g.status === "pass" ? `At worst ${fmtPct(Math.max(0, g.worst), 1)} worse` : g.status === "watch" ? `Could be up to ${fmtPct(g.worst, 1)} worse` : `Past the ${fmtPct(g.cut, 0)} cutoff`;
  return `<span class="gchip ${g.status}" title="${esc(tip)}"><b>${esc(r.v.key)}</b> ${label} · ${worse}</span>`;
}

/* ---------- Health ---------- */
function chi2(obs, expected) {
  const t = obs.reduce((x, y) => x + y, 0);
  const ws = expected.reduce((x, y) => x + y, 0);
  if (!t || !ws) return 0;
  return obs.reduce((c, o, i) => {
    const ex = (t * expected[i]) / ws;
    return c + (ex ? (o - ex) ** 2 / ex : 0);
  }, 0);
}

function health(e) {
  if (!S.phasesOf(e).length) return `<div class="card"><div class="empty"><h3>No traffic yet</h3><div>Health checks run once the experiment starts.</div></div></div>`;
  const ui = uiFor(e);
  const a = analyze(e, { phase: ui.phase });
  const st = S.settings();
  const vs = a.vs;
  const chart = lineChart({
    x: a.daily.map((d) => d.t),
    series: vs.map((v, i) => ({ label: `${v.key} · ${v.name}`, color: colorOf(v), values: a.daily.map((d) => d.v[i]) })),
    fmt: (v) => fmtInt(v),
    title: "Visitors per day",
    height: 220,
  });
  const ok = (good, label, text, warn = false) => `<li class="${good ? "ok" : warn ? "warn" : "bad"}"><span class="ic">${good ? "✓" : warn ? "!" : "✕"}</span><span><b>${label}</b><br><span class="muted">${text}</span></span></li>`;
  const pm = a.primary?.metric;
  const dims = ["device", "country", "source"].map((k) => ({ D: Sim.DIMENSIONS[k], cells: Sim.dimensionTotals(e, k, { phase: a.phase }) }));
  const ws = a.srm.expected.reduce((x, y) => x + y, 0);
  return `<section class="card pad"><h2>Health checks</h2><div class="card-sub">${a.phases.length > 1 ? `Phase ${a.phase + 1} · ` : ""}Run on every update.</div>
    <ul class="checklist" style="margin-top:8px">
      ${ok(!a.srm.bad, "Traffic split (SRM)", e.type === "bandit" ? `Checked against the bandit's daily weights (p = ${a.srm.pValue.toFixed(3)}).` : a.srm.bad ? `Observed split differs from planned (p = ${a.srm.pValue.toExponential(1)}, flagged below ${st.srmThreshold}). Common causes: cached pages, redirects, bots.` : `Observed split matches the plan (p = ${a.srm.pValue.toFixed(3)}).`)}
      ${ok(!a.multi.bad, "Multiple exposures", `${fmtInt(a.multi.count)} visitors (${fmtPct(a.multi.rate, 2)}) saw more than one variant${a.multi.bad ? `, above the ${fmtPct(st.multiExposureThreshold, 0)} limit` : ""}.`)}
      ${ok(!a.noTraffic, "Traffic is flowing", a.noTraffic ? "No visitors in the last 3 days." : `${fmtInt(a.visitors)} visitors so far.`)}
      ${ok(!a.lowData, "Enough data", pm ? (a.lowData ? `Some comparisons on ${esc(pm.name)} have fewer than ${pm.minSample ?? 100} conversions. Their results stay hidden until then.` : `Every comparison on ${esc(pm.name)} has at least ${pm.minSample ?? 100} conversions.`) : "No primary metric.", true)}
      ${ok(a.guardFail.length === 0 && a.guardWatch.length === 0, "Guardrails", a.guardFail.length ? a.guardFail.map((g) => `${g.v.key} makes ${g.metric.name} ${fmtPct(g.harm, 1)} worse (cutoff ${fmtPct(g.cut, 0)})`).join("; ") : a.guardWatch.length ? a.guardWatch.map((g) => `${g.v.key} could make ${g.metric.name} up to ${fmtPct(g.worst, 1)} worse (cutoff ${fmtPct(g.cut, 0)}). Keep watching.`).join("; ") : e.guardrailMetrics.length ? "Every guardrail is within its cutoff." : "No guardrail metrics set.", a.guardFail.length === 0)}
      ${ok(e.midTestEdits.length === 0, "Variants unchanged during test", e.midTestEdits.length ? `${e.midTestEdits.length} mid-test edit${e.midTestEdits.length > 1 ? "s" : ""} logged on Results.` : "No variant was edited after start.", true)}
    </ul></section>
  <section class="card"><div class="toolbar"><b>Traffic split</b><span class="faint" style="font-size:13px">Sample ratio mismatch test, flagged when p &lt; ${st.srmThreshold}</span></div>
    <div class="table-wrap"><table class="t compact"><thead><tr><th>Variant</th><th class="num">Expected share</th><th class="num">Expected visitors</th><th class="num">Observed visitors</th><th class="num">Observed share</th></tr></thead>
    <tbody>${vs.map((v, i) => `<tr><td><div class="row" style="gap:10px">${variantChip(v)} ${esc(v.name)}</div></td><td class="num">${fmtPct(a.srm.expected[i] / ws, 1)}</td><td class="num">${fmtInt((a.visitors * a.srm.expected[i]) / ws)}</td><td class="num"><b>${fmtInt(a.srm.observed[i])}</b></td><td class="num">${fmtPct(a.srm.observed[i] / Math.max(1, a.visitors), 1)}</td></tr>`).join("")}</tbody></table></div></section>
  <section class="card"><div class="toolbar"><b>Traffic by dimension</b><span class="faint" style="font-size:13px">A mismatch in one slice often points at the cause</span></div>
    <div class="table-wrap"><table class="t compact" style="min-width:640px"><thead><tr><th>Slice</th>${vs.map((v) => `<th class="num">${esc(v.key)}</th>`).join("")}<th class="num">Mismatch χ²</th></tr></thead><tbody>
    ${dims.map(({ D, cells }) => cells.map((c) => `<tr><td><span class="faint">${esc(D.label)} ·</span> ${esc(c.label)}</td>${c.per.map((x) => `<td class="num">${fmtInt(x.n)}</td>`).join("")}<td class="num">${chi2(c.per.map((x) => x.n), a.srm.expected).toFixed(1)}</td></tr>`).join("")).join("")}</tbody></table></div></section>
  <section class="card pad"><h2>Visitors per day</h2><div class="card-sub">By variant, all phases. Weekends usually dip.</div>${chart}</section>`;
}

/* ---------- History ---------- */
function history(e) {
  const items = [...e.history].sort((a, b) => b.at - a.at);
  return `<div class="grid2"><section class="card pad"><h2>History</h2><div class="card-sub">Every change to this experiment.</div>
      <ul class="timeline">${items.map((h) => `<li>${h.by === "system" ? `<span class="avatar" style="background:var(--text-3)">⚙</span>` : avatar(h.by)}<div><div>${esc(h.by === "system" ? "System" : S.user(h.by).name)} · ${esc(h.text)}</div><div class="when">${fmtDateTime(h.at)}</div></div></li>`).join("")}</ul></section>
    <section class="card pad"><h2>Comments</h2><div class="card-sub">Discuss results with your team. Watchers are notified.</div>
      <form data-comment><label class="sr-only" for="cm">Comment</label><textarea id="cm" name="text" class="inp" placeholder="Write a comment" ${S.canEdit() ? "" : "disabled"}></textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="submit" class="btn sm primary" ${S.canEdit() ? "" : "disabled"}>Comment</button></div></form>
      <ul class="timeline">${e.comments.length ? [...e.comments].reverse().map((c) => `<li>${avatar(c.by)}<div><div><b>${esc(S.user(c.by).name)}</b> <span class="when">${timeAgo(c.at, S.now())}</span></div><div style="white-space:pre-wrap">${esc(c.text)}</div>${c.by === S.get().currentUserId ? `<button type="button" class="link-btn" style="font-size:13px" data-act="exp-del-comment" data-cid="${c.id}">Delete</button>` : ""}</div></li>`).join("") : `<li><span></span><span class="faint">No comments yet.</span></li>`}</ul></section></div>`;
}

export function render({ id, tab = "overview" }) {
  const e = S.exp(id);
  if (!e) return `<div class="card"><div class="empty"><h3>Experiment not found</h3><div>It may have been deleted.</div><div style="margin-top:14px"><a class="btn sm" href="#/experiments">Back to Experiments</a></div></div></div>`;
  const body = tab === "results" ? resultsBody(e, uiFor(e)) : tab === "health" ? health(e) : tab === "history" ? history(e) : overview(e);
  return `<div data-id="${e.id}">${header(e, tab)}${body}</div>`;
}

// Results controls: change the view (or a report's saved settings).
export function bindResults(root, ui, onChange) {
  root.querySelectorAll("[data-res]").forEach((s) =>
    s.addEventListener("change", () => {
      const k = s.dataset.res;
      ui[k] = k === "phase" || k === "baseline" ? Number(s.value) : s.value;
      if (k === "phase") ui.baseline = 0;
      onChange();
    }),
  );
  root.querySelectorAll("[data-res-chart]").forEach((b) => b.addEventListener("click", () => {
    ui.chart = b.dataset.resChart;
    onChange();
  }));
}

export function bind(root, rerender, { id }) {
  const e = S.exp(id);
  if (!e) return;
  bindResults(root, uiFor(e), () => rerender());
  const commit = (text) => {
    S.log(e, text);
    S.save();
  };
  root.querySelectorAll("[data-weight]").forEach((inp) =>
    inp.addEventListener("change", () => {
      e.weights[Number(inp.dataset.weight)] = Math.max(0, Math.min(100, Number(inp.value) || 0));
      commit(`Changed the traffic split to ${e.weights.join("/")}`);
    }),
  );
  root.querySelector("[data-coverage]")?.addEventListener("change", (ev) => {
    e.coverage = Math.max(0, Math.min(100, Number(ev.target.value) || 0));
    commit(`Set rollout to ${e.coverage}%`);
  });
  root.querySelectorAll("[data-t]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const k = inp.dataset.t;
      e.targeting[k] = inp.type === "checkbox" ? inp.checked : inp.value.trim();
      commit(`Changed targeting: ${k}`);
    }),
  );
  if (can(e, "editVariants")) {
    bindConditions(root, "ov", () => e.targeting.conditions, (c) => {
      const before = JSON.stringify(e.targeting.conditions || []);
      e.targeting.conditions = c;
      if (JSON.stringify(c) !== before) commit(c.length ? `Set targeting conditions: ${c.map(condText).join(" AND ")}` : "Removed targeting conditions");
    });
  }
  root.querySelectorAll("[data-asg]").forEach((inp) => inp.addEventListener("change", () => {
    const k = inp.dataset.asg;
    e.assignment[k] = inp.type === "checkbox" ? inp.checked : inp.value;
    if (k === "hashAttribute" && e.assignment.fallback === inp.value) e.assignment.fallback = "";
    commit(`Changed assignment: ${k}`);
  }));
  root.querySelector("[data-primary]")?.addEventListener("change", (ev) => {
    e.primaryMetric = ev.target.value || null;
    e.secondaryMetrics = e.secondaryMetrics.filter((m) => m !== e.primaryMetric);
    e.guardrailMetrics = e.guardrailMetrics.filter((m) => m !== e.primaryMetric);
    commit(`Set the primary metric to ${S.metric(e.primaryMetric)?.name || "none"}`);
  });
  root.querySelector("[data-activation]")?.addEventListener("change", (ev) => {
    e.activationMetric = ev.target.value || null;
    commit(`Set the activation metric to ${S.metric(e.activationMetric)?.name || "none"}`);
  });
  root.querySelector("[data-mde]")?.addEventListener("change", (ev) => {
    e.plannedMde = Number(ev.target.value);
    commit(`Planned to detect a ${fmtPct(e.plannedMde, 0)} lift`);
  });
  root.querySelectorAll("[data-gcut]").forEach((inp) => inp.addEventListener("change", () => {
    const v = Number(inp.value) / 100;
    if (!(v >= 0.005 && v <= 0.5)) return toast("Set a cutoff between 0.5% and 50%", "bad");
    e.guardrailCutoffs = { ...(e.guardrailCutoffs || {}), [inp.dataset.gcut]: v };
    commit(`Set the ${S.metric(inp.dataset.gcut)?.name} guardrail cutoff to ${fmtPct(v, 1)}`);
  }));
  root.querySelectorAll("[data-mlist]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const k = cb.dataset.mlist;
      e[k] = cb.checked ? [...new Set([...e[k], cb.value])] : e[k].filter((m) => m !== cb.value);
      commit(`${cb.checked ? "Added" : "Removed"} ${k === "guardrailMetrics" ? "guardrail" : "secondary"} metric ${S.metric(cb.value)?.name}`);
    }),
  );
  root.querySelectorAll("[data-flag]").forEach((cb) =>
    cb.addEventListener("change", () => {
      e[cb.dataset.flag] = cb.checked;
      commit(`${cb.checked ? "Turned on" : "Turned off"} ${{ sequential: "sequential testing", cuped: "CUPED", leadAttribution: "lead attribution" }[cb.dataset.flag]}`);
    }),
  );
  root.querySelector("[data-key]")?.addEventListener("change", (ev) => {
    const v = ev.target.value.trim();
    const err = root.querySelector("#k-err");
    const clash = S.get().experiments.find((x) => x.trackingKey === v && x.id !== e.id);
    const msg = !v ? "Enter a tracking key" : !/^[a-z0-9-]+$/.test(v) ? "Lowercase letters, numbers and hyphens only" : clash ? `Already used by “${clash.name}”` : "";
    if (msg) {
      err.innerHTML = `<div class="err">${icon.warn(14)} ${esc(msg)}</div>`;
      ev.target.setAttribute("aria-invalid", "true");
      return;
    }
    e.trackingKey = v;
    commit(`Changed the tracking key to ${v}`);
  });
  root.querySelector("[data-comment]")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = ev.target.text.value.trim();
    if (!text) return;
    e.comments.push({ id: uid("c"), at: S.now(), by: S.get().currentUserId, text });
    S.save();
  });
}

export function resultsCsv(e, ui) {
  const a = analyze(e, { phase: ui.phase, baseline: ui.baseline });
  const rows = [["metric", "kind", "variant", "visitors", "conversions_or_sum", "value", "relative_change", "ci_low", "ci_high", e.statsEngine === "bayesian" ? "chance_to_beat" : "p_value", "risk"]];
  [a.primary, ...a.secondary, ...a.guardrails].filter(Boolean).forEach((b) => b.rows.forEach((r) => {
    const s = r.s || {};
    const val = !s.n ? "" : b.metric.type === "binomial" ? (s.x / s.n).toFixed(5) : (s.sum / s.n).toFixed(4);
    rows.push([b.metric.name, b.kind, `${r.v.key} ${r.v.name}`, s.n ?? 0, b.metric.type === "binomial" ? s.x ?? 0 : (s.sum ?? 0).toFixed(2), val, r.r ? r.r.lift.toFixed(5) : "", r.r ? r.r.ci[0].toFixed(5) : "", r.r ? r.r.ci[1].toFixed(5) : "", r.r ? (r.r.chanceToWin ?? r.r.pAdj ?? r.r.pValue).toFixed(5) : "", r.r?.riskB != null ? r.r.riskB.toFixed(5) : ""]);
  }));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${e.trackingKey}-results.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Exported results as CSV");
}

const expOf = (el) => S.exp(el.closest("[data-id]").dataset.id);
const evenSplit = (e) => {
  const n = e.variantIds.length;
  const even = Math.floor(100 / n);
  e.weights = e.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
};

Object.assign(acts, {
  "exp-engine": (el) => {
    const e = expOf(el);
    if (!can(e, "analysis")) return;
    e.statsEngine = el.dataset.engine;
    if (e.statsEngine === "bayesian") e.sequential = false;
    S.log(e, `Switched the stats engine to ${e.statsEngine}`);
    S.save();
  },
  "exp-split-even": (el) => {
    const e = expOf(el);
    evenSplit(e);
    S.log(e, `Split traffic evenly (${e.weights.join("/")})`);
    S.save();
  },
  "exp-add-variant": (el) => {
    const e = expOf(el);
    if (!can(e, "editVariants")) return;
    e.variantIds.push(el.dataset.vid);
    evenSplit(e);
    S.log(e, `Added variant ${S.variantsOf(e)[e.variantIds.length - 1].key} and split evenly`);
    S.save();
  },
  "exp-remove-variant": (el) => {
    const e = expOf(el);
    if (!can(e, "editVariants")) return;
    const idx = e.variantIds.indexOf(el.dataset.vid);
    const key = S.variantsOf(e)[idx]?.key;
    e.variantIds.splice(idx, 1);
    evenSplit(e);
    S.log(e, `Removed variant ${key} and split evenly`);
    S.save();
  },
  "exp-preview": (el) => {
    const e = expOf(el);
    const p = S.page(e.pageId);
    if (S.isUrlTest(e)) {
      const v = S.variantsOf(e).find((x) => x.id === el.dataset.vid);
      const url = /^https?:/.test(v?.url || "") ? v.url : `https://example.edu${v?.url || ""}`;
      return copyText(`${url}${url.includes("?") ? "&" : "?"}exp-preview=${e.trackingKey}:${v?.key}`);
    }
    const v = p?.variants.find((x) => x.id === el.dataset.vid);
    copyText(`https://example.edu${p?.path}?exp-preview=${e.trackingKey}:${v?.key}`);
  },
  "res-refresh": (el, rr) => {
    toast("Results updated");
    rr();
  },
  "res-csv": (el) => {
    const e = expOf(el);
    resultsCsv(e, uiFor(e));
  },
  "exp-report": (el) => {
    const e = expOf(el);
    const ui = uiFor(e);
    createReport(e, { phase: ui.phase ?? S.phasesOf(e).length - 1, baseline: ui.baseline, difference: ui.difference, dimension: ui.dimension, chart: ui.chart });
  },
  "exp-edit-summary": (el) => {
    const e = expOf(el);
    openModal({
      title: "Conclusion",
      wide: true,
      body: `<div class="field"><label for="es">What did you learn?</label><textarea id="es" name="summary" class="inp" style="min-height:160px" placeholder="What happened, why you think so, and what to try next">${esc(e.analysisSummary || "")}</textarea></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd) => {
        e.analysisSummary = String(fd.get("summary")).trim();
        S.log(e, "Edited the conclusion");
        S.save();
        closeModal();
      },
    });
  },
  "exp-del-comment": (el) => {
    const e = expOf(el);
    e.comments = e.comments.filter((c) => c.id !== el.dataset.cid);
    S.save();
  },
  "exp-edit-info": (el) => {
    const e = expOf(el);
    if (!can(e, "editText")) return toast(why(e, "editText"), "bad");
    openModal({
      title: "Edit name & details",
      wide: true,
      body: `<div class="field"><label for="ei-name">Experiment name</label><input id="ei-name" name="name" class="inp" value="${esc(e.name)}"><div data-err="name"></div></div>
        <div class="field"><label for="ei-hyp">Hypothesis</label><textarea id="ei-hyp" name="hypothesis" class="inp">${esc(e.hypothesis)}</textarea></div>
        <div class="field"><label for="ei-desc">Description <span class="opt">· optional</span></label><textarea id="ei-desc" name="description" class="inp">${esc(e.description)}</textarea></div>
        <div class="row"><div class="grow field"><label for="ei-tags">Tags</label>${tagPicker({ id: "ei-tags", selected: e.tags })}</div>
        <div class="grow field"><label for="ei-owner">Owner</label><select id="ei-owner" name="owner" class="inp">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === e.ownerId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div></div>
        ${customFieldInputs(e)}`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        if (!name) {
          form.querySelector("[data-err=name]").innerHTML = `<div class="err">${icon.warn(14)} Enter a name</div>`;
          return;
        }
        const cf = {};
        S.get().customFields.forEach((f) => (cf[f.id] = String(fd.get(`cf-${f.id}`) || "").trim()));
        Object.assign(e, {
          name,
          hypothesis: String(fd.get("hypothesis")).trim(),
          description: String(fd.get("description")).trim(),
          tags: String(fd.get("tags")).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          ownerId: fd.get("owner"),
          customFields: cf,
        });
        S.log(e, "Edited name and details");
        S.save();
        closeModal();
      },
    });
  },
});
