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
require('../utils/paths'); // ensures upload dirs are created on startup
const { composeCreativeStrategy } = require('./promptComposerService');
const { getRelevantMemoriesForBrand, formatMemoryContext } = require('./brandMemoryService');
const { buildLayoutFromStrategy, saveLayout } = require('./layoutService');
const { scoreGeneration, selectBest } = require('./validationService');
const { buildNegativeRulesBlock }     = require('../utils/promptUtils');
const { isGeminiAvailable, reviewCreativeStrategy } = require('./geminiReviewerService');

// Lazy-init — safe to load without OPENAI_API_KEY at startup
let _openai = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY is not configured on the server', 500);
  }
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ── Ratio maps ────────────────────────────────────────────────────────────────
// Translates user-facing ratio strings ("1:1", "4:5", etc.) → internal names.
const RATIO_ALIASES = {
  '1:1':      'square',
  '4:5':      'portrait',
  '9:16':     'story',
  '16:9':     'landscape',
  'square':   'square',
  'portrait': 'portrait',
  'story':    'story',
  'landscape':'landscape',
};

// Internal name → OpenAI size string
const SIZE_MAP = {
  square:    '1024x1024',
  portrait:  '1024x1536',
  story:     '1024x1536', // 9:16 — closest supported size; generated taller portrait
  landscape: '1536x1024',
};

// Internal name → display label shown in UI / metadata
const RATIO_DISPLAY = {
  square:   '1:1',
  portrait: '4:5',
  story:    '9:16',
  landscape:'16:9',
};

// Normalize an array of ratio values (user-facing or internal) to known internal names
function normalizeRatios(input) {
  if (!input || !input.length) return ['square'];
  return input
    .map(r => RATIO_ALIASES[String(r).trim()] || null)
    .filter(r => r && SIZE_MAP[r]);
}

