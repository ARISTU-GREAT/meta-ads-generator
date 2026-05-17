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

## Troubleshooting

### "An error occurred while running this plugin"
Try **Safe Mode** first: enable the toggle in the plugin UI and re-import.  
Safe Mode skips font matching and layer grouping — the two most common crash points.

**Common root causes:**

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Crash on import | Font unavailable in Figma | Enable Safe Mode |
| Crash on import | `figma.group()` with 0 nodes | Enable Safe Mode (grouping is skipped) |
| "Not an AdFlow layout" | Wrong JSON pasted | Export again from AdFlow Studio |
| Red placeholder layers | Individual layer build failed | Check Figma console (Plugins → Development → Open Console) |
| Text overflows bounds | Font metrics differ | Resize text layer manually |

### Reading the console

Open **Plugins → Development → Open Console** in Figma to see every `[AdFlow]` log line.
The plugin logs each layer by type, name, and position. The first `[AdFlow]` line that
stops appearing is where the error occurs.

---

## Minimal test JSON

Use this to verify the plugin works before importing a real layout:

```json
{
  "version": "1.0",
  "schema": "creative-layout",
  "figma_exportable": true,
  "meta": {
    "ad_id": "test-001",
    "brand_name": "Test Brand",
    "layout_type": "product_focus",
    "aspect_ratio": "square"
  },
  "canvas": { "width": 1080, "height": 1080 },
  "design_tokens": {
    "colors": { "primary": "#5b6af0", "secondary": "#ffffff" },
    "typography": { "headline": { "family": "Inter", "weight": 700, "size": 64 } },
    "spacing": { "margin": 60, "padding": 32, "gap": 16 }
  },
  "layers": [
    {
      "id": "bg_1", "name": "Background", "type": "RECTANGLE",
      "x": 0, "y": 0, "width": 1080, "height": 1080,
      "fills": [{ "type": "SOLID", "color": "#5b6af0" }]
    },
    {
      "id": "product_2", "name": "Product Image", "type": "IMAGE",
      "x": 215, "y": 183, "width": 648, "height": 648
    },
    {
      "id": "headline_3", "name": "Headline", "type": "TEXT",
      "x": 60, "y": 54, "width": 960, "height": 128,
      "content": "Your Headline Here",
      "style": {
        "fontFamily": "Inter", "fontWeight": 700, "fontSize": 64,
        "color": "#ffffff", "textAlign": "center"
      }
    },
    {
      "id": "cta_bg_4", "name": "CTA Background", "type": "RECTANGLE",
      "x": 372, "y": 960, "width": 336, "height": 60,
      "cornerRadius": 10,
      "fills": [{ "type": "SOLID", "color": "#ffffff" }]
    },
    {
      "id": "cta_text_5", "name": "CTA Text", "type": "TEXT",
      "x": 372, "y": 960, "width": 336, "height": 60,
      "content": "Shop Now",
      "style": {
        "fontFamily": "Inter", "fontWeight": 600, "fontSize": 28,
        "color": "#5b6af0", "textAlign": "center", "verticalAlign": "middle"
      }
    }
  ],
  "creative_intelligence": {}
}
```

Expected result: a 1080×1080 frame with a purple background, grey image placeholder,
white headline text, and a grouped CTA button.

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
