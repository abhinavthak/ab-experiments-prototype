// Turns simulated data into results, health and a decision for one experiment.
import * as S from "./store.js";
import * as Sim from "./sim.js";
import { compare, verdict, srm, adjustPValues, chanceBest, moments, sampleSizePerVariant } from "./stats.js";
import { DAY, daysBetween, rng, hash } from "./util.js";

// Activation metric: only visitors who did it count (approximation: the
// visitor count shrinks to the activation rate; most converters are kept).
function activate(e, per) {
  const am = S.metric(e.activationMetric);
  if (!am) return per;
  return per.map((t) => {
    const a = t.m[am.id];
    const n = a && "x" in a ? a.x : Math.round(t.n * am.base);
    const k = t.n ? n / t.n : 0;
    const m = {};
    Object.entries(t.m).forEach(([mid, s]) => {
      if ("x" in s) m[mid] = { n, x: Math.min(n, Math.round(s.x * Math.min(1, 0.6 + 0.4 * k))) };
      else m[mid] = { n, sum: s.sum * k, sumSq: s.sumSq * k };
    });
    return { ...t, n, m };
  });
}

export function statOpts(e) {
  const st = S.settings();
  return { engine: e.statsEngine, sequential: e.sequential, cuped: e.cuped, ci: st.ciLevel, tuning: st.tuning };
}

// Compare every variant with the baseline on one metric.
export function metricBlock(e, mid, tot, { baseline = 0, kind = "secondary" } = {}) {
  const metric = S.metric(mid);
  if (!metric) return null;
  const vs = S.variantsOf(e);
  const st = S.settings();
  const opts = statOpts(e);
  const base = tot[baseline]?.m[mid];
  const rows = vs.map((v, i) => {
    const s = tot[i]?.m[mid];
    const r = i === baseline ? null : compare(metric, base, s, opts);
    const total = metric.type === "binomial" ? (base?.x ?? 0) + (s?.x ?? 0) : (base?.n ?? 0) + (s?.n ?? 0);
    const enough = total >= (metric.minSample ?? 100);
    const suspicious = r && Math.abs(r.lift) > (metric.maxChange ?? 0.5);
    return { v, i, s, r, enough, suspicious, verdict: i === baseline ? "baseline" : !enough ? "none" : verdict(metric, r, e.statsEngine, { ctw: st.ctw, alpha: st.alpha }) };
  });
  return { metric, rows, kind };
}

export const guardCutoff = (m, e) => e?.guardrailCutoffs?.[m?.id] ?? m?.guardrailCutoff ?? 0.02;

