/**
 * promptComposerService
 *
 * Uses OpenAI vision (gpt-4.1-mini by default) to analyze the reference ad
 * and product image, then produces a structured creative strategy JSON including
 * a fully-composed, enhanced image-generation prompt for gpt-image-1.
 *
 * Called by generationService before every gpt-image-1 invocation.
 * Model is configurable via OPENAI_PROMPT_MODEL env var.
 */

const fs = require('fs');
const { buildNegativeRulesBlock } = require('../utils/promptUtils');

const PROMPT_MODEL = () => process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini';

// Convert a local file to a base64 data URL for OpenAI vision input
function toDataURL(filePath, mimeType) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType || 'image/jpeg'};base64,${b64}`;
}

// Strip accidental markdown fences and parse JSON robustly
function parseJSON(text) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

// ─────────────────────────────────────────────────────────────────────────────
// composeCreativeStrategy
//
// Sends reference ad + product image to gpt-4.1-mini vision in ONE call.
// Returns structured strategy JSON with enhanced_prompt ready for gpt-image-1.
// ─────────────────────────────────────────────────────────────────────────────
function getPromptStyleInstruction(style, aspectRatio) {
  switch (style) {
    case 'draft':
      return 'Write a concise 2-3 sentence image generation prompt. Be direct and specific — focus only on layout, product placement, and key visual treatment.';
    case 'quality':
      return `Write a highly detailed 5-8 sentence image generation prompt. Include: (1) exact layout type, panel structure, visual hierarchy, (2) precise product description from Image 2 with material, finish, and scale, (3) full color palette, lighting, shadow, and background treatment, (4) typography: font weight feel, text density, headline scale, CTA energy matching brand identity, (5) detailed people casting directive if applicable, (6) do not copy any text logos or recognizable brand elements from the reference, (7) atmosphere, mood — make it feel premium and conversion-ready, (8) Meta ${aspectRatio} format, photorealistic lighting, hero composition`;
    default: // balanced
      return `Write a detailed 4-6 sentence image generation prompt. Must include: (1) exact layout type and composition recreation, (2) precise description of the product from Image 2 as the hero visual, (3) color palette and background matching the reference energy, (4) typography: apply brand font feel, headline weight, text density, and CTA styling matching the brand's headline_style, (5) people casting directive if applicable, (6) do not copy any text logos or recognizable brand elements from the reference, (7) Meta ${aspectRatio} format, premium production quality, photorealistic lighting`;
  }
}

