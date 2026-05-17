/**
 * generationService
 *
 * Pipeline for Remix Mode image generation:
 *   1. Load brand context from DB
 *   2. promptComposerService — gpt-4.1-mini analyzes reference + product images,
 *      returns structured creative strategy + enhanced_prompt
 *   3. OPENAI_IMAGE_MODEL (default: gpt-image-2) — generates the ad
 *   4. Save PNG to disk, insert generated_ads row, return result
 *
 * promptComposerService is optional: if OPENAI_API_KEY is missing or the
 * analysis call fails, we fall back to a clean V1 baseline prompt so
 * generation always completes.
 */

const OpenAI     = require('openai');
const { toFile } = require('openai');
const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const { query }    = require('../db');
const { AppError } = require('../utils/errors');
const { GENERATED_DIR } = require('../utils/paths');
const { composeCreativeStrategy } = require('./promptComposerService');
const { getRelevantMemoriesForBrand, formatMemoryContext } = require('./brandMemoryService');

// Lazy-init — safe to load without OPENAI_API_KEY at startup
let _openai = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY is not configured on the server', 500);
  }
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SIZE_MAP = {
  square:    '1024x1024',
  portrait:  '1024x1536',
  landscape: '1536x1024',
};

// Speed mode configuration — model and concurrency scale with quality preference
const SPEED_CONFIGS = {
  fast_draft: {
    model:       () => process.env.OPENAI_IMAGE_MODEL_FAST    || 'gpt-image-1',
    concurrency: 3,
    promptStyle: 'draft',   // shorter prompt from composer
  },
  balanced: {
    model:       () => process.env.OPENAI_IMAGE_MODEL_BALANCED || 'gpt-image-1',
    concurrency: 2,
    promptStyle: 'balanced',
  },
  best_quality: {
    model:       () => process.env.OPENAI_IMAGE_MODEL_QUALITY  || 'gpt-image-2',
    concurrency: 2,
    promptStyle: 'quality', // richer prompt from composer
  },
};

function getSpeedConfig(speedMode) {
  return SPEED_CONFIGS[speedMode] || SPEED_CONFIGS.balanced;
}

// Legacy helper kept for remixGenerate (single-image path, not used in production UI)
const imageModel = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

