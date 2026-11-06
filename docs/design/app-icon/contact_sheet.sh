#!/bin/sh
# Contact sheet for #263. One row per variant: 256 px (scaled down), then 128, 64, 32 and
# 16 px at real size, then the 32 and 16 px renders magnified 4x (nearest neighbour) so the
# pixels can be judged. Top block on a light Dock colour, bottom block on a dark one.
set -e
cd "$(dirname "$0")/variants"
VARIANTS="A1-one-sheet-paper A2-one-sheet-ink B-four-columns C1-k-check C2-timebox-ring"
TMP=$(mktemp -d ../rows.XXXX)
i=0
for bg in '#ECECEC' '#2B2B2E'; do
  for f in $VARIANTS; do
    magick -background "$bg" \
      \( "$f.png" -filter Lanczos -resize 256x256 \) \
      \( "$f.png" -filter Lanczos -resize 128x128 \) \
      \( "$f.png" -filter Lanczos -resize 64x64 \) \
      \( "$f.png" -filter Lanczos -resize 32x32 \) \
      \( "$f.png" -filter Lanczos -resize 16x16 \) \
      \( "$f.png" -filter Lanczos -resize 32x32 -filter point -resize 128x128 \) \
      \( "$f.png" -filter Lanczos -resize 16x16 -filter point -resize 128x128 \) \
      -gravity west -splice 32x0 -gravity center +append +repage -bordercolor "$bg" -border 16 \
      "$TMP/$(printf %02d $i).png"
    i=$((i + 1))
  done
done
magick "$TMP"/*.png -append ../contact-sheet.png
rm -r "$TMP"
