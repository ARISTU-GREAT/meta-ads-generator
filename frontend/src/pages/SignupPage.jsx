import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import AuthLayout from '../layouts/AuthLayout'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'

export default function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function validate() {
    const errs = {}
    if (!form.fullName.trim()) errs.fullName = 'Full name is required.'
    else if (form.fullName.trim().length < 2) errs.fullName = 'Enter your full name.'
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Enter a valid email.'
    if (!form.password) errs.password = 'Password is required.'
    else if (form.password.length < 8) errs.password = 'Password must be at least 8 characters.'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setServerError('')
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    const { data, error } = await signUp({
      email: form.email,
      password: form.password,
      fullName: form.fullName.trim(),
    })
    setLoading(false)

    if (error) {
      setServerError(error.message || 'Something went wrong. Please try again.')
      return
    }

    if (data?.session) {
      navigate('/dashboard')
    } else {
      setSuccess(true)
    }
  }

  function handleChange(field) {
    return (e) => {
      setForm(f => ({ ...f, [field]: e.target.value }))
      if (errors[field]) setErrors(errs => ({ ...errs, [field]: '' }))
    }
  }

  if (success) {
    return (
      <AuthLayout>
        <div className="animate-slide-up text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Check your email</h2>
          <p className="text-sm text-text-secondary">
            We sent a confirmation link to <span className="text-text-primary">{form.email}</span>.
            Click the link to activate your account.
          </p>
          <Link to="/login" className="inline-block mt-6 text-sm text-accent hover:text-accent-hover font-medium transition-colors">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="animate-slide-up">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Create your account</h1>
          <p className="text-sm text-text-secondary mt-1.5">Start using AdFlow today</p>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-6 shadow-xl shadow-black/20">
          {serverError && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Full name"
              type="text"
              placeholder="Alex Johnson"
              value={form.fullName}
              onChange={handleChange('fullName')}
              error={errors.fullName}
              autoComplete="name"
              autoFocus
            />
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange('email')}
              error={errors.email}
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={handleChange('password')}
              error={errors.password}
              autoComplete="new-password"
            />

            <Button type="submit" loading={loading} className="mt-2">
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </div>

        <p className="text-center mt-5 text-sm text-text-secondary">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:text-accent-hover font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
