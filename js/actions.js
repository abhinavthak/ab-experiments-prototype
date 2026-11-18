// Experiment lifecycle actions (start, schedule, stop, archive, delete, duplicate…).
import * as S from "./store.js";
import { can, why } from "./rules.js";
import { openModal, closeModal, confirmModal, icon, callout, variantChip } from "./ui.js";
import { esc, toast, fmtDate, fmtDateTime, DAY, copyText, uid } from "./util.js";
import { RESULT_LABEL } from "./store.js";

export const acts = {};
export const go = (h) => (location.hash = h);

function guard(e, action) {
  if (can(e, action)) return true;
  toast(why(e, action), "bad");
  return false;
}

function splitText(e) {
  return S.variantsOf(e).map((v, i) => `${v.key} ${e.weights[i]}%`).join(" · ");
}

// S1 + S2
export function startExperiment(e) {
  if (!guard(e, "startNow")) return;
  const { items, blocked } = S.startChecks(e);
  const p = S.page(e.pageId);
  const list = `<ul class="checklist">${items
    .map((i) => `<li class="${i.warn ? "warn" : i.ok ? "ok" : "bad"}"><span class="ic">${i.warn ? "!" : i.ok ? "✓" : "✕"}</span><span>${esc(i.label)}${!i.ok && i.fix ? ` <span class="faint">· ${esc(i.fix)}</span>` : ""}</span></li>`)
    .join("")}</ul>`;
  if (blocked) {
    openModal({
      title: `Ready to start · ${items.filter((i) => !i.ok && !i.warn).length} to fix`,
      ic: icon.warn(18), tone: "amber",
      body: `<p style="margin-top:0">Start stays disabled until every red item is fixed. Amber items only warn.</p>${list}`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Close</button><button type="button" class="btn sm primary" disabled>Start experiment</button>`,
    });
    return;
  }
  openModal({
    title: "Start this experiment?",
    ic: icon.play(18), tone: "blue",
    body: `<p style="margin-top:0"><b>${esc(e.name)}</b> will go live to ${e.coverage}% of ${esc(p.name)} visitors, split ${esc(splitText(e))}.</p>
      ${list}
      ${callout("info", "Once started, you can't add or remove variants, change the split, change the primary metric, change the tracking key, or change the page default.")}`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Start now</button>`,
    onSubmit: () => {
      e.status = "running";
      e.startedAt = S.now();
      e.scheduledStart = null;
      e.notice = null;
      e.sim = e.sim || S.simFor(e);
      S.log(e, "Started the experiment");
      S.save();
      closeModal();
      toast("Experiment started", "good");
      go(`#/experiment/${e.id}/results`);
    },
  });
}

// S3
export function scheduleExperiment(e) {
  if (!guard(e, "schedule")) return;
  const other = S.activeExpOnPage(e.pageId, e.id);
  if (other) {
    openModal({ title: "Can't schedule yet", ic: icon.warn(18), tone: "amber",
      body: `<p>“${esc(other.name)}” is ${other.status} on this page. One running or scheduled experiment per page, so visitors never see conflicting variants.</p>`,
      footer: `<a class="btn sm" href="#/experiment/${other.id}/overview" data-act="modal-close-nav">Open experiment</a><button type="button" class="btn sm primary" data-act="modal-close">OK</button>` });
    return;
  }
  const base = new Date(e.scheduledStart ?? S.now() + DAY);
  const pad = (n) => String(n).padStart(2, "0");
  const dVal = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  const tVal = e.scheduledStart ? `${pad(base.getHours())}:${pad(base.getMinutes())}` : "09:00";
  openModal({
    title: e.status === "scheduled" ? "Reschedule start" : "Schedule start",
    ic: icon.calendar(18), tone: "blue",
    body: `<div class="row"><div class="grow field"><label for="s-date">Date</label><input id="s-date" name="date" type="date" class="inp" value="${dVal}" required></div>
      <div class="grow field"><label for="s-time">Time (local)</label><input id="s-time" name="time" type="time" class="inp" value="${tVal}" required></div></div>
      <div id="s-info" class="hint"></div><div id="s-err"></div>
      <p class="hint">A scheduled test is still editable, and can be started now or unscheduled. If the page isn't live at start time, the start is skipped and it goes back to Draft.</p>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Schedule</button>`,
    onOpen: (form) => {
      const upd = () => {
        const t = new Date(`${form.date.value}T${form.time.value}`).getTime();
        form.querySelector("#s-info").textContent = e.stopAfterDays && isFinite(t) ? `Stops ${e.stopAfterDays} days later, on ${fmtDate(t + e.stopAfterDays * DAY)}.` : "No stop date set.";
      };
      form.addEventListener("input", upd);
      upd();
    },
    onSubmit: (fd, form) => {
      const t = new Date(`${fd.get("date")}T${fd.get("time")}`).getTime();
      if (!isFinite(t) || t <= S.now()) {
        form.querySelector("#s-err").innerHTML = `<div class="err">${icon.warn(14)} Pick a time in the future</div>`;
        form.date.setAttribute("aria-invalid", "true");
        return;
      }
      e.status = "scheduled";
      e.scheduledStart = t;
      e.notice = null;
      S.log(e, `Scheduled the start for ${fmtDateTime(t)}`);
      S.save();
      closeModal();
      toast(`Scheduled for ${fmtDateTime(t)}`, "good");
    },
  });
}

// E6
export function unscheduleExperiment(e) {
  if (!guard(e, "unschedule")) return;
  confirmModal({
    title: "Cancel the scheduled start?", tone: "amber", ic: icon.warn(18), confirm: "Unschedule",
    text: `<b>${esc(e.name)}</b> won't start on ${esc(fmtDate(e.scheduledStart))}. It stays a draft with its setup.`,
    onConfirm: () => {
      e.status = "draft";
      e.scheduledStart = null;
      S.log(e, "Unscheduled the start");
      S.save();
      toast("Back to Draft");
    },
  });
}

// Set a page default; draft experiments on the page switch their Control (V1).
export function applyPageDefault(page, variantId, byExpId) {
  if (page.defaultVariantId === variantId) return;
  // Change counts are relative to the default: the old default now differs
  // from the new one in exactly the sections the new one had changed.
  const oldDef = page.variants.find((v) => v.id === page.defaultVariantId);
  const newDef = page.variants.find((v) => v.id === variantId);
  if (oldDef && newDef) {
    const diff = { ...(newDef.edits || {}) };
    if (!newDef.edits) for (let i = 0; i < newDef.changes; i++) diff[`Section ${i + 1}`] = "edited";
    oldDef.edits = Object.fromEntries(Object.keys(diff).map((k) => [k, "edited"]));
    oldDef.changes = Object.keys(oldDef.edits).length;
    newDef.edits = {};
    newDef.changes = 0;
  }
  page.defaultVariantId = variantId;
  S.get().experiments.forEach((x) => {
    if (x.pageId !== page.id || x.archived || x.status !== "draft" || x.id === byExpId) return;
    if (x.variantIds[0] === variantId) return;
    const rest = x.variantIds.slice(1).filter((id) => id !== variantId);
    x.variantIds = [variantId, ...rest];
    const even = Math.floor(100 / x.variantIds.length);
    x.weights = x.variantIds.map((_, i) => (i === 0 ? 100 - even * (x.variantIds.length - 1) : even));
    S.log(x, "Control switched to the page's new default");
  });
}

// E1 (also used for "Record result" after an automatic stop, S9)
export function stopExperiment(e, { preset = null } = {}) {
  const recording = e.status === "stopped" && !e.result;
  if (!recording && !guard(e, "stop")) return;
  const vs = S.variantsOf(e);
  const p = S.page(e.pageId);
  const results = [
    ["won", "Won", "A variant beat Control"],
    ["lost", "Lost", "No variant beat Control"],
    ["inconclusive", "No clear winner", "Differences too small to call"],
    ["dnf", "Did not finish", "Stopped early, for example because of a bug"],
  ];
  const sel = preset?.result || "won";
  const winner = preset?.winner || vs[1]?.id;
  openModal({
    title: recording ? "Record a result" : "Stop experiment",
    wide: true,
    body: `${recording ? callout("warn", `Stopped automatically on ${esc(fmtDate(e.endedAt))}. Visitors see ${esc(vs.find((v) => v.id === p.defaultVariantId)?.key || "A")} (default) again. Record a result to finish.`) : ""}
      <div class="label">Result</div>
      <div class="stack-sm" role="radiogroup">${results
        .map(([k, t, d]) => `<label class="check ${k === sel ? "on" : ""}"><input type="radio" name="result" value="${k}" ${k === sel ? "checked" : ""}><span><span class="t1">${t}</span><span class="t2">${d}</span></span></label>`)
        .join("")}</div>
      <div class="field" id="winner-field" style="margin-top:16px"><label for="st-winner">Winning variant</label>
        <select id="st-winner" name="winner" class="inp">${vs.slice(1).map((v) => `<option value="${v.id}" ${v.id === winner ? "selected" : ""}>${esc(v.key)} · ${esc(v.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="st-default">Page default after stopping</label>
        <select id="st-default" name="released" class="inp">${vs.map((v) => `<option value="${v.id}">${esc(v.key)} · ${esc(v.name)}${v.id === p.defaultVariantId ? " (current default)" : ""}</option>`).join("")}</select>
        <div class="hint" id="st-hint"></div></div>
      ${callout("info", "A stopped test can't restart. Duplicate it to run again. Results stay readable.")}`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">${recording ? "Save result" : "Stop experiment"}</button>`,
    onOpen: (form) => {
      const upd = (ev) => {
        const r = form.querySelector("input[name=result]:checked").value;
        form.querySelectorAll(".check").forEach((c) => c.classList.toggle("on", c.querySelector("input").checked));
        form.querySelector("#winner-field").hidden = r !== "won";
        if (!ev || ev.target.name === "result" || ev.target.name === "winner") {
          form.released.value = r === "won" ? form.winner.value : vs[0].id;
        }
        const rel = vs.find((v) => v.id === form.released.value);
        form.querySelector("#st-hint").textContent = `All visitors see ${rel.key} right away${rel.id !== p.defaultVariantId ? `, and ${rel.key} becomes the page's default` : ""}.`;
      };
      form.addEventListener("change", upd);
      upd();
    },
    onSubmit: (fd) => {
      const result = fd.get("result");
      if (!recording) {
        e.status = "stopped";
        e.endedAt = S.now();
      }
      e.result = result;
      e.winnerVariantId = result === "won" ? fd.get("winner") : null;
      e.releasedVariantId = fd.get("released");
      applyPageDefault(p, e.releasedVariantId, e.id);
      const rel = vs.find((v) => v.id === e.releasedVariantId);
      S.log(e, `${recording ? "Recorded" : "Stopped the experiment and recorded"} “${RESULT_LABEL[result]}”; ${rel.key} is the page default`);
      S.save();
      closeModal();
      toast(`${rel.key} is now the default for ${p.name}`, "good");
    },
  });
}

export function archiveExperiment(e) {
  if (!guard(e, "archive")) return;
  confirmModal({
    title: "Archive this experiment?", ic: icon.archive(18), confirm: "Archive",
    text: "It moves to the Archived tab and stops counting in the summary strip. You can unarchive it any time.",
    onConfirm: () => {
      e.archived = true;
      S.log(e, "Archived the experiment");
      S.save();
      toast("Archived");
    },
  });
}
export function unarchiveExperiment(e) {
  if (!guard(e, "unarchive")) return;
  e.archived = false;
  S.log(e, "Unarchived the experiment");
  S.save();
  toast("Unarchived");
}

// E4
export function deleteExperiment(e, after) {
  if (!can(e, "delete")) {
    openModal({
      title: `Can't delete a ${e.status} experiment`, ic: icon.lock(18), tone: "gray",
      body: `<p style="margin-top:0">${e.status === "running" ? "Stop it first." : "Unschedule it first."} Leads already tagged with its tracking key keep their tags.</p>`,
      footer: `<button type="button" class="btn sm primary" data-act="modal-close">OK</button>`,
    });
    return;
  }
  confirmModal({
    title: "Delete experiment?", danger: true, tone: "red", confirm: "Delete",
    text: `<b>${esc(e.name)}</b> will be deleted. The page's variants aren't affected, and leads keep their exp_key tag. This can't be undone.`,
    onConfirm: () => {
      const st = S.get();
      st.experiments = st.experiments.filter((x) => x.id !== e.id);
      S.save();
      toast("Experiment deleted");
      after?.();
    },
  });
}

// E5
export function duplicateExperiment(e) {
  if (!S.canEdit()) return toast("You need Editor access", "bad");
  const p = S.page(e.pageId);
  const d = S.newExperimentDraft();
  const control = p?.defaultVariantId ?? e.variantIds[0];
  const ids = [control, ...e.variantIds.filter((id) => id !== control && p?.variants.some((v) => v.id === id))];
  const even = Math.floor(100 / ids.length);
  Object.assign(d, {
    name: `${e.name} (copy)`,
    trackingKey: S.uniqueKey(e.trackingKey.replace(/-\d+$/, "")),
    pageId: e.pageId, variantIds: ids, weights: ids.map((_, i) => (i === 0 ? 100 - even * (ids.length - 1) : even)),
    hypothesis: e.hypothesis, description: e.description, tags: [...e.tags], coverage: e.coverage, targeting: { ...e.targeting },
    primaryMetric: e.primaryMetric, secondaryMetrics: [...e.secondaryMetrics], guardrailMetrics: [...e.guardrailMetrics],
    statsEngine: e.statsEngine, sequential: e.sequential, cuped: e.cuped, stopAfterDays: e.stopAfterDays, leadAttribution: e.leadAttribution,
  });
  d.history.push({ at: S.now(), by: S.get().currentUserId, text: `Duplicated from “${e.name}”` });
  S.get().experiments.unshift(d);
  S.save();
  const ck = S.variantsOf(d)[0]?.key;
  toast(`Created a draft copy. Tracking key: ${d.trackingKey}. Control is ${ck} (the page's current default).`, "good");
  go(`#/experiment/${d.id}/overview`);
}

export function editStopDate(e) {
  if (!guard(e, "stopDate")) return;
  const opts = [null, 7, 14, 21, 28, 42];
  openModal({
    title: "Stop date",
    ic: icon.calendar(18), tone: "blue",
    body: `<div class="field"><label for="sd">Stop</label><select id="sd" name="days" class="inp">${opts
      .map((o) => `<option value="${o ?? ""}" ${o === e.stopAfterDays ? "selected" : ""}>${o ? `${o} days after start` : "Manually (no stop date)"}</option>`)
      .join("")}</select><div class="hint">A stop date gives the test a planned length, so the list can show a progress bar. On that date it stops by itself and asks for a result.</div></div>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
    onSubmit: (fd) => {
      const v = fd.get("days");
      const days = v ? Number(v) : null;
      if (days && e.startedAt && e.startedAt + days * DAY <= S.now()) {
        toast("That date has already passed for this experiment", "bad");
        return;
      }
      e.stopAfterDays = days;
      S.log(e, days ? `Set the stop date to ${days} days after start` : "Removed the stop date");
      S.save();
      S.reconcile();
      closeModal();
    },
  });
}

export function toggleWatch(e) {
  e.watched = !e.watched;
  S.save();
  toast(e.watched ? "Watching. You'll be notified of changes." : "Stopped watching");
}

// Registry hooks
const byId = (el) => S.exp(el.closest("[data-id]")?.dataset.id || el.dataset.id);
Object.assign(acts, {
  "exp-start": (el) => startExperiment(byId(el)),
  "exp-schedule": (el) => scheduleExperiment(byId(el)),
  "exp-unschedule": (el) => unscheduleExperiment(byId(el)),
  "exp-stop": (el) => stopExperiment(byId(el), { preset: el.dataset.winner ? { result: "won", winner: el.dataset.winner } : null }),
  "exp-archive": (el) => archiveExperiment(byId(el)),
  "exp-unarchive": (el) => unarchiveExperiment(byId(el)),
  "exp-delete": (el) => deleteExperiment(byId(el), () => go("#/experiments")),
  "exp-duplicate": (el) => duplicateExperiment(byId(el)),
  "exp-stopdate": (el) => editStopDate(byId(el)),
  "exp-watch": (el) => toggleWatch(byId(el)),
  "exp-copykey": (el) => copyText(byId(el).trackingKey),
  "exp-dismiss-notice": (el) => {
    const e = byId(el);
    e.notice = null;
    S.save();
  },
});
export { uid, variantChip };
