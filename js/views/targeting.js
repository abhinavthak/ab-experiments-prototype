// Targeting building blocks (attribute conditions, saved groups, namespaces,
// assignment) plus the Audiences page that manages them.
import * as S from "../store.js";
import { acts } from "../actions.js";
import { icon, openModal, closeModal, confirmModal, emptyRow, avatar } from "../ui.js";
import { esc, fmtDate, fmtPct, toast, uid } from "../util.js";

export const ATTRIBUTES = [
  { key: "country", label: "Country", type: "string", example: "IN" },
  { key: "city", label: "City", type: "string", example: "Mumbai" },
  { key: "browser", label: "Browser", type: "string", example: "chrome" },
  { key: "utm_source", label: "UTM source", type: "string", example: "google" },
  { key: "utm_medium", label: "UTM medium", type: "string", example: "cpc" },
  { key: "utm_campaign", label: "UTM campaign", type: "string", example: "bba-admissions-2026" },
  { key: "is_logged_in", label: "Logged in", type: "boolean" },
  { key: "lead_stage", label: "Lead stage", type: "enum", values: ["none", "enquired", "counselled", "applied", "enrolled"] },
  { key: "page_visits", label: "Page visits", type: "number", example: "3" },
  { key: "visitor_id", label: "Visitor ID", type: "string", id: true },
  { key: "lead_id", label: "Lead ID", type: "string", id: true },
  { key: "lead_email", label: "Lead email", type: "string", id: true },
  { key: "session_id", label: "Session ID", type: "string", id: true },
];
export const OPS = [["is", "is"], ["not", "is not"], ["in", "is one of"], ["nin", "is not one of"], ["contains", "contains"], ["gt", "is greater than"], ["lt", "is less than"], ["exists", "exists"], ["true", "is true"], ["false", "is false"]];
const opsFor = (a) => (a?.type === "boolean" ? ["true", "false", "exists"] : a?.type === "number" ? ["is", "not", "gt", "lt", "exists"] : ["is", "not", "in", "nin", "contains", "exists"]);
export const condText = (c) => {
  const a = ATTRIBUTES.find((x) => x.key === c.attr);
  const op = OPS.find(([k]) => k === c.op)?.[1] || c.op;
  return `${a?.label || c.attr} ${op}${["exists", "true", "false"].includes(c.op) ? "" : ` ${c.value}`}`;
};

