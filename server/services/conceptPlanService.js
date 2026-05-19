const fs   = require('fs');
const path = require('path');

const PROMPT_MODEL = () => process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini';

const formatsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../shared/adFormats.json'), 'utf-8')
);

function toDataURL(filePath, mimeType) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Product image file not found at path: ${filePath}`);
  }
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType || 'image/jpeg'};base64,${b64}`;
}

// Generate a concept plan: N concepts, each with format + persona + angle + hook
async function generateConceptPlan({
  openai,
  brand,
  personas,
  productImagePath,
  productImageMime,
  strategy,
  conceptCount,
  aspectRatio,
  selectedFormatIds, // optional: if user pre-selected formats
}) {
  const n = Math.max(1, Math.min(12, parseInt(conceptCount, 10) || 5));

  const formatsMenu = (selectedFormatIds && selectedFormatIds.length > 0
    ? formatsData.filter(f => selectedFormatIds.includes(f.id))
    : formatsData
  ).map(f => `${f.id} | ${f.name} — ${f.description} | Goal: ${f.marketing_goal}`)
   .join('\n');

  const personasMenu = personas.length > 0
    ? personas.map(p =>
        `${p.id} | ${p.name}${p.age_range ? ` (${p.age_range})` : ''}${p.description ? ` — ${p.description}` : ''}`
      ).join('\n')
    : 'NO_PERSONAS_DEFINED';

  const brandLines = [
    brand.name        && `Brand: ${brand.name}`,
    brand.industry    && `Industry: ${brand.industry}`,
    brand.description && `Description: ${brand.description}`,
    brand.primary_color && `Primary color: ${brand.primary_color}`,
    brand.primary_font  && `Primary font: ${brand.primary_font}`,
    brand.secondary_font && `Secondary font: ${brand.secondary_font}`,
    brand.headline_style && `Headline style: ${brand.headline_style}`,
    brand.typography_personality && `Typography personality: ${brand.typography_personality}`,
  ].filter(Boolean).join('\n') || 'No brand info provided.';

  const systemPrompt = `You are a senior Meta advertising strategist and creative director.

Analyze the product image and brand context, then generate a campaign concept plan with exactly ${n} distinct ad concepts.

AVAILABLE FORMATS:
${formatsMenu}

${personasMenu === 'NO_PERSONAS_DEFINED'
  ? 'PERSONAS: No specific personas defined — use descriptive audience labels.'
  : `AVAILABLE PERSONAS:\n${personasMenu}`}

BRAND CONTEXT:
${brandLines}

USER STRATEGY:
${strategy && strategy.trim() ? strategy.trim() : 'Maximize coverage — vary formats, audiences, and angles for comprehensive campaign.'}

ASPECT RATIO: ${aspectRatio || 'square'}

RULES:
1. Each concept must use a different format where possible — maximize variety
2. Vary audience segments across concepts
3. Each hook must be specific, attention-grabbing, and tailored to the product visible
4. ads_to_generate: 2–4 per concept
5. The angle must describe the specific creative/messaging approach
6. TYPOGRAPHY: Let the brand's headline_style and typography_personality inform the angle's composition density, text hierarchy, and CTA energy — e.g. "Aggressive DR" implies dense copy and urgent CTA; "Luxury Editorial" implies sparse headline and premium spacing

Return a JSON object with a single key "concepts" containing an array of exactly ${n} objects:
{
  "concepts": [
    {
      "format_id": "exact id from formats list",
      "format_name": "exact name from formats list",
      "persona_id": "uuid from personas list, or null",
      "persona_name": "persona name, or descriptive audience label",
      "angle": "one sentence: the specific creative positioning angle",
      "hook": "the exact opening line, question, or visual concept that grabs attention (be specific to this product)",
      "ads_to_generate": 3
    }
  ]
}`;

  // Build message content — include product image if available
  let messageContent;
  if (productImagePath) {
    let imageDataUrl;
    try {
      imageDataUrl = toDataURL(productImagePath, productImageMime);
    } catch (err) {
      console.warn('[conceptPlanService] product image unavailable, proceeding without it:', err.message);
      imageDataUrl = null;
    }
    messageContent = imageDataUrl
      ? [
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          { type: 'text', text: systemPrompt },
        ]
      : [{ type: 'text', text: systemPrompt }];
  } else {
    messageContent = [{ type: 'text', text: systemPrompt }];
  }

  const model = PROMPT_MODEL();
  console.log('[conceptPlanService] calling OpenAI', { model, n, hasImage: !!productImagePath, promptLength: systemPrompt.length });

  let response;
  try {
    response = await openai.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      max_tokens:      3000,
      messages: [{ role: 'user', content: messageContent }],
    });
  } catch (err) {
    // Enrich OpenAI SDK errors with their HTTP status when available
    const status = err.status || err.statusCode;
    const detail = err.error?.message || err.message || 'OpenAI request failed';
    throw new Error(status ? `OpenAI API error ${status}: ${detail}` : detail);
  }

  const content = response?.choices?.[0]?.message?.content;
  if (!content) {
    const finishReason = response?.choices?.[0]?.finish_reason;
    throw new Error(
      finishReason === 'length'
        ? 'OpenAI response was cut off (max_tokens reached). Try fewer concepts.'
        : `OpenAI returned empty content (finish_reason: ${finishReason || 'unknown'})`
    );
  }

  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error('[conceptPlanService] JSON parse failed. Raw content snippet:', cleaned.slice(0, 200));
    throw new Error(`Could not parse OpenAI response as JSON: ${err.message}`);
  }

  // Normalize: handle both {concepts:[...]} and plain array
  const concepts = Array.isArray(parsed)
    ? parsed
    : (parsed.concepts || parsed.items || Object.values(parsed).find(v => Array.isArray(v)) || []);

  if (!Array.isArray(concepts) || concepts.length === 0) {
    throw new Error('OpenAI returned no concepts. The response may have been malformed.');
  }

  console.log('[conceptPlanService] parsed', { concepts: concepts.length });
  return concepts.slice(0, n);
}

module.exports = { generateConceptPlan, formatsData };
