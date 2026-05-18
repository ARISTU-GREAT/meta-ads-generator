/* ─────────────────────────────────────────────────────────────
   AdFlow Campaign Studio — Frontend
   Vanilla JS SPA, no build step
   ───────────────────────────────────────────────────────────── */

// ── Auth ─────────────────────────────────────────────────────
const Auth = (() => {
  function showApp() {
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('app-shell')?.classList.remove('hidden');
  }

  // Reset all login/signup button states, then show login screen.
  // Safe to call from anywhere — including inside App — without leaving UI stuck.
  function showLoginScreen(mode = 'login') {
    // Reset login button
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Sign In'; }
    // Reset signup button
    const signupBtn = document.getElementById('signup-btn');
    if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = 'Create Admin Account'; }
    // Clear error messages
    const loginErr  = document.getElementById('login-error');
    const signupErr = document.getElementById('signup-error');
    if (loginErr)  { loginErr.textContent  = ''; loginErr.classList.add('hidden'); }
    if (signupErr) { signupErr.textContent = ''; signupErr.classList.add('hidden'); }

    document.getElementById('login-screen')?.classList.remove('hidden');
    document.getElementById('app-shell')?.classList.add('hidden');
    showMode(mode);
  }

  // Switch between 'login' and 'signup' form modes
  function showMode(mode) {
    const isSignup = mode === 'signup';
    document.getElementById('form-login')?.classList.toggle('hidden', isSignup);
    document.getElementById('form-signup')?.classList.toggle('hidden', !isSignup);
    document.getElementById('ltab-login')?.classList.toggle('active', !isSignup);
    document.getElementById('ltab-signup')?.classList.toggle('active', isSignup);
    // Focus first input of visible form
    const focusId = isSignup ? 'signup-email' : 'login-email';
    document.getElementById(focusId)?.focus();
  }

  async function check() {
    try {
      const [statusRes, meRes] = await Promise.all([
        fetch('/api/auth/status', { credentials: 'include' }),
        fetch('/api/auth/me',     { credentials: 'include' }),
      ]);
      const status = await statusRes.json();
      const me     = await meRes.json();

      if (me.authenticated) {
        showApp();
        if (me.isAdmin) {
          var adminBtn = document.getElementById('btn-admin');
          if (adminBtn) adminBtn.classList.remove('hidden');
        }
        App.init();
        return;
      }

      // Tabs are always visible; default mode depends on whether any account exists.
      if (!status.hasAdmin) {
        showLoginScreen('signup');
      } else {
        showLoginScreen('login');
      }
    } catch {
      showLoginScreen('login');
    }
  }

  async function submitLogin(e) {
    e.preventDefault();
    const btn   = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    errEl.classList.add('hidden');
    errEl.textContent = '';
    btn.disabled    = true;
    btn.textContent = 'Signing in…';

    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      // Reset button before showing app so it's ready if login screen reappears
      btn.disabled    = false;
      btn.textContent = 'Sign In';
      showApp();
      App.init();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Sign In';
    }
  }

  async function submitSignup(e) {
    e.preventDefault();
    const btn     = document.getElementById('signup-btn');
    const errEl   = document.getElementById('signup-error');
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm  = document.getElementById('signup-confirm').value;

    errEl.classList.add('hidden');
    errEl.textContent = '';

    if (password.length < 8) {
      errEl.textContent = 'Password must be at least 8 characters';
      errEl.classList.remove('hidden');
      return;
    }
    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Creating account…';

    try {
      const res  = await fetch('/api/auth/signup', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      // Reset button before showing app so it's ready if login screen reappears
      btn.disabled    = false;
      btn.textContent = 'Create Admin Account';
      showApp();
      App.init();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Create Admin Account';
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    document.getElementById('login-password').value = '';
    // Re-check status so tabs show correctly (signup if no admin, login if admin exists)
    check();
  }

  document.addEventListener('DOMContentLoaded', check);

  return { submitLogin, submitSignup, logout, showMode, showLoginScreen };
})();

