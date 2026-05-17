# AdFlow Creative Importer — Figma Plugin

Imports AdFlow creative layout JSON into Figma as a fully editable frame with
named layers, text, shapes, and image placeholders.

---

## Installation (Figma Desktop)

1. Open **Figma Desktop** (the web app does not support local plugin loading)
2. Open any Figma file
3. Go to **Main Menu → Plugins → Development → Import plugin from manifest…**
4. Navigate to this folder and select **`manifest.json`**
5. The plugin now appears under **Plugins → Development → AdFlow Creative Importer**

---

## Usage

### Step 1 — Export the layout from AdFlow Studio

1. Open your AdFlow app and navigate to the ad board
2. Click any generated ad to open the Studio modal
3. Click **Export Layout JSON** in the bottom-left of the modal
4. A file named `creative-layout-<id>.json` is downloaded

### Step 2 — Copy the JSON

Open the downloaded file in any text editor and copy all its contents (`Cmd+A`, `Cmd+C`).

### Step 3 — Import into Figma

1. Run the plugin: **Plugins → Development → AdFlow Creative Importer**
2. Paste the JSON into the text area
3. Click **Import Creative** (or press `Cmd+Enter` / `Ctrl+Enter`)
4. A Figma frame appears on the canvas, selected and zoomed into view

---

## What gets created

| AdFlow layer type | Figma node created                                   |
|-------------------|------------------------------------------------------|
| `RECTANGLE`       | Rectangle with fills, corner radius, opacity         |
| `IMAGE`           | Frame (placeholder) with grey fill + dashed border + label |
| `TEXT`            | Editable text node with font, size, color, alignment |
| CTA layers        | Grouped into a single "CTA Button" group             |

All layers are named from the layout JSON so the Layers panel is clean and readable.

---

## Replacing image placeholders

After import, grey frames labelled `◈ Product Image`, `◈ Background Image`, etc. are
placeholder stand-ins. To replace with your real image:

1. Select the placeholder frame in Figma
2. In the right panel → **Fill**, click the `+` button
3. Choose **Image** fill type
4. Upload or paste your product photo

The placeholder border and label live inside the frame — delete them once you've
added the real image fill.

---

## Layer structure

```
Frame: "BrandName — layout_type"
  ├── Background          (RECTANGLE)
  ├── Background Image    (Frame / IMAGE placeholder)
  ├── Overlay             (RECTANGLE, semi-transparent)
  ├── Product Image       (Frame / IMAGE placeholder)
  ├── Headline            (TEXT — editable)
  ├── Subheadline         (TEXT — editable)
  └── CTA Button          (GROUP)
        ├── CTA Background  (RECTANGLE)
        └── CTA Text        (TEXT — editable)
```

---

## Font fallback

The plugin requests the fonts specified in the brand kit (e.g. `Poppins Bold`).
If a font is unavailable in Figma, it falls back automatically:

1. Same family, Regular weight
2. Inter Bold / SemiBold (matching weight)
3. Inter Regular (ultimate fallback — always available)

To use your exact brand fonts, install them on your system before running the plugin.

---

## Limitations (V1)

- **No remote image fetching** — images are placeholders only; replace manually
- **No OAuth / API sync** — JSON is copy-pasted, not live-connected
- **No two-way sync** — edits in Figma do not update AdFlow and vice versa
- Text may overflow bounds if the font metrics differ from the original generation

---

## File layout

```
figma-plugin/
  manifest.json   ← Figma plugin manifest (points to code.js + ui.html)
  code.js         ← Plugin sandbox code (Figma API calls)
  ui.html         ← Plugin UI (paste JSON, trigger import)
  README.md       ← This file
```
