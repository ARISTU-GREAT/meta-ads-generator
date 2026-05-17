/**
 * editableDesigns route
 *
 * POST /api/editable-designs/generate
 *   Generates an adflow-editable-design JSON from brand + concept context.
 *   Creates a generated_ads record (no image_url) and saves to creative_layouts
 *   with source_mode = 'layout_first'.
 *
 * GET  /api/editable-designs/:id
 *   Returns the adflow-editable-design JSON for a given ad, with image URLs
 *   expanded to full absolute URLs (for Figma plugin use).
 */

const express = require('express');
const router  = express.Router();
const { asyncHandler, AppError } = require('../utils/errors');
const { generateEditableDesign } = require('../services/editableDesignService');
const { saveLayoutFirstDesign, getLayoutFirstDesign } = require('../services/layoutService');
const { query } = require('../db');

const AD_FORMAT_FOR_RATIO = {
  square:    'feed_square',
  portrait:  'feed_portrait',
  landscape: 'feed_landscape',
};

// ── POST /api/editable-designs/generate ──────────────────────────────────────

router.post('/generate', asyncHandler(async (req, res) => {
  const {
    brand_id,
    campaign_id,
    concept_id,
    aspect_ratio     = 'square',
    strategy,        // object from concept plan
    instructions     = '',
    persona_id,
    product_asset_id,
    logo_asset_id,
  } = req.body;

  if (!brand_id) throw new AppError('brand_id is required', 400);

  // Load brand
  const { rows: brandRows } = await query(
    'SELECT * FROM brands WHERE id = $1 AND is_active = true',
    [brand_id]
  );
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const brand = brandRows[0];

  // Load persona if provided
  let persona = null;
  if (persona_id) {
    const { rows: personaRows } = await query(
      'SELECT * FROM brand_personas WHERE id = $1',
      [persona_id]
    );
    persona = personaRows[0] || null;
  }

  // Build public asset URLs — these are served by /api/assets/:id/image (public, no auth)
  const baseUrl         = `${req.protocol}://${req.get('host')}`;
  const productImageUrl = product_asset_id ? `${baseUrl}/api/assets/${product_asset_id}/image` : null;

  // Try brand's own logo asset if no explicit logo_asset_id
  let resolvedLogoAssetId = logo_asset_id || null;
  if (!resolvedLogoAssetId) {
    const { rows: logoRows } = await query(
      `SELECT id FROM brand_assets WHERE brand_id = $1 AND asset_type = 'logo' LIMIT 1`,
      [brand_id]
    );
    if (logoRows.length) resolvedLogoAssetId = logoRows[0].id;
  }
  const logoUrl = resolvedLogoAssetId ? `${baseUrl}/api/assets/${resolvedLogoAssetId}/image` : null;

  // Generate the layout JSON via AI
  let layoutJson;
  try {
    layoutJson = await generateEditableDesign({
      brand,
      aspectRatio: aspect_ratio,
      strategy:    typeof strategy === 'string' ? JSON.parse(strategy) : (strategy || null),
      instructions,
      persona,
      productImageUrl,
      logoUrl,
    });
  } catch (err) {
    console.error('[editableDesigns/generate] AI failed:', err.message);
    throw new AppError('Editable design generation failed: ' + err.message, 502);
  }

  // Create the generated_ads record (no image — layout is the source of truth)
  const metadataPayload = {
    source_mode:   'layout_first',
    aspect_ratio,
    instructions:  instructions || null,
    strategy:      strategy || null,
    preview_color: layoutJson.canvas.background || '#1a1a2e',
    concept_id:    concept_id || null,
  };

  const { rows: adRows } = await query(
    `INSERT INTO generated_ads
       (brand_id, image_prompt, image_url, platform, ad_format, ai_model,
        generation_params, status, metadata, campaign_id)
     VALUES ($1,$2,NULL,$3,$4,$5,$6,'draft',$7,$8)
     RETURNING *`,
    [
      brand_id,
      instructions || (strategy && typeof strategy === 'object' ? strategy.enhanced_prompt || '' : ''),
      'meta',
      AD_FORMAT_FOR_RATIO[aspect_ratio] || aspect_ratio,
      'editableDesignService',
      JSON.stringify({ aspect_ratio, source_mode: 'layout_first' }),
      JSON.stringify(metadataPayload),
      campaign_id || null,
    ]
  );
  const ad = adRows[0];

  // Save to creative_layouts with source_mode = 'layout_first'
  await saveLayoutFirstDesign(ad.id, layoutJson);

  res.status(201).json({
    success: true,
    data: {
      id:         ad.id,
      layout:     layoutJson,
      created_at: ad.created_at,
    },
  });
}));

// ── GET /api/editable-designs/:id ────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const design = await getLayoutFirstDesign(id);
  if (!design) throw new AppError('No editable design found for this ad', 404);

  let layoutJson = design.layout_json;

  // Expand relative image URLs to absolute for Figma plugin
  if (Array.isArray(layoutJson.layers)) {
    layoutJson = Object.assign({}, layoutJson, {
      layers: layoutJson.layers.map(l => {
        if (l.type === 'image' && l.imageUrl && l.imageUrl.startsWith('/')) {
          return Object.assign({}, l, { imageUrl: baseUrl + l.imageUrl });
        }
        return l;
      }),
    });
  }

  res.json({ success: true, data: layoutJson });
}));

module.exports = router;
