# AdFlow

Minimal authentication prototype — Phase 1.

## Stack

- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Node.js + Express
- **Auth/DB**: Supabase

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Authentication → Providers** and ensure Email is enabled
3. Copy your **Project URL** and **anon/public key** (for frontend)
4. Copy your **service_role key** (for backend — keep secret)

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

### 3. Backend

```bash
cd backend
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Frontend runs on http://localhost:5173
Backend runs on http://localhost:3001

## Project Structure

```
meta-ads-generator/
├── frontend/
│   └── src/
│       ├── components/ui/   # Reusable UI primitives
│       ├── context/         # AuthContext (session + isAdmin)
│       ├── hooks/           # useAuth
│       ├── layouts/         # AuthLayout, AppLayout
│       ├── lib/             # Supabase client
│       ├── pages/           # LoginPage, SignupPage, DashboardPage
│       └── styles/
└── backend/
    └── src/
        ├── lib/             # Supabase server client
        ├── middleware/      # auth, errorHandler
        ├── routes/          # health
        └── utils/           # logger
```

## Admin

Admin detection is handled client-side in `AuthContext`. Emails in `ADMIN_EMAILS` get `isAdmin = true` and an Admin badge in the navbar.
