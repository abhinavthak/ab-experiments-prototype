// Targeting building blocks (attribute conditions, assignment)
// plus the Audiences page that lists the visitor attributes.
import * as S from "../store.js";
import { icon } from "../ui.js";
import { esc } from "../util.js";

export const ATTRIBUTES = [
  { key: "country", label: "Country", type: "string", example: "IN", desc: "Where the visitor is browsing from, read from the CDN's location header. Use 2-letter codes: IN, AE, US." },
  { key: "city", label: "City", type: "string", example: "Mumbai", desc: "The visitor's city, read from the CDN's location header, e.g. Mumbai, Delhi." },
  { key: "browser", label: "Browser", type: "string", example: "chrome", desc: "The visitor's browser in lowercase: chrome, safari, firefox, edge." },
  { key: "utm_source", label: "UTM source", type: "string", example: "google", desc: "Where the visit came from, taken from utm_source in the landing URL, e.g. google, facebook, newsletter." },
  { key: "utm_medium", label: "UTM medium", type: "string", example: "cpc", desc: "The kind of traffic, taken from utm_medium in the landing URL, e.g. cpc (paid search), paid_social, email." },
  { key: "utm_campaign", label: "UTM campaign", type: "string", example: "bba-admissions-2026", desc: "The campaign name, taken from utm_campaign in the landing URL." },
  { key: "is_logged_in", label: "Logged in", type: "boolean", desc: "Whether the visitor is signed in to a student account." },
  { key: "lead_stage", label: "Lead stage", type: "enum", values: ["none", "enquired", "counselled", "applied", "enrolled"], desc: "How far the visitor is in admissions, from the CRM. “none” means they haven't enquired yet." },
  { key: "page_visits", label: "Page visits", type: "number", example: "3", desc: "How many pages the visitor has viewed on the site, including this one." },
  { key: "visitor_id", label: "Visitor ID", type: "string", id: true, desc: "Anonymous ID stored in a cookie." },
  { key: "lead_id", label: "Lead ID", type: "string", id: true, desc: "CRM ID, known once the visitor submits a form." },
  { key: "lead_email", label: "Lead email", type: "string", id: true, desc: "Email from the CRM, once known." },
  { key: "session_id", label: "Session ID", type: "string", id: true, desc: "Changes on every new visit." },
];
export const OPS = [["is", "is"], ["not", "is not"], ["in", "is one of"], ["nin", "is not one of"], ["contains", "contains"], ["gt", "is greater than"], ["lt", "is less than"], ["exists", "exists"], ["true", "is true"], ["false", "is false"]];
const opsFor = (a) => (a?.type === "boolean" ? ["true", "false", "exists"] : a?.type === "number" ? ["is", "not", "gt", "lt", "exists"] : ["is", "not", "in", "nin", "contains", "exists"]);
export const condText = (c) => {
  const a = ATTRIBUTES.find((x) => x.key === c.attr);
  const op = OPS.find(([k]) => k === c.op)?.[1] || c.op;
  return `${a?.label || c.attr} ${op}${["exists", "true", "false"].includes(c.op) ? "" : ` ${c.value}`}`;
};

export const CONDITIONS_INTRO = `<div class="hint" style="margin:0 0 10px">Limit the test to visitors who match. Each row reads as a sentence: <b>attribute</b> (what we know about the visitor) → <b>operator</b> (how to compare) → <b>value</b>. A visitor must match <b>every</b> row. Everyone else sees the page default and isn't counted in results.</div>`;

const OP_HELP = {
  is: "exact match", not: "anything except this value", in: "matches any value in the comma-separated list", nin: "matches none of the values in the list",
  contains: "the value appears anywhere in it", gt: "a bigger number", lt: "a smaller number", exists: "we know this about the visitor, whatever the value", true: "yes", false: "no",
};
// One plain-language sentence for a condition, plus where the attribute comes from.
export function condHelp(c) {
  const a = ATTRIBUTES.find((x) => x.key === c.attr) || ATTRIBUTES[0];
  const name = a.label.toLowerCase();
  const v = String(c.value || "").trim();
  const list = v.split(",").map((x) => x.trim()).filter(Boolean).map((x) => `“${esc(x)}”`).join(", ");
  const val = v ? `“${esc(v)}”` : "";
  const need = ["exists", "true", "false"].includes(c.op) || v;
  const sentence = !need
    ? `<span class="faint">Enter a value${["in", "nin"].includes(c.op) ? "s, separated by commas" : ""} to finish this rule.</span>`
    : {
        is: `Only visitors whose ${name} is ${val}.`,
        not: `Only visitors whose ${name} is anything except ${val}.`,
        in: `Only visitors whose ${name} is one of ${list}.`,
        nin: `Only visitors whose ${name} is none of ${list}.`,
        contains: `Only visitors whose ${name} contains ${val}.`,
        gt: `Only visitors with more than ${esc(v)} ${name}.`,
        lt: `Only visitors with fewer than ${esc(v)} ${name}.`,
        exists: `Only visitors whose ${name} is known.`,
        true: a.key === "is_logged_in" ? "Only visitors who are logged in." : `Only visitors where ${name} is yes.`,
        false: a.key === "is_logged_in" ? "Only visitors who are not logged in." : `Only visitors where ${name} is no.`,
      }[c.op] || "";
  return `<div class="cond-help"><b class="cond-say">${sentence}</b><span>${esc(a.desc || "")} <span class="faint">“${esc(OPS.find(([k]) => k === c.op)?.[1] || c.op)}” = ${esc(OP_HELP[c.op] || "")}.</span></span></div>`;
}

