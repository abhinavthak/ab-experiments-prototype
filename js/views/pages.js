import * as S from "../store.js";
import { canSetDefault, canDeleteVariant, variantUse, MAX_VARIANTS } from "../rules.js";
import { acts, applyPageDefault, go } from "../actions.js";
import { icon, pill, variantChip, menu, menuItem, openModal, closeModal, confirmModal, callout, emptyRow } from "../ui.js";
import { esc, timeAgo, toast, uid, slugify } from "../util.js";
import { openCreate } from "./create.js";

const SECTIONS = [
  { name: "Common Header", block: true },
  { name: "Banner" }, { name: "About" }, { name: "Highlights" }, { name: "Sticky CTA" }, { name: "Curriculum" },
  { name: "Fee section" }, { name: "Case Study" }, { name: "Faculty" }, { name: "FAQ" },
  { name: "Banner Video", block: true }, { name: "Footer", block: true },
];
const editable = SECTIONS.filter((s) => !s.block);

function ensureEdits(v, isDefault) {
  if (v.edits) return v.edits;
  v.edits = {};
  if (!isDefault) editable.slice(0, v.changes).forEach((s, i) => (v.edits[s.name] = i === 1 && v.changes >= 2 ? "new" : "edited"));
  return v.edits;
}
const syncChanges = (v) => (v.changes = Object.keys(v.edits || {}).length);

let pageUi = { tab: "all", q: "" };

export function renderList() {
  const st = S.get();
  const live = st.pages.filter((p) => p.status === "live").length;
  const rows = st.pages.filter((p) => (pageUi.tab === "all" || p.status === pageUi.tab) && `${p.name} ${p.path}`.toLowerCase().includes(pageUi.q.toLowerCase()));
  return `<div class="page-head"><div><h1>Pages</h1><div class="sub">${st.pages.length} pages · ${live} live · ${st.pages.length - live} drafts</div></div>
    <button type="button" class="btn primary lg" data-act="page-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New page</button></div>
  <div class="card"><div class="toolbar">
    <label class="search"><span class="sr-only">Search pages</span>${icon.search()}<input class="inp" type="search" data-page-search value="${esc(pageUi.q)}" placeholder="Search pages"></label>
    <div class="seg" role="tablist" aria-label="Status">${[["all", "All", st.pages.length], ["live", "Live", live], ["draft", "Draft", st.pages.length - live]].map(([k, l, n]) => `<button type="button" role="tab" aria-selected="${pageUi.tab === k}" data-act="page-tab" data-tab="${k}">${l}<span class="count">${n}</span></button>`).join("")}</div></div>
  <div class="table-wrap"><table class="t" style="min-width:860px"><thead><tr><th>Page</th><th style="width:220px">Experiment</th><th style="width:110px">Status</th><th style="width:230px"><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${rows.length ? rows.map((p) => {
    const active = S.activeExpOnPage(p.id);
    const items = [
      menuItem("nav", "Open page editor", { ic: icon.edit(), data: `data-href="#/page/${p.id}"` }),
      menuItem("page-new-exp", "New experiment on this page", { ic: icon.flask(18), data: `data-pid="${p.id}"`, disabled: !S.canEdit() ? "You need Editor access" : p.status !== "live" ? "Publish the page first" : p.variants.length < 2 ? "Create a second variant first" : active ? `“${active.name}” is ${active.status} here` : "" }),
      p.status === "live" ? menuItem("page-draft", "Move to draft", { ic: icon.archive(), data: `data-pid="${p.id}"`, disabled: !S.canEdit() ? "You need Editor access" : "" }) : menuItem("page-publish", "Publish", { ic: icon.check(18), data: `data-pid="${p.id}"`, disabled: S.canEdit() ? "" : "You need Editor access" }),
      "<hr>",
      menuItem("page-delete", "Delete page", { ic: icon.trash(), danger: true, data: `data-pid="${p.id}"`, disabled: S.canEdit() ? "" : "You need Editor access" }),
    ].join("");
    return `<tr><td><a class="exp-name" href="#/page/${p.id}">${esc(p.name)}</a><div class="meta"><span class="mono">${esc(p.path)}</span><span>· ${esc(p.type)} · ${p.sections} sections${p.variants.length > 1 ? ` · ${p.variants.length} variants` : ""} · edited ${timeAgo(p.editedAt, S.now())}</span></div></td>
      <td>${active ? `<a href="#/experiment/${active.id}/${active.status === "running" ? "results" : "overview"}">${pill(active.status === "running" ? "green" : "amber", active.status === "running" ? "Running" : "Scheduled")}</a><div class="small">${esc(active.name)}</div>` : `<span class="faint">None</span>`}</td>
      <td>${pill(p.status === "live" ? "green" : "gray", p.status === "live" ? "Live" : "Draft")}</td>
      <td><div class="actions"><a class="btn sm" href="#/page/${p.id}">Edit</a><button type="button" class="btn sm" data-act="page-view" data-pid="${p.id}">${p.status === "live" ? "View" : "Preview"}</button>${menu("⋯", items, { label: `More actions for ${p.name}` })}</div></td></tr>`;
  }).join("") : emptyRow(4, "No pages match")}</tbody></table></div></div>`;
}

