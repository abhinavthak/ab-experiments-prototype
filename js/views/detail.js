import * as S from "../store.js";
import { analyze, statusPill } from "../analysis.js";
import { can, why } from "../rules.js";
import { acts } from "../actions.js";
import { icon, pill, variantChip, avatar, menu, menuItem, callout, lock, openModal, closeModal } from "../ui.js";
import { esc, fmtDate, fmtDateTime, fmtInt, fmtPct, fmtLift, timeAgo, DAY, daysBetween, slugify, toast, uid, VARIANT_COLORS } from "../util.js";
import { lineChart } from "../chart.js";
import * as Sim from "../sim.js";
import { metricOptions } from "./create.js";
import { RESULT_LABEL } from "../store.js";

let device = "all";

const colorOf = (v) => VARIANT_COLORS[Math.max(0, v.key.charCodeAt(0) - 65) % VARIANT_COLORS.length];

function header(e, tab) {
  const p = S.page(e.pageId);
  const st = statusPill(e);
  const btns = [];
  if (!e.archived) {
    if (e.status === "draft" || e.status === "scheduled") {
      btns.push(`<button type="button" class="btn sm" data-act="exp-schedule" ${can(e, "schedule") ? "" : `disabled title="${esc(why(e, "schedule"))}"`}>${icon.calendar()} ${e.status === "scheduled" ? "Reschedule" : "Schedule"}</button>`);
      btns.push(`<button type="button" class="btn sm primary" data-act="exp-start" ${can(e, "startNow") ? "" : `disabled title="${esc(why(e, "startNow"))}"`}>${icon.play()} Start experiment</button>`);
    }
    if (e.status === "running") btns.push(`<button type="button" class="btn sm primary" data-act="exp-stop" ${can(e, "stop") ? "" : `disabled title="${esc(why(e, "stop"))}"`}>${icon.stop()} Stop experiment</button>`);
    if (e.status === "stopped" && !e.result) btns.push(`<button type="button" class="btn sm primary" data-act="exp-stop">Record result</button>`);
  }
  const items = [
    menuItem("exp-edit-info", "Edit name & details", { ic: icon.edit(), disabled: why(e, "editText") }),
    menuItem("exp-watch", e.watched ? "Stop watching" : "Watch", { ic: icon.eye() }),
    menuItem("exp-copykey", "Copy tracking key", { ic: icon.copy() }),
    menuItem("exp-duplicate", "Duplicate", { ic: icon.copy(), disabled: S.canEdit() ? "" : "You need Editor access" }),
    e.status === "scheduled" && !e.archived ? menuItem("exp-unschedule", "Unschedule", { ic: icon.clock() }) : "",
    e.archived ? menuItem("exp-unarchive", "Unarchive", { ic: icon.archive(), disabled: why(e, "unarchive") }) : menuItem("exp-archive", "Archive", { ic: icon.archive(), disabled: why(e, "archive") }),
    "<hr>",
    menuItem("exp-delete", "Delete", { ic: icon.trash(), danger: true, disabled: S.canEdit() ? "" : "You need Editor access" }),
  ].join("");
  const sub =
    e.status === "running" ? `Started ${fmtDate(e.startedAt)} · day ${daysBetween(e.startedAt, S.now()) + 1}${S.stopDate(e) ? ` of ${Math.round((S.stopDate(e) - e.startedAt) / DAY)}` : ""}`
    : e.status === "scheduled" ? `Starts ${fmtDateTime(e.scheduledStart)}`
    : e.status === "stopped" ? `Ran ${fmtDate(e.startedAt)} – ${fmtDate(e.endedAt)}${e.result ? ` · ${RESULT_LABEL[e.result]}` : ""}`
    : `Created ${fmtDate(e.createdAt)} by ${S.user(e.ownerId).name}`;
  const tabs = [["overview", "Overview"], ["results", "Results"], ["health", "Health"], ["history", "History & comments"]];
  return `
  <div class="crumbs"><a href="#/experiments">Experiments</a> / <a href="#/page/${p?.id}">${esc(p?.name || "Deleted page")}</a></div>
  <div class="page-head" style="margin-bottom:12px">
    <div style="min-width:0"><div class="row" style="gap:12px"><h1 style="font-size:28px">${esc(e.name)}</h1>${pill(st.tone, st.label)}${e.watched ? `<span class="badge amber">★ Watching</span>` : ""}</div>
      <div class="sub" style="font-size:14px">${esc(sub)} · tracking key <button type="button" class="link-btn mono" data-act="exp-copykey" title="Copy">${esc(e.trackingKey)}</button> · ${avatar(e.ownerId)} ${esc(S.user(e.ownerId).name)}</div></div>
    <div class="head-actions">${btns.join("")}${menu("⋯", items, { label: "More actions" })}</div>
  </div>
  ${e.notice ? callout(e.notice.tone, esc(e.notice.text), `<button type="button" class="btn xs" data-act="exp-dismiss-notice">Dismiss</button>`) : ""}
  ${e.archived ? callout("info", "This experiment is archived and read-only. Unarchive it to make changes.", `<button type="button" class="btn xs" data-act="exp-unarchive">Unarchive</button>`) : ""}
  <nav class="tabs" aria-label="Experiment sections">${tabs.map(([k, l]) => `<a href="#/experiment/${e.id}/${k}" class="${tab === k ? "on" : ""}" ${tab === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
}

/* ---------- Overview ---------- */
function overview(e) {
  const p = S.page(e.pageId);
  const vs = S.variantsOf(e);
  const edV = can(e, "editVariants");
  const total = e.weights.reduce((a, b) => a + Number(b || 0), 0);
  const notIn = p ? p.variants.filter((v) => !e.variantIds.includes(v.id)) : [];
  const active = p && S.activeExpOnPage(p.id, e.id);
  const st = S.get();

  const variantRows = vs
    .map((v, i) => `<div class="var-row">${variantChip(v)}<div style="min-width:0"><b>${esc(v.name)}</b>${i === 0 ? ` <span class="badge">Control</span>` : ""}<div class="small" style="margin-top:2px">${i === 0 ? `Default variant · ${p?.sections ?? 0} sections` : `${v.changes} change${v.changes === 1 ? "" : "s"} vs default`}</div></div>
      <div class="pct-input"><input class="inp" type="number" min="0" max="100" step="1" data-weight="${i}" value="${esc(e.weights[i])}" aria-label="Traffic split for ${esc(v.key)}" ${edV ? "" : "disabled"}><span>%</span></div>
      <div class="row" style="gap:6px;justify-content:flex-end">${i > 0 && edV ? `<button type="button" class="btn xs" data-act="exp-remove-variant" data-vid="${v.id}" aria-label="Remove ${esc(v.key)} from test">Remove</button>` : ""}<a class="btn xs" href="#/page/${e.pageId}?v=${v.id}">${i === 0 ? "View" : "Edit sections"}</a></div></div>`)
    .join("");

  const checks = !e.archived && (e.status === "draft" || e.status === "scheduled") ? S.startChecks(e) : null;

  const metricBox = (kind, list, label, help, editable) => `
    <div class="field"><span class="label">${label}</span><div class="hint" style="margin:-4px 0 8px">${help}</div>
      <div class="row" style="gap:8px">${st.metrics
        .filter((m) => m.id !== e.primaryMetric && !(m.requires === "leadForm" && p && !p.hasLeadForm))
        .map((m) => `<label class="badge ${list.includes(m.id) ? "blue" : ""}" style="padding:6px 10px;cursor:${editable ? "pointer" : "default"};font-weight:500"><input type="checkbox" data-mlist="${kind}" value="${m.id}" ${list.includes(m.id) ? "checked" : ""} ${editable ? "" : "disabled"} style="accent-color:var(--primary)"> ${esc(m.name)}</label>`)
        .join("")}</div></div>`;

  return `<div class="grid2"><div>
    <section class="card pad">
      <div class="card-head"><div><h2>Page under test</h2></div><a class="btn sm" href="#/page/${e.pageId}">${icon.ext()} Open page editor</a></div>
      ${e.hypothesis ? `<p style="margin:12px 0"><b>Hypothesis:</b> ${esc(e.hypothesis)}</p>` : `<p class="faint" style="margin:12px 0">No hypothesis yet. <button type="button" class="link-btn" data-act="exp-edit-info">Add one</button></p>`}
      ${e.description ? `<p class="muted" style="margin:0 0 12px">${esc(e.description)}</p>` : ""}
      <div class="row" style="padding:14px;border:1px solid var(--border);border-radius:12px"><span style="color:var(--primary)">${icon.page()}</span><div class="grow"><b>${esc(p?.name || "Deleted page")}</b><div class="small" style="margin:0"><span class="mono">${esc(p?.path || "")}</span> · ${esc(p?.type || "")} · ${p?.sections ?? 0} sections</div></div>${p ? pill(p.status === "live" ? "green" : "gray", p.status === "live" ? "Live" : "Draft") : ""}</div>
      <p class="hint">While the test runs, the page's default variant can't be changed, and variants in the test can't be deleted. Blocks (like Common Header) are shared by every variant.</p>
      ${e.tags.length ? `<div class="row" style="gap:6px">${e.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("")}</div>` : ""}
    </section>

    <section class="card pad">
      <div class="card-head"><div><h2>Variants &amp; split</h2><div class="card-sub">Variants are created in the page editor. Control is the page's default variant.</div></div>${edV ? "" : lock(why(e, "editVariants"))}</div>
      ${variantRows}
      <div class="row" style="justify-content:space-between;margin-top:12px">
        <div class="row" style="gap:8px">${edV ? `<button type="button" class="btn xs" data-act="exp-split-even">Split evenly</button>` : ""}${edV && notIn.length ? menu(`${icon.plus(16)} Add page variant`, notIn.map((v) => menuItem("exp-add-variant", `${v.key} · ${v.name}`, { data: `data-vid="${v.id}"` })).join(""), { cls: "btn xs", label: "Add page variant" }) : ""}${edV && p ? `<a class="btn xs" href="#/page/${p.id}?new=1">New variant in page editor</a>` : ""}</div>
        <b class="${Math.round(total) === 100 ? "" : "down"}">Total ${Math.round(total)}%</b></div>
      <div class="field" style="margin-top:16px;margin-bottom:0"><span class="label">How variants are served</span><div class="muted" style="font-size:14px">Same URL — the CMS swaps sections. Visitors stay on <span class="mono">${esc(p?.path || "")}</span>. Variants keep Control's canonical tag and aren't indexed separately, so SEO is unaffected.</div></div>
    </section>

    <section class="card pad">
      <div class="card-head"><div><h2>Targeting &amp; traffic</h2><div class="card-sub">Who enters the test and how they're assigned.</div></div>${edV ? "" : lock(why(e, "editVariants"))}</div>
      <div class="row"><div class="grow field"><label for="t-aud">Audience</label><select id="t-aud" class="inp" data-t="audience" ${edV ? "" : "disabled"}>${[["all", "All visitors"], ["new", "New visitors"], ["returning", "Returning visitors"]].map(([k, l]) => `<option value="${k}" ${e.targeting.audience === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="grow field"><label for="t-dev">Device</label><select id="t-dev" class="inp" data-t="device" ${edV ? "" : "disabled"}>${[["all", "Mobile + Desktop"], ["mobile", "Mobile only"], ["desktop", "Desktop only"]].map(([k, l]) => `<option value="${k}" ${e.targeting.device === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="row"><div class="grow field"><label for="t-src">Traffic source · UTM</label><input id="t-src" class="inp" data-t="source" placeholder="Any source" value="${esc(e.targeting.source)}" ${edV ? "" : "disabled"}></div>
        <div class="grow field"><label for="t-cov">Rollout · share of visitors in test</label><div class="pct-input"><input id="t-cov" class="inp" type="number" min="0" max="100" data-coverage value="${e.coverage}" ${edV ? "" : "disabled"}><span>%</span></div></div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" checked disabled><span><span class="t1">Keep visitors in the same variant</span><span class="t2">Assigned by visitor ID (cookie), then by lead ID after a form submit</span></span></label>
      <label class="check"><input type="checkbox" data-t="excludeLeads" ${e.targeting.excludeLeads ? "checked" : ""} ${edV ? "" : "disabled"}><span><span class="t1">Exclude existing leads</span><span class="t2">Visitors who already submitted a form on this page see Control</span></span></label>
      <p class="hint">Outside the rollout %, cookies blocked, or bots: they see the default and aren't counted. CMS admins and preview links are never counted.</p>
    </section>

    <section class="card pad">
      <h2>Metrics</h2><div class="card-sub">One primary metric picks the winner. Secondary metrics help explain why; guardrails catch harm.</div>
      <div class="field"><label for="m-primary">Primary · one only</label>${can(e, "changePrimary") ? "" : `<div style="margin-bottom:6px">${lock(why(e, "changePrimary"))}</div>`}<select id="m-primary" class="inp" data-primary ${can(e, "changePrimary") ? "" : "disabled"}>${metricOptions(e.primaryMetric, p)}</select><div class="hint">Counted once per visitor, credited to the variant they saw at conversion.</div></div>
      ${metricBox("secondaryMetrics", e.secondaryMetrics, `Secondary · ${e.secondaryMetrics.length}`, "Tracked for context.", can(e, "editSecondary"))}
      ${metricBox("guardrailMetrics", e.guardrailMetrics, `Guardrails · ${e.guardrailMetrics.length}`, "Flagged if a variant makes them significantly worse.", can(e, "editSecondary"))}
      <label class="check"><input type="checkbox" data-flag="leadAttribution" ${e.leadAttribution ? "checked" : ""} ${can(e, "editText") ? "" : "disabled"}><span><span class="t1">Tag leads with experiment and variant</span><span class="t2">Adds exp_key and variant to every lead from this page, so counsellors and CRM reports can split by variant.</span></span></label>
    </section>

    <section class="card pad">
      <h2>Analysis</h2><div class="card-sub">How results are calculated. You can change this at any time; results recalculate.</div>
      <div class="field"><span class="label">Stats engine</span><div class="seg" role="group" aria-label="Stats engine" style="display:inline-flex">${[["bayesian", "Bayesian"], ["frequentist", "Frequentist"]].map(([k, l]) => `<button type="button" aria-pressed="${e.statsEngine === k}" data-act="exp-engine" data-engine="${k}" ${can(e, "analysis") ? "" : "disabled"}>${l}</button>`).join("")}</div>
        <div class="hint">${e.statsEngine === "bayesian" ? "Shows the chance each variant beats Control and a 95% credible interval." : "Shows p-values and 95% confidence intervals."}</div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-flag="sequential" ${e.sequential ? "checked" : ""} ${can(e, "analysis") && e.statsEngine === "frequentist" ? "" : "disabled"}><span><span class="t1">Sequential testing</span><span class="t2">Safe to check results any time (frequentist only). Intervals are wider early on.</span></span></label>
      <label class="check"><input type="checkbox" data-flag="cuped" ${e.cuped ? "checked" : ""} ${can(e, "analysis") ? "" : "disabled"}><span><span class="t1">CUPED variance reduction</span><span class="t2">Uses visitors' pre-test behaviour to tighten intervals.</span></span></label>
    </section>

    <section class="card pad">
      <h2>Schedule</h2><div class="card-sub">Draft · Scheduled · Running · Stopped. Tests can't be paused.</div>
      <dl class="kv"><dt>Start</dt><dd>${e.startedAt ? fmtDateTime(e.startedAt) : e.scheduledStart ? `Scheduled · ${fmtDateTime(e.scheduledStart)}` : "Manually"}</dd>
        <dt>Stop</dt><dd>${e.endedAt ? fmtDateTime(e.endedAt) : e.stopAfterDays ? `${e.stopAfterDays} days after start${S.stopDate(e) ? ` · ${fmtDate(S.stopDate(e))}` : ""}` : "Manually"} ${can(e, "stopDate") ? `<button type="button" class="link-btn" data-act="exp-stopdate">Change</button>` : ""}</dd>
        <dt>When it stops</dt><dd class="muted">You record a result (Won, Lost, No clear winner or Did not finish) and choose which variant becomes the page default.</dd></dl>
    </section>
  </div>

  <aside class="stack">
    ${checks ? `<section class="card pad"><h2>${checks.blocked ? `Ready to start · ${checks.items.filter((i) => !i.ok && !i.warn).length} to fix` : "Ready to start"}</h2>
      <ul class="checklist" style="margin-top:8px">${checks.items.map((i) => `<li class="${i.warn ? "warn" : i.ok ? "ok" : "bad"}"><span class="ic">${i.warn ? "!" : i.ok ? "✓" : "✕"}</span><span>${esc(i.label)}${!i.ok && i.fix ? `<br><span class="faint">${esc(i.fix)}</span>` : ""}</span></li>`).join("")}</ul>
      <div class="row" style="margin-top:12px"><button type="button" class="btn sm primary" data-act="exp-start" ${checks.blocked || !S.canEdit() ? "disabled" : ""}>Start experiment</button><button type="button" class="btn sm" data-act="exp-schedule" ${S.canEdit() ? "" : "disabled"}>Schedule</button></div></section>` : ""}
    ${active ? callout("warn", `“${esc(active.name)}” is ${active.status} on this page. Only one running or scheduled experiment per page.`) : ""}
    <section class="card pad"><h2>Tracking key</h2>
      <div class="field" style="margin:12px 0 0"><label class="sr-only" for="k-key">Tracking key</label><input id="k-key" class="inp mono" data-key value="${esc(e.trackingKey)}" ${can(e, "changeKey") ? "" : "readonly"}><div id="k-err"></div>
      <div class="hint">${can(e, "changeKey") ? "Unique across all experiments. Lowercase letters, numbers and hyphens." : esc(why(e, "changeKey"))}</div></div></section>
    <section class="card pad"><h2>Preview</h2><div class="card-sub">Preview links show a chosen variant without assigning or counting the visitor.</div>
      <div class="stack-sm">${vs.map((v) => `<button type="button" class="btn sm" style="width:100%;justify-content:flex-start" data-act="exp-preview" data-vid="${v.id}">${variantChip(v, true)} Preview ${esc(v.key)} · ${esc(v.name)}</button>`).join("")}</div></section>
  </aside></div>`;
}

/* ---------- Results ---------- */
function ciBar(r, verdict, span) {
  if (!r) return "";
  const pos = (x) => `${((x + span) / (2 * span)) * 100}%`;
  const lo = Math.max(-span, r.ci[0]), hi = Math.min(span, r.ci[1]);
  return `<div class="ci" aria-label="Interval ${fmtLift(r.ci[0])} to ${fmtLift(r.ci[1])}"><div class="axis"></div><div class="zero" style="left:50%"></div><div class="bar ${verdict}" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></div><div class="pt" style="left:calc(${pos(Math.max(-span, Math.min(span, r.lift)))} - 1px)"></div></div><div class="small" style="margin-top:2px">${fmtLift(r.ci[0])} to ${fmtLift(r.ci[1])}</div>`;
}

function metricTable(e, block, engine, { compact = false } = {}) {
  const { metric, rows } = block;
  const span = Math.max(0.1, ...rows.filter((r) => r.r).map((r) => Math.max(Math.abs(r.r.ci[0]), Math.abs(r.r.ci[1])))) * 1.1;
  const val = (s) => (!s || !s.n ? "—" : metric.type === "binomial" ? fmtPct(s.x / s.n, 2) : `${(s.sum / s.n).toFixed(2)}${metric.unit || ""}`);
  return `<div class="table-wrap"><table class="t ${compact ? "compact" : ""}" style="min-width:760px">
    <thead><tr><th>Variant</th><th class="num">Visitors</th><th class="num">${metric.type === "binomial" ? "Conversions" : "Average"}</th><th class="num">${metric.type === "binomial" ? "Conv. rate" : "Value"}</th><th>vs Control ${metric.higherIsBetter === false ? "<span class='faint'>(lower is better)</span>" : ""}</th><th class="num">${engine === "bayesian" ? "Chance to beat Control" : "p-value"}</th></tr></thead>
    <tbody>${rows.map(({ v, i, s, r, verdict }) => `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${variantChip(v)}<div><b>${esc(v.name)}</b>${i === 0 ? `<div class="small" style="margin:0">Control</div>` : ""}</div>${verdict === "won" ? `<span class="badge green">${metric.higherIsBetter === false ? "Better" : "Winning"}</span>` : verdict === "lost" ? `<span class="badge red">Worse</span>` : ""}</div></td>
      <td class="num">${fmtInt(s?.n || 0)}</td><td class="num">${metric.type === "binomial" ? fmtInt(s?.x || 0) : val(s)}</td><td class="num"><b>${val(s)}</b></td>
      <td>${i === 0 ? `<span class="faint">Baseline</span>` : r ? `<b class="${verdict === "won" ? "up" : verdict === "lost" ? "down" : ""}">${fmtLift(r.lift)}</b>${ciBar(r, verdict === "won" ? "won" : verdict === "lost" ? "lost" : "neutral", span)}` : "—"}</td>
      <td class="num">${i === 0 ? "—" : r ? (engine === "bayesian" ? `<b>${fmtPct(r.chanceToWin, 0)}</b>` : `<b>${r.pValue < 0.001 ? "<0.001" : r.pValue.toFixed(3)}</b>`) : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function results(e) {
  if (!e.startedAt) {
    return `<div class="card"><div class="empty"><h3>No results yet</h3><div>Results show once the experiment starts and each variant has a conversion.</div>${!e.archived && S.canEdit() ? `<div style="margin-top:14px"><button type="button" class="btn sm primary" data-act="exp-start">Start experiment</button></div>` : ""}</div></div>`;
  }
  const a = analyze(e, { device });
  const all = device === "all" ? a : analyze(e);
  const vs = a.vs;
  const banners = [];
  if (e.status === "stopped" && !e.result) banners.push(callout("warn", `Stopped automatically on ${fmtDate(e.endedAt)}. Visitors now see the page default again. Record a result to finish.`, `<button type="button" class="btn xs" data-act="exp-stop">Record result</button>`));
  if (a.collecting) banners.push(callout("info", `<b>Collecting data.</b> Started ${timeAgo(e.startedAt, S.now())} · ${fmtInt(all.visitors)} visitors · ${fmtInt(all.primaryConversions.reduce((x, y) => x + y, 0))} conversions. Results show once each variant has a conversion. Check back tomorrow.`));
  if (all.srm.bad) banners.push(callout("bad", `<b>Traffic doesn't match the planned split.</b> ${vs.map((v, i) => `${v.key} ${fmtPct(all.srm.observed[i] / Math.max(1, all.visitors), 0)}`).join(" · ")}, planned ${e.weights.join("/")}. Results may be unreliable. Common causes: cached pages, redirects, bots.`, `<a class="btn xs" href="#/experiment/${e.id}/health">View health</a>`));
  if (all.noTraffic) banners.push(callout("bad", `<b>No visitors for 3 days.</b> Check that ${esc(S.page(e.pageId)?.name)} is live and the experiment script is on the page.`));
  e.midTestEdits.forEach((m) => banners.push(callout("warn", `<b>${esc(m.variantKey)} was edited on ${fmtDateTime(m.at)}</b> (${esc(m.section)} section). Visitors before and after saw different versions of ${esc(m.variantKey)}.`)));
  all.guardFail.forEach((g) => banners.push(callout("bad", `<b>Guardrail failing:</b> ${esc(g.v.key)} makes <b>${esc(g.metric.name)}</b> significantly worse.`)));

  const best = a.primary?.rows.slice(1).filter((r) => r.r).sort((x, y) => y.r.lift - x.r.lift)[0];
  const topSec = a.secondary.flatMap((b) => b.rows.slice(1).filter((r) => r.r).map((r) => ({ ...r, metric: b.metric }))).sort((x, y) => Math.abs(y.r.lift) - Math.abs(x.r.lift))[0];
  const conv = a.primary ? a.primary.rows.reduce((s, r) => s + (r.s?.x ?? 0), 0) : 0;
  const winnerFromResult = e.result === "won" ? vs.find((v) => v.id === e.winnerVariantId) : null;

  let decision = "";
  if (e.status === "running" && a.decision) {
    const d = all.decision;
    const tone = d.kind === "ship" ? "good" : d.kind === "rollback" || d.kind === "unhealthy" ? "bad" : "info";
    const act = d.kind === "ship" && can(e, "stop") ? `<button type="button" class="btn sm primary" data-act="exp-stop" data-winner="${d.best.v.id}">Stop &amp; make ${esc(d.best.v.key)} the default</button>`
      : d.kind === "rollback" && can(e, "stop") ? `<button type="button" class="btn sm" data-act="exp-stop">Stop &amp; keep Control</button>` : "";
    decision = `<div class="card decision"><span class="modal-ic ${tone === "good" ? "blue" : tone === "bad" ? "red" : "gray"}">${tone === "good" ? icon.check(18) : tone === "bad" ? icon.warn(18) : icon.clock(18)}</span><div class="grow"><h3>${esc(d.label)}</h3><div class="muted" style="font-size:14px">${esc(d.text)}${d.kind === "ship" ? `. Declaring ${esc(d.best.v.key)} makes it the page's default, so every visitor sees it. A stays as a variant you can switch back to.` : ""}</div></div>${act}</div>`;
  } else if (e.status === "stopped" && e.result) {
    const rel = vs.find((v) => v.id === e.releasedVariantId);
    decision = `<div class="card decision"><span class="modal-ic blue">${icon.check(18)}</span><div class="grow"><h3>${esc(RESULT_LABEL[e.result])}${winnerFromResult ? ` · ${esc(winnerFromResult.key)}` : ""}</h3><div class="muted" style="font-size:14px">${rel ? `${esc(rel.key)} · ${esc(rel.name)} is the page default.` : ""} A stopped test can't restart; duplicate it to run again.</div></div><button type="button" class="btn sm" data-act="exp-duplicate">Duplicate</button></div>`;
  }

  const series = a.primary ? Sim.cumulative(e, e.primaryMetric, device) : [];
  const metric = a.primary?.metric;
  const chart = metric
    ? lineChart({
        x: series.map((p) => p.t),
        series: vs.map((v, i) => ({ label: `${v.key} · ${v.name}`, color: colorOf(v), values: series.map((p) => p.v[i]) })),
        fmt: (v) => (metric.type === "binomial" ? fmtPct(v, 1) : v.toFixed(2)),
        title: `${metric.name} over time`,
      })
    : "";

  return `${banners.join("")}
  <div class="stats4">
    <div class="card stat"><div class="k">Visitors in test</div><div class="v">${fmtInt(a.visitors)}</div><div class="s">Across ${vs.length} variants</div></div>
    <div class="card stat"><div class="k">${esc(metric?.type === "binomial" ? "Conversions (primary)" : "Primary metric")}</div><div class="v">${metric ? fmtInt(conv) : "—"}</div><div class="s">${esc(metric?.name || "No primary metric")}</div></div>
    <div class="card stat"><div class="k">Best variant</div><div class="v ${best?.verdict === "won" ? "up" : ""}">${best ? `${esc(best.v.key)} · ${fmtLift(best.r.lift)}` : "—"}</div><div class="s">${best ? (a.engine === "bayesian" ? `${fmtPct(best.r.chanceToWin, 0)} chance to beat Control` : `p = ${best.r.pValue < 0.001 ? "<0.001" : best.r.pValue.toFixed(3)}`) : "Waiting for data"}</div></div>
    <div class="card stat"><div class="k">Top secondary</div><div class="v">${topSec ? `${esc(topSec.v.key)} · ${fmtLift(topSec.r.lift, 0)}` : "—"}</div><div class="s">${topSec ? `${esc(topSec.metric.name)} vs Control` : "No secondary metrics"}</div></div>
  </div>
  ${decision}
  ${a.primary ? `<section class="card"><div class="toolbar"><div><b>Primary metric · ${esc(metric.name)}</b><div class="small" style="margin:2px 0 0">${a.engine === "bayesian" ? "Bayesian · 95% credible interval" : `Frequentist · 95% confidence interval${e.sequential ? " · sequential" : ""}`}${e.cuped ? " · CUPED" : ""} · simulated data, updated ${timeAgo(Math.floor(S.now() / 600000) * 600000, S.now())}</div></div>
      <div class="end"><div class="seg" role="group" aria-label="Device">${[["all", "All devices"], ["mobile", "Mobile"], ["desktop", "Desktop"]].map(([k, l]) => `<button type="button" aria-pressed="${device === k}" data-act="res-device" data-device="${k}">${l}</button>`).join("")}</div></div></div>
    ${metricTable(e, a.primary, a.engine)}</section>
  <section class="card pad"><h2>${esc(metric.name)} over time</h2><div class="card-sub">Cumulative ${metric.type === "binomial" ? "conversion rate" : "average"} per variant${device !== "all" ? ` · ${device}` : ""}.</div>${chart}</section>` : callout("warn", "No primary metric is set, so there's nothing to decide on.")}
  ${a.secondary.length ? `<section class="card"><div class="toolbar"><b>Secondary metrics</b></div>${a.secondary.map((b) => `<div style="padding:12px 20px 0" class="eyebrow">${esc(b.metric.name)}</div>${metricTable(e, b, a.engine, { compact: true })}`).join("")}</section>` : ""}
  ${a.guardrails.length ? `<section class="card"><div class="toolbar"><b>Guardrails</b><span class="faint" style="font-size:13px">Flagged when a variant is significantly worse</span></div>${a.guardrails.map((b) => `<div style="padding:12px 20px 0" class="eyebrow">${esc(b.metric.name)}</div>${metricTable(e, b, a.engine, { compact: true })}`).join("")}</section>` : ""}`;
}

/* ---------- Health ---------- */
function health(e) {
  if (!e.startedAt) return `<div class="card"><div class="empty"><h3>No traffic yet</h3><div>Health checks run once the experiment starts.</div></div></div>`;
  const a = analyze(e);
  const vs = a.vs;
  const wsum = e.weights.reduce((x, y) => x + Number(y), 0);
  const chart = lineChart({
    x: a.daily.map((d) => d.t),
    series: vs.map((v, i) => ({ label: `${v.key} · ${v.name}`, color: colorOf(v), values: a.daily.map((d) => d.v[i]) })),
    fmt: (v) => fmtInt(v),
    title: "Visitors per day",
    height: 220,
  });
  const ok = (good, label, text) => `<li class="${good ? "ok" : "bad"}"><span class="ic">${good ? "✓" : "✕"}</span><span><b>${label}</b><br><span class="muted">${text}</span></span></li>`;
  return `<section class="card pad"><h2>Health checks</h2>
    <ul class="checklist" style="margin-top:8px">
      ${ok(!a.srm.bad, "Traffic split (SRM)", a.srm.bad ? `Observed split differs from planned (p = ${a.srm.pValue.toExponential(1)}). Common causes: cached pages, redirects, bots.` : `Observed split matches the plan (p = ${a.srm.pValue.toFixed(3)}).`)}
      ${ok(!a.noTraffic, "Traffic is flowing", a.noTraffic ? "No visitors in the last 3 days." : `${fmtInt(a.visitors)} visitors so far.`)}
      ${ok(a.guardFail.length === 0, "Guardrails", a.guardFail.length ? a.guardFail.map((g) => `${g.v.key} worsens ${g.metric.name}`).join("; ") : e.guardrailMetrics.length ? "No guardrail is significantly worse." : "No guardrail metrics set.")}
      ${ok(e.midTestEdits.length === 0, "Variants unchanged during test", e.midTestEdits.length ? `${e.midTestEdits.length} mid-test edit${e.midTestEdits.length > 1 ? "s" : ""} logged on Results.` : "No variant was edited after start.")}
    </ul></section>
  <section class="card"><div class="toolbar"><b>Traffic split</b><span class="faint" style="font-size:13px">Sample ratio mismatch test, flagged when p &lt; 0.001</span></div>
    <div class="table-wrap"><table class="t compact"><thead><tr><th>Variant</th><th class="num">Planned</th><th class="num">Expected visitors</th><th class="num">Observed visitors</th><th class="num">Observed share</th></tr></thead>
    <tbody>${vs.map((v, i) => `<tr><td><div class="row" style="gap:10px">${variantChip(v)} ${esc(v.name)}</div></td><td class="num">${e.weights[i]}%</td><td class="num">${fmtInt((a.visitors * e.weights[i]) / wsum)}</td><td class="num"><b>${fmtInt(a.srm.observed[i])}</b></td><td class="num">${fmtPct(a.srm.observed[i] / Math.max(1, a.visitors), 1)}</td></tr>`).join("")}</tbody></table></div></section>
  <section class="card pad"><h2>Visitors per day</h2><div class="card-sub">By variant. Weekends usually dip.</div>${chart}</section>`;
}

/* ---------- History ---------- */
function history(e) {
  const items = [...e.history].sort((a, b) => b.at - a.at);
  return `<div class="grid2"><section class="card pad"><h2>History</h2><div class="card-sub">Every change to this experiment.</div>
      <ul class="timeline">${items.map((h) => `<li>${h.by === "system" ? `<span class="avatar" style="background:var(--text-3)">⚙</span>` : avatar(h.by)}<div><div>${esc(h.by === "system" ? "System" : S.user(h.by).name)} · ${esc(h.text)}</div><div class="when">${fmtDateTime(h.at)}</div></div></li>`).join("")}</ul></section>
    <section class="card pad"><h2>Comments</h2><div class="card-sub">Discuss results with your team.</div>
      <form data-comment><label class="sr-only" for="cm">Comment</label><textarea id="cm" name="text" class="inp" placeholder="Write a comment" ${S.canEdit() ? "" : "disabled"}></textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="submit" class="btn sm primary" ${S.canEdit() ? "" : "disabled"}>Comment</button></div></form>
      <ul class="timeline">${e.comments.length ? [...e.comments].reverse().map((c) => `<li>${avatar(c.by)}<div><div><b>${esc(S.user(c.by).name)}</b> <span class="when">${timeAgo(c.at, S.now())}</span></div><div style="white-space:pre-wrap">${esc(c.text)}</div>${c.by === S.get().currentUserId ? `<button type="button" class="link-btn" style="font-size:13px" data-act="exp-del-comment" data-cid="${c.id}">Delete</button>` : ""}</div></li>`).join("") : `<li><span></span><span class="faint">No comments yet.</span></li>`}</ul></section></div>`;
}

export function render({ id, tab = "overview" }) {
  const e = S.exp(id);
  if (!e) return `<div class="card"><div class="empty"><h3>Experiment not found</h3><div>It may have been deleted.</div><div style="margin-top:14px"><a class="btn sm" href="#/experiments">Back to Experiments</a></div></div></div>`;
  const body = tab === "results" ? results(e) : tab === "health" ? health(e) : tab === "history" ? history(e) : overview(e);
  return `<div data-id="${e.id}">${header(e, tab)}${body}</div>`;
}

export function bind(root, rerender, { id }) {
  const e = S.exp(id);
  if (!e) return;
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
  root.querySelector("[data-primary]")?.addEventListener("change", (ev) => {
    e.primaryMetric = ev.target.value || null;
    e.secondaryMetrics = e.secondaryMetrics.filter((m) => m !== e.primaryMetric);
    e.guardrailMetrics = e.guardrailMetrics.filter((m) => m !== e.primaryMetric);
    commit(`Set the primary metric to ${S.metric(e.primaryMetric)?.name || "none"}`);
  });
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

Object.assign(acts, {
  "exp-engine": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    if (!can(e, "analysis")) return;
    e.statsEngine = el.dataset.engine;
    if (e.statsEngine === "bayesian") e.sequential = false;
    S.log(e, `Switched the stats engine to ${e.statsEngine}`);
    S.save();
  },
  "exp-split-even": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    const n = e.variantIds.length;
    const even = Math.floor(100 / n);
    e.weights = e.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
    S.log(e, `Split traffic evenly (${e.weights.join("/")})`);
    S.save();
  },
  "exp-add-variant": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    if (!can(e, "editVariants")) return;
    e.variantIds.push(el.dataset.vid);
    const n = e.variantIds.length;
    const even = Math.floor(100 / n);
    e.weights = e.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
    S.log(e, `Added variant ${S.variantsOf(e)[n - 1].key} and split evenly`);
    S.save();
  },
  "exp-remove-variant": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    if (!can(e, "editVariants")) return;
    const idx = e.variantIds.indexOf(el.dataset.vid);
    const key = S.variantsOf(e)[idx]?.key;
    e.variantIds.splice(idx, 1);
    e.weights.splice(idx, 1);
    const n = e.variantIds.length;
    const even = Math.floor(100 / n);
    e.weights = e.variantIds.map((_, i) => (i === 0 ? 100 - even * (n - 1) : even));
    S.log(e, `Removed variant ${key} and split evenly`);
    S.save();
  },
  "exp-preview": (el) => {
    const v = S.page(S.exp(el.closest("[data-id]").dataset.id).pageId)?.variants.find((x) => x.id === el.dataset.vid);
    toast(`Preview of ${v?.key} opens the page with ?gb-preview=${v?.key}. Not counted.`);
  },
  "res-device": (el, rr) => {
    device = el.dataset.device;
    rr();
  },
  "exp-del-comment": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    e.comments = e.comments.filter((c) => c.id !== el.dataset.cid);
    S.save();
  },
  "exp-edit-info": (el) => {
    const e = S.exp(el.closest("[data-id]").dataset.id);
    if (!can(e, "editText")) return toast(why(e, "editText"), "bad");
    openModal({
      title: "Edit name & details",
      wide: true,
      body: `<div class="field"><label for="ei-name">Experiment name</label><input id="ei-name" name="name" class="inp" value="${esc(e.name)}"><div data-err="name"></div></div>
        <div class="field"><label for="ei-hyp">Hypothesis</label><textarea id="ei-hyp" name="hypothesis" class="inp">${esc(e.hypothesis)}</textarea></div>
        <div class="field"><label for="ei-desc">Description <span class="opt">· optional</span></label><textarea id="ei-desc" name="description" class="inp">${esc(e.description)}</textarea></div>
        <div class="row"><div class="grow field"><label for="ei-tags">Tags</label><input id="ei-tags" name="tags" class="inp" value="${esc(e.tags.join(", "))}"></div>
        <div class="grow field"><label for="ei-owner">Owner</label><select id="ei-owner" name="owner" class="inp">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === e.ownerId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        if (!name) {
          form.querySelector("[data-err=name]").innerHTML = `<div class="err">${icon.warn(14)} Enter a name</div>`;
          return;
        }
        Object.assign(e, {
          name,
          hypothesis: String(fd.get("hypothesis")).trim(),
          description: String(fd.get("description")).trim(),
          tags: String(fd.get("tags")).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          ownerId: fd.get("owner"),
        });
        S.log(e, "Edited name and details");
        S.save();
        closeModal();
      },
    });
  },
});
export const _slug = slugify;