// Condition rows. Editable rows have data-cond="i" with attr/op/value fields.
export function conditionEditor(conds, { disabled = false, prefix = "cond" } = {}) {
  const row = (c, i) => {
    const a = ATTRIBUTES.find((x) => x.key === c.attr) || ATTRIBUTES[0];
    const noVal = ["exists", "true", "false"].includes(c.op);
    return `<div class="cond" data-cond="${i}"><div class="cond-row">
      <span class="faint cond-and">${i === 0 ? "IF" : "AND"}</span>
      <select class="inp" name="${prefix}-attr-${i}" aria-label="Attribute" ${disabled ? "disabled" : ""}>${ATTRIBUTES.filter((x) => !x.id).map((x) => `<option value="${x.key}" ${x.key === a.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
      <select class="inp" name="${prefix}-op-${i}" aria-label="Operator" ${disabled ? "disabled" : ""}>${opsFor(a).map((k) => `<option value="${k}" ${k === c.op ? "selected" : ""}>${OPS.find(([x]) => x === k)[1]}</option>`).join("")}</select>
      ${noVal ? `<span></span>` : a.type === "enum" ? `<select class="inp" name="${prefix}-val-${i}" aria-label="Value" ${disabled ? "disabled" : ""}>${a.values.map((v) => `<option ${v === c.value ? "selected" : ""}>${v}</option>`).join("")}</select>` : `<input class="inp" name="${prefix}-val-${i}" aria-label="Value" value="${esc(c.value || "")}" placeholder="${esc(c.op === "in" || c.op === "nin" ? "comma, separated" : a.example || "")}" ${disabled ? "disabled" : ""}>`}
      ${disabled ? "" : `<button type="button" class="btn xs ghost" data-cond-del="${i}" aria-label="Remove condition">${icon.x(16)}</button>`}</div>
      ${disabled ? "" : condHelp(c)}</div>`;
  };
  return `<div class="conds" data-conds="${prefix}">${conds.length ? conds.map(row).join("") : `<div class="faint" style="font-size:14px">No conditions · everyone in the audience above can enter the test</div>`}
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
  box.addEventListener("input", (ev) => {
    const row = ev.target.closest("[data-cond]");
    if (!row) return;
    const c = readConditions(root, prefix)[Number(row.dataset.cond)];
    row.querySelector(".cond-help")?.replaceWith(document.createRange().createContextualFragment(condHelp(c)));
  });
}

export const HASH_ATTRS = [["visitor_id", "Visitor ID (cookie)"], ["lead_id", "Lead ID"], ["session_id", "Session ID"]];

/* ---------- Audiences page: visitor attributes ---------- */
export function renderAudiences() {
  const body = `<div class="card"><div class="toolbar"><div><b>Attributes</b><div class="small" style="margin:2px 0 0">What the CMS knows about a visitor when it picks a variant. Identifier attributes can be used to assign variants.</div></div></div>
      <div class="table-wrap"><table class="t compact"><thead><tr><th>Attribute</th><th>Key</th><th>Type</th><th>Where it comes from</th><th>Used for</th></tr></thead><tbody>
      ${ATTRIBUTES.map((a) => `<tr><td><b>${esc(a.label)}</b></td><td class="mono">${esc(a.key)}</td><td>${a.type}${a.values ? ` · ${a.values.join(", ")}` : ""}</td><td style="min-width:260px">${esc(a.desc || "")}</td><td>${a.id ? "Assigning variants" : "Targeting conditions"}</td></tr>`).join("")}</tbody></table></div></div>`;
  return `<div class="page-head"><div><h1>Audiences</h1><div class="sub">What the CMS knows about a visitor, for targeting conditions and assigning variants</div></div></div>${body}`;
}