export function bindList(root, rerender) {
  const inp = root.querySelector("[data-page-search]");
  inp?.addEventListener("input", () => {
    pageUi.q = inp.value;
    const pos = inp.selectionStart;
    rerender();
    const again = document.querySelector("[data-page-search]");
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

/* ---------- Editor ---------- */
export function renderEditor({ id, query }) {
  const p = S.page(id);
  if (!p) return `<div class="card"><div class="empty"><h3>Page not found</h3><div style="margin-top:14px"><a class="btn sm" href="#/pages">Back to Pages</a></div></div></div>`;
  const sel = p.variants.find((v) => v.id === query.get("v")) || p.variants.find((v) => v.id === p.defaultVariantId);
  const def = p.variants.find((v) => v.id === p.defaultVariantId);
  p.variants.forEach((v) => ensureEdits(v, v.id === p.defaultVariantId));
  const active = S.activeExpOnPage(p.id);
  const use = variantUse(p, sel.id);
  const isDef = sel.id === def.id;
  const atLimit = p.variants.length >= MAX_VARIANTS;

  let warn = "";
  if (use.active && !isDef) warn = callout("warn", `You're editing <b>${esc(sel.key)}</b>, which is in a ${use.active.status} experiment. Changes reach its visitors right away and can skew results. Visitors outside the test see ${esc(def.key)} (default).`, `<a class="btn xs" href="#/experiment/${use.active.id}/results">Open experiment</a>`);
  else if (isDef && active) warn = callout("warn", `You're editing <b>${esc(def.key)} (default)</b>, the Control of a ${active.status} experiment. Changes go live right away. Sections in other variants marked “Same as ${esc(def.key)}” change too, so the variants stay comparable.`, `<a class="btn xs" href="#/experiment/${active.id}/results">Open experiment</a>`);
  else if (use.drafts.length) warn = callout("info", `${esc(sel.key)} is in ${use.drafts.length} draft experiment${use.drafts.length > 1 ? "s" : ""}: ${use.drafts.map((e) => `<a href="#/experiment/${e.id}/overview">${esc(e.name)}</a>`).join(", ")}.`);

  const vItems = (v) => {
    const sd = canSetDefault(p, v.id);
    const del = canDeleteVariant(p, v.id);
    return [
      menuItem("var-default", "Set as default", { data: `data-pid="${p.id}" data-vid="${v.id}"`, disabled: sd }),
      menuItem("var-rename", "Rename", { data: `data-pid="${p.id}" data-vid="${v.id}"`, disabled: S.canEdit() ? "" : "You need Editor access" }),
      menuItem("var-duplicate", "Duplicate", { data: `data-pid="${p.id}" data-vid="${v.id}"`, disabled: !S.canEdit() ? "You need Editor access" : atLimit ? `${MAX_VARIANTS} of ${MAX_VARIANTS} variants. Delete one to add another.` : "" }),
      "<hr>",
      menuItem("var-delete", "Delete", { danger: true, data: `data-pid="${p.id}" data-vid="${v.id}"`, disabled: del }),
    ].join("");
  };

  return `<div class="crumbs"><a href="#/pages">Pages</a> / ${esc(p.name)}</div>
  <div class="page-head" style="margin-bottom:20px"><div><h1 style="font-size:28px">${esc(p.name)}</h1><div class="sub" style="font-size:14px"><span class="mono">${esc(p.path)}</span> · ${esc(p.type)} · ${p.sections} sections · ${pill(p.status === "live" ? "green" : "gray", p.status === "live" ? "Live" : "Draft")}</div></div>
    <div class="head-actions">${p.status === "live" ? `<button type="button" class="btn sm" data-act="page-draft" data-pid="${p.id}">Move to draft</button>` : `<button type="button" class="btn sm" data-act="page-publish" data-pid="${p.id}">Publish</button>`}<button type="button" class="btn sm primary" data-act="page-new-exp" data-pid="${p.id}" ${!S.canEdit() || p.status !== "live" || p.variants.length < 2 || active ? "disabled" : ""}>${icon.flask(18)} New experiment</button></div></div>
  <div class="editor">
    <aside class="card pad vlist"><div class="eyebrow" style="margin-bottom:8px">Page variants · ${p.variants.length}</div>
      ${p.variants.map((v) => {
        const u = variantUse(p, v.id);
        const status = v.id === def.id ? `Default · ${p.sections} sections · what visitors see` : `${v.changes} change${v.changes === 1 ? "" : "s"}${u.active ? ` · in a ${u.active.status} experiment` : u.drafts.length ? " · in a draft experiment" : ""}`;
        return `<div class="row" style="gap:4px;flex-wrap:nowrap"><button type="button" class="v ${v.id === sel.id ? "on" : ""}" data-act="nav" data-href="#/page/${p.id}?v=${v.id}" aria-current="${v.id === sel.id}">${variantChip(v)}<span><span class="vn">${esc(v.name)}</span>${v.id === def.id ? ` <span class="badge">Default</span>` : ""}<br><span class="vs">${esc(status)}</span></span><span></span></button>${menu("⋯", vItems(v), { label: `Actions for ${v.key}`, cls: "btn xs icon-btn" })}</div>`;
      }).join("")}
      <button type="button" class="btn sm" style="width:100%;margin-top:12px" data-act="var-new" data-pid="${p.id}" ${!S.canEdit() || atLimit ? "disabled" : ""}>${icon.plus(16)} New variant</button>
      ${atLimit ? `<div class="hint">${MAX_VARIANTS} of ${MAX_VARIANTS} variants. Delete one to add another.</div>` : ""}
      <p class="hint">The default is what visitors see outside an experiment, and it's the Control in every experiment on this page. It can't change while an experiment here is running or scheduled.</p>
    </aside>
    <section>
      ${warn}
      <div class="card pad" style="margin-bottom:16px"><div class="card-head"><div class="row" style="gap:10px">${variantChip(sel)}<div><div class="eyebrow">Page variant</div><b style="font-size:17px">${esc(sel.name)}</b></div></div>
        <div class="row" style="gap:8px"><button type="button" class="btn sm" data-act="page-view" data-pid="${p.id}" data-vid="${sel.id}">${icon.eye()} Preview ${esc(sel.key)}</button>${!isDef ? `<button type="button" class="btn sm" data-act="var-default" data-pid="${p.id}" data-vid="${sel.id}" ${canSetDefault(p, sel.id) ? `disabled title="${esc(canSetDefault(p, sel.id))}"` : ""}>Set as default</button>` : ""}</div></div></div>
      ${SECTIONS.map((s) => {
        if (s.block) return `<div class="section-row block"><span class="badge">Block</span><div class="grow"><b>${esc(s.name)}</b><div class="small" style="margin:0">Shared by every variant. Edit it in Widget Blocks.</div></div></div>`;
        const st = isDef ? "default" : sel.edits[s.name] || "same";
        const label = st === "default" ? "" : st === "same" ? `Same as ${def.key}` : st === "new" ? `New in ${sel.key}` : `Edited in ${sel.key}`;
        return `<div class="section-row"><div class="grow"><b>${esc(s.name)}</b>${label ? ` <span class="badge ${st === "same" ? "" : "blue"}">${esc(label)}</span>` : ""}</div>
          <button type="button" class="btn xs" data-act="sec-edit" data-pid="${p.id}" data-vid="${sel.id}" data-sec="${esc(s.name)}" ${S.canEdit() ? "" : "disabled"}>Edit</button>
          ${!isDef && st !== "same" ? `<button type="button" class="btn xs" data-act="sec-reset" data-pid="${p.id}" data-vid="${sel.id}" data-sec="${esc(s.name)}" ${S.canEdit() ? "" : "disabled"}>Reset to ${esc(def.key)}</button>` : ""}</div>`;
      }).join("")}
    </section></div>`;
}

export function onEditorMount({ id, query }) {
  if (query.get("new") === "1") {
    history.replaceState(null, "", `#/page/${id}`);
    newVariant(S.page(id));
  }
}

function newVariant(p, fromId = null) {
  if (p.variants.length >= MAX_VARIANTS) return toast(`${MAX_VARIANTS} of ${MAX_VARIANTS} variants. Delete one to add another.`, "bad");
  const key = String.fromCharCode(65 + Math.max(...p.variants.map((v) => v.key.charCodeAt(0) - 65)) + 1);
  const def = p.variants.find((v) => v.id === p.defaultVariantId);
  const drafts = S.get().pages.filter((x) => x.status === "draft" && x.id !== p.id);
  const sdBlocked = canSetDefault(p, "__new__");
  openModal({
    title: "New page variant",
    body: `<div class="hint" style="margin-top:0">${esc(p.name)} · ${esc(p.path)} · ${p.variants.length} variants so far</div>
      <div class="field" style="margin-top:12px"><label for="nv-name">Variant name</label><div class="row" style="flex-wrap:nowrap">${variantChip({ key, name: "" })}<input id="nv-name" name="name" class="inp" placeholder="e.g. Counsellor-first layout"></div><div data-err="name"></div></div>
      <div class="field"><span class="label">Start from</span><div class="stack-sm">
        <label class="check on"><input type="radio" name="from" value="default" ${fromId ? "" : "checked"}><span><span class="t1">Copy of ${esc(def.key)} (default) <span class="badge green">Recommended</span></span><span class="t2">All sections stay the same as ${esc(def.key)} until you edit them, so fixes to ${esc(def.key)} still reach ${esc(key)}.</span></span></label>
        <label class="check"><input type="radio" name="from" value="variant" ${fromId ? "checked" : ""}><span><span class="t1">Copy of another variant</span><span class="t2">Starts with that variant's changes, to try one more tweak on top.</span>
          <select name="fromVariant" class="inp" style="margin-top:8px">${p.variants.filter((v) => v.id !== def.id).map((v) => `<option value="${v.id}" ${v.id === fromId ? "selected" : ""}>${esc(v.key)} · ${esc(v.name)}</option>`).join("") || "<option value=''>No other variants</option>"}</select></span></label>
        <label class="check"><input type="radio" name="from" value="draft" ${drafts.length ? "" : "disabled"}><span><span class="t1">Existing draft page</span><span class="t2">Copies the sections of a draft from Pages. The draft itself stays unpublished.</span>
          <select name="fromDraft" class="inp" style="margin-top:8px">${drafts.map((d) => `<option value="${d.id}">${esc(d.name)} · ${esc(d.type)}</option>`).join("") || "<option value=''>No draft pages</option>"}</select><span data-err="from"></span></span></label>
      </div></div>
      <label class="check ${sdBlocked ? "disabled" : ""}"><input type="checkbox" name="makeDefault" ${sdBlocked ? "disabled" : ""}><span><span class="t1">Make ${esc(key)} the default variant</span><span class="t2">${sdBlocked ? esc(sdBlocked) : "Every visitor outside an experiment will see it. You can switch the default any time from the variant menu."}</span></span></label>
      <p class="hint">Blocks like Common Header and Banner Video stay shared by every variant.</p>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Create variant</button>`,
    onOpen: (form) => form.addEventListener("change", () => form.querySelectorAll(".check").forEach((c) => c.classList.toggle("on", !!c.querySelector("input:checked")))),
    onSubmit: (fd, form) => {
      const name = String(fd.get("name") || "").trim();
      const from = fd.get("from");
      const errs = {};
      if (!name) errs.name = "Enter a variant name";
      else if (p.variants.some((v) => v.name.toLowerCase() === name.toLowerCase())) errs.name = `A variant called “${name}” already exists on this page`;
      if (from === "draft") {
        const d = S.page(fd.get("fromDraft"));
        if (d && d.type !== p.type) errs.from = `${d.name} is an “${d.type}” page. Choose a ${p.type} page.`;
      }
      form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
      if (Object.keys(errs).length) return;
      const v = { id: uid("v"), key, name, changes: 0, edits: {} };
      if (from === "variant") {
        const src = p.variants.find((x) => x.id === fd.get("fromVariant"));
        if (src) v.edits = { ...ensureEdits(src, false) };
      } else if (from === "draft") {
        editable.forEach((s) => (v.edits[s.name] = "edited"));
      }
      syncChanges(v);
      p.variants.push(v);
      p.editedAt = S.now();
      if (fd.get("makeDefault")) applyPageDefault(p, v.id);
      S.save();
      closeModal();
      toast(`Created ${key} · ${name}`, "good");
      go(`#/page/${p.id}?v=${v.id}`);
    },
  });
}

const pv = (el) => {
  const p = S.page(el.dataset.pid);
  return { p, v: p?.variants.find((x) => x.id === el.dataset.vid) };
};

Object.assign(acts, {
  "page-tab": (el, rr) => { pageUi.tab = el.dataset.tab; rr(); },
  "page-new-exp": (el) => openCreate(el.dataset.pid),
  "page-view": (el) => {
    const { p, v } = pv(el);
    toast(`Opens ${p.path}${v ? `?gb-preview=${v.key}` : ""} on the site (not part of this prototype)`);
  },
  "page-new": () => {
    openModal({
      title: "New page",
      body: `<div class="field"><label for="np-name">Page name</label><input id="np-name" name="name" class="inp"><div data-err="name"></div></div>
        <div class="field"><label for="np-path">URL path</label><input id="np-path" name="path" class="inp mono" placeholder="/my-new-page"><div data-err="path"></div></div>
        <div class="field"><label for="np-type">Page type</label><select id="np-type" name="type" class="inp"><option>Program</option><option>Others</option></select></div>
        <label class="check"><input type="checkbox" name="leadForm" checked><span><span class="t1">Has a lead form</span><span class="t2">Enables lead form metrics for experiments on this page</span></span></label>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Create draft page</button>`,
      onOpen: (form) => form.name.addEventListener("input", () => (form.path.value = `/${slugify(form.name.value)}`)),
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        const path = String(fd.get("path")).trim();
        const errs = {};
        if (!name) errs.name = "Enter a page name";
        if (!/^\/[a-z0-9/_-]*$/.test(path)) errs.path = "Start with / and use lowercase letters, numbers, - and _";
        else if (S.get().pages.some((x) => x.path === path)) errs.path = "Another page already uses this path";
        form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
        if (Object.keys(errs).length) return;
        const v = { id: uid("v"), key: "A", name: "Original", changes: 0, edits: {} };
        const p = { id: uid("pg"), name, path, type: fd.get("type"), status: "draft", sections: 10, editedAt: S.now(), traffic: 500, hasLeadForm: !!fd.get("leadForm"), variants: [v], defaultVariantId: v.id };
        S.get().pages.unshift(p);
        S.save();
        closeModal();
        go(`#/page/${p.id}`);
      },
    });
  },
  "page-draft": (el) => {
    const { p } = pv(el);
    const a = S.activeExpOnPage(p.id);
    if (a) {
      openModal({ title: `Can't move ${p.name} to draft`, ic: icon.lock(18), tone: "gray",
        body: `<p style="margin-top:0">“${esc(a.name)}” is ${a.status} on this page. Stop the experiment first. The same applies to deleting the page.</p>`,
        footer: `<a class="btn sm" href="#/experiment/${a.id}/overview" data-act="modal-close-nav">Open experiment</a><button type="button" class="btn sm primary" data-act="modal-close">OK</button>` });
      return;
    }
    p.status = "draft";
    p.editedAt = S.now();
    S.save();
    toast(`${p.name} is now a draft`);
  },
  "page-publish": (el) => {
    const { p } = pv(el);
    p.status = "live";
    p.editedAt = S.now();
    S.save();
    toast(`${p.name} is live`, "good");
  },
  "page-delete": (el) => {
    const { p } = pv(el);
    const a = S.activeExpOnPage(p.id);
    if (a) return acts["page-draft"](el);
    const n = S.get().experiments.filter((e) => e.pageId === p.id).length;
    confirmModal({
      title: `Delete ${p.name}?`, danger: true, tone: "red", confirm: "Delete page",
      text: `The page and its ${p.variants.length} variant${p.variants.length > 1 ? "s" : ""} will be deleted.${n ? ` ${n} experiment${n > 1 ? "s" : ""} on this page keep their results but can't be started.` : ""} This can't be undone.`,
      onConfirm: () => {
        const st = S.get();
        st.pages = st.pages.filter((x) => x.id !== p.id);
        S.save();
        go("#/pages");
      },
    });
  },
  "var-new": (el) => newVariant(S.page(el.dataset.pid)),
  "var-duplicate": (el) => {
    const { p, v } = pv(el);
    newVariant(p, v.id === p.defaultVariantId ? null : v.id);
  },
  "var-rename": (el) => {
    const { p, v } = pv(el);
    openModal({
      title: `Rename ${v.key}`,
      body: `<div class="field"><label for="rn">Variant name</label><input id="rn" name="name" class="inp" value="${esc(v.name)}"><div data-err="name"></div></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        const err = !name ? "Enter a name" : p.variants.some((x) => x.id !== v.id && x.name.toLowerCase() === name.toLowerCase()) ? `A variant called “${name}” already exists on this page` : "";
        if (err) return (form.querySelector("[data-err]").innerHTML = `<div class="err">${icon.warn(14)} ${esc(err)}</div>`);
        v.name = name;
        S.save();
        closeModal();
      },
    });
  },
  "var-default": (el) => {
    const { p, v } = pv(el);
    const why = canSetDefault(p, v.id);
    if (why) return toast(why, "bad");
    const cur = p.variants.find((x) => x.id === p.defaultVariantId);
    const drafts = S.get().experiments.filter((e) => e.pageId === p.id && e.status === "draft" && !e.archived && e.variantIds[0] === cur.id);
    confirmModal({
      title: `Make ${v.key} the default?`, confirm: `Make ${v.key} default`,
      text: `Visitors to ${esc(p.name)} will see <b>${esc(v.key)} · ${esc(v.name)}</b> instead of ${esc(cur.key)}. ${esc(cur.key)} stays as a variant you can switch back to.${drafts.length ? `<br><br>${drafts.length} draft experiment${drafts.length > 1 ? "s" : ""} on this page use${drafts.length > 1 ? "" : "s"} ${esc(cur.key)} as Control. ${drafts.length > 1 ? "They" : "It"} will use ${esc(v.key)} instead, and ${esc(v.key)} will be removed from ${drafts.length > 1 ? "their" : "its"} variant list.` : ""}`,
      onConfirm: () => {
        applyPageDefault(p, v.id);
        p.editedAt = S.now();
        S.save();
        toast(`${v.key} is now the default`, "good");
      },
    });
  },
  "var-delete": (el) => {
    const { p, v } = pv(el);
    const why = canDeleteVariant(p, v.id);
    if (why) return toast(why, "bad");
    const { drafts } = variantUse(p, v.id);
    confirmModal({
      title: `Delete variant ${v.key}?`, danger: true, tone: "red", confirm: "Delete variant",
      text: `${esc(v.name)} and its ${v.changes} section change${v.changes === 1 ? "" : "s"} will be deleted. This can't be undone.${drafts.length ? `<br><br>${esc(v.key)} is in ${drafts.length} draft experiment${drafts.length > 1 ? "s" : ""}. It will be removed from ${drafts.length > 1 ? "their" : "its"} variant list.` : ""}`,
      onConfirm: () => {
        drafts.forEach((e) => {
          const i = e.variantIds.indexOf(v.id);
          e.variantIds.splice(i, 1);
          e.weights.splice(i, 1);
          const n = e.variantIds.length;
          const even = Math.floor(100 / n);
          e.weights = e.variantIds.map((_, k) => (k === 0 ? 100 - even * (n - 1) : even));
          S.log(e, `Variant ${v.key} was deleted from the page and removed from this experiment`);
        });
        p.variants = p.variants.filter((x) => x.id !== v.id);
        S.save();
        go(`#/page/${p.id}`);
      },
    });
  },
  "sec-edit": (el) => {
    const { p, v } = pv(el);
    const sec = el.dataset.sec;
    const isDef = v.id === p.defaultVariantId;
    const commit = () => {
      if (!isDef) {
        v.edits[sec] = v.edits[sec] === "new" ? "new" : "edited";
        syncChanges(v);
      }
      p.editedAt = S.now();
      const { active } = variantUse(p, v.id);
      if (active && active.status === "running") {
        active.midTestEdits.push({ variantKey: v.key, section: sec, at: S.now() });
        S.log(active, `${v.key} was edited mid-test (${sec} section)`);
      }
      S.save();
      toast(`Saved ${sec} in ${v.key}${active ? " · logged on the experiment's results" : ""}`, "good");
    };
    openModal({
      title: `Edit ${sec} · ${v.key}`,
      body: `<div class="field"><label for="sx">Heading</label><input id="sx" name="h" class="inp" value="${esc(sec === "Banner" ? "India's first AI-native BBA" : sec)}"></div>
        <div class="field"><label for="sy">Body</label><textarea id="sy" name="b" class="inp">Designed for leaders shaping an AI-driven future.</textarea></div>
        ${isDef ? callout("info", `Editing the default also changes this section in every variant still marked “Same as ${esc(v.key)}”.`) : `<p class="hint">Saving gives ${esc(v.key)} its own copy of ${esc(sec)}. ${esc(p.variants.find((x) => x.id === p.defaultVariantId).key)}'s later changes to this section won't reach ${esc(v.key)}.</p>`}`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save section</button>`,
      onSubmit: () => {
        closeModal();
        commit();
      },
    });
  },
  "sec-reset": (el) => {
    const { p, v } = pv(el);
    const sec = el.dataset.sec;
    const def = p.variants.find((x) => x.id === p.defaultVariantId);
    confirmModal({
      title: `Reset ${sec} to ${def.key}?`, confirm: `Reset to ${def.key}`,
      text: `${esc(v.key)}'s changes to ${esc(sec)} will be discarded. From now on, this section will match ${esc(def.key)} and follow its changes.`,
      onConfirm: () => {
        delete v.edits[sec];
        syncChanges(v);
        S.save();
      },
    });
  },
});
