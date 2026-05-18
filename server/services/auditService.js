const { query } = require('../db');

// Non-blocking — never throws; called fire-and-forget
async function logEvent(req, { event_type, entity_type, entity_id, brand_id, campaign_id, message, metadata = {} }) {
  try {
    const userId    = req?.session?.user_id   || null;
    const userEmail = req?.session?.email     || null;
    const ip        = req?.ip || req?.headers?.['x-forwarded-for'] || null;
    const ua        = req?.headers?.['user-agent'] || null;
    await query(
      `INSERT INTO audit_events
         (user_id, user_email, event_type, entity_type, entity_id, brand_id, campaign_id, message, metadata, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [userId, userEmail, event_type, entity_type || null, entity_id || null,
       brand_id || null, campaign_id || null, message || null,
       JSON.stringify(metadata), ip, ua]
    );
  } catch (err) {
    console.warn('[auditService] logEvent failed (non-fatal):', err.message);
  }
}

async function getAuditEvents({ event_type, user_email, brand_id, campaign_id, from, to, search, limit = 100, offset = 0 } = {}) {
  try {
    const conditions = [];
    const params = [];
    let p = 1;

    if (event_type)  { conditions.push(`event_type = $${p++}`);     params.push(event_type); }
    if (user_email)  { conditions.push(`user_email ILIKE $${p++}`); params.push('%' + user_email + '%'); }
    if (brand_id)    { conditions.push(`brand_id = $${p++}`);       params.push(brand_id); }
    if (campaign_id) { conditions.push(`campaign_id = $${p++}`);    params.push(campaign_id); }
    if (from)        { conditions.push(`created_at >= $${p++}`);    params.push(from); }
    if (to)          { conditions.push(`created_at <= $${p++}`);    params.push(to); }
    if (search) {
      const term = '%' + search + '%';
      conditions.push(`(message ILIKE $${p} OR event_type ILIKE $${p} OR user_email ILIKE $${p})`);
      params.push(term);
      p++;
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await query(
      `SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );
    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM audit_events ${where}`,
      params
    );
    return { events: rows, total: parseInt(countRows[0].count, 10) };
  } catch (err) {
    console.warn('[auditService] getAuditEvents failed (table may not exist yet):', err.message);
    return { events: [], total: 0 };
  }
}

module.exports = { logEvent, getAuditEvents };