export function analyze(e, { device = "all", phase = null, baseline = 0 } = {}) {
  const vs = S.variantsOf(e);
  const phases = S.phasesOf(e);
  if (!phases.length) return { started: false, vs };
  const st = S.settings();
  const ph = phase ?? phases.length - 1;
  const tot = activate(e, Sim.totals(e, { device, phase: ph }));
  const all = device === "all" ? tot : activate(e, Sim.totals(e, { phase: ph }));
  const visitors = tot.reduce((a, v) => a + v.n, 0);
  const engine = e.statsEngine;
  const b = Math.min(baseline, vs.length - 1);

  const primary = e.primaryMetric ? metricBlock(e, e.primaryMetric, tot, { baseline: b, kind: "primary" }) : null;
  const secondary = e.secondaryMetrics.map((m) => metricBlock(e, m, tot, { baseline: b })).filter(Boolean);
  const guardrails = e.guardrailMetrics.map((m) => metricBlock(e, m, tot, { baseline: b, kind: "guardrail" })).filter(Boolean);

  // Multiple-testing correction across primary + secondary (frequentist).
  if (engine === "frequentist" && st.correction !== "none") {
    const blocks = [primary, ...secondary].filter(Boolean);
    adjustPValues(blocks.flatMap((x) => x.rows.map((r) => r.r)), st.correction);
    blocks.forEach((x) => x.rows.forEach((r) => {
      if (r.r && r.enough) r.verdict = verdict(x.metric, r.r, engine, { ctw: st.ctw, alpha: st.alpha });
    }));
  }

  // Health
  const phaseObj = phases[ph];
  const end = Math.min(phaseObj.end ?? e.endedAt ?? S.now(), S.now());
  const daysRun = Math.max(0, (end - phaseObj.start) / DAY);
  const observed = all.map((v) => v.n);
  const isBandit = e.type === "bandit";
  // Bandit weights change daily, so SRM is checked against the weights used.
  const expectedW = isBandit ? banditExpected(e, ph) : phaseObj.weights.map(Number);
  const srmRes = srm(observed, expectedW);
  const daily = Sim.dailyVisitors(e);
  const lastDays = daily.slice(-3);
  const noTraffic = e.status === "running" && daily.length >= 3 && lastDays.every((d) => d.v.every((x) => x === 0));
  const primaryConversions = primary ? primary.rows.map((r) => (r.s ? (r.s.x ?? r.s.n) : 0)) : [];
  const collecting = !primary || primary.rows.some((r) => !r.s || r.s.n === 0 || (primary.metric.type === "binomial" && r.s.x === 0)) || visitors < 100;
  const srmBad = visitors > 500 && srmRes.pValue < st.srmThreshold;
  const multi = all.reduce((a, v) => a + v.multi, 0);
  const multiRate = visitors ? multi / Math.max(1, all.reduce((a, v) => a + v.n, 0)) : 0;
  const multiBad = multiRate > st.multiExposureThreshold;
  // Guardrails: each metric has a cutoff, the most it may get worse (relative).
  // Fail = clearly worse (significant) AND the estimate is past the cutoff.
  // Within cutoff = even the worst plausible value stays inside it. Otherwise: watch.
  guardrails.forEach((g) => g.rows.forEach((r) => {
    if (!r.r) return;
    const cut = guardCutoff(g.metric, e);
    const lowerIsBetter = g.metric.higherIsBetter === false;
    const harm = lowerIsBetter ? r.r.lift : -r.r.lift;
    const worst = lowerIsBetter ? r.r.ci[1] : -r.r.ci[0];
    r.guard = { cut, harm, worst, status: !r.enough ? "pending" : r.verdict === "lost" && harm > cut ? "fail" : worst <= cut ? "pass" : "watch" };
  }));
  const guardFail = guardrails.flatMap((g) => g.rows.filter((r) => r.guard?.status === "fail").map((r) => ({ metric: g.metric, v: r.v, ...r.guard })));
  const guardWatch = guardrails.flatMap((g) => g.rows.filter((r) => r.guard?.status === "watch").map((r) => ({ metric: g.metric, v: r.v, ...r.guard })));
  const lowData = primary ? primary.rows.some((r) => r.i !== b && !r.enough) : false;

  // Bandit: chance each arm is best on the primary metric.
  let bandit = null;
  if (isBandit && primary) {
    const arms = primary.rows.map((r) => {
      const mo = moments(primary.metric, r.s);
      const sign = primary.metric.higherIsBetter === false ? -1 : 1;
      return mo ? { mean: sign * mo.mean, sd: Math.sqrt(mo.varMean) } : { mean: 0, sd: 1 };
    });
    const best = chanceBest(arms, rng(hash(`${e.id}|best|${visitors}`)), 2000);
    const lastW = daily.filter((d) => d.weights).slice(-1)[0]?.weights;
    bandit = { best, weights: lastW ? lastW.map((w) => w / 100) : vs.map(() => 1 / vs.length) };
  }

  // Decision (running only)
  let decision = null;
  if (e.status === "running") {
    const sd = S.stopDate(e);
    const daysLeft = sd ? Math.max(0, daysBetween(S.now(), sd)) : null;
    if (srmBad || noTraffic || multiBad) decision = { kind: "unhealthy", label: "Unhealthy", text: srmBad ? `Traffic split doesn't match ${phaseObj.weights.join("/")}` : noTraffic ? "No visitors for 3 days" : "Too many visitors saw more than one variant" };
    else if (collecting) decision = { kind: "collecting", label: "Collecting data", text: "Waiting for conversions in every variant" };
    else if (isBandit) {
      const top = bandit.best.indexOf(Math.max(...bandit.best));
      const conf = bandit.best[top];
      decision = conf >= st.ctw && daysRun >= st.minDays
        ? { kind: "ship", label: "Ship now", text: `${vs[top].key} has a ${Math.round(conf * 100)}% chance of being the best arm`, best: primary.rows[top] }
        : { kind: "running", label: daysLeft != null ? `${daysLeft} days left` : "Exploring", text: `${vs[top].key} leads with a ${Math.round(conf * 100)}% chance of being best`, best: primary.rows[top] };
    } else {
      const winners = primary.rows.filter((r) => r.verdict === "won");
      const allLost = primary.rows.filter((r) => r.i !== b).every((r) => r.verdict === "lost");
      const best = primary.rows.filter((r) => r.i !== b).reduce((x, r) => (!x || (r.r && x.r && r.r.lift > x.r.lift) ? r : x), null);
      const guardOk = (w) => !st.guardrailsBlockShip || !guardFail.some((g) => g.v.id === w.v.id);
      if (daysRun < st.minDays) decision = { kind: "early", label: `${Math.ceil(st.minDays - daysRun)} days until a call`, text: `${best ? best.v.key : "—"} is ${best?.r?.lift > 0 ? "ahead" : "behind"} so far; results need ${st.minDays} days`, best };
      else if (lowData) decision = { kind: "collecting", label: "Not enough data", text: `Needs ${primary.metric.minSample ?? 100} conversions per comparison`, best };
      else if (winners.length && guardOk(winners[0])) {
        const w = winners.sort((x, y) => y.r.lift - x.r.lift)[0];
        decision = { kind: "ship", label: "Ship now", text: `${w.v.key} is ahead on the primary metric`, best: w };
        // Planned sample is a warning, never a gate: Ship now needs only the minimum run time.
        const k = Math.max(2, vs.length);
        const planned = sampleSizePerVariant(primary.metric, e.plannedMde ?? 0.1, { alpha: (1 - st.ciLevel) / (k - 1) });
        const have = Math.min(...tot.map((v) => v.n));
        if (planned && have < planned) decision.warn = `Below the planned sample: ${Math.round((have / planned) * 100)}% of ${planned.toLocaleString("en-IN")} visitors per variant. The real lift may be smaller than it looks; running longer makes it more reliable.`;
      } else if (winners.length) decision = { kind: "review", label: "Review guardrails", text: `${winners[0].v.key} wins the primary metric but fails a guardrail`, best: winners[0] };
      else if (allLost) decision = { kind: "rollback", label: "Roll back now", text: "Every variant is worse than Control", best };
      else decision = { kind: "running", label: daysLeft != null ? `${daysLeft} days left` : "Keep running", text: "No variant is clearly better yet", best };
    }
  }

  return { started: true, vs, tot, visitors, primary, secondary, guardrails, srm: { ...srmRes, observed, expected: expectedW, bad: srmBad }, multi: { count: multi, rate: multiRate, bad: multiBad },
    noTraffic, collecting, lowData, guardFail, guardWatch, decision, daysRun, daily, engine, primaryConversions, bandit, phase: ph, phases, baseline: b };
}

