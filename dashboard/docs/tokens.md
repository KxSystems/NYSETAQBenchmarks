# KX design tokens

Colour, type and shape values for the dashboard, taken from the KX developer
portal (developer.kx.com) design tokens. Token names follow the portal's naming
(`neutral-70`, `blue-60`, `text-link-default`, ...). Use them as CSS custom
properties under your own naming; the semantic roles below say what each is for.

This is a first version and will be refined; where a value is marked *(derived)* it
is not a portal token but was chosen to fit the palette.

## Typography

- Font family: **Inter** (Google Fonts, weights 400, 600, 700), falling back to
  `Arial, sans-serif`. KX's brand face (Euclid Square) is not available as a public
  webfont; do not use it.
- Monospace (query texts): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  *(derived)*.
- Base size 16px; body line height 1.5. Headings 600–700 weight.

## Primitive palette

### Neutral

| Token | Value |
|---|---|
| neutral-00 | `#FFFFFF` |
| neutral-025 | `#F9FAFB` |
| neutral-05 | `#F4F5F7` |
| neutral-10 | `#E7E9ED` |
| neutral-20 | `#CBCFD6` |
| neutral-30 | `#A5ABB8` |
| neutral-40 | `#7A8291` |
| neutral-50 | `#747C8C` *(derived)* |
| neutral-60 | `#565E6E` |
| neutral-70 | `#404651` |
| neutral-80 | `#2B2F38` |
| neutral-85 | `#22252C` |
| neutral-90 | `#1A1D22` |

### Blue (light-theme brand accent)

| Token | Value |
|---|---|
| blue-05 | `#F1F6FD` |
| blue-10 | `#DAE6F9` |
| blue-20 | `#B3CBF1` *(derived)* |
| blue-50 | `#3272D9` |
| blue-60 | `#2159B2` |
| blue-80 | `#112E5D` |

### Yellow (dark-theme brand accent)

| Token | Value |
|---|---|
| yellow-10 | `#FFE799` |
| yellow-20 | `#FFCB22` |
| yellow-40 | `#D5A600` *(derived)* |
| yellow-70 | `#584300` |

## Semantic roles

The light theme is accented in blue, the dark theme in yellow, as on the KX
developer portal.

| Role | Light | Dark |
|---|---|---|
| Page background (`background-neutral-default`) | neutral-025 `#F9FAFB` | neutral-80 `#2B2F38` |
| Raised surface: panels, cards, popovers | neutral-00 `#FFFFFF` | neutral-85 `#22252C` |
| Subtle surface: alternate rows, chart areas (`background-neutral-strong`) | neutral-05 `#F4F5F7` | neutral-85 `#22252C` |
| Strong surface: inactive chips, controls (`background-neutral-strongest`) | neutral-10 `#E7E9ED` | neutral-70 `#404651` |
| Body text (`text-neutral-default`) | neutral-70 `#404651` | neutral-05 `#F4F5F7` |
| Headings (`text-neutral-strongest`) | neutral-90 `#1A1D22` | neutral-00 `#FFFFFF` |
| Secondary text: hints, subtitles, axis labels | neutral-60 `#565E6E` | neutral-20 `#CBCFD6` |
| Disabled / dimmed text | neutral-40 `#7A8291` | neutral-30 `#A5ABB8` |
| Borders and dividers | neutral-30 `#A5ABB8` | neutral-50 `#747C8C` |
| Link (`text-link-default`) | blue-60 `#2159B2` | yellow-20 `#FFCB22` |
| Link hover (`text-link-hover`) | blue-50 `#3272D9` | neutral-00 `#FFFFFF` |
| Brand fill, weak (`background-brand-weak`) | blue-05 `#F1F6FD` | yellow-70 `#584300` |
| Brand fill: selected chip / tab (`background-brand-default`) | blue-10 `#DAE6F9` | yellow-20 `#FFCB22` |
| Text on brand fill | blue-80 `#112E5D` | neutral-90 `#1A1D22` |
| Hover fill on controls | blue-20 `#B3CBF1` | yellow-10 `#FFE799` |
| Focus ring | blue-60 `#2159B2`, 2px | yellow-20 `#FFCB22`, 2px |
| Tooltip background (`background-tooltip`) | neutral-90 `#1A1D22` | neutral-00 `#FFFFFF` |
| Tooltip text (`text-tooltip-color`) | neutral-025 `#F9FAFB` | neutral-90 `#1A1D22` |
| Tooltip border | neutral-60 `#565E6E` | neutral-20 `#CBCFD6` |
| Failed-run bar | neutral-20 `#CBCFD6` | neutral-60 `#565E6E` |
| Failed-run label | neutral-40 `#7A8291` | neutral-30 `#A5ABB8` |

