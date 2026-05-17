const express     = require('express');
const router      = express.Router();
const jobService  = require('../services/jobService');
const { asyncHandler } = require('../utils/errors');

// GET /api/jobs
router.get('/', asyncHandler(async (req, res) => {
  const { brand_id, status, limit = 20, offset = 0 } = req.query;
  res.json({ success: true, data: await jobService.getJobs({ brand_id, status, limit: +limit, offset: +offset }) });
}));

// GET /api/jobs/:id  — includes generated_ads
router.get('/:id', asyncHandler(async (req, res) => {
  const job = await jobService.getJobById(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  res.json({ success: true, data: job });
}));

// POST /api/jobs  — enqueue a generation job
router.post('/', asyncHandler(async (req, res) => {
  const job = await jobService.createJob(req.body);
  res.status(201).json({ success: true, data: job });
}));

// PUT /api/jobs/:id/cancel
router.put('/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await jobService.cancelJob(req.params.id) });
}));

// PUT /api/jobs/:id/retry
router.put('/:id/retry', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await jobService.retryJob(req.params.id) });
}));

module.exports = router;