async function composeCreativeStrategy({
  openai,
  brand,
  referenceImagePath,
  referenceImageMime,
  productImagePath,
  productImageMime,
  instructions,
  avoidInstructions = '',
  aspectRatio,
  promptStyle = 'balanced',
  memoryContext = null,   // optional: formatted string from brandMemoryService
}) {
  const brandLines = [
    brand.name            && `Brand name: ${brand.name}`,
    brand.industry        && `Industry: ${brand.industry}`,
    brand.description     && `Description: ${brand.description}`,
    brand.primary_color   && `Primary color: ${brand.primary_color}`,
    brand.secondary_color && `Secondary color: ${brand.secondary_color}`,
    brand.primary_font    && `Primary font: ${brand.primary_font}`,
    brand.secondary_font  && `Secondary font: ${brand.secondary_font}`,
    brand.headline_style  && `Headline style: ${brand.headline_style}`,
    brand.typography_personality && `Typography personality: ${brand.typography_personality}`,
  ].filter(Boolean).join('\n') || 'No brand information provided.';

  const userInstructions = (instructions && instructions.trim())
    ? instructions.trim()
    : 'None — follow the reference layout and brand guidelines.';

  const memorySection = memoryContext
    ? `\n─── BRAND CREATIVE MEMORY ───────────────────────────────────\n${memoryContext}\n`
    : '';

  const analysisPrompt = `You are a world-class Meta advertising creative director and AI image-prompt engineer.

IMAGE 1 (first image below) = REFERENCE AD — existing ad whose layout and creative style to remix.
IMAGE 2 (second image below) = PRODUCT — the actual product to feature in the newly generated ad.

─── BRAND CONTEXT ───────────────────────────────────────────
${brandLines}
${memorySection}
─── USER BRIEF ──────────────────────────────────────────────
Instructions: ${userInstructions}
Aspect ratio: ${aspectRatio}
${buildNegativeRulesBlock(avoidInstructions)}

─── YOUR TASK ───────────────────────────────────────────────
Analyze both images carefully. Return a SINGLE valid JSON object — no markdown, no extra text.

STRICT RULES you must follow when writing enhanced_prompt:
  • LAYOUT: Recreate the exact same layout type, panel structure, and visual hierarchy from the reference ad.
  • PRODUCT: Feature the specific product visible in Image 2 as the hero — describe its appearance precisely.
  • PEOPLE: If the reference contains people, cast completely different people with completely different faces and appearance. Preserve only the archetype role (e.g. "confident young professional"). Never replicate any specific person.
  • TEXT: Do NOT copy exact text from the reference. Generate new ad copy unless the user instructions specify otherwise.
  • BRAND: Apply brand colors, name, and identity.
  • TYPOGRAPHY: Apply the brand's typography identity — font family feel, headline weight/scale, text density, spacing, and CTA styling must reflect the brand's headline_style and typography_personality if provided.
  • QUALITY: Premium Meta ad aesthetic, cinematic lighting, conversion-optimized composition.

Return this exact JSON structure:
{
  "layout_type": "one of: hero_shot | split_screen | product_focus | lifestyle | before_after | text_overlay | collage",
  "composition": "1-sentence description of the reference ad's visual arrangement",
  "visual_structure": "describe the visual hierarchy — what the viewer sees first, second, third",
  "text_zones": "where text blocks appear in the reference ad (e.g. top headline, bottom CTA bar, overlay text center)",
  "cta_position": "exact placement of the call-to-action element in the frame",
  "typography_style": "one of: bold_minimal | editorial | hand_crafted | clean_sans | serif_luxury | playful",
  "typography_strategy": "how brand typography identity (font feel, headline weight, spacing, density) is applied to this specific ad — reference brand's headline_style and personality if set",
  "headline_treatment": "specific headline execution: size relationship, weight, case, line breaks, dominant vs supporting text hierarchy",
  "text_density": "one of: sparse | balanced | dense — how much copy appears and how tightly it is set",
  "color_strategy": "describe the color palette, dominant hues, mood, and background treatment",
  "product_strategy": "how the product should be positioned in the new ad based on the reference layout",
  "human_archetypes": null or "ROLE ONLY — e.g. 'confident female fitness coach', 'young tech professional' — NEVER describe specific facial features, hair color, or identity markers",
  "archetype_protection": null or "Cast completely different people with completely different faces and appearance while preserving only the archetype role: [role]",
  "ad_energy": "one of: luxury | playful | urgent | professional | inspirational | bold | minimal | edgy",
  "creative_strategy": "one sentence: the core creative approach and why it will convert",
  "enhanced_prompt": "${getPromptStyleInstruction(promptStyle, aspectRatio)}"
}`;

  const response = await openai.chat.completions.create({
    model:           PROMPT_MODEL(),
    response_format: { type: 'json_object' },
    max_tokens:      2048,
    messages: [{
      role:    'user',
      content: [
        {
          type:      'image_url',
          image_url: { url: toDataURL(referenceImagePath, referenceImageMime), detail: 'high' },
        },
        {
          type:      'image_url',
          image_url: { url: toDataURL(productImagePath, productImageMime), detail: 'high' },
        },
        { type: 'text', text: analysisPrompt },
      ],
    }],
  });

  return parseJSON(response.choices[0].message.content);
}

module.exports = { composeCreativeStrategy };
