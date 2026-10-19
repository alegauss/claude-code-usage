# Improvements

## Block A — On the design system

### §CU1 The page on the design system

`index.html` is 109 KB and 2,611 lines, and lines 55 to 778 are one `<style>` block: its
own tokens (`--ground`, `--surface`, `--ink`, `--accent`) in light, dark and both
`data-theme` overrides, then the header, rail, slides, cards and footer. The hub and the
other product sites take that look from `@viglet/viglet-design-system`, and this page
has a copy of it.

The move links `tokens.css` and `site.css` (VDS216) from jsDelivr at a pinned version
and sets `data-tone="cool"`: the light ground is `#f4f6f9`, a blue-grey, and the plan
scale is blue. The accent comes from `projects.json`, `42,120,214` with `#5598e7`
bright. The inline CSS those two files cover goes; what stays is page-specific: the plan
scale (`--plan-1`..`--plan-4`), the rail, the console and the slide layout. The Google
Analytics tag loads only after consent, as the hub's AG1 does.

The README says the page has no CDN and works opened from disk. Linking the stylesheets
changes that, and the README says so in the same commit. `npm run check:palette` and
`check:page` keep passing, or are updated to read the linked tokens.

Done when no CSS that `site.css` provides is left in `index.html`, the text of every
slide is unchanged, light and dark screenshots are compared before and after with the
differences listed in the commit, and the page is listed in `consumers.json` through
VDS217.