// Internal ratio name → ad_format column value
function ratioToAdFormat(ratio) {
  if (ratio === 'portrait' || ratio === 'story') return 'story';
  if (ratio === 'landscape') return 'landscape';
  return 'single_image';
}

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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Appended to every generation prompt — enforces exact product reproduction
const PRODUCT_FIDELITY_SUFFIX = `

[PRODUCT FIDELITY — MANDATORY]
The product shown in the product reference image MUST be reproduced EXACTLY:
• Identical shape, proportions, packaging design, colors, label text, and surface finish
• Feature as the clear hero element — prominent, in sharp focus, photo-realistic detail
• Exactly ONE product unit — never add duplicate copies floating in background or scene
• Every visible packaging detail must match the reference precisely
FORBIDDEN: changed product shape, altered labels or brand text, extra product copies, generic substitutions`;

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
  // Store as data URL so images are browser-accessible on any deployment
  // (Vercel has an ephemeral filesystem; data URLs work everywhere)
  const imageUrl = `data:image/png;base64,${b64}`;
  const adFormat = aspectRatio === 'portrait' ? 'story'
                 : aspectRatio === 'landscape' ? 'landscape'
                 : 'single_image';

  const metadataPayload = {
    mode:          'remix',
    composer_used: composerUsed,
    instructions:  instructions || null,
    strategy:      strategy || null,
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
      null,
      'meta',
      adFormat,
      composerUsed ? `gpt-4.1-mini + ${model}` : model,
      JSON.stringify({ aspect_ratio: aspectRatio, size, mode: 'remix', composer_used: composerUsed, image_model: model }),
      'draft',
      JSON.stringify(metadataPayload),
    ]
  );

  const ad = rows[0];

  // Save creative layout non-blocking — never fails the generation
  try {
    const layoutJson = buildLayoutFromStrategy(strategy, brand, aspectRatio, ad.id);
    await saveLayout(ad.id, layoutJson);
  } catch (layoutErr) {
    console.warn('[layoutService] layout save failed for ad', ad.id, ':', layoutErr.message);
  }

  return {
    ad,
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
  'Variation 1: Clean premium version — refined, minimal, high-end execution of the reference layout. The product must remain the exact unchanged hero, photographically accurate.',
  'Variation 2: Bold direct-response version — stronger contrast, bigger typography, urgent CTA. Feature the same product from the reference with complete packaging fidelity.',
  'Variation 3: Lifestyle-forward version — warmer, human-centered scene, emotional storytelling. The exact product must appear as photographed — same packaging, same finish.',
  'Variation 4: Minimalist product-focus version — clean white/light background, pure product hero shot, sparse design. Reproduce every product detail precisely.',
  'Variation 5: Color-pop experimental version — bolder brand color usage, energetic palette. Product packaging must match the reference exactly — no alterations.',
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

    const imageUrl = `data:image/png;base64,${b64}`;

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
        brandId, prompt, imageUrl, null,
        'meta', adFormat,
        composerUsed ? `gpt-4.1-mini + ${model}` : model,
        JSON.stringify({ aspect_ratio: aspectRatio, size, mode: 'remix', batch_id: batchId, variation_index: i + 1, composer_used: composerUsed, image_model: model, speed_mode: speedMode }),
        'draft',
        JSON.stringify(metadataPayload),
      ]
    );

    const batchAd = rows[0];

    // Save layout non-blocking
    try {
      const layoutJson = buildLayoutFromStrategy(strategy, brand, aspectRatio, batchAd.id);
      await saveLayout(batchAd.id, layoutJson);
    } catch (layoutErr) {
      console.warn('[layoutService] batch layout save failed for ad', batchAd.id, ':', layoutErr.message);
    }

    return {
      ad:             batchAd,
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
// Multi-generation pipeline:
//   1. Announces all slots as "queued" via SSE immediately
//   2. Generates images with per-slot concurrency, retrying up to 2× on failure
//      with exponential backoff (2 s, 4 s)
//   3. Fires SSE events: slot_queued → slot_processing → (slot_retrying) →
//      slot_completed | slot_failed
//   4. After all generation, scores completed images concurrently via GPT-4o
//      and fires slot_scored + best_selected
//   5. Also fires legacy "progress" events for backward compat with concepts flow
// ─────────────────────────────────────────────────────────────────────────────
async function remixGenerateBatchStream({
  brandId,
  referenceImagePath,
  productImagePath,
  referenceImageMime,
  productImageMime,
  instructions,
  avoidInstructions = '',
  aspectRatio,        // legacy single-ratio (backward compat)
  aspectRatios,       // new: array of ratios ["1:1","4:5",...]
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
  const MAX_RETRIES = 2;

  // Resolve which ratios to generate
  let ratios;
  if (aspectRatios && aspectRatios.length > 0) {
    ratios = normalizeRatios(aspectRatios);
  } else {
    ratios = normalizeRatios([aspectRatio || 'square']);
  }
  if (!ratios.length) ratios = ['square'];

  const totalSlots = n * ratios.length; // e.g. 5 × 3 = 15

  const emit = (event) => { if (onProgress) onProgress(event); };

  // ── 1. Brand context ──────────────────────────────────────────────────────
  const { rows: brandRows } = await query(
    `SELECT id, name, industry, description, primary_color, secondary_color,
            primary_font, secondary_font, headline_style, typography_personality
     FROM brands WHERE id = $1`,
    [brandId]
  );
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const brand = brandRows[0];

  // ── 2. Prompt composer — runs ONCE for the whole batch ───────────────────
  let strategy     = null;
  let basePrompt   = null;
  let composerUsed = false;

  try {
    strategy = await composeCreativeStrategy({
      openai, brand,
      referenceImagePath, referenceImageMime,
      productImagePath,   productImageMime,
      instructions, avoidInstructions,
      aspectRatio: ratios[0], // use primary ratio for strategy composition
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

  // ── 3. Optional Gemini creative review ───────────────────────────────────
  let geminiContext = null;
  if (isGeminiAvailable()) {
    try {
      geminiContext = await reviewCreativeStrategy({ brand, strategy, ratios, instructions, avoidInstructions });
      if (geminiContext) {
        console.log('[generationService] Gemini creative review applied.');
        emit({ type: 'gemini_context', providers: { reviewer: 'gemini' } });
      }
    } catch (geminiErr) {
      console.warn('[generationService] Gemini reviewer failed (non-fatal):', geminiErr.message);
    }
  }

  const model = speedCfg.model();

  // ── 4. Announce all slots as queued ──────────────────────────────────────
  // Slot numbering: ratioIndex * n + variationIndex
  // e.g. n=5, ratios=['square','portrait']: slots 0-4 = square, slots 5-9 = portrait
  for (let ri = 0; ri < ratios.length; ri++) {
    for (let vi = 0; vi < n; vi++) {
      const slot = ri * n + vi;
      emit({ type: 'slot_queued', slot, total: totalSlots, ratio: ratios[ri], variation: vi });
    }
  }

  // ── 5. Per-slot generation function (pure, throws on failure) ────────────
  async function generateSlot(slot) {
    const ratioIndex    = Math.floor(slot / n);
    const variationIdx  = slot % n;
    const ratio         = ratios[ratioIndex];
    const size          = SIZE_MAP[ratio] || '1024x1024';
    const adFormat      = ratioToAdFormat(ratio);
    const ratioLabel    = RATIO_DISPLAY[ratio] || ratio;

    const variationSuffix = n > 1
      ? `\n\n${VARIATION_DIRECTIVES[variationIdx % VARIATION_DIRECTIVES.length]}`
      : '';

    // Add ratio-specific composition note from Gemini if available
    const ratioNote = geminiContext?.ratio_notes?.[ratio]
      ? `\n\n[COMPOSITION FOR ${ratioLabel}]: ${geminiContext.ratio_notes[ratio]}`
      : '';

    const prompt = imageContextHeader + basePrompt + variationSuffix + ratioNote
      + buildNegativeRulesBlock(avoidInstructions) + PRODUCT_FIDELITY_SUFFIX;

    const [refFile, prodFile] = await Promise.all([
      toFile(fs.createReadStream(referenceImagePath), 'reference.png', { type: referenceImageMime || 'image/png' }),
      toFile(fs.createReadStream(productImagePath),   'product.png',   { type: productImageMime   || 'image/png' }),
    ]);

    console.log('[generationService] slot', slot, '— calling OpenAI image edit:', { model, size, ratio, variationIdx });

    let openaiResponse;
    try {
      openaiResponse = await openai.images.edit({ model, image: [refFile, prodFile], prompt, size, n: 1 });
    } catch (err) {
      const detail = err && err.error && err.error.message
        ? err.error.message
        : (err && err.message) || 'Unknown OpenAI error';
      console.error('[generationService] slot', slot, 'OpenAI failed:', { model, detail, status: err && err.status });
      throw new AppError(`Image generation failed (${model}): ${detail}`, (err && err.status) || 502);
    }

    const b64 = openaiResponse.data && openaiResponse.data[0] && openaiResponse.data[0].b64_json;
    if (!b64) throw new AppError('OpenAI returned no image data', 502);

    const imageUrl = `data:image/png;base64,${b64}`;

    const metadataPayload = {
      mode:               'remix',
      aspect_ratio:       ratio,
      ratio_display:      ratioLabel,
      ratio_group_id:     batchId,
      variation_index:    variationIdx + 1,
      composer_used:      composerUsed,
      instructions:       instructions || null,
      avoid_instructions: avoidInstructions || null,
      strategy:           strategy || null,
      batch_id:           batchId,
      variation_directive: n > 1 ? VARIATION_DIRECTIVES[variationIdx % VARIATION_DIRECTIVES.length] : null,
      speed_mode:         speedMode,
      image_model:        model,
      providers: {
        strategy:  composerUsed  ? 'openai' : 'baseline',
        reviewer:  geminiContext  ? 'gemini' : null,
        blueprint: 'claude',
        image:     'openai',
      },
    };

    const insertParams = [
      brandId, prompt, imageUrl, null,
      'meta', adFormat,
      composerUsed ? `gpt-4.1-mini + ${model}` : model,
      JSON.stringify({
        aspect_ratio:    ratio,
        ratio_display:   ratioLabel,
        size,
        mode:            'remix',
        batch_id:        batchId,
        variation_index: variationIdx + 1,
        composer_used:   composerUsed,
        image_model:     model,
        speed_mode:      speedMode,
      }),
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
    const streamAd = rows[0];

    // Layout save — non-blocking, never fails the pipeline
    try {
      const layoutJson = buildLayoutFromStrategy(strategy, brand, ratio, streamAd.id);
      await saveLayout(streamAd.id, layoutJson);
    } catch (layoutErr) {
      console.warn('[layoutService] stream layout save failed for ad', streamAd.id, ':', layoutErr.message);
    }

    return { ad: streamAd, imageUrl, variationIndex: variationIdx + 1, ratio, b64 };
  }

  // ── 6. Concurrent slot workers with retry + exponential backoff ──────────
  const slotResults = new Array(totalSlots).fill(null);
  let nextSlot = 0;

  async function slotWorker() {
    while (nextSlot < totalSlots) {
      const slot = nextSlot++;
      const ratioIndex   = Math.floor(slot / n);
      const variationIdx = slot % n;
      const ratio        = ratios[ratioIndex];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt === 0) {
          emit({ type: 'slot_processing', slot, ratio, variation: variationIdx });
        } else {
          const delayMs = Math.pow(2, attempt - 1) * 2000;
          emit({ type: 'slot_retrying', slot, attempt, delay_ms: delayMs, ratio, variation: variationIdx });
          await sleep(delayMs);
        }

        try {
          const result      = await generateSlot(slot);
          slotResults[slot] = result;

          emit({ type: 'slot_completed', slot, ad: result.ad, imageUrl: result.imageUrl, variationIndex: result.variationIndex, ratio: result.ratio });
          emit({ type: 'progress', success: true, ad: result.ad, imageUrl: result.imageUrl, variationIndex: result.variationIndex });
          break;
        } catch (err) {
          console.warn(`[generationService] slot ${slot} (ratio=${ratio}) attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${err.message}`);

          if (attempt === MAX_RETRIES) {
            slotResults[slot] = { failed: true, error: err.message || String(err), attempts: attempt + 1 };
            emit({ type: 'slot_failed', slot, error: slotResults[slot].error, attempts: attempt + 1, ratio, variation: variationIdx });
            emit({ type: 'progress', success: false, variationIndex: variationIdx + 1, error: slotResults[slot].error });
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(speedCfg.concurrency, totalSlots) }, () => slotWorker())
  );

  // ── 7. Post-generation scoring (concurrent, non-blocking to stream) ───────
  const validSlots = slotResults
    .map((r, i) => r && !r.failed ? { slot: i, ad: r.ad, b64: r.b64 } : null)
    .filter(Boolean);

  if (validSlots.length > 0) {
    try {
      const scoringResults = await Promise.all(
        validSlots.map(async (s) => {
          try {
            const score = await scoreGeneration({
              productImagePath,
              productImageMime,
              generatedB64: s.b64,
            });
            emit({ type: 'slot_scored', slot: s.slot, ad_id: s.ad.id, score });
            return { slot: s.slot, ad: s.ad, score };
          } catch (scoreErr) {
            console.warn('[generationService] scoring slot', s.slot, 'failed:', scoreErr.message);
            return null;
          }
        })
      );

      const scoredValid = scoringResults.filter(Boolean);
      const best = selectBest(scoredValid);
      if (best) {
        emit({ type: 'best_selected', slot: best.slot, ad_id: best.ad.id, score: best.score });
      }
    } catch (scoringPipelineErr) {
      console.warn('[generationService] scoring pipeline failed:', scoringPipelineErr.message);
    }
  }

  // ── 8. Summary ────────────────────────────────────────────────────────────
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

  return {
    batch_id:                       batchId,
    count:                          n,
    ratios,
    total_slots:                    totalSlots,
    speed_mode:                     speedMode,
    actual_generation_time_seconds: (Date.now() - batchStart) / 1000,
    results: slotResults.map((r, i) =>
      r && r.failed
        ? { success: false, variationIndex: Math.floor(i / n) + 1, ratio: ratios[Math.floor(i / n)], error: r.error }
        : { success: true, ad: r.ad, imageUrl: r.imageUrl, variationIndex: r.variationIndex, ratio: r.ratio }
    ),
    creativeStrategy,
  };
}

module.exports = { remixGenerate, remixGenerateBatch, remixGenerateBatchStream, RATIO_ALIASES, RATIO_DISPLAY, normalizeRatios };
