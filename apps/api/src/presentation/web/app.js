/* وصال — واجهة ويب خفيفة (معاينة) تعمل على نفس واجهة الـ API عبر روابط نسبية فقط */
(() => {
  'use strict';
  const API = '/v1';
  const $app = document.getElementById('app');
  const store = {
    get tokens() { try { return JSON.parse(localStorage.getItem('wesal.tokens') || 'null'); } catch { return null; } },
    set tokens(v) { v ? localStorage.setItem('wesal.tokens', JSON.stringify(v)) : localStorage.removeItem('wesal.tokens'); },
    get user() { try { return JSON.parse(localStorage.getItem('wesal.user') || 'null'); } catch { return null; } },
    set user(v) { v ? localStorage.setItem('wesal.user', JSON.stringify(v)) : localStorage.removeItem('wesal.user'); },
    get queue() { try { return JSON.parse(localStorage.getItem('wesal.queue') || '[]'); } catch { return []; } },
    set queue(v) { localStorage.setItem('wesal.queue', JSON.stringify(v)); },
  };
  const state = { view: 'home', params: {}, cache: {}, loading: false };

  const STATUS_COLOR = { checked: 'var(--checked)', due: 'var(--due)', unverified: 'var(--unverified)', needs_followup: 'var(--followup)', upcoming: 'var(--upcoming)', paused: 'var(--paused)', deceased_reported: 'var(--deceased)' };
  const STATUS_LABEL = { checked: 'تم الاطمئنان', due: 'حان وقت الاطمئنان', unverified: 'لم يتم التحقق', needs_followup: 'يحتاج متابعة', upcoming: 'موعد قادم', paused: 'متوقف مؤقتًا', deceased_reported: 'تم الإبلاغ عن الوفاة' };
  const REL = { father: 'الأب', mother: 'الأم', grandfather: 'الجد', grandmother: 'الجدة', brother: 'الأخ', sister: 'الأخت', uncle_paternal: 'العم', aunt_paternal: 'العمة', uncle_maternal: 'الخال', aunt_maternal: 'الخالة', cousin_paternal: 'ابن/ابنة العم', cousin_maternal: 'ابن/ابنة الخال', son: 'الابن', daughter: 'الابنة', spouse: 'الزوج/الزوجة', friend: 'صديق', neighbor: 'جار', other: 'شخص آخر' };
  const WEEKDAYS = { 6: 'السبت', 7: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة' };
  const ENTRY_STATUS = { checked: 'تم', due: 'حان', unverified: 'لم يتم التحقق', upcoming: 'قادم', snoozed: 'مؤجَّل', cancelled: 'مُلغى', skipped: 'مُتخطّى' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`);
  const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
  const fmtTime = (iso, zone) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(iso));

  let toastTimer;
  function toast(msg, isErr) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ─────────────────────────── API ───────────────────────────
  async function api(method, path, body, opts = {}) {
    const headers = { 'Accept-Language': 'ar' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const t = store.tokens;
    if (t?.accessToken && !opts.noAuth) headers.Authorization = `Bearer ${t.accessToken}`;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw Object.assign(new Error('تعذّر الاتصال بالخادم. تحقّق من الإنترنت — بياناتك محفوظة وستُزامَن لاحقًا.'), { code: 'network' });
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !opts.retried && t?.refreshToken && !opts.noAuth) {
      const ok = await refresh();
      if (ok) return api(method, path, body, { ...opts, retried: true });
      logout();
      throw Object.assign(new Error('انتهت الجلسة. سجّل الدخول مرة أخرى.'), { code: 'unauthorized' });
    }
    if (!res.ok || !json || json.ok === false) {
      const err = json?.error || {};
      throw Object.assign(new Error(err.message || 'حدث خطأ غير متوقع. حاول مرة أخرى.'), { code: err.code || res.status, details: err.details });
    }
    return json.data;
  }
  async function refresh() {
    try {
      const t = store.tokens;
      const data = await api('POST', '/auth/refresh', { refreshToken: t.refreshToken }, { noAuth: true, retried: true });
      store.tokens = data.tokens;
      store.user = data.user;
      return true;
    } catch { return false; }
  }
  function logout() { store.tokens = null; store.user = null; navigate('login'); }

  // ─────────────────── طابور دون اتصال (idempotent) ───────────────────
  async function flushQueue() {
    const q = store.queue;
    if (!q.length || !store.tokens) return;
    try {
      const res = await api('POST', '/sync', { operations: q });
      store.queue = [];
      if (res.applied) toast(`تمت المزامنة ❤️ (${res.applied})`);
    } catch { /* نحاول لاحقًا */ }
  }
  window.addEventListener('online', flushQueue);

  async function act(personId, kind, payload) {
    const idempotencyKey = uid();
    const paths = { check_in: 'check-ins', attempt: 'attempts', snooze: 'snooze' };
    const types = { check_in: 'record_check_in', attempt: 'record_attempt', snooze: 'snooze' };
    const body = { ...payload, idempotencyKey };
    try {
      return await api('POST', `/persons/${personId}/${paths[kind]}`, body);
    } catch (e) {
      if (e.code === 'network') {
        store.queue = [...store.queue, { idempotencyKey, type: types[kind], clientOccurredAt: new Date().toISOString(), payload: { ...body, personId, occurredAt: new Date().toISOString() } }];
        toast('لا يوجد اتصال الآن — حفظنا الاطمئنان وسنزامن عند عودة الإنترنت.');
        return null;
      }
      throw e;
    }
  }

  // ─────────────────────────── التوجيه ───────────────────────────
  function navigate(view, params = {}, push = true) {
    state.view = view; state.params = params;
    const url = view === 'home' ? '/' : view === 'person' ? `/persons/${params.id}` : `/app/${view}`;
    if (push && !['invite', 'fine'].includes(view)) history.pushState({ view, params }, '', url);
    render();
  }
  window.addEventListener('popstate', (e) => { if (e.state) { state.view = e.state.view; state.params = e.state.params; render(); } else routeFromLocation(false); });
  function routeFromLocation(push) {
    const p = location.pathname;
    let m;
    if ((m = p.match(/^\/invite\/([^/]+)/))) return navigate('invite', { token: decodeURIComponent(m[1]) }, false);
    if ((m = p.match(/^\/fine\/([^/]+)/))) return navigate('fine', { token: decodeURIComponent(m[1]) }, false);
    if ((m = p.match(/^\/persons\/([^/]+)/))) return navigate('person', { id: m[1] }, push);
    if ((m = p.match(/^\/app\/([a-z-]+)/))) return navigate(m[1], {}, push);
    return navigate('home', {}, push);
  }

  // ─────────────────────────── العرض ───────────────────────────
  function shell(title, sub, body, tab) {
    const user = store.user;
    $app.innerHTML = `
      <header class="top">
        <div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
        <div class="row" style="flex:0 0 auto;gap:6px">
          <button class="btn sm ghost" data-nav="notifications" title="الإشعارات">🔔</button>
          <button class="btn sm ghost" data-nav="settings" title="الإعدادات">${esc((user?.displayName || 'أنا').slice(0, 10))}</button>
        </div>
      </header>
      <main>${body}</main>
      <nav class="tabs">
        ${[['home', '🏠', 'الرئيسية'], ['family', '👨‍👩‍👧', 'العائلة'], ['week', '📅', 'الأسبوع'], ['logs', '📖', 'السجل'], ['settings', '⚙️', 'الإعدادات']]
          .map(([v, ic, l]) => `<button data-nav="${v}" class="${tab === v ? 'active' : ''}"><span class="ic">${ic}</span>${l}</button>`).join('')}
      </nav>`;
  }

  async function render() {
    const v = state.view;
    if (v === 'invite') return renderInvite();
    if (v === 'fine') return renderFine();
    if (!store.tokens) return renderLogin();
    if (store.queue.length) flushQueue();
    try {
      if (v === 'home') return await renderHome();
      if (v === 'family') return await renderFamily();
      if (v === 'add') return renderAdd();
      if (v === 'person') return await renderPerson(state.params.id);
      if (v === 'week') return await renderWeek();
      if (v === 'logs') return await renderLogs();
      if (v === 'notifications') return await renderNotifications();
      if (v === 'settings') return renderSettings();
      return await renderHome();
    } catch (e) {
      if (e.code === 'unauthorized') return;
      shell('وصال', '', `<div class="card empty"><div class="big">🌿</div><h3>${esc(e.message)}</h3><button class="btn primary" onclick="location.reload()">إعادة المحاولة</button></div>`, v);
    }
  }

  // ─── تسجيل الدخول ───
  function renderLogin(step = 'phone', ctx = {}) {
    $app.innerHTML = `
      <main style="padding-top:40px">
        <div class="center" style="margin-bottom:24px"><div style="font-size:3.5rem">❤️</div><h1 style="margin:4px 0">وصال</h1><p class="muted">لا تجعل الانشغال يجعلك تنسى من تحب.</p></div>
        <div class="card">
          ${step === 'phone' ? `
            <h2>أهلًا بك في وصال</h2>
            <p class="muted small">أدخل رقم هاتفك لنرسل لك رمز تحقق. لا نستخدم الرقم لأي غرض آخر.</p>
            <form id="f">
              <div class="field"><label>رقم الهاتف</label><input name="phone" dir="ltr" inputmode="tel" placeholder="+9665xxxxxxxx" value="${esc(ctx.phone || '')}" required /></div>
              <button class="btn primary block" type="submit">أرسل الرمز</button>
            </form>` : `
            <h2>رمز التحقق</h2>
            <p class="muted small">أرسلنا رمزًا إلى <bdi>${esc(ctx.phone)}</bdi>. الرمز صالح لمدة 10 دقائق.</p>
            ${ctx.devCode ? `<div class="code-hint">وضع التطوير: رمز التحقق هو <bdi>${esc(ctx.devCode)}</bdi></div><br/>` : ''}
            <form id="f">
              <div class="field"><label>الرمز</label><input name="code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" value="${esc(ctx.devCode || '')}" required /></div>
              <div class="field"><label>اسمك (اختياري)</label><input name="displayName" placeholder="مثال: أحمد" /></div>
              <button class="btn primary block" type="submit">تحقق</button>
              <button class="btn ghost block" type="button" id="back" style="margin-top:8px">رجوع</button>
            </form>`}
        </div>
        <p class="center muted small">وصال ليس تطبيق مراقبة. لا قراءة رسائل، لا تسجيل مكالمات، لا تتبع موقع.</p>
      </main>`;
    const f = document.getElementById('f');
    document.getElementById('back')?.addEventListener('click', () => renderLogin('phone', ctx));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      const fd = new FormData(f);
      try {
        if (step === 'phone') {
          const phone = String(fd.get('phone')).replace(/[\s()-]/g, '');
          const r = await api('POST', '/auth/otp/request', { phone, locale: 'ar' }, { noAuth: true });
          renderLogin('code', { phone, devCode: r.devCode });
        } else {
          const r = await api('POST', '/auth/otp/verify', { phone: ctx.phone, code: String(fd.get('code')).trim(), locale: 'ar', timezone: tz(), displayName: String(fd.get('displayName') || '') || undefined, device: { platform: 'web', timezone: tz(), locale: 'ar' } }, { noAuth: true });
          store.tokens = { accessToken: r.accessToken, refreshToken: r.refreshToken };
          store.user = r.user;
          toast(r.isNewUser ? 'أهلًا بك في وصال ❤️' : 'أهلًا بعودتك ❤️');
          navigate('home');
        }
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  }

  // ─── الرئيسية ───
  function personCard(c) {
    const color = STATUS_COLOR[c.status] || STATUS_COLOR.upcoming;
    const dark = ['needs_followup', 'deceased_reported'].includes(c.status);
    const canAct = ['due', 'unverified', 'needs_followup', 'upcoming'].includes(c.status);
    return `<div class="card">
      <div class="person" data-open="${c.id}">
        <div class="avatar" style="--st:${color}">${esc((c.displayName || '?').trim().charAt(0))}</div>
        <div class="info">
          <div class="name">${esc(c.displayName)} <span class="muted small">· ${esc(REL[c.relationship] || c.relationship)}</span></div>
          <div class="meta">${c.entryTimeLabel ? `⏰ ${esc(c.entryTimeLabel)}` : ''} ${c.lastCheckInAt ? `· آخر اطمئنان ${esc(new Date(c.lastCheckInAt).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' }))}` : ''}</div>
        </div>
        <span class="badge ${dark ? 'dark' : ''}" style="--st:${color}">${esc(STATUS_LABEL[c.status] || c.status)}</span>
      </div>
      ${canAct ? `<div class="actions">
        <button class="btn heart" data-act="check_in" data-id="${c.id}" data-entry="${c.entryId || ''}">❤️ تم الاطمئنان</button>
        <button class="btn" data-act="attempt" data-id="${c.id}" data-entry="${c.entryId || ''}">📞 اتصلت ولم يرد</button>
        <button class="btn ghost" data-act="snooze" data-id="${c.id}" data-entry="${c.entryId || ''}">⏰ لاحقًا</button>
      </div>` : ''}
    </div>`;
  }
  function bindActions(root) {
    root.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => navigate('person', { id: el.dataset.open })));
    root.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.nav === 'add' ? 'add' : el.dataset.nav)));
    root.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { act: kind, id, entry } = el.dataset;
      el.disabled = true;
      try {
        let r;
        if (kind === 'check_in') r = await act(id, 'check_in', { entryId: entry || null, method: 'call', status: 'reassured' });
        else if (kind === 'attempt') r = await act(id, 'attempt', { entryId: entry || null, outcome: 'no_answer' });
        else r = await act(id, 'snooze', { entryId: entry || null, minutes: 30 });
        if (r) toast(r.confirmationMessage || r.message || 'تم ❤️');
        render();
      } catch (err) { toast(err.message, true); el.disabled = false; }
    }));
  }
  async function renderHome() {
    const t = await api('GET', '/today');
    const body = t.isEmpty
      ? `<div class="card empty"><div class="big">❤️</div><h2>${esc(t.emptyState.title)}</h2><p class="muted">${esc(t.emptyState.body)}</p><button class="btn heart" data-nav="add">+ إضافة شخص</button></div>`
      : `<div class="card greeting"><div class="date">${esc(t.dateLabel)}</div><h2>${esc(t.greeting)}</h2>
          <div class="counts"><span>يحتاجون الاطمئنان ${t.counts.dueToday + t.counts.unverified + t.counts.needsFollowUp}</span><span>تم ${t.counts.checked}</span><span>قادم ${t.counts.upcoming}</span></div></div>
        ${t.suggestion ? `<div class="notice">✨ ${esc(t.suggestion.text)}</div><br/>` : ''}
        ${t.cards.map(personCard).join('')}`;
    shell('وصال ❤️', 'من يحتاج منك أن تطمئن عليه اليوم؟', body + `<button class="fab" data-nav="add">+ إضافة شخص</button>`, 'home');
    bindActions($app);
  }

  // ─── العائلة ───
  async function renderFamily(q = '', status = '') {
    const r = await api('GET', `/persons?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`);
    shell('عائلتي', `${r.total} ${r.total === 1 ? 'شخص' : 'أشخاص'}`, `
      <div class="field"><input id="q" placeholder="بحث بالاسم أو صلة القرابة" value="${esc(q)}" /></div>
      <div class="chips" style="margin-bottom:12px">${[['', 'الكل'], ['needs_check_in', 'يحتاجون الاطمئنان'], ['checked', 'تم'], ['paused', 'متوقف']].map(([k, l]) => `<button class="chip ${status === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      ${r.items.length ? r.items.map(personCard).join('') : `<div class="card empty"><div class="big">🌿</div><p class="muted">لا توجد نتائج.</p></div>`}
      <button class="fab" data-nav="add">+ إضافة شخص</button>`, 'family');
    bindActions($app);
    let timer;
    document.getElementById('q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => renderFamily(e.target.value, status), 300); });
    $app.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => renderFamily(q, b.dataset.f)));
  }

  // ─── إضافة شخص (أقل من دقيقة: الاسم، الصلة، الجدول) ───
  function renderAdd() {
    let days = new Set([5]);
    let times = ['18:00'];
    const paint = () => {
      $app.querySelector('#days').innerHTML = [6, 7, 1, 2, 3, 4, 5].map((d) => `<button type="button" class="chip ${days.has(d) ? 'on' : ''}" data-d="${d}">${WEEKDAYS[d]}</button>`).join('');
      $app.querySelector('#times').innerHTML = times.map((t, i) => `<div class="row" style="margin-bottom:6px"><input type="time" value="${t}" data-t="${i}" /><button type="button" class="btn sm ghost" data-rm="${i}" style="flex:0">✕</button></div>`).join('') + (times.length < 4 ? `<button type="button" class="btn sm ghost" id="addTime">+ وقت آخر</button>` : '');
      $app.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { const d = Number(b.dataset.d); days.has(d) ? days.delete(d) : days.add(d); paint(); }));
      $app.querySelectorAll('[data-t]').forEach((i) => i.addEventListener('change', () => { times[Number(i.dataset.t)] = i.value; }));
      $app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { if (times.length > 1) { times.splice(Number(b.dataset.rm), 1); paint(); } }));
      $app.querySelector('#addTime')?.addEventListener('click', () => { times.push('20:00'); paint(); });
    };
    shell('إضافة شخص', 'الاسم وصلة القرابة والجدول — والباقي اختياري', `
      <form id="f" class="card">
        <div class="chips" style="margin-bottom:12px">${[['يوميًا', [1, 2, 3, 4, 5, 6, 7]], ['عدة أيام', [7, 2, 4]], ['أسبوعيًا', [5]]].map(([l, ds]) => `<button type="button" class="chip" data-preset="${ds.join(',')}">${l}</button>`).join('')}</div>
        <div class="field"><label>الاسم <span class="muted">(مطلوب)</span></label><input name="displayName" placeholder="مثال: جدتي" required maxlength="80" /></div>
        <div class="field"><label>صلة القرابة <span class="muted">(مطلوب)</span></label><select name="relationship">${Object.entries(REL).map(([k, v]) => `<option value="${k}" ${k === 'mother' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>أيام الاطمئنان</label><div class="chips" id="days"></div></div>
        <div class="field"><label>الأوقات</label><div id="times"></div><span class="hint">بتوقيت ${esc(tz())}</span></div>
        <details style="margin-bottom:12px"><summary class="muted">حقول اختيارية</summary>
          <div class="field" style="margin-top:10px"><label>رقم هاتفه</label><input name="phone" dir="ltr" inputmode="tel" placeholder="+2010xxxxxxxx" /></div>
          <div class="field"><label>ملاحظات</label><textarea name="notes" rows="2" maxlength="500"></textarea></div>
          <div class="field"><label>جهة موثوقة (تُدعى ولا يصلها شيء قبل قبولها)</label>
            <div class="row"><input name="tcName" placeholder="الاسم" /><input name="tcPhone" dir="ltr" inputmode="tel" placeholder="+9665xxxxxxxx" /></div></div>
        </details>
        <button class="btn heart block" type="submit">❤️ إضافة</button>
        <button class="btn ghost block" type="button" data-nav="home" style="margin-top:8px">إلغاء</button>
      </form>`, 'family');
    paint();
    bindActions($app);
    $app.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { days = new Set(b.dataset.preset.split(',').map(Number)); paint(); }));
    const f = document.getElementById('f');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        if (!days.size) throw new Error('اختر يومًا واحدًا على الأقل.');
        const body = {
          displayName: fd.get('displayName'), relationship: fd.get('relationship'),
          schedule: { weekdays: [...days], times: [...new Set(times)], timezone: tz() },
          phone: String(fd.get('phone') || '').replace(/[\s()-]/g, '') || null,
          notes: String(fd.get('notes') || '') || null,
        };
        if (fd.get('tcName') && fd.get('tcPhone')) body.trustedContact = { fullName: fd.get('tcName'), phone: String(fd.get('tcPhone')).replace(/[\s()-]/g, '') };
        const r = await api('POST', '/persons', body);
        toast(r.confirmationMessage);
        navigate('person', { id: r.person.id });
      } catch (err) { toast(err.message + (err.details?.[0] ? ` (${err.details[0].message})` : ''), true); btn.disabled = false; }
    });
  }

  // ─── صفحة الشخص ───
  async function renderPerson(id) {
    const d = await api('GET', `/persons/${id}`);
    const p = d.person;
    const color = STATUS_COLOR[p.status] || STATUS_COLOR.upcoming;
    const sched = p.schedule ? `${p.schedule.weekdays.map((w) => WEEKDAYS[w]).join('، ')} · ${p.schedule.times.join(' / ')}` : '—';
    const canAct = !['paused', 'deceased_reported'].includes(p.status);
    shell(p.displayName, REL[p.relationship] || p.relationship, `
      <button class="back" data-nav="home">→</button>
      <div class="card">
        <div class="person"><div class="avatar" style="--st:${color}">${esc(p.displayName.charAt(0))}</div>
          <div class="info"><div class="name">${esc(p.displayName)}</div><div class="meta">${esc(d.messages.statusHint)}</div></div>
          <span class="badge" style="--st:${color}">${esc(STATUS_LABEL[p.status])}</span></div>
        ${canAct ? `<div class="actions">
          <button class="btn heart" data-act="check_in" data-id="${p.id}" data-entry="">${esc(d.messages.reassured)}</button>
          <button class="btn" data-act="attempt" data-id="${p.id}" data-entry="">${esc(d.messages.calledNoAnswer)}</button>
          <button class="btn ghost" data-act="snooze" data-id="${p.id}" data-entry="">${esc(d.messages.snooze)}</button>
          ${p.phone ? `<a class="btn" href="tel:${esc(p.phone)}">${esc(d.messages.callNow)}</a>` : ''}
        </div>` : ''}
      </div>
      <div class="card"><h3>جدول الاطمئنان</h3><p>${esc(sched)}</p>
        <p class="muted small">آخر اطمئنان: ${p.lastCheckInAt ? esc(new Date(p.lastCheckInAt).toLocaleString('ar-EG-u-nu-latn')) : 'لم يُسجَّل بعد'}</p>
        <div class="actions">
          ${p.status === 'paused' ? `<button class="btn" id="resume">استئناف الجدول</button>` : `<button class="btn" id="pause">إيقاف مؤقت / سفر ✈️</button>`}
          <button class="btn ghost" id="webLink">رابط "أنا بخير"</button>
          <button class="btn ghost" id="remove">إيقاف المتابعة</button>
        </div></div>
      <div class="card"><h3>أسبوع وصال</h3>
        ${d.week.map((day) => day.entries.length ? `<div class="entry"><span>${esc(WEEKDAYS[day.weekday])} <span class="muted small">${esc(day.date)}</span></span><span>${day.entries.map((en) => `<span class="badge" style="--st:${STATUS_COLOR[en.person.status] || STATUS_COLOR.upcoming}">${esc(en.localTime)} · ${esc(ENTRY_STATUS[en.status] || en.status)}</span>`).join(' ')}</span></div>` : '').join('') || '<p class="muted">لا مواعيد هذا الأسبوع.</p>'}
      </div>
      <div class="card"><h3>الجهات الموثوقة</h3>
        ${p.trustedContacts.length ? p.trustedContacts.map((c) => `<div class="entry"><span>${esc(c.fullName)} <bdi class="muted small">${esc(c.phoneMasked)}</bdi></span><button class="btn sm ghost" data-rmc="${c.id}">إزالة</button></div>`).join('') : ''}
        ${(p.pendingInvitations || []).filter((i) => i.status === 'invited').map((i) => `<div class="entry"><span>${esc(i.fullName)} <span class="muted small">بانتظار القبول</span></span><button class="btn sm ghost" data-rmi="${i.id}">إلغاء الدعوة</button></div>`).join('')}
        ${!p.trustedContacts.length && !(p.pendingInvitations || []).some((i) => i.status === 'invited') ? `<p class="muted small">لا توجد جهات موثوقة. وهذا اختيار صحيح تمامًا — المتابعة اليدوية تكفي.</p>` : ''}
        <form id="inv" class="row" style="margin-top:8px"><input name="fullName" placeholder="الاسم" required /><input name="phone" dir="ltr" placeholder="+9665xxxxxxxx" required /><button class="btn sm" style="flex:0 0 auto">دعوة</button></form>
        <p class="muted small" style="margin:8px 0 0">لا يصلها أي تنبيه قبل قبول الدعوة، ويمكنها الانسحاب في أي وقت.</p>
      </div>
      <div class="card"><h3>سجل الوصال</h3>
        ${d.recentLogs.length ? d.recentLogs.map((l) => `<div class="entry"><span>${esc(l.day)} · ${esc(l.time)}</span><span class="muted small">${esc(l.methodLabel)} · ${esc(l.statusLabel)}</span></div>`).join('') : '<p class="muted small">لا توجد سجلات بعد. أول اطمئنان سيظهر هنا ❤️</p>'}
      </div>`, 'family');
    bindActions($app);
    document.getElementById('pause')?.addEventListener('click', async () => {
      const daysStr = prompt('إيقاف لكم يومًا؟ (اتركه فارغًا للإيقاف المفتوح)', '7');
      if (daysStr === null) return;
      const until = daysStr ? new Date(Date.now() + Number(daysStr) * 86400000).toISOString() : null;
      try { const r = await api('POST', `/persons/${id}/pause`, { until, reason: 'travel' }); toast(r.message); render(); } catch (e) { toast(e.message, true); }
    });
    document.getElementById('resume')?.addEventListener('click', async () => { try { const r = await api('POST', `/persons/${id}/resume`, {}); toast(r.message); render(); } catch (e) { toast(e.message, true); } });
    document.getElementById('remove')?.addEventListener('click', async () => {
      if (!confirm(`إيقاف متابعة ${p.displayName}؟ يمكنك إعادته في أي وقت.`)) return;
      try { const r = await api('DELETE', `/persons/${id}`); toast(r.message); navigate('home'); } catch (e) { toast(e.message, true); }
    });
    document.getElementById('webLink')?.addEventListener('click', async () => {
      try { const r = await api('POST', `/persons/${id}/web-check-in-link`, {}); const abs = new URL(r.url, location.origin); prompt('أرسل هذا الرابط له — يضغط "أنا بخير" بدون تثبيت أي تطبيق:', abs.pathname ? location.origin + abs.pathname : r.url); } catch (e) { toast(e.message, true); }
    });
    document.getElementById('inv')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { const r = await api('POST', `/persons/${id}/trusted-contacts/invite`, { fullName: fd.get('fullName'), phone: String(fd.get('phone')).replace(/[\s()-]/g, '') }); toast(r.message); prompt('رابط الدعوة (في التطوير يُطبع في سجل الخادم أيضًا):', location.origin + new URL(r.acceptUrl, location.origin).pathname); render(); } catch (err) { toast(err.message, true); }
    });
    $app.querySelectorAll('[data-rmi]').forEach((b) => b.addEventListener('click', async () => { try { await api('DELETE', `/invitations/${b.dataset.rmi}`); toast('تم إلغاء الدعوة'); render(); } catch (e) { toast(e.message, true); } }));
    $app.querySelectorAll('[data-rmc]').forEach((b) => b.addEventListener('click', async () => { try { await api('DELETE', `/trusted-contacts/${b.dataset.rmc}`); toast('تمت الإزالة'); render(); } catch (e) { toast(e.message, true); } }));
  }

  // ─── الأسبوع ───
  async function renderWeek(start) {
    const w = await api('GET', `/week${start ? `?start=${start}` : ''}`);
    const sel = state.params.day || w.days.find((d) => d.isToday)?.date || w.days[0].date;
    const day = w.days.find((d) => d.date === sel) || w.days[0];
    const shift = (n) => { const d = new Date(w.weekStart + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    shell('أسبوع وصال', `${w.weekStart} → ${w.weekEnd}`, `
      <div class="row" style="margin-bottom:10px"><button class="btn sm" id="prev">الأسبوع السابق</button><button class="btn sm" id="next">الأسبوع التالي</button></div>
      <div class="week">${w.days.map((d) => `<div class="day ${d.isToday ? 'today' : ''} ${d.date === day.date ? 'on' : ''}" data-day="${d.date}" style="${d.date === day.date ? 'background:var(--muted)' : ''}"><div>${WEEKDAYS[d.weekday].slice(0, 3)}</div><div class="muted">${d.date.slice(8)}</div><div class="dots">${d.entries.slice(0, 4).map((e) => `<i style="background:${STATUS_COLOR[e.person.status] || STATUS_COLOR.upcoming}"></i>`).join('')}</div></div>`).join('')}</div>
      <div class="card"><h3>${WEEKDAYS[day.weekday]} <span class="muted small">${day.date}</span></h3>
        ${day.entries.length ? day.entries.map((e) => `<div class="entry" data-open="${e.person.id}" style="cursor:pointer"><span><b>${esc(e.person.displayName)}</b> <span class="muted small">${esc(REL[e.person.relationship] || '')}</span></span><span class="badge" style="--st:${STATUS_COLOR[e.person.status] || STATUS_COLOR.upcoming}">${esc(e.localTime)} · ${esc(ENTRY_STATUS[e.status] || e.status)}</span></div>`).join('') : '<p class="muted">لا مواعيد في هذا اليوم.</p>'}
      </div>
      <p class="muted small center">سيُنشأ الأسبوع التالي تلقائيًا بنفس الجدول.</p>`, 'week');
    bindActions($app);
    $app.querySelectorAll('[data-day]').forEach((el) => el.addEventListener('click', () => { state.params.day = el.dataset.day; renderWeek(w.weekStart); }));
    document.getElementById('prev').addEventListener('click', () => { state.params.day = null; renderWeek(shift(-7)); });
    document.getElementById('next').addEventListener('click', () => { state.params.day = null; renderWeek(shift(7)); });
  }

  // ─── السجل ───
  async function renderLogs() {
    const r = await api('GET', '/logs?pageSize=60');
    shell('سجل الوصال', r.summary.message, r.items.length ? `<div class="card"><table class="logs"><thead><tr><th>اليوم</th><th>الوقت</th><th>الشخص</th><th>الطريقة</th><th>الحالة</th></tr></thead><tbody>
      ${r.items.map((l) => `<tr><td>${esc(l.day)}</td><td>${esc(l.time)}</td><td>${esc(l.personName)}</td><td>${esc(l.methodLabel)}</td><td>${esc(l.statusLabel)}${l.syncedOffline ? ' <span class="muted small">(زُومن)</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="card empty"><div class="big">📖</div><p class="muted">لا توجد سجلات بعد. أول اطمئنان سيظهر هنا ❤️</p></div>`, 'logs');
    bindActions($app);
  }

  // ─── الإشعارات ───
  async function renderNotifications() {
    const r = await api('GET', '/notifications?pageSize=50');
    shell('الإشعارات', `${r.total} إشعار`, `<button class="back" data-nav="home">→</button>
      ${r.items.length ? r.items.map((n) => `<div class="card" ${n.personId ? `data-open="${n.personId}" style="cursor:pointer"` : ''}><b>${esc(n.title)}</b><p style="margin:4px 0">${esc(n.body)}</p><span class="muted small">${esc(new Date(n.createdAt).toLocaleString('ar-EG-u-nu-latn'))} · ${esc(n.status)}</span></div>`).join('') : `<div class="card empty"><div class="big">🔔</div><p class="muted">لا إشعارات بعد.</p></div>`}`, 'home');
    bindActions($app);
    if (r.items.length) api('POST', '/notifications/read', { all: true }).catch(() => {});
  }

  // ─── الإعدادات ───
  function renderSettings() {
    const u = store.user || {};
    const theme = localStorage.getItem('wesal.theme') || u.theme || 'system';
    const scale = Number(localStorage.getItem('wesal.scale') || 1);
    shell('الإعدادات', u.phone ? `الحساب: ${u.phone}` : '', `
      <div class="card">
        <div class="settings-row"><span>الوضع الداكن</span><select id="theme" style="width:auto"><option value="system" ${theme === 'system' ? 'selected' : ''}>تلقائي</option><option value="light" ${theme === 'light' ? 'selected' : ''}>فاتح</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>داكن</option></select></div>
        <div class="settings-row"><span>حجم الخط</span><select id="scale" style="width:auto"><option value="1" ${scale === 1 ? 'selected' : ''}>عادي</option><option value="1.15" ${scale === 1.15 ? 'selected' : ''}>كبير</option><option value="1.3" ${scale === 1.3 ? 'selected' : ''}>أكبر</option><option value="1.5" ${scale === 1.5 ? 'selected' : ''}>كبار السن</option></select></div>
        <div class="settings-row"><span>اسمك</span><input id="name" value="${esc(u.displayName || '')}" style="width:50%" placeholder="اختياري" /></div>
      </div>
      <div class="card"><h3>من يراني؟ ومن يصله تنبيه؟</h3><p class="muted small">أنت تتحكم تمامًا. اختر ما يُشارك، وأوقف أي مشاركة بضغطة واحدة. وصال ليس تطبيق مراقبة: لا قراءة رسائل، لا تسجيل مكالمات، لا تتبع موقع، لا مراقبة سرية. عدم الرد يعني فقط: لم يتم التحقق.</p></div>
      <div class="card"><h3>عند وجود قلق حقيقي</h3><p class="muted small">وصال لا يحل محل خدمات الطوارئ. إن كان لديك قلق حقيقي على سلامة شخص، اتصل فورًا بخدمات الطوارئ المحلية أو بأقرب شخص يستطيع الوصول إليه.</p></div>
      <div class="card"><a class="btn block" href="/docs" target="_blank" style="display:block;text-align:center;text-decoration:none">توثيق الـ API (Swagger)</a>
        <button class="btn ghost block" id="logout" style="margin-top:8px">تسجيل الخروج</button>
        <button class="btn ghost block" id="del" style="margin-top:8px;color:var(--heart)">حذف الحساب والبيانات</button></div>`, 'settings');
    bindActions($app);
    document.getElementById('theme').addEventListener('change', (e) => { localStorage.setItem('wesal.theme', e.target.value); applyPrefs(); api('PATCH', '/auth/me', { theme: e.target.value }).catch(() => {}); });
    document.getElementById('scale').addEventListener('change', (e) => { localStorage.setItem('wesal.scale', e.target.value); applyPrefs(); });
    document.getElementById('name').addEventListener('change', async (e) => { try { store.user = await api('PATCH', '/auth/me', { displayName: e.target.value || null }); toast('تم الحفظ ❤️'); } catch (err) { toast(err.message, true); } });
    document.getElementById('logout').addEventListener('click', async () => { try { await api('POST', '/auth/logout', { refreshToken: store.tokens.refreshToken }); } catch { /* ignore */ } logout(); });
    document.getElementById('del').addEventListener('click', async () => { if (!confirm('سيُحذف حسابك وكل بياناتك نهائيًا. لا يمكن التراجع. متابعة؟')) return; try { await api('DELETE', '/auth/me'); logout(); } catch (e) { toast(e.message, true); } });
  }
  function applyPrefs() {
    const theme = localStorage.getItem('wesal.theme') || 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--scale', localStorage.getItem('wesal.scale') || '1');
  }

  // ─── صفحات عامة: الدعوة ───
  async function renderInvite() {
    const token = state.params.token;
    $app.innerHTML = `<main class="public"><div class="ring"></div></main>`;
    try {
      const inv = await api('GET', `/public/invites/${encodeURIComponent(token)}`, undefined, { noAuth: true });
      const done = (msg, icon) => { $app.innerHTML = `<main class="public"><div class="big">${icon}</div><h2>${esc(msg)}</h2><p class="muted">${esc(inv.withdrawAnytime)}</p></main>`; };
      if (inv.status === 'accepted') return done(inv.messages.thanks, '❤️');
      if (inv.status === 'expired') return done(inv.messages.expired, '⌛');
      if (inv.status !== 'invited') return done(inv.messages.withdrawn, '🌿');
      $app.innerHTML = `<main class="public" style="text-align:start">
        <div class="center"><div class="big">❤️</div><h2>${esc(inv.messages.title)}</h2><p>${esc(inv.messages.body)}</p></div>
        <div class="card"><b>ما الذي سيُشارك معك:</b><ul class="clean">${inv.whatIsShared.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          <b>ما الذي لن يُشارك أبدًا:</b><ul class="clean">${inv.whatIsNotShared.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          <p class="muted small">${esc(inv.withdrawAnytime)}</p></div>
        <button class="btn heart block" id="acc">${esc(inv.messages.accept)}</button>
        <button class="btn ghost block" id="dec" style="margin-top:8px">${esc(inv.messages.decline)}</button>
      </main>`;
      document.getElementById('acc').addEventListener('click', async () => { try { const r = await api('POST', `/public/invites/${encodeURIComponent(token)}/accept`, {}, { noAuth: true }); done(r.message, '❤️'); } catch (e) { toast(e.message, true); } });
      document.getElementById('dec').addEventListener('click', async () => { try { const r = await api('POST', `/public/invites/${encodeURIComponent(token)}/decline`, {}, { noAuth: true }); done(r.message, '🌿'); } catch (e) { toast(e.message, true); } });
    } catch (e) {
      $app.innerHTML = `<main class="public"><div class="big">🌿</div><h2>${esc(e.message)}</h2></main>`;
    }
  }

  // ─── صفحة عامة: أنا بخير ───
  async function renderFine() {
    const token = state.params.token;
    $app.innerHTML = `<main class="public"><div class="ring"></div></main>`;
    try {
      const f = await api('GET', `/public/fine/${encodeURIComponent(token)}`, undefined, { noAuth: true });
      const big = 'font-size:1.6rem;padding:26px';
      $app.innerHTML = `<main class="public"><div class="big">❤️</div><h1 style="font-size:2rem">السلام عليكم ❤️</h1><h2>${esc(f.title)}</h2><p style="font-size:1.2rem">${esc(f.body)}</p>
        ${f.expired ? '' : `<button class="btn heart block" id="ok" style="${big}">${esc(f.button)}</button>`}</main>`;
      document.getElementById('ok')?.addEventListener('click', async () => {
        try { const r = await api('POST', `/public/fine/${encodeURIComponent(token)}`, {}, { noAuth: true }); $app.innerHTML = `<main class="public"><div class="big">❤️</div><h1>${esc(r.message)}</h1></main>`; } catch (e) { toast(e.message, true); }
      });
    } catch (e) {
      $app.innerHTML = `<main class="public"><div class="big">🌿</div><h2>${esc(e.message)}</h2></main>`;
    }
  }

  applyPrefs();
  routeFromLocation(false);
  history.replaceState({ view: state.view, params: state.params }, '', location.pathname);
})();
