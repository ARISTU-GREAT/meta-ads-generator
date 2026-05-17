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

  function showLogin() {
    document.getElementById('login-screen')?.classList.remove('hidden');
    document.getElementById('app-shell')?.classList.add('hidden');
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
        fetch('/api/auth/status'),
        fetch('/api/auth/me'),
      ]);
      const status = await statusRes.json();
      const me     = await meRes.json();

      if (me.authenticated) {
        showApp();
        App.init();
        return;
      }

      showLogin();
      if (!status.hasAdmin) {
        // No admin yet — show tabs and default to signup
        document.getElementById('login-tabs')?.classList.remove('hidden');
        showMode('signup');
      } else {
        // Admin exists — login only, no signup tab exposed
        showMode('login');
      }
    } catch {
      showLogin();
      showMode('login');
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      // Signup auto-logs in via session — go straight to app
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
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
    document.getElementById('login-password').value = '';
    // Re-check status in case tabs need to show
    check();
  }

  document.addEventListener('DOMContentLoaded', check);

  return { submitLogin, submitSignup, logout, showMode };
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
      referenceFile: null,
      productFile:   null,
      aspectRatio:   'square',
      outputVolume:  5,
      lastStrategy:  null,
    },
    concepts: {
      productFile:       null,
      plan:              null,
      selectedFormatIds: [],
      selectedPersonaIds:[],
      conceptCount:      5,
      outputVolume:      20,
      aspectRatio:       'square',
    },
    studio: {
      ad:     null,
      adData: null,   // parsed metadata
    },
  };

  // ── Constants ────────────────────────────────────────────────
  const BRAND_KIT_REQUIRED = ['name', 'description', 'primary_color', 'secondary_color', 'target_audience', 'brand_voice'];
  const BRAND_KIT_LABELS   = { name: 'Brand Name', description: 'Description', primary_color: 'Primary Color', secondary_color: 'Secondary Color', target_audience: 'Target Audience', brand_voice: 'Brand Voice' };

  // ── API Helpers ──────────────────────────────────────────────
  const api = {
    async get(path) {
      const r = await fetch(`/api${path}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    },
    async post(path, body) {
      const r = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    },
    async put(path, body) {
      const r = await fetch(`/api${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    },
    async delete(path) {
      const r = await fetch(`/api${path}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    },
    async upload(path, formData) {
      const r = await fetch(`/api${path}`, { method: 'POST', body: formData });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
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

  function renderBoardCards(ads) {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    // Keep skeleton cards that may still be loading
    const skeletons = Array.from(grid.querySelectorAll('.board-card.skeleton'));
    grid.innerHTML = '';
    // Re-add skeletons first
    skeletons.forEach(s => grid.appendChild(s));
    // Append real cards
    ads.forEach(ad => grid.appendChild(buildBoardCard(ad)));
    updateBoardCount(ads.length + skeletons.length);
  }

  function buildBoardCard(ad) {
    const metadata = safeJSON(ad.metadata) || {};
    const strategy = metadata.strategy || {};
    const format   = ad.ad_format || strategy.layout_type || 'ad';
    const energy   = strategy.ad_energy || '';

    const card = document.createElement('div');
    card.className = 'board-card';
    card.dataset.adId = ad.id;
    card.innerHTML = `
      <div class="board-card-img-wrap">
        ${ad.image_url ? `<img src="${ad.image_url}" alt="Ad" loading="lazy" />` : ''}
        <div class="board-card-overlay">
          <button class="board-card-action" onclick="event.stopPropagation();App.downloadAd('${ad.image_url}','${ad.id}')">↓</button>
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

  // Masonry skeleton heights — vary to look natural before images load
  const SKELETON_HEIGHTS = [200, 270, 230, 310, 245, 185, 290, 215, 260, 195];

  // ── Skeleton Cards ───────────────────────────────────────────
  function addSkeletonCards(count, startIndex = 0) {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    grid.classList.remove('hidden');
    document.getElementById('board-empty')?.classList.add('hidden');

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
    const skeleton = grid?.querySelector(`[data-skeleton-index="${skeletonIndex}"]`);
    if (skeleton && ad) {
      const realCard = buildBoardCard(ad);
      realCard.style.animation = 'card-in 0.4s cubic-bezier(0.16,1,0.3,1) both';
      skeleton.replaceWith(realCard);
    } else if (skeleton) {
      skeleton.remove();
    }
    updateBoardCount(grid?.querySelectorAll('.board-card:not(.skeleton)').length || 0);
    // Show grid, hide empty if board has content
    const total = grid?.querySelectorAll('.board-card').length || 0;
    document.getElementById('board-empty')?.classList.toggle('hidden', total > 0);
    grid?.classList.toggle('hidden', total === 0);
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
    setupDropZone('ref-drop',          'ref-file-input',     'ref-preview-wrap',          'referenceFile', state.remix);
    setupDropZone('prod-drop',         'prod-file-input',    'prod-preview-wrap',         'productFile',   state.remix);
    setupDropZone('concept-prod-drop', 'concept-prod-input', 'concept-prod-preview-wrap', 'productFile',   state.concepts);
  }

  function setupDropZone(zoneId, inputId, previewId, stateKey, stateObj) {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click',    () => input.click());
    input.addEventListener('change',  () => { if (input.files[0]) applyDropFile(stateObj, stateKey, input.files[0], previewId, zone); });
    zone.addEventListener('dragover', e  => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop',     e  => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) applyDropFile(stateObj, stateKey, f, previewId, zone);
    });
  }

  function applyDropFile(stateObj, stateKey, file, previewId, zone) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      return toast('Use JPG, PNG, or WebP', 'error');
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

  // ── Remix Generation (SSE Streaming) ─────────────────────────
  async function triggerRemixGenerate() {
    if (!state.activeBrand)          return toast('Select a brand first', 'error');
    if (!state.activeCampaign)       return toast('Create or select a campaign first', 'error');
    if (!state.remix.referenceFile)  return toast('Upload a reference ad image', 'error');
    if (!state.remix.productFile)    return toast('Upload a product image', 'error');

    const rawVol = parseInt(document.getElementById('remix-volume')?.value, 10);
    const n = Math.max(1, Math.min(20, isNaN(rawVol) ? state.remix.outputVolume : rawVol));
    state.remix.outputVolume = n;

    const btn = document.getElementById('btn-remix-generate');
    setGeneratingBtn(btn, 'btn-remix-label', `Generating…`);

    setWorkspaceState(WS.GENERATING);  // switches to board tab, shows pulsing indicator
    addSkeletonCards(n, 0);
    startGenerationProgress(n);
    _genTimer.reset();
    _genTimer.start();

    const formData = new FormData();
    formData.append('brand_id',        state.activeBrand.id);
    formData.append('campaign_id',     state.activeCampaign.id);
    formData.append('reference_image', state.remix.referenceFile);
    formData.append('product_image',   state.remix.productFile);
    formData.append('instructions',    getVal('remix-instructions'));
    formData.append('aspect_ratio',    state.remix.aspectRatio);
    formData.append('count',           n);
    formData.append('speed_mode',      state.speedMode);

    let completedCount = 0;

    try {
      await streamGenerate('/generate/remix/stream', formData, (event) => {
        if (event.type === 'progress' && event.success) {
          completedCount++;
          updateGenerationProgress(completedCount, n);
          replaceSkeletonCard(completedCount - 1, event.ad);
          state.boardAds.unshift(event.ad);
          updateBoardStats();
        } else if (event.type === 'progress' && !event.success) {
          completedCount++;
          updateGenerationProgress(completedCount, n);
          replaceSkeletonCard(completedCount - 1, null);
          toast(`Variation ${event.variationIndex} failed`, 'error');
        } else if (event.type === 'done') {
          state.remix.lastStrategy = event.creativeStrategy;
          if (event.creativeStrategy) renderContextStrategy(event.creativeStrategy);
        } else if (event.type === 'error') {
          toast('Generation error: ' + event.message, 'error');
        }
      });

      toast(`${completedCount} ad${completedCount !== 1 ? 's' : ''} generated!`);
    } catch (err) {
      document.querySelectorAll('.board-card.skeleton').forEach(s => s.remove());
      toast('Generation failed: ' + err.message, 'error');
    } finally {
      _genTimer.stop();
      resetBtn(btn, 'btn-remix-label', '✦ Generate');
      endGenerationProgress();
      setWorkspaceState(WS.BOARD);  // generation complete
      applyBoardFilter();
    }
  }

  // SSE stream reader — POST multipart, read response as text stream
  async function streamGenerate(path, formData, onEvent) {
    const response = await fetch(`/api${path}`, { method: 'POST', body: formData });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || response.statusText);
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
    if (state.concepts.productFile) {
      formData.append('product_image', state.concepts.productFile);
    }

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

        if (!state.concepts.productFile && !state.remix.productFile) {
          toast('Upload a product image in the Concepts panel', 'error');
          break;
        }

        // For concepts mode, we use the ref image from remix state as concept reference
        const refFile  = state.remix.referenceFile;
        const prodFile = state.concepts.productFile || state.remix.productFile;

        if (!prodFile) {
          toast('Product image required for generation', 'error');
          break;
        }

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
        if (refFile) formData.append('reference_image', refFile);
        else         formData.append('reference_image', prodFile); // fallback: use product as both
        formData.append('product_image', prodFile);
        formData.append('instructions',  instructions);
        formData.append('aspect_ratio',  document.getElementById('concept-ratio')?.value || 'square');
        formData.append('count',         n);
        formData.append('speed_mode',    state.speedMode);

        let conceptCompleted = 0;

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
          }
        });
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

    const img    = document.getElementById('studio-img');
    if (img) img.src = ad.image_url || '';

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
    if (!ad?.image_url) return;
    const a  = document.createElement('a');
    a.href   = ad.image_url;
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
    const ad = state.studio.ad;
    if (!ad?.image_url) return;

    // Load the ad image as a blob and set it as the reference file
    fetch(ad.image_url)
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

  // ── Quick board card actions ─────────────────────────────────
  function downloadAd(imageUrl, adId) {
    const a  = document.createElement('a');
    a.href   = imageUrl;
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
    ['overview','assets','personas'].forEach(t => {
      document.getElementById(`btab-${t}`)?.classList.toggle('active', t === tab);
      document.getElementById(`brand-tab-${t}`)?.classList.toggle('hidden', t !== tab);
    });
    if (tab === 'assets'   && state.activeBrand) loadBrandAssets();
    if (tab === 'personas' && state.activeBrand) {
      loadPersonas(state.activeBrand.id).then(renderBrandPersonasList);
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

  // ── Boot ─────────────────────────────────────────────────────
  async function init() {
    checkBrandKitComplete(null);  // disable generate buttons until a brand is selected and kit is complete
    // Force state machine to EMPTY so initial DOM matches state
    state.workspaceState = 'uninit';  // bypass no-op guard
    setWorkspaceState(WS.EMPTY);
    _syncConceptPlanPanel();
    initRemixDropZones();
    initBrandAssetUpload();
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
    deleteAsset,

    // Personas
    togglePersona, openCreatePersonaModal, submitNewPersona,

    // Campaigns
    selectCampaignById, createCampaign, selectNewCampaignMode,

    // Board
    filterBoard, downloadAd, approveAd,

    // Workspace state machine
    switchWorkspaceTab,

    // Panel
    switchTab, selectRatio, adjustVolume, onVolumeInput, onConceptCountInput, toggleFormat, selectSpeedMode,

    // Remix
    triggerRemixGenerate,

    // Concepts
    generateConceptPlan, removeConceptCard, generateAllConcepts,

    // Studio
    closeStudio, downloadStudioAd, approveStudioAd, deleteStudioAd, remixThisAd,
  };
})();
