/* AutoExpert Live - nadogradnja originalnog frontenda: živi podaci, nalozi, obaveštenja, istorija cena. */
(() => {
  const $ = id => document.getElementById(id);
  const api = async (url, opt = {}) => {
    const r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Greška ' + r.status);
    return j;
  };
  const token = () => { try { return localStorage.getItem('ae_token'); } catch { return null; } };
  let user = null;

  // ---------- Živi podaci ----------
  async function loadCars() {
    try {
      CAR_DATA = await api('/api/listings');
      applyFilters();
      if (!$('tab-sacuvani').classList.contains('hidden')) renderFavorites();
      const st = await api('/api/stats');
      $('stat-count').textContent = st.active.toLocaleString('sr-RS');
      $('stat-updated').textContent = st.lastError ? 'Greška izvora' : st.lastRun ? 'Ažurirano ' + new Date(st.lastRun).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' }) : 'Uživo';
    } catch (e) { console.error(e); }
  }
  loadCars(); setInterval(loadCars, 5 * 60 * 1000);

  // Tag "pad/rast cene" na kartici: dopuna originalnog generatora kartice
  const origCard = createCarCardHTML;
  createCarCardHTML = car => {
    let html = origCard(car);
    const d = car.price - car.firstPrice;
    if (d !== 0) {
      const down = d < 0;
      const tag = `<div class="absolute bottom-2 right-3 px-2 py-0.5 rounded text-[11px] font-bold ${down ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'}"><i class="fa-solid fa-arrow-${down ? 'down' : 'up'} mr-1"></i>${Math.abs(d).toLocaleString()} € od prvog viđenja</div>`;
      html = html.replace('<!-- Bottom Overlay: Deal Status -->', tag + '<!-- Bottom Overlay: Deal Status -->');
    }
    return html;
  };

  // ---------- Istorija cene u modalu ----------
  let histChart;
  const origOpen = openModal;
  openModal = async id => {
    origOpen(id);
    const anchor = $('modal-checks').parentElement;
    let box = $('modal-history');
    if (!box) { box = document.createElement('div'); box.id = 'modal-history'; box.className = 'mt-4'; anchor.parentElement.insertBefore(box, anchor); }
    box.innerHTML = '<div class="text-xs text-slate-500">Učitavanje istorije cene…</div>';
    try {
      const h = await api(`/api/listings/${encodeURIComponent(id)}/history`);
      if (h.length < 2) { box.innerHTML = '<h4 class="text-xs font-bold text-slate-300 mb-1"><i class="fa-solid fa-chart-line text-brand-500 mr-1"></i>Istorija cene</h4><p class="text-xs text-slate-500">Cena se do sada nije menjala (praćeno od ' + new Date(h[0].at).toLocaleDateString('sr-RS') + ').</p>'; return; }
      box.innerHTML = '<h4 class="text-xs font-bold text-slate-300 mb-2"><i class="fa-solid fa-chart-line text-brand-500 mr-1"></i>Istorija cene</h4><div class="h-32"><canvas id="hist-canvas"></canvas></div>';
      if (histChart) histChart.destroy();
      histChart = new Chart($('hist-canvas'), { type: 'line', data: { labels: h.map(p => new Date(p.at).toLocaleDateString('sr-RS')), datasets: [{ data: h.map(p => p.price), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.12)', fill: true, stepped: true, pointRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.05)' } } } } });
    } catch { box.innerHTML = ''; }
  };

  // ---------- UI: dugme za nalog + obaveštenja ----------
  const bar = document.querySelector('header .h-16');
  const acct = document.createElement('div');
  acct.className = 'flex items-center gap-2';
  acct.innerHTML = `<button id="bell-btn" class="hidden px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"><i class="fa-solid fa-bell mr-1.5"></i>Obaveštenja</button>
    <button id="acct-btn" class="px-3 py-2 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white"><i class="fa-solid fa-user mr-1.5"></i>Prijava</button>`;
  bar.insertBefore(acct, bar.lastElementChild);

  // "Sačuvaj pretragu" pored značke filtera
  const badge = $('active-filter-badge');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'ml-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25';
  saveBtn.innerHTML = '<i class="fa-solid fa-bell mr-1"></i>Obavesti me';
  badge.insertAdjacentElement('afterend', saveBtn);

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[60] hidden items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto';
  modal.innerHTML = '<div id="live-modal-body" class="glass-panel rounded-2xl w-full max-w-md p-6 relative"></div>';
  document.body.appendChild(modal);
  const body = $('live-modal-body');
  const show = html => { body.innerHTML = `<button id="lm-close" class="absolute top-3 right-3 text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>` + html; modal.classList.remove('hidden'); modal.classList.add('flex'); $('lm-close').onclick = hide; };
  const hide = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
  modal.addEventListener('click', e => { if (e.target === modal) hide(); });
  const inp = 'w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-brand-500';
  const err = m => `<p class="text-xs text-red-400 mt-2 min-h-[1rem]">${m || ''}</p>`;

  function setUser(u, t) {
    user = u; if (t) try { localStorage.setItem('ae_token', t); } catch {}
    $('acct-btn').innerHTML = u ? `<i class="fa-solid fa-user mr-1.5"></i>${u.email.split('@')[0]}` : '<i class="fa-solid fa-user mr-1.5"></i>Prijava';
    $('bell-btn').classList.toggle('hidden', !u);
  }
  (async () => { if (token()) try { setUser(await api('/api/me')); } catch { try { localStorage.removeItem('ae_token'); } catch {} } })();

  function authForm(mode = 'login', msg = '') {
    const reg = mode === 'register';
    show(`<h3 class="text-lg font-bold text-white mb-1">${reg ? 'Napravi nalog' : 'Prijava'}</h3>
      <p class="text-xs text-slate-400 mb-4">Nalog ti omogućava da sačuvaš pretrage i dobiješ obaveštenja.</p>
      <input id="a-email" type="email" placeholder="Email" class="${inp} mb-2"><input id="a-pass" type="password" placeholder="Lozinka (min. 8 karaktera)" class="${inp}">
      ${err(msg)}<button id="a-go" class="w-full mt-2 py-2 bg-brand-600 hover:bg-brand-500 rounded-xl text-sm font-bold text-white">${reg ? 'Registruj se' : 'Prijavi se'}</button>
      <button id="a-sw" class="w-full mt-3 text-xs text-slate-400 hover:text-white">${reg ? 'Već imaš nalog? Prijava' : 'Nemaš nalog? Registracija'}</button>`);
    $('a-sw').onclick = () => authForm(reg ? 'login' : 'register');
    $('a-go').onclick = async () => {
      try { const r = await api('/api/auth/' + mode, { method: 'POST', body: { email: $('a-email').value, password: $('a-pass').value } }); setUser(r.user, r.token); hide(); if (pendingSave) { pendingSave = false; saveForm(); } else if (pendingSell) { pendingSell = false; sellForm(); } }
      catch (e) { authForm(mode, e.message); }
    };
  }
  let pendingSave = false;

  $('acct-btn').onclick = () => user ? profile() : authForm();
  function profile(msg = '') {
    show(`<h3 class="text-lg font-bold text-white mb-1">${user.email}</h3><p class="text-xs text-slate-400 mb-4">Kontakt podaci za SMS i Viber obaveštenja.</p>
      <label class="text-[11px] text-slate-400">Telefon (+381…)</label><input id="p-phone" class="${inp} mb-2" value="${user.phone || ''}" placeholder="+381641234567">
      <label class="text-[11px] text-slate-400">Viber ID (dobija se nakon pretplate na AutoExpert Viber bota)</label><input id="p-viber" class="${inp}" value="${user.viber_id || ''}">
      ${err(msg)}<button id="p-save" class="w-full mt-2 py-2 bg-brand-600 hover:bg-brand-500 rounded-xl text-sm font-bold text-white">Sačuvaj</button>
      <button id="p-out" class="w-full mt-3 text-xs text-red-400 hover:text-red-300">Odjavi se</button>`);
    $('p-save').onclick = async () => { try { setUser(await api('/api/me', { method: 'PATCH', body: { phone: $('p-phone').value, viber_id: $('p-viber').value } })); profile('Sačuvano ✓'); } catch (e) { profile(e.message); } };
    $('p-out').onclick = () => { try { localStorage.removeItem('ae_token'); } catch {} setUser(null); hide(); };
  }

  const currentFilters = () => ({ search: $('quick-search').value, brand: $('filter-brand').value, maxPrice: +$('filter-max-price').value < 60000 ? $('filter-max-price').value : '',
    minYear: $('filter-min-year').value, fuel: $('filter-fuel').value, risk: $('filter-risk').value, deal: $('filter-deal').value });
  const describe = f => Object.entries({ Pretraga: f.search, Marka: f.brand, 'Max cena': f.maxPrice && f.maxPrice + ' €', 'Od god.': f.minYear, Gorivo: f.fuel, Rizik: f.risk, Cena: f.deal }).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Svi oglasi';

  saveBtn.onclick = () => { if (!user) { pendingSave = true; return authForm('register'); } saveForm(); };
  function saveForm(msg = '') {
    const f = currentFilters();
    show(`<h3 class="text-lg font-bold text-white mb-1">Obavesti me</h3><p class="text-xs text-slate-400 mb-3">${describe(f)}</p>
      <input id="s-name" class="${inp} mb-3" placeholder="Naziv pretrage" value="${f.brand ? f.brand + ' pretraga' : 'Moja pretraga'}">
      <label class="text-[11px] text-slate-400">Javi kad je AE Ocena veća ili jednaka: <b id="s-val" class="text-amber-400">9.0</b></label>
      <input id="s-score" type="range" min="6" max="10" step="0.1" value="9" class="w-full mb-3 accent-amber-500">
      <div class="flex gap-4 text-xs text-slate-300 mb-3"><label><input type="checkbox" class="s-ch" value="email" checked> Email</label><label><input type="checkbox" class="s-ch" value="sms"> SMS</label><label><input type="checkbox" class="s-ch" value="viber"> Viber</label></div>
      <label class="text-xs text-slate-300"><input id="s-drop" type="checkbox" checked> Obavesti i kad cena padne</label>
      ${err(msg)}<button id="s-go" class="w-full mt-2 py-2 bg-amber-500 hover:bg-amber-400 rounded-xl text-sm font-bold text-slate-950">Sačuvaj pretragu</button>`);
    $('s-score').oninput = e => $('s-val').textContent = (+e.target.value).toFixed(1);
    $('s-go').onclick = async () => {
      const channels = [...document.querySelectorAll('.s-ch:checked')].map(c => c.value);
      if ((channels.includes('sms') && !user.phone) || (channels.includes('viber') && !user.viber_id)) return saveForm('Za SMS/Viber prvo upiši broj/ID u profilu (klik na svoje ime gore).');
      try { await api('/api/searches', { method: 'POST', body: { name: $('s-name').value, filters: f, minScore: +$('s-score').value, channels, notifyPriceDrop: $('s-drop').checked } }); searches(); }
      catch (e) { saveForm(e.message); }
    };
  }

  $('bell-btn').onclick = searches;
  async function searches() {
    const list = await api('/api/searches');
    show(`<h3 class="text-lg font-bold text-white mb-3">Moja obaveštenja</h3>` + (list.length ? list.map(s => `
      <div class="border border-slate-800 rounded-xl p-3 mb-2 text-xs"><div class="flex justify-between items-start"><div><div class="font-bold text-slate-100">${s.name}</div>
      <div class="text-slate-400 mt-0.5">${describe(s.filters)}</div><div class="text-amber-400 mt-1">AE ≥ ${s.minScore.toFixed(1)} · ${s.channels.join(', ')}${s.notifyPriceDrop ? ' · pad cene' : ''}</div></div>
      <div class="flex gap-2"><button data-t="${s.id}" data-a="${s.active ? 0 : 1}" class="${s.active ? 'text-emerald-400' : 'text-slate-500'}" title="Uključi/isključi"><i class="fa-solid fa-power-off"></i></button><button data-d="${s.id}" class="text-red-400"><i class="fa-solid fa-trash"></i></button></div></div></div>`).join('')
      : '<p class="text-xs text-slate-400">Još nema sačuvanih pretraga. Podesi filtere i klikni „Obavesti me“.</p>'));
    body.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { await api('/api/searches/' + b.dataset.d, { method: 'DELETE' }); searches(); });
    body.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { await api('/api/searches/' + b.dataset.t, { method: 'PATCH', body: { active: b.dataset.a === '1' } }); searches(); });
  }

  // ---------- Vlastiti oglasi ----------
  const sell = document.createElement('button');
  sell.className = 'px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white';
  sell.innerHTML = '<i class="fa-solid fa-plus mr-1.5"></i>Postavi oglas';
  acct.prepend(sell);
  const mineBtn = document.createElement('button');
  mineBtn.id = 'mine-btn'; mineBtn.className = 'hidden px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700';
  mineBtn.innerHTML = '<i class="fa-solid fa-car mr-1.5"></i>Moji oglasi';
  acct.prepend(mineBtn);
  const _setUser = setUser;
  setUser = (u, t) => { _setUser(u, t); mineBtn.classList.toggle('hidden', !u); };

  // nove marke iz oglasa pojavljuju se u filteru
  const _load = loadCars;
  loadCars = async () => { await _load(); const sel = $('filter-brand'); const have = new Set([...sel.options].map(o => o.value));
    [...new Set(CAR_DATA.map(c => c.brand))].filter(b => !have.has(b)).sort().forEach(b => sel.add(new Option(b, b))); };
  loadCars().then(() => { const id = decodeURIComponent(location.hash.slice(1)); if (id.startsWith('user:') && CAR_DATA.some(c => c.id === id)) openModal(id); });

  // modal: opis + kontakt za oglase korisnika
  const _open2 = openModal;
  openModal = async id => {
    await _open2(id);
    const car = CAR_DATA.find(c => c.id === id); if (!car || !car.isUser) return;
    const link = $('modal-external-link'); link.href = 'tel:' + car.contactPhone; link.innerHTML = `<i class="fa-solid fa-phone mr-1.5"></i>Pozovi ${car.contactPhone}`; link.removeAttribute('target');
    let d = $('modal-desc'); if (!d) { d = document.createElement('p'); d.id = 'modal-desc'; d.className = 'text-xs text-slate-300 leading-relaxed mt-3 whitespace-pre-line'; $('modal-history').insertAdjacentElement('beforebegin', d); }
    d.innerHTML = car.description ? `<b class="text-slate-200">Opis prodavca:</b><br>${car.description}` : '';
  };

  sell.onclick = () => { if (!user) { pendingSell = true; return authForm('register'); } sellForm(); };
  let pendingSell = false;
  const _authOK = hide;
  mineBtn.onclick = myListings;

  const brands = () => [...$('filter-brand').options].map(o => o.value).filter(Boolean);
  const sel = (id, opts, ph) => `<select id="${id}" class="${inp}"><option value="">${ph}</option>${opts.map(o => `<option>${o}</option>`).join('')}</select>`;
  function sellForm(msg = '') {
    show(`<h3 class="text-lg font-bold text-white mb-1">Postavi oglas</h3>
      <p class="text-xs text-slate-400 mb-3">Oglas dobija AE Ocenu, procenu tržišne cene i istoriju cene. Kupci sa sačuvanom pretragom odmah dobijaju obaveštenje.</p>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input id="f-brand" list="f-brands" class="${inp}" placeholder="Marka"><datalist id="f-brands">${brands().map(b => `<option value="${b}">`).join('')}</datalist>
        <input id="f-model" class="${inp}" placeholder="Model i oprema">
        <input id="f-year" type="number" class="${inp}" placeholder="Godište"><input id="f-price" type="number" class="${inp}" placeholder="Cena (€)">
        <input id="f-km" type="number" class="${inp}" placeholder="Kilometraža"><input id="f-city" class="${inp}" placeholder="Grad">
        ${sel('f-fuel', ['Dizel', 'Benzin', 'Hibrid', 'Električni'], 'Gorivo')}${sel('f-gear', ['Automatski', 'Manuelni'], 'Menjač')}
        <input id="f-engine" class="${inp}" placeholder="Motor (npr. 1968 cm³ / 140 kW)"><input id="f-body" class="${inp}" placeholder="Karoserija">
      </div>
      <input id="f-phone" class="${inp} mb-2" placeholder="Kontakt telefon (+381641234567)">
      <textarea id="f-desc" rows="3" maxlength="2000" class="${inp} mb-2" placeholder="Opis, servisna istorija, oprema…"></textarea>
      <label class="text-[11px] text-slate-400">Slike (do 6, JPG/PNG/WEBP, max 5 MB)</label>
      <input id="f-img" type="file" accept="image/jpeg,image/png,image/webp" multiple class="w-full text-xs text-slate-300 mt-1">
      ${err(msg)}<button id="f-go" class="w-full mt-1 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold text-white">Objavi oglas</button>`);
    $('f-go').onclick = async () => {
      const fd = new FormData(), v = k => $('f-' + k).value;
      Object.entries({ brand: v('brand'), model: v('model'), year: v('year'), price: v('price'), mileage: v('km'), location: v('city'), fuel: v('fuel'), transmission: v('gear'), engine: v('engine'), body: v('body'), contactPhone: v('phone'), description: v('desc') }).forEach(([k, x]) => fd.append(k, x));
      [...$('f-img').files].forEach(f => fd.append('images', f));
      $('f-go').disabled = true; $('f-go').textContent = 'Objavljivanje…';
      try {
        const r = await fetch('/api/my/listings', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd });
        const j = await r.json(); if (!r.ok) throw new Error(j.error);
        await loadCars(); myListings('Oglas je objavljen ✓');
      } catch (e) { sellForm(e.message); }
    };
  }

  async function myListings(msg) {
    const list = await api('/api/my/listings');
    const st = { active: ['Aktivan', 'text-emerald-400'], sold: ['Prodat', 'text-slate-400'], expired: ['Istekao', 'text-amber-400'] };
    show(`<h3 class="text-lg font-bold text-white mb-1">Moji oglasi</h3><p class="text-xs text-emerald-400 mb-2 min-h-[1rem]">${typeof msg === 'string' ? msg : ''}</p>
      <div class="max-h-[60vh] overflow-y-auto pr-1">` + (list.length ? list.map(l => `
      <div class="border border-slate-800 rounded-xl p-3 mb-2 text-xs">
        <div class="flex gap-3"><img src="${l.image}" class="w-16 h-12 object-cover rounded-lg"><div class="flex-1"><div class="font-bold text-slate-100">${l.brand} ${l.model}</div>
        <div class="text-slate-400">${l.year}. · ${l.mileage.toLocaleString()} km · AE ${l.score ?? '—'} · <span class="${st[l.status][1]}">${st[l.status][0]}</span></div></div></div>
        <div class="flex items-center gap-2 mt-2"><input data-p="${l.id}" type="number" value="${l.price}" class="${inp} !py-1 !text-xs w-28"><button data-save="${l.id}" class="px-2 py-1 rounded-lg bg-brand-600 text-white font-semibold">Nova cena</button>
        ${l.status === 'active' ? `<button data-sold="${l.id}" class="px-2 py-1 rounded-lg bg-slate-800 text-slate-200">Prodat</button><button data-renew="${l.id}" class="px-2 py-1 rounded-lg bg-slate-800 text-slate-200" title="Produži 60 dana">Obnovi</button>` : `<button data-renew="${l.id}" class="px-2 py-1 rounded-lg bg-emerald-700 text-white">Aktiviraj</button>`}
        <button data-del="${l.id}" class="ml-auto text-red-400"><i class="fa-solid fa-trash"></i></button></div></div>`).join('')
      : '<p class="text-xs text-slate-400">Još nemaš oglasa.</p>') + `</div><button id="m-new" class="w-full mt-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold text-white">+ Novi oglas</button>`);
    const patch = async (id, body, m) => { try { await api('/api/my/listings/' + encodeURIComponent(id), { method: 'PATCH', body }); await loadCars(); myListings(m); } catch (e) { myListings(e.message); } };
    $('m-new').onclick = () => sellForm();
    body.querySelectorAll('[data-save]').forEach(b => b.onclick = () => patch(b.dataset.save, { price: body.querySelector(`[data-p="${b.dataset.save}"]`).value }, 'Cena izmenjena - kupci sa praćenjem su obavešteni ✓'));
    body.querySelectorAll('[data-sold]').forEach(b => b.onclick = () => patch(b.dataset.sold, { status: 'sold' }, 'Oglas označen kao prodat ✓'));
    body.querySelectorAll('[data-renew]').forEach(b => b.onclick = () => patch(b.dataset.renew, { renew: true }, 'Oglas aktivan još 60 dana ✓'));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Trajno obrisati oglas?')) { await api('/api/my/listings/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await loadCars(); myListings('Obrisano ✓'); } });
  }
})();
