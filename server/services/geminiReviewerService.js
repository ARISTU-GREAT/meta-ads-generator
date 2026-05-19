/**
 * geminiReviewerService
 *
 * Optional creative reviewer powered by Gemini.
 * Called BEFORE batch generation when GEMINI_API_KEY is set.
 * Provides: angle variations, ratio-specific composition notes,
 * fidelity warnings, and improvement suggestions.
 *
 * If the key is missing or the call fails, returns null —
 * generation continues with OpenAI-only flow.
 */

const GEMINI_KEY     = () => process.env.GEMINI_API_KEY?.trim();
const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function isGeminiAvailable() {
  return !!GEMINI_KEY();
}

async function reviewCreativeStrategy({ brand, strategy, ratios = [], instructions = '', avoidInstructions = '' }) {
  const key = GEMINI_KEY();
  if (!key) return null;

  const ratioLabels = ratios.map(r => {
    const display = { square: '1:1 Square', portrait: '4:5 Portrait', story: '9:16 Story/Reels', landscape: '16:9 Landscape' };
    return display[r] || r;
  }).join(', ');

  const strategySnippet = strategy
    ? JSON.stringify({
        layout_type:       strategy.layout_type,
        composition:       strategy.composition,
        visual_structure:  strategy.visual_structure,
        color_strategy:    strategy.color_strategy,
        ad_energy:         strategy.ad_energy,
        creative_strategy: strategy.creative_strategy,
      }).slice(0, 600)
    : 'No strategy available yet';

  const prompt = `You are a senior creative director reviewing an ad campaign brief.

Brand: ${brand.name} (${brand.industry || 'general'})
Current creative strategy: ${strategySnippet}
Target ratios: ${ratioLabels || 'square'}
Creative instructions: ${instructions || 'none'}
Elements to avoid: ${avoidInstructions || 'none'}

Provide a brief creative review with:
1. Three distinct angle variation ideas (different creative approaches)
2. A short composition note per ratio (what works best at that ratio)
3. Any product fidelity warnings based on the strategy
4. One improvement suggestion for the overall approach

Respond ONLY with valid JSON in exactly this shape:
{
  "angle_variations": ["angle 1...", "angle 2...", "angle 3..."],
  "ratio_notes": { "square": "...", "portrait": "...", "story": "...", "landscape": "..." },
  "fidelity_warnings": ["warning..."],
  "improvement": "one short improvement suggestion"
}`;

  try {
    const resp = await fetch(`${GEMINI_API_URL}?key=${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(12000), // 12 s — never blocks generation
    });

    if (!resp.ok) {
      console.warn('[geminiReviewer] API error:', resp.status, await resp.text().catch(() => ''));
      return null;
    }

    const body = await resp.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[geminiReviewer] creative review received.');
    return parsed;
  } catch (err) {
    console.warn('[geminiReviewer] Failed (non-fatal):', err.message);
    return null;
  }
}

module.exports = { isGeminiAvailable, reviewCreativeStrategy };
