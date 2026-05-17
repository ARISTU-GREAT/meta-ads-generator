const AD_PLATFORMS    = ['meta', 'google', 'tiktok', 'instagram', 'twitter'];
const AD_FORMATS      = ['single_image', 'carousel', 'video', 'story', 'reel', 'collection'];
const JOB_TYPES       = ['generate_copy', 'generate_image', 'generate_full_ad', 'batch'];
const JOB_STATUSES    = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
const AD_STATUSES     = ['draft', 'approved', 'rejected', 'exported'];
const CONCEPT_STATUSES = ['draft', 'ready', 'generating', 'completed', 'archived'];
const ASSET_TYPES     = ['logo', 'image', 'video', 'font', 'color_palette'];
const TEMPLATE_TYPES  = ['headline', 'body', 'cta', 'full_ad'];
const AD_TONES        = ['professional', 'playful', 'urgent', 'inspirational', 'conversational', 'bold'];
const HOOK_TYPES      = ['question', 'statistic', 'story', 'pain_point', 'benefit', 'curiosity'];
const OBJECTIVES      = ['awareness', 'conversion', 'traffic', 'engagement', 'lead_generation'];
const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB  = 10;

module.exports = {
  AD_PLATFORMS, AD_FORMATS, JOB_TYPES, JOB_STATUSES, AD_STATUSES,
  CONCEPT_STATUSES, ASSET_TYPES, TEMPLATE_TYPES, AD_TONES, HOOK_TYPES,
  OBJECTIVES, ALLOWED_MIMETYPES, MAX_FILE_SIZE_MB,
};
