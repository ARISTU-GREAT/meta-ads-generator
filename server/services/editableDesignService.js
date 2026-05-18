/**
 * editableDesignService
 *
 * Generates a fully-structured adflow-editable-design JSON from brand context,
 * concept strategy, and available assets. The JSON is source-of-truth:
 * the same file drives both the browser preview and the Figma plugin import.
 *
 * Schema: adflow-editable-design v1.0
 * Layer types: rectangle | text | image | button | ellipse | line | icon | group
 *
 * Provider priority: Claude (ANTHROPIC_API_KEY) → OpenAI (OPENAI_API_KEY)
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI    = require('openai');
const { buildNegativeRulesBlock } = require('../utils/promptUtils');

const CANVAS_SIZES = {
  square:    { width: 1080, height: 1080 },
  portrait:  { width: 1080, height: 1350 },
  landscape: { width: 1920, height: 1080 },
};

// Curated Google Fonts that render well in ads and are available in most Figma setups
const ALLOWED_FONTS = [
  'Inter', 'Poppins', 'Montserrat', 'Oswald', 'Raleway',
  'Bebas Neue', 'Lato', 'Roboto', 'Playfair Display', 'DM Sans',
];

const TIMEOUT_MS = 60_000;

// ── Client getters ─────────────────────────────────────────────────────────────

let _anthropic = null;
let _openai    = null;

function _getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function _getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function _buildBrandContext(brand) {
  const lines = [
    `Brand name: ${brand.name || 'Brand'}`,
    brand.industry          && `Industry: ${brand.industry}`,
    brand.description       && `Description: ${brand.description}`,
    brand.primary_color     && `Primary color: ${brand.primary_color}`,
    brand.secondary_color   && `Secondary color: ${brand.secondary_color}`,
    brand.primary_font      && `Preferred font: ${brand.primary_font}`,
    brand.brand_voice       && `Brand voice: ${brand.brand_voice}`,
    brand.target_audience   && `Target audience: ${brand.target_audience}`,
    brand.offer_cta         && `CTA text: "${brand.offer_cta}"`,
  ];
  return lines.filter(Boolean).join('\n');
}

function _buildStrategyContext(strategy) {
  if (!strategy || typeof strategy !== 'object') return null;
  const lines = [
    strategy.layout_type      && `Layout type: ${strategy.layout_type}`,
    strategy.composition      && `Composition: ${strategy.composition}`,
    strategy.visual_structure && `Visual structure: ${strategy.visual_structure}`,
    strategy.color_strategy   && `Color strategy: ${strategy.color_strategy}`,
    strategy.ad_energy        && `Ad energy: ${strategy.ad_energy}`,
    strategy.cta_position     && `CTA position: ${strategy.cta_position}`,
    strategy.typography_style && `Typography style: ${strategy.typography_style}`,
  ];
  if (Array.isArray(strategy.text_zones) && strategy.text_zones.length) {
    lines.push(`Suggested text: ${strategy.text_zones.join(' / ')}`);
  }
  return lines.filter(Boolean).join('\n') || null;
}

function _buildUserPrompt({ brand, W, H, aspectRatio, strategy, instructions, avoidInstructions, persona, productImageUrl, logoUrl }) {
  const brandCtx    = _buildBrandContext(brand);
  const strategyCtx = _buildStrategyContext(strategy);
  const cta         = brand.offer_cta     || 'Shop Now';
  const primaryColor  = brand.primary_color   || '#1a1a2e';
  const secondaryColor = brand.secondary_color || '#ffffff';
  const ctaTextColor  = '#ffffff';

  // Pick the best allowed font from the brand's preference
  const rawFont   = brand.primary_font || 'Inter';
  const fontFamily = ALLOWED_FONTS.find(f => f.toLowerCase().includes(rawFont.toLowerCase())) || 'Inter';

  const ctaY  = Math.round(H * 0.83);
  const ctaBottom = H - 80;

  return `Design a ${W}×${H}px Meta advertisement.

BRAND
${brandCtx}
${strategyCtx ? `\nCONCEPT STRATEGY\n${strategyCtx}` : ''}
${persona ? `\nPERSONA\n${persona.name ? 'Name: ' + persona.name : ''}\n${persona.description || ''}` : ''}
${instructions ? `\nINSTRUCTIONS\n${instructions}` : ''}
${buildNegativeRulesBlock(avoidInstructions)}

ASSETS
Product image URL: ${productImageUrl || 'none — use a placeholder rectangle'}
Logo URL: ${logoUrl || 'none — use brand name as text'}

Return ONLY this JSON (no markdown, no explanation):
{
  "schema": "adflow-editable-design",
  "version": "1.0",
  "canvas": { "width": ${W}, "height": ${H}, "background": "#hexcolor" },
  "layers": [...]
}

REQUIRED LAYERS — include every one:

1. Background rectangle (full canvas):
   { "id":"bg","type":"rectangle","name":"Background","x":0,"y":0,"width":${W},"height":${H},"fill":"${primaryColor}","borderRadius":0,"opacity":1,"z":0 }

2. Optional overlay (semi-transparent dark/light for contrast, skip if not needed):
   { "id":"overlay","type":"rectangle","name":"Overlay","x":0,"y":0,"width":${W},"height":${H},"fill":"#000000","borderRadius":0,"opacity":0.35,"z":5 }

3. Product image (hero focal point, ≥35% canvas area):
   { "id":"product","type":"image","name":"Product","imageUrl":"${productImageUrl || ''}","x":<int>,"y":<int>,"width":<int>,"height":<int>,"objectFit":"contain","z":10 }

4. Logo (top corner, 90–140px wide, skip if no logoUrl):
   { "id":"logo","type":"image","name":"Logo","imageUrl":"${logoUrl || ''}","x":<int>,"y":40,"width":120,"height":60,"objectFit":"contain","z":12 }

5. Headline (bold, punchy, 64–90px, brand copy):
   { "id":"headline","type":"text","name":"Headline","text":"<punchy headline>","x":80,"y":<int>,"width":${W - 160},"height":<int>,"fontFamily":"${fontFamily}","fontSize":76,"fontWeight":700,"lineHeight":1.05,"fill":"${secondaryColor}","align":"left","z":20 }

6. Subheadline (supporting message, 26–36px):
   { "id":"sub","type":"text","name":"Subheadline","text":"<supporting message>","x":80,"y":<int>,"width":${W - 160},"height":<int>,"fontFamily":"${fontFamily}","fontSize":30,"fontWeight":400,"lineHeight":1.3,"fill":"${secondaryColor}","align":"left","opacity":0.85,"z":21 }

7. CTA button (near bottom, y between ${ctaY} and ${ctaBottom}):
   { "id":"cta","type":"button","name":"CTA","text":"${cta}","x":80,"y":<int>,"width":380,"height":88,"fill":"${primaryColor}","textFill":"${ctaTextColor}","fontSize":30,"fontWeight":700,"borderRadius":20,"z":30 }

OPTIONAL — add if they improve the design:
- Benefit bullets: { "type":"text","text":"✓ benefit copy","fontSize":24,"fontWeight":400,...,"z":22 }
- Decorative shape: { "type":"rectangle" or "ellipse","fill":"#hexcolor","opacity":0.15,...,"z":3 }
- Price/badge: { "type":"text","text":"$XX","fontWeight":700,"fontSize":48,...,"z":23 }

DESIGN RULES:
- ALL x+width ≤ ${W}, ALL y+height ≤ ${H}. No coordinate may be negative.
- Headline MUST contain real ad copy — not placeholder text. Use the brand voice and concept.
- CTA button y must be ≥ ${ctaY} (near the bottom third).
- Product image MUST fill at least 35% of canvas area (${Math.round(W * H * 0.35)} px²).
- Font family for ALL text and buttons: "${fontFamily}"
- Use brand colors: primary=${primaryColor}, secondary=${secondaryColor}
- z ordering: 0=bg, 1-9=shapes/overlays, 10-19=images, 20-29=text, 30+=CTA
- Every text and button layer MUST have a non-empty "text" field with real copy
- Skip logo layer entirely if logoUrl is empty`;
}

// ── Layer normalisation ────────────────────────────────────────────────────────

const VALID_TYPES = new Set(['rectangle','text','image','button','ellipse','line','icon','group']);

function _normalizeColor(c) {
  if (!c || typeof c !== 'string') return '#888888';
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return '#' + s[1]+s[1]+s[2]+s[2]+s[3]+s[3];
  }
  return '#888888';
}

function _normalizeLayer(raw, W, H, idx) {
  const type = VALID_TYPES.has(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase() : 'rectangle';

  const x      = Math.max(0, Math.min(W - 1, Math.round(Number(raw.x)      || 0)));
  const y      = Math.max(0, Math.min(H - 1, Math.round(Number(raw.y)      || 0)));
  const width  = Math.max(1, Math.min(W - x,  Math.round(Number(raw.width)  || 100)));
  const height = Math.max(1, Math.min(H - y,  Math.round(Number(raw.height) || 60)));

  const layer = {
    id:           String(raw.id   || `layer_${idx}`),
    type,
    name:         String(raw.name || type),
    x, y, width, height,
    z:            Math.round(Number(raw.z)  || idx),
    opacity:      Math.max(0, Math.min(1, raw.opacity != null ? Number(raw.opacity) : 1)),
  };

  if (type === 'rectangle' || type === 'ellipse') {
    layer.fill         = _normalizeColor(raw.fill || raw.background_color || raw.color);
    layer.borderRadius = Math.max(0, Math.round(Number(raw.borderRadius) || 0));
  }

  if (type === 'text') {
    layer.text        = String(raw.text || raw.content || '');
    layer.fontFamily  = ALLOWED_FONTS.includes(raw.fontFamily) ? raw.fontFamily : 'Inter';
    layer.fontSize    = Math.max(8, Math.min(300, Math.round(Number(raw.fontSize)   || 32)));
    layer.fontWeight  = [400, 700].includes(Number(raw.fontWeight)) ? Number(raw.fontWeight) : 400;
    layer.lineHeight  = Math.max(0.5, Math.min(3, Number(raw.lineHeight) || 1.2));
    layer.fill        = _normalizeColor(raw.fill || raw.color);
    layer.align       = ['left','center','right'].includes(raw.align) ? raw.align : 'left';
  }

  if (type === 'button') {
    layer.text         = String(raw.text  || 'Click Here');
    layer.fill         = _normalizeColor(raw.fill || raw.background_color);
    layer.textFill     = _normalizeColor(raw.textFill || raw.text_color || '#ffffff');
    layer.fontSize     = Math.max(8, Math.min(200, Math.round(Number(raw.fontSize)   || 28)));
    layer.fontWeight   = [400, 700].includes(Number(raw.fontWeight)) ? Number(raw.fontWeight) : 700;
    layer.borderRadius = Math.max(0, Math.round(Number(raw.borderRadius) || 8));
    layer.fontFamily   = ALLOWED_FONTS.includes(raw.fontFamily) ? raw.fontFamily : 'Inter';
  }

  if (type === 'image') {
    layer.imageUrl  = raw.imageUrl || raw.image_url || null;
    layer.objectFit = ['contain','cover','fill'].includes(raw.objectFit) ? raw.objectFit : 'contain';
  }

  if (type === 'line') {
    layer.fill         = _normalizeColor(raw.fill || raw.color || raw.stroke);
    layer.strokeWeight = Math.max(1, Math.round(Number(raw.strokeWeight) || 2));
  }

  if (type === 'icon') {
    layer.fill    = _normalizeColor(raw.fill || raw.color);
    layer.iconKey = String(raw.iconKey || '');
  }

  return layer;
}

function _normalizeLayout(parsed, W, H, aspectRatio, brandName) {
  if (!parsed.canvas || !Array.isArray(parsed.layers)) {
    throw new Error('AI returned layout missing canvas or layers array');
  }

  const layers = parsed.layers
    .filter(l => l && typeof l === 'object')
    .map((l, i) => _normalizeLayer(l, W, H, i));

  // Remove image layers that have no imageUrl and are placeholders for absent assets
  // (keep them if they're the product layer — Figma will show a placeholder)
  layers.sort((a, b) => a.z - b.z);

  return {
    schema:           'adflow-editable-design',
    version:          '1.0',
    figma_exportable: true,
    meta: {
      brand_name:   brandName || '',
      aspect_ratio: aspectRatio,
      generated_by: 'editableDesignService',
    },
    canvas: {
      width:      W,
      height:     H,
      background: _normalizeColor(parsed.canvas.background || parsed.canvas.background_color || '#1a1a2e'),
    },
    layers,
  };
}

// ── AI callers ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a world-class Meta ad designer. You produce precise, production-ready ad layouts as strict JSON. ' +
  'Return ONLY valid JSON — no markdown fences, no prose, no explanation. ' +
  'Every coordinate must be an integer. Every color must be a 6-digit lowercase hex string like "#rrggbb".';

async function _callClaude(userPrompt) {
  const client     = _getAnthropicClient();
  const model      = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await client.messages.create(
      { model, max_tokens: 4096, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    return response.content[0].text;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'))) {
      throw new Error(`Editable design generation timed out after ${TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

async function _callOpenAI(userPrompt) {
  const client = _getOpenAIClient();
  const model  = process.env.OPENAI_DESIGN_MODEL || 'gpt-4.1';
  const resp   = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system',  content: SYSTEM_PROMPT },
      { role: 'user',    content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens:  4096,
    temperature: 0.4,
  });
  return resp.choices[0].message.content;
}

function _parseRaw(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]+\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI returned non-JSON: ' + raw.slice(0, 300));
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * generateEditableDesign
 *
 * @param {object} opts
 * @param {object} opts.brand          - full brand row
 * @param {string} opts.aspectRatio    - 'square' | 'portrait' | 'landscape'
 * @param {object} opts.strategy       - concept strategy object (from concept plan)
 * @param {string} opts.instructions   - free-text instructions
 * @param {object} opts.persona        - persona row or null
 * @param {string} opts.productImageUrl - public URL of product image (or null)
 * @param {string} opts.logoUrl         - public URL of logo (or null)
 * @returns {object} adflow-editable-design JSON
 */
