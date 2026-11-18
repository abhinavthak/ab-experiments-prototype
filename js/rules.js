// "What's allowed, by state" — from the design's Rules board.
import * as S from "./store.js";

export const stateOf = (e) => (e.archived ? "archived" : e.status);

const MATRIX = {
  //                draft  sched  run    stop   archived
  editText:        [true,  true,  true,  true,  false], // name, hypothesis, description, tags, owner
  editSecondary:   [true,  true,  true,  true,  false], // secondary + guardrail metrics
  analysis:        [true,  true,  true,  true,  false], // stats engine, sequential, CUPED
  changePrimary:   [true,  true,  false, false, false],
  editVariants:    [true,  true,  false, false, false], // variants, split, targeting, rollout
  changeKey:       [true,  true,  false, false, false],
  stopDate:        [true,  true,  true,  false, false],
  startNow:        [true,  true,  false, false, false],
  schedule:        [true,  true,  false, false, false],
  unschedule:      [false, true,  false, false, false],
  stop:            [false, false, true,  false, false],
  archive:         [true,  false, false, true,  false],
  unarchive:       [false, false, false, false, true],
  delete:          [true,  false, false, true,  true],
  duplicate:       [true,  true,  true,  true,  true],
};
const COL = { draft: 0, scheduled: 1, running: 2, stopped: 3, archived: 4 };

const WHY = {
  changePrimary: "Locked once the experiment has started",
  editVariants: "Locked once started. Stop this test and duplicate it to change variants or the split.",
  changeKey: "Locked once started, because it ties leads to the test",
  stopDate: "Only before or while the experiment runs",
  startNow: "Only drafts and scheduled experiments can start",
  schedule: "Only drafts and scheduled experiments can be scheduled",
  stop: "Only running experiments can be stopped",
  archive: "Only stopped or draft experiments can be archived",
  delete: "Running and scheduled experiments must be stopped or unscheduled first",
  editText: "Archived experiments are read-only. Unarchive to edit.",
  editSecondary: "Archived experiments are read-only. Unarchive to edit.",
  analysis: "Archived experiments are read-only. Unarchive to edit.",
};

export function can(e, action) {
  if (!S.canEdit()) return false;
  return !!MATRIX[action]?.[COL[stateOf(e)]];
}

export function why(e, action) {
  if (!S.canEdit()) return "You need Editor access";
  return can(e, action) ? "" : WHY[action] || "Not allowed in this state";
}

// Page-variant rules (V1–V5)
export function variantUse(page, variantId) {
  const exps = S.get().experiments.filter((e) => e.pageId === page.id && !e.archived && e.variantIds.includes(variantId));
  return {
    active: exps.find((e) => e.status === "running" || e.status === "scheduled"),
    drafts: exps.filter((e) => e.status === "draft"),
  };
}
export function canSetDefault(page, variantId) {
  if (!S.canEdit()) return "You need Editor access";
  if (page.defaultVariantId === variantId) return "Already the default";
  const active = S.activeExpOnPage(page.id);
  if (active) return `Locked: “${active.name}” is ${active.status} on this page and uses the default as Control. Stop it to change the default.`;
  return "";
}
export function canDeleteVariant(page, variantId) {
  if (!S.canEdit()) return "You need Editor access";
  const v = page.variants.find((x) => x.id === variantId);
  if (page.defaultVariantId === variantId) return `${v.key} is the page's default. Make another variant the default first.`;
  const { active } = variantUse(page, variantId);
  if (active) return `${v.key} is in “${active.name}” (${active.status}). Stop the experiment first.`;
  return "";
}
export const MAX_VARIANTS = 5;