// Average bandit weights over the phase (what SRM should expect).
function banditExpected(e, ph) {
  const vs = S.variantsOf(e);
  const acc = vs.map(() => 0);
  Sim.generate(e).days.forEach((d) => {
    const rows = d.rows.filter((r) => r.phase === ph);
    const traffic = rows.reduce((x, r) => x + r.n, 0);
    rows.filter((r) => r.device === "mobile").forEach((r) => (acc[r.variantIndex] += r.w * traffic));
  });
  const s = acc.reduce((x, y) => x + y, 0);
  return s ? acc.map((x) => (x / s) * 100) : vs.map(() => 100 / vs.length);
}

// Status pill for list + header.
export function statusPill(e) {
  if (e.archived) return { tone: "gray", label: "Archived" };
  if (e.status === "draft") return { tone: "gray", label: "Draft" };
  if (e.status === "scheduled") return { tone: "amber", label: "Scheduled" };
  if (e.status === "running") {
    const a = analyze(e);
    return a.srm.bad || a.noTraffic || a.multi.bad ? { tone: "red", label: "Running" } : { tone: "green", label: "Running" };
  }
  if (e.stoppedAutomatically && !e.result) return { tone: "amber", label: "Needs result" };
  return e.result === "won" || e.result === "lost" ? { tone: "blue", label: "Completed" } : { tone: "gray", label: "Stopped" };
}
