// AdFlow Creative Importer — Figma Plugin
// Sandbox-safe: no ??, no ?., no require, no DOM, no Node APIs.
// Supports V1 fast layout, V2 editable (vision), V3 blueprint (Claude).

figma.showUI(__html__, { width: 420, height: 680 });

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

// ── Test frame ────────────────────────────────────────────────────────────────

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

// Handles V1/V2 fills array + V3 blueprint background_color string
function parseFills(layer) {
  // V3 blueprint: flat background_color field
  if (layer.background_color && typeof layer.background_color === 'string') {
    return [{ type: 'SOLID', color: hexToRGB(layer.background_color) }];
  }
  // V1/V2: fills array of strings or objects
  var fills = layer.fills;
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

// Supports layout.layers / .nodes / .children / .layout_json.layers
function resolveLayers(layout) {
  if (Array.isArray(layout.layers))   return layout.layers;
  if (Array.isArray(layout.nodes))    return layout.nodes;
  if (Array.isArray(layout.children)) return layout.children;
  if (layout.layout_json && Array.isArray(layout.layout_json.layers)) return layout.layout_json.layers;
  return [];
}

// Supports canvas.width/height or root width/height
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

// Text content: blueprint uses .text, V1/V2 uses .content then .text
function getTextContent(layer) {
  if (layer.content != null) return String(layer.content);
  if (layer.text    != null) return String(layer.text);
  return '';
}

// Font size: blueprint uses .font_size, V1/V2 uses .fontSize or .style.fontSize
function getTextFontSize(layer) {
  var style = layer.style || {};
  var size;
  if (layer.font_size != null)  size = layer.font_size;   // V3 blueprint
  else if (layer.fontSize != null) size = layer.fontSize;  // V2
  else size = style.fontSize;                              // V1
  return Math.max(1, safeNum(size, 32));
}

// Font weight: blueprint uses .font_weight (400 | 700)
function getTextFontStyle(layer) {
  var style = layer.style || {};
  var weight = layer.font_weight || style.fontWeight || 400;
  return (Number(weight) >= 600) ? 'Bold' : 'Regular';
}

// Text color: blueprint .color, V1/V2 .color or .style.color
function getTextColor(layer) {
  var style = layer.style || {};
  if (layer.color != null) return layer.color;
  if (style.color != null) return style.color;
  return null;
}

// Text alignment: blueprint .alignment, V1/V2 .textAlign or .style.textAlign
function getTextAlign(layer) {
  var style = layer.style || {};
  var align = layer.alignment || layer.textAlign || style.textAlign || 'LEFT';
  return String(align).toUpperCase();
}

// Corner radius: blueprint .border_radius, V1/V2 .cornerRadius
function getCornerRadius(layer) {
  if (layer.border_radius != null) return Math.max(0, Number(layer.border_radius) || 0);
  if (layer.cornerRadius  != null) return Math.max(0, Number(layer.cornerRadius)  || 0);
  return 0;
}

// ── Shared node setup helpers ─────────────────────────────────────────────────

function applyRectStyle(rect, layer) {
  rect.cornerRadius = getCornerRadius(layer);
  if (layer.opacity != null && isFinite(Number(layer.opacity))) {
    rect.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
  }
}

async function makeTextNode(content, layer, w, h, fontStyle, loaded) {
  // fontStyle is 'Regular' or 'Bold'; loaded = set of already-loaded styles
  if (!loaded[fontStyle]) {
    try { await figma.loadFontAsync({ family: 'Inter', style: fontStyle }); } catch (_) { fontStyle = 'Regular'; }
    loaded[fontStyle] = true;
  }
  var txt = figma.createText();
  txt.fontName  = { family: 'Inter', style: fontStyle };
  txt.fontSize  = getTextFontSize(layer);
  txt.characters = content;
  var colorHex = getTextColor(layer);
  if (colorHex) {
    try { txt.fills = [{ type: 'SOLID', color: hexToRGB(colorHex) }]; } catch (_) {}
  }
  var alignMap = { CENTER: 'CENTER', LEFT: 'LEFT', RIGHT: 'RIGHT' };
  var alignKey = getTextAlign(layer);
  try { txt.textAlignHorizontal = alignMap[alignKey] || 'LEFT'; } catch (_) {}
  try { txt.textAutoResize = 'NONE'; txt.resize(w, h); } catch (_) {}
  return txt;
}

async function makeImageFrame(layer, w, h, importImages, counters) {
  var imgFrame = figma.createFrame();
  imgFrame.name = String(layer.name || 'Image');
  imgFrame.resize(w, h);
  imgFrame.clipsContent = true;
  imgFrame.cornerRadius = getCornerRadius(layer);
  if (layer.opacity != null && isFinite(Number(layer.opacity))) {
    imgFrame.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
  }

  var imageLoaded = false;
  var imageUrl = layer.image_url;

  if (importImages && imageUrl && typeof imageUrl === 'string') {
    figma.ui.postMessage({ type: 'progress', message: 'Fetching image: ' + String(layer.name || '') + '…' });
    var fill = await fetchImageFill(imageUrl);
    if (fill) {
      imgFrame.fills = [fill];
      imageLoaded = true;
      counters.fetched++;
    } else {
      counters.failed++;
    }
  }

  if (!imageLoaded) {
    var bgColor = layer.background_color || null;
    imgFrame.fills = bgColor
      ? [{ type: 'SOLID', color: hexToRGB(bgColor) }]
      : [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];

    var labelText = String(layer.name || layer.role || 'Image');
    var labelColor = (counters.failed > 0 && importImages && imageUrl)
      ? { r: 0.75, g: 0.2, b: 0.2 }
      : { r: 0.38, g: 0.40, b: 0.45 };
    try {
      var lbl = figma.createText();
      lbl.fontName = { family: 'Inter', style: 'Regular' };
      lbl.fontSize = Math.max(11, Math.round(Math.min(w, h) * 0.06));
      lbl.fills    = [{ type: 'SOLID', color: labelColor }];
      lbl.characters = '◈  ' + labelText;
      lbl.textAlignHorizontal = 'CENTER';
      lbl.x = Math.max(0, Math.round((w - lbl.width)  / 2));
      lbl.y = Math.max(0, Math.round((h - lbl.height) / 2));
      imgFrame.appendChild(lbl);
    } catch (_) {}
  }

  return imgFrame;
}

// ── Main import ───────────────────────────────────────────────────────────────

async function importCreative(layout, importImages, includeLockedRef) {
  var isBlueprint = (layout.export_mode === 'blueprint' || layout.version === '3.0');
  var layers = resolveLayers(layout);
  var canvas = resolveCanvas(layout);
  var W      = Math.max(1, canvas.width);
  var H      = Math.max(1, canvas.height);
  var meta   = layout.meta || {};

  console.log('[AdFlow] canvas: ' + W + 'x' + H + ' | layers: ' + layers.length +
              ' | mode: ' + (layout.export_mode || 'fast') + ' | images: ' + importImages);

  figma.ui.postMessage({ type: 'progress', message: 'Loading fonts…' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  var loadedFonts = { Regular: true };
  // Pre-load Bold for blueprint mode (may have font_weight 700)
  if (isBlueprint) {
    try { await figma.loadFontAsync({ family: 'Inter', style: 'Bold' }); loadedFonts['Bold'] = true; } catch (_) {}
  }

  figma.ui.postMessage({ type: 'progress', message: 'Building frame (' + layers.length + ' layers)…' });

  var brandName  = meta.brand_name  || '';
  var layoutType = meta.layout_type || (isBlueprint ? 'Blueprint' : '');
  var exportMode = layout.export_mode || 'fast';
  var frameSuffix = isBlueprint ? ' [Blueprint]' : '';
  var frameName  = (brandName || layoutType)
    ? [brandName, layoutType].filter(Boolean).join(' — ') + frameSuffix
    : 'AdFlow Creative' + frameSuffix;

  var frame = figma.createFrame();
  frame.name = frameName;
  frame.resize(W, H);
  frame.clipsContent = true;

  // Canvas background color (blueprint sets it on canvas object)
  if (layout.canvas && layout.canvas.background_color) {
    frame.fills = [{ type: 'SOLID', color: hexToRGB(layout.canvas.background_color) }];
  } else {
    frame.fills = [];
  }

  console.log('[AdFlow] root frame "' + frameName + '" ' + W + 'x' + H);

  var built   = 0;
  var skipped = 0;
  var counters = { fetched: 0, failed: 0 };

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    // Blueprint types are lowercase; V1/V2 types are uppercase — normalise to uppercase
    var type  = String(layer.type || '').toUpperCase();
    var w     = Math.max(1, safeNum(layer.width,  100));
    var h     = Math.max(1, safeNum(layer.height, 100));
    var x     = safeNum(layer.x, 0);
    var y     = safeNum(layer.y, 0);

    console.log('[AdFlow] layer ' + (i + 1) + '/' + layers.length + ': ' + type + ' "' + (layer.name || '') + '"');

    var node = null;

    try {
      // ── V1/V2 types ─────────────────────────────────────────
      if (type === 'RECTANGLE') {
        var rect = figma.createRectangle();
        rect.name = String(layer.name || 'Rectangle');
        rect.x = x; rect.y = y;
        rect.resize(w, h);
        applyRectStyle(rect, layer);
        var rFills = parseFills(layer);
        rect.fills = rFills.length ? rFills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
        node = rect;

      } else if (type === 'IMAGE') {
        var imgF = await makeImageFrame(layer, w, h, importImages, counters);
        imgF.name = String(layer.name || 'Image');
        imgF.x = x; imgF.y = y;
        node = imgF;

      } else if (type === 'TEXT') {
        var fontStyleT = getTextFontStyle(layer);
        var txt = await makeTextNode(getTextContent(layer), layer, w, h, fontStyleT, loadedFonts);
        txt.name = String(layer.name || 'Text');
        txt.x = x; txt.y = y;
        node = txt;

      } else if (type === 'ELLIPSE') {
        var ellipse = figma.createEllipse();
        ellipse.name = String(layer.name || 'Ellipse');
        ellipse.x = x; ellipse.y = y;
        ellipse.resize(w, h);
        if (layer.opacity != null && isFinite(Number(layer.opacity))) {
          ellipse.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
        }
        var eFills = parseFills(layer);
        ellipse.fills = eFills.length ? eFills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
        node = ellipse;

      } else if (type === 'LINE') {
        var lineRect = figma.createRectangle();
        lineRect.name = String(layer.name || 'Line');
        lineRect.x = x; lineRect.y = y;
        var lineH = (layer.strokeWeight != null && isFinite(Number(layer.strokeWeight)))
          ? Math.max(1, Number(layer.strokeWeight)) : Math.max(1, h);
        lineRect.resize(w, lineH);
        var lFills = parseFills(layer);
        if (!lFills.length && layer.color) lFills = [{ type: 'SOLID', color: hexToRGB(layer.color) }];
        lineRect.fills = lFills.length ? lFills : [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }];
        node = lineRect;

      // ── V3 Blueprint types ───────────────────────────────────
      } else if (type === 'BACKGROUND') {
        // Full-canvas background rectangle
        var bgRect = figma.createRectangle();
        bgRect.name = String(layer.name || 'Background');
        bgRect.x = x; bgRect.y = y;
        bgRect.resize(w, h);
        var bgFills = parseFills(layer);
        bgRect.fills = bgFills.length ? bgFills : [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.98 } }];
        node = bgRect;

      } else if (type === 'SHAPE') {
        var shapeRect = figma.createRectangle();
        shapeRect.name = String(layer.name || 'Shape');
        shapeRect.x = x; shapeRect.y = y;
        shapeRect.resize(w, h);
        applyRectStyle(shapeRect, layer);
        var sFills = parseFills(layer);
        shapeRect.fills = sFills.length ? sFills : [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.9 } }];
        node = shapeRect;

      } else if (type === 'DIVIDER') {
        var divRect = figma.createRectangle();
        divRect.name = String(layer.name || 'Divider');
        divRect.x = x; divRect.y = y;
        var divH = Math.max(1, Math.min(h, 4)); // dividers max 4px tall
        divRect.resize(w, divH);
        var dFills = parseFills(layer);
        if (!dFills.length && layer.color) dFills = [{ type: 'SOLID', color: hexToRGB(layer.color) }];
        divRect.fills = dFills.length ? dFills : [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.84 } }];
        if (layer.opacity != null && isFinite(Number(layer.opacity))) {
          divRect.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
        }
        node = divRect;

      } else if (type === 'BUTTON') {
        // Button = FRAME with RECTANGLE bg + TEXT label stacked
        var btnFrame = figma.createFrame();
        btnFrame.name = String(layer.name || 'Button');
        btnFrame.x = x; btnFrame.y = y;
        btnFrame.resize(w, h);
        btnFrame.clipsContent = true;
        btnFrame.cornerRadius = getCornerRadius(layer);
        btnFrame.fills = [];

        // Background rect
        var btnBg = figma.createRectangle();
        btnBg.name = 'Button Background';
        btnBg.x = 0; btnBg.y = 0;
        btnBg.resize(w, h);
        btnBg.cornerRadius = getCornerRadius(layer);
        var btnFills = parseFills(layer);
        btnBg.fills = btnFills.length ? btnFills : [{ type: 'SOLID', color: { r: 0.36, g: 0.42, b: 0.94 } }];
        btnFrame.appendChild(btnBg);

        // Label text
        var btnText = getTextContent(layer);
        if (btnText) {
          var btnFontStyle = getTextFontStyle(layer);
          if (!loadedFonts[btnFontStyle]) {
            try { await figma.loadFontAsync({ family: 'Inter', style: btnFontStyle }); } catch (_) { btnFontStyle = 'Regular'; }
            loadedFonts[btnFontStyle] = true;
          }
          var btnLbl = figma.createText();
          btnLbl.name = 'Button Label';
          btnLbl.fontName = { family: 'Inter', style: btnFontStyle };
          btnLbl.fontSize = getTextFontSize(layer);
          btnLbl.characters = btnText;
          var btnColor = getTextColor(layer);
          if (btnColor) { try { btnLbl.fills = [{ type: 'SOLID', color: hexToRGB(btnColor) }]; } catch (_) {} }
          try { btnLbl.textAlignHorizontal = 'CENTER'; } catch (_) {}
          // Centre text within button
          try {
            btnLbl.textAutoResize = 'WIDTH_AND_HEIGHT';
            btnLbl.x = Math.max(0, Math.round((w - btnLbl.width)  / 2));
            btnLbl.y = Math.max(0, Math.round((h - btnLbl.height) / 2));
          } catch (_) {
            btnLbl.x = 0; btnLbl.y = 0;
          }
          btnFrame.appendChild(btnLbl);
        }
        node = btnFrame;

      } else if (type === 'ICON') {
        // Icon = small ELLIPSE or RECTANGLE placeholder
        var iconEl = figma.createEllipse();
        iconEl.name = String(layer.name || 'Icon');
        iconEl.x = x; iconEl.y = y;
        iconEl.resize(w, h);
        var iconFills = parseFills(layer);
        iconEl.fills = iconFills.length ? iconFills : [{ type: 'SOLID', color: { r: 0.75, g: 0.75, b: 0.82 } }];
        if (layer.opacity != null && isFinite(Number(layer.opacity))) {
          iconEl.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
        }
        node = iconEl;

      } else if (type === 'LOGO') {
        var logoFrame = await makeImageFrame(layer, w, h, false, counters); // logos not fetched from image_url
        logoFrame.name = String(layer.name || 'Logo');
        logoFrame.x = x; logoFrame.y = y;
        // Override placeholder label to say Logo
        node = logoFrame;

      } else if (type === 'PRODUCT_IMAGE') {
        var prodLayer = Object.assign({}, layer);
        // product_image uses image_url (injected by server) for the real product photo
        var prodFrame = await makeImageFrame(prodLayer, w, h, importImages, counters);
        prodFrame.name = String(layer.name || 'Product Image');
        prodFrame.x = x; prodFrame.y = y;
        node = prodFrame;

      } else if (type === 'GROUP') {
        // Render as an empty FRAME — child layers in blueprint are flat (no nesting in JSON)
        var groupFrame = figma.createFrame();
        groupFrame.name = String(layer.name || 'Group');
        groupFrame.x = x; groupFrame.y = y;
        groupFrame.resize(w, h);
        groupFrame.fills = [];
        groupFrame.clipsContent = false;
        node = groupFrame;

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

  // Locked reference image — placed at bottom of stack (editable mode or blueprint with flat_image_url)
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
      frame.insertChild(0, refFrame);
      console.log('[AdFlow] locked reference layer added');
    }
  }

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];

  var modeLabel = isBlueprint ? 'Blueprint' : (layout.export_mode === 'editable' ? 'Editable' : 'Layout');
  var summary = modeLabel + ' imported: "' + frameName + '" — ' + built + ' layer' + (built !== 1 ? 's' : '');
  if (importImages && (counters.fetched || counters.failed)) {
    summary += ' (' + counters.fetched + ' image' + (counters.fetched !== 1 ? 's' : '') + ' loaded';
    if (counters.failed > 0) summary += ', ' + counters.failed + ' failed';
    summary += ')';
  }

  figma.ui.postMessage({ type: 'done', message: summary });
  console.log('[AdFlow] import complete | built: ' + built + ' | images: ' +
              counters.fetched + '/' + (counters.fetched + counters.failed) + ' | skipped: ' + skipped);
}
