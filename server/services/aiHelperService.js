/**
 * aiHelperService
 *
 * Generates or improves creative text fields (instructions / concept strategy)
 * using the user's choice of AI provider: OpenAI, Claude, or Gemini.
 */

const OpenAI    = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

let _openai = null;
let _claude = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getClaude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  if (!_claude) _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _claude;
}

const OPENAI_HELPER_MODEL = () => process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini';
const CLAUDE_HELPER_MODEL = () => process.env.ANTHROPIC_MODEL     || 'claude-sonnet-4-6';
const GEMINI_HELPER_MODEL = () => process.env.GEMINI_MODEL        || 'gemini-2.0-flash-exp';

// ── Prompts ───────────────────────────────────────────────────────────────────

function _systemPrompt(fieldType) {
  if (fieldType === 'instructions') {
    return (
      'You are a senior Meta advertising creative director. ' +
      'You write concise, directive ad creative instructions for an AI image generator. ' +
      'Be specific about tone, visual style, messaging hierarchy, and CTA. ' +
      'Output only the instructions — no preamble, no explanation, no bullet-point headers.'
    );
  }
  return (
    'You are a senior creative strategist specializing in Meta advertising. ' +
    'You craft clear, insight-driven concept strategies that guide creative teams. ' +
    'Be specific about audience mindset, messaging angle, emotional hook, and visual direction. ' +
    'Output only the strategy text — no preamble, no explanation.'
  );
}

function _userPrompt(fieldType, mode, existingText, brandContext, personaContext, referenceContext) {
  const brand  = brandContext    ? `\nBrand:\n${brandContext}`           : '';
  const person = personaContext  ? `\nTarget persona:\n${personaContext}` : '';
  const ref    = referenceContext? `\nReference context:\n${referenceContext}` : '';

  if (fieldType === 'instructions') {
    if (mode === 'generate' || !existingText.trim()) {
      return (
        `Generate Meta ad creative instructions for this brand.` +
        `${brand}${person}${ref}\n\n` +
        `Write 3–5 specific directives covering: primary CTA, tone/energy, key message or offer, ` +
        `and visual style preferences. Keep it directive and concise.`
      );
    }
    return (
      `Improve these Meta ad creative instructions:\n\n"${existingText}"` +
      `${brand}${person}\n\n` +
      `Make them more specific, actionable, and effective. Return only the improved instructions.`
    );
  }

  // concept_strategy
  if (mode === 'generate' || !existingText.trim()) {
    return (
      `Generate a Meta ad concept strategy for this brand.` +
      `${brand}${person}${ref}\n\n` +
      `Include: target audience mindset, primary emotional hook, messaging angle, visual direction, ` +
      `tone, and what differentiates this approach. Write 4–6 sentences. Be strategic and specific.`
    );
  }
  return (
    `Improve this Meta ad concept strategy:\n\n"${existingText}"` +
    `${brand}${person}\n\n` +
    `Make it more strategic, specific, and insightful. Return only the improved strategy.`
  );
}

// ── Provider implementations ──────────────────────────────────────────────────

async function _withOpenAI(fieldType, mode, existingText, brandContext, personaContext, referenceContext) {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model:       OPENAI_HELPER_MODEL(),
    max_tokens:  600,
    temperature: 0.72,
    messages: [
      { role: 'system', content: _systemPrompt(fieldType) },
      { role: 'user',   content: _userPrompt(fieldType, mode, existingText, brandContext, personaContext, referenceContext) },
    ],
  });
  return completion.choices[0].message.content.trim();
}

async function _withClaude(fieldType, mode, existingText, brandContext, personaContext, referenceContext) {
  const claude = getClaude();
  const res = await claude.messages.create({
    model:      CLAUDE_HELPER_MODEL(),
    max_tokens: 600,
    system:     _systemPrompt(fieldType),
    messages:   [{ role: 'user', content: _userPrompt(fieldType, mode, existingText, brandContext, personaContext, referenceContext) }],
  });
  return res.content[0].text.trim();
}

async function _withGemini(fieldType, mode, existingText, brandContext, personaContext, referenceContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = GEMINI_HELPER_MODEL();
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: _systemPrompt(fieldType) }] },
      contents: [{ role: 'user', parts: [{ text: _userPrompt(fieldType, mode, existingText, brandContext, personaContext, referenceContext) }] }],
      generationConfig: { temperature: 0.72, maxOutputTokens: 600 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

async function generateStrategy({ provider, fieldType, mode, existingText, brandContext, personaContext, referenceContext }) {
  const effectiveMode = (mode === 'generate') ? 'generate'
    : existingText && existingText.trim() ? 'improve' : 'generate';

  switch (provider) {
    case 'openai': return _withOpenAI(fieldType, effectiveMode, existingText || '', brandContext || '', personaContext || '', referenceContext || '');
    case 'claude': return _withClaude(fieldType, effectiveMode, existingText || '', brandContext || '', personaContext || '', referenceContext || '');
    case 'gemini': return _withGemini(fieldType, effectiveMode, existingText || '', brandContext || '', personaContext || '', referenceContext || '');
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

module.exports = { generateStrategy };