const App = (() => {

  // ── Workspace State Machine ──────────────────────────────────
  // Must be defined before state so state initializer can reference WS.EMPTY
  const WS = {
    EMPTY:      'empty',      // no campaign, or campaign has no content
    PLANNING:   'planning',   // concept plan generated, showing plan tab
    GENERATING: 'generating', // AI generation in progress
    BOARD:      'board',      // generation complete, board is primary view
  };

  // ── State ────────────────────────────────────────────────────
  const state = {
    brands:         [],
    activeBrand:    null,
    campaigns:      [],
    activeCampaign: null,
    personas:       [],
    formats:        [],       // from /api/concepts/formats
    boardAds:       [],       // raw ads for active campaign
    boardFiltered:  [],       // after search/filter
    activeTab:       'remix',
    newCampaignMode: 'remix',
    brandTab:        'overview',
    workspaceState:  WS.EMPTY,
    workspaceTab:    'board',
    speedMode:       'balanced',
    generation: {
      active:    false,
      total:     0,
      completed: 0,
      batchId:   null,
    },
    remix: {
      referenceFile:     null,
      referenceAssetId:  null,
      referenceAssetUrl: null,
      productFile:       null,
      productAssetId:    null,
      productAssetUrl:   null,
      aspectRatio:       'square',
      outputVolume:      5,
      lastStrategy:      null,
    },
    concepts: {
      productFile:       null,
      productAssetId:    null,
      productAssetUrl:   null,
      plan:              null,
      selectedFormatIds: [],
      selectedPersonaIds:[],
      conceptCount:      5,
      outputVolume:      20,
      aspectRatio:       'square',
    },
    studio: {
      ad:     null,
      adData: null,
    },
    genMode: 'image',  // 'image' | 'editable'
    memoryFilter: '',
    avoidInstructions: '',   // shared across remix + concepts, persisted to localStorage
    showAvoidSection: true,  // both panels default to open
  };

  // ── Constants ────────────────────────────────────────────────
  const BRAND_KIT_REQUIRED = ['name', 'description', 'primary_color', 'secondary_color', 'target_audience', 'brand_voice'];
  const BRAND_KIT_LABELS   = { name: 'Brand Name', description: 'Description', primary_color: 'Primary Color', secondary_color: 'Secondary Color', target_audience: 'Target Audience', brand_voice: 'Brand Voice' };


  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Auth cache — avoids calling /api/auth/me on every 401 within a short window
  let _authCacheValid = false;
  let _authCacheTime  = 0;
  const AUTH_CACHE_TTL = 10_000;

  async function _cachedAuthCheck() {
    const now = Date.now();
    if (_authCacheValid && now - _authCacheTime < AUTH_CACHE_TTL) return true;
    const me = await fetch('/api/auth/me', { credentials: 'include' }).then(x => x.json()).catch(() => ({}));
    if (me.authenticated) {
      _authCacheValid = true;
      _authCacheTime  = now;
      return true;
    }
    _authCacheValid = false;
    return false;
  }

  function _invalidateAuthCache() { _authCacheValid = false; _authCacheTime = 0; }

  // ── API Helpers ──────────────────────────────────────────────
  async function _handleApiResponse(r) {
    if (r.status === 401) {
      const authed = await _cachedAuthCheck();
      if (!authed) {
        _invalidateAuthCache();
        Auth.showLoginScreen('login');
        throw new Error('Session expired. Please sign in again.');
      }
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  }

  const api = {
    async get(path) {
      const r = await fetch(`/api${path}`, { credentials: 'include' });
      return _handleApiResponse(r);
    },
    async post(path, body) {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return _handleApiResponse(r);
    },
    async put(path, body) {
      const r = await fetch(`/api${path}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return _handleApiResponse(r);
    },
    async delete(path) {
      const r = await fetch(`/api${path}`, { method: 'DELETE', credentials: 'include' });
      return _handleApiResponse(r);
    },
    async upload(path, formData) {
      const r = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData });
      return _handleApiResponse(r);
    },
  };

  // ── Toast ────────────────────────────────────────────────────
  function toast(msg, type = 'success') {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  // ── Brand Kit Completeness ───────────────────────────────────
  function checkBrandKitComplete(brand) {
    const missing = brand
      ? BRAND_KIT_REQUIRED.filter(f => !brand[f] || !String(brand[f]).trim())
      : BRAND_KIT_REQUIRED;
    const complete = missing.length === 0;

    // Banner in left panel
    const banner = document.getElementById('brand-kit-banner');
    if (banner) banner.classList.toggle('hidden', complete || !brand);

    // Badge in topbar
    const badge = document.getElementById('brand-kit-badge');
    if (badge) badge.classList.toggle('hidden', complete || !brand);

    // Disable/enable generate buttons
    const generateBtns = [
      document.getElementById('btn-remix-generate'),
      document.getElementById('btn-concept-plan'),
      document.getElementById('btn-generate-all'),
    ];
    generateBtns.forEach(btn => {
      if (btn) btn.disabled = !complete || !brand;
    });

    // Stat in right panel
    const kitStat = document.getElementById('stat-brand-kit');
    if (kitStat) {
      if (!brand) {
        kitStat.textContent = '—';
        kitStat.style.color = '';
      } else if (complete) {
        kitStat.textContent = '✓ Complete';
        kitStat.style.color = 'var(--success)';
      } else {
        kitStat.textContent = `${missing.length} missing`;
        kitStat.style.color = 'var(--warning)';
      }
    }

    // Kit status bar inside the brand setup modal
    const statusBar  = document.getElementById('kit-status-bar');
    const statusIcon = document.getElementById('kit-status-icon');
    const statusText = document.getElementById('kit-status-text');
    if (statusBar && brand) {
      if (complete) {
        statusBar.className = 'kit-status-bar complete';
        if (statusIcon) statusIcon.textContent = '●';
        if (statusText) statusText.textContent = 'Brand Kit complete — generation unlocked';
      } else {
        statusBar.className = 'kit-status-bar incomplete';
        if (statusIcon) statusIcon.textContent = '●';
        const missingLabels = missing.map(f => BRAND_KIT_LABELS[f]).join(', ');
        if (statusText) statusText.textContent = `Missing: ${missingLabels}`;
      }
    }

    return complete;
  }

  // ── Workspace State Machine ──────────────────────────────────
  function setWorkspaceState(ws) {
    if (state.workspaceState === ws) return;
    state.workspaceState = ws;

    // Pulsing generation indicator
    document.getElementById('ws-gen-indicator')?.classList.toggle('hidden', ws !== WS.GENERATING);

    // Auto-tab routing
    if (ws === WS.GENERATING) switchWorkspaceTab('board');  // always watch generation on board
    if (ws === WS.PLANNING)   switchWorkspaceTab('plan');   // show plan after concept generation

    // Concept plan panel visibility
    _syncConceptPlanPanel();
  }

  function switchWorkspaceTab(tab) {
    state.workspaceTab = tab;
    document.getElementById('wtab-board')?.classList.toggle('active', tab === 'board');
    document.getElementById('wtab-plan')?.classList.toggle('active',  tab === 'plan');
    document.getElementById('ws-panel-board')?.classList.toggle('hidden', tab !== 'board');
    document.getElementById('ws-panel-plan')?.classList.toggle('hidden',  tab !== 'plan');
  }

  function _syncConceptPlanPanel() {
    const hasPlan = state.concepts.plan?.length > 0;
    // Show/hide Concept Plan tab
    document.getElementById('wtab-plan')?.classList.toggle('hidden', !hasPlan);
    // Within the plan panel: show empty state or workspace
    document.getElementById('concept-plan-empty')?.classList.toggle('hidden', hasPlan);
    document.getElementById('concept-plan-workspace')?.classList.toggle('hidden', !hasPlan);
    // Update plan badge
    const planBadge = document.getElementById('ws-plan-badge');
    if (planBadge) {
      planBadge.textContent = hasPlan ? state.concepts.plan.length : '';
      planBadge.classList.toggle('hidden', !hasPlan);
    }
  }

  // ── Dropdown helpers ─────────────────────────────────────────
  function toggleDropdown(id) {
    const el = document.getElementById(id);
    const open = !el.classList.contains('hidden');
    closeAllDropdowns();
    if (!open) el.classList.remove('hidden');
  }
  function closeAllDropdowns() {
    document.querySelectorAll('.switcher-dropdown').forEach(d => d.classList.add('hidden'));
  }

  // ── Modal helpers ────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }
  // ── Brands ──────────────────────────────────────────────────
  async function loadBrands() {
    try {
      const { data } = await api.get('/brands');
      state.brands = data || [];
      renderBrandDropdown();
      if (state.brands.length > 0 && !state.activeBrand) {
        selectBrand(state.brands[0]);
      }
    } catch (e) { console.error('loadBrands:', e.message); }
  }

  function renderBrandDropdown() {
    const list = document.getElementById('brand-dropdown-list');
    if (!list) return;
    if (!state.brands.length) {
      list.innerHTML = '<div style="padding:8px 10px;font-size:0.8125rem;color:var(--text-3);">No brands yet</div>';
      return;
    }
    list.innerHTML = state.brands.map(b => `
      <div class="dropdown-item ${state.activeBrand?.id === b.id ? 'active' : ''}"
           onclick="App.selectBrandById('${b.id}');App.closeAllDropdowns()">
        <span class="dropdown-item-name">${esc(b.name)}</span>
        <span class="dropdown-item-sub">${esc(b.industry || '')}</span>
      </div>`).join('');
  }

  function selectBrandById(id) {
    const brand = state.brands.find(b => b.id === id);
    if (brand) selectBrand(brand);
  }

  function selectBrand(brand) {
    state.activeBrand = brand;
    state.activeCampaign = null;
    state.boardAds = [];
    state.boardFiltered = [];
    state.concepts.plan = null;
    setWorkspaceState(WS.EMPTY);

    // Update topbar
    const nameEl = document.getElementById('topbar-brand-name');
    if (nameEl) nameEl.textContent = brand.name;
    const dot = document.getElementById('brand-dot');
    if (dot && brand.primary_color) dot.style.background = brand.primary_color;

    // Update brand setup form
    setVal('edit-brand-name',                    brand.name);
    setVal('edit-brand-industry',                brand.industry);
    setVal('edit-brand-description',             brand.description);
    setVal('edit-brand-color',                   brand.primary_color);
    setVal('edit-brand-secondary-color',         brand.secondary_color);
    setVal('edit-brand-target-audience',         brand.target_audience);
    setVal('edit-brand-voice',                   brand.brand_voice);
    setVal('edit-brand-offer-cta',               brand.offer_cta);
    setVal('edit-brand-primary-font',            brand.primary_font);
    setVal('edit-brand-secondary-font',          brand.secondary_font);
    setVal('edit-brand-headline-style',          brand.headline_style);
    setVal('edit-brand-typography-personality',  brand.typography_personality);
    _renderTypographyPreview(brand);

    checkBrandKitComplete(brand);
    renderBrandDropdown();
    loadCampaigns(brand.id);
    loadPersonas(brand.id);
    renderBoard();
    updateCampaignSwitcher();
  }

  async function submitNewBrand() {
    const name = getVal('new-brand-name').trim();
    if (!name) return toast('Brand name is required', 'error');
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
      const { data } = await api.post('/brands', {
        name,
        slug,
        industry:    getVal('new-brand-industry'),
        description: getVal('new-brand-description'),
        primary_color: getVal('new-brand-color') || null,
      });
      state.brands.unshift(data);
      closeModal('modal-new-brand');
      clearInputs(['new-brand-name','new-brand-industry','new-brand-description','new-brand-color']);
      selectBrand(data);
      toast(`Brand "${data.name}" created — complete Brand Setup to unlock generation`);
      // Auto-open Brand Setup so the user can fill in required fields
      openBrandSetup();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function saveBrand() {
    if (!state.activeBrand) return;
    try {
      const { data } = await api.put(`/brands/${state.activeBrand.id}`, {
        name:                    getVal('edit-brand-name'),
        industry:                getVal('edit-brand-industry'),
        description:             getVal('edit-brand-description'),
        primary_color:           getVal('edit-brand-color')                   || null,
        secondary_color:         getVal('edit-brand-secondary-color')         || null,
        target_audience:         getVal('edit-brand-target-audience')         || null,
        brand_voice:             getVal('edit-brand-voice')                   || null,
        offer_cta:               getVal('edit-brand-offer-cta')               || null,
        primary_font:            getVal('edit-brand-primary-font')            || null,
        secondary_font:          getVal('edit-brand-secondary-font')          || null,
        headline_style:          getVal('edit-brand-headline-style')          || null,
        typography_personality:  getVal('edit-brand-typography-personality')  || null,
      });
      state.activeBrand = data;
      const idx = state.brands.findIndex(b => b.id === data.id);
      if (idx >= 0) state.brands[idx] = data;
      document.getElementById('topbar-brand-name').textContent = data.name;
      checkBrandKitComplete(data);
      _renderTypographyPreview(data);
      renderBrandDropdown();
      toast('Brand saved');
    } catch (e) { toast(e.message, 'error'); }
  }

  // Render the typography preview chip bar inside Brand Setup
  function _renderTypographyPreview(brand) {
    const container = document.getElementById('typography-preview-chips');
    if (!container) return;

    const parts = [
      brand.primary_font    ? brand.primary_font.split(',')[0].trim().toUpperCase() : null,
      brand.headline_style  ? brand.headline_style.toUpperCase()                    : null,
      brand.secondary_font  ? brand.secondary_font.split(',')[0].trim().toUpperCase() : null,
    ].filter(Boolean);

    if (!parts.length) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    container.innerHTML = parts.map((p, i) =>
      (i > 0 ? '<span class="typography-chip-sep">•</span>' : '') +
      `<span class="typography-chip">${p}</span>`
    ).join('');
  }

  // ── Personas ─────────────────────────────────────────────────
  async function loadPersonas(brandId) {
    try {
      const { data } = await api.get(`/brands/${brandId}/personas`);
      state.personas = data || [];
      renderPersonaChips();
    } catch {}
  }

  function renderPersonaChips() {
    const el = document.getElementById('concept-persona-chips');
    if (!el) return;
    if (!state.personas.length) {
      el.innerHTML = '<span style="font-size:0.75rem;color:var(--text-3);">No personas — add via Brand Setup</span>';
      return;
    }
    el.innerHTML = state.personas.map(p => `
      <button class="persona-chip ${state.concepts.selectedPersonaIds.includes(p.id) ? 'selected' : ''}"
              onclick="App.togglePersona('${p.id}')">${esc(p.name)}</button>
    `).join('');
  }

  function togglePersona(id) {
    const ids = state.concepts.selectedPersonaIds;
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    renderPersonaChips();
  }

  function renderBrandPersonasList() {
    const el = document.getElementById('brand-personas-list');
    if (!el) return;
    if (!state.personas.length) {
      el.innerHTML = '<div class="loading-text">No personas yet.</div>';
      return;
    }
    el.innerHTML = state.personas.map(p => `
      <div class="persona-item">
        <div>
          <div class="persona-item-name">${esc(p.name)}</div>
          <div class="persona-item-meta">${[p.age_range, p.gender].filter(Boolean).join(' · ')}${p.description ? ' — ' + esc(p.description.slice(0, 80)) : ''}</div>
        </div>
      </div>`).join('');
  }

  function openCreatePersonaModal() { openModal('modal-create-persona'); }

  async function submitNewPersona() {
    const name = getVal('new-persona-name').trim();
    if (!name || !state.activeBrand) return toast('Name required', 'error');
    try {
      const { data } = await api.post('/brands/' + state.activeBrand.id + '/personas', {
        name,
        age_range: getVal('new-persona-age'),
        gender:    getVal('new-persona-gender'),
        description: getVal('new-persona-desc'),
      });
      state.personas.push(data);
      closeModal('modal-create-persona');
      clearInputs(['new-persona-name','new-persona-age','new-persona-gender','new-persona-desc']);
      renderPersonaChips();
      renderBrandPersonasList();
      toast('Persona added');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Campaigns ────────────────────────────────────────────────
  async function loadCampaigns(brandId) {
    try {
      const { data } = await api.get(`/campaigns?brand_id=${brandId}`);
      state.campaigns = data || [];
      updateCampaignSwitcher();
    } catch {}
  }

  function updateCampaignSwitcher() {
    const nameEl = document.getElementById('topbar-campaign-name');
    if (nameEl) {
      nameEl.textContent   = state.activeCampaign ? state.activeCampaign.name : 'No Campaign';
      nameEl.className     = state.activeCampaign ? '' : 'text-muted-sm';
    }
    const list = document.getElementById('campaign-dropdown-list');
    if (!list) return;
    if (!state.campaigns.length) {
      list.innerHTML = '<div style="padding:8px 10px;font-size:0.8125rem;color:var(--text-3);">No campaigns yet</div>';
      return;
    }
    list.innerHTML = state.campaigns.map(c => `
      <div class="dropdown-item ${state.activeCampaign?.id === c.id ? 'active' : ''}"
           onclick="App.selectCampaignById('${c.id}');App.closeAllDropdowns()">
        <span class="dropdown-item-name">${esc(c.name)}</span>
        <span class="dropdown-item-sub">${c.ad_count || 0} ads · ${esc(c.mode)}</span>
      </div>`).join('');
  }

  function selectCampaignById(id) {
    const c = state.campaigns.find(c => c.id === id);
    if (c) selectCampaign(c);
  }

  function selectCampaign(campaign) {
    state.activeCampaign = campaign;
    state.boardAds = [];
    state.boardFiltered = [];
    state.concepts.plan = null;  // clear old concept plan when switching campaigns
    updateCampaignSwitcher();
    updatePanelHeader();
    if (campaign.mode) switchTab(campaign.mode);
    setWorkspaceState(WS.EMPTY);
    switchWorkspaceTab('board');
    _syncConceptPlanPanel();
    loadCampaignAds(campaign.id);
  }

  function updatePanelHeader() {
    const c = state.activeCampaign;
    setEl('panel-campaign-name',   c ? c.name : 'No Campaign');
    setEl('panel-campaign-status', c ? c.status : '');
    const badge = document.getElementById('panel-mode-badge');
    if (badge) {
      badge.textContent = c ? c.mode : '';
      badge.style.display = c ? '' : 'none';
    }
  }

  function selectNewCampaignMode(mode) {
    state.newCampaignMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  async function createCampaign() {
    const name = getVal('new-campaign-name').trim();
    if (!name)                return toast('Campaign name is required', 'error');
    if (!state.activeBrand)   return toast('Select a brand first', 'error');
    try {
      const { data } = await api.post('/campaigns', {
        brand_id: state.activeBrand.id,
        name,
        mode:     state.newCampaignMode,
      });
      state.campaigns.unshift(data);
      closeModal('modal-new-campaign');
      clearInputs(['new-campaign-name']);
      selectCampaign(data);
      updateCampaignSwitcher();
      toast(`Campaign "${data.name}" created`);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Campaign Board ───────────────────────────────────────────
  async function loadCampaignAds(campaignId) {
    try {
      const { data } = await api.get(`/campaigns/${campaignId}/ads`);
      state.boardAds = data || [];
      applyBoardFilter();
      renderBoard();
      if (state.boardAds.length > 0) {
        setWorkspaceState(WS.BOARD);
        switchWorkspaceTab('board');
      }
    } catch (e) { console.error('loadCampaignAds:', e.message); }
  }

  function applyBoardFilter() {
    const search = (document.getElementById('board-search')?.value || '').toLowerCase();
    const filter = document.getElementById('board-filter')?.value || 'all';
    state.boardFiltered = state.boardAds.filter(ad => {
      const matchStatus = filter === 'all' || ad.status === filter;
      const matchSearch = !search ||
        (ad.image_prompt || '').toLowerCase().includes(search) ||
        (ad.ad_format    || '').toLowerCase().includes(search) ||
        (ad.status       || '').toLowerCase().includes(search);
      return matchStatus && matchSearch;
    });
  }

  function filterBoard() {
    applyBoardFilter();
    renderBoardCards(state.boardFiltered);
    updateBoardStats();
  }
  const _filterBoardDebounced = debounce(filterBoard, 150);

  function renderBoard() {
    const empty = document.getElementById('board-empty');
    const grid  = document.getElementById('board-grid');
    if (!state.activeCampaign) {
      empty?.classList.remove('hidden');
      grid?.classList.add('hidden');
      updateBoardCount(0);
      return;
    }
    applyBoardFilter();
    const hasContent = state.boardFiltered.length > 0 ||
                       grid?.querySelectorAll('.board-card').length > 0;
    empty?.classList.toggle('hidden', hasContent);
    grid?.classList.toggle('hidden', !hasContent);
    renderBoardCards(state.boardFiltered);
    updateBoardStats();
  }

  const BOARD_PAGE_SIZE = 50;
  let _boardRenderedCount = 0;

  function renderBoardCards(ads) {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    const skeletons = Array.from(grid.querySelectorAll('.board-card.skeleton'));
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    skeletons.forEach(s => frag.appendChild(s));
    const page = ads.slice(0, BOARD_PAGE_SIZE);
    page.forEach(ad => frag.appendChild(buildBoardCard(ad)));
    _boardRenderedCount = page.length;
    grid.appendChild(frag);
    updateBoardCount(ads.length + skeletons.length);
    _syncLoadMoreButton(ads);
  }

  function _syncLoadMoreButton(ads) {
    let btn = document.getElementById('board-load-more');
    const remaining = ads.length - _boardRenderedCount;
    if (remaining > 0) {
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'board-load-more';
        btn.className = 'btn-load-more';
        btn.addEventListener('click', () => _appendBoardPage(ads));
        document.getElementById('board-grid')?.insertAdjacentElement('afterend', btn);
      } else {
        btn.onclick = null;
        btn.addEventListener('click', () => _appendBoardPage(ads), { once: true });
      }
      const showing = Math.min(remaining, BOARD_PAGE_SIZE);
      btn.textContent = `Load ${showing} more (${remaining} remaining)`;
      btn.style.display = '';
    } else if (btn) {
      btn.style.display = 'none';
    }
  }

  function _appendBoardPage(ads) {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    const frag = document.createDocumentFragment();
    const page = ads.slice(_boardRenderedCount, _boardRenderedCount + BOARD_PAGE_SIZE);
    page.forEach(ad => frag.appendChild(buildBoardCard(ad)));
    _boardRenderedCount += page.length;
    grid.appendChild(frag);
    _syncLoadMoreButton(ads);
  }

  function buildBoardCard(ad) {
    const metadata = safeJSON(ad.metadata) || {};
    const strategy = metadata.strategy || {};
    const format   = ad.ad_format || strategy.layout_type || 'ad';
    const energy   = strategy.ad_energy || '';

    const card = document.createElement('div');
    card.className = 'board-card';
    card.dataset.adId = ad.id;
    const imgSrc = resolveAdImage(ad);
    const isEditableDesign = !ad.image_url && metadata.source_mode === 'layout_first';
    const previewColor     = metadata.preview_color || '#1a1a2e';
    card.innerHTML = `
      <div class="board-card-img-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="Ad" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="board-card-img-fail hidden">Preview unavailable</div>`
          : isEditableDesign
            ? `<div class="board-card-editable" style="background:${esc(previewColor)};"><span>✏️</span><span>Editable Design</span></div>`
            : '<div class="board-card-img-fail">No image</div>'}
        <div class="board-card-overlay">
          <button class="board-card-action" onclick="event.stopPropagation();App.downloadAd('${ad.id}')">↓</button>
          <button class="board-card-action" onclick="event.stopPropagation();App.approveAd('${ad.id}')">✓</button>
        </div>
      </div>
      <div class="board-card-footer">
        <div class="board-card-tags">
          ${format ? `<span class="board-card-tag">${esc(format.replace(/_/g,' '))}</span>` : ''}
          ${energy ? `<span class="board-card-tag" style="background:var(--surface-2);color:var(--text-3);">${esc(energy)}</span>` : ''}
        </div>
        <span class="board-card-status status-${ad.status || 'draft'}"></span>
      </div>`;
    card.addEventListener('click', () => openStudio(ad));
    return card;
  }

  function updateBoardCount(n) {
    const badge = document.getElementById('ws-board-badge');
    if (badge) {
      badge.textContent = n > 0 ? n : '';
      badge.classList.toggle('hidden', n === 0);
    }
  }

  function updateBoardStats() {
    const ads = state.boardAds;
    setEl('stat-total',    ads.length);
    setEl('stat-draft',    ads.filter(a => a.status === 'draft').length);
    setEl('stat-approved', ads.filter(a => a.status === 'approved').length);
  }

  // ── Generation Progress ─────────────────────────────────────
  function startGenerationProgress(total) {
    state.generation.active    = true;
    state.generation.total     = total;
    state.generation.completed = 0;
    updateGenerationProgress(0, total);
  }

  function updateGenerationProgress(done, total) {
    const el = document.getElementById('ws-gen-indicator-text');
    if (el) el.textContent = `Generating ${done} / ${total} ads`;
  }

  function endGenerationProgress() {
    state.generation.active = false;
  }

  // ── Avoid While Generating ───────────────────────────────────

  const AVOID_LS_KEY = 'adflow_avoid_instructions';

  function toggleAvoidSection(panel) {
    var section = document.getElementById('avoid-section-' + panel);
    var body    = document.getElementById('avoid-body-' + panel);
    if (!body) return;
    var isOpen = !body.classList.contains('hidden');
    body.classList.toggle('hidden', isOpen);
    if (section) section.classList.toggle('open', !isOpen);
  }

  function _autoExpandTextarea(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function onAvoidInput(textarea) {
    var val = textarea.value;
    state.avoidInstructions = val;
    // Sync the other panel's textarea
    var otherId = textarea.id === 'remix-avoid' ? 'concept-avoid' : 'remix-avoid';
    var other   = document.getElementById(otherId);
    if (other && other !== textarea) {
      other.value = val;
      _autoExpandTextarea(other);
    }
    _autoExpandTextarea(textarea);
    _updateAvoidCounter('avoid-counter-remix',   val);
    _updateAvoidCounter('avoid-counter-concept', val);
    _syncAvoidChips();
    _updateAvoidHints();
    try { localStorage.setItem(AVOID_LS_KEY, val); } catch (_) {}
  }

  function toggleAvoidChip(value) {
    var current = state.avoidInstructions || '';
    var items   = current.length
      ? current.split(/[,\n]+/).map(function(s) { return s.trim(); }).filter(Boolean)
      : [];
    var lv  = value.toLowerCase();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].toLowerCase() === lv) { idx = i; break; }
    }
    if (idx >= 0) {
      items.splice(idx, 1);
    } else {
      items.push(value);
    }
    var newVal = items.join(', ');
    state.avoidInstructions = newVal;
    var ta1 = document.getElementById('remix-avoid');
    var ta2 = document.getElementById('concept-avoid');
    if (ta1) { ta1.value = newVal; _autoExpandTextarea(ta1); }
    if (ta2) { ta2.value = newVal; _autoExpandTextarea(ta2); }
    _updateAvoidCounter('avoid-counter-remix',   newVal);
    _updateAvoidCounter('avoid-counter-concept', newVal);
    _syncAvoidChips();
    _updateAvoidHints();
    try { localStorage.setItem(AVOID_LS_KEY, newVal); } catch (_) {}
  }

  function _updateAvoidCounter(counterId, val) {
    var el  = document.getElementById(counterId);
    var len = (val || '').length;
    if (el) el.textContent = len > 0 ? len + ' chars' : '0 chars';
  }

  function _updateAvoidHints() {
    var items = state.avoidInstructions
      ? state.avoidInstructions.split(/[,\n]+/).map(function(s) { return s.trim(); }).filter(Boolean)
      : [];
    var hint  = items.length ? '(' + items.length + ' rule' + (items.length !== 1 ? 's' : '') + ')' : '';
    var h1 = document.getElementById('avoid-hint-remix');
    var h2 = document.getElementById('avoid-hint-concept');
    if (h1) h1.textContent = hint;
    if (h2) h2.textContent = hint;
  }

  function _syncAvoidChips() {
    var parts = (state.avoidInstructions || '').split(/[,\n]+/)
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(Boolean);
    document.querySelectorAll('.avoid-chip').forEach(function(chip) {
      var val = (chip.dataset.avoid || '').toLowerCase();
      chip.classList.toggle('active', val.length > 0 && parts.indexOf(val) >= 0);
    });
  }

  function _restoreAvoidFromStorage() {
    var saved = '';
    try { saved = localStorage.getItem(AVOID_LS_KEY) || ''; } catch (_) {}
    if (!saved) return;
    state.avoidInstructions = saved;
    var ta1 = document.getElementById('remix-avoid');
    var ta2 = document.getElementById('concept-avoid');
    if (ta1) { ta1.value = saved; _autoExpandTextarea(ta1); }
    if (ta2) { ta2.value = saved; _autoExpandTextarea(ta2); }
    _updateAvoidCounter('avoid-counter-remix',   saved);
    _updateAvoidCounter('avoid-counter-concept', saved);
    _syncAvoidChips();
    _updateAvoidHints();
    // Sections default open; if saved content exists ensure they stay open
    if (saved.trim()) {
      var panels = ['remix', 'concept'];
      panels.forEach(function(p) {
        var section = document.getElementById('avoid-section-' + p);
        var body    = document.getElementById('avoid-body-' + p);
        if (body)    body.classList.remove('hidden');
        if (section) section.classList.add('open');
      });
    }
  }

  // Masonry skeleton heights — vary to look natural before images load
  const SKELETON_HEIGHTS = [200, 270, 230, 310, 245, 185, 290, 215, 260, 195];

  // ── Skeleton Cards (used by concepts flow) ───────────────────
  function addSkeletonCards(count, startIndex) {
    startIndex = startIndex || 0;
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    grid.classList.remove('hidden');
    document.getElementById('board-empty') && document.getElementById('board-empty').classList.add('hidden');

    for (let i = 0; i < count; i++) {
      const idx  = startIndex + i;
      const h    = SKELETON_HEIGHTS[idx % SKELETON_HEIGHTS.length];
      const card = document.createElement('div');
      card.className = 'board-card skeleton';
      card.dataset.skeletonIndex = idx;
      card.innerHTML = `
        <div class="board-card-img-wrap" style="height:${h}px;"></div>
        <div class="board-card-footer"></div>`;
      grid.prepend(card);
    }
    updateBoardCount(grid.querySelectorAll('.board-card').length);
  }

  function replaceSkeletonCard(skeletonIndex, ad) {
    const grid     = document.getElementById('board-grid');
    const skeleton = grid && grid.querySelector('[data-skeleton-index="' + skeletonIndex + '"]');
    if (skeleton && ad) {
      const realCard = buildBoardCard(ad);
      realCard.style.animation = 'card-in 0.4s cubic-bezier(0.16,1,0.3,1) both';
      skeleton.replaceWith(realCard);
    } else if (skeleton) {
      skeleton.remove();
    }
    updateBoardCount((grid && grid.querySelectorAll('.board-card:not(.skeleton)').length) || 0);
    const total = (grid && grid.querySelectorAll('.board-card').length) || 0;
    document.getElementById('board-empty') && document.getElementById('board-empty').classList.toggle('hidden', total > 0);
    grid && grid.classList.toggle('hidden', total === 0);
  }

  // ── Generation Slot Cards (used by remix flow) ───────────────
  // Each slot card tracks one image's lifecycle: queued → processing → retrying → completed/failed

  function _buildSlotCard(slot, slotState, data) {
    const h    = SKELETON_HEIGHTS[slot % SKELETON_HEIGHTS.length];
    const card = document.createElement('div');
    card.className   = 'board-card gen-slot-card';
    card.dataset.genSlot = slot;
    const varLabel = 'Variation ' + (slot + 1);

    let inner = '';
    if (slotState === 'queued') {
      inner = '<div class="slot-card-inner slot-queued" style="height:' + h + 'px">' +
        '<div class="slot-icon">⏳</div>' +
        '<div class="slot-label">Queued</div>' +
        '<div class="slot-sub">' + varLabel + '</div></div>';
    } else if (slotState === 'processing') {
      inner = '<div class="slot-card-inner slot-processing" style="height:' + h + 'px">' +
        '<div class="slot-spinner"></div>' +
        '<div class="slot-label">Generating…</div>' +
        '<div class="slot-sub">' + varLabel + '</div></div>';
    } else if (slotState === 'retrying') {
      const attempt = (data && data.attempt) || 1;
      inner = '<div class="slot-card-inner slot-retrying" style="height:' + h + 'px">' +
        '<div class="slot-icon slot-retry-icon">↺</div>' +
        '<div class="slot-label">Retry ' + attempt + ' / 2</div>' +
        '<div class="slot-sub">' + varLabel + '</div></div>';
    } else if (slotState === 'failed') {
      const errText = esc(((data && data.error) || 'Generation failed').substring(0, 70));
      inner = '<div class="slot-card-inner slot-failed" style="height:' + h + 'px">' +
        '<div class="slot-icon">✕</div>' +
        '<div class="slot-label">Failed</div>' +
        '<div class="slot-sub">' + errText + '</div></div>';
    }

    card.innerHTML = '<div class="board-card-img-wrap">' + inner + '</div>' +
      '<div class="board-card-footer"><div class="board-card-tags">' +
      '<span class="board-card-tag">' + varLabel + '</span></div></div>';
    return card;
  }

  function addGenerationSlotCards(n) {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    grid.classList.remove('hidden');
    document.getElementById('board-empty') && document.getElementById('board-empty').classList.add('hidden');
    // Prepend in reverse so slot 0 ends up at the top of the grid
    for (let i = n - 1; i >= 0; i--) {
      grid.prepend(_buildSlotCard(i, 'queued', null));
    }
    updateBoardCount(grid.querySelectorAll('.board-card').length);
  }

  function updateSlotCard(slot, slotState, data) {
    const grid    = document.getElementById('board-grid');
    const current = grid && grid.querySelector('[data-gen-slot="' + slot + '"]');
    if (!current || current.classList.contains('slot-completed')) return;
    const updated = _buildSlotCard(slot, slotState, data);
    current.replaceWith(updated);
  }

  function replaceSlotCardWithAd(slot, ad) {
    const grid    = document.getElementById('board-grid');
    const current = grid && grid.querySelector('[data-gen-slot="' + slot + '"]');
    const realCard = buildBoardCard(ad);
    realCard.style.animation = 'card-in 0.4s cubic-bezier(0.16,1,0.3,1) both';
    realCard.classList.add('slot-completed');
    if (current) {
      current.replaceWith(realCard);
    } else {
      grid && grid.prepend(realCard);
    }
    const realCount = (grid && grid.querySelectorAll('.board-card:not(.gen-slot-card)').length) || 0;
    updateBoardCount(realCount);
    const total = (grid && grid.querySelectorAll('.board-card').length) || 0;
    document.getElementById('board-empty') && document.getElementById('board-empty').classList.toggle('hidden', total > 0);
    grid && grid.classList.toggle('hidden', total === 0);
  }

  function addScoreBadge(adId, score) {
    const grid = document.getElementById('board-grid');
    const card = grid && grid.querySelector('[data-ad-id="' + adId + '"]');
    if (!card) return;
    const imgWrap = card.querySelector('.board-card-img-wrap');
    if (!imgWrap) return;

    // Remove existing badges
    const old = imgWrap.querySelector('.card-score-badge');
    if (old) old.remove();

    const overall      = score && score.overall ? score.overall : 0;
    const scoreClass   = overall >= 8 ? 'score-high' : overall >= 6 ? 'score-mid' : 'score-low';
    const badge        = document.createElement('div');
    badge.className    = 'card-score-badge ' + scoreClass;
    badge.textContent  = '★ ' + overall.toFixed(1);
    badge.title        = [
      'Overall: '    + overall.toFixed(1),
      'Product: '    + ((score.product_similarity  || 0).toFixed(1)),
      'Logo: '       + ((score.logo_accuracy        || 0).toFixed(1)),
      'Colors: '     + ((score.color_consistency    || 0).toFixed(1)),
      'Clean: '      + ((score.no_hallucinations    || 0).toFixed(1)),
      'Quality: '    + ((score.composition_quality  || 0).toFixed(1)),
    ].join('\n');
    imgWrap.appendChild(badge);

    if (score && score.should_reject) {
      card.classList.add('card-rejected');
      const existing = imgWrap.querySelector('.card-reject-banner');
      if (!existing) {
        const banner = document.createElement('div');
        banner.className   = 'card-reject-banner';
        banner.textContent = '⚠ Low Quality';
        imgWrap.appendChild(banner);
      }
    }
  }

  function markBestCard(adId) {
    const grid = document.getElementById('board-grid');
    const card = grid && grid.querySelector('[data-ad-id="' + adId + '"]');
    if (!card) return;
    card.classList.add('card-best');
    const imgWrap = card.querySelector('.board-card-img-wrap');
    if (imgWrap) {
      const existing = imgWrap.querySelector('.card-best-badge');
      if (!existing) {
        const badge       = document.createElement('div');
        badge.className   = 'card-best-badge';
        badge.textContent = '✦ Best';
        imgWrap.appendChild(badge);
      }
    }
  }

  // ── Tab switching ────────────────────────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;
    document.getElementById('tab-remix')?.classList.toggle('active',    tab === 'remix');
    document.getElementById('tab-concepts')?.classList.toggle('active', tab === 'concepts');
    document.getElementById('panel-remix')?.classList.toggle('hidden',    tab !== 'remix');
    document.getElementById('panel-concepts')?.classList.toggle('hidden', tab !== 'concepts');
  }

  // ── Remix Drop Zones ─────────────────────────────────────────
  function initRemixDropZones() {
    setupDropZone('ref-drop',          'ref-file-input',     'ref-preview-wrap',          'referenceFile', state.remix,    'remix-ref');
    setupDropZone('prod-drop',         'prod-file-input',    'prod-preview-wrap',         'productFile',   state.remix,    'remix-prod');
    setupDropZone('concept-prod-drop', 'concept-prod-input', 'concept-prod-preview-wrap', 'productFile',   state.concepts, 'concept-prod');
  }

  function setupDropZone(zoneId, inputId, previewId, stateKey, stateObj, target) {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click',    () => input.click());
    input.addEventListener('change',  () => { if (input.files[0]) applyDropFile(stateObj, stateKey, input.files[0], previewId, zone, target); });
    zone.addEventListener('dragover', e  => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop',     e  => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) applyDropFile(stateObj, stateKey, f, previewId, zone, target);
    });
  }

  function applyDropFile(stateObj, stateKey, file, previewId, zone, target) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      return toast('Use JPG, PNG, or WebP', 'error');
    }
    // Clear any asset selection for this slot before applying uploaded file
    if (target) {
      const slot = _getSlot(target);
      if (slot) { slot.stateObj[slot.assetKey] = null; slot.stateObj[slot.urlKey] = null; }
    }
    stateObj[stateKey] = file;
    zone.classList.add('has-file');
    const reader = new FileReader();
    reader.onload = e => {
      const wrap = document.getElementById(previewId);
      if (wrap) wrap.innerHTML = `<img src="${e.target.result}" alt="preview" />`;
    };
    reader.readAsDataURL(file);
  }

  // ── Asset Picker ──────────────────────────────────────────────
  let _pickerTarget  = null;
  let _pickerAssets  = [];

  // Slot configuration keyed by picker target name
  function _getSlot(target) {
    const slots = {
      'remix-ref':    { stateObj: state.remix,    fileKey: 'referenceFile', assetKey: 'referenceAssetId', urlKey: 'referenceAssetUrl', previewId: 'ref-preview-wrap',          zoneId: 'ref-drop',          defaultHtml: '<div class="drop-icon">⊞</div><div class="drop-text">Drop or <span class="drop-link">browse</span></div>' },
      'remix-prod':   { stateObj: state.remix,    fileKey: 'productFile',   assetKey: 'productAssetId',   urlKey: 'productAssetUrl',   previewId: 'prod-preview-wrap',         zoneId: 'prod-drop',         defaultHtml: '<div class="drop-icon">◈</div><div class="drop-text">Drop or <span class="drop-link">browse</span></div>' },
      'concept-prod': { stateObj: state.concepts, fileKey: 'productFile',   assetKey: 'productAssetId',   urlKey: 'productAssetUrl',   previewId: 'concept-prod-preview-wrap', zoneId: 'concept-prod-drop', defaultHtml: '<div class="drop-icon" style="font-size:1.2rem;">◈</div><div class="drop-text">Drop or <span class="drop-link">browse</span></div>' },
    };
    return slots[target] || null;
  }

  async function openAssetPicker(target) {
    if (!state.activeBrand) return toast('Select a brand first', 'error');
    _pickerTarget = target;
    const grid = document.getElementById('asset-picker-grid');
    if (grid) grid.innerHTML = '<div class="loading-text">Loading assets…</div>';
    document.getElementById('modal-asset-picker')?.classList.remove('hidden');

    try {
      const { data } = await api.get(`/brands/${state.activeBrand.id}/assets`);
      _pickerAssets = data || [];
      if (!grid) return;
      if (!_pickerAssets.length) {
        grid.innerHTML = '<div class="loading-text">No assets yet — upload some in Brand Setup → Assets.</div>';
        return;
      }
      grid.innerHTML = _pickerAssets.map((a, i) => `
        <div class="asset-picker-card" onclick="App.selectPickerAsset(${i})">
          <img src="${esc(a.file_url || '')}" alt="${esc(a.name)}" loading="lazy" />
          <div class="asset-picker-card-name">${esc(a.name)}</div>
        </div>`).join('');
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="loading-text">Failed to load: ${esc(e.message)}</div>`;
    }
  }

  function closeAssetPicker() {
    document.getElementById('modal-asset-picker')?.classList.add('hidden');
    _pickerTarget = null;
  }

  function selectPickerAsset(index) {
    const asset = _pickerAssets[index];
    if (!asset || !_pickerTarget) return;
    const slot = _getSlot(_pickerTarget);
    if (!slot) return;

    // Clear uploaded file, set asset
    slot.stateObj[slot.fileKey]  = null;
    slot.stateObj[slot.assetKey] = asset.id;
    slot.stateObj[slot.urlKey]   = asset.file_url;

    // Update drop zone preview
    const wrap = document.getElementById(slot.previewId);
    const zone = document.getElementById(slot.zoneId);
    const tgt  = _pickerTarget; // capture before closeAssetPicker clears it
    if (wrap) {
      wrap.innerHTML = `
        <div class="asset-in-use">
          <img src="${esc(asset.file_url || '')}" alt="${esc(asset.name)}" />
          <span class="asset-in-use-label" title="${esc(asset.name)}">${esc(asset.name)}</span>
          <button class="asset-in-use-remove" type="button"
                  onclick="event.stopPropagation();App.clearImageSlot('${tgt}')">Remove</button>
        </div>`;
    }
    if (zone) zone.classList.add('has-file');
    closeAssetPicker();
  }

  function clearImageSlot(target) {
    const slot = _getSlot(target);
    if (!slot) return;
    slot.stateObj[slot.fileKey]  = null;
    slot.stateObj[slot.assetKey] = null;
    slot.stateObj[slot.urlKey]   = null;
    const zone = document.getElementById(slot.zoneId);
    const wrap = document.getElementById(slot.previewId);
    if (zone) zone.classList.remove('has-file');
    if (wrap) wrap.innerHTML = slot.defaultHtml;
  }

  // ── Format Library ───────────────────────────────────────────
  async function loadFormats() {
    try {
      const { data } = await api.get('/concepts/formats');
      state.formats = data || [];
      renderFormatChips();
    } catch {}
  }

  function renderFormatChips() {
    const el = document.getElementById('concept-format-chips');
    if (!el || !state.formats.length) return;
    el.innerHTML = state.formats.map(f => `
      <button class="format-chip ${state.concepts.selectedFormatIds.includes(f.id) ? 'selected' : ''}"
              title="${esc(f.description)}"
              onclick="App.toggleFormat('${f.id}')">${esc(f.name)}</button>
    `).join('');
  }

  function toggleFormat(id) {
    const ids = state.concepts.selectedFormatIds;
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    renderFormatChips();
  }

  // ── Ratio selector ───────────────────────────────────────────
  function selectRatio(ratio) {
    state.remix.aspectRatio = ratio;
    document.querySelectorAll('.ratio-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.ratio === ratio);
    });
  }

  // ── Volume Input ─────────────────────────────────────────────
  const VOLUME_LIMITS = { remix: { min: 1, max: 20 }, concepts: { min: 1, max: 60 } };

  function adjustVolume(mode, delta) {
    const inputId = mode === 'remix' ? 'remix-volume' : 'concept-volume';
    const input = document.getElementById(inputId);
    if (!input) return;
    const { min, max } = VOLUME_LIMITS[mode];
    const current = parseInt(input.value, 10) || (mode === 'remix' ? 5 : 20);
    const next = Math.max(min, Math.min(max, current + delta));
    input.value = next;
    _applyVolume(mode, next);
  }

  function onVolumeInput(mode, input) {
    const { min, max } = VOLUME_LIMITS[mode];
    const errorId = mode === 'remix' ? 'remix-volume-error' : 'concept-volume-error';
    const errorEl = document.getElementById(errorId);
    const wrap = input.closest('.volume-input-wrap');
    const raw = parseInt(input.value, 10);

    if (isNaN(raw) || input.value === '') {
      if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
      wrap?.classList.remove('has-error');
      return;
    }

    if (raw < min || raw > max) {
      const msg = `Enter a number between ${min} and ${max}`;
      if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
      wrap?.classList.add('has-error');
      return;
    }

    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    wrap?.classList.remove('has-error');
    _applyVolume(mode, raw);
  }

  function _applyVolume(mode, value) {
    const { min, max } = VOLUME_LIMITS[mode];
    const clamped = Math.max(min, Math.min(max, value));
    if (mode === 'remix') {
      state.remix.outputVolume = clamped;
    } else {
      state.concepts.outputVolume = clamped;
      // Refresh generate-all button label if a plan exists
      if (state.concepts.plan?.length) _updateGenerateAllLabel();
    }
  }

  function onConceptCountInput(input) {
    let v = parseInt(input.value, 10);
    if (!isNaN(v)) {
      state.concepts.conceptCount = Math.max(1, Math.min(12, v));
    }
  }

  // ── Speed Mode ───────────────────────────────────────────────
  function selectSpeedMode(mode) {
    state.speedMode = mode;
    // Sync both selectors (remix + concepts share one speed state)
    document.querySelectorAll('.speed-selector .speed-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // ── Generation elapsed timer ─────────────────────────────────
  const _genTimer = {
    _iv:    null,
    _start: 0,
    start() {
      this._start = Date.now();
      this._tick();
      this._iv = setInterval(() => this._tick(), 1000);
    },
    stop() {
      clearInterval(this._iv);
      this._iv = null;
    },
    _tick() {
      const secs = Math.floor((Date.now() - this._start) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      const el = document.getElementById('ws-gen-timer');
      if (el) el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    },
    reset() {
      const el = document.getElementById('ws-gen-timer');
      if (el) el.textContent = '0:00';
    },
  };

  function _updateGenerateAllLabel() {
    const plan = state.concepts.plan || [];
    if (!plan.length) return;
    const vol = state.concepts.outputVolume;
    const perConcept = Math.min(Math.ceil(vol / plan.length), 20);
    const total = plan.length * perConcept;
    const el = document.getElementById('btn-generate-all-label');
    if (el) el.textContent = `Generate All (~${total} ads)`;
  }

  // ── Generation Mode Toggle ────────────────────────────────────

  function setGenMode(mode) {
    state.genMode = mode === 'editable' ? 'editable' : 'image';
    const imgBtn = document.getElementById('gen-mode-image');
    const editBtn = document.getElementById('gen-mode-editable');
    if (imgBtn)  imgBtn.classList.toggle('active',  state.genMode === 'image');
    if (editBtn) editBtn.classList.toggle('active', state.genMode === 'editable');
    // Swap generate button handler label
    const label = document.getElementById('btn-remix-label');
    if (label) label.textContent = state.genMode === 'editable' ? 'Generate Editable Design' : 'Generate';
  }

  // ── Editable Design Generation ────────────────────────────────

  async function generateEditableDesign() {
    if (!state.activeBrand)    return toast('Select a brand first', 'error');
    if (!state.activeCampaign) return toast('Create or select a campaign first', 'error');

    const btn   = document.getElementById('btn-remix-generate');
    const label = document.getElementById('btn-remix-label');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Generating design…';

    const instructions = document.getElementById('remix-instructions')?.value?.trim() || '';

    // Resolve concept strategy — use parsed plan if available
    let strategyObj = null;
    if (state.concepts.plan && Array.isArray(state.concepts.plan) && state.concepts.plan.length) {
      strategyObj = state.concepts.plan[0].strategy || null;
    }

    const payload = {
      brand_id:           state.activeBrand.id,
      campaign_id:        state.activeCampaign.id,
      aspect_ratio:       state.concepts.aspectRatio || state.remix.aspectRatio || 'square',
      instructions,
      avoid_instructions: state.avoidInstructions || '',
      strategy:           strategyObj,
      product_asset_id:   state.concepts.productAssetId || state.remix.productAssetId || null,
    };

    try {
      const res = await api.post('/editable-designs/generate', payload);
      if (!res.success) throw new Error(res.error || 'Generation failed');

      const { id: adId, layout } = res.data;
      toast('Editable design created — opening studio…', 'success');

      // Add a synthetic ad record to the board so it shows up
      const syntheticAd = {
        id:         adId,
        image_url:  null,
        status:     'draft',
        created_at: new Date().toISOString(),
        metadata:   { source_mode: 'layout_first', preview_color: layout.canvas.background },
      };
      state.boardAds     = [syntheticAd, ...state.boardAds];
      state.boardFiltered = [syntheticAd, ...state.boardFiltered];
      renderBoardCards(state.boardFiltered);

      // Open studio with the editable design
      openStudio(syntheticAd);
    } catch (err) {
      console.error('[generateEditableDesign]', err.message);
      toast('Editable design failed: ' + err.message, 'error');
    } finally {
      if (btn)   btn.disabled = false;
      if (label) label.textContent = 'Generate Editable Design';
    }
  }

  // ── HTML/CSS Canvas Renderer for Editable Design ──────────────

  function _loadGoogleFont(family) {
    const id = 'gfont-' + family.replace(/\s+/g, '-').toLowerCase();
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id   = id;
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family) + ':wght@400;700&display=swap';
    document.head.appendChild(link);
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderEditableDesignPreview(layoutJson, containerEl) {
    if (!layoutJson || !containerEl) return;
    const { canvas, layers } = layoutJson;
    const W = canvas.width  || 1080;
    const H = canvas.height || 1080;

    const containerW = containerEl.offsetWidth || 400;
    const scale = Math.min(1, containerW / W);

    // Load fonts
    (layers || []).forEach(l => {
      if (l.fontFamily && l.fontFamily !== 'Inter') _loadGoogleFont(l.fontFamily);
    });

    // Sort layers by z
    const sorted = (layers || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));

    let html = `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${_esc(canvas.background || '#fff')};">`;

    sorted.forEach(layer => {
      const x = layer.x || 0;
      const y = layer.y || 0;
      const w = layer.width  || 100;
      const h = layer.height || 40;
      const op = layer.opacity != null ? layer.opacity : 1;
      const base = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;opacity:${op};`;

      const type = (layer.type || '').toLowerCase();

      if (type === 'rectangle') {
        const r = layer.borderRadius || 0;
        html += `<div style="${base}background:${_esc(layer.fill || '#888')};border-radius:${r}px;"></div>`;

      } else if (type === 'ellipse') {
        html += `<div style="${base}background:${_esc(layer.fill || '#888')};border-radius:50%;"></div>`;

      } else if (type === 'line') {
        const lh = layer.strokeWeight || 2;
        html += `<div style="${base}height:${lh}px;background:${_esc(layer.fill || '#888')};"></div>`;

      } else if (type === 'text') {
        const ff  = layer.fontFamily || 'Inter';
        const fs  = layer.fontSize   || 32;
        const fw  = layer.fontWeight || 400;
        const lh  = layer.lineHeight || 1.2;
        const col = layer.fill       || '#000';
        const al  = layer.align      || 'left';
        const textStyle = `${base}font-family:'${_esc(ff)}',Inter,sans-serif;font-size:${fs}px;font-weight:${fw};line-height:${lh};color:${_esc(col)};text-align:${al};overflow:hidden;word-break:break-word;`;
        html += `<div style="${textStyle}">${_esc(layer.text || '')}</div>`;

      } else if (type === 'button') {
        const ff  = layer.fontFamily || 'Inter';
        const fs  = layer.fontSize   || 28;
        const fw  = layer.fontWeight || 700;
        const r   = layer.borderRadius || 8;
        const bg  = layer.fill     || '#5b6af0';
        const tc  = layer.textFill || '#fff';
        const btnStyle = `${base}background:${_esc(bg)};border-radius:${r}px;display:flex;align-items:center;justify-content:center;font-family:'${_esc(ff)}',Inter,sans-serif;font-size:${fs}px;font-weight:${fw};color:${_esc(tc)};cursor:default;`;
        html += `<div style="${btnStyle}">${_esc(layer.text || '')}</div>`;

      } else if (type === 'image') {
        if (layer.imageUrl) {
          const fit = layer.objectFit || 'contain';
          html += `<img src="${_esc(layer.imageUrl)}" style="${base}object-fit:${fit};" onerror="this.style.background='#ccc';" />`;
        } else {
          html += `<div style="${base}background:#ccc;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;">${_esc(layer.name || 'Image')}</div>`;
        }
      }
    });

    html += '</div>';

    containerEl.innerHTML =
      `<div style="width:${containerW}px;height:${Math.round(H * scale)}px;overflow:hidden;position:relative;">` +
      `<div style="transform:scale(${scale.toFixed(4)});transform-origin:top left;position:absolute;">` +
      html + '</div></div>';
  }

  // ── Remix Generation (SSE Streaming) ─────────────────────────
  async function triggerRemixGenerate() {
    // Dispatch to editable design generator if mode is 'editable'
    if (state.genMode === 'editable') return generateEditableDesign();

    if (!state.activeBrand)    return toast('Select a brand first', 'error');
    if (!state.activeCampaign) return toast('Create or select a campaign first', 'error');
    if (!state.remix.referenceFile && !state.remix.referenceAssetId)
      return toast('Upload or choose a reference ad image', 'error');
    if (!state.remix.productFile && !state.remix.productAssetId)
      return toast('Upload or choose a product image', 'error');

    const rawVol = parseInt(document.getElementById('remix-volume')?.value, 10);
    const n = Math.max(1, Math.min(20, isNaN(rawVol) ? state.remix.outputVolume : rawVol));
    state.remix.outputVolume = n;

    const btn = document.getElementById('btn-remix-generate');
    setGeneratingBtn(btn, 'btn-remix-label', `Generating…`);

    setWorkspaceState(WS.GENERATING);  // switches to board tab, shows pulsing indicator
    addGenerationSlotCards(n);
    startGenerationProgress(n);
    _genTimer.reset();
    _genTimer.start();

    const formData = new FormData();
    formData.append('brand_id',    state.activeBrand.id);
    formData.append('campaign_id', state.activeCampaign.id);
    if (state.remix.referenceFile)
      formData.append('reference_image',    state.remix.referenceFile);
    else
      formData.append('reference_asset_id', state.remix.referenceAssetId);
    if (state.remix.productFile)
      formData.append('product_image',      state.remix.productFile);
    else
      formData.append('product_asset_id',   state.remix.productAssetId);
    formData.append('instructions',       getVal('remix-instructions'));
    formData.append('avoid_instructions', state.avoidInstructions || '');
    formData.append('aspect_ratio', state.remix.aspectRatio);
    formData.append('count',        n);
    formData.append('speed_mode',   state.speedMode);

    let completedCount = 0;

    try {
      await streamGenerate('/generate/remix/stream', formData, (event) => {
        // ── Slot-based events (remix pipeline) ──────────────────
        if (event.type === 'slot_processing') {
          updateSlotCard(event.slot, 'processing', null);

        } else if (event.type === 'slot_retrying') {
          updateSlotCard(event.slot, 'retrying', { attempt: event.attempt });

        } else if (event.type === 'slot_completed') {
          completedCount++;
          updateGenerationProgress(completedCount, n);
          replaceSlotCardWithAd(event.slot, event.ad);
          state.boardAds.unshift(event.ad);
          updateBoardStats();

        } else if (event.type === 'slot_failed') {
          completedCount++;
          updateGenerationProgress(completedCount, n);
          updateSlotCard(event.slot, 'failed', { error: event.error });
          toast('Variation ' + (event.slot + 1) + ' failed', 'error');

        } else if (event.type === 'slot_scored') {
          addScoreBadge(event.ad_id, event.score);

        } else if (event.type === 'best_selected') {
          markBestCard(event.ad_id);

        // ── Batch-level events ───────────────────────────────────
        } else if (event.type === 'done') {
          state.remix.lastStrategy = event.creativeStrategy;
          if (event.creativeStrategy) renderContextStrategy(event.creativeStrategy);

        } else if (event.type === 'error') {
          toast('Generation error: ' + event.message, 'error');
        }
        // Note: legacy 'progress' events from the same stream are intentionally
        // ignored here — slot_* events carry all the needed information.
      });

      toast(completedCount + ' ad' + (completedCount !== 1 ? 's' : '') + ' generated!');
    } catch (err) {
      document.querySelectorAll('.board-card.gen-slot-card').forEach(function(s) { s.remove(); });
      toast('Generation failed: ' + err.message, 'error');
    } finally {
      // Remove any leftover slot cards (failed ones that weren't replaced)
      document.querySelectorAll('.board-card.gen-slot-card').forEach(function(s) { s.remove(); });
      _genTimer.stop();
      resetBtn(btn, 'btn-remix-label', '✦ Generate');
      endGenerationProgress();
      setWorkspaceState(WS.BOARD);
      applyBoardFilter();
    }
  }

  // SSE stream reader — POST multipart, read response as text stream
  async function streamGenerate(path, formData, onEvent) {
    const response = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: formData });
    if (!response.ok) {
      if (response.status === 401) {
        const authed = await _cachedAuthCheck();
        if (!authed) {
          _invalidateAuthCache();
          Auth.showLoginScreen('login');
          throw new Error('Session expired. Please sign in again.');
        }
      }
      // Try JSON first, fall back to text, fall back to status code
      let errMsg = '';
      try {
        const body = await response.json();
        errMsg = body.error || body.message || '';
      } catch {
        try { errMsg = await response.text(); } catch {}
      }
      if (!errMsg) errMsg = `HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch {}
        }
      }
    }
  }

  // ── Concept Plan Generation ──────────────────────────────────
  async function generateConceptPlan() {
    if (!state.activeBrand) return toast('Select a brand first', 'error');
    const btn = document.getElementById('btn-concept-plan');
    setGeneratingBtn(btn, 'btn-concept-plan-label', 'Analyzing…');

    const formData = new FormData();
    const conceptCount = Math.max(1, Math.min(12, parseInt(document.getElementById('concept-plan-count')?.value, 10) || state.concepts.conceptCount));
    state.concepts.conceptCount = conceptCount;

    formData.append('brand_id',      state.activeBrand.id);
    formData.append('concept_count', conceptCount);
    formData.append('aspect_ratio',  document.getElementById('concept-ratio')?.value || 'square');
    formData.append('strategy',      getVal('concept-strategy'));
    if (state.concepts.selectedFormatIds.length) {
      formData.append('format_ids', JSON.stringify(state.concepts.selectedFormatIds));
    }
    if (state.concepts.productFile)
      formData.append('product_image',    state.concepts.productFile);
    else if (state.concepts.productAssetId)
      formData.append('product_asset_id', state.concepts.productAssetId);

    try {
      const { data } = await api.upload('/concepts/plan', formData);
      state.concepts.plan = data || [];
      renderConceptCards();
      setWorkspaceState(WS.PLANNING);  // switches to plan tab, shows concept cards
      toast(`${state.concepts.plan.length} concepts planned`);
    } catch (e) {
      toast('Concept planning failed: ' + e.message, 'error');
    } finally {
      resetBtn(btn, 'btn-concept-plan-label', 'Preview Concept Plan');
    }
  }

  function renderConceptCards() {
    const plan = state.concepts.plan || [];
    const list = document.getElementById('concept-cards-list');
    if (!list) return;

    const vol        = state.concepts.outputVolume;
    const perConcept = plan.length ? Math.min(Math.ceil(vol / plan.length), 20) : 0;
    const total      = plan.length * perConcept;

    setEl('concept-plan-title', `Concept Plan`);
    setEl('concept-plan-sub',   `${plan.length} concept${plan.length !== 1 ? 's' : ''} · ~${total} ads`);

    list.innerHTML = plan.map((c, i) => `
      <div class="concept-card" id="concept-card-${i}">
        <div class="concept-card-header">
          <span class="concept-card-format">${esc(c.format_name || c.format_id || '—')}</span>
          <span class="concept-card-persona">${esc(c.persona_name || 'General')}</span>
        </div>
        <div class="concept-card-angle">${esc(c.angle || '—')}</div>
        <div class="concept-card-hook">"${esc(c.hook || '—')}"</div>
        <div class="concept-card-footer">
          <span class="concept-card-dist">${perConcept} ad${perConcept !== 1 ? 's' : ''}</span>
          <button class="concept-card-remove" onclick="App.removeConceptCard(${i})" title="Remove">✕</button>
        </div>
      </div>`).join('');

    const lbl = document.getElementById('btn-generate-all-label');
    if (lbl) lbl.textContent = `Generate All (~${total} ads)`;

    _syncConceptPlanPanel();  // show workspace, update tab badge
  }

  function removeConceptCard(i) {
    state.concepts.plan.splice(i, 1);
    renderConceptCards();
  }

  // ── Generate All Concepts (SSE) ──────────────────────────────
  async function generateAllConcepts() {
    if (!state.activeBrand)    return toast('Select a brand first', 'error');
    if (!state.activeCampaign) return toast('Create or select a campaign first', 'error');
    const plan = state.concepts.plan;
    if (!plan || !plan.length) return toast('Generate a concept plan first', 'error');

    const outputVolume  = Math.max(1, Math.min(60, parseInt(document.getElementById('concept-volume')?.value, 10) || state.concepts.outputVolume));
    state.concepts.outputVolume = outputVolume;
    const adsPerConcept = Math.min(Math.ceil(outputVolume / plan.length), 20);
    const totalAds      = plan.length * adsPerConcept;

    const btn = document.getElementById('btn-generate-all');
    setGeneratingBtn(btn, 'btn-generate-all-label', `Generating…`);
    setWorkspaceState(WS.GENERATING);  // hides concept planner, shows board with live indicator
    addSkeletonCards(totalAds, 0);
    startGenerationProgress(totalAds);
    _genTimer.reset();
    _genTimer.start();

    let globalIdx   = 0;
    let completedTotal = 0;

    try {
      for (const concept of plan) {
        const n = adsPerConcept;
        const startIdx = globalIdx;
        globalIdx += n;

        // Check product image — file upload OR brand asset
        const hasProdFile  = !!(state.concepts.productFile || state.remix.productFile);
        const hasProdAsset = !!(state.concepts.productAssetId);
        if (!hasProdFile && !hasProdAsset) {
          toast('Upload or select a product image in the Concepts panel', 'error');
          break;
        }

        const refFile  = state.remix.referenceFile;    // null if user hasn't set remix reference
        const prodFile = state.concepts.productFile || state.remix.productFile;

        const instructions = [
          concept.angle ? `Angle: ${concept.angle}` : '',
          concept.hook  ? `Hook: "${concept.hook}"` : '',
          `Format: ${concept.format_name || concept.format_id}`,
          `Persona: ${concept.persona_name || 'General Audience'}`,
          getVal('concept-strategy'),
        ].filter(Boolean).join('. ');

        const formData = new FormData();
        formData.append('brand_id',    state.activeBrand.id);
        formData.append('campaign_id', state.activeCampaign.id);
        formData.append('instructions',       instructions);
        formData.append('avoid_instructions', state.avoidInstructions || '');
        formData.append('aspect_ratio',  document.getElementById('concept-ratio')?.value || 'square');
        formData.append('count',         n);
        formData.append('speed_mode',    state.speedMode);

        // Reference image — only send if user uploaded a DIFFERENT reference in Remix panel
        // If absent, the backend falls back to using the product image as reference
        if (refFile) formData.append('reference_image', refFile);
        else if (state.remix.referenceAssetId) formData.append('reference_asset_id', state.remix.referenceAssetId);
        // (no reference → backend uses product as reference, avoids duplicate upload)

        // Product image — file upload takes priority over brand asset
        if (prodFile) {
          formData.append('product_image', prodFile);
        } else if (state.concepts.productAssetId) {
          formData.append('product_asset_id', state.concepts.productAssetId);
        }

        let conceptCompleted = 0;
        let conceptError     = null;

        await streamGenerate('/generate/remix/stream', formData, (event) => {
          if (event.type === 'progress' && event.success) {
            completedTotal++;
            conceptCompleted++;
            const skIdx = startIdx + conceptCompleted - 1;
            updateGenerationProgress(completedTotal, totalAds);
            replaceSkeletonCard(skIdx, event.ad);
            state.boardAds.unshift(event.ad);
            updateBoardStats();
          } else if (event.type === 'progress' && !event.success) {
            completedTotal++;
            conceptCompleted++;
            const skIdx = startIdx + conceptCompleted - 1;
            updateGenerationProgress(completedTotal, totalAds);
            replaceSkeletonCard(skIdx, null);
          } else if (event.type === 'error') {
            conceptError = event.message;
            console.error('[concepts/stream] server error event:', event.message);
          }
        });

        if (conceptError && completedTotal === 0) {
          // Surface the first concept error if nothing generated at all
          throw new Error(conceptError);
        }
      }

      toast(`${completedTotal} ads generated from ${plan.length} concepts!`);
    } catch (e) {
      document.querySelectorAll('.board-card.skeleton').forEach(s => s.remove());
      toast('Generation failed: ' + e.message, 'error');
    } finally {
      _genTimer.stop();
      resetBtn(btn, 'btn-generate-all-label', 'Generate All');
      endGenerationProgress();
      setWorkspaceState(WS.BOARD);  // generation complete — board is now primary
      _updateGenerateAllLabel();    // restore label with current distribution count
      applyBoardFilter();
    }
  }

  // ── Context Panel Strategy ───────────────────────────────────
  function renderContextStrategy(strategy) {
    const indicator = document.getElementById('strategy-indicator');
    const rows      = document.getElementById('context-strategy-rows');
    const emptyHint = document.getElementById('context-strategy-empty');
    if (!rows) return;

    if (indicator) indicator.classList.add('active');

    const fields = [
      ['Pipeline',    strategy.composerUsed ? `gpt-4.1-mini → ${strategy.imageModel || 'gpt-image-2'}` : (strategy.imageModel || 'gpt-image-2') + ' (baseline)'],
      ['Layout',      strategy.layout_type],
      ['Energy',      strategy.ad_energy],
      ['Color',       strategy.color_strategy],
      ['Direction',   strategy.creative_strategy],
    ].filter(([, v]) => v);

    rows.innerHTML = fields.map(([label, val]) => `
      <div class="context-strategy-row">
        <span class="context-strategy-label">${label}</span>
        <span class="context-strategy-value">${esc(val)}</span>
      </div>`).join('');

    emptyHint?.classList.add('hidden');
    rows.classList.remove('hidden');
  }

  // ── Ad Detail Studio ─────────────────────────────────────────
  function openStudio(ad) {
    state.studio.ad = ad;
    const meta = safeJSON(ad.metadata) || {};
    const strategy = meta.strategy || {};

    const isLayoutFirst = meta.source_mode === 'layout_first' || !ad.image_url;
    const editablePreviewEl = document.getElementById('studio-editable-preview');
    const img     = document.getElementById('studio-img');
    const imgFail = document.getElementById('studio-img-fail');

    if (isLayoutFirst && editablePreviewEl) {
      // Hide image elements, show editable canvas preview
      if (img)     { img.style.display = 'none'; img.src = ''; }
      if (imgFail) imgFail.classList.add('hidden');
      editablePreviewEl.classList.remove('hidden');
      editablePreviewEl.innerHTML = '<div style="color:#888;font-size:13px;padding:16px;">Loading preview…</div>';

      // Fetch layout JSON and render
      api.get(`/editable-designs/${ad.id}`)
        .then(res => {
          if (res.success && res.data) {
            renderEditableDesignPreview(res.data, editablePreviewEl);
          } else {
            editablePreviewEl.innerHTML = '<div style="color:#888;font-size:13px;padding:16px;">Preview unavailable</div>';
          }
        })
        .catch(() => {
          editablePreviewEl.innerHTML = '<div style="color:#888;font-size:13px;padding:16px;">Preview unavailable</div>';
        });
    } else {
      if (editablePreviewEl) editablePreviewEl.classList.add('hidden');
      const imgSrc = resolveAdImage(ad);
      console.log('[studio] ad id:', ad.id, '| image_url length:', (ad.image_url || '').length, '| resolved src starts with:', imgSrc.slice(0, 40));
      if (img) {
        img.src = imgSrc;
        img.style.display = imgSrc ? '' : 'none';
        img.onerror = () => {
          console.warn('[studio] image failed to load:', imgSrc.slice(0, 80));
          img.style.display = 'none';
          if (imgFail) imgFail.classList.remove('hidden');
        };
        img.onload = () => { if (imgFail) imgFail.classList.add('hidden'); };
      }
      if (imgFail) imgFail.classList.toggle('hidden', !!imgSrc);
    }

    // Format tag
    const fmtTag = ad.ad_format || strategy.layout_type || '—';
    setEl('studio-format-tag', fmtTag.replace(/_/g, ' '));

    // Created at
    setEl('studio-created-at', relTime(ad.created_at));

    // Status badge
    const badge = document.getElementById('studio-status-badge');
    if (badge) {
      badge.textContent = capitalize(ad.status || 'draft');
      badge.className   = `studio-status-badge ${ad.status || 'draft'}`;
    }

    setEl('studio-energy',   strategy.ad_energy || '—');
    setEl('studio-layout',   strategy.layout_type || '—');
    setEl('studio-color',    strategy.color_strategy || '—');
    setEl('studio-pipeline', ad.ai_model || '—');

    // Archetype row
    const archRow = document.getElementById('studio-archetype-row');
    if (archRow) {
      if (strategy.human_archetypes) {
        setEl('studio-archetype', strategy.human_archetypes);
        archRow.classList.remove('hidden');
      } else {
        archRow.classList.add('hidden');
      }
    }

    setEl('studio-creative-direction', strategy.creative_strategy || '—');
    setEl('studio-prompt', ad.image_prompt || '—');

    // Approve button label
    const approveBtn = document.getElementById('studio-approve-btn');
    if (approveBtn) {
      approveBtn.textContent = ad.status === 'approved' ? '↩ Unapprove' : '✓ Approve';
    }

    document.getElementById('studio-overlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeStudio() {
    document.getElementById('studio-overlay')?.classList.add('hidden');
    document.body.style.overflow = '';
    state.studio.ad = null;
  }

  function downloadStudioAd() {
    const ad = state.studio.ad;
    const src = resolveAdImage(ad);
    if (!src) return;
    const a  = document.createElement('a');
    a.href   = src;
    a.download = `meta-ad-${ad.id}.png`;
    a.click();
  }

  async function approveStudioAd() {
    const ad = state.studio.ad;
    if (!ad) return;
    const newStatus = ad.status === 'approved' ? 'draft' : 'approved';
    try {
      const { data } = await api.put(`/ads/${ad.id}/status`, { status: newStatus });
      state.studio.ad = data;
      const idx = state.boardAds.findIndex(a => a.id === data.id);
      if (idx >= 0) state.boardAds[idx] = data;
      openStudio(data);
      applyBoardFilter();
      renderBoardCards(state.boardFiltered);
      updateBoardStats();
      toast(`Ad ${newStatus}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteStudioAd() {
    const ad = state.studio.ad;
    if (!ad) return;
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    try {
      await api.delete(`/ads/${ad.id}`);
      state.boardAds = state.boardAds.filter(a => a.id !== ad.id);
      closeStudio();
      applyBoardFilter();
      renderBoardCards(state.boardFiltered);
      updateBoardStats();
      toast('Ad deleted');
    } catch (e) { toast(e.message, 'error'); }
  }

  function remixThisAd() {
    const ad  = state.studio.ad;
    const src = resolveAdImage(ad);
    if (!src) return;

    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], 'reference.png', { type: 'image/png' });
        state.remix.referenceFile = file;
        // Show preview in the ref drop zone
        const reader = new FileReader();
        reader.onload = e => {
          const wrap = document.getElementById('ref-preview-wrap');
          if (wrap) wrap.innerHTML = `<img src="${e.target.result}" alt="preview" />`;
          const zone = document.getElementById('ref-drop');
          if (zone) zone.classList.add('has-file');
        };
        reader.readAsDataURL(file);
        closeStudio();
        switchTab('remix');
        toast('Ad loaded as reference — add your product image and generate');
      })
      .catch(() => toast('Could not load image as reference', 'error'));
  }

  // ── Export creative layout as Figma-compatible JSON ──────────
  async function exportToFigma() {
    const ad = state.studio.ad;
    if (!ad?.id) return;

    const hintEl = document.getElementById('studio-export-hint');
    const btnEl  = document.getElementById('btn-export-figma');
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Exporting…'; }
    if (hintEl) hintEl.textContent = '';

    try {
      const res = await fetch(`/api/ads/${ad.id}/layout/export`, { credentials: 'include' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || b.message || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `creative-layout-${ad.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (hintEl) hintEl.textContent = 'Downloaded — import via Figma plugin';
    } catch (err) {
      console.error('[exportToFigma] failed:', err.message);
      if (hintEl) hintEl.textContent = err.message.includes('No layout') ? 'Layout not ready yet — try after generation' : 'Export failed';
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5Z" fill="currentColor"/><path d="M9.5 57A9.5 9.5 0 0 0 19 47.5V38H9.5A9.5 9.5 0 0 0 0 47.5 9.5 9.5 0 0 0 9.5 57Z" fill="currentColor"/><path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="currentColor"/><path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="currentColor"/><path d="M19 0V19H28.5A9.5 9.5 0 0 0 28.5 0Z" fill="currentColor"/></svg> Export Layout JSON`;
      }
    }
  }

  // ── Best-available Figma export (blueprint → editable → fast) ──
  async function exportEditableFigma() {
    const ad = state.studio.ad;
    if (!ad?.id) return;

    const hintEl  = document.getElementById('studio-export-hint');
    const btnEl   = document.getElementById('btn-export-figma-best');
    const labelEl = document.getElementById('btn-export-figma-best-label');
    if (btnEl)  btnEl.disabled  = true;
    if (labelEl) labelEl.textContent = 'Exporting…';
    if (hintEl) hintEl.textContent = 'Preparing your editable Figma file…';

    try {
      const res = await fetch(`/api/ads/${ad.id}/layout/export-best`, { credentials: 'include' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || b.message || msg; } catch {}
        throw new Error(msg);
      }
      const modeUsed = res.headers.get('X-Export-Mode') || 'fast';
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `creative-layout-${ad.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const modeLabel = modeUsed === 'reconstruction' ? 'AI Vision Reconstruction'
                      : modeUsed === 'blueprint'     ? 'Claude Blueprint'
                      : modeUsed === 'editable'      ? 'AI Editable'
                      : 'Fast Layout';
      if (hintEl) hintEl.textContent = `Downloaded (${modeLabel}) — import via Figma plugin`;
    } catch (err) {
      console.error('[exportEditableFigma] failed:', err.message);
      if (hintEl) hintEl.textContent = 'Export failed: ' + err.message;
    } finally {
      if (btnEl)  btnEl.disabled  = false;
      if (labelEl) labelEl.textContent = 'Export Editable Figma File';
    }
  }

  // ── Editable export — GPT-4o vision layer reconstruction ────
  async function exportToFigmaEditable() {
    const ad = state.studio.ad;
    if (!ad?.id) return;

    const hintEl = document.getElementById('studio-export-hint');
    const btnEl  = document.getElementById('btn-export-figma-editable');
    const fastEl = document.getElementById('btn-export-figma');
    if (btnEl)  { btnEl.disabled = true;  btnEl.textContent = 'Analyzing…'; }
    if (fastEl) { fastEl.disabled = true; }
    if (hintEl) hintEl.textContent = 'Running AI vision analysis — takes ~15s…';

    try {
      const res = await fetch(`/api/ads/${ad.id}/layout/export?mode=editable`, { credentials: 'include' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || b.message || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `creative-layout-${ad.id.slice(0, 8)}-editable.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (hintEl) hintEl.textContent = 'Editable layout downloaded — import via Figma plugin';
    } catch (err) {
      console.error('[exportToFigmaEditable] failed:', err.message);
      if (hintEl) hintEl.textContent = err.message.includes('no generated image') ? 'Generate the ad first' : ('AI analysis failed: ' + err.message);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5Z" fill="currentColor"/><path d="M9.5 57A9.5 9.5 0 0 0 19 47.5V38H9.5A9.5 9.5 0 0 0 0 47.5 9.5 9.5 0 0 0 9.5 57Z" fill="currentColor"/><path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="currentColor"/><path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="currentColor"/><path d="M19 0V19H28.5A9.5 9.5 0 0 0 28.5 0Z" fill="currentColor"/></svg> ✦ Editable Export (AI)`;
      }
      if (fastEl) fastEl.disabled = false;
    }
  }

  // ── Claude Design Blueprint export ──────────────────────────
  async function exportToFigmaBlueprint() {
    const ad = state.studio.ad;
    if (!ad?.id) return;

    const hintEl     = document.getElementById('studio-export-hint');
    const btnEl      = document.getElementById('btn-export-figma-blueprint');
    const fastEl     = document.getElementById('btn-export-figma');
    const editableEl = document.getElementById('btn-export-figma-editable');
    if (btnEl)      { btnEl.disabled = true;      btnEl.textContent = 'Designing…'; }
    if (fastEl)     { fastEl.disabled = true; }
    if (editableEl) { editableEl.disabled = true; }
    if (hintEl) hintEl.textContent = 'Claude is designing your blueprint…';

    try {
      const res = await fetch(`/api/ads/${ad.id}/layout/export?mode=blueprint`, { credentials: 'include' });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || b.message || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `creative-layout-${ad.id.slice(0, 8)}-blueprint.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (hintEl) hintEl.textContent = 'Blueprint downloaded — import via Figma plugin';
    } catch (err) {
      console.error('[exportToFigmaBlueprint] failed:', err.message);
      if (hintEl) hintEl.textContent = 'Blueprint failed: ' + err.message;
    } finally {
      const figmaSvg = `<svg width="14" height="14" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0"><path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5Z" fill="currentColor"/><path d="M9.5 57A9.5 9.5 0 0 0 19 47.5V38H9.5A9.5 9.5 0 0 0 0 47.5 9.5 9.5 0 0 0 9.5 57Z" fill="currentColor"/><path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="currentColor"/><path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="currentColor"/><path d="M19 0V19H28.5A9.5 9.5 0 0 0 28.5 0Z" fill="currentColor"/></svg>`;
      if (btnEl)      { btnEl.disabled = false;      btnEl.innerHTML = figmaSvg + ' ◈ Blueprint (Claude)'; }
      if (fastEl)     { fastEl.disabled = false; }
      if (editableEl) { editableEl.disabled = false; }
    }
  }

  // ── Quick board card actions ─────────────────────────────────
  function downloadAd(adId) {
    const ad  = state.boardAds.find(a => a.id === adId);
    const src = resolveAdImage(ad);
    if (!src) return;
    const a  = document.createElement('a');
    a.href   = src;
    a.download = `meta-ad-${adId}.png`;
    a.click();
  }

  async function approveAd(adId) {
    try {
      const { data } = await api.put(`/ads/${adId}/status`, { status: 'approved' });
      const idx = state.boardAds.findIndex(a => a.id === data.id);
      if (idx >= 0) state.boardAds[idx] = data;
      applyBoardFilter();
      renderBoardCards(state.boardFiltered);
      updateBoardStats();
      toast('Approved');
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Brand Setup Modal ────────────────────────────────────────
  function openBrandSetup() {
    if (!state.activeBrand) return toast('Select a brand first', 'error');
    const b = state.activeBrand;
    document.getElementById('brand-setup-title').textContent = b.name + ' — Setup';
    // Ensure all fields are in sync (brand may have been updated externally)
    setVal('edit-brand-name',             b.name);
    setVal('edit-brand-industry',         b.industry);
    setVal('edit-brand-description',      b.description);
    setVal('edit-brand-color',            b.primary_color);
    setVal('edit-brand-secondary-color',  b.secondary_color);
    setVal('edit-brand-target-audience',  b.target_audience);
    setVal('edit-brand-voice',            b.brand_voice);
    setVal('edit-brand-offer-cta',        b.offer_cta);
    checkBrandKitComplete(b);
    openModal('modal-brand-setup');
    switchBrandTab('overview');
  }

  function switchBrandTab(tab) {
    state.brandTab = tab;
    ['overview','assets','personas','memory'].forEach(t => {
      document.getElementById(`btab-${t}`)?.classList.toggle('active', t === tab);
      document.getElementById(`brand-tab-${t}`)?.classList.toggle('hidden', t !== tab);
    });
    if (tab === 'assets'   && state.activeBrand) loadBrandAssets();
    if (tab === 'personas' && state.activeBrand) {
      loadPersonas(state.activeBrand.id).then(renderBrandPersonasList);
    }
    if (tab === 'memory'   && state.activeBrand) {
      loadMemory(state.activeBrand.id, state.memoryFilter || '');
      loadAngles(state.activeBrand.id);
    }
  }

  // ── Brand Memory ─────────────────────────────────────────────

  async function loadMemory(brandId, filter) {
    const grid = document.getElementById('memory-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-text">Loading…</div>';
    try {
      const params = filter ? `?source_type=${encodeURIComponent(filter)}` : '';
      const { data } = await api.get(`/brands/${brandId}/memory${params}`);
      renderMemoryGrid(data);
    } catch (e) {
      grid.innerHTML = `<div class="loading-text">Error loading memories.</div>`;
    }
  }

  function renderMemoryGrid(memories) {
    const grid = document.getElementById('memory-grid');
    if (!grid) return;
    if (!memories.length) {
      grid.innerHTML = '<div class="loading-text">No memories yet — analyze reference ads or approve generated ads to build brand memory.</div>';
      return;
    }
    grid.innerHTML = memories.map(m => {
      const badge = {
        approved_ad:   'Approved',
        rejected_ad:   'Rejected',
        reference_ad:  'Reference',
        manual_note:   'Note',
        template:      'Template',
        generated_ad:  'Generated',
      }[m.source_type] || m.source_type;
      const badgeClass = {
        approved_ad:  'badge-approved',
        rejected_ad:  'badge-rejected',
        reference_ad: 'badge-reference',
        manual_note:  'badge-note',
      }[m.source_type] || '';
      const summary = esc(m.summary || m.title || '');
      return `
        <div class="memory-card">
          <div class="memory-card-header">
            <span class="memory-badge ${badgeClass}">${badge}</span>
            <button class="memory-card-del" onclick="App.deleteMemory('${m.id}')" title="Delete">✕</button>
          </div>
          ${summary ? `<div class="memory-card-summary">${summary}</div>` : ''}
          ${m.visual_style     ? `<div class="memory-card-meta">Visual: ${esc(m.visual_style)}</div>` : ''}
          ${m.format           ? `<div class="memory-card-meta">Format: ${esc(m.format)}</div>` : ''}
          ${m.angle            ? `<div class="memory-card-meta">Angle: ${esc(m.angle)}</div>` : ''}
          ${m.performance_note ? `<div class="memory-card-reason">${esc(m.performance_note)}</div>` : ''}
          <div class="memory-card-time">${relTime(m.created_at)}</div>
        </div>`;
    }).join('');
  }

  async function loadAngles(brandId) {
    const list = document.getElementById('memory-angle-list');
    if (!list) return;
    try {
      const { data } = await api.get(`/brands/${brandId}/memory/angles`);
      renderAngleList(data);
    } catch {}
  }

  function renderAngleList(angles) {
    const list = document.getElementById('memory-angle-list');
    if (!list) return;
    if (!angles.length) {
      list.innerHTML = '<div class="loading-text">No angles yet — click Generate New Angles.</div>';
      return;
    }
    list.innerHTML = angles.map(a => {
      const hooks = Array.isArray(a.hook_examples) ? a.hook_examples : [];
      const hookPreview = hooks.length ? esc(hooks[0]) : '';
      return `
        <div class="memory-angle-card">
          <div class="memory-angle-body">
            <div class="memory-angle-name">${esc(a.name)}</div>
            ${a.description ? `<div class="memory-angle-hook">${esc(a.description)}</div>` : ''}
            ${hookPreview   ? `<div class="memory-card-meta">"${hookPreview}"</div>` : ''}
          </div>
          <button class="memory-card-del" onclick="App.deleteAngle('${a.id}')" title="Archive">✕</button>
        </div>`;
    }).join('');
  }

  function filterMemory(sourceType) {
    state.memoryFilter = sourceType;
    document.querySelectorAll('.memory-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === sourceType);
    });
    if (state.activeBrand) loadMemory(state.activeBrand.id, sourceType);
  }

  async function analyzeAllAssets() {
    if (!state.activeBrand) return;
    const btn = document.getElementById('btn-analyze-assets');
    if (btn) { btn.disabled = true; btn.textContent = '⊙ Analyzing…'; }
    try {
      await api.post(`/brands/${state.activeBrand.id}/memory/analyze-all-assets`, {});
      toast('Reference ads analyzed and saved to memory');
      loadMemory(state.activeBrand.id, state.memoryFilter || '');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⊙ Analyze Reference Ads'; }
    }
  }

  async function generateNewAngles() {
    if (!state.activeBrand) return;
    const btn = document.getElementById('btn-gen-angles');
    if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }
    try {
      await api.post(`/brands/${state.activeBrand.id}/memory/angles/generate`, {});
      toast('New angles generated');
      loadAngles(state.activeBrand.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✦ Generate New Angles'; }
    }
  }

  async function deleteMemory(memoryId) {
    if (!state.activeBrand) return;
    try {
      await api.delete(`/brands/${state.activeBrand.id}/memory/${memoryId}`);
      loadMemory(state.activeBrand.id, state.memoryFilter || '');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteAngle(angleId) {
    if (!state.activeBrand) return;
    try {
      await api.delete(`/brands/${state.activeBrand.id}/memory/angles/${angleId}`);
      loadAngles(state.activeBrand.id);
    } catch (e) { toast(e.message, 'error'); }
  }

  function openAddMemoryNote() {
    const note = prompt('Enter a creative note or guideline for this brand:');
    if (!note || !note.trim() || !state.activeBrand) return;
    api.post(`/brands/${state.activeBrand.id}/memory/manual`, { summary: note.trim() })
      .then(() => {
        toast('Note saved to Brand Memory');
        loadMemory(state.activeBrand.id, state.memoryFilter || '');
      })
      .catch(e => toast(e.message, 'error'));
  }

  async function approveAndLearn() {
    if (!state.studio.ad?.id) return;
    const btn = document.querySelector('.btn-memory-approve');
    if (btn) { btn.disabled = true; btn.textContent = '✦ Saving…'; }
    try {
      await api.post(`/ads/${state.studio.ad.id}/approve-learn`, {});
      toast('Ad approved and saved to Brand Memory');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✦ Approve & Learn'; }
    }
  }

  async function rejectAndLearn() {
    if (!state.studio.ad?.id) return;
    const reason = prompt('Why is this ad being rejected? (optional — helps the AI improve)') || '';
    const btn = document.querySelector('.btn-memory-reject');
    if (btn) { btn.disabled = true; btn.textContent = '✗ Saving…'; }
    try {
      await api.post(`/ads/${state.studio.ad.id}/reject-learn`, { reason });
      toast('Ad rejected and saved to Brand Memory');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✗ Reject & Learn'; }
    }
  }

  async function loadBrandAssets() {
    if (!state.activeBrand) return;
    try {
      const { data } = await api.get(`/brands/${state.activeBrand.id}/assets`);
      const grid = document.getElementById('brand-asset-grid');
      if (!grid) return;
      if (!data.length) { grid.innerHTML = '<div class="loading-text">No assets yet.</div>'; return; }
      grid.innerHTML = data.map(a => `
        <div class="asset-thumb">
          <img src="${a.file_url || a.url || ''}" alt="${esc(a.name)}" />
          <button class="asset-thumb-del" onclick="App.deleteAsset('${a.id}')">✕</button>
        </div>`).join('');
    } catch {}
  }

  async function deleteAsset(id) {
    try {
      await api.delete(`/upload/assets/${id}`);
      loadBrandAssets();
      toast('Asset deleted');
    } catch (e) { toast(e.message, 'error'); }
  }

  function initBrandAssetUpload() {
    const zone  = document.getElementById('brand-asset-drop');
    const input = document.getElementById('brand-asset-file');
    if (!zone || !input) return;
    zone.addEventListener('click',    () => input.click());
    zone.addEventListener('dragover', e  => { e.preventDefault(); zone.style.background = 'var(--accent-dim)'; });
    zone.addEventListener('dragleave',()  => zone.style.background = '');
    zone.addEventListener('drop',     e  => { e.preventDefault(); zone.style.background = ''; handleAssetFiles(e.dataTransfer.files); });
    input.addEventListener('change',  ()  => handleAssetFiles(input.files));
  }

  async function handleAssetFiles(files) {
    if (!state.activeBrand || !files.length) return;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    formData.append('brand_id',   state.activeBrand.id);
    formData.append('asset_type', 'image');
    try {
      await api.upload('/upload/assets', formData);
      loadBrandAssets();
      toast(`${files.length} asset${files.length > 1 ? 's' : ''} uploaded`);
    } catch (e) { toast(e.message, 'error'); }
  }

  // ── Image helpers ────────────────────────────────────────────
  function resolveAdImage(ad) {
    return ad?.image_url || ad?.imageUrl || ad?.output_url || ad?.generated_image_url || ad?.local_path || ad?.url || '';
  }

  // ── Helpers ──────────────────────────────────────────────────
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function getVal(id)       { return document.getElementById(id)?.value || ''; }
  function setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val || ''; }
  function setEl(id, text)  { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
  function clearInputs(ids) { ids.forEach(id => setVal(id, '')); }
  function capitalize(s)    { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function safeJSON(v)      { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }

  function relTime(ts) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function setGeneratingBtn(btn, labelId, text) {
    if (!btn) return;
    btn.disabled = true;
    const spinner = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>';
    btn.innerHTML = `${spinner} <span id="${labelId}">${text}</span>`;
  }

  function resetBtn(btn, labelId, text) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `<span>${text}</span>`;
    // Re-set the label id
    const span = btn.querySelector('span');
    if (span) span.id = labelId;
  }

  // ── Close dropdowns on outside click ─────────────────────────
  document.addEventListener('click', e => {
    if (!e.target.closest('.switcher') && !e.target.closest('.switcher-dropdown')) {
      closeAllDropdowns();
    }
  });

  // ── Close studio on overlay click ────────────────────────────
  document.getElementById('studio-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('studio-overlay')) closeStudio();
  });

  // ── Modal overlay close ───────────────────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeStudio();
    }
  });

  // ── AI Helper ─────────────────────────────────────────────────
  // Tracks which providers have API keys configured on the server.
  const _aiCap = { openai: true, anthropic: true, gemini: false }; // optimistic defaults

  const CONCEPT_PRESETS = {
    luxury:                'Premium, aspirational tone with high-end visual language. Focus on exclusivity, craftsmanship, and desire. Use minimal text with confident, evocative copy. Target affluent consumers who value quality over price.',
    direct_response:       'Aggressive direct-response with clear value proposition, urgency, and a specific offer. Lead with the benefit, back with social proof, close with a strong CTA. Every element drives the click.',
    ugc:                   'Authentic user-generated content style — raw, relatable, first-person voice. Feels like a genuine customer recommendation rather than a polished ad. Build trust through social proof and real testimonials.',
    native_feed:           'Blends seamlessly into organic feed content. Conversational, educational, low-pressure. Teaches or entertains first, sells second. Ideal for mid-funnel awareness building.',
    premium_wellness:      'Clean, calm, aspirational wellness aesthetic. Soft palettes, lifestyle-forward imagery, science-backed credibility. Speaks to self-care, transformation, and long-term wellbeing.',
    aggressive_conversion: 'High-urgency conversion play — limited time, limited stock, stacked social proof. Loss-aversion triggers throughout. Bold guarantees and risk-reversal to drive immediate action.',
    clean_minimal:         'Stark minimalism — white space, a single hero message, one strong visual. Let the product speak for itself. No clutter. Sophisticated confidence in simplicity.',
    founder_story:         'Authentic founder narrative — the why behind the brand. Personal, vulnerable, mission-driven. Builds deep brand connection and loyalty. Ideal for storytelling formats.',
  };

  async function _loadAiCapabilities() {
    try {
      const res  = await fetch('/api/health/ai');
      if (!res.ok) return;
      const data = await res.json();
      _aiCap.openai    = !!data.openai;
      _aiCap.anthropic = !!data.anthropic;
      _aiCap.gemini    = !!data.gemini;
      _applyAiCapabilities();
    } catch (e) {
      console.warn('[aiHelper] health check failed:', e.message);
    }
  }

  function _applyAiCapabilities() {
    // Update provider dropdowns
    _updateProviderSelect('ai-prov-instructions', 'openai');
    _updateProviderSelect('ai-prov-strategy',     'claude');
    // Export-best button state (requires Anthropic for best results, but still works without it)
    const bestBtn = document.getElementById('btn-export-figma-best');
    if (bestBtn) {
      bestBtn.title = !_aiCap.anthropic ? 'ANTHROPIC_API_KEY not set — will fall back to editable or fast export' : '';
    }
  }

  function _updateProviderSelect(selectId, defaultProvider) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    Array.from(sel.options).forEach(opt => {
      const provider = opt.value;
      const available = provider === 'openai'  ? _aiCap.openai
                      : provider === 'claude'  ? _aiCap.anthropic
                      : provider === 'gemini'  ? _aiCap.gemini
                      : false;
      opt.disabled = !available;
      opt.text     = (provider === 'openai'  ? '⬛ OpenAI'
                    : provider === 'claude'  ? '◆ Claude'
                    :                         '✦ Gemini') + (available ? '' : ' (key missing)');
    });
    // Set default to first available option matching preference
    if (!sel.value || sel.options[sel.selectedIndex]?.disabled) {
      const preferred = Array.from(sel.options).find(o => o.value === defaultProvider && !o.disabled)
                     || Array.from(sel.options).find(o => !o.disabled);
      if (preferred) sel.value = preferred.value;
    }
  }

  function _buildBrandContext() {
    const b = state.activeBrand;
    if (!b) return '';
    return [
      b.name             && `Brand: ${b.name}`,
      b.industry         && `Industry: ${b.industry}`,
      b.description      && `Description: ${b.description}`,
      b.primary_color    && `Primary color: ${b.primary_color}`,
      b.target_audience  && `Target audience: ${b.target_audience}`,
      b.brand_voice      && `Brand voice: ${b.brand_voice}`,
      b.offer_cta        && `CTA: ${b.offer_cta}`,
      b.headline_style   && `Headline style: ${b.headline_style}`,
    ].filter(Boolean).join('\n');
  }

  function _buildPersonaContext() {
    const ids     = state.concepts.selectedPersonaIds || [];
    const selected = state.personas.filter(p => ids.includes(p.id));
    return selected.map(p => p.name + (p.description ? ': ' + p.description : '')).join('\n');
  }

  async function _runAiHelper(textareaId, fieldType, mode) {
    const ta          = document.getElementById(textareaId);
    const selectId    = textareaId === 'remix-instructions' ? 'ai-prov-instructions' : 'ai-prov-strategy';
    const improveBtnId = textareaId === 'remix-instructions' ? 'ai-improve-instructions' : 'ai-improve-strategy';
    const generateBtnId = textareaId === 'remix-instructions' ? 'ai-generate-instructions' : 'ai-generate-strategy';
    const sel         = document.getElementById(selectId);
    const provider    = sel ? sel.value : 'openai';

    if (!ta) return;

    const improveBtn  = document.getElementById(improveBtnId);
    const generateBtn = document.getElementById(generateBtnId);
    const isImproving = (mode === 'improve' && ta.value.trim());
    const label       = isImproving ? '…Improving' : '…Generating';

    // Loading state
    if (improveBtn)  { improveBtn.disabled  = true; improveBtn.textContent  = isImproving ? '…' : improveBtn.textContent; }
    if (generateBtn) { generateBtn.disabled = true; generateBtn.textContent = isImproving ? generateBtn.textContent : label; }

    try {
      const res = await fetch('/api/ai/generate-strategy', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          field_type:       fieldType,
          mode:             (mode === 'generate') ? 'generate' : 'auto',
          existing_text:    mode === 'generate' ? '' : ta.value.trim(),
          brand_context:    _buildBrandContext(),
          persona_context:  _buildPersonaContext(),
          reference_context: '',
        }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || msg; } catch {}
        throw new Error(msg);
      }
      const { text } = await res.json();
      ta.value = text;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    } catch (err) {
      console.error('[aiHelper] failed:', err.message);
      toast('AI helper failed: ' + err.message, 'error');
    } finally {
      if (improveBtn)  { improveBtn.disabled  = false; improveBtn.textContent  = '✨ Improve'; }
      if (generateBtn) { generateBtn.disabled = false; generateBtn.textContent = '🧠 Generate'; }
    }
  }

  function aiGenerate(textareaId, fieldType) { _runAiHelper(textareaId, fieldType, 'generate'); }
  function aiImprove(textareaId, fieldType)  { _runAiHelper(textareaId, fieldType, 'improve');  }

  function applyConceptPreset(preset) {
    const text = CONCEPT_PRESETS[preset];
    if (!text) return;
    const ta = document.getElementById('concept-strategy');
    if (!ta) return;
    ta.value = text;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }

  // ── Boot ─────────────────────────────────────────────────────
  async function init() {
    checkBrandKitComplete(null);  // disable generate buttons until a brand is selected and kit is complete
    // Force state machine to EMPTY so initial DOM matches state
    state.workspaceState = 'uninit';  // bypass no-op guard
    setWorkspaceState(WS.EMPTY);
    _syncConceptPlanPanel();
    initRemixDropZones();
    initBrandAssetUpload();
    _restoreAvoidFromStorage();   // restore persisted avoid rules before first render
    _loadAiCapabilities(); // non-blocking — greys out unavailable providers after fetch
    await Promise.all([loadBrands(), loadFormats()]);
  }

  // init is called by Auth after login check — not auto-fired here

  // ── Debug helper ─────────────────────────────────────────────
  window.__debugUI = () => {
    console.group('[AdFlow Debug]');
    console.log('workspaceState:', state.workspaceState, '| workspaceTab:', state.workspaceTab);
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || s.position === 'absolute') {
        const z = parseInt(s.zIndex || 0);
        if (z > 50 && s.display !== 'none' && s.pointerEvents !== 'none') {
          const r = el.getBoundingClientRect();
          if (r.width > 100 && r.height > 100)
            console.warn('Possible blocking overlay:', el.id || el.className, '| z:', z, '| display:', s.display, '| pe:', s.pointerEvents);
        }
      }
    });
    console.groupEnd();
  };

  // ── Public API ────────────────────────────────────────────────
  return {
    // Boot — called by Auth after session check
    init,

    // Dropdowns
    toggleDropdown, closeAllDropdowns,

    // Modals
    openModal, closeModal,

    // Brands
    selectBrandById, submitNewBrand, saveBrand, openBrandSetup, switchBrandTab,

    // Assets
    deleteAsset, openAssetPicker, closeAssetPicker, selectPickerAsset, clearImageSlot,

    // Personas
    togglePersona, openCreatePersonaModal, submitNewPersona,

    // Campaigns
    selectCampaignById, createCampaign, selectNewCampaignMode,

    // Board
    filterBoard: _filterBoardDebounced, downloadAd, approveAd,

    // Workspace state machine
    switchWorkspaceTab,

    // Panel
    switchTab, selectRatio, adjustVolume, onVolumeInput, onConceptCountInput, toggleFormat, selectSpeedMode,

    // Avoid While Generating
    toggleAvoidSection, onAvoidInput, toggleAvoidChip,

    // Remix
    triggerRemixGenerate,
    addGenerationSlotCards, updateSlotCard, replaceSlotCardWithAd, addScoreBadge, markBestCard,

    // Editable Design Mode
    setGenMode, generateEditableDesign, renderEditableDesignPreview,

    // Concepts
    generateConceptPlan, removeConceptCard, generateAllConcepts,

    // Studio
    closeStudio, downloadStudioAd, approveStudioAd, deleteStudioAd, remixThisAd,
    approveAndLearn, rejectAndLearn, exportToFigma, exportToFigmaEditable, exportToFigmaBlueprint,
    exportEditableFigma,

    // Brand Memory
    filterMemory, analyzeAllAssets, generateNewAngles,
    deleteMemory, deleteAngle, openAddMemoryNote,

    // AI Helper
    aiGenerate, aiImprove, applyConceptPreset,
  };
})();
