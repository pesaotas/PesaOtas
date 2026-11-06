# Icon sources

The PNG icons in `icons/` are generated from these SVGs and from `../icon.svg`.
All three show the owner's PesaOtas mark (traced from the supplied design, its
geometry unchanged) in the approved recolour, Option 2: brand green `#147D62`
with a white arrow line on forest `#102C25` (v1.6 Phase 5, D-21). `icon.svg` is
the approved rounded tile (corner radius 112.64 of 512); the maskable and Apple
icons are full-bleed squares. `tests/ui-text-and-logo.test.js` checks that each
PNG is exactly its SVG rendered at that size. To regenerate them (needs
`rsvg-convert`, from librsvg):

```sh
rsvg-convert -w 192 -h 192 icon.svg           -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icon.svg           -o icons/icon-512.png
rsvg-convert -w 192 -h 192 icons/src/maskable.svg -o icons/maskable-192.png
rsvg-convert -w 512 -h 512 icons/src/maskable.svg -o icons/maskable-512.png
rsvg-convert -w 180 -h 180 icons/src/apple-touch.svg -o icons/apple-touch-icon.png
# The maskable and Apple icons are opaque: save them without an alpha channel
# (for example `convert icons/maskable-512.png -alpha off icons/maskable-512.png`).
rsvg-convert -w 32  -h 32  icon.svg           -o icons/favicon-32.png
```

Then run `npm run release` so the service worker knows about the new files.
