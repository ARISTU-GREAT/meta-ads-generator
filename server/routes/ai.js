const express = require('express');
const router  = express.Router();
const { asyncHandler, AppError } = require('../utils/errors');
const { generateStrategy }       = require('../services/aiHelperService');

const VALID_PROVIDERS  = ['openai', 'claude', 'gemini'];
const VALID_FIELD_TYPES = ['instructions', 'concept_strategy'];

// POST /api/ai/generate-strategy
router.post('/generate-strategy', asyncHandler(async (req, res) => {
  const { provider, field_type, mode, existing_text, brand_context, persona_context, reference_context } = req.body;

  if (!provider)   throw new AppError('provider required', 400);
  if (!field_type) throw new AppError('field_type required', 400);
  if (!VALID_PROVIDERS.includes(provider))   throw new AppError(`provider must be one of: ${VALID_PROVIDERS.join(', ')}`, 400);
  if (!VALID_FIELD_TYPES.includes(field_type)) throw new AppError(`field_type must be one of: ${VALID_FIELD_TYPES.join(', ')}`, 400);

  const text = await generateStrategy({
    provider,
    fieldType:        field_type,
    mode:             mode || 'auto',
    existingText:     existing_text     || '',
    brandContext:     brand_context     || '',
    personaContext:   persona_context   || '',
    referenceContext: reference_context || '',
  });

  res.json({ success: true, text });
}));

module.exports = router;
