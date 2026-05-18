/**
 * promptUtils — shared prompt-building helpers used across all AI services.
 */

/**
 * buildNegativeRulesBlock
 *
 * Converts the user's "avoid while generating" text into a NEGATIVE CREATIVE RULES
 * section that is injected into every AI prompt. Items are treated as HARD constraints,
 * not suggestions — the AI is explicitly told violating any rule disqualifies the design.
 *
 * @param {string} avoidInstructions  — raw user input (comma or newline separated)
 * @returns {string}  formatted block, or '' if nothing to avoid
 */
function buildNegativeRulesBlock(avoidInstructions) {
  if (!avoidInstructions || !avoidInstructions.trim()) return '';

  const items = avoidInstructions.trim()
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (!items.length) return '';

  return [
    '',
    '─── NEGATIVE CREATIVE RULES (HARD CONSTRAINTS) ───────────────',
    'The following rules apply to ALL creative decisions — colors, layout, typography,',
    'objects, people, photography style, CTA, and emotional tone.',
    'Treating any of these as optional or "soft" suggestions is NOT acceptable.',
    'Every rule below MUST be respected in the final output:',
    ...items.map(i => '✗ ' + i),
    '──────────────────────────────────────────────────────────────',
  ].join('\n');
}

module.exports = { buildNegativeRulesBlock };
