// AdFlow Creative Importer — Figma Plugin
// Sandbox-safe: no ??, no ?., no require, no DOM, no Node APIs.
// Only figma.showUI and figma.ui.onmessage run at startup.

figma.showUI(__html__, { width: 420, height: 620 });

figma.ui.onmessage = async function(msg) {
  if (!msg) return;
  try {
    if (msg.type === 'test')   { await createTestFrame(); return; }
    if (msg.type === 'import') { await handleImport(msg); return; }
    if (msg.type === 'close')  { figma.closePlugin(); }
  } catch (err) {
    var errMsg   = (err && err.message) ? err.message : String(err);
    var errStack = (err && err.stack)   ? err.stack   : '';
    try { figma.ui.postMessage({ type: 'error', message: errMsg, stack: errStack }); } catch (_) {}
  }
};

// ── Test frame — verifies the plugin runtime works ────────────────────────────

async function createTestFrame() {
  figma.ui.postMessage({ type: 'progress', message: 'Loading font…' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  var frame = figma.createFrame();
  frame.name = 'AdFlow Test';
  frame.resize(1080, 1080);
  frame.fills = [];

  var bg = figma.createRectangle();
  bg.name = 'Background';
  bg.x = 0; bg.y = 0;
  bg.resize(1080, 1080);
  bg.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.appendChild(bg);

  var textNode = figma.createText();
  textNode.fontName = { family: 'Inter', style: 'Regular' };
  textNode.characters = 'Hello from AdFlow';
  textNode.fontSize = 48;
  textNode.x = 100;
  textNode.y = 490;
  textNode.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  frame.appendChild(textNode);

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];

  figma.ui.postMessage({ type: 'done', message: 'Test frame created — plugin works!' });
}

// ── Import handler ────────────────────────────────────────────────────────────

async function handleImport(msg) {
  var rawJson        = msg.json;
  var importImages   = !!msg.importImages;
  var includeLockedRef = !!msg.includeLockedRef;

  if (!rawJson) {
    figma.ui.postMessage({ type: 'error', message: 'No JSON provided', stack: '' });
    return;
  }
  var layout;
  try {
    layout = JSON.parse(rawJson);
  } catch (parseErr) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Invalid JSON: ' + parseErr.message,
      stack: parseErr.stack || ''
    });
    return;
  }
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    figma.ui.postMessage({ type: 'error', message: 'JSON must be an object', stack: '' });
    return;
  }
  if (layout.schema && layout.schema !== 'creative-layout') {
    figma.ui.postMessage({
      type: 'error',
      message: 'Expected schema "creative-layout", got "' + layout.schema + '"',
      stack: ''
    });
    return;
  }
  await importCreative(layout, importImages, includeLockedRef);
}

// ── Image fetching ────────────────────────────────────────────────────────────

