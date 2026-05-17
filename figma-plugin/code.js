// AdFlow Creative Importer — Figma Plugin (code.js)
// Defensive startup: showUI is wrapped, nothing runs at load time except registration.

try {
  figma.showUI(__html__, { width: 420, height: 620 });
} catch (error) {
  console.error('PLUGIN SHOW UI ERROR', error);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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
    console.warn('[AdFlow] bad hex "' + hex + '" — using grey');
    return { r: 0.5, g: 0.5, b: 0.5 };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function safeN(v, fallback) { const n = Number(v); return isFinite(n) ? n : fallback; }
function safeW(layer) { return Math.max(1, safeN(layer.width,  100)); }
function safeH(layer) { return Math.max(1, safeN(layer.height, 100)); }
function safeX(layer) { return safeN(layer.x, 0); }
function safeY(layer) { return safeN(layer.y, 0); }

// Handles both string hex "#FFFFFF" and object { type:'SOLID', color:'#hex' } fills
function parseFills(fills) {
  if (!Array.isArray(fills) || !fills.length) return [];
  const result = [];
  for (const f of fills) {
    try {
      if (typeof f === 'string') {
        result.push({ type: 'SOLID', color: hexToRGB(f) });
      } else if (f && (f.color || f.type === 'SOLID')) {
        result.push({ type: 'SOLID', color: hexToRGB(f.color) });
      }
    } catch (e) {
      console.warn('[AdFlow] fill parse error:', e.message);
    }
  }
  return result;
}

// Resolve layers from: layout.layers / .nodes / .children / .layout_json.layers
function resolveLayers(layout) {
  if (Array.isArray(layout.layers))                                      return layout.layers;
  if (Array.isArray(layout.nodes))                                       return layout.nodes;
  if (Array.isArray(layout.children))                                    return layout.children;
  if (layout.layout_json && Array.isArray(layout.layout_json.layers))   return layout.layout_json.layers;
  return [];
}

// Resolve canvas dimensions from root-level or canvas object
function resolveCanvas(layout) {
  if (layout.canvas && (layout.canvas.width || layout.canvas.height)) {
    return {
      width:  safeN(layout.canvas.width,  1080),
      height: safeN(layout.canvas.height, 1080),
    };
  }
  return {
    width:  safeN(layout.width,  1080),
    height: safeN(layout.height, 1080),
  };
}

// ── Font loading — Inter Regular only, always safe ────────────────────────────

const INTER_REGULAR = { family: 'Inter', style: 'Regular' };

async function loadInterRegular() {
  console.log('[AdFlow] loading Inter Regular…');
  await figma.loadFontAsync(INTER_REGULAR);
  console.log('[AdFlow] Inter Regular loaded');
}

// ── Node builders ─────────────────────────────────────────────────────────────

function buildRectangle(layer) {
  const w = safeW(layer), h = safeH(layer);
  const x = safeX(layer), y = safeY(layer);
  console.log('[AdFlow] RECT "' + (layer.name || '?') + '" ' + w + 'x' + h + ' @(' + x + ',' + y + ')');

  const rect = figma.createRectangle();
  rect.name = String(layer.name || 'Rectangle');
  rect.x = x;
  rect.y = y;
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
  console.log('[AdFlow] IMAGE "' + name + '" ' + w + 'x' + h + ' @(' + x + ',' + y + ')');

  const frame = figma.createFrame();
  frame.name = name;
  frame.x = x;
  frame.y = y;
  frame.resize(w, h);
  frame.clipsContent = true;
  frame.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];

  try {
    const label = figma.createText();
    label.fontName = INTER_REGULAR;
    label.fontSize = Math.max(11, Math.round(Math.min(w, h) * 0.06));
    label.fills = [{ type: 'SOLID', color: { r: 0.38, g: 0.40, b: 0.45 } }];
    label.characters = '◈  ' + name;
    label.textAlignHorizontal = 'CENTER';
    label.x = Math.max(0, Math.round((w - label.width)  / 2));
    label.y = Math.max(0, Math.round((h - label.height) / 2));
    frame.appendChild(label);
  } catch (e) {
    console.warn('[AdFlow] IMAGE label skipped:', e.message);
  }

  return frame;
}

async function buildText(layer) {
  const w = safeW(layer), h = safeH(layer);
  const x = safeX(layer), y = safeY(layer);

  // Support both format variants: content/text, style.fontSize/fontSize, style.color/color
  const style      = layer.style || {};
  const characters = String(layer.content != null ? layer.content : (layer.text != null ? layer.text : ''));
  const fontSize   = safeN(layer.fontSize ?? style.fontSize, 32);
  const colorHex   = layer.color ?? style.color ?? null;
  const textAlign  = (layer.textAlign ?? style.textAlign ?? 'LEFT').toUpperCase();

  const name = String(layer.name || 'Text');
  console.log('[AdFlow] TEXT "' + name + '" size=' + fontSize + ' chars=' + characters.length);

  const text = figma.createText();
  text.name = name;
  text.x = x;
  text.y = y;
  text.fontName = INTER_REGULAR;
  text.fontSize = Math.max(1, fontSize);
  text.characters = characters;

  if (colorHex) {
    try { text.fills = [{ type: 'SOLID', color: hexToRGB(colorHex) }]; } catch (e) {
      console.warn('[AdFlow] TEXT color failed:', e.message);
    }
  }

  const H_ALIGN = { CENTER: 'CENTER', LEFT: 'LEFT', RIGHT: 'RIGHT' };
  try { text.textAlignHorizontal = H_ALIGN[textAlign] || 'LEFT'; } catch {}

  try {
    text.textAutoResize = 'NONE';
    text.resize(w, h);
  } catch (e) {
    console.warn('[AdFlow] TEXT resize skipped:', e.message);
  }

  return text;
}

