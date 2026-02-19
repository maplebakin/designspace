# Design Space — Exports Overview

This document summarizes the current exported theme JSON files found for the **Design Space** project.

## Export files found

- `Base Gray Green.json`
- `Hoarding to Home-designspace/Hoarding to Home Base.json`
- `Hoarding to Home-designspace/Fedora Blue.json`
- `Hoarding to Home-designspace/Mint Green.json`
- `Hoarding to Home-designspace/PopOS Purple.json`
- `Hoarding to Home-designspace/Ubuntu Orange.json`

---

## 1) Base Gray Green (`Base Gray Green.json`)

- **Theme name:** Smoky
- **Mode:** light
- **Look/intent:** Muted, earthy neutral baseline.
- **Key brand colors:**
  - `brandPrimary`: `#a0a392`
  - `brandSecondary`: `#848994`
  - `brandAccent`: `#9c91a1`
- **Interactive scale:**
  - default `#797c69` → hover `#676a58` → active `#575a4a`

## 2) Hoarding to Home Base (`Hoarding to Home-designspace/Hoarding to Home Base.json`)

- **Theme name:** Hoarding to Home Base
- **Mode:** light
- **Look/intent:** Same palette structure as the base neutral theme.
- **Key brand colors:**
  - `brandPrimary`: `#a0a392`
  - `brandSecondary`: `#848994`
  - `brandAccent`: `#9c91a1`
- **Interactive scale:**
  - default `#797c69` → hover `#676a58` → active `#575a4a`

## 3) Fedora Blue (`Hoarding to Home-designspace/Fedora Blue.json`)

- **Theme name:** Fedora Blue
- **Mode:** light
- **Look/intent:** Blue-led theme with warm/green supporting accents.
- **Key brand colors:**
  - `brandPrimary`: `#3c6eb4`
  - `brandSecondary`: `#ab4d45`
  - `brandAccent`: `#b2bb4d`
- **Interactive scale:**
  - default `#3969ac` → hover `#2c5896` → active `#234a81`

## 4) Mint Green (`Hoarding to Home-designspace/Mint Green.json`)

- **Theme name:** Mint Green
- **Mode:** light
- **Look/intent:** Green-forward palette with blue/purple secondary accents.
- **Key brand colors:**
  - `brandPrimary`: `#8fbc54`
  - `brandSecondary`: `#5c62b4`
  - `brandAccent`: `#b96cbf`
- **Interactive scale:**
  - default `#7aa541` → hover `#678f32` → active `#577b29`
- **Notable:** `textOnBrand` is dark (`#251f18`) instead of light.

## 5) Pop!OS Purple (`Hoarding to Home-designspace/PopOS Purple.json`)

- **Theme name:** Pop!OS Purple
- **Mode:** light
- **Look/intent:** Strong purple primary with warm and green companions.
- **Key brand colors:**
  - `brandPrimary`: `#5031a9`
  - `brandSecondary`: `#a0873a`
  - `brandAccent`: `#59b33d`
- **Interactive scale:**
  - default `#5434b2` → hover `#45269c` → active `#391e85`

## 6) Ubuntu Orange (`Hoarding to Home-designspace/Ubuntu Orange.json`)

- **Theme name:** Ubuntu Orange
- **Mode:** light
- **Look/intent:** Orange-led palette with cyan/blue accents.
- **Key brand colors:**
  - `brandPrimary`: `#e95420`
  - `brandSecondary`: `#35d4ae`
  - `brandAccent`: `#456ade`
- **Interactive scale:**
  - default `#b8522e` → hover `#a5401d` → active `#8f3414`

---

## Shared tokens across all exports

All of the above exports currently share the same foundational neutrals + status colors:

- `canvasBackground`: `#f8f8f6`
- `panelBackground`: `#f1f0ee`
- `surfaceBackground`: `#fdfcfc`
- `textPrimary`: `#30261d`
- `textSecondary`: `#756657`
- `statusSuccess`: `#358d5a`
- `statusWarning`: `#c98a1d`
- `statusError`: `#ab3c2b`
- `neutralBorder`: `#cdc8c1`
- `neutralDivider`: `#e3e1de`
- `neutralDisabled`: `#b7b3ae`
- `neutralShadow100`: `#9a8f7e`
- `neutralShadow200`: `#675b4c`

Only brand + interactive (and one `textOnBrand`) values vary between exports.

---

## Compact comparison table (deltas from base)

Base reference = **Smoky / Hoarding to Home Base**

| Export | brandPrimary | brandSecondary | brandAccent | interactiveDefault | interactiveHover | interactiveActive | textOnBrand delta |
|---|---|---|---|---|---|---|---|
| Smoky (Base Gray Green) | `#a0a392` | `#848994` | `#9c91a1` | `#797c69` | `#676a58` | `#575a4a` | — |
| Hoarding to Home Base | `#a0a392` | `#848994` | `#9c91a1` | `#797c69` | `#676a58` | `#575a4a` | — |
| Fedora Blue | `#3c6eb4` | `#ab4d45` | `#b2bb4d` | `#3969ac` | `#2c5896` | `#234a81` | — |
| Mint Green | `#8fbc54` | `#5c62b4` | `#b96cbf` | `#7aa541` | `#678f32` | `#577b29` | `#251f18` (dark) |
| Pop!OS Purple | `#5031a9` | `#a0873a` | `#59b33d` | `#5434b2` | `#45269c` | `#391e85` | — |
| Ubuntu Orange | `#e95420` | `#35d4ae` | `#456ade` | `#b8522e` | `#a5401d` | `#8f3414` | — |

