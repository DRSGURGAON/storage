# StorageBill Pro brand artwork

The source artwork, kept here so every icon in the app can be rebuilt
from something rather than recovered from a chat. Run
`python3 tool/brand_assets.py` after changing any of it; that script only
crops, scales and pads these files - it never draws anything.

| File | What it is | What it feeds |
| --- | --- | --- |
| `brand_sheet.png` | Every approved variant, the palette, and where each is meant to be used | reference |
| `icon_navy.png` | The mark on the navy card, bleeding to all four edges | Launcher icon on Android 7 and older, the web icons, the Play listing icon |
| `mark_light.png` | The mark in white and green, transparent | Adaptive launcher icon on Android 8+, drawn over `brand_navy` |
| `logo_full_navy.png` | The whole logo - mark, wordmark, tagline - in navy, transparent | The app's own splash and the login screen, and the Android 12 splash icon is cropped from its top |
| `logo_full_white_on_navy.png` | The same logo the other way round, for dark surfaces | reference, not currently used |
| `store/play_icon_512.png` | Generated: the 512x512 Play Console icon | uploaded by hand |

## Colours

| | Hex |
| --- | --- |
| Primary navy | `#0D2B49` |
| Accent green | `#14D1A0` |
| Splash background | `#F2F5F9` |
| White | `#FFFFFF` |

The splash is light, so the icon Android 12 shows on it is the navy mark
rather than the white one - white on `#F2F5F9` would be invisible.

## Still to be supplied

Play Console needs two more uploads, which never enter this repo: a
1024x500 feature graphic, and at least two phone screenshots.
