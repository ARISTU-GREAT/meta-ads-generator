// AdFlow Creative Importer — Figma Plugin (code.js)
// Robust build: every operation individually guarded, full console diagnostics.
// Never fully crashes — always surfaces errors to the UI.

figma.showUI(__html__, { width: 440, height: 600, title: 'AdFlow Creative Importer' });

// ─────────────────────────────────────────────────────────────────────────────
// Utility: send a typed message back to ui.html
// ─────────────────────────────────────────────────────────────────────────────

function sendMsg(type, message, extra) {
  const payload = { type, message };
  if (extra) Object.assign(payload, extra);
  figma.ui.postMessage(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function hexToRGB(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0.5, g: 0.5, b: 0.5 };
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) / 255,
      g: parseInt(clean[1] + clean[1], 16) / 255,
      b: parseInt(clean[2] + clean[2], 16) / 255,
    };
  }
  if (clean.length !== 6) {
    console.warn('[AdFlow] hexToRGB: unexpected format "' + hex + '" — using grey');
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  return {
    r: Math.min(1, parseInt(clean.slice(0, 2), 16) / 255),
    g: Math.min(1, parseInt(clean.slice(2, 4), 16) / 255),
    b: Math.min(1, parseInt(clean.slice(4, 6), 16) / 255),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe dimension / position extractors — never return NaN or ≤0 for size
// ─────────────────────────────────────────────────────────────────────────────

function safeN(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}
function safeW(layer) { return Math.max(1, safeN(layer.width,  100)); }
function safeH(layer) { return Math.max(1, safeN(layer.height, 100)); }
function safeX(layer) { return safeN(layer.x, 0); }
function safeY(layer) { return safeN(layer.y, 0); }

// ─────────────────────────────────────────────────────────────────────────────
// Fill parser — silently skips invalid fills
// ─────────────────────────────────────────────────────────────────────────────

function parseFills(fills) {
  if (!Array.isArray(fills)) {
    console.warn('[AdFlow] parseFills: fills is not an array:', typeof fills);
    return [];
  }
  const result = [];
  for (let i = 0; i < fills.length; i++) {
    try {
      const f = fills[i];
      if (!f || f.type !== 'SOLID') continue;
      const color = hexToRGB(f.color);
      const paint = { type: 'SOLID', color };
      if (typeof f.opacity === 'number' && isFinite(f.opacity)) {
        paint.opacity = Math.max(0, Math.min(1, f.opacity));
      }
      result.push(paint);
    } catch (e) {
      console.warn('[AdFlow] parseFills: skipping fill[' + i + ']:', e.message);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Font resolution
// ─────────────────────────────────────────────────────────────────────────────

const _loadedFonts = new Set();

async function tryLoadFont(font) {
  const key = font.family + '::' + font.style;
  if (_loadedFonts.has(key)) return true;
  try {
    await figma.loadFontAsync(font);
    _loadedFonts.add(key);
    console.log('[AdFlow] font loaded:', key);
    return true;
  } catch {
    console.warn('[AdFlow] font unavailable:', key);
    return false;
  }
}

// Always load Inter fallbacks first so we have a guaranteed safe set
async function ensureFallbackFonts() {
  for (const style of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    await tryLoadFont({ family: 'Inter', style });
  }
}

function weightToStyle(weight) {
  const w = parseInt(weight, 10) || 400;
  if (w >= 900) return 'Black';
  if (w >= 800) return 'ExtraBold';
  if (w >= 700) return 'Bold';
  if (w >= 600) return 'SemiBold';
  if (w >= 500) return 'Medium';
  return 'Regular';
}

// Tries requested font → same-family Regular → Inter matching weight → Inter Regular
async function resolveFont(family, weightNum, safeMode) {
  family = String(family || 'Inter');
  if (safeMode) {
    await tryLoadFont({ family: 'Inter', style: 'Regular' });
    return { family: 'Inter', style: 'Regular' };
  }
  const style = weightToStyle(weightNum);
  const chain = [
    { family, style },
    { family, style: 'Regular' },
    { family: 'Inter', style },
    { family: 'Inter', style: 'Regular' },
  ];
  for (const font of chain) {
    if (await tryLoadFont(font)) {
      console.log('[AdFlow] resolveFont → ' + font.family + ' ' + font.style + ' (requested: ' + family + ' ' + style + ')');
      return font;
    }
  }
  // Should never reach here — Inter Regular ships with Figma
  return { family: 'Inter', style: 'Regular' };
}

// Pre-load all fonts needed before node creation starts
async function preloadFonts(layers, safeMode) {
  console.log('[AdFlow] preloading fonts. safeMode=' + safeMode + ', layers=' + layers.length);
  await ensureFallbackFonts();
  if (safeMode) { console.log('[AdFlow] safe mode — using Inter Regular only'); return; }
  for (const layer of layers) {
    if (layer.type !== 'TEXT') continue;
    const family = String(layer.style?.fontFamily || 'Inter');
    const style  = weightToStyle(layer.style?.fontWeight || 400);
    await tryLoadFont({ family, style });
    await tryLoadFont({ family, style: 'Regular' });
  }
  console.log('[AdFlow] font preload complete. loaded:', [..._loadedFonts].join(', '));
}

// ─────────────────────────────────────────────────────────────────────────────
// Node builders — each returns a SceneNode or throws
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Set(['RECTANGLE', 'IMAGE', 'TEXT']);

function buildRectangle(layer) {
  const w = safeW(layer), h = safeH(layer);
  const x = safeX(layer), y = safeY(layer);
  console.log('[AdFlow] RECTANGLE "' + (layer.name || '?') + '" ' + w + 'x' + h + ' @ (' + x + ',' + y + ')');

  const rect = figma.createRectangle();
  rect.name = String(layer.name || 'Rectangle');
  rect.x = x; rect.y = y;
  rect.resize(w, h);

  if (layer.cornerRadius != null && isFinite(Number(layer.cornerRadius))) {
    rect.cornerRadius = Math.max(0, Number(layer.cornerRadius));
  }
  if (typeof layer.opacity === 'number' && isFinite(layer.opacity)) {
    rect.opacity = Math.max(0, Math.min(1, layer.opacity));
  }

  const fills = parseFills(layer.fills);
  rect.fills = fills.length ? fills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
  return rect;
}

async function buildImagePlaceholder(layer) {
  const w = safeW(layer), h = safeH(layer);
  const x = safeX(layer), y = safeY(layer);
  const name = String(layer.name || 'Image');
  console.log('[AdFlow] IMAGE placeholder "' + name + '" ' + w + 'x' + h + ' @ (' + x + ',' + y + ')');

  const frame = figma.createFrame();
  frame.name = name;
  frame.x = x; frame.y = y;
  frame.resize(w, h);
  frame.clipsContent = true;
  frame.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];

  // Background fill rect
  try {
    const bg = figma.createRectangle();
    bg.name = 'Placeholder Fill'; bg.x = 0; bg.y = 0; bg.resize(w, h);
    bg.fills = [{ type: 'SOLID', color: { r: 0.83, g: 0.84, b: 0.87 } }];
    frame.appendChild(bg);
  } catch (e) { console.warn('[AdFlow] IMAGE bg rect failed:', e.message); }

  // Dashed border
  try {
    const bw = Math.max(1, w - 16), bh = Math.max(1, h - 16);
    const border = figma.createRectangle();
    border.name = 'Placeholder Border'; border.x = 8; border.y = 8; border.resize(bw, bh);
    border.fills = [];
    border.strokes = [{ type: 'SOLID', color: { r: 0.55, g: 0.57, b: 0.62 } }];
    border.strokeWeight = 1.5;
    border.dashPattern = [6, 4];
    frame.appendChild(border);
  } catch (e) { console.warn('[AdFlow] IMAGE border failed:', e.message); }

  // Centred label
  try {
    const font = { family: 'Inter', style: 'Regular' };
    await figma.loadFontAsync(font);
    const fs = Math.max(11, Math.round(Math.min(w, h) * 0.065));
    const label = figma.createText();
    label.name = 'Placeholder Label'; label.fontName = font; label.fontSize = fs;
    label.fills = [{ type: 'SOLID', color: { r: 0.38, g: 0.40, b: 0.45 } }];
    label.characters = '◈  ' + name;
    label.textAlignHorizontal = 'CENTER';
    label.x = Math.max(0, Math.round((w - label.width)  / 2));
    label.y = Math.max(0, Math.round((h - label.height) / 2));
    frame.appendChild(label);
  } catch (e) { console.warn('[AdFlow] IMAGE label failed:', e.message); }

  console.log('[AdFlow] IMAGE placeholder done:', name);
  return frame;
}

async function buildText(layer, safeMode) {
  const w = safeW(layer), h = safeH(layer);
  const x = safeX(layer), y = safeY(layer);
  const style = layer.style || {};
  const characters = typeof layer.content === 'string' ? layer.content
                   : String(layer.content != null ? layer.content : '');
  const name = String(layer.name || 'Text');
  console.log('[AdFlow] TEXT "' + name + '" ' + w + 'x' + h + ' @ (' + x + ',' + y + ') fontSize=' + (style.fontSize || 32));

  const font = await resolveFont(style.fontFamily || 'Inter', style.fontWeight || 400, safeMode);

  const text = figma.createText();
  text.name = name;
  text.x = x; text.y = y;
  text.fontName = font;
  text.fontSize = Math.max(1, safeN(style.fontSize, 32));
  text.characters = characters;

  if (style.color) {
    try { text.fills = [{ type: 'SOLID', color: hexToRGB(style.color) }]; }
    catch (e) { console.warn('[AdFlow] TEXT fill failed:', e.message); }
  }

  const H_ALIGN = { center: 'CENTER', left: 'LEFT', right: 'RIGHT' };
  const V_ALIGN = { middle: 'CENTER', top: 'TOP', bottom: 'BOTTOM' };
  try { text.textAlignHorizontal = H_ALIGN[style.textAlign]   || 'LEFT'; } catch {}
  try { text.textAlignVertical   = V_ALIGN[style.verticalAlign] || 'TOP'; } catch {}

  if (typeof layer.opacity === 'number' && isFinite(layer.opacity)) {
    text.opacity = Math.max(0, Math.min(1, layer.opacity));
  }

  // Fix bounds — must set NONE before resize
  try {
    text.textAutoResize = 'NONE';
    text.resize(w, h);
  } catch (e) {
    // Figma may reject resize if text overflows — leave auto-size
    console.warn('[AdFlow] TEXT resize failed (left auto-sized):', e.message);
  }

  console.log('[AdFlow] TEXT done: "' + name + '" font=' + font.family + ' ' + font.style);
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: build the root Figma frame from layout JSON
// ─────────────────────────────────────────────────────────────────────────────

async function buildCreativeFrame(layout, safeMode) {
  const { canvas = {}, layers = [], meta = {} } = layout;
  const W = Math.max(1, safeN(canvas.width,  1080));
  const H = Math.max(1, safeN(canvas.height, 1080));

  console.log('[AdFlow] buildCreativeFrame start | canvas:', W + 'x' + H, '| layers:', layers.length, '| safeMode:', safeMode);

  // Root frame
  const frame = figma.createFrame();
  const frameName = [meta.brand_name, meta.layout_type].filter(Boolean).join(' — ') || 'AdFlow Creative';
  frame.name = frameName;
  frame.resize(W, H);
  frame.clipsContent = true;
  frame.fills = [];
  console.log('[AdFlow] root frame created:', frameName, W + 'x' + H);

  // Font preload
  await preloadFonts(layers, safeMode);

  // Build nodes bottom → top
  const builtNodes = [];
  let skipped = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const rawType = String(layer.type || '');
    const type    = rawType.toUpperCase();

    console.log('[AdFlow] layer ' + (i + 1) + '/' + layers.length + ': type=' + type + ' name="' + (layer.name || '') + '"');

    if (!SUPPORTED_TYPES.has(type)) {
      console.warn('[AdFlow] unsupported type "' + rawType + '" — skipping "' + (layer.name || '') + '"');
      skipped++;
      continue;
    }

    let node = null;
    try {
      if (type === 'RECTANGLE') node = buildRectangle(layer);
      else if (type === 'IMAGE') node = await buildImagePlaceholder(layer);
      else if (type === 'TEXT')  node = await buildText(layer, safeMode);
    } catch (nodeErr) {
      console.error('[AdFlow] build failed for "' + (layer.name || type) + '":', nodeErr.message, nodeErr.stack);
      // Error placeholder — red rectangle so the user can see something went wrong
      try {
        const fallback = figma.createRectangle();
        fallback.name  = '(error) ' + String(layer.name || type);
        fallback.x     = safeX(layer); fallback.y = safeY(layer);
        fallback.resize(safeW(layer), safeH(layer));
        fallback.fills = [{ type: 'SOLID', color: { r: 1, g: 0.35, b: 0.35 }, opacity: 0.5 }];
        node = fallback;
        console.log('[AdFlow] inserted error-placeholder for "' + layer.name + '"');
      } catch (fallbackErr) {
        console.error('[AdFlow] even fallback rect failed:', fallbackErr.message);
      }
    }

    if (node) {
      try {
        frame.appendChild(node);
        builtNodes.push({ node, layer });
      } catch (appendErr) {
        console.error('[AdFlow] appendChild failed for "' + (layer.name || type) + '":', appendErr.message);
      }
    }
  }

  console.log('[AdFlow] nodes complete | built:', builtNodes.length, '| skipped:', skipped);

  // Group CTA layers — guarded individually
  if (!safeMode) {
    const ctaNodes = builtNodes
      .filter(({ layer }) => /cta/i.test(String(layer.name || '')))
      .map(({ node }) => node);

    console.log('[AdFlow] CTA nodes for grouping:', ctaNodes.length);

    if (ctaNodes.length > 1) {
      try {
        const ctaGroup = figma.group(ctaNodes, frame);
        ctaGroup.name = 'CTA Button';
        console.log('[AdFlow] CTA group created with', ctaNodes.length, 'nodes');
      } catch (groupErr) {
        console.error('[AdFlow] group() failed:', groupErr.message, '— CTA layers left ungrouped');
      }
    } else {
      console.log('[AdFlow] grouping skipped (need >1 CTA nodes, have ' + ctaNodes.length + ')');
    }
  } else {
    console.log('[AdFlow] safe mode: grouping skipped');
  }

  console.log('[AdFlow] buildCreativeFrame complete:', frameName);
  return frame;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message handler — the outer shell is also guarded
// ─────────────────────────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  // Wrap the entire handler so nothing escapes to Figma's crash handler
  try {
    if (msg.type === 'import') {
      const safeMode = !!msg.safeMode;
      console.log('[AdFlow] ── import start ── safeMode=' + safeMode);

      // Step 1: Parse JSON
      let layout;
      try {
        layout = JSON.parse(msg.json);
      } catch (parseErr) {
        console.error('[AdFlow] JSON.parse failed:', parseErr.message);
        sendMsg('error', 'Invalid JSON — ' + parseErr.message, { stack: parseErr.stack || '' });
        return;
      }

      // Step 2: Basic structure checks
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
        sendMsg('error', 'Parsed value is not an object.', { stack: '' });
        return;
      }
      console.log('[AdFlow] parsed layout:', {
        schema:     layout.schema,
        version:    layout.version,
        layerCount: Array.isArray(layout.layers) ? layout.layers.length : 'n/a',
        canvas:     layout.canvas,
        brand:      layout.meta?.brand_name,
        layoutType: layout.meta?.layout_type,
      });

      if (layout.schema !== 'creative-layout') {
        sendMsg('error',
          'Expected schema "creative-layout" but got "' + (layout.schema || 'undefined') + '". ' +
          'Use the "Export Layout JSON" button in AdFlow Studio.',
          { stack: '' }
        );
        return;
      }

      if (!Array.isArray(layout.layers)) {
        sendMsg('error', 'layout.layers is missing or not an array.', { stack: '' });
        return;
      }

      sendMsg('progress', 'Building ' + layout.layers.length + ' layers…');

      // Step 3: Build
      const frame = await buildCreativeFrame(layout, safeMode);
      figma.currentPage.appendChild(frame);
      figma.viewport.scrollAndZoomIntoView([frame]);
      figma.currentPage.selection = [frame];

      const count = layout.layers.length;
      console.log('[AdFlow] ── import complete ── "' + frame.name + '" / ' + count + ' layers');
      sendMsg('done', 'Imported "' + frame.name + '" — ' + count + ' layers created');
      return;
    }

    if (msg.type === 'close') {
      figma.closePlugin();
    }

  } catch (outerErr) {
    // Absolute last-resort catch — should never be reached but prevents Figma crash dialog
    console.error('[AdFlow] OUTER CATCH:', outerErr.message, outerErr.stack);
    try {
      sendMsg('error', 'Unexpected error: ' + (outerErr.message || String(outerErr)), { stack: outerErr.stack || '' });
    } catch {}
  }
};
