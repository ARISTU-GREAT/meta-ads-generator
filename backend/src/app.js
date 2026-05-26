import express from 'express'
import cors from 'cors'
import healthRouter from './routes/health.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'

const app = express()

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api/health', healthRouter)

app.use(notFound)
app.use(errorHandler)

export default app