async function fetchImageFill(url) {
  // Returns a Figma IMAGE fill paint, or null on failure
  try {
    var response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var bytes = await response.arrayBuffer();
    var uint8 = new Uint8Array(bytes);
    var figmaImage = figma.createImage(uint8);
    return { type: 'IMAGE', scaleMode: 'FILL', imageHash: figmaImage.hash };
  } catch (e) {
    console.warn('[AdFlow] image fetch failed (' + url + '): ' + e.message);
    return null;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function hexToRGB(hex) {
  if (!hex || typeof hex !== 'string') return { r: 0.5, g: 0.5, b: 0.5 };
  var clean = hex.replace(/^#/, '').trim();
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

function safeNum(v, fallback) {
  var n = Number(v);
  return isFinite(n) ? n : fallback;
}

// Handles both "#hex" string fills and { type:'SOLID', color:'#hex' } object fills
function parseFills(fills) {
  if (!Array.isArray(fills) || fills.length === 0) return [];
  var result = [];
  for (var i = 0; i < fills.length; i++) {
    var f = fills[i];
    try {
      if (typeof f === 'string') {
        result.push({ type: 'SOLID', color: hexToRGB(f) });
      } else if (f && f.color) {
        result.push({ type: 'SOLID', color: hexToRGB(f.color) });
      }
    } catch (e) {
      console.warn('[AdFlow] fill parse error:', e.message);
    }
  }
  return result;
}

// Supports: layout.layers / .nodes / .children / .layout_json.layers
function resolveLayers(layout) {
  if (Array.isArray(layout.layers))   return layout.layers;
  if (Array.isArray(layout.nodes))    return layout.nodes;
  if (Array.isArray(layout.children)) return layout.children;
  if (layout.layout_json && Array.isArray(layout.layout_json.layers)) return layout.layout_json.layers;
  return [];
}

// Supports: root width/height or canvas.width/height
function resolveCanvas(layout) {
  if (layout.canvas && layout.canvas.width) {
    return {
      width:  safeNum(layout.canvas.width,  1080),
      height: safeNum(layout.canvas.height, 1080),
    };
  }
  return {
    width:  safeNum(layout.width,  1080),
    height: safeNum(layout.height, 1080),
  };
}

function getTextContent(layer) {
  if (layer.content != null) return String(layer.content);
  if (layer.text    != null) return String(layer.text);
  return '';
}

function getTextFontSize(layer) {
  var style = layer.style || {};
  var size  = (layer.fontSize != null) ? layer.fontSize : style.fontSize;
  return Math.max(1, safeNum(size, 32));
}

function getTextColor(layer) {
  var style = layer.style || {};
  if (layer.color != null) return layer.color;
  if (style.color != null) return style.color;
  return null;
}

function getTextAlign(layer) {
  var style = layer.style || {};
  var align = layer.textAlign || style.textAlign || 'LEFT';
  return String(align).toUpperCase();
}

// ── Main import ───────────────────────────────────────────────────────────────

async function importCreative(layout, importImages, includeLockedRef) {
  var layers = resolveLayers(layout);
  var canvas = resolveCanvas(layout);
  var W      = Math.max(1, canvas.width);
  var H      = Math.max(1, canvas.height);
  var meta   = layout.meta || {};

  console.log('[AdFlow] canvas: ' + W + 'x' + H + ' | layers: ' + layers.length + ' | importImages: ' + importImages);
  figma.ui.postMessage({ type: 'progress', message: 'Loading font…' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  figma.ui.postMessage({ type: 'progress', message: 'Building frame (' + layers.length + ' layers)…' });

  var brandName  = meta.brand_name  || '';
  var layoutType = meta.layout_type || '';
  var frameName  = (brandName || layoutType)
    ? [brandName, layoutType].filter(Boolean).join(' — ')
    : 'AdFlow Creative';

  var frame = figma.createFrame();
  frame.name = frameName;
  frame.resize(W, H);
  frame.clipsContent = true;
  frame.fills = [];
  console.log('[AdFlow] root frame "' + frameName + '" ' + W + 'x' + H);

  var built   = 0;
  var skipped = 0;
  var imgFetched = 0;
  var imgFailed  = 0;

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var type  = String(layer.type || '').toUpperCase();
    var w     = Math.max(1, safeNum(layer.width,  100));
    var h     = Math.max(1, safeNum(layer.height, 100));
    var x     = safeNum(layer.x, 0);
    var y     = safeNum(layer.y, 0);

    console.log('[AdFlow] layer ' + (i + 1) + '/' + layers.length + ': ' + type + ' "' + (layer.name || '') + '"');

    var node = null;

    try {
      if (type === 'RECTANGLE') {
        var rect = figma.createRectangle();
        rect.name = String(layer.name || 'Rectangle');
        rect.x = x; rect.y = y;
        rect.resize(w, h);
        if (layer.cornerRadius != null && isFinite(Number(layer.cornerRadius))) {
          rect.cornerRadius = Math.max(0, Number(layer.cornerRadius));
        }
        if (typeof layer.opacity === 'number' && isFinite(layer.opacity)) {
          rect.opacity = Math.max(0, Math.min(1, layer.opacity));
        }
        var rFills = parseFills(layer.fills);
        rect.fills = rFills.length ? rFills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
        node = rect;

      } else if (type === 'IMAGE') {
        // Always create a frame (acts as a clipping container)
        var imgFrame = figma.createFrame();
        imgFrame.name = String(layer.name || 'Image');
        imgFrame.x = x; imgFrame.y = y;
        imgFrame.resize(w, h);
        imgFrame.clipsContent = true;

        if (layer.cornerRadius != null && isFinite(Number(layer.cornerRadius))) {
          imgFrame.cornerRadius = Math.max(0, Number(layer.cornerRadius));
        }
        if (typeof layer.opacity === 'number' && isFinite(layer.opacity)) {
          imgFrame.opacity = Math.max(0, Math.min(1, layer.opacity));
        }

        var imageLoaded = false;

        // Try real image fetch if URL is present and importImages is enabled
        if (importImages && layer.image_url && typeof layer.image_url === 'string') {
          figma.ui.postMessage({ type: 'progress', message: 'Fetching image: ' + String(layer.name || '') + '…' });
          var fill = await fetchImageFill(layer.image_url);
          if (fill) {
            imgFrame.fills = [fill];
            imageLoaded = true;
            imgFetched++;
            console.log('[AdFlow] IMAGE loaded: "' + String(layer.name || '') + '"');
          } else {
            imgFailed++;
            console.warn('[AdFlow] IMAGE fetch failed for "' + String(layer.name || '') + '" — showing placeholder');
          }
        }

        if (!imageLoaded) {
          // Placeholder: grey fill + centered label
          imgFrame.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];

          var labelColor = imgFailed > 0 && importImages && layer.image_url
            ? { r: 0.75, g: 0.2, b: 0.2 }   // red tint — fetch was attempted and failed
            : { r: 0.38, g: 0.40, b: 0.45 }; // grey — no URL or images disabled

          var labelText = (importImages && layer.image_url)
            ? 'Image failed to load'
            : String('◈  ' + String(layer.name || 'Image'));

          try {
            var lbl = figma.createText();
            lbl.fontName = { family: 'Inter', style: 'Regular' };
            lbl.fontSize = Math.max(11, Math.round(Math.min(w, h) * 0.055));
            lbl.fills    = [{ type: 'SOLID', color: labelColor }];
            lbl.characters = labelText;
            lbl.textAlignHorizontal = 'CENTER';
            lbl.x = Math.max(0, Math.round((w - lbl.width)  / 2));
            lbl.y = Math.max(0, Math.round((h - lbl.height) / 2));
            imgFrame.appendChild(lbl);
          } catch (lblErr) {
            console.warn('[AdFlow] placeholder label skipped: ' + lblErr.message);
          }
        }

        node = imgFrame;

      } else if (type === 'TEXT') {
        var txt = figma.createText();
        txt.name     = String(layer.name || 'Text');
        txt.x        = x; txt.y = y;
        txt.fontName = { family: 'Inter', style: 'Regular' };
        txt.fontSize = getTextFontSize(layer);
        txt.characters = getTextContent(layer);

        var colorHex = getTextColor(layer);
        if (colorHex) {
          try { txt.fills = [{ type: 'SOLID', color: hexToRGB(colorHex) }]; } catch (_) {}
        }

        var alignMap = { CENTER: 'CENTER', LEFT: 'LEFT', RIGHT: 'RIGHT' };
        var alignKey = getTextAlign(layer);
        try { txt.textAlignHorizontal = alignMap[alignKey] || 'LEFT'; } catch (_) {}

        try {
          txt.textAutoResize = 'NONE';
          txt.resize(w, h);
        } catch (_) {
          console.warn('[AdFlow] TEXT resize skipped for "' + String(layer.name || '') + '"');
        }
        node = txt;

      } else if (type === 'ELLIPSE') {
        var ellipse = figma.createEllipse();
        ellipse.name = String(layer.name || 'Ellipse');
        ellipse.x = x; ellipse.y = y;
        ellipse.resize(w, h);
        if (typeof layer.opacity === 'number' && isFinite(layer.opacity)) {
          ellipse.opacity = Math.max(0, Math.min(1, layer.opacity));
        }
        var eFills = parseFills(layer.fills);
        ellipse.fills = eFills.length ? eFills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
        node = ellipse;

      } else if (type === 'LINE') {
        // Render as a thin rectangle — LINE nodes in Figma have no height API from scratch
        var lineRect = figma.createRectangle();
        lineRect.name = String(layer.name || 'Line');
        lineRect.x = x; lineRect.y = y;
        var lineH = (layer.strokeWeight != null && isFinite(Number(layer.strokeWeight)))
          ? Math.max(1, Number(layer.strokeWeight))
          : Math.max(1, h);
        lineRect.resize(w, lineH);
        var lFills = parseFills(layer.fills);
        if (!lFills.length && layer.color) {
          lFills = [{ type: 'SOLID', color: hexToRGB(layer.color) }];
        }
        lineRect.fills = lFills.length ? lFills : [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
        node = lineRect;

      } else {
        console.warn('[AdFlow] unsupported type "' + type + '" — skipping "' + String(layer.name || '') + '"');
        skipped++;
        continue;
      }

    } catch (layerErr) {
      console.error('[AdFlow] layer "' + String(layer.name || type) + '" failed: ' + layerErr.message);
      try {
        var errRect = figma.createRectangle();
        errRect.name = '(error) ' + String(layer.name || type);
        errRect.x = x; errRect.y = y;
        errRect.resize(w, h);
        errRect.fills = [{ type: 'SOLID', color: { r: 1, g: 0.3, b: 0.3 } }];
        node = errRect;
      } catch (_) {}
    }

    if (node) {
      try {
        frame.appendChild(node);
        built++;
      } catch (appendErr) {
        console.error('[AdFlow] appendChild failed: ' + appendErr.message);
      }
    }
  }

  // Locked reference image — editable mode only, placed at bottom of stack
  if (includeLockedRef && layout.flat_image_url && typeof layout.flat_image_url === 'string') {
    figma.ui.postMessage({ type: 'progress', message: 'Fetching reference image…' });
    var refFill = await fetchImageFill(layout.flat_image_url);
    if (refFill) {
      var refFrame = figma.createFrame();
      refFrame.name = '⊘ Reference (locked)';
      refFrame.x = 0; refFrame.y = 0;
      refFrame.resize(W, H);
      refFrame.clipsContent = false;
      refFrame.fills = [refFill];
      refFrame.opacity = 0.3;
      refFrame.locked  = true;
      frame.insertChild(0, refFrame); // bottom of stack
      console.log('[AdFlow] locked reference layer added');
    }
  }

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];

  var summary = 'Imported "' + frameName + '" — ' + built + ' layer' + (built !== 1 ? 's' : '');
  if (importImages) {
    summary += ' (' + imgFetched + ' image' + (imgFetched !== 1 ? 's' : '') + ' loaded';
    if (imgFailed > 0) summary += ', ' + imgFailed + ' failed';
    summary += ')';
  }

  figma.ui.postMessage({ type: 'done', message: summary });
  console.log('[AdFlow] import complete | built: ' + built + ' | images: ' + imgFetched + '/' + (imgFetched + imgFailed) + ' | skipped: ' + skipped);
}