// Condition rows. Editable rows have data-cond="i" with attr/op/value fields.
export function conditionEditor(conds, { disabled = false, prefix = "cond" } = {}) {
  const row = (c, i) => {
    const a = ATTRIBUTES.find((x) => x.key === c.attr) || ATTRIBUTES[0];
    const noVal = ["exists", "true", "false"].includes(c.op);
    return `<div class="cond-row" data-cond="${i}">
      <span class="faint cond-and">${i === 0 ? "IF" : "AND"}</span>
      <select class="inp" name="${prefix}-attr-${i}" aria-label="Attribute" ${disabled ? "disabled" : ""}>${ATTRIBUTES.filter((x) => !x.id).map((x) => `<option value="${x.key}" ${x.key === a.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
      <select class="inp" name="${prefix}-op-${i}" aria-label="Operator" ${disabled ? "disabled" : ""}>${opsFor(a).map((k) => `<option value="${k}" ${k === c.op ? "selected" : ""}>${OPS.find(([x]) => x === k)[1]}</option>`).join("")}</select>
      ${noVal ? `<span></span>` : a.type === "enum" ? `<select class="inp" name="${prefix}-val-${i}" aria-label="Value" ${disabled ? "disabled" : ""}>${a.values.map((v) => `<option ${v === c.value ? "selected" : ""}>${v}</option>`).join("")}</select>` : `<input class="inp" name="${prefix}-val-${i}" aria-label="Value" value="${esc(c.value || "")}" placeholder="${esc(c.op === "in" || c.op === "nin" ? "comma, separated" : a.example || "")}" ${disabled ? "disabled" : ""}>`}
      ${disabled ? "" : `<button type="button" class="btn xs ghost" data-cond-del="${i}" aria-label="Remove condition">${icon.x(16)}</button>`}</div>`;
  };
  return `<div class="conds" data-conds="${prefix}">${conds.length ? conds.map(row).join("") : `<div class="faint" style="font-size:14px">No conditions · everyone in the audience above is eligible</div>`}
    ${disabled ? "" : `<button type="button" class="btn xs" data-cond-add="${prefix}">${icon.plus(14)} Add condition</button>`}</div>`;
}

export function readConditions(form, prefix = "cond") {
  const out = [];
  form.querySelectorAll(`[data-conds="${prefix}"] [data-cond]`).forEach((r) => {
    const i = r.dataset.cond;
    const attr = form.querySelector(`[name="${prefix}-attr-${i}"]`)?.value;
    const op = form.querySelector(`[name="${prefix}-op-${i}"]`)?.value;
    const value = form.querySelector(`[name="${prefix}-val-${i}"]`)?.value?.trim() ?? "";
    if (attr) out.push({ attr, op, value });
  });
  return out;
}

// Wires add/remove/attribute-change inside a container. onChange(conds) re-renders.
export function bindConditions(root, prefix, get, set) {
  const box = root.querySelector(`[data-conds="${prefix}"]`);
  if (!box) return;
  const rerender = (conds) => {
    set(conds);
    box.outerHTML = conditionEditor(conds, { prefix });
    bindConditions(root, prefix, get, set);
  };
  box.querySelector(`[data-cond-add]`)?.addEventListener("click", () => rerender([...readConditions(root, prefix), { attr: "country", op: "is", value: "" }]));
  box.querySelectorAll("[data-cond-del]").forEach((b) => b.addEventListener("click", () => rerender(readConditions(root, prefix).filter((_, i) => i !== Number(b.dataset.condDel)))));
  box.querySelectorAll(`select[name^="${prefix}-attr-"], select[name^="${prefix}-op-"]`).forEach((sel) =>
    sel.addEventListener("change", () => {
      const conds = readConditions(root, prefix);
      if (sel.name.includes("-attr-")) {
        const i = Number(sel.name.split("-").pop());
        const a = ATTRIBUTES.find((x) => x.key === conds[i].attr);
        conds[i].op = opsFor(a)[0];
        conds[i].value = "";
      }
      rerender(conds);
    }),
  );
  box.addEventListener("change", () => set(readConditions(root, prefix)));
}

export function savedGroupPicker(selected, { disabled = false, name = "sg" } = {}) {
  const st = S.get();
  if (!st.savedGroups.length) return `<div class="faint">No saved groups yet. <a href="#/audiences">Create one</a></div>`;
  return `<div class="stack-sm">${st.savedGroups.map((g) => {
    const cur = selected.find((x) => x.id === g.id);
    return `<div class="row sg-row"><span class="grow"><b>${esc(g.name)}</b> <span class="faint">· ${g.kind === "list" ? `${g.values.length} IDs` : esc(g.condition)} · ~${fmtPct(g.reach, 0)} of visitors</span></span>
      <select class="inp" name="${name}-${g.id}" style="width:150px" aria-label="${esc(g.name)}" ${disabled ? "disabled" : ""}><option value="">Not used</option><option value="include" ${cur?.mode === "include" ? "selected" : ""}>Only include</option><option value="exclude" ${cur?.mode === "exclude" ? "selected" : ""}>Exclude</option></select></div>`;
  }).join("")}</div>`;
}
export function readSavedGroups(form, name = "sg") {
  return S.get().savedGroups.map((g) => ({ id: g.id, mode: form.querySelector(`[name="${name}-${g.id}"]`)?.value })).filter((x) => x.mode);
}

export function namespaceBar(nsId, range, exceptId) {
  const others = S.get().experiments.filter((x) => x.id !== exceptId && !x.archived && x.namespace?.id === nsId && x.status !== "stopped");
  const seg = (r, cls, title) => `<div class="ns-seg ${cls}" style="left:${r[0]}%;width:${r[1] - r[0]}%" title="${esc(title)}"></div>`;
  return `<div class="ns-bar" aria-hidden="true">${others.map((x) => seg(x.namespace.range, x.status === "draft" ? "draft" : "used", `${x.name} (${x.status}) ${x.namespace.range.join("–")}%`)).join("")}${range ? seg(range, "mine", "This experiment") : ""}</div>
    <div class="small" style="margin-top:4px">${others.length ? others.map((x) => `${esc(x.name)} · ${x.namespace.range.join("–")}% · ${x.status}`).join("<br>") : "No other experiments in this namespace"}</div>`;
}

export const HASH_ATTRS = [["visitor_id", "Visitor ID (cookie)"], ["lead_id", "Lead ID"], ["session_id", "Session ID"]];

/* ---------- Audiences page: saved groups, attributes, namespaces ---------- */
let tab = "groups";
export function renderAudiences() {
  const st = S.get();
  const usedBy = (pred) => st.experiments.filter((e) => !e.archived && pred(e));
  const tabs = [["groups", "Saved groups"], ["attributes", "Attributes"], ["namespaces", "Namespaces"]];
  let body = "";
  if (tab === "groups") {
    body = `<div class="card"><div class="toolbar"><div><b>Saved groups</b><div class="small" style="margin:2px 0 0">Reusable audiences for experiment targeting: a condition, or a list of IDs.</div></div><div class="end"><button type="button" class="btn sm primary" data-act="sg-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus(16)} New saved group</button></div></div>
      <div class="table-wrap"><table class="t" style="min-width:720px"><thead><tr><th>Name</th><th>Definition</th><th class="num">Reach</th><th>Used in</th><th>Owner</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${st.savedGroups.length ? st.savedGroups.map((g) => {
        const used = usedBy((e) => e.targeting.savedGroups?.some((x) => x.id === g.id));
        return `<tr><td><b>${esc(g.name)}</b><div class="small" style="margin:2px 0 0">${esc(g.desc || "")}</div></td>
        <td>${g.kind === "list" ? `<span class="badge">ID list</span> ${esc(g.attribute)} · ${g.values.length} values` : `<span class="badge">Condition</span> <span class="mono" style="font-size:13px">${esc(g.condition)}</span>`}</td>
        <td class="num">~${fmtPct(g.reach, 0)}</td><td>${used.length ? used.map((e) => `<a href="#/experiment/${e.id}/overview">${esc(e.name)}</a>`).join("<br>") : `<span class="faint">Not used</span>`}</td><td>${avatar(g.ownerId)}</td>
        <td><div class="actions"><button type="button" class="btn xs" data-act="sg-edit" data-gid="${g.id}" ${S.canEdit() ? "" : "disabled"}>Edit</button><button type="button" class="btn xs" data-act="sg-delete" data-gid="${g.id}" ${S.canEdit() && !used.length ? "" : `disabled title="${used.length ? "Used by an experiment" : "You need Editor access"}"`}>Delete</button></div></td></tr>`;
      }).join("") : emptyRow(6, "No saved groups")}</tbody></table></div></div>`;
  } else if (tab === "attributes") {
    body = `<div class="card"><div class="toolbar"><div><b>Attributes</b><div class="small" style="margin:2px 0 0">What the CMS knows about a visitor when it picks a variant. Identifier attributes can be used to assign variants.</div></div></div>
      <div class="table-wrap"><table class="t compact"><thead><tr><th>Attribute</th><th>Key</th><th>Type</th><th>Used for</th></tr></thead><tbody>
      ${ATTRIBUTES.map((a) => `<tr><td><b>${esc(a.label)}</b></td><td class="mono">${esc(a.key)}</td><td>${a.type}${a.values ? ` · ${a.values.join(", ")}` : ""}</td><td>${a.id ? "Assignment (hash attribute), ID lists" : "Targeting conditions"}</td></tr>`).join("")}</tbody></table></div></div>`;
  } else {
    body = `<div class="card"><div class="toolbar"><div><b>Namespaces</b><div class="small" style="margin:2px 0 0">Experiments in the same namespace never share visitors: each takes a slice of 0–100%.</div></div><div class="end"><button type="button" class="btn sm primary" data-act="ns-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus(16)} New namespace</button></div></div>
      <div class="stack" style="padding:16px 20px">${st.namespaces.map((n) => `<div><div class="row"><b class="grow">${esc(n.name)}</b>${S.canEdit() && !usedBy((e) => e.namespace?.id === n.id).length ? `<button type="button" class="btn xs" data-act="ns-delete" data-nid="${n.id}">Delete</button>` : ""}</div><div class="small" style="margin:2px 0 8px">${esc(n.desc || "")}</div>${namespaceBar(n.id, null, null)}</div>`).join("") || `<div class="faint">No namespaces</div>`}</div></div>`;
  }
  return `<div class="page-head"><div><h1>Audiences</h1><div class="sub">Saved groups, attributes and namespaces used by experiment targeting</div></div></div>
    <nav class="tabs" aria-label="Audiences">${tabs.map(([k, l]) => `<a href="#/audiences" data-act="aud-tab" data-tab="${k}" class="${tab === k ? "on" : ""}" ${tab === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>${body}`;
}

function sgModal(g) {
  const isNew = !g;
  g = g || { kind: "condition", name: "", desc: "", condition: "", attribute: "lead_email", values: [], reach: 0.1 };
  openModal({
    title: isNew ? "New saved group" : `Edit ${g.name}`,
    wide: true,
    body: `<div class="field"><label for="sg-name">Name</label><input id="sg-name" name="name" class="inp" value="${esc(g.name)}"><div data-err="name"></div></div>
      <div class="field"><label for="sg-desc">Description <span class="opt">· optional</span></label><input id="sg-desc" name="desc" class="inp" value="${esc(g.desc || "")}"></div>
      <div class="field"><span class="label">Type</span><div class="seg" style="display:inline-flex" role="group"><button type="button" aria-pressed="${g.kind === "condition"}" data-local-kind="condition">Condition</button><button type="button" aria-pressed="${g.kind === "list"}" data-local-kind="list">ID list</button></div><input type="hidden" name="kind" value="${g.kind}"></div>
      <div data-kind="condition" ${g.kind === "condition" ? "" : "hidden"}><div class="field"><label for="sg-cond">Condition</label><input id="sg-cond" name="condition" class="inp mono" value="${esc(g.condition || "")}" placeholder="utm_medium is one of cpc, paid_social"><div class="hint">Written like a targeting rule, e.g. <span class="mono">country is IN</span>.</div></div></div>
      <div data-kind="list" ${g.kind === "list" ? "" : "hidden"}><div class="row"><div class="grow field"><label for="sg-attr">Identifier</label><select id="sg-attr" name="attribute" class="inp">${ATTRIBUTES.filter((a) => a.id).map((a) => `<option value="${a.key}" ${a.key === g.attribute ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></div></div>
        <div class="field"><label for="sg-vals">Values <span class="opt">· one per line</span></label><textarea id="sg-vals" name="values" class="inp mono">${esc((g.values || []).join("\n"))}</textarea></div></div>
      <div class="field"><label for="sg-reach">Estimated reach</label><div class="pct-input"><input id="sg-reach" name="reach" type="number" class="inp" min="0" max="100" value="${Math.round(g.reach * 100)}"><span>%</span></div><div class="hint">Share of page visitors in this group. In the prototype it scales simulated traffic.</div></div>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">${isNew ? "Create" : "Save"}</button>`,
    onOpen: (form) => form.querySelectorAll("[data-local-kind]").forEach((b) => b.addEventListener("click", () => {
      form.kind.value = b.dataset.localKind;
      form.querySelectorAll("[data-local-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      form.querySelectorAll("[data-kind]").forEach((d) => (d.hidden = d.dataset.kind !== form.kind.value));
    })),
    onSubmit: (fd, form) => {
      const name = String(fd.get("name")).trim();
      if (!name) return (form.querySelector("[data-err=name]").innerHTML = `<div class="err">${icon.warn(14)} Enter a name</div>`);
      const rec = { name, desc: String(fd.get("desc")).trim(), kind: fd.get("kind"), condition: String(fd.get("condition") || "").trim(), attribute: fd.get("attribute"),
        values: String(fd.get("values") || "").split("\n").map((x) => x.trim()).filter(Boolean), reach: Math.max(0, Math.min(1, Number(fd.get("reach")) / 100)) };
      if (isNew) S.get().savedGroups.push({ id: uid("sg"), ownerId: S.get().currentUserId, createdAt: S.now(), ...rec });
      else Object.assign(g, rec);
      S.save();
      closeModal();
      toast(isNew ? `Created ${name}` : "Saved", "good");
    },
  });
}

Object.assign(acts, {
  "aud-tab": (el, rr) => { tab = el.dataset.tab; rr(); },
  "sg-new": () => sgModal(null),
  "sg-edit": (el) => sgModal(S.savedGroup(el.dataset.gid)),
  "sg-delete": (el) => confirmModal({ title: "Delete saved group?", danger: true, tone: "red", confirm: "Delete", text: `<b>${esc(S.savedGroup(el.dataset.gid)?.name)}</b> will be deleted.`, onConfirm: () => {
    S.get().savedGroups = S.get().savedGroups.filter((g) => g.id !== el.dataset.gid);
    S.save();
  } }),
  "ns-new": () => openModal({
    title: "New namespace",
    body: `<div class="field"><label for="ns-name">Name</label><input id="ns-name" name="name" class="inp"><div data-err="name"></div></div><div class="field"><label for="ns-desc">Description</label><input id="ns-desc" name="desc" class="inp"></div>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Create</button>`,
    onSubmit: (fd, form) => {
      const name = String(fd.get("name")).trim();
      if (!name) return (form.querySelector("[data-err=name]").innerHTML = `<div class="err">Enter a name</div>`);
      S.get().namespaces.push({ id: uid("ns"), name, desc: String(fd.get("desc")).trim() });
      S.save();
      closeModal();
    },
  }),
  "ns-delete": (el) => {
    S.get().namespaces = S.get().namespaces.filter((n) => n.id !== el.dataset.nid);
    S.save();
  },
});
export const _date = fmtDate;