## Chart colours

### Categorical: one colour per solution

Assigned in order (section 11 of the spec). Light values are tuned for contrast on a
light background, dark values for a dark one.

| # | Light | Dark |
|---|---|---|
| 1 | `#2159B2` | `#FFCB22` |
| 2 | `#C34726` | `#71C7EC` |
| 3 | `#6B4FB3` | `#DC9CFF` |
| 4 | `#28796B` | `#72D6BD` |
| 5 | `#9B5B00` | `#FF9E7A` |
| 6 | `#A63772` | `#FF94C9` |
| 7 | `#3D6F91` | `#9EBCFF` |
| 8 | `#63722B` | `#C4DC77` |

With more than eight solutions, reuse the colours and add a second distinguishing
cue (pattern, marker shape or label) rather than inventing low-contrast colours.

### Sequential: load phases

Four steps of the brand accent, in pipeline order:

| Phase | Light | Dark |
|---|---|---|
| Load into memory | blue-80 `#112E5D` | yellow-70 `#584300` |
| Transform | blue-60 `#2159B2` | yellow-40 `#D5A600` |
| Sort | blue-50 `#3272D9` | yellow-20 `#FFCB22` |
| Index | blue-20 `#B3CBF1` | yellow-10 `#FFE799` |

### Query failure reasons (stacked bars)

| Reason | Light | Dark |
|---|---|---|
| error | neutral-70 `#404651` | neutral-10 `#E7E9ED` |
| not run | neutral-40 `#7A8291` | neutral-30 `#A5ABB8` |
| not implemented | neutral-20 `#CBCFD6` | neutral-60 `#565E6E` |

### Ratio bands (query breakdown and load time cells)

| Band | Light background / text / border | Dark background / text / border |
|---|---|---|
| much faster (< 0.5) | `#9ED8B8` / `#103522` / `#21734C` | `#70C89A` / `#0D2B1D` / `#B8E8CF` |
| faster (0.5 – < 0.9) | `#D9F2E4` / `#174C32` / `#338A60` | `#B8E8CF` / `#123525` / `#6FCF97` |
| similar (0.9 – 1.1) | `#E7E9ED` / `#1A1D22` / `#A5ABB8` | `#404651` / `#F9FAFB` / `#747C8C` |
| slower (> 1.1 – 2) | `#FFF1BF` / `#5B4300` / `#C69200` | `#FFE28A` / `#3C2B00` / `#FFCB22` |
| much slower (> 2) | `#F8C7BD` / `#681C12` / `#B64132` | `#F2A99B` / `#3F100B` / `#FFCFC9` |
| failed | `#E7E9ED` / `#404651` / `#7A8291` | `#565E6E` / `#FFFFFF` / `#A5ABB8` |

The bands go green (faster) through neutral to red (slower). Because red and green
are hard to tell apart for some readers, the ratio text is always shown too (spec
section 7.4).

## Shape and spacing *(derived)*

| Token | Value |
|---|---|
| Radius: chips, buttons | 6px |
| Radius: panels, cards, tooltips | 10px |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48px |
| Page side gutter | 16px on phones, up to 48px on wide screens |
| Max content width | 1600px |
| Panel shadow, light | `0 4px 16px rgba(26, 29, 34, 0.12)` |
| Panel shadow, dark | `0 4px 16px rgba(0, 0, 0, 0.5)` |
