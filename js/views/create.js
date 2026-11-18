import * as S from "../store.js";
import { openModal, closeModal, icon, variantChip } from "../ui.js";
import { esc, slugify, toast } from "../util.js";
import { go } from "../actions.js";

function eligibility(p) {
  if (p.status !== "live") return "Draft page";
  if (p.variants.length < 2) return "Only 1 variant";
  const a = S.activeExpOnPage(p.id);
  if (a) return a.status === "running" ? "Running experiment" : "Scheduled experiment";
  return "";
}

export function metricOptions(selected, page, { exclude = [], placeholder = "Choose a metric" } = {}) {
  const st = S.get();
  let html = `<option value="">${esc(placeholder)}</option>`;
  S.METRIC_GROUPS.forEach((g) => {
    const ms = st.metrics.filter((m) => m.group === g && !exclude.includes(m.id));
    if (!ms.length) return;
    html += `<optgroup label="${esc(g)}">${ms
      .map((m) => {
        const na = m.requires === "leadForm" && page && !page.hasLeadForm;
        return `<option value="${m.id}" ${m.id === selected ? "selected" : ""} ${na ? "disabled" : ""}>${esc(m.name)}${na ? " — this page has no lead form" : ""}</option>`;
      })
      .join("")}</optgroup>`;
  });
  return html;
}

