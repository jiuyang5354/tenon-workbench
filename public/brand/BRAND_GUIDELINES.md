# TENON（榫）— Brand & Logo Usage Guidelines

> **Brand Essence**: *Many models. One exact joint.* — 多模型各司其职，如榫卯严密咬合。
> **Construction**: `2:1` Swiss architectural grid (`52u` beams / `26u` mortise channels) on a `256 × 256` integer canvas (`24u` margin, `22u` outer corner radius, `6u` keystone radius).

---

## 1. Asset Inventory (`public/brand/` & `public/`)

| File | Variant | Use Case |
|---|---|---|
| `public/brand/tenon-symbol-black.svg` | 1-color Obsidian `#111315` | Daylight UI, print, light documentation |
| `public/brand/tenon-symbol-white.svg` | 1-color Reversed `#F3F4F6` | Monochrome dark surfaces, overlays |
| `public/brand/tenon-symbol-dark.svg` | Off-White `#F3F4F6` + Chartreuse `#EEFF82` | Charcoal dark mode topbar & obsidian tiles |
| `public/brand/tenon-symbol-small.svg` | Widened `28u` channels | Optical small-size cut (`16px – 24px`) |
| `public/brand/tenon-app-icon.svg` | `#141618` squircle + `#F3F4F6` + `#EEFF82` | Master app icon & SVG favicon |
| `public/brand/tenon-lockup-horizontal-light.svg` | Outlined geometric wordmark (Daylight) | README, headers, light decks (zero `<text>`) |
| `public/brand/tenon-lockup-horizontal-dark.svg` | Outlined geometric wordmark (Charcoal) | Dark decks, splash screens, social covers |
| `public/brand/tenon-lockup-stacked-light.svg` | Stacked vertical lockup | Square badges, documentation covers |
| `public/favicon.ico` + `public/favicon.svg` | 16/32/48 multi-res ICO + vector SVG | Browser tab icons |
| `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest` | Web & PWA app icons | Pinned shortcuts & mobile home screen |

---

## 2. Color Specification

| Role | HEX | Usage |
|---|---|---|
| **Obsidian Ink** | `#111315` / `#141618` | Primary mark on light, app icon container |
| **Alabaster Ground** | `#EFF1F4` / `#FFFFFF` | Daylight drafting surface & card ground |
| **Charcoal Surface** | `#1D1F21` | Dark architectural studio surface |
| **Surgical Chartreuse** | `#EEFF82` | Keystone accent on dark / obsidian ONLY, primary CTA |
| **Verified Forest** | `#1F7A4D` | Passing Pre-CI / ready telemetry dot |

> **Contrast Rule**: Never place raw Chartreuse `#EEFF82` on a white or alabaster `#EFF1F4` background. On light surfaces, use pure monochrome `#111315` or place the dark/chartreuse mark inside an Obsidian `#141618` container.

---

## 3. Clear Space, Minimum Size & Misuse
- **Clear space**: Keep a minimum padding equal to **`52u` (1× beam width, i.e., `25%` of symbol width)** on all four sides of the mark and lockup.
- **Minimum sizes**: Symbol ≥ `16px` (use `tenon-symbol-small.svg` or `favicon.ico` under `24px`); Horizontal lockup ≥ `96px` wide.
- **Do NOT**: Add drop shadows, outer neon glows, rainbow gradients, rotate the mark, change the `2:1` mortise gap ratio, or replace the outlined wordmark with unkerned system fonts.
