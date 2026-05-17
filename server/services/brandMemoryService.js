/**
 * brandMemoryService — Brand Memory / Creative Intelligence
 *
 * Retrieval-based memory system. NOT model fine-tuning.
 * Stores structured creative intelligence derived from reference ads,
 * approved/rejected generated ads, and manual notes.
 *
 * Used to inject relevant brand history into the prompt composer before
 * each generation, so the AI produces fresher, more on-brand results.
 */

const { query }    = require('../db');
const { AppError } = require('../utils/errors');

const ANALYSIS_MODEL = () => process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini';

// ── Schema helpers ──────────────────────────────────────────────────────────

async function saveCreativeMemory({
  brandId, campaignId, sourceType, title, imageUrl,
  summary, angle, hook, format, persona,
  visualStyle, copyStyle, performanceNote, metadata,
}) {
  const { rows } = await query(
    `INSERT INTO creative_memories
       (brand_id, campaign_id, source_type, title, image_url,
        summary, angle, hook, format, persona,
        visual_style, copy_style, performance_note, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      brandId, campaignId || null, sourceType,
      title || null, imageUrl || null,
      summary || null, angle || null, hook || null, format || null, persona || null,
      visualStyle || null, copyStyle || null,
      performanceNote || null, JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}

async function getRelevantMemoriesForBrand(brandId, limit = 12) {
  const { rows: memories } = await query(
    `SELECT * FROM creative_memories
     WHERE brand_id = $1
     ORDER BY
       CASE source_type
         WHEN 'approved_ad'  THEN 1
         WHEN 'reference_ad' THEN 2
         WHEN 'template'     THEN 3
         WHEN 'manual_note'  THEN 4
         WHEN 'generated_ad' THEN 5
         WHEN 'rejected_ad'  THEN 6
         ELSE 7
       END,
       created_at DESC
     LIMIT $2`,
    [brandId, limit]
  );

  const { rows: angles } = await query(
    `SELECT * FROM angle_library
     WHERE brand_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 6`,
    [brandId]
  );

  return { memories, angles };
}

// Formats memory context into a string ready for prompt injection.
// Returns null if there is nothing worth injecting.
function formatMemoryContext(memories, angles) {
  if (!memories.length && !angles.length) return null;

  const approved  = memories.filter(m => m.source_type === 'approved_ad');
  const reference = memories.filter(m => m.source_type === 'reference_ad');
  const rejected  = memories.filter(m => m.source_type === 'rejected_ad');
  const notes     = memories.filter(m => m.source_type === 'manual_note');

  const lines = ['[BRAND CREATIVE MEMORY — use this intelligence to produce better, fresher ads]'];

  if (approved.length) {
    lines.push('\nPROVEN ANGLES (from ads the brand has approved):');
    approved.forEach(m => {
      if (m.angle)       lines.push(`• Angle: ${m.angle}`);
      if (m.hook)        lines.push(`  Hook: "${m.hook}"`);
      if (m.visual_style) lines.push(`  Visual style: ${m.visual_style}`);
      if (m.format)      lines.push(`  Format: ${m.format}`);
    });
  }

  if (reference.length) {
    lines.push('\nREFERENCE AD INTELLIGENCE (analyzed from uploaded reference ads):');
    reference.forEach(m => {
      const parts = [m.visual_style, m.format && `Format: ${m.format}`, m.copy_style && `Copy: ${m.copy_style}`].filter(Boolean);
      if (parts.length) lines.push(`• ${parts.join(' · ')}`);
      if (m.angle) lines.push(`  Creative angle: ${m.angle}`);
    });
  }

  if (rejected.length) {
    lines.push('\nPATTERNS TO AVOID (from rejected ads):');
    rejected.forEach(m => {
      if (m.angle)           lines.push(`• ${m.angle}`);
      if (m.performance_note) lines.push(`  Why avoided: ${m.performance_note}`);
    });
  }

  if (notes.length) {
    lines.push('\nCREATIVE NOTES (from brand team):');
    notes.forEach(m => {
      if (m.title || m.summary) lines.push(`• ${m.title || ''}${m.summary ? ': ' + m.summary : ''}`);
    });
  }

  if (angles.length) {
    lines.push('\nFRESH ANGLES TO EXPLORE (generate ads using these, do not reuse past patterns):');
    angles.forEach(a => {
      lines.push(`• ${a.name}${a.description ? ': ' + a.description : ''}`);
      if (a.pain_point)        lines.push(`  Pain point: ${a.pain_point}`);
      if (a.emotional_trigger) lines.push(`  Emotional trigger: ${a.emotional_trigger}`);
      if (Array.isArray(a.hook_examples) && a.hook_examples.length)
        lines.push(`  Hook examples: "${a.hook_examples.slice(0, 2).join('" / "')}"`);
    });
  }

  lines.push('\nDIRECTION: Build on proven patterns, steer away from rejected ones, and actively try the fresh angles listed above. Each new ad should feel differentiated from past work while staying unmistakably on-brand.');

  return lines.join('\n');
}

// ── AI Analysis ──────────────────────────────────────────────────────────────

// Analyze a single ad image (as a data URL) using OpenAI vision.
// Extracts creative intelligence and saves it as a creative_memory record.
async function analyzeAdIntoMemory({
  openai, brandId, campaignId, sourceType, imageUrl, imageDataUrl, metadata,
}) {
  const analysisPrompt = `You are a senior performance-marketing creative analyst.
Analyze this ad image and extract creative intelligence for a brand memory system.

Return a SINGLE valid JSON object — no markdown, no extra text:
{
  "title":       "short title describing this ad (max 60 chars)",
  "angle":       "the core selling angle in one sentence",
  "hook":        "the primary visual or headline hook (quote or describe it precisely)",
  "format":      "one of: hero_shot | split_screen | lifestyle | product_focus | before_after | text_overlay | testimonial | collage",
  "visual_style":"1-sentence description of the visual aesthetic (lighting, bg, mood)",
  "copy_style":  "one of: minimal | heavy_copy | testimonial | benefit_list | emotional | direct_response | story",
  "persona":     "the apparent target persona for this ad",
  "summary":     "2-sentence description of what makes this ad effective and its creative approach"
}`;

  const response = await openai.chat.completions.create({
    model:           ANALYSIS_MODEL(),
    response_format: { type: 'json_object' },
    max_tokens:      512,
    messages: [{
      role:    'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
        { type: 'text', text: analysisPrompt },
      ],
    }],
  });

  let analysis = {};
  try {
    const raw = response.choices[0].message.content.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    analysis = JSON.parse(raw);
  } catch {
    analysis = { title: 'Analyzed Ad', summary: 'Analysis could not be parsed.' };
  }

  return saveCreativeMemory({
    brandId, campaignId, sourceType,
    title:           analysis.title,
    imageUrl,
    summary:         analysis.summary,
    angle:           analysis.angle,
    hook:            analysis.hook,
    format:          analysis.format,
    persona:         analysis.persona,
    visualStyle:     analysis.visual_style,
    copyStyle:       analysis.copy_style,
    metadata:        { ...(metadata || {}), rawAnalysis: analysis },
  });
}

// Generate fresh creative angles from brand memory using OpenAI.
// Saves results to angle_library and returns the saved rows.
async function generateNewAngles(openai, brandId, brand) {
  const { memories } = await getRelevantMemoriesForBrand(brandId, 20);

  const usedAngles = memories
    .filter(m => m.angle)
    .map(m => {
      const tag = m.source_type === 'approved_ad'  ? ' [PROVEN]'
                : m.source_type === 'rejected_ad'  ? ' [REJECTED]'
                : '';
      return `• ${m.angle}${tag}`;
    })
    .join('\n') || 'None yet — this is the first generation.';

  const brandContext = [
    brand.name            && `Brand: ${brand.name}`,
    brand.industry        && `Industry: ${brand.industry}`,
    brand.description     && `Description: ${brand.description}`,
    brand.target_audience && `Target audience: ${brand.target_audience}`,
    brand.brand_voice     && `Brand voice: ${brand.brand_voice}`,
  ].filter(Boolean).join('\n');

  const prompt = `You are a world-class performance marketing strategist.

BRAND CONTEXT:
${brandContext}

ANGLES ALREADY USED (do NOT repeat these):
${usedAngles}

Generate 5 FRESH new creative angles that:
- Have NOT been tried before
- Each varies in persona, emotional trigger, and format
- Stay true to the brand voice and target audience
- Each should produce a genuinely different ad

Return a SINGLE valid JSON object — no markdown, no extra text:
{
  "angles": [
    {
      "name":              "short name for this angle (3–6 words)",
      "description":       "1–2 sentences on the angle and why it will convert",
      "persona":           "target persona for this angle",
      "pain_point":        "the specific problem this angle addresses",
      "emotional_trigger": "one of: fear | aspiration | curiosity | social_proof | urgency | relief | belonging | fomo",
      "hook_examples":     ["example hook line 1", "example hook line 2"],
      "offer_strategy":    "how to frame the offer or CTA for this angle"
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model:           ANALYSIS_MODEL(),
    response_format: { type: 'json_object' },
    max_tokens:      1800,
    messages: [{ role: 'user', content: prompt }],
  });

  let result;
  try {
    const raw = response.choices[0].message.content.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    result = JSON.parse(raw);
  } catch {
    throw new AppError('Failed to parse angle generation response', 500);
  }

  const angles = Array.isArray(result.angles) ? result.angles : [];

  const saved = await Promise.all(
    angles.map(a =>
      query(
        `INSERT INTO angle_library
           (brand_id, name, description, persona, pain_point,
            emotional_trigger, hook_examples, offer_strategy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          brandId, a.name, a.description, a.persona, a.pain_point,
          a.emotional_trigger, JSON.stringify(a.hook_examples || []), a.offer_strategy,
        ]
      ).then(r => r.rows[0])
    )
  );

  return saved;
}

// ── Approve / Reject with learning ──────────────────────────────────────────

async function markAdApproved(adId, brandId) {
  const { rows } = await query('SELECT * FROM generated_ads WHERE id = $1', [adId]);
  if (!rows.length) throw new AppError('Ad not found', 404);
  const ad = rows[0];

  await query("UPDATE generated_ads SET status = 'approved' WHERE id = $1", [adId]);

  // If already in memory, upgrade source_type
  const { rows: existing } = await query(
    `SELECT id FROM creative_memories WHERE brand_id = $1 AND metadata->>'adId' = $2`,
    [brandId, adId]
  );
  if (existing.length) {
    await query(
      `UPDATE creative_memories
       SET source_type = 'approved_ad', performance_note = 'Approved by user'
       WHERE id = $1`,
      [existing[0].id]
    );
    return;
  }

  const meta     = typeof ad.metadata === 'string' ? JSON.parse(ad.metadata) : (ad.metadata || {});
  const strategy = meta.strategy || {};

  await saveCreativeMemory({
    brandId,
    campaignId:      ad.campaign_id,
    sourceType:      'approved_ad',
    title:           `Approved: ${[strategy.ad_energy, strategy.layout_type].filter(Boolean).join(' ')}` || 'Approved Ad',
    imageUrl:        ad.image_url,
    angle:           strategy.creative_strategy || null,
    hook:            strategy.enhanced_prompt   ? strategy.enhanced_prompt.slice(0, 150) : null,
    format:          strategy.layout_type       || ad.ad_format || null,
    visualStyle:     strategy.color_strategy    || null,
    copyStyle:       strategy.text_density      || null,
    performanceNote: 'Approved by user',
    metadata:        { adId, adFormat: ad.ad_format, strategy },
  });
}

async function markAdRejected(adId, brandId, reason) {
  const { rows } = await query('SELECT * FROM generated_ads WHERE id = $1', [adId]);
  if (!rows.length) throw new AppError('Ad not found', 404);
  const ad = rows[0];

  await query("UPDATE generated_ads SET status = 'rejected' WHERE id = $1", [adId]);

  const { rows: existing } = await query(
    `SELECT id FROM creative_memories WHERE brand_id = $1 AND metadata->>'adId' = $2`,
    [brandId, adId]
  );
  if (existing.length) {
    await query(
      `UPDATE creative_memories
       SET source_type = 'rejected_ad', performance_note = $1
       WHERE id = $2`,
      [reason || 'Rejected by user', existing[0].id]
    );
    return;
  }

  const meta     = typeof ad.metadata === 'string' ? JSON.parse(ad.metadata) : (ad.metadata || {});
  const strategy = meta.strategy || {};

  await saveCreativeMemory({
    brandId,
    campaignId:      ad.campaign_id,
    sourceType:      'rejected_ad',
    title:           `Rejected: ${[strategy.ad_energy, strategy.layout_type].filter(Boolean).join(' ')}` || 'Rejected Ad',
    imageUrl:        ad.image_url,
    angle:           strategy.creative_strategy || null,
    format:          strategy.layout_type       || ad.ad_format || null,
    visualStyle:     strategy.color_strategy    || null,
    performanceNote: reason || 'Rejected by user',
    metadata:        { adId, adFormat: ad.ad_format, strategy },
  });
}

module.exports = {
  saveCreativeMemory,
  getRelevantMemoriesForBrand,
  formatMemoryContext,
  analyzeAdIntoMemory,
  generateNewAngles,
  markAdApproved,
  markAdRejected,
};