// V1 baseline — used when prompt composer is unavailable or fails
function buildBaselinePrompt(brand, instructions) {
  return [
    'Create a high-converting, modern Meta advertisement creative.',
    '- Polished composition with strong visual hierarchy',
    '- Modern ecommerce aesthetic with professional clean design',
    '- Suitable for Meta / Facebook / Instagram feed placement',
    '- Incorporate the product from the second image as the hero visual',
    '- Match the layout and energy from the reference ad in the first image',
    '- Do NOT copy any text, logos, or faces from the reference',
    brand.name          && `Brand: ${brand.name}`,
    brand.industry      && `Industry: ${brand.industry}`,
    brand.primary_color && `Brand primary color: ${brand.primary_color}`,
    brand.primary_font  && `Typography: ${brand.primary_font} font family feel`,
    brand.headline_style && `Headline style: ${brand.headline_style}`,
    brand.typography_personality && `Typography personality: ${brand.typography_personality}`,
    instructions        && `User instructions: ${instructions}`,
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// remixGenerate — main entry point called by the route
// ─────────────────────────────────────────────────────────────────────────────
async function remixGenerate({
  brandId,
  referenceImagePath,
  productImagePath,
  referenceImageMime,
  productImageMime,
  instructions,
  aspectRatio,
}) {
  const openai = getOpenAI();

  // ── 1. Brand context ──────────────────────────────────────────────────────
  const { rows: brandRows } = await query(
    `SELECT id, name, industry, description, primary_color, secondary_color,
            primary_font, secondary_font, headline_style, typography_personality
     FROM brands WHERE id = $1`,
    [brandId]
  );
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const brand = brandRows[0];

  // ── 2. Prompt composer (OpenAI vision analysis) ───────────────────────────
  let strategy    = null;
  let finalPrompt = null;
  let composerUsed = false;

  try {
    strategy = await composeCreativeStrategy({
      openai,
      brand,
      referenceImagePath,
      referenceImageMime,
      productImagePath,
      productImageMime,
      instructions,
      aspectRatio,
    });
    finalPrompt  = strategy.enhanced_prompt;
    composerUsed = true;
  } catch (composerErr) {
    // Non-fatal: fall back to baseline so the user still gets an image
    console.warn(
      '[promptComposer] analysis failed — falling back to baseline prompt:',
      composerErr.message
    );
  }

  if (!finalPrompt) {
    finalPrompt = buildBaselinePrompt(brand, instructions);
  }

  // Prepend image-role context so the image model knows which file is which
  const imageContextHeader = composerUsed
    ? '[Image 1 = reference ad for layout/style. Image 2 = product to feature.]\n\n'
    : '';
  const promptForOpenAI = imageContextHeader + finalPrompt;

  // ── 3. Image generation ───────────────────────────────────────────────────
  const model = imageModel();
  const size  = SIZE_MAP[aspectRatio] || '1024x1024';

  const [refFile, prodFile] = await Promise.all([
    toFile(fs.createReadStream(referenceImagePath), 'reference.png', { type: referenceImageMime || 'image/png' }),
    toFile(fs.createReadStream(productImagePath),   'product.png',   { type: productImageMime   || 'image/png' }),
  ]);

  let openaiResponse;
  try {
    openaiResponse = await openai.images.edit({
      model,
      image:  [refFile, prodFile],
      prompt: promptForOpenAI,
      size,
      n: 1,
    });
  } catch (err) {
    // Capture the exact API error (model access, quota, content policy, etc.)
    const detail = err?.error?.message || err?.message || 'Unknown OpenAI error';
    const status = err?.status || err?.statusCode || 502;
    console.error(`[generationService] image generation failed (model=${model}):`, detail);
    throw new AppError(`Image generation failed (${model}): ${detail}`, status);
  }

  const b64 = openaiResponse.data?.[0]?.b64_json;
  if (!b64) throw new AppError('OpenAI returned no image data', 502);

  // ── 4. Persist image + DB record ──────────────────────────────────────────
  const filename  = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const savedPath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(savedPath, Buffer.from(b64, 'base64'));

  const imageUrl      = `/uploads/generated/${filename}`;
  const imageFilePath = `server/uploads/generated/${filename}`;
  const adFormat      = aspectRatio === 'portrait' ? 'story'
                      : aspectRatio === 'landscape' ? 'landscape'
                      : 'single_image';

  // Full creative strategy stored in metadata for debugging and future reuse
  const metadataPayload = {
    mode:          'remix',
    composer_used: composerUsed,
    instructions:  instructions || null,
    strategy:      strategy || null,   // full structured JSON from promptComposer
  };

  const { rows } = await query(
    `INSERT INTO generated_ads
       (brand_id, image_prompt, image_url, image_file_path,
        platform, ad_format, ai_model, generation_params, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      brandId,
      promptForOpenAI,
      imageUrl,
      imageFilePath,
      'meta',
      adFormat,
      composerUsed ? `gpt-4.1-mini + ${model}` : model,
      JSON.stringify({ aspect_ratio: aspectRatio, size, mode: 'remix', composer_used: composerUsed, image_model: model }),
      'draft',
      JSON.stringify(metadataPayload),
    ]
  );

  return {
    ad:             rows[0],
    imageUrl,
    creativeStrategy: strategy
      ? {
          composerUsed,
          imageModel: model,
          layout_type:         strategy.layout_type,
          composition:         strategy.composition,
          visual_structure:    strategy.visual_structure,
          text_zones:          strategy.text_zones,
          cta_position:        strategy.cta_position,
          typography_style:    strategy.typography_style,
          color_strategy:      strategy.color_strategy,
          product_strategy:    strategy.product_strategy,
          human_archetypes:    strategy.human_archetypes,
          archetype_protection:strategy.archetype_protection,
          ad_energy:           strategy.ad_energy,
          creative_strategy:   strategy.creative_strategy,
          enhanced_prompt:     strategy.enhanced_prompt,
        }
      : { composerUsed: false, imageModel: model, enhanced_prompt: finalPrompt },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk generation helpers
// ─────────────────────────────────────────────────────────────────────────────

const VARIATION_DIRECTIVES = [
  'Variation 1: Clean premium version — refined, minimal, high-end execution of the reference layout.',
  'Variation 2: Bold direct-response version — stronger contrast, bigger typography, urgent CTA, high-impact visual.',
  'Variation 3: Lifestyle-forward version — warmer, human-centered scene, emotional storytelling.',
  'Variation 4: Minimalist product-focus version — clean white/light background, product hero shot, sparse design.',
  'Variation 5: Color-pop experimental version — bolder brand color usage, energetic palette, eye-catching modern style.',
];

// Worker-pool concurrency: spawn `limit` workers, each grabs tasks from a shared index
// onEach(result) fires immediately when each task completes (success or failure)
async function runWithConcurrency(tasks, limit, onEach) {
  const results = new Array(tasks.length).fill(null);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = await tasks[idx]();
        if (onEach) onEach({ success: true, index: idx, result: results[idx] });
      } catch (err) {
        results[idx] = { failed: true, error: err.message || String(err) };
        if (onEach) onEach({ success: false, index: idx, error: results[idx].error });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  );
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// remixGenerateBatch — generate 1–5 variations with concurrency limit of 2
// Prompt composer runs ONCE; per-variation directive appended to each prompt
// ─────────────────────────────────────────────────────────────────────────────
async function remixGenerateBatch({
  brandId,
  referenceImagePath,
  productImagePath,
  referenceImageMime,
  productImageMime,
  instructions,
  aspectRatio,
  count,
  speedMode = 'balanced',
}) {
  const openai     = getOpenAI();
  const batchId    = crypto.randomUUID();
  const n          = Math.max(1, Math.min(5, parseInt(count, 10) || 1));
  const speedCfg   = getSpeedConfig(speedMode);
  const batchStart = Date.now();

  // ── 1. Brand context ──────────────────────────────────────────────────────
  const { rows: brandRows } = await query(
    `SELECT id, name, industry, description, primary_color, secondary_color,
            primary_font, secondary_font, headline_style, typography_personality
     FROM brands WHERE id = $1`,
    [brandId]
  );
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const brand = brandRows[0];

  // ── 2. Brand memory context — fetched once, injected into prompt composer ──
  let memoryContext = null;
  try {
    const { memories, angles } = await getRelevantMemoriesForBrand(brandId);
    memoryContext = formatMemoryContext(memories, angles);
  } catch (memErr) {
    console.warn('[brandMemory] could not fetch memory:', memErr.message);
  }

  // ── 3. Prompt composer — runs ONCE for the whole batch ───────────────────
  let strategy     = null;
  let basePrompt   = null;
  let composerUsed = false;

  try {
    strategy = await composeCreativeStrategy({
      openai, brand,
      referenceImagePath, referenceImageMime,
      productImagePath,   productImageMime,
      instructions, aspectRatio,
      promptStyle:   speedCfg.promptStyle,
      memoryContext,
    });
    basePrompt   = strategy.enhanced_prompt;
    composerUsed = true;
  } catch (composerErr) {
    console.warn(
      '[promptComposer] batch analysis failed — falling back to baseline:',
      composerErr.message
    );
  }

  if (!basePrompt) {
    basePrompt = buildBaselinePrompt(brand, instructions);
  }

  const imageContextHeader = composerUsed
    ? '[Image 1 = reference ad for layout/style. Image 2 = product to feature.]\n\n'
    : '';

  const model    = speedCfg.model();
  const size     = SIZE_MAP[aspectRatio] || '1024x1024';
  const adFormat = aspectRatio === 'portrait'  ? 'story'
                 : aspectRatio === 'landscape' ? 'landscape'
                 : 'single_image';

  // ── 3. Per-variation image generation tasks ───────────────────────────────
  const tasks = Array.from({ length: n }, (_, i) => async () => {
    const variationSuffix = n > 1 ? `\n\n${VARIATION_DIRECTIVES[i]}` : '';
    const prompt = imageContextHeader + basePrompt + variationSuffix;

    const [refFile, prodFile] = await Promise.all([
      toFile(fs.createReadStream(referenceImagePath), 'reference.png', { type: referenceImageMime || 'image/png' }),
      toFile(fs.createReadStream(productImagePath),   'product.png',   { type: productImageMime   || 'image/png' }),
    ]);

    let openaiResponse;
    try {
      openaiResponse = await openai.images.edit({
        model,
        image:  [refFile, prodFile],
        prompt,
        size,
        n: 1,
      });
    } catch (err) {
      const detail = err?.error?.message || err?.message || 'Unknown OpenAI error';
      const status = err?.status || err?.statusCode || 502;
      console.error(`[generationService] batch variation ${i + 1} failed (model=${model}):`, detail);
      throw new AppError(`Image generation failed (${model}): ${detail}`, status);
    }

    const b64 = openaiResponse.data?.[0]?.b64_json;
    if (!b64) throw new AppError('OpenAI returned no image data', 502);

    const filename     = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const savedPath    = path.join(GENERATED_DIR, filename);
    fs.writeFileSync(savedPath, Buffer.from(b64, 'base64'));

    const imageUrl      = `/uploads/generated/${filename}`;
    const imageFilePath = `server/uploads/generated/${filename}`;

    const metadataPayload = {
      mode:               'remix',
      composer_used:      composerUsed,
      instructions:       instructions || null,
      strategy:           strategy || null,
      batch_id:           batchId,
      variation_index:    i + 1,
      variation_directive: n > 1 ? VARIATION_DIRECTIVES[i] : null,
      speed_mode:         speedMode,
      image_model:        model,
      concurrency:        speedCfg.concurrency,
    };

    const { rows } = await query(
      `INSERT INTO generated_ads
         (brand_id, image_prompt, image_url, image_file_path,
          platform, ad_format, ai_model, generation_params, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        brandId, prompt, imageUrl, imageFilePath,
        'meta', adFormat,
        composerUsed ? `gpt-4.1-mini + ${model}` : model,
        JSON.stringify({ aspect_ratio: aspectRatio, size, mode: 'remix', batch_id: batchId, variation_index: i + 1, composer_used: composerUsed, image_model: model, speed_mode: speedMode }),
        'draft',
        JSON.stringify(metadataPayload),
      ]
    );

    return {
      ad:             rows[0],
      imageUrl,
      variationIndex: i + 1,
    };
  });

  // ── 4. Run with speed-mode concurrency ───────────────────────────────────
  const rawResults = await runWithConcurrency(tasks, speedCfg.concurrency);

  const creativeStrategy = strategy
    ? {
        composerUsed,
        imageModel:           model,
        layout_type:          strategy.layout_type,
        composition:          strategy.composition,
        visual_structure:     strategy.visual_structure,
        text_zones:           strategy.text_zones,
        cta_position:         strategy.cta_position,
        typography_style:     strategy.typography_style,
        color_strategy:       strategy.color_strategy,
        product_strategy:     strategy.product_strategy,
        human_archetypes:     strategy.human_archetypes,
        archetype_protection: strategy.archetype_protection,
        ad_energy:            strategy.ad_energy,
        creative_strategy:    strategy.creative_strategy,
        enhanced_prompt:      strategy.enhanced_prompt,
      }
    : { composerUsed: false, imageModel: model, enhanced_prompt: basePrompt };

  return {
    batch_id:                      batchId,
    count:                         n,
    speed_mode:                    speedMode,
    actual_generation_time_seconds: (Date.now() - batchStart) / 1000,
    results:  rawResults.map((r, i) =>
      r && r.failed
        ? { success: false, variationIndex: i + 1, error: r.error }
        : { success: true, ...r }
    ),
    creativeStrategy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// remixGenerateBatchStream
//
// Same pipeline as remixGenerateBatch but fires onProgress(result) immediately
// when each image completes — used by the SSE endpoint for live board updates.
// Supports up to 20 images (for large concept-mode runs).
// ─────────────────────────────────────────────────────────────────────────────
async function remixGenerateBatchStream({
  brandId,
  referenceImagePath,
  productImagePath,
  referenceImageMime,
  productImageMime,
  instructions,
  aspectRatio,
  count,
  campaignId,
  speedMode = 'balanced',
  onProgress,
}) {
  const openai     = getOpenAI();
  const batchId    = crypto.randomUUID();
  const n          = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
  const speedCfg   = getSpeedConfig(speedMode);
  const batchStart = Date.now();

  const { rows: brandRows } = await query(
    `SELECT id, name, industry, description, primary_color, secondary_color,
            primary_font, secondary_font, headline_style, typography_personality
     FROM brands WHERE id = $1`,
    [brandId]
  );
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const brand = brandRows[0];

  let strategy     = null;
  let basePrompt   = null;
  let composerUsed = false;

  try {
    strategy = await composeCreativeStrategy({
      openai, brand,
      referenceImagePath, referenceImageMime,
      productImagePath,   productImageMime,
      instructions, aspectRatio,
      promptStyle: speedCfg.promptStyle,
    });
    basePrompt   = strategy.enhanced_prompt;
    composerUsed = true;
  } catch (composerErr) {
    console.warn('[promptComposer] stream batch failed — using baseline:', composerErr.message);
  }

  if (!basePrompt) basePrompt = buildBaselinePrompt(brand, instructions);

  const imageContextHeader = composerUsed
    ? '[Image 1 = reference ad for layout/style. Image 2 = product to feature.]\n\n'
    : '';

  const model    = speedCfg.model();
  const size     = SIZE_MAP[aspectRatio] || '1024x1024';
  const adFormat = aspectRatio === 'portrait'  ? 'story'
                 : aspectRatio === 'landscape' ? 'landscape'
                 : 'single_image';

  const tasks = Array.from({ length: n }, (_, i) => async () => {
    const variationSuffix = n > 1
      ? `\n\n${VARIATION_DIRECTIVES[i % VARIATION_DIRECTIVES.length]}`
      : '';
    const prompt = imageContextHeader + basePrompt + variationSuffix;

    const [refFile, prodFile] = await Promise.all([
      toFile(fs.createReadStream(referenceImagePath), 'reference.png', { type: referenceImageMime || 'image/png' }),
      toFile(fs.createReadStream(productImagePath),   'product.png',   { type: productImageMime   || 'image/png' }),
    ]);

    let openaiResponse;
    try {
      openaiResponse = await openai.images.edit({ model, image: [refFile, prodFile], prompt, size, n: 1 });
    } catch (err) {
      const detail = err?.error?.message || err?.message || 'Unknown OpenAI error';
      throw new AppError(`Image generation failed (${model}): ${detail}`, err?.status || 502);
    }

    const b64 = openaiResponse.data?.[0]?.b64_json;
    if (!b64) throw new AppError('OpenAI returned no image data', 502);

    const filename     = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    fs.writeFileSync(path.join(GENERATED_DIR, filename), Buffer.from(b64, 'base64'));

    const imageUrl      = `/uploads/generated/${filename}`;
    const imageFilePath = `server/uploads/generated/${filename}`;

    const metadataPayload = {
      mode:               'remix',
      composer_used:      composerUsed,
      instructions:       instructions || null,
      strategy:           strategy || null,
      batch_id:           batchId,
      variation_index:    i + 1,
      variation_directive: n > 1 ? VARIATION_DIRECTIVES[i % VARIATION_DIRECTIVES.length] : null,
      speed_mode:         speedMode,
      image_model:        model,
      concurrency:        speedCfg.concurrency,
    };

    const insertParams = [
      brandId, prompt, imageUrl, imageFilePath,
      'meta', adFormat,
      composerUsed ? `gpt-4.1-mini + ${model}` : model,
      JSON.stringify({ aspect_ratio: aspectRatio, size, mode: 'remix', batch_id: batchId, variation_index: i + 1, composer_used: composerUsed, image_model: model, speed_mode: speedMode }),
      'draft',
      JSON.stringify(metadataPayload),
    ];

    let sql, finalParams;
    if (campaignId) {
      sql = `INSERT INTO generated_ads
               (brand_id, image_prompt, image_url, image_file_path,
                platform, ad_format, ai_model, generation_params, status, metadata, campaign_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`;
      finalParams = [...insertParams, campaignId];
    } else {
      sql = `INSERT INTO generated_ads
               (brand_id, image_prompt, image_url, image_file_path,
                platform, ad_format, ai_model, generation_params, status, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`;
      finalParams = insertParams;
    }

    const { rows } = await query(sql, finalParams);
    return { ad: rows[0], imageUrl, variationIndex: i + 1 };
  });

  const creativeStrategy = strategy
    ? {
        composerUsed,
        imageModel:           model,
        layout_type:          strategy.layout_type,
        composition:          strategy.composition,
        visual_structure:     strategy.visual_structure,
        color_strategy:       strategy.color_strategy,
        ad_energy:            strategy.ad_energy,
        human_archetypes:     strategy.human_archetypes,
        archetype_protection: strategy.archetype_protection,
        creative_strategy:    strategy.creative_strategy,
        enhanced_prompt:      strategy.enhanced_prompt,
      }
    : { composerUsed: false, imageModel: model, enhanced_prompt: basePrompt };

  const rawResults = await runWithConcurrency(tasks, speedCfg.concurrency, (each) => {
    if (onProgress) {
      onProgress(each.success
        ? { type: 'progress', success: true,  ...each.result }
        : { type: 'progress', success: false, variationIndex: each.index + 1, error: each.error }
      );
    }
  });

  return {
    batch_id:                      batchId,
    count:                         n,
    speed_mode:                    speedMode,
    actual_generation_time_seconds: (Date.now() - batchStart) / 1000,
    results:  rawResults.map((r, i) =>
      r?.failed
        ? { success: false, variationIndex: i + 1, error: r.error }
        : { success: true, ...r }
    ),
    creativeStrategy,
  };
}

module.exports = { remixGenerate, remixGenerateBatch, remixGenerateBatchStream };
