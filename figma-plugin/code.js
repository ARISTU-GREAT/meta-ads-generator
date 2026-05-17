// AdFlow Creative Importer — Figma Plugin (code.js)
// Runs in Figma's plugin sandbox. No DOM access here.
// Communication with ui.html via figma.ui.postMessage / figma.ui.onmessage.

figma.showUI(__html__, { width: 440, height: 540, title: 'AdFlow Creative Importer' });

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function hexToRGB(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0.5, g: 0.5, b: 0.5 };
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) / 255,
      g: parseInt(clean[1] + clean[1], 16) / 255,
      b: parseInt(clean[2] + clean[2], 16) / 255,
    };
  }
  if (clean.length !== 6) return { r: 0.5, g: 0.5, b: 0.5 };
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Font helpers
// ─────────────────────────────────────────────────────────────────────────────

function weightToStyle(weight) {
  const w = parseInt(weight, 10) || 400;
  if (w >= 900) return 'Black';
  if (w >= 800) return 'ExtraBold';
  if (w >= 700) return 'Bold';
  if (w >= 600) return 'SemiBold';
  if (w >= 500) return 'Medium';
  return 'Regular';
}

// Collect every font that will be needed, plus Inter fallbacks
function collectFontsNeeded(layers) {
  const fonts = new Map();
  const add = (family, style) => fonts.set(`${family}::${style}`, { family, style });

  add('Inter', 'Regular');
  add('Inter', 'Bold');
  add('Inter', 'SemiBold');

  for (const layer of layers) {
    if (layer.type === 'TEXT' && layer.style) {
      const family = layer.style.fontFamily || 'Inter';
      const style  = weightToStyle(layer.style.fontWeight);
      add(family, style);
      add(family, 'Regular'); // fallback within same family
    }
  }
  return [...fonts.values()];
}

// Best-effort font loading — tries requested font, falls back to Inter variants
async function resolveFont(family, weightNum) {
  const style = weightToStyle(weightNum);
  const attempts = [
    { family, style },
    { family, style: 'Regular' },
    { family: 'Inter', style },
    { family: 'Inter', style: 'Regular' },
  ];
  for (const font of attempts) {
    try {
      await figma.loadFontAsync(font);
      return font;
    } catch {}
  }
  // Should never happen — Inter Regular ships with Figma
  return { family: 'Inter', style: 'Regular' };
}

