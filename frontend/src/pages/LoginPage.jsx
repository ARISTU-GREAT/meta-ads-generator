import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthLayout from '../layouts/AuthLayout'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  function validate() {
    const errs = {}
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Enter a valid email.'
    if (!form.password) errs.password = 'Password is required.'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    const { error } = await signIn({ email: form.email, password: form.password })
    setLoading(false)

    if (error) {
      setServerError(error.message || 'Invalid credentials. Please try again.')
      return
    }

    navigate('/dashboard')
  }

  function handleChange(field) {
    return (e) => {
      setForm(f => ({ ...f, [field]: e.target.value }))
      if (errors[field]) setErrors(errs => ({ ...errs, [field]: '' }))
    }
  }

  return (
    <AuthLayout>
      <div className="animate-slide-up">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Welcome back</h1>
          <p className="text-sm text-text-secondary mt-1.5">Sign in to your AdFlow account</p>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-6 shadow-xl shadow-black/20">
          {serverError && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange('email')}
              error={errors.email}
              autoComplete="email"
              autoFocus
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange('password')}
              error={errors.password}
              autoComplete="current-password"
            />

            <Button type="submit" loading={loading} className="mt-2">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="text-center mt-5 text-sm text-text-secondary">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="text-accent hover:text-accent-hover font-medium transition-colors">
            Create account
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
