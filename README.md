# A/B Experiments — University CMS (prototype)

A clickable, static prototype of page A/B testing for the University CMS.

**Live:** https://abhinavthak.github.io/ab-experiments-prototype/

## Screens

**Main flow**
0. Pages list (`pages.html`)
1. Experiments list (`experiments.html`)
2. Create A/B test, with the primary metric dropdown (`create-experiment.html`)
3. Page editor: new variant (`add-variant.html`)
4. Experiment setup (`setup.html`)
5. Page editor: switch variant, set default (`variant-editor.html`)
6. Results (`results.html`)

**Rules and edge cases**
- Rules by state (`rules.html`)
- E1 Page variants (`edge-page-variants.html`)
- E2 Create experiment (`edge-create.html`)
- E3 Start and run (`edge-start-run.html`)
- E4 Stop, archive and delete (`edge-stop-archive-delete.html`)
- E5 Experiments list states (`edge-list-states.html`)

## Using it
- Start at `index.html` or **Start prototype**, then click through. Links between screens work as designed.
- The bar at the bottom of each screen steps through the screens (← / →, or the arrow keys) and returns to **All screens**.
- Controls that aren't wired up show "Not linked in this prototype".

Plain HTML and CSS with no build step. Fonts come from Google Fonts.
