// Insights (dashboard, learnings, timeline, metric effects), holdouts,
// shareable reports and experiment templates.
import * as S from "../store.js";
import { acts, go } from "../actions.js";
import { analyze, statusPill } from "../analysis.js";
import { icon, pill, avatar, variantChip, openModal, closeModal, confirmModal, emptyRow, callout } from "../ui.js";
import { esc, fmtDate, fmtInt, fmtPct, fmtLift, DAY, toast, uid, copyText, startOfDay } from "../util.js";
import { resultsBody, bindResults, defaultRes } from "./detail.js";
import { openCreate } from "./create.js";
import { RESULT_LABEL } from "../store.js";

/* ---------- Insights ---------- */
let itab = "dashboard";
let imetric = "m_lead";
let irange = 180;

function primaryLift(e) {
  if (!S.phasesOf(e).length || !e.primaryMetric) return null;
  const a = analyze(e);
  const w = e.winnerVariantId ? a.primary?.rows.find((r) => r.v.id === e.winnerVariantId) : a.primary?.rows.slice(1).filter((r) => r.r).sort((x, y) => y.r.lift - x.r.lift)[0];
  return w?.r ? { v: w.v, lift: w.r.lift, verdict: w.verdict } : null;
}

export function renderInsights() {
  const st = S.get();
  const now = S.now();
  const exps = st.experiments.filter((e) => !e.virtualVariants);
  const inRange = (e) => (e.startedAt ?? e.createdAt) >= now - irange * DAY;
  const tabs = [["dashboard", "Dashboard"], ["learnings", "Learnings"], ["timeline", "Timeline"], ["effects", "Metric effects"]];
  let body = "";
  if (itab === "dashboard") {
    const started = exps.filter((e) => e.startedAt && inRange(e));
    const concluded = started.filter((e) => e.status === "stopped" && e.result);
    const won = concluded.filter((e) => e.result === "won").length;
    const lost = concluded.filter((e) => e.result === "lost").length;
    const inc = concluded.filter((e) => e.result === "inconclusive" || e.result === "dnf").length;
    const durs = started.filter((e) => e.endedAt).map((e) => (e.endedAt - e.startedAt) / DAY);
    const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
    const bar = (n, cls) => (concluded.length ? `<div class="seg-bar ${cls}" style="width:${(n / concluded.length) * 100}%" title="${n}"></div>` : "");
    const byPage = st.pages.map((p) => {
      const pe = started.filter((e) => e.pageId === p.id);
      return { p, n: pe.length, won: pe.filter((e) => e.result === "won").length, running: pe.filter((e) => e.status === "running").length };
    }).filter((x) => x.n);
    body = `<div class="stats4">
      <div class="card stat"><div class="k">Experiments run</div><div class="v">${started.length}</div><div class="s">Started in the last ${irange} days</div></div>
      <div class="card stat"><div class="k">Win rate</div><div class="v">${concluded.length ? fmtPct(won / concluded.length, 0) : "—"}</div><div class="s">${won} of ${concluded.length} concluded</div></div>
      <div class="card stat"><div class="k">Average length</div><div class="v">${durs.length ? `${Math.round(avg)} days` : "—"}</div><div class="s">Stopped experiments</div></div>
      <div class="card stat"><div class="k">Running now</div><div class="v">${exps.filter((e) => e.status === "running" && !e.archived).length}</div><div class="s">${exps.filter((e) => e.status === "scheduled" && !e.archived).length} scheduled</div></div></div>
    <section class="card pad"><h2>Results</h2><div class="card-sub">How concluded experiments ended.</div>
      <div class="result-bar">${bar(won, "won")}${bar(lost, "lost")}${bar(inc, "neutral")}</div>
      <div class="legend"><span><i style="background:var(--green, #16A34A)"></i>Won ${won}</span><span><i style="background:#DC2626"></i>Lost ${lost}</span><span><i style="background:#9CA3AF"></i>No clear winner / did not finish ${inc}</span></div></section>
    <section class="card"><div class="toolbar"><b>By page</b></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Page</th><th class="num">Experiments</th><th class="num">Running</th><th class="num">Winners shipped</th></tr></thead><tbody>
      ${byPage.length ? byPage.map((x) => `<tr><td><a href="#/page/${x.p.id}">${esc(x.p.name)}</a></td><td class="num">${x.n}</td><td class="num">${x.running}</td><td class="num">${x.won}</td></tr>`).join("") : emptyRow(4, "No experiments in this range")}</tbody></table></div></section>`;
  } else if (itab === "learnings") {
    const done = exps.filter((e) => e.status === "stopped" && e.result && inRange(e)).sort((a, b) => b.endedAt - a.endedAt);
    body = done.length ? done.map((e) => {
      const l = primaryLift(e);
      const tone = e.result === "won" ? "green" : e.result === "lost" ? "red" : "gray";
      return `<section class="card pad learning"><div class="card-head"><div><div class="row" style="gap:10px">${pill(tone, RESULT_LABEL[e.result])}<a href="#/experiment/${e.id}/results"><h2 style="display:inline">${esc(e.name)}</h2></a></div>
        <div class="card-sub">${esc(S.page(e.pageId)?.name || "")} · ${fmtDate(e.startedAt)} – ${fmtDate(e.endedAt)} · ${avatar(e.ownerId)} ${esc(S.user(e.ownerId).name)}</div></div>
        ${l ? `<div class="num"><div class="eyebrow">${esc(S.metric(e.primaryMetric)?.name)}</div><b class="${l.lift > 0 ? "up" : "down"}" style="font-size:20px">${esc(l.v.key)} ${fmtLift(l.lift)}</b></div>` : ""}</div>
        ${e.hypothesis ? `<p style="margin:8px 0"><b>Hypothesis:</b> ${esc(e.hypothesis)}</p>` : ""}
        ${e.analysisSummary ? `<p style="margin:8px 0;white-space:pre-wrap"><b>What we learned:</b> ${esc(e.analysisSummary)}</p>` : `<p class="faint" style="margin:8px 0">No conclusion written. <a href="#/experiment/${e.id}/results">Add one</a></p>`}
        <div class="row" style="gap:6px">${e.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("")}</div></section>`;
    }).join("") : `<div class="card"><div class="empty"><h3>No concluded experiments yet</h3><div>When you stop an experiment and record a result, it shows up here with its conclusion.</div></div></div>`;
  } else if (itab === "timeline") {
    const items = exps.filter((e) => (e.startedAt || e.scheduledStart) && !e.archived || (e.archived && e.startedAt)).filter((e) => (e.endedAt ?? now) >= now - irange * DAY);
    const t0 = startOfDay(now - irange * DAY);
    const t1 = startOfDay(now + 21 * DAY);
    const x = (t) => ((Math.max(t0, Math.min(t1, t)) - t0) / (t1 - t0)) * 100;
    const months = [];
    for (let d = new Date(t0); d.getTime() < t1; d.setMonth(d.getMonth() + 1, 1)) months.push(d.getTime());
    const groups = st.pages.map((p) => ({ p, list: items.filter((e) => e.pageId === p.id).sort((a, b) => (a.startedAt ?? a.scheduledStart) - (b.startedAt ?? b.scheduledStart)) })).filter((g) => g.list.length);
    body = `<section class="card pad"><h2>Timeline</h2><div class="card-sub">When each experiment ran, by page. Overlaps on a page can't happen; overlaps across pages are fine.</div>
      <div class="gantt"><div class="gantt-axis">${months.map((m) => `<span style="left:${x(m)}%">${esc(fmtDate(m).replace(/ \d+,/, ""))}</span>`).join("")}<span class="today" style="left:${x(now)}%">Today</span></div>
      ${groups.map((g) => `<div class="gantt-group">${esc(g.p.name)}</div>${g.list.map((e) => {
        const s = e.startedAt ?? e.scheduledStart;
        const en = e.endedAt ?? (e.status === "scheduled" ? S.stopDate(e) ?? s + 14 * DAY : e.status === "running" ? S.stopDate(e) ?? now : now);
        const st2 = statusPill(e);
        return `<div class="gantt-row"><a class="gantt-label" href="#/experiment/${e.id}/overview" title="${esc(e.name)}">${esc(e.name)}</a><div class="gantt-track"><div class="gantt-bar ${st2.tone} ${e.status === "scheduled" ? "planned" : ""}" style="left:${x(s)}%;width:${Math.max(0.8, x(en) - x(s))}%" title="${esc(`${e.name}: ${fmtDate(s)} – ${fmtDate(en)} (${st2.label})`)}"></div>${e.status === "running" && en > now ? `<div class="gantt-bar planned ${st2.tone}" style="left:${x(now)}%;width:${Math.max(0, x(en) - x(now))}%"></div>` : ""}<div class="gantt-today" style="left:${x(now)}%"></div></div></div>`;
      }).join("")}`).join("") || `<div class="faint">No experiments in this range</div>`}</div></section>`;
  } else {
    const m = S.metric(imetric) || st.metrics[0];
    const using = exps.filter((e) => S.phasesOf(e).length && [e.primaryMetric, ...e.secondaryMetrics, ...e.guardrailMetrics].includes(m.id) && inRange(e));
    body = `<section class="card"><div class="toolbar"><div><b>Metric effects</b><div class="small" style="margin:2px 0 0">How every experiment moved one metric. Useful for seeing which kinds of change work.</div></div>
      <div class="end"><label class="ctl"><span>Metric</span><select class="inp" data-imetric>${st.metrics.map((x) => `<option value="${x.id}" ${x.id === m.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div></div>
      <div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Experiment</th><th>Role</th><th>Status</th><th>Variant</th><th class="num">Change vs Control</th><th>Verdict</th></tr></thead><tbody>
      ${using.length ? using.flatMap((e) => {
        const a = analyze(e);
        const block = [a.primary, ...a.secondary, ...a.guardrails].find((b) => b?.metric.id === m.id);
        if (!block) return [];
        const role = e.primaryMetric === m.id ? "Primary" : e.guardrailMetrics.includes(m.id) ? "Guardrail" : "Secondary";
        return block.rows.slice(1).map((r, i) => `<tr><td>${i === 0 ? `<a href="#/experiment/${e.id}/results">${esc(e.name)}</a>` : ""}</td><td>${i === 0 ? role : ""}</td><td>${i === 0 ? pill(statusPill(e).tone, statusPill(e).label) : ""}</td><td>${variantChip(r.v)} ${esc(r.v.name)}</td>
          <td class="num">${r.r && r.enough ? `<b class="${r.verdict === "won" ? "up" : r.verdict === "lost" ? "down" : ""}">${fmtLift(r.r.lift)}</b>` : `<span class="faint">Not enough data</span>`}</td><td>${r.verdict === "won" ? `<span class="badge green">Better</span>` : r.verdict === "lost" ? `<span class="badge red">Worse</span>` : `<span class="faint">No clear change</span>`}</td></tr>`);
      }).join("") : emptyRow(6, `No experiments measured ${m.name}`)}</tbody></table></div></section>`;
  }
  return `<div class="page-head"><div><h1>Insights</h1><div class="sub">What your experiments have taught you</div></div>
    <label class="ctl"><span>Range</span><select class="inp" data-irange>${[[90, "Last 90 days"], [180, "Last 6 months"], [365, "Last 12 months"]].map(([k, l]) => `<option value="${k}" ${irange === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <nav class="tabs" aria-label="Insights">${tabs.map(([k, l]) => `<a href="#/insights" data-act="ins-tab" data-tab="${k}" class="${itab === k ? "on" : ""}" ${itab === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>${body}`;
}
export function bindInsights(root, rr) {
  root.querySelector("[data-imetric]")?.addEventListener("change", (ev) => { imetric = ev.target.value; rr(); });
  root.querySelector("[data-irange]")?.addEventListener("change", (ev) => { irange = Number(ev.target.value); rr(); });
}

/* ---------- Holdouts ---------- */
// A holdout keeps a slice of visitors on every page's default from the
// holdout's start, so the combined effect of everything shipped since can
// be measured: Holdout (A) vs General population (B).
export function holdoutExperiment(h) {
  const st = S.get();
  const pages = h.pageIds.map(S.page).filter(Boolean);
  const traffic = pages.reduce((a, p) => a + p.traffic, 0) || 1;
  const shipped = st.experiments.filter((e) => h.pageIds.includes(e.pageId) && e.result === "won" && e.endedAt >= h.startedAt && (!h.endedAt || e.endedAt <= h.endedAt));
  const lifts = {};
  h.metrics.forEach((mid) => {
    lifts[mid] = shipped.reduce((acc, e) => {
      const key = S.variantsOf(e).find((v) => v.id === e.winnerVariantId)?.key;
      const l = e.sim?.lifts?.[key]?.[mid] ?? 0;
      return acc + l * (S.page(e.pageId).traffic / traffic);
    }, 0);
  });
  const targeting = { audience: "all", device: "all", source: "", excludeLeads: false, conditions: [], savedGroups: [] };
  return {
    id: h.id, name: h.name, status: h.endedAt ? "stopped" : "holdout", startedAt: h.startedAt, endedAt: h.endedAt, weights: [h.percent, 100 - h.percent], coverage: 100, targeting,
    type: "standard", primaryMetric: h.metrics[0], secondaryMetrics: h.metrics.slice(1), guardrailMetrics: [], activationMetric: null, statsEngine: st.settings.statsEngine, sequential: false, cuped: false,
    traffic, pageId: pages[0]?.id, namespace: null, midTestEdits: [], result: null, analysisSummary: "",
    virtualVariants: [{ id: "hv_a", key: "A", name: "Holdout", changes: 0 }, { id: "hv_b", key: "B", name: "General population", changes: 0 }],
    sim: { seed: h.seed, lifts: { B: lifts } },
    phases: [{ start: h.startedAt, end: h.endedAt, weights: [h.percent, 100 - h.percent], coverage: 100, targeting, reason: "Holdout" }],
    shipped,
  };
}

export function renderHoldouts() {
  const st = S.get();
  return `<div class="page-head"><div><h1>Holdouts</h1><div class="sub">Measure the combined, long-term impact of everything you ship</div></div>
    <button type="button" class="btn primary lg" data-act="ho-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New holdout</button></div>
    ${callout("info", "A holdout keeps a small share of visitors on each page's original default, even after experiments ship winners. Comparing them with everyone else shows the real, combined effect of your experiment program. Experiments on these pages run on the remaining traffic.")}
    <div class="card" style="margin-top:16px"><div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Holdout</th><th>Pages</th><th class="num">Held out</th><th>Status</th><th>Shipped since start</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${st.holdouts.length ? st.holdouts.map((h) => {
      const he = holdoutExperiment(h);
      return `<tr><td><a class="exp-name" href="#/holdout/${h.id}">${esc(h.name)}</a><div class="small" style="margin:2px 0 0">Since ${fmtDate(h.startedAt)} · ${avatar(h.ownerId)}</div></td><td>${h.pageIds.map((id) => esc(S.page(id)?.name || "")).join("<br>")}</td><td class="num">${h.percent}%</td>
        <td>${h.endedAt ? pill("gray", "Stopped") : pill("green", "Running")}</td><td>${he.shipped.length} winner${he.shipped.length === 1 ? "" : "s"}</td><td><a class="btn sm" href="#/holdout/${h.id}">Results</a></td></tr>`;
    }).join("") : emptyRow(6, "No holdouts")}</tbody></table></div></div>`;
}

const hoUi = new Map();
export function renderHoldout(id) {
  const h = S.holdout(id);
  if (!h) return `<div class="card"><div class="empty"><h3>Holdout not found</h3></div></div>`;
  const he = holdoutExperiment(h);
  if (!hoUi.has(id)) hoUi.set(id, defaultRes());
  return `<div class="crumbs"><a href="#/holdouts">Holdouts</a></div>
    <div class="page-head"><div><div class="row" style="gap:12px"><h1 style="font-size:28px">${esc(h.name)}</h1>${h.endedAt ? pill("gray", "Stopped") : pill("green", "Running")}</div>
      <div class="sub">${h.percent}% held out since ${fmtDate(h.startedAt)}${h.endedAt ? ` until ${fmtDate(h.endedAt)}` : ""} · ${esc(h.pageIds.map((x) => S.page(x)?.name).join(", "))}</div></div>
      <div class="head-actions">${!h.endedAt && S.canEdit() ? `<button type="button" class="btn sm" data-act="ho-stop" data-hid="${h.id}">${icon.stop()} Stop holdout</button>` : ""}${S.canEdit() ? `<button type="button" class="btn sm" data-act="ho-delete" data-hid="${h.id}">${icon.trash()} Delete</button>` : ""}</div></div>
    ${h.desc ? `<p class="muted" style="margin-top:0">${esc(h.desc)}</p>` : ""}
    <section class="card pad"><h2>Shipped since the holdout started</h2><div class="card-sub">General population sees these winners; the holdout doesn't.</div>
      ${he.shipped.length ? `<ul class="timeline">${he.shipped.map((e) => `<li>${variantChip(S.variantsOf(e).find((v) => v.id === e.winnerVariantId) || { key: "?", name: "" })}<div><a href="#/experiment/${e.id}/results">${esc(e.name)}</a><div class="when">Shipped ${fmtDate(e.endedAt)}</div></div></li>`).join("")}</ul>` : `<p class="faint">Nothing shipped yet. Until then the two groups should look the same.</p>`}</section>
    <div data-holdout="${h.id}">${resultsBody(he, hoUi.get(id), { report: true })}</div>`;
}
export function bindHoldout(root, rr, id) {
  if (hoUi.has(id)) bindResults(root, hoUi.get(id), () => rr());
}

/* ---------- Reports ---------- */
export function renderReport(id) {
  const r = S.report(id);
  const e = r && S.exp(r.expId);
  if (!r || !e) return `<div class="card"><div class="empty"><h3>Report not found</h3><div>It, or its experiment, may have been deleted.</div></div></div>`;
  const s = r.settings;
  const mine = S.canEdit();
  return `<div class="crumbs"><a href="#/experiments">Experiments</a> / <a href="#/experiment/${e.id}/results">${esc(e.name)}</a> / Report</div>
    <div class="page-head"><div style="min-width:0"><h1 style="font-size:28px">${esc(r.title)}</h1>
      <div class="sub">Report on <a href="#/experiment/${e.id}/results">${esc(e.name)}</a> · ${avatar(r.by)} ${esc(S.user(r.by).name)} · ${fmtDate(r.createdAt)} · ${esc(S.page(e.pageId)?.name || "")}</div></div>
      <div class="head-actions"><button type="button" class="btn sm" data-act="rep-copy">${icon.copy()} Copy link</button>${mine ? `<button type="button" class="btn sm" data-act="rep-edit" data-rid="${r.id}">${icon.edit()} Edit</button><button type="button" class="btn sm" data-act="rep-delete" data-rid="${r.id}">${icon.trash()} Delete</button>` : ""}</div></div>
    ${r.note ? `<section class="card pad"><p style="margin:0;white-space:pre-wrap">${esc(r.note)}</p></section>` : ""}
    ${e.hypothesis ? `<p><b>Hypothesis:</b> ${esc(e.hypothesis)}</p>` : ""}
    <div class="small" style="margin-bottom:12px">Saved settings: phase ${(s.phase ?? 0) + 1} · baseline ${esc(S.variantsOf(e)[s.baseline]?.key || "A")} · ${esc(s.difference)} difference${s.dimension ? ` · by ${esc(s.dimension)}` : ""}. ${mine ? "Changing the controls below updates the report." : ""}</div>
    <div data-report="${r.id}">${resultsBody(e, r.settings, { report: true })}</div>`;
}
export function bindReport(root, rr, id) {
  const r = S.report(id);
  if (!r) return;
  bindResults(root, r.settings, () => {
    if (S.canEdit()) S.save();
    else rr();
  });
}

/* ---------- Templates ---------- */
export function renderTemplates() {
  const st = S.get();
  const used = (t) => st.experiments.filter((e) => e.templateId === t.id).length;
  return `<div class="page-head"><div><h1>Experiment templates</h1><div class="sub">Reusable setups, so every test of a kind is measured the same way</div></div></div>
    <div class="card"><div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Template</th><th>Type</th><th>Metrics</th><th>Analysis</th><th class="num">Used</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${st.templates.length ? st.templates.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="small" style="margin:2px 0 0">${esc(t.desc || "")}</div></td><td>${t.type === "bandit" ? "Bandit" : "A/B test"}</td>
      <td>${esc(S.metric(t.primaryMetric)?.name || "—")}${t.secondaryMetrics?.length ? ` <span class="faint">+${t.secondaryMetrics.length}</span>` : ""}${t.guardrailMetrics?.length ? `<div class="small" style="margin:0">Guardrails: ${t.guardrailMetrics.map((m) => esc(S.metric(m)?.name)).join(", ")}</div>` : ""}</td>
      <td>${t.statsEngine === "frequentist" ? `Frequentist${t.sequential ? " · sequential" : ""}` : "Bayesian"}${t.cuped ? " · CUPED" : ""}<div class="small" style="margin:0">${t.stopAfterDays ? `${t.stopAfterDays} days` : "Stops manually"}</div></td>
      <td class="num">${used(t)}</td><td><div class="actions"><button type="button" class="btn xs primary" data-act="tpl-use" data-tid="${t.id}" ${S.canEdit() ? "" : "disabled"}>Use</button><button type="button" class="btn xs" data-act="tpl-delete" data-tid="${t.id}" ${S.canEdit() ? "" : "disabled"}>Delete</button></div></td></tr>`).join("") : emptyRow(6, "No templates yet", "Open an experiment and choose ⋯ → Save as template.")}</tbody></table></div></div>
    <p class="hint">To make a template, open any experiment and choose ⋯ → Save as template.</p>`;
}

Object.assign(acts, {
  "ins-tab": (el, rr) => { itab = el.dataset.tab; rr(); },
  "tpl-use": (el) => openCreate(null, { templateId: el.dataset.tid, type: S.template(el.dataset.tid)?.type || "standard" }),
  "tpl-delete": (el) => confirmModal({ title: "Delete template?", danger: true, tone: "red", confirm: "Delete", text: `<b>${esc(S.template(el.dataset.tid)?.name)}</b> will be deleted. Experiments made from it keep their settings.`, onConfirm: () => {
    S.get().templates = S.get().templates.filter((t) => t.id !== el.dataset.tid);
    S.save();
  } }),
  "rep-copy": () => copyText(location.href),
  "rep-edit": (el) => {
    const r = S.report(el.dataset.rid);
    openModal({
      title: "Edit report",
      wide: true,
      body: `<div class="field"><label for="rp-t">Title</label><input id="rp-t" name="title" class="inp" value="${esc(r.title)}"></div><div class="field"><label for="rp-n">Note for readers</label><textarea id="rp-n" name="note" class="inp">${esc(r.note || "")}</textarea></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd) => {
        r.title = String(fd.get("title")).trim() || r.title;
        r.note = String(fd.get("note")).trim();
        S.save();
        closeModal();
      },
    });
  },
  "rep-delete": (el) => confirmModal({ title: "Delete report?", danger: true, tone: "red", confirm: "Delete", text: "The report link stops working. The experiment isn't affected.", onConfirm: () => {
    const r = S.report(el.dataset.rid);
    S.get().reports = S.get().reports.filter((x) => x.id !== r.id);
    S.save();
    go(`#/experiment/${r.expId}/results`);
  } }),
  "ho-new": () => {
    const st = S.get();
    openModal({
      title: "New holdout",
      wide: true,
      body: `<div class="field"><label for="ho-n">Name</label><input id="ho-n" name="name" class="inp" placeholder="e.g. 2027 H1 holdout"><div data-err="name"></div></div>
        <div class="field"><label for="ho-d">Description <span class="opt">· optional</span></label><input id="ho-d" name="desc" class="inp"></div>
        <div class="field"><label for="ho-p">Share of visitors to hold out</label><div class="pct-input"><input id="ho-p" name="percent" type="number" class="inp" min="1" max="20" value="5"><span>%</span></div><div class="hint">Usually 2–10%. These visitors never see experiment variants on the chosen pages.</div></div>
        <div class="field"><span class="label">Pages</span><div class="stack-sm">${st.pages.filter((p) => p.status === "live").map((p) => `<label class="check"><input type="checkbox" name="page" value="${p.id}"><span><span class="t1">${esc(p.name)}</span><span class="t2">${esc(p.path)}</span></span></label>`).join("")}</div><div data-err="page"></div></div>
        <div class="field"><span class="label">Metrics</span><div class="row" style="gap:8px">${st.metrics.map((m) => `<label class="badge" style="padding:6px 10px;cursor:pointer;font-weight:500"><input type="checkbox" name="metric" value="${m.id}"> ${esc(m.name)}</label>`).join("")}</div><div data-err="metric"></div></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Start holdout</button>`,
      onSubmit: (fd, form) => {
        const errs = {};
        const name = String(fd.get("name")).trim();
        if (!name) errs.name = "Enter a name";
        if (!fd.getAll("page").length) errs.page = "Pick at least one page";
        if (!fd.getAll("metric").length) errs.metric = "Pick at least one metric";
        form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
        if (Object.keys(errs).length) return;
        const h = { id: uid("h"), name, desc: String(fd.get("desc")).trim(), percent: Math.max(1, Math.min(20, Number(fd.get("percent")) || 5)), pageIds: fd.getAll("page"), metrics: fd.getAll("metric"), status: "running", startedAt: S.now(), endedAt: null, ownerId: st.currentUserId, seed: Math.floor(Math.random() * 1000) };
        st.holdouts.unshift(h);
        S.save();
        closeModal();
        toast("Holdout started. Results build up as experiments ship winners.", "good");
        go(`#/holdout/${h.id}`);
      },
    });
  },
  "ho-stop": (el) => confirmModal({ title: "Stop this holdout?", confirm: "Stop", tone: "amber", ic: icon.warn(18), text: "Held-out visitors start seeing the current page defaults. Results stay readable.", onConfirm: () => {
    S.holdout(el.dataset.hid).endedAt = S.now();
    S.save();
  } }),
  "ho-delete": (el) => confirmModal({ title: "Delete holdout?", danger: true, tone: "red", confirm: "Delete", text: "This can't be undone.", onConfirm: () => {
    S.get().holdouts = S.get().holdouts.filter((h) => h.id !== el.dataset.hid);
    S.save();
    go("#/holdouts");
  } }),
});
export const _int = fmtInt;