async function generateEditableDesign({ brand, aspectRatio, strategy, instructions, avoidInstructions = '', persona, productImageUrl, logoUrl }) {
  const canvas = CANVAS_SIZES[aspectRatio] || CANVAS_SIZES.square;
  const { width: W, height: H } = canvas;

  const useProvider = process.env.ANTHROPIC_API_KEY ? 'claude' : 'openai';
  console.log(`[editableDesign] brand=${brand.name} canvas=${W}x${H} provider=${useProvider}`);

  const userPrompt = _buildUserPrompt({ brand, W, H, aspectRatio, strategy, instructions, avoidInstructions, persona, productImageUrl, logoUrl });

  let raw;
  try {
    raw = useProvider === 'claude' ? await _callClaude(userPrompt) : await _callOpenAI(userPrompt);
  } catch (err) {
    if (useProvider === 'claude' && process.env.OPENAI_API_KEY) {
      console.warn(`[editableDesign] Claude failed (${err.message}) — falling back to OpenAI`);
      raw = await _callOpenAI(userPrompt);
    } else {
      throw err;
    }
  }

  const parsed   = _parseRaw(raw);
  const layout   = _normalizeLayout(parsed, W, H, aspectRatio, brand.name);

  console.log(`[editableDesign] generated brand=${brand.name} layers=${layout.layers.length}`);
  return layout;
}

module.exports = { generateEditableDesign };
