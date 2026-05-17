/**
 * claudeDesignService
 *
 * Uses Claude to produce a structured, Figma-ready design blueprint from
 * brand + creative strategy context — no image generation, pure layout planning.
 *
 * Blueprint JSON schema (version 3.0):
 *   version, schema, export_mode: 'blueprint', meta, canvas, layers
 *
 * Layer types: background | text | image | product_image | logo | icon |
 *              button | shape | divider | group
 *
 * Requires ANTHROPIC_API_KEY env var. Optional ANTHROPIC_MODEL (default: claude-sonnet-4-6).
 */

const Anthropic = require('@anthropic-ai/sdk');

const CANVAS_SIZES = {
  square:   { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape:{ width: 1920, height: 1080 },
};

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function _buildBrandContext(brand) {
  const lines = [
    `Brand name: ${brand.name || 'Brand'}`,
    brand.industry      && `Industry: ${brand.industry}`,
    brand.description   && `Brand description: ${brand.description}`,
    brand.primary_color && `Primary color: ${brand.primary_color}`,
    brand.secondary_color && `Secondary color: ${brand.secondary_color}`,
    brand.primary_font  && `Primary font feel: ${brand.primary_font}`,
    brand.headline_style && `Headline style: ${brand.headline_style}`,
    brand.typography_personality && `Typography personality: ${brand.typography_personality}`,
    brand.brand_voice   && `Brand voice: ${brand.brand_voice}`,
    brand.target_audience && `Target audience: ${brand.target_audience}`,
    brand.offer_cta     && `CTA button text: "${brand.offer_cta}"`,
  ];
  return lines.filter(Boolean).join('\n');
}

function _buildStrategyContext(strategy) {
  if (!strategy) return null;
  const lines = [
    strategy.layout_type      && `Layout type: ${strategy.layout_type}`,
    strategy.composition      && `Composition: ${strategy.composition}`,
    strategy.visual_structure && `Visual structure: ${strategy.visual_structure}`,
    strategy.color_strategy   && `Color strategy: ${strategy.color_strategy}`,
    strategy.ad_energy        && `Ad energy: ${strategy.ad_energy}`,
    strategy.cta_position     && `CTA position: ${strategy.cta_position}`,
    strategy.typography_style && `Typography style: ${strategy.typography_style}`,
    strategy.product_strategy && `Product strategy: ${strategy.product_strategy}`,
  ];
  if (Array.isArray(strategy.text_zones) && strategy.text_zones.length) {
    lines.push(`Suggested text zones: ${strategy.text_zones.join(' / ')}`);
  }
  return lines.filter(Boolean).join('\n') || null;
}

function _buildLayerSchema(W, H) {
  return `{
  "id": "unique_snake_case_string",
  "type": "background|text|image|product_image|logo|icon|button|shape|divider",
  "name": "Descriptive Layer Name",
  "role": "background|overlay|headline|subheadline|body|benefit|cta_text|product|logo|badge|icon|decoration|divider|panel",
  "x": 0,            // integer px, 0–${W}
  "y": 0,            // integer px, 0–${H}
  "width": ${W},     // integer px, ≥1
  "height": ${H},    // integer px, ≥1
  "z_index": 0,      // 0 = bottom, higher = top
  "text": "",        // REQUIRED for type=text or button; exact visible string
  "font_family": "Inter",
  "font_size": 48,   // pt integer
  "font_weight": 700, // 400 or 700
  "color": "#ffffff", // text / stroke color
  "background_color": "#5b6af0", // fill for background/shape/button/icon/logo/image
  "border_radius": 0,
  "opacity": 1.0,    // 0.0–1.0
  "alignment": "center", // left | center | right
  "notes": "brief designer note"
}`;
}

function _buildUserPrompt(brand, strategy, W, H, aspectRatio, conceptContext) {
  const brandCtx    = _buildBrandContext(brand);
  const strategyCtx = _buildStrategyContext(strategy);
  const cta         = brand.offer_cta || 'Shop Now';
  const primaryColor = brand.primary_color || '#5b6af0';
  const secondaryColor = brand.secondary_color || '#ffffff';
  const font        = brand.primary_font || 'Inter';

  return `Design a ${W}×${H}px Meta ad blueprint for this brand:

BRAND
${brandCtx}
${strategyCtx ? `\nCREATIVE STRATEGY\n${strategyCtx}` : ''}
${conceptContext ? `\nCONCEPT / ANGLE\n${conceptContext}` : ''}

Return ONLY this JSON (no markdown, no explanation):
{
  "canvas": {
    "width": ${W},
    "height": ${H},
    "background_color": "#hex"
  },
  "layers": [ ...layer objects ordered bottom (z_index 0) to top... ]
}

Layer schema:
${_buildLayerSchema(W, H)}

REQUIRED layers — include every one of these in the design:
1. background — full ${W}×${H} RECTANGLE using brand primary/complementary color
2. product_image — large IMAGE placeholder (≥ 40% canvas area), hero focal point, role "product"
3. logo — IMAGE placeholder 90–130px wide, role "logo", corner placement
4. headline — TEXT layer, 52–80px, font_weight 700, punchy headline copy
5. subheadline — TEXT layer, 22–34px, font_weight 400, supporting message
6. benefit_1, benefit_2, benefit_3 — TEXT layers, 16–24px, short punchy benefit bullets (use "✓" or "•" prefix)
7. cta_button — button type, 60–76px tall, 280–420px wide, background_color="${primaryColor}", color="${secondaryColor}", text="${cta}"
8. At least one shape or divider for visual hierarchy

Optional additions (use if they improve the design):
- A semi-transparent overlay RECTANGLE for contrast (opacity 0.3–0.55)
- icon placeholders alongside benefit bullets (icon type, 20–28px)
- Decorative shape(s) for brand personality

Design rules:
- ALL coordinates must fit inside ${W}×${H}px
- product_image should be the most visually dominant element
- Headline sits above or overlaps the product zone
- CTA button is always near the bottom (y > ${Math.round(H * 0.7)})
- Brand colors: primary=${primaryColor}, secondary=${secondaryColor}
- Font family for ALL text: "${font}" (rendered as Inter in Figma)
- Every text/button layer MUST have a non-empty "text" field with real copy
- Use z_index ascending from 0 (background=0, product=1, text layers=2-5, cta=top)
- Opacity default 1.0; only set lower for overlays/shadows`;
}

// ── Layer normalisation ───────────────────────────────────────────────────────

const VALID_TYPES = new Set([
  'background','text','image','product_image','logo','icon','button','shape','divider','group'
]);

function _normalizeLayer(raw, W, H, fallbackZ) {
  const type = VALID_TYPES.has(String(raw.type || '').toLowerCase())
    ? String(raw.type).toLowerCase()
    : 'shape';

  const x      = Math.max(0, Math.min(W - 1, Math.round(Number(raw.x)      || 0)));
  const y      = Math.max(0, Math.min(H - 1, Math.round(Number(raw.y)      || 0)));
  const width  = Math.max(1, Math.min(W - x,  Math.round(Number(raw.width) || 100)));
  const height = Math.max(1, Math.min(H - y,  Math.round(Number(raw.height)|| 60)));

  const layer = {
    id:               String(raw.id   || `layer_${Math.random().toString(36).slice(2, 8)}`),
    type,
    name:             String(raw.name || type),
    role:             String(raw.role || 'decoration'),
    x, y, width, height,
    z_index:          Math.max(0, Math.round(Number(raw.z_index) || fallbackZ)),
    background_color: String(raw.background_color || '#888888'),
    border_radius:    Math.max(0, Math.round(Number(raw.border_radius) || 0)),
    opacity:          Math.max(0, Math.min(1, Number(raw.opacity) != null ? Number(raw.opacity) : 1)),
    notes:            String(raw.notes || ''),
  };

  // Text fields (required for text/button)
  if (type === 'text' || type === 'button') {
    layer.text        = String(raw.text || raw.content || '');
    layer.font_family = String(raw.font_family || 'Inter');
    layer.font_size   = Math.max(8, Math.min(300, Math.round(Number(raw.font_size) || 32)));
    layer.font_weight = [400, 700].includes(Number(raw.font_weight)) ? Number(raw.font_weight) : 400;
    layer.color       = String(raw.color || '#000000');
    layer.alignment   = ['left','center','right'].includes(String(raw.alignment || '').toLowerCase())
      ? String(raw.alignment).toLowerCase() : 'left';
  }

  return layer;
}

// ── Main export ───────────────────────────────────────────────────────────────

const BLUEPRINT_TIMEOUT_MS = 45_000;

async function generateBlueprint({ brand, strategy, aspectRatio, conceptContext }) {
  const client = getClient();
  const canvas = CANVAS_SIZES[aspectRatio] || CANVAS_SIZES.square;
  const { width: W, height: H } = canvas;

  console.log(`[CLAUDE_BLUEPRINT_START] brand=${brand.name} canvas=${W}x${H} model=${MODEL()} timeout=${BLUEPRINT_TIMEOUT_MS}ms`);

  const systemPrompt =
    'You are a senior Figma designer and ad layout expert. ' +
    'You produce precise, production-ready design blueprints as strict JSON. ' +
    'Return ONLY valid JSON — no markdown fences, no prose, no explanation.';

  const userPrompt = _buildUserPrompt(brand, strategy, W, H, aspectRatio, conceptContext);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLUEPRINT_TIMEOUT_MS);

  let response;
  try {
    response = await client.messages.create(
      { model: MODEL(), max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] },
      { signal: controller.signal }
    );
    clearTimeout(timer);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('abort'))) {
      console.error(`[CLAUDE_BLUEPRINT_FAIL] timeout after ${BLUEPRINT_TIMEOUT_MS}ms brand=${brand.name}`);
      throw new Error(`Claude blueprint timed out after ${BLUEPRINT_TIMEOUT_MS / 1000}s — try again or use Editable Export`);
    }
    console.error(`[CLAUDE_BLUEPRINT_FAIL] ${err.message} brand=${brand.name}`);
    throw err;
  }

  const raw = response.content[0].text;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]+\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('Claude returned non-JSON: ' + raw.slice(0, 300));
  }

  if (!parsed.canvas || !Array.isArray(parsed.layers)) {
    throw new Error('Blueprint missing canvas or layers array');
  }

  const cW = parsed.canvas.width  || W;
  const cH = parsed.canvas.height || H;
  const layers = parsed.layers.map((l, i) => _normalizeLayer(l, cW, cH, i));

  // Sort by z_index ascending so rendering order is bottom → top
  layers.sort((a, b) => a.z_index - b.z_index);

  const blueprint = {
    version:          '3.0',
    schema:           'creative-layout',
    figma_exportable: true,
    export_mode:      'blueprint',
    meta: {
      brand_name:   brand.name || '',
      aspect_ratio: aspectRatio,
      generated_by: 'claude',
      claude_model: MODEL(),
    },
    canvas: {
      width:            cW,
      height:           cH,
      background_color: String(parsed.canvas.background_color || '#ffffff'),
    },
    layers,
  };

  console.log(`[CLAUDE_BLUEPRINT_SUCCESS] brand=${brand.name} layers=${layers.length}`);
  return blueprint;
}

module.exports = { generateBlueprint };
