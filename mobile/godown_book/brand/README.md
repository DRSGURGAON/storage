# StorageBill Pro brand artwork

The source artwork, kept here so the app's icons can always be rebuilt
from something rather than recovered from a chat.

| File | What it is |
| --- | --- |
| `brand_sheet.png` | Every approved logo variant, the palette and where each one is meant to be used |
| `app_icon_master.png` | The full vertical logo - mark, wordmark and tagline on the navy card |

Colours, as the sheet states them:

| | Hex |
| --- | --- |
| Primary navy | `#0D2B49` |
| Accent green | `#14D1A0` |
| White | `#FFFFFF` |

## What the app still needs

Nothing in `android/app/src/main/res` or `assets/images` has been
changed yet - the app still ships the old mark. These are the exports
the icons will be built from, each supplied as artwork rather than
derived from another file:

| Needed | Size | Background | Used for |
| --- | --- | --- | --- |
| Mark only, on navy | 1024x1024 | Navy, full bleed, square corners | Launcher icon on Android 7 and older, Play Store, web |
| Mark only, white and green | 1024x1024 | Transparent | Adaptive launcher icon, Android 8+ |
| Mark only, navy | 1024x1024 | Transparent | Android 12+ splash, if the splash stays light |
| Full vertical logo | 1024x1024 | Transparent outside the card | The app's own splash and the login screen |

On the two transparent ones the artwork has to sit inside the middle
two thirds of the canvas: Android masks a launcher icon to a circle or a
squircle, and anything nearer the edge than that is cut off.

Play Console needs its own uploads, which never enter this repo: a
512x512 icon, a 1024x500 feature graphic, and at least two phone
screenshots.
