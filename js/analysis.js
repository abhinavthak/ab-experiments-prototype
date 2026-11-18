// Turns simulated data into results, health and a decision for one experiment.
import * as S from "./store.js";
import * as Sim from "./sim.js";
import { compare, verdict, srm } from "./stats.js";
import { DAY, daysBetween } from "./util.js";

const MIN_DAYS = 7; // decision framework: don't call a test before a full week

export function analyze(e, { device = "all" } = {}) {
  const vs = S.variantsOf(e);
  if (!e.startedAt) return { started: false, vs };
  const tot = Sim.totals(e, { device });
  const all = device === "all" ? tot : Sim.totals(e);
  const visitors = tot.reduce((a, v) => a + v.n, 0);
  const engine = e.statsEngine;
  const opts = { engine, sequential: e.sequential, cuped: e.cuped };

  const metricRows = (mid) => {
    const metric = S.metric(mid);
    if (!metric) return null;
    const base = tot[0].m[mid];
    return {
      metric,
      rows: vs.map((v, i) => {
        const s = tot[i].m[mid];
        const r = i === 0 ? null : compare(metric, base, s, opts);
        return { v, i, s, r, verdict: i === 0 ? "baseline" : verdict(metric, r, engine) };
      }),
    };
  };

  const primary = e.primaryMetric ? metricRows(e.primaryMetric) : null;
  const secondary = e.secondaryMetrics.map(metricRows).filter(Boolean);
  const guardrails = e.guardrailMetrics.map(metricRows).filter(Boolean);

  // Health
  const end = Math.min(e.endedAt ?? S.now(), S.now());
  const daysRun = Math.max(0, (end - e.startedAt) / DAY);
  const observed = all.map((v) => v.n);
  const srmRes = srm(observed, e.weights.map(Number));
  const daily = Sim.dailyVisitors(e);
  const lastDays = daily.slice(-3);
  const noTraffic = e.status === "running" && daily.length >= 3 && lastDays.every((d) => d.v.every((x) => x === 0));
  const primaryConversions = primary ? primary.rows.map((r) => (r.s ? (r.s.x ?? r.s.n) : 0)) : [];
  const collecting = !primary || primary.rows.some((r) => !r.s || r.s.n === 0 || (primary.metric.type === "binomial" && r.s.x === 0)) || visitors < 100;
  const srmBad = visitors > 500 && srmRes.pValue < 0.001;
  const guardFail = guardrails.flatMap((g) => g.rows.filter((r) => r.verdict === "lost").map((r) => ({ metric: g.metric, v: r.v })));

  // Decision (running only)
  let decision = null;
  if (e.status === "running") {
    const sd = S.stopDate(e);
    const daysLeft = sd ? Math.max(0, daysBetween(S.now(), sd)) : null;
    if (srmBad || noTraffic) decision = { kind: "unhealthy", label: "Unhealthy", text: srmBad ? `Traffic split doesn't match ${e.weights.join("/")}` : "No visitors for 3 days" };
    else if (collecting) decision = { kind: "collecting", label: "Collecting data", text: "Waiting for conversions in every variant" };
    else {
      const winners = primary.rows.filter((r) => r.verdict === "won");
      const allLost = primary.rows.slice(1).every((r) => r.verdict === "lost");
      const best = primary.rows.slice(1).reduce((b, r) => (!b || (r.r && b.r && r.r.lift > b.r.lift) ? r : b), null);
      if (daysRun < MIN_DAYS) decision = { kind: "early", label: `${Math.ceil(MIN_DAYS - daysRun)} days until a call`, text: `${best ? best.v.key : "—"} is ${best?.r?.lift > 0 ? "ahead" : "behind"} so far; results need a full week`, best };
      else if (winners.length && !guardFail.some((g) => g.v.id === winners[0].v.id)) {
        const w = winners.sort((a, b) => b.r.lift - a.r.lift)[0];
        decision = { kind: "ship", label: "Ship now", text: `${w.v.key} is ahead on the primary metric`, best: w };
      } else if (allLost) decision = { kind: "rollback", label: "Roll back now", text: "Every variant is worse than Control", best };
      else decision = { kind: "running", label: daysLeft != null ? `${daysLeft} days left` : "Keep running", text: "No variant is clearly better yet", best };
    }
  }

  return { started: true, vs, tot, visitors, primary, secondary, guardrails, srm: { ...srmRes, observed, bad: srmBad }, noTraffic, collecting, guardFail, decision, daysRun, daily, engine, primaryConversions };
}

// Status pill for list + header.
export function statusPill(e) {
  if (e.archived) return { tone: "gray", label: "Archived" };
  if (e.status === "draft") return { tone: "gray", label: "Draft" };
  if (e.status === "scheduled") return { tone: "amber", label: "Scheduled" };
  if (e.status === "running") {
    const a = analyze(e);
    return a.srm.bad || a.noTraffic ? { tone: "red", label: "Running" } : { tone: "green", label: "Running" };
  }
  if (e.stoppedAutomatically && !e.result) return { tone: "amber", label: "Needs result" };
  return e.result === "won" || e.result === "lost" ? { tone: "blue", label: "Completed" } : { tone: "gray", label: "Stopped" };
}
