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

const { query } = require('../db');

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

module.exports = { buildLayoutFromStrategy, saveLayout, getLayoutByAdId };
