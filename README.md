# A/B Experiments — University CMS (working prototype)

A working, in-browser prototype of page A/B testing for the University CMS. It's built on GrowthBook's experiment model and follows the "A/B Experiments — University CMS" design.

**Live:** https://abhinavthak.github.io/ab-experiments-prototype/

Everything runs in your browser. Changes are saved in this browser only (localStorage), and traffic and conversions are **simulated**. Use **Reset** in the bottom bar to start over.

## What works

**Experiments list**
- Summary for the last 30 days: running now, started, ended, winners shipped.
- Search with syntax: `is:running`, `is:watched`, `owner:`, `tag:`, `page:`, `key:`.
- Status tabs with counts: All, Running, Drafts, Stopped, Archived.
- Filters for Page, Owner and Tags. Sorting.
- Watch (star). Watched experiments are listed first.
- Status pills with day-of-run progress, and a live verdict per row (Ship now, Unhealthy…).
- State-aware "⋯" menu that explains why disabled actions are unavailable.
- 20 rows per page. Empty and no-match states.

**Create A/B test**
- Page picker that only allows live pages with 2+ variants and no running or scheduled test.
- Primary metric, which disables metrics the page can't produce. Secondary metrics.
- Hypothesis, variants, tags, owner.
- Tracking key generated from the name; must be unique.
- All required-field errors are shown at once. Asks before discarding typed input.

**Experiment lifecycle** (following *Rules by state*)
- **Start:** a checklist of blockers and warnings, then a confirm that lists what locks once started.
- **Schedule, reschedule, unschedule.** A scheduled start is skipped and the test returns to Draft if checks fail at start time.
- **Stop and record a result** (Won, Lost, No clear winner, Did not finish), choose the winning variant, and choose the page default.
- **Automatic stop** on the stop date, then *Record result*.
- **Archive and unarchive. Delete**, blocked while running or scheduled. **Duplicate**, which makes a new draft with a suffixed key and the page's current default as Control.
- **Field locks while running.** Variants, split, primary metric, targeting and tracking key lock. Name, hypothesis, secondary and guardrail metrics, and stop date stay editable.

**Setup**
- Variants and traffic split: split evenly, add or remove page variants.
- Targeting: audience, device, UTM source, rollout %, exclude existing leads. Sticky assignment.
- Metrics: primary, secondary and guardrails. Lead attribution.
- Analysis: Bayesian or Frequentist, sequential testing, CUPED.
- Stop date, and preview links per variant.

**Results**
- Visitors, conversions, best variant and top secondary metric.
- Decision: *Ship now*, *Roll back*, *N days left*, or *Collecting data*, with **Stop & make B the default**.
- Per-variant table: conversion rate, relative lift with a 95% interval bar, and chance to beat Control or a p-value.
- All devices / Mobile / Desktop.
- Cumulative chart over time. Secondary and guardrail tables.
- Banners: collecting data, traffic-split mismatch, variant edited mid-test, guardrail failing, no visitors, stop date reached.

**Health**
- Sample ratio mismatch (chi-square) check with expected vs observed visitors per variant.
- Traffic flow, guardrails, mid-test edits.
- Visitors per day chart.

**History & comments**
- Full change log, including automatic events. Comments.

**Pages and page editor**
- Pages list: search, Live/Draft filter, the running experiment per page.
- New page. Publish or move to draft, and delete. Both are blocked during a test.
- Variants: new variant (copy of the default, of another variant, or of a draft page; names must be unique; up to 5 variants).
- Rename, duplicate, delete. Delete is blocked for the default or a variant in a running test.
- **Set as default:** locked during a test. Draft experiments switch their Control.
- Section editing with "Same as A" / "Edited in B" states, and *Reset to A*. Edits during a running test are logged on its Results.

**Metrics:** the catalog and custom metrics.
**Settings:** switch user and role (Admin / Editor / Viewer), the default stats engine, the **simulated clock** (+1 day / +7 days, to watch tests progress, start and stop), and reset demo data.

## GrowthBook features added (v2)

**Experiment flow**
- **Create wizard**: Overview (type, template, name, key, hypothesis, tags, owner, custom fields) → Page & variants (split) → Targeting → Metrics → Analysis (engine, sequential, CUPED, duration, power estimate) → Review with the launch checklist.
- **Launch checklist**: automatic checks plus manual QA items (managed in Settings; required items block Start).
- **Make changes while running**: raise the rollout in the same phase, or start a new phase (new split, rollout or targeting; visitors re-randomized). Phases are listed on Overview and selectable on Results.
- **Stop** records a result, a written conclusion and the page default. **Analyze a past experiment** imports a test by its dates.
- **Templates**: save any experiment as a template and start new ones from it.

**Experiment types**: A/B tests and **multi-armed bandits** (even split for 2 days, then daily Thompson-style re-weighting with a 2% floor; chance-to-be-best and traffic-share chart).

**Targeting**: audience, device, UTM source, **attribute conditions**, **saved groups** (include/exclude), rollout, **namespaces** (mutually exclusive ranges; overlaps block Start), hash attribute, fallback, sticky bucketing. Managed under **Audiences**.

**Results**: phase, **baseline**, **difference type** (relative / absolute / scaled impact), **dimension breakdowns** (device, country, browser, source, new vs returning), cumulative / daily / change-over-time charts with interval bands, Bayesian **risk**, **multiple-testing correction** (Holm-Bonferroni, Benjamini-Hochberg), minimum-data and suspicious-change flags, activation metric, CSV export, and shareable **reports**.

**Health**: SRM, **multiple exposures**, enough-data check, guardrails, mid-test edits, traffic by dimension.

**Insights**: dashboard (win rate, run time, by page), learnings, timeline, metric effects. **Holdouts**: hold out a share of visitors on chosen pages to measure the combined effect of shipped winners.

**Metrics**: editable definition (type, baseline, conversion window, minimum data, suspicious-change threshold, planning lift, goal direction) and a metric page. **Settings**: interval level, win thresholds, correction, sequential tuning, CUPED/sequential defaults, minimum run time, SRM and multiple-exposure thresholds, guardrail rule, hypothesis requirement, assignment defaults, launch checklist, custom fields.

## Statistics

Normal approximations, as in GrowthBook's engines:
- **Bayesian:** chance to beat Control and a 95% credible interval on relative lift (delta method).
- **Frequentist:** two-sided p-value and 95% confidence interval. Sequential testing uses an always-valid boundary that is wider early on.
- **CUPED:** modelled as a fixed variance reduction.
- **SRM:** chi-square test against the planned split, flagged at p < 0.001.
- **Decision:** a test isn't called before 7 days. *Ship now* requires a significant win that doesn't fail any guardrail.

Simulated data is deterministic for each experiment and day. Unseeded effects are zero, so any difference you see there is noise.

## Original design screens

The static screens from the design canvas (main flow, rules and edge cases) are in [`design/`](design/index.html).

## Code

Plain HTML, CSS and JavaScript ES modules, with no build step.
- `js/store.js`: data and persistence.
- `js/sim.js`: traffic simulation.
- `js/stats.js` and `js/analysis.js`: statistics.
- `js/rules.js`: what's allowed in each state.
- `js/views/*`: the screens.
