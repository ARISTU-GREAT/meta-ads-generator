/**
 * layoutService
 *
 * Builds a Figma-compatible creative layout JSON from the AI creative strategy
 * and persists it to creative_layouts. One layout per ad (upsert).
 *
 * Layout JSON schema:
 *   version, schema, figma_exportable, meta, canvas, design_tokens, layers,
 *   creative_intelligence
 *
 * Layers use Figma-style node types: RECTANGLE | IMAGE | TEXT
 */

const OpenAI  = require('openai');
const { query } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client (lazy — only initialised when vision analysis is requested)
// ─────────────────────────────────────────────────────────────────────────────
let _openai = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
const VISION_MODEL = () => process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const CANVAS_SIZES = {
  square:    { width: 1080, height: 1080 },
  portrait:  { width: 1080, height: 1350 },
  landscape: { width: 1920, height: 1080 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Layer builders per layout type
// ─────────────────────────────────────────────────────────────────────────────

function buildLayers(opts) {
  const {
    W, H, margin, padding,
    primaryColor, secondaryColor, textColor, textPrimary, textDark,
    primaryFont, secondaryFont,
    headlineSize, bodySize, ctaSize,
    headline, subheadline, cta,
    layoutType,
  } = opts;

  const ctaBtnH  = Math.round(ctaSize * 2.4);
  const ctaBtnW  = Math.round(W * 0.35);
  const ctaRadius = Math.round(ctaBtnH * 0.18);

  const layers = [];
  let _id = 0;
  const id = (name) => `${name}_${++_id}`;

  const ctaCenterX = () => Math.round((W - ctaBtnW) / 2);
  const ctaBottomY = (pad = margin) => H - pad - ctaBtnH;

  function pushCTA(x, y, w, color, textCol) {
    layers.push({
      id: id('cta_bg'), name: 'CTA Background', type: 'RECTANGLE',
      x, y, width: w, height: ctaBtnH,
      cornerRadius: ctaRadius,
      fills: [{ type: 'SOLID', color }],
    });
    layers.push({
      id: id('cta_text'), name: 'CTA Text', type: 'TEXT',
      x, y, width: w, height: ctaBtnH,
      content: cta,
      style: { fontFamily: primaryFont, fontWeight: 600, fontSize: ctaSize, color: textCol, textAlign: 'center', verticalAlign: 'middle' },
    });
  }

  // Background always present
  layers.push({
    id: id('bg'), name: 'Background', type: 'RECTANGLE',
    x: 0, y: 0, width: W, height: H,
    fills: [{ type: 'SOLID', color: primaryColor }],
  });

  switch (layoutType) {
    case 'hero_shot': {
      const prodW = Math.round(W * 0.65);
      const prodH = Math.round(H * 0.55);
      const prodX = Math.round((W - prodW) / 2);
      const prodY = Math.round(H * 0.33);

      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: margin, y: Math.round(H * 0.06),
        width: W - margin * 2, height: headlineSize * 3,
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: headlineSize, color: textColor, textAlign: 'center' },
      });
      if (subheadline) {
        layers.push({
          id: id('subheadline'), name: 'Subheadline', type: 'TEXT',
          x: margin, y: Math.round(H * 0.06) + headlineSize * 3 + 12,
          width: W - margin * 2, height: bodySize * 2,
          content: subheadline,
          style: { fontFamily: secondaryFont, fontWeight: 400, fontSize: bodySize, color: textColor, textAlign: 'center' },
        });
      }
      layers.push({ id: id('product'), name: 'Product Image', type: 'IMAGE', x: prodX, y: prodY, width: prodW, height: prodH });
      pushCTA(ctaCenterX(), ctaBottomY(), ctaBtnW, secondaryColor, textDark);
      break;
    }

    case 'split_screen': {
      const halfW = Math.round(W / 2);
      layers.push({ id: id('product'), name: 'Product Image', type: 'IMAGE', x: 0, y: 0, width: halfW, height: H });
      layers.push({
        id: id('divider'), name: 'Divider', type: 'RECTANGLE',
        x: halfW - 2, y: 0, width: 4, height: H,
        fills: [{ type: 'SOLID', color: secondaryColor, opacity: 0.2 }],
      });

      const tx = halfW + margin;
      const tw = halfW - margin * 2;
      const ty = Math.round(H * 0.22);
      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: tx, y: ty, width: tw, height: headlineSize * 4,
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: headlineSize, color: textColor, textAlign: 'left' },
      });
      if (subheadline) {
        layers.push({
          id: id('subheadline'), name: 'Subheadline', type: 'TEXT',
          x: tx, y: ty + headlineSize * 4 + 16, width: tw, height: bodySize * 3,
          content: subheadline,
          style: { fontFamily: secondaryFont, fontWeight: 400, fontSize: bodySize, color: textColor, textAlign: 'left' },
        });
      }
      const ctaW = Math.round(tw * 0.8);
      pushCTA(tx, H - margin - ctaBtnH, ctaW, secondaryColor, textDark);
      break;
    }

    case 'lifestyle':
    case 'text_overlay': {
      layers.push({ id: id('bg_image'), name: 'Background Image', type: 'IMAGE', x: 0, y: 0, width: W, height: H });
      layers.push({
        id: id('overlay'), name: 'Overlay', type: 'RECTANGLE',
        x: 0, y: 0, width: W, height: H,
        fills: [{ type: 'SOLID', color: '#000000', opacity: 0.45 }],
      });
      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: margin, y: Math.round(H * 0.30),
        width: W - margin * 2, height: headlineSize * 3,
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: headlineSize, color: textPrimary, textAlign: 'center' },
      });
      if (subheadline) {
        layers.push({
          id: id('subheadline'), name: 'Subheadline', type: 'TEXT',
          x: margin, y: Math.round(H * 0.30) + headlineSize * 3 + 16,
          width: W - margin * 2, height: bodySize * 2,
          content: subheadline,
          style: { fontFamily: secondaryFont, fontWeight: 400, fontSize: bodySize, color: textPrimary, textAlign: 'center' },
        });
      }
      pushCTA(ctaCenterX(), ctaBottomY(), ctaBtnW, primaryColor, textPrimary);
      break;
    }

    case 'before_after': {
      const halfW = Math.round(W / 2);
      const imgY  = Math.round(H * 0.12);
      const imgH  = Math.round(H * 0.72);
      layers.push({ id: id('before_image'), name: 'Before Image', type: 'IMAGE', x: 0,         y: imgY, width: halfW - 2, height: imgH });
      layers.push({ id: id('after_image'),  name: 'After Image',  type: 'IMAGE', x: halfW + 2, y: imgY, width: halfW - 2, height: imgH });
      layers.push({
        id: id('divider'), name: 'Center Divider', type: 'RECTANGLE',
        x: halfW - 2, y: 0, width: 4, height: H,
        fills: [{ type: 'SOLID', color: secondaryColor }],
      });
      layers.push({
        id: id('before_label'), name: 'Before Label', type: 'TEXT',
        x: margin, y: imgY + padding, width: halfW - margin * 2, height: bodySize * 2,
        content: 'Before',
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: bodySize, color: textPrimary, textAlign: 'center' },
      });
      layers.push({
        id: id('after_label'), name: 'After Label', type: 'TEXT',
        x: halfW + margin, y: imgY + padding, width: halfW - margin * 2, height: bodySize * 2,
        content: 'After',
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: bodySize, color: textPrimary, textAlign: 'center' },
      });
      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: margin, y: Math.round(H * 0.02),
        width: W - margin * 2, height: Math.round(H * 0.10),
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: Math.round(headlineSize * 0.75), color: textColor, textAlign: 'center' },
      });
      pushCTA(ctaCenterX(), ctaBottomY(), ctaBtnW, primaryColor, textPrimary);
      break;
    }

    case 'collage': {
      const cellW  = Math.round((W - margin * 3) / 2);
      const cellH  = Math.round(H * 0.38);
      const gridY  = Math.round(H * 0.18);
      ['TL', 'TR', 'BL', 'BR'].forEach((pos, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        layers.push({
          id: id(`product_${pos}`), name: `Product ${pos}`, type: 'IMAGE',
          x: margin + col * (cellW + margin),
          y: gridY + row * (cellH + margin),
          width: cellW, height: cellH,
        });
      });
      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: margin, y: Math.round(H * 0.03),
        width: W - margin * 2, height: Math.round(H * 0.13),
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: Math.round(headlineSize * 0.8), color: textColor, textAlign: 'center' },
      });
      pushCTA(ctaCenterX(), ctaBottomY(), ctaBtnW, primaryColor, textPrimary);
      break;
    }

    default: {
      // product_focus — product centered, headline top
      const prodW = Math.round(W * 0.72);
      const prodH = Math.round(H * 0.62);
      const prodX = Math.round((W - prodW) / 2);
      const prodY = Math.round(H * 0.17);

      layers.push({
        id: id('headline'), name: 'Headline', type: 'TEXT',
        x: margin, y: Math.round(H * 0.05),
        width: W - margin * 2, height: headlineSize * 2,
        content: headline,
        style: { fontFamily: primaryFont, fontWeight: 700, fontSize: headlineSize, color: textColor, textAlign: 'center' },
      });
      layers.push({ id: id('product'), name: 'Product Image', type: 'IMAGE', x: prodX, y: prodY, width: prodW, height: prodH });
      pushCTA(ctaCenterX(), ctaBottomY(), ctaBtnW, secondaryColor, textDark);
      break;
    }
  }

  return layers;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildLayoutFromStrategy — deterministic, no extra API calls