// ── Main import ───────────────────────────────────────────────────────────────

async function importCreative(layout) {
  console.log('[AdFlow] importCreative start');

  const layers = resolveLayers(layout);
  const canvas = resolveCanvas(layout);
  const W      = Math.max(1, canvas.width);
  const H      = Math.max(1, canvas.height);
  const meta   = layout.meta || {};

  console.log('[AdFlow] canvas:', W + 'x' + H, '| layers:', layers.length);

  figma.ui.postMessage({ type: 'progress', message: 'Loading fonts…' });
  await loadInterRegular();

  figma.ui.postMessage({ type: 'progress', message: 'Building frame (' + layers.length + ' layers)…' });

  const frame = figma.createFrame();
  const frameName = [meta.brand_name, meta.layout_type].filter(Boolean).join(' — ') || 'AdFlow Creative';
  frame.name = frameName;
  frame.resize(W, H);
  frame.clipsContent = true;
  frame.fills = [];
  console.log('[AdFlow] root frame "' + frameName + '" ' + W + 'x' + H);

  const SUPPORTED = new Set(['RECTANGLE', 'IMAGE', 'TEXT']);
  let built = 0;
  let skipped = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const type  = String(layer.type || '').toUpperCase();
    console.log('[AdFlow] layer ' + (i + 1) + '/' + layers.length + ': ' + type + ' "' + (layer.name || '') + '"');

    if (!SUPPORTED.has(type)) {
      console.warn('[AdFlow] unsupported type "' + type + '" — skipping');
      skipped++;
      continue;
    }

    let node = null;
    try {
      if      (type === 'RECTANGLE') node = buildRectangle(layer);
      else if (type === 'IMAGE')     node = await buildImagePlaceholder(layer);
      else if (type === 'TEXT')      node = await buildText(layer);
    } catch (e) {
      console.error('[AdFlow] layer "' + (layer.name || type) + '" failed:', e.message, e.stack);
      try {
        const fallback = figma.createRectangle();
        fallback.name = '(error) ' + (layer.name || type);
        fallback.x = safeX(layer);
        fallback.y = safeY(layer);
        fallback.resize(safeW(layer), safeH(layer));
        fallback.fills = [{ type: 'SOLID', color: { r: 1, g: 0.3, b: 0.3 } }];
        node = fallback;
      } catch {}
    }

    if (node) {
      try {
        frame.appendChild(node);
        built++;
      } catch (e) {
        console.error('[AdFlow] appendChild failed:', e.message);
      }
    }
  }

  console.log('[AdFlow] built:', built, '| skipped:', skipped);

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];

  figma.ui.postMessage({
    type: 'done',
    message: 'Imported "' + frameName + '" — ' + built + ' layer' + (built !== 1 ? 's' : ''),
  });
  console.log('[AdFlow] import complete — "' + frameName + '"');
}

// ── Message handler ───────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  try {
    console.log('PLUGIN MESSAGE', msg && msg.type);

    if (msg.type === 'test') {
      // Hardcoded minimal layout — used to verify the plugin core works
      const testLayout = {
        schema: 'creative-layout',
        width:  1080,
        height: 1080,
        layers: [
          {
            type: 'RECTANGLE', name: 'Background',
            x: 0, y: 0, width: 1080, height: 1080,
            fills: ['#5b6af0'],
          },
          {
            type: 'TEXT', name: 'Headline',
            text: 'Test Creative',
            x: 120, y: 120, width: 840, height: 120,
            fontSize: 64, color: '#ffffff',
          },
        ],
      };
      await importCreative(testLayout);
      return;
    }

    if (msg.type === 'import') {
      let layout;
      try {
        layout = typeof msg.json === 'string' ? JSON.parse(msg.json) : msg.json;
      } catch (e) {
        figma.ui.postMessage({ type: 'error', message: 'Invalid JSON: ' + e.message, stack: e.stack || '' });
        return;
      }

      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
        figma.ui.postMessage({ type: 'error', message: 'JSON must be an object', stack: '' });
        return;
      }

      if (layout.schema && layout.schema !== 'creative-layout') {
        figma.ui.postMessage({
          type: 'error',
          message: 'Not an AdFlow layout (schema: "' + layout.schema + '")\nExpected: "creative-layout"',
          stack: '',
        });
        return;
      }

      await importCreative(layout);
      return;
    }

    if (msg.type === 'close') {
      figma.closePlugin();
    }

  } catch (error) {
    console.error('PLUGIN IMPORT ERROR', error);
    try {
      figma.ui.postMessage({
        type:    'error',
        message: error.message || String(error),
        stack:   error.stack   || '',
      });
    } catch {}
  }
};
