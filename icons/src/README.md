# Icon sources

The PNG icons in `icons/` are generated from these SVGs and from `../icon.svg`
(the original logo). To regenerate them (needs `rsvg-convert`, from librsvg):

```sh
rsvg-convert -w 192 -h 192 icon.svg           -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icon.svg           -o icons/icon-512.png
rsvg-convert -w 192 -h 192 icons/src/maskable.svg -o icons/maskable-192.png
rsvg-convert -w 512 -h 512 icons/src/maskable.svg -o icons/maskable-512.png
rsvg-convert -w 180 -h 180 icons/src/apple-touch.svg -o icons/apple-touch-icon.png
rsvg-convert -w 32  -h 32  icon.svg           -o icons/favicon-32.png
```

Then run `npm run release` so the service worker knows about the new files.
