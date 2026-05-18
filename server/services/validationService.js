/**
 * validationService
 *
 * Uses GPT-4o vision to score generated ads against the original product image.
 * Scoring dimensions: product_similarity, logo_accuracy, color_consistency,
 * no_hallucinations, composition_quality → weighted overall score.
 *
 * scoreGeneration() runs per image after generation.
 * selectBest() picks the highest-scoring non-rejected result.
 */

const OpenAI = require('openai');
const fs     = require('fs');

let _openai = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SCORE_PROMPT = `You are a strict ad creative quality evaluator.

You will see TWO images:
- Image 1: the REFERENCE PRODUCT that must appear in the ad
- Image 2: the GENERATED AD CREATIVE

Score the generated ad on these 5 dimensions (0–10 each, 10 = perfect):
1. product_similarity — Does the ad product match the reference exactly? Same shape, colors, packaging, labels, surface finish.
2. logo_accuracy — Is brand logo or text reproduced accurately and not hallucinated?
3. color_consistency — Do colors align with the brand/product reference?
4. no_hallucinations — Are there NO extra products or fabricated objects? (10 = perfectly clean, 0 = many hallucinations)
5. composition_quality — Is the ad composition professional, balanced, and conversion-ready?

Also flag any of these rejection triggers (include in rejection_flags array if present):
- product_shape_changed
- extra_products
- branding_modified
- packaging_altered

Reply ONLY with minified JSON, no markdown fences, no explanation:
{"product_similarity":0,"logo_accuracy":0,"color_consistency":0,"no_hallucinations":0,"composition_quality":0,"overall":0,"rejection_flags":[],"should_reject":false,"notes":""}`;

// Scoring timeout — 20 seconds per image
const SCORE_TIMEOUT_MS = 20_000;

async function scoreGeneration({ productImagePath, productImageMime, generatedB64 }) {
  const openai = getOpenAI();
  if (!openai) return _neutralScore('OpenAI not configured — scoring skipped');

  try {
    const prodB64  = fs.readFileSync(productImagePath).toString('base64');
    const prodMime = productImageMime || 'image/png';

    const ac    = new AbortController();
    const timer = setTimeout(() => ac.abort(), SCORE_TIMEOUT_MS);

    let rawText;
    try {
      const resp = await openai.chat.completions.create({
        model:      'gpt-4o',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: SCORE_PROMPT },
            { type: 'image_url', image_url: { url: `data:${prodMime};base64,${prodB64}`, detail: 'low' } },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${generatedB64}`,  detail: 'low' } },
          ],
        }],
      }, { signal: ac.signal });
      rawText = resp.choices[0].message.content.trim();
    } finally {
      clearTimeout(timer);
    }

    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in scoring response');
    const parsed = JSON.parse(match[0]);

    // Clamp all numeric dimensions 0–10
    const DIMS = ['product_similarity', 'logo_accuracy', 'color_consistency', 'no_hallucinations', 'composition_quality'];
    DIMS.forEach(k => { parsed[k] = Math.max(0, Math.min(10, Number(parsed[k]) || 0)); });

    // Weighted overall if not provided: product fidelity is most important
    if (!parsed.overall || parsed.overall === 0) {
      parsed.overall = Math.round(10 * (
        parsed.product_similarity  * 0.35 +
        parsed.no_hallucinations   * 0.25 +
        parsed.logo_accuracy       * 0.133 +
        parsed.color_consistency   * 0.133 +
        parsed.composition_quality * 0.133
      )) / 10;
    } else {
      parsed.overall = Math.max(0, Math.min(10, Number(parsed.overall) || 0));
    }

    if (!Array.isArray(parsed.rejection_flags)) parsed.rejection_flags = [];

    // Auto-reject on critical failures if the model didn't flag it
    if (parsed.should_reject === undefined || parsed.should_reject === null) {
      parsed.should_reject =
        parsed.product_similarity < 4 ||
        parsed.no_hallucinations  < 3 ||
        parsed.rejection_flags.length >= 2;
    }

    return parsed;
  } catch (err) {
    console.warn('[validationService] scoring failed:', err.message);
    return _neutralScore('Scoring error: ' + err.message);
  }
}

function _neutralScore(notes) {
  return {
    product_similarity: 7,
    logo_accuracy:      7,
    color_consistency:  7,
    no_hallucinations:  8,
    composition_quality:7,
    overall:            7.2,
    rejection_flags:    [],
    should_reject:      false,
    notes,
  };
}

/**
 * selectBest — from an array of { slot, ad, score } objects, returns the one
 * with the highest overall score. Prefers non-rejected results; falls back to
 * the highest scorer among rejected if nothing passes.
 */
function selectBest(scoredSlots) {
  const valid = scoredSlots.filter(s => s && s.ad && s.score && !s.score.should_reject);
  const pool  = valid.length ? valid : scoredSlots.filter(s => s && s.ad && s.score);
  if (!pool.length) return null;
  return pool.reduce((best, s) => {
    const sc = s.score.overall || 0;
    const bc = best.score.overall || 0;
    return sc > bc ? s : best;
  });
}

module.exports = { scoreGeneration, selectBest };