// Pre-load all fonts needed for this layout (ignores failures)
async function preloadFonts(layers) {
  const needed = collectFontsNeeded(layers);
  for (const font of needed) {
    try { await figma.loadFontAsync(font); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fill parser
// ─────────────────────────────────────────────────────────────────────────────

function parseFills(fills) {
  if (!Array.isArray(fills)) return [];
  const result = [];
  for (const f of fills) {
    if (f.type !== 'SOLID') continue;
    const color = hexToRGB(f.color);
    const paint = { type: 'SOLID', color };
    if (typeof f.opacity === 'number') paint.opacity = Math.max(0, Math.min(1, f.opacity));
    result.push(paint);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node builders
// ─────────────────────────────────────────────────────────────────────────────

function buildRectangle(layer) {
  const rect = figma.createRectangle();
  rect.name = layer.name || 'Rectangle';
  rect.x = layer.x ?? 0;
  rect.y = layer.y ?? 0;
  rect.resize(Math.max(1, layer.width ?? 100), Math.max(1, layer.height ?? 100));

  if (layer.cornerRadius != null) {
    rect.cornerRadius = Math.max(0, layer.cornerRadius);
  }
  if (typeof layer.opacity === 'number') {
    rect.opacity = Math.max(0, Math.min(1, layer.opacity));
  }

  const fills = parseFills(layer.fills);
  rect.fills = fills.length ? fills : [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];

  return rect;
}

// IMAGE nodes → a frame containing a gray placeholder + centered label text.
// User replaces placeholder by selecting the frame and changing its fill in Figma.
async function buildImagePlaceholder(layer) {
  const w = Math.max(1, layer.width  ?? 200);
  const h = Math.max(1, layer.height ?? 200);

  const frame = figma.createFrame();
  frame.name = layer.name || 'Image Placeholder';
  frame.x = layer.x ?? 0;
  frame.y = layer.y ?? 0;
  frame.resize(w, h);
  frame.clipsContent = true;
  // Checkerboard-style gray fill signals placeholder
  frame.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];

  // Inner background rectangle
  const bg = figma.createRectangle();
  bg.name = 'Placeholder Fill';
  bg.x = 0;
  bg.y = 0;
  bg.resize(w, h);
  bg.fills = [{ type: 'SOLID', color: { r: 0.83, g: 0.84, b: 0.87 } }];
  frame.appendChild(bg);

  // Dashed border hint via a second rectangle with stroke
  const border = figma.createRectangle();
  border.name = 'Placeholder Border';
  border.x = 8;
  border.y = 8;
  border.resize(Math.max(1, w - 16), Math.max(1, h - 16));
  border.fills = [];
  border.strokes = [{ type: 'SOLID', color: { r: 0.55, g: 0.57, b: 0.62 } }];
  border.strokeWeight = 1.5;
  border.dashPattern = [6, 4];
  frame.appendChild(border);

  // Centered label text
  try {
    const font = await resolveFont('Inter', 400);
    const labelSize = Math.max(11, Math.round(Math.min(w, h) * 0.065));
    const label = figma.createText();
    label.name = 'Placeholder Label';
    label.fontName = font;
    label.fontSize = labelSize;
    label.fills = [{ type: 'SOLID', color: { r: 0.38, g: 0.40, b: 0.45 } }];
    label.characters = `◈  ${layer.name || 'Image'}`;
    label.textAlignHorizontal = 'CENTER';
    // Auto-size, then center it
    label.x = Math.round((w - label.width)  / 2);
    label.y = Math.round((h - label.height) / 2);
    frame.appendChild(label);
  } catch {}

  return frame;
}

async function buildText(layer) {
  const style = layer.style || {};
  const w = Math.max(1, layer.width  ?? 200);
  const h = Math.max(1, layer.height ?? 40);

  const font = await resolveFont(style.fontFamily || 'Inter', style.fontWeight || 400);

  const text = figma.createText();
  text.name     = layer.name || 'Text';
  text.x        = layer.x ?? 0;
  text.y        = layer.y ?? 0;
  text.fontName = font;
  text.fontSize = Math.max(1, style.fontSize || 32);
  text.characters = layer.content || '';

  // Color
  if (style.color) {
    text.fills = [{ type: 'SOLID', color: hexToRGB(style.color) }];
  }

  // Horizontal alignment
  const hAlign = { center: 'CENTER', left: 'LEFT', right: 'RIGHT' };
  text.textAlignHorizontal = hAlign[style.textAlign] || 'LEFT';

  // Vertical alignment
  const vAlign = { middle: 'CENTER', top: 'TOP', bottom: 'BOTTOM' };
  text.textAlignVertical = vAlign[style.verticalAlign] || 'TOP';

  if (typeof layer.opacity === 'number') {
    text.opacity = Math.max(0, Math.min(1, layer.opacity));
  }

  // Fix width/height (NONE = auto; we want fixed bounds matching layout)
  text.textAutoResize = 'NONE';
  text.resize(w, h);

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main frame builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildCreativeFrame(layout) {
  const { canvas, layers = [], meta = {} } = layout;
  const W = Math.max(1, canvas?.width  || 1080);
  const H = Math.max(1, canvas?.height || 1080);

  // Root frame
  const frame = figma.createFrame();
  const frameName = [meta.brand_name, meta.layout_type]
    .filter(Boolean).join(' — ') || 'AdFlow Creative';
  frame.name = frameName;
  frame.resize(W, H);
  frame.clipsContent = true;
  frame.fills = [];

  // Pre-load fonts before building any text nodes
  await preloadFonts(layers);

  // Build nodes in layer order (bottom → top)
  const builtNodes = [];
  for (const layer of layers) {
    let node = null;
    try {
      if (layer.type === 'RECTANGLE') {
        node = buildRectangle(layer);
      } else if (layer.type === 'IMAGE') {
        node = await buildImagePlaceholder(layer);
      } else if (layer.type === 'TEXT') {
        node = await buildText(layer);
      }
    } catch (err) {
      console.error(`[AdFlow] Failed to build layer "${layer.name}":`, err.message);
    }
    if (node) {
      builtNodes.push({ node, layer });
    }
  }

  // Append all nodes to frame first (required before grouping)
  for (const { node } of builtNodes) {
    frame.appendChild(node);
  }

  // Group CTA background + text into a single "CTA Button" group
  const ctaNodes = builtNodes
    .filter(({ layer }) => /cta/i.test(layer.name || ''))
    .map(({ node }) => node);

  if (ctaNodes.length >= 2) {
    const ctaGroup = figma.group(ctaNodes, frame);
    ctaGroup.name = 'CTA Button';
  }

  return frame;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import') {
    let layout;
    try {
      layout = JSON.parse(msg.json);
    } catch {
      figma.ui.postMessage({ type: 'error', message: 'Invalid JSON — could not parse.' });
      return;
    }

    if (layout.schema !== 'creative-layout') {
      figma.ui.postMessage({
        type: 'error',
        message: 'Not an AdFlow layout file. Export from AdFlow Studio → Export Layout JSON.',
      });
      return;
    }

    figma.ui.postMessage({ type: 'progress', message: 'Loading fonts…' });

    try {
      const frame = await buildCreativeFrame(layout);

      figma.currentPage.appendChild(frame);
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.currentPage.selection = [frame];

      const layerCount = layout.layers?.length ?? 0;
      figma.ui.postMessage({
        type: 'done',
        message: `Imported "${frame.name}" — ${layerCount} layers created`,
      });
    } catch (err) {
      console.error('[AdFlow] Import failed:', err);
      figma.ui.postMessage({
        type: 'error',
        message: err.message || 'Import failed — check console for details.',
      });
    }
    return;
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