export function openCreate(prefPageId) {
  if (!S.canEdit()) {
    toast("You need Editor access to create experiments", "bad");
    return;
  }
  const st = S.get();
  const pages = [...st.pages].sort((a, b) => (eligibility(a) ? 1 : 0) - (eligibility(b) ? 1 : 0));
  const firstOk = prefPageId || pages.find((p) => !eligibility(p))?.id || "";
  let keyTouched = false;
  let dirty = false;

  const body = `
    <p style="margin-top:0" class="muted">Show different versions of one page to visitors and see which converts better.</p>
    <div class="field"><label for="c-name">Experiment name</label><input id="c-name" name="name" class="inp" autocomplete="off" placeholder="e.g. Online BBA — banner &amp; sticky CTA"><div data-err="name"></div></div>
    <div class="field"><label for="c-page">Page to test</label>
      <select id="c-page" name="page" class="inp">${pages
        .map((p) => {
          const why = eligibility(p);
          return `<option value="${p.id}" ${p.id === firstOk ? "selected" : ""} ${why ? "disabled" : ""}>${esc(p.name)} · ${esc(p.path)}${why ? ` — ${why}` : ` — ${p.variants.length} variants`}</option>`;
        })
        .join("")}</select>
      <div class="hint">Only live pages with at least 2 variants and no running or scheduled experiment can be picked.</div><div data-err="page"></div></div>
    <div class="field"><label for="c-primary">Primary metric <span class="opt">· picks the winner</span></label><select id="c-primary" name="primary" class="inp"></select><div data-err="primary"></div></div>
    <div class="field"><span class="label">Secondary metrics <span class="opt">· optional, tracked for context</span></span><div id="c-secondary" class="row" style="gap:8px"></div></div>
    <div class="field"><label for="c-hyp">Hypothesis <span class="opt">· optional</span></label><textarea id="c-hyp" name="hypothesis" class="inp" placeholder="A shorter banner with a sticky Apply Now bar will increase enquiry form submissions on mobile."></textarea></div>
    <div class="field"><span class="label">Variants to test <span class="opt">· from this page</span></span><div id="c-variants" class="stack-sm"></div><div data-err="variants"></div>
      <div class="hint">The page's default variant is always Control. Traffic is split evenly across the selected variants; you can change the split in setup.</div></div>
    <div class="row"><div class="grow field"><label for="c-key">Tracking key</label><input id="c-key" name="key" class="inp mono" autocomplete="off"><div class="hint">Lowercase letters, numbers and hyphens. Locked once started.</div><div data-err="key"></div></div>
      <div class="grow field"><label for="c-tags">Tags <span class="opt">· comma separated</span></label><input id="c-tags" name="tags" class="inp" placeholder="banner, mobile"></div></div>
    <div class="field"><label for="c-owner">Owner</label><select id="c-owner" name="owner" class="inp">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === st.currentUserId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>`;

  // C6: ask before discarding typed input, without leaving the form.
  const cancel = (form) => {
    if (!dirty) return closeModal();
    const f = form.querySelector(".modal-f");
    const original = f.innerHTML;
    f.innerHTML = `<span style="margin-right:auto;display:flex;gap:8px;align-items:center;color:#92400E">${icon.warn(16)} Discard this experiment? Your details won't be saved.</span>
      <button type="button" class="btn sm" data-local="keep">Keep editing</button><button type="button" class="btn sm danger" data-act="modal-close">Discard</button>`;
    f.querySelector("[data-local=keep]").addEventListener("click", () => {
      f.innerHTML = original;
      f.querySelector("[data-local=cancel]").addEventListener("click", () => cancel(form));
    });
  };

  openModal({
    title: "Create A/B test",
    wide: true,
    body,
    footer: `<button type="button" class="btn sm" data-local="cancel">Cancel</button><button type="submit" class="btn sm primary">Create &amp; set up</button>`,
    onOpen: (form) => {
      const renderPageParts = () => {
        const p = S.page(form.page.value);
        const prevPrimary = form.primary.value;
        form.primary.innerHTML = metricOptions(prevPrimary, p);
        const secSel = new Set([...form.querySelectorAll("input[name=secondary]:checked")].map((i) => i.value));
        form.querySelector("#c-secondary").innerHTML = st.metrics
          .filter((m) => !(m.requires === "leadForm" && p && !p.hasLeadForm))
          .map((m) => `<label class="badge" style="padding:6px 10px;cursor:pointer;font-weight:500"><input type="checkbox" name="secondary" value="${m.id}" ${secSel.has(m.id) ? "checked" : ""} style="accent-color:var(--primary)"> ${esc(m.name)}</label>`)
          .join("");
        const vbox = form.querySelector("#c-variants");
        if (!p) {
          vbox.innerHTML = `<div class="faint">Pick a page first.</div>`;
          return;
        }
        const def = p.variants.find((v) => v.id === p.defaultVariantId);
        const others = p.variants.filter((v) => v.id !== def.id);
        if (!others.length) {
          vbox.innerHTML = `<div style="border:1px dashed var(--text-4);border-radius:12px;padding:24px;text-align:center"><b>${esc(p.name)} has only its default variant</b><div class="muted" style="margin:6px 0 14px">Create at least one more variant in the page editor, then come back.</div><a class="btn sm" href="#/page/${p.id}" data-act="modal-close-nav">${icon.ext()} Open page editor</a></div>`;
          return;
        }
        vbox.innerHTML =
          `<label class="check on disabled"><input type="checkbox" checked disabled>${variantChip(def)}<span><span class="t1">${esc(def.name)} · Default · Control</span><span class="t2">What every visitor sees today · ${p.sections} sections</span></span></label>` +
          others.map((v) => `<label class="check on"><input type="checkbox" name="variant" value="${v.id}" checked>${variantChip(v)}<span><span class="t1">${esc(v.name)}</span><span class="t2">${v.changes} change${v.changes === 1 ? "" : "s"} vs default</span></span></label>`).join("") +
          `<a href="#/page/${p.id}" data-act="modal-close-nav" class="hint" style="display:inline-block">Create or edit variants in the page editor →</a>`;
      };
      renderPageParts();
      form.page.addEventListener("change", renderPageParts);
      form.addEventListener("input", (ev) => {
        dirty = true;
        if (ev.target.name === "key") keyTouched = true;
        if (ev.target.name === "name" && !keyTouched) form.key.value = S.uniqueKey(slugify(form.name.value));
        if (ev.target.name === "variant") ev.target.closest(".check").classList.toggle("on", ev.target.checked);
      });
      form.querySelector("[data-local=cancel]").addEventListener("click", () => cancel(form));
    },
    onSubmit: (fd, form) => {
      const errs = {};
      const name = String(fd.get("name") || "").trim();
      const p = S.page(fd.get("page"));
      const key = String(fd.get("key") || "").trim();
      const vids = fd.getAll("variant");
      if (!name) errs.name = "Enter a name";
      if (!p || eligibility(p)) errs.page = "Choose a page that can be tested";
      if (!fd.get("primary")) errs.primary = "Choose a primary metric";
      if (p && !vids.length) errs.variants = "Select at least one variant besides Control";
      if (!key) errs.key = "Enter a tracking key";
      else if (!/^[a-z0-9-]+$/.test(key)) errs.key = "Lowercase letters, numbers and hyphens only";
      else {
        const clash = S.get().experiments.find((x) => x.trackingKey === key);
        if (clash) errs.key = `Already used by “${clash.name}”`;
      }
      form.querySelectorAll("[data-err]").forEach((d) => (d.innerHTML = errs[d.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[d.dataset.err])}</div>` : ""));
      form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
      const map = { name: "name", page: "page", primary: "primary", key: "key" };
      Object.keys(errs).forEach((k) => map[k] && form[map[k]].setAttribute("aria-invalid", "true"));
      const first = Object.keys(errs)[0];
      if (first) {
        (form.querySelector(`[data-err=${first}]`).closest(".field") || form).scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const e = S.newExperimentDraft();
      const ids = [p.defaultVariantId, ...vids];
      const even = Math.floor(100 / ids.length);
      Object.assign(e, {
        name, pageId: p.id, trackingKey: key, primaryMetric: fd.get("primary"), secondaryMetrics: fd.getAll("secondary").filter((m) => m !== fd.get("primary")),
        hypothesis: String(fd.get("hypothesis") || "").trim(), variantIds: ids, weights: ids.map((_, i) => (i === 0 ? 100 - even * (ids.length - 1) : even)),
        tags: String(fd.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean), ownerId: fd.get("owner"),
      });
      e.history.push({ at: S.now(), by: S.get().currentUserId, text: "Created the experiment" });
      S.get().experiments.unshift(e);
      S.save();
      closeModal();
      toast("Draft created. Finish setup, then start it.", "good");
      go(`#/experiment/${e.id}/overview`);
    },
  });
}