// ─────────────────────────────────────────────────────────────────────────────
function buildLayoutFromStrategy(strategy, brand, aspectRatio, adId) {
  const canvas = CANVAS_SIZES[aspectRatio] || CANVAS_SIZES.square;
  const { width: W, height: H } = canvas;

  const margin = Math.round(W * 0.056);
  const padding = Math.round(margin * 0.5);

  const primaryColor   = brand.primary_color   || '#5b6af0';
  const secondaryColor = brand.secondary_color || '#ffffff';
  const textPrimary    = '#ffffff';
  const textDark       = '#1a1a1a';

  const colorStrategy = (strategy?.color_strategy || '').toLowerCase();
  const layoutType    = strategy?.layout_type || 'product_focus';
  const isDarkBg      = colorStrategy.includes('dark') || layoutType === 'text_overlay' || layoutType === 'lifestyle';
  const textColor     = isDarkBg ? textPrimary : textDark;

  const primaryFont   = brand.primary_font   || 'Inter';
  const secondaryFont = brand.secondary_font || primaryFont;

  const headlineSize = Math.round(W * 0.059);
  const bodySize     = Math.round(W * 0.028);
  const ctaSize      = Math.round(W * 0.026);

  // Extract text content from strategy text_zones or use placeholders
  let headline    = 'Your Headline Here';
  let subheadline = '';
  const cta = brand.offer_cta || 'Shop Now';

  if (strategy?.text_zones) {
    const zones = Array.isArray(strategy.text_zones) ? strategy.text_zones : [];
    if (zones[0]) headline    = zones[0];
    if (zones[1]) subheadline = zones[1];
  }

  const layers = buildLayers({
    W, H, margin, padding,
    primaryColor, secondaryColor, textColor, textPrimary, textDark,
    primaryFont, secondaryFont,
    headlineSize, bodySize, ctaSize,
    headline, subheadline, cta,
    layoutType,
  });

  return {
    version: '1.0',
    schema:  'creative-layout',
    figma_exportable: true,
    meta: {
      ad_id:        adId,
      brand_name:   brand.name || '',
      layout_type:  layoutType,
      aspect_ratio: aspectRatio,
    },
    canvas: { width: W, height: H },
    design_tokens: {
      colors: {
        primary:        primaryColor,
        secondary:      secondaryColor,
        text_primary:   textColor,
        cta_background: primaryColor,
        cta_text:       textPrimary,
      },
      typography: {
        headline: { family: primaryFont,   weight: 700, size: headlineSize },
        body:     { family: secondaryFont, weight: 400, size: bodySize },
        cta:      { family: primaryFont,   weight: 600, size: ctaSize },
      },
      spacing: {
        margin,
        padding,
        gap: Math.round(margin * 0.27),
      },
    },
    layers,
    creative_intelligence: {
      layout_type:      layoutType,
      composition:      strategy?.composition      || '',
      visual_structure: strategy?.visual_structure || '',
      color_strategy:   strategy?.color_strategy   || '',
      ad_energy:        strategy?.ad_energy        || '',
      cta_position:     strategy?.cta_position     || '',
      enhanced_prompt:  strategy?.enhanced_prompt  || '',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 — AI vision analysis: reconstruct actual generated ad as editable layers
// ─────────────────────────────────────────────────────────────────────────────

function _visionPrompt(W, H) {
  return `You are reconstructing this advertisement image (${W}×${H}px) for Figma editing.

Your job: identify EVERY visible element and return accurate pixel bounding boxes so these layers can be placed directly over the original image in Figma.

Return ONLY valid JSON, no markdown fences, no explanation:
{
  "layers": [ ...ordered bottom to top (background first, foreground last)... ]
}

Use exactly these three layer types:

TEXT — for every piece of visible text (headline, subheadline, body copy, CTA label, price, badge, bullet point, any other text):
{
  "type": "TEXT",
  "name": "Headline" | "Subheadline" | "CTA Text" | "Benefit 1" | "Price" | etc.,
  "text": "<exact visible string — do not paraphrase or summarise>",
  "x": <int px from left>, "y": <int px from top>, "width": <int px>, "height": <int px>,
  "font_size": <int pt>,
  "font_weight": 400 | 700,
  "color": "#rrggbb",
  "alignment": "left" | "center" | "right"
}

IMAGE_REGION — for product photos, person/model images, lifestyle photos, logo areas:
{
  "type": "IMAGE_REGION",
  "name": "Product Image" | "Person Photo" | "Logo" | "Lifestyle Photo" | etc.,
  "role": "product" | "person" | "logo" | "lifestyle",
  "x": <int>, "y": <int>, "width": <int>, "height": <int>
}

RECTANGLE — for background fills, colored panels, overlays, CTA button backgrounds, dividers, decorative shapes:
{
  "type": "RECTANGLE",
  "name": "Background" | "CTA Button" | "Overlay" | "Panel" | "Divider" | etc.,
  "x": <int>, "y": <int>, "width": <int>, "height": <int>,
  "fill": "#rrggbb",
  "opacity": <float 0.0–1.0>,
  "border_radius": <int px>
}

Rules:
- Extract EVERY piece of visible text. Do not skip any string, even if small.
- Background: one RECTANGLE covering full ${W}×${H}, fill = dominant background color.
- Semi-transparent overlay: RECTANGLE with opacity 0.3–0.6, fill "#000000" or detected color.
- CTA button: RECTANGLE (button background) + TEXT (button label) as separate layers.
- Text bounding boxes must TIGHTLY wrap the visible text — not padded or approximate.
- IMAGE_REGION bounding boxes should cover the full visible photo/image area.
- Logo: IMAGE_REGION with role "logo", tight bounding box around the logo area.
- All coordinates in the ${W}×${H}px canvas. x + width ≤ ${W}, y + height ≤ ${H}.
- Order layers: background first (z=0), then panels/overlays, then images, then text, CTA last.`;
}

function _normalizeLayer(layer, W, H) {
  const type = String(layer.type || 'RECTANGLE').toUpperCase();
  const x      = Math.max(0, Math.min(W - 1, Math.round(Number(layer.x)    || 0)));
  const y      = Math.max(0, Math.min(H - 1, Math.round(Number(layer.y)    || 0)));
  const width  = Math.max(1, Math.min(W - x,  Math.round(Number(layer.width)  || 100)));
  const height = Math.max(1, Math.min(H - y,  Math.round(Number(layer.height) || 40)));

  const base = {
    id:   `v2_${Math.random().toString(36).slice(2, 9)}`,
    type,
    name: String(layer.name || type),
    role: String(layer.role || 'decorative'),
    x, y, width, height,
  };

  if (type === 'TEXT') {
    // Accept both new schema (font_size/font_weight/alignment) and old (fontSize/fontWeight/textAlign)
    const rawSize = Number(layer.font_size || layer.fontSize) || 32;
    base.content   = String(layer.text || layer.content || '');
    base.style = {
      fontFamily: 'Inter',
      fontWeight: Number(layer.font_weight || layer.fontWeight) || 400,
      fontSize:   Math.max(8, Math.min(300, rawSize)),
      color:      String(layer.color || '#000000'),
      textAlign:  String(layer.alignment || layer.textAlign || 'left'),
    };
  }

  if (type === 'RECTANGLE' || type === 'ELLIPSE') {
    let color = '#888888';
    if (layer.fill && typeof layer.fill === 'string') {
      // New reconstruction schema: flat "fill" string
      color = layer.fill;
    } else if (layer.fills && layer.fills[0]) {
      color = layer.fills[0].color || color;
    } else if (layer.color) {
      color = layer.color;
    }
    base.fills = [{ type: 'SOLID', color }];
    // Accept border_radius (new) or cornerRadius (old)
    const radius = layer.border_radius != null ? layer.border_radius : layer.cornerRadius;
    if (radius != null) base.cornerRadius = Math.max(0, Number(radius) || 0);
    if (layer.opacity != null) base.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
  }

  if (type === 'LINE') {
    base.fills        = [{ type: 'SOLID', color: String(layer.color || '#888888') }];
    base.strokeWeight = Math.max(1, Number(layer.strokeWeight) || 1);
    base.height       = Math.max(1, base.height);
  }

  // IMAGE_REGION — visual placeholder for product/person/logo areas
  if (type === 'IMAGE_REGION') {
    base.role = String(layer.role || 'product');
  }

  return base;
}

async function analyzeAdLayout(ad, brand) {
  const openai = getOpenAI();

  const rawMeta   = ad.metadata;
  const meta      = rawMeta ? (typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta) : {};
  const strategy  = meta.strategy || {};
  const aspectRatio = strategy.aspect_ratio || meta.aspect_ratio || 'square';
  const canvas    = CANVAS_SIZES[aspectRatio] || CANVAS_SIZES.square;
  const { width: W, height: H } = canvas;

  console.log(`[analyzeAdLayout] ad=${ad.id} canvas=${W}x${H} model=${VISION_MODEL()} mode=reconstruction`);

  const completion = await openai.chat.completions.create({
    model:    VISION_MODEL(),
    messages: [{
      role:    'user',
      content: [
        { type: 'image_url', image_url: { url: ad.image_url, detail: 'high' } },
        { type: 'text',      text: _visionPrompt(W, H) },
      ],
    }],
    response_format: { type: 'json_object' },
    max_tokens:  4000,
    temperature: 0.1,
  });

  const content = completion.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]+\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('Vision API returned non-JSON: ' + content.slice(0, 200));
  }

  const rawLayers = Array.isArray(parsed.layers) ? parsed.layers : [];
  if (!rawLayers.length) throw new Error('Vision analysis returned 0 layers');

  const layers = rawLayers.map(l => _normalizeLayer(l, W, H));

  return {
    version:          '2.1',
    schema:           'creative-layout',
    figma_exportable: true,
    export_mode:      'reconstruction',
    meta: {
      ad_id:        ad.id,
      brand_name:   brand.name || '',
      aspect_ratio: aspectRatio,
      analyzed_by:  VISION_MODEL(),
    },
    canvas:          { width: W, height: H },
    // reference_image injected by route after analysis (needs imageEndpointUrl)
    layers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB operations
// ─────────────────────────────────────────────────────────────────────────────

async function saveLayout(adId, layoutJson) {
  await query(
    `INSERT INTO creative_layouts (ad_id, layout_json, figma_exportable, version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ad_id) DO UPDATE
       SET layout_json      = EXCLUDED.layout_json,
           figma_exportable = EXCLUDED.figma_exportable,
           version          = EXCLUDED.version,
           updated_at       = NOW()`,
    [adId, JSON.stringify(layoutJson), layoutJson.figma_exportable ?? true, layoutJson.version || '1.0']
  );
}

async function getLayoutByAdId(adId) {
  const { rows } = await query(
    'SELECT * FROM creative_layouts WHERE ad_id = $1',
    [adId]
  );
  return rows[0] || null;
}

// ── Layout-First Editable Design (V4 — adflow-editable-design schema) ────────

async function saveLayoutFirstDesign(adId, layoutJson) {
  await query(
    `INSERT INTO creative_layouts
       (ad_id, layout_json, figma_exportable, version, source_mode, status)
     VALUES ($1, $2, true, $3, 'layout_first', 'draft')
     ON CONFLICT (ad_id) DO UPDATE
       SET layout_json  = EXCLUDED.layout_json,
           version      = EXCLUDED.version,
           source_mode  = 'layout_first',
           status       = 'draft',
           updated_at   = NOW()`,
    [adId, JSON.stringify(layoutJson), layoutJson.version || '1.0']
  );
}

async function getLayoutFirstDesign(adId) {
  const { rows } = await query(
    `SELECT layout_json, source_mode, status, created_at, updated_at
     FROM creative_layouts WHERE ad_id = $1 AND source_mode = 'layout_first'`,
    [adId]
  );
  return rows[0] || null;
}

async function saveEditableLayout(adId, editableJson) {
  await query(
    `UPDATE creative_layouts
     SET editable_json = $2, editable_analyzed_at = NOW(), updated_at = NOW()
     WHERE ad_id = $1`,
    [adId, JSON.stringify(editableJson)]
  );
}

async function getEditableLayout(adId) {
  const { rows } = await query(
    'SELECT editable_json, editable_analyzed_at FROM creative_layouts WHERE ad_id = $1',
    [adId]
  );
  return rows[0] || null;
}

async function saveBlueprintLayout(adId, blueprintJson) {
  await query(
    `UPDATE creative_layouts
     SET blueprint_json = $2, blueprint_analyzed_at = NOW(), updated_at = NOW()
     WHERE ad_id = $1`,
    [adId, JSON.stringify(blueprintJson)]
  );
}

async function getBlueprintLayout(adId) {
  const { rows } = await query(
    'SELECT blueprint_json, blueprint_analyzed_at FROM creative_layouts WHERE ad_id = $1',
    [adId]
  );
  return rows[0] || null;
}

module.exports = {
  buildLayoutFromStrategy, saveLayout, getLayoutByAdId,
  saveEditableLayout, getEditableLayout, analyzeAdLayout,
  saveBlueprintLayout, getBlueprintLayout,
  saveLayoutFirstDesign, getLayoutFirstDesign,
};
