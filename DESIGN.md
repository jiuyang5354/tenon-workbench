# CONDUIT Visual Design System — Locked Single Benchmark

> **Locked Primary Benchmark**: [Figma Weave](https://weave.figma.com/) (*Architectural Daylight Blueprint Canvas*)
> **Locked Date**: 2026-11-24
> **Rule**: Every view in CONDUIT (`对话流`, `节点画布`, `审查与 Diff`, `脚本与规则`, `Tweaks`) must strictly adhere to this single architectural daylight design language. Zero multi-site style stitching.

---

## 1. Aesthetic Thesis & Subtraction Principles
- **Calm Architectural Studio, Not Admin Dashboard**: Replace harsh `#000000` + electric `#1B66FF` neon glows with cool-mineral alabaster drafting surfaces, pure white borderless cards, hairline divisions, and massive negative space.
- **Zero Box-Inside-Box Clutter**: Strip redundant outer borders on inner buttons, compress 18+ canvas pills into two quiet unified strips and a single preset selector, and keep card interiors typographically open.
- **External Node Labeling (Figma Weave Signature)**: Node taxonomy and status sit as crisp `10px` micro-uppercase captions *outside and above* the pure white card body rather than bloated colored pills inside the card header.
- **Zero Outer Glows**: No `filter: blur(...)` halos, no rainbow chrome rings by default, no glowing neon cables.

---

## 2. Color & Surface Tokens

### Default Surface: `weave` (建筑白昼 — Figma Weave Blueprint)
| Token | Value | Role |
|---|---|---|
| `--bg-canvas` | `#ECEFF2` | Outer cool-mineral drafting ground & top bar |
| `--bg-canvas-stage` | `linear-gradient(180deg, #F6F7F5 0%, #EFF3EF 72%, #DFE9E2 100%)` | Infinite node canvas atmospheric sheet |
| `--bg-sidebar` | `#E6EAEE` | Recessed left navigation margin |
| `--bg-surface-1` | `#FFFFFF` | Pure crisp white cards, node bodies, composer, drawers |
| `--bg-surface-2` | `#F2F4F6` | Quiet recessed control & input fill |
| `--bg-surface-3` | `#E4E8ED` | Hover & active subtle neutral fill |
| `--ink-primary` | `#111315` | Architectural ink primary text & active solid controls |
| `--ink-secondary` | `#4E5562` | Secondary body copy & descriptions |
| `--ink-muted` | `#848B98` | External micro-captions, timestamps, placeholders |
| `--line-subtle` | `rgba(17, 19, 21, 0.08)` | Hairline structural separators |
| `--line-strong` | `rgba(17, 19, 21, 0.16)` | Interactive borders & active hairlines |
| `--grid-minor` | `rgba(17, 19, 21, 0.038)` | `24px` blueprint drafting grid |
| `--grid-major` | `rgba(17, 19, 21, 0.075)` | `120px` major architectural grid |

### Surgical Accent Discipline
- **Hero CTA Strike (`--cta-bg` / `--cta-ink`)**: `#EEFF82` (Chartreuse / Acid-Lime, hover `#E4FA63`) with `#111315` ink — used strictly for the single primary launch action per screen (`运行集群`, `派发协同`, `派发集群`). Zero blur glow.
- **Interactive Emphasis (`--accent`)**: `#111315` ink with `#FFFFFF` text (in `charcoal` dark mode: `#F4F5F6` with `#141618` ink) so active states stay calm and monochrome.
- **Semantic Status Dots (`6px` circles only)**:
  - Completed / Ready: `#1F7A4D` (muted architectural forest green)
  - Warning / Approval Gate: `#B45309` (warm ochre)
  - Error / Blocked: `#C23B2B` (muted vermilion)
  - Running / Active: `#111315` (crisp pulsing ink)

### Alternate Surfaces (Available in Tweaks, Same Grammar)
- `paper` (**暖石膏纸**): Warm mineral alabaster `#F3F2EE` ground, `#F8F7F4` canvas, `#FFFFFF` cards, `#141413` ink.
- `charcoal` (**建筑暗房**, faithful to Figma Weave's dark lower band): Matte charcoal `#1D1F21` ground, `#232528` canvas, `#2A2D31` elevated cards, `#F3F4F6` ink, `#EEFF82` chartreuse CTA.

---

## 3. Typography & Geometry
- **Display**: `'Space Grotesk', 'Plus Jakarta Sans', 'Noto Sans SC', sans-serif` (tight `-0.025em` tracking on headings).
- **Body**: `'Plus Jakarta Sans', 'Noto Sans SC', sans-serif` (`14px` base, `1.55` leading).
- **Micro-Captions & Metrics**: `'JetBrains Mono', 'Cascadia Code', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', monospace` (`10px–11px`, `tabular-nums`, CJK-safe fallback so Chinese glyphs NEVER degrade to Windows SimSun/宋体).
- **Radii (Architectural Crispness)**:
  - Controls / Buttons / Inputs: `6px`
  - Node Cards / Panels / Drawers: `8px`
  - Composer / Floating Bars: `10px`
  - Status Dots / Port Rings: `999px`
- **Bezier Cables**: `1.25px` solid neutral `#BAC3CC` idle, `1.6px` `#111315` active flow, `1.4px` `#6D9378` completed; `9px` white circular edge port rings with `1.5px` slate stroke.

---

## 4. Hard Ban List (Anti-AI-Slop Enforcement)
- NO `Inter`, `Roboto`, `Arial`, `Fraunces`, or raw `system-ui`.
- NO `#000000` + electric `#1B66FF` cobalt neon or purple gradients.
- NO `filter: blur(...)` glowing halos around cards or buttons.
- NO rainbow liquid-metal rings active by default (`data-metal="off"`).
- NO serif headline with one word in italic; NO four stat cards in a row.
- NO AI buzzwords (`unlock`, `seamless`, `built for the future of`).
- NO `scrollIntoView()` anywhere; ZERO horizontal overflow at `1440px` and `375px`.
