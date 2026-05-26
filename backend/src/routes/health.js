import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'adflow-backend',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  })
})

export default router
