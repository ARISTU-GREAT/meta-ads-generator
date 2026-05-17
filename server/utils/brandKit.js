const REQUIRED_FIELDS = [
  'name',
  'description',
  'primary_color',
  'secondary_color',
  'target_audience',
  'brand_voice',
];

const FIELD_LABELS = {
  name:             'Brand Name',
  description:      'Brand Description',
  primary_color:    'Primary Color',
  secondary_color:  'Secondary Color',
  target_audience:  'Target Audience',
  brand_voice:      'Brand Voice',
};

function isBrandSetupComplete(brand) {
  if (!brand) return { complete: false, missing: REQUIRED_FIELDS, missing_labels: REQUIRED_FIELDS.map(f => FIELD_LABELS[f]) };

  const missing = REQUIRED_FIELDS.filter(f => !brand[f] || !String(brand[f]).trim());
  return {
    complete:       missing.length === 0,
    missing,
    missing_labels: missing.map(f => FIELD_LABELS[f]),
  };
}

module.exports = { isBrandSetupComplete, REQUIRED_FIELDS, FIELD_LABELS };
