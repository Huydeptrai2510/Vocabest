'use strict';
// ===== CẤU HÌNH — chỉ dùng anon key (public). KHÔNG đặt service_role key ở đây. =====
const SUPABASE_URL = 'https://iocrhyizajbxnytdidsv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__LFJQmvkmdZvxo_ILJY2uw_sz5pTOpr';
// Miền định danh nội bộ, người dùng không bao giờ thấy. Phải khớp handle_new_user() trong database.sql.
const INTERNAL_EMAIL_DOMAIN = 'users.vocabest.invalid';

const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.startsWith('YOUR-');
const sb = configured && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
const $ = (s) => document.querySelector(s);
const state = { user: null, username: '', status: 'active', role: 'user', perms: [] };
const ROLE_LABEL = { boss: 'Boss', admin: 'Admin', user: 'Người dùng' };
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const normalize = (v) => String(v || '').trim().toLowerCase();

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
function say(el, text, ok) { el.textContent = text; el.classList.toggle('ok', !!ok); }
function busy(form, on) { form.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = on; }); }

function authError(err) {
  const code = err && err.code, msg = (err && err.message) || '';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'Tên đăng nhập này đã được dùng. Hãy chọn tên khác.';
  if (code === 'invalid_credentials' || /invalid login/i.test(msg)) return 'Sai tên đăng nhập hoặc mật khẩu.';
  if (code === 'weak_password') return 'Mật khẩu quá yếu. Hãy dùng mật khẩu dài và khó đoán hơn.';
  if (code === 'email_address_invalid') return 'Supabase từ chối định danh nội bộ. Xem mục "Giới hạn kỹ thuật" trong README.';
  if (code === 'email_not_confirmed') return 'Dự án Supabase đang bật xác minh email. Hãy tắt "Confirm email" (xem README).';
  if (/rate limit|over_.*_rate/i.test(code + msg)) return 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.';
  if (/Database error/i.test(msg)) return 'Không tạo được hồ sơ. Hãy kiểm tra database.sql đã chạy chưa.';
  if (/fetch|network/i.test(msg)) return 'Không kết nối được máy chủ. Kiểm tra mạng và cấu hình Supabase.';
  return 'Có lỗi xảy ra. Vui lòng thử lại.';
}

// ===== Giao diện: icon, nút, ô chọn tự vẽ, ô thống kê =====
const IC = {
  play: '<polygon points="6 4 20 12 6 20 6 4"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12l5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.8M6.5 7.6A17 17 0 002 12s4 7 10 7a9.7 9.7 0 004.1-.9"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  login: '<path d="M14 4h5v16h-5M10 8l4 4-4 4M14 12H3"/>', logout: '<path d="M10 4H5v16h5M16 8l4 4-4 4M20 12H9"/>', userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0M19 8v6M16 11h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0M16 4.5a3.5 3.5 0 010 7M22 20a6 6 0 00-4-5.6"/>', save: '<path d="M5 3h12l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  flag: '<path d="M5 21V4M5 4h13l-2 4 2 4H5"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', chevron: '<path d="M6 9l6 6 6-6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const ICON_FOR = [[/^Xóa/, 'trash'], [/^Sửa/, 'edit'], [/^Mở khóa/, 'unlock'], [/^Khóa/, 'lock'], [/^Ẩn/, 'eyeoff'], [/^Mở lại|^Học lại/, 'refresh'], [/^Quản lý từ/, 'list'],
  [/chi tiết|^Xem thư viện|^Xem trước|^Xem đáp án/i, 'eye'], [/^Học|^Bắt đầu/, 'play'], [/Admin/, 'shield'], [/^Chấp nhận|^Kiểm tra|^Đã nhớ|^Xác nhận/, 'check'],
  [/^Từ chối|^Đóng|^Chưa nhớ|^Hủy/, 'x'], [/^Đánh dấu|^Gửi báo cáo/, 'flag'], [/^Câu tiếp|^Xem kết quả/, 'arrow'], [/^Kết thúc/, 'stop'], [/^Xem tiến độ/, 'chart'],
  [/^Đăng xuất/, 'logout'], [/^Đăng nhập/, 'login'], [/^Đăng ký|^Tạo tài khoản/, 'userplus'], [/^Lưu/, 'save'], [/^Nhập/, 'upload'], [/^Tạo|^Thêm/, 'plus'], [/^Vào bảng/, 'grid']];
function decorate(node, name) {
  if (node.querySelector('svg')) return;
  const label = node.textContent.trim(), ic = name || node.dataset.icon || (ICON_FOR.find(([re]) => re.test(label)) || [])[1];
  if (!ic || !IC[ic] || !label) return;
  node.textContent = ''; node.insertAdjacentHTML('afterbegin', icon(ic));
  const sp = document.createElement('span'); sp.textContent = label; node.append(sp);
  if (node.tagName === 'A') { node.title = label; node.setAttribute('aria-label', label); }
}
function setBtn(node, text) { node.textContent = text; decorate(node); }
function addMeta(m, ...items) { m.append(...items.map((x) => (typeof x === 'string' ? el('span', x) : x))); }
function dbHint(err) {
  if (!err) return '';
  const c = err.code || '', m = err.message || '', tech = ` (mã ${c || '?'}: ${m})`;
  if (c === '23514' || /check constraint/i.test(m)) return 'Database chưa được cập nhật (ràng buộc chiều học). Hãy chạy lại toàn bộ database.sql trong Supabase.' + tech;
  if (c === 'PGRST205' || c === '42P01' || /find the table|does not exist/i.test(m)) return 'Database chưa có bảng học tập. Hãy chạy toàn bộ database.sql trong Supabase.' + tech;
  if (c === 'PGRST204' || c === '42703' || /column/i.test(m)) return 'Database thiếu cột mới. Hãy chạy lại toàn bộ database.sql trong Supabase.' + tech;
  if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'Bị chặn bởi quyền truy cập: tài khoản đang bị khóa, thư viện chưa đủ 8 mục, hoặc database chưa cập nhật.' + tech;
  return 'Lỗi từ máy chủ.' + tech;
}
function tile(box, label, value, ic, tone) {
  const t = el('div', null, 'tile' + (tone ? ' ' + tone : '')), i = el('span', null, 'tile-ic');
  i.innerHTML = icon(ic || 'chart'); t.append(i, el('b', String(value)), el('small', label)); box.append(t);
}
function ringEl(pct) {
  const c = 2 * Math.PI * 52, d = el('div', null, 'ringbox'), p = pct == null ? 0 : pct, t = pct == null ? '—' : pct + '%';
  d.innerHTML = `<svg class="ringsvg" viewBox="0 0 120 120" role="img" aria-label="Chính xác ${t}"><circle class="rb" cx="60" cy="60" r="52"/><circle class="rf" cx="60" cy="60" r="52" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/><text class="rt" x="60" y="64" text-anchor="middle">${t}</text><text class="rs" x="60" y="80" text-anchor="middle">chính xác</text></svg>`;
  d.append(el('p', pct == null ? 'Chưa có câu nào được chấm điểm.' : pct >= 90 ? 'Xuất sắc!' : pct >= 70 ? 'Làm tốt lắm!' : pct >= 50 ? 'Khá ổn, ôn thêm nhé.' : 'Cần ôn lại nhiều hơn.', 'res-msg')); return d;
}
function enhanceSelect(sel) {
  if (sel._cs) return; sel._cs = true;
  const wrap = document.createElement('div'), b = document.createElement('button'), list = document.createElement('ul'), txt = document.createElement('span');
  wrap.className = 'cs'; b.type = 'button'; b.className = 'cs-btn'; txt.className = 'cs-txt'; list.className = 'cs-list'; list.hidden = true;
  b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); list.setAttribute('role', 'listbox');
  b.append(txt); b.insertAdjacentHTML('beforeend', icon('chevron'));
  sel.parentNode.insertBefore(wrap, sel); wrap.append(b, list, sel);
  sel.classList.add('cs-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  let hi = 0;
  const opts = () => [...sel.options], mark = () => [...list.children].forEach((li, i) => li.classList.toggle('hi', i === hi));
  const close = () => { list.hidden = true; b.setAttribute('aria-expanded', 'false'); };
  function sync() {
    list.replaceChildren();
    opts().forEach((o, i) => {
      const li = document.createElement('li'); li.className = 'cs-opt' + (o.disabled ? ' dis' : ''); li.textContent = o.text;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === sel.selectedIndex));
      li.addEventListener('click', (e) => { e.preventDefault(); if (!o.disabled) pick(i); }); list.append(li);
    });
    const cur = sel.options[sel.selectedIndex]; txt.textContent = cur ? cur.text : '—'; b.disabled = sel.disabled;
  }
  function pick(i) { sel.selectedIndex = i; close(); sync(); sel.dispatchEvent(new Event('change', { bubbles: true })); b.focus(); }
  function open() {
    if (b.disabled) return;
    document.querySelectorAll('.cs-list').forEach((l) => { if (l !== list) l.hidden = true; });
    const r = b.getBoundingClientRect(); wrap.classList.toggle('up', innerHeight - r.bottom < 260 && r.top > 260);
    list.hidden = false; b.setAttribute('aria-expanded', 'true'); hi = Math.max(0, sel.selectedIndex); mark();
    if (list.children[hi]) list.children[hi].scrollIntoView({ block: 'nearest' });
  }
  const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { configurable: true, get() { return d.get.call(sel); }, set(v) { d.set.call(sel, v); sync(); } });
  b.addEventListener('click', () => (list.hidden ? open() : close()));
  b.addEventListener('keydown', (e) => {
    const n = opts().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (list.hidden) return open();
      let i = hi; do { i += e.key === 'ArrowDown' ? 1 : -1; } while (i >= 0 && i < n && opts()[i].disabled);
      if (i >= 0 && i < n) { hi = i; mark(); list.children[i].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (list.hidden) open(); else pick(hi); }
    else if (e.key === 'Escape' || e.key === 'Tab') close();
  });
  b.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  if (sel.form) sel.form.addEventListener('reset', () => setTimeout(sync, 0));
  sync();
}

// ===== Định tuyến =====
const PROTECTED = ['dashboard', 'settings', 'library', 'admin', 'libraries', 'study', 'progress'], GUEST = ['login', 'register'];
function route() {
  let v = location.hash.replace(/^#\/?/, '') || 'home';
  if (!['home', ...PROTECTED, ...GUEST].includes(v)) v = 'home';
  if (PROTECTED.includes(v) && !state.user) { location.hash = '#/login'; return; }
  if (GUEST.includes(v) && state.user) { location.hash = '#/dashboard'; return; }
  if (G && !G.over && v !== 'study') finishGame();
  if (v === 'admin' && !isStaff()) { location.hash = '#/dashboard'; return; }
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== v; });
  document.querySelectorAll('[data-auth]').forEach((a) => { a.hidden = (a.dataset.auth === 'in') !== !!state.user; });
  $('#config-warning').hidden = configured;
  $('#nav-admin').hidden = !(state.user && isStaff());
  document.querySelectorAll('nav a').forEach((a) => { if (a.getAttribute('href') === '#/' + v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v === 'dashboard') renderDashboard();
  if (v === 'library') renderLibrary();
  if (v === 'admin') renderAdmin();
  if (v === 'libraries') renderLibraries();
  if (v === 'study') renderStudy();
  if (v === 'progress') renderProgress();
  if (v === 'settings') { $('#set-name').textContent = state.username; $('#set-role').textContent = ROLE_LABEL[state.role] || ROLE_LABEL.user; }
}

async function loadProfile() {
  if (!sb || !state.user) { Object.assign(state, { user: null, username: '', status: 'active', role: 'user', perms: [] }); return; }
  const [p, r, a] = await Promise.all([
    sb.from('profiles').select('username,status').eq('id', state.user.id).single(),
    sb.from('user_roles').select('role').eq('user_id', state.user.id).single(),
    sb.from('admin_permissions').select('permission').eq('user_id', state.user.id)]);
  if (p.error || r.error) { toast('Không tải được hồ sơ. Hãy kiểm tra database.sql.'); return; }
  state.username = p.data.username; state.status = p.data.status; state.role = r.data.role;
  state.perms = (a.data || []).map((x) => x.permission);
}

// ===== Đăng ký / đăng nhập / đăng xuất =====
async function onRegister(e) {
  e.preventDefault();
  const f = e.target, out = $('#register-msg'), u = normalize(f.username.value), p = f.password.value;
  if (!sb) return say(out, 'Chưa cấu hình Supabase (xem README).');
  if (!USERNAME_RE.test(u)) return say(out, 'Tên đăng nhập gồm 3–20 ký tự: chữ thường a–z, số hoặc dấu gạch dưới.');
  if (p.length < 8) return say(out, 'Mật khẩu cần tối thiểu 8 ký tự.');
  if (p !== f.confirm.value) return say(out, 'Hai mật khẩu chưa khớp.');
  busy(f, true); say(out, 'Đang tạo tài khoản…', true);
  const { data, error } = await sb.auth.signUp({ email: `${u}@${INTERNAL_EMAIL_DOMAIN}`, password: p });
  busy(f, false);
  if (error) return say(out, authError(error));
  if (!data.session) return say(out, 'Tài khoản chưa được kích hoạt ngay. Hãy tắt "Confirm email" trong Supabase Auth (xem README).');
  f.reset(); say(out, ''); toast('Đăng ký thành công.');
}
async function onLogin(e) {
  e.preventDefault();
  const f = e.target, out = $('#login-msg'), u = normalize(f.username.value);
  if (!sb) return say(out, 'Chưa cấu hình Supabase (xem README).');
  if (!USERNAME_RE.test(u) || !f.password.value) return say(out, 'Sai tên đăng nhập hoặc mật khẩu.');
  busy(f, true); say(out, 'Đang đăng nhập…', true);
  const { error } = await sb.auth.signInWithPassword({ email: `${u}@${INTERNAL_EMAIL_DOMAIN}`, password: f.password.value });
  busy(f, false);
  if (error) return say(out, authError(error));
  f.reset(); say(out, '');
}
async function onLogout() { await sb.auth.signOut(); location.hash = '#/'; toast('Đã đăng xuất.'); }
async function onPassword(e) {
  e.preventDefault();
  const f = e.target, out = $('#pw-msg'), p = f.password.value;
  if (p.length < 8) return say(out, 'Mật khẩu cần tối thiểu 8 ký tự.');
  if (p !== f.confirm.value) return say(out, 'Hai mật khẩu chưa khớp.');
  busy(f, true);
  const { error } = await sb.auth.updateUser({ password: p });
  busy(f, false);
  if (error) return say(out, authError(error));
  f.reset(); say(out, ''); toast('Đã đổi mật khẩu.');
}

// ===== Bảng điều khiển: thư viện cá nhân =====
async function renderDashboard() {
  $('#dash-name').textContent = state.username;
  $('#locked-note').hidden = state.status !== 'locked';
  $('#lib-form').querySelectorAll('input,textarea,select,button').forEach((c) => { c.disabled = state.status === 'locked'; });
  await fillTags($('#tag-select'));
  await loadLibraries();
}
let libSeq = 0;
async function loadLibraries() {
  const list = $('#lib-list'), load = $('#lib-loading'), empty = $('#lib-empty');
  const my = ++libSeq; load.hidden = false; empty.hidden = true;
  const { data, error } = await sb.from('libraries')
    .select('id,title,description,visibility,tag:tags(name,color)')
    .eq('owner_id', state.user.id).eq('source', 'personal').order('created_at', { ascending: false });
  if (my !== libSeq) return;
  load.hidden = true;
  if (error) { toast('Không tải được thư viện.'); return; }
  empty.hidden = data.length > 0; list.replaceChildren();
  data.forEach((l) => {
    const card = document.createElement('article'); card.className = 'lib';
    const h = document.createElement('h4'); h.textContent = l.title;
    const d = document.createElement('p'); d.textContent = l.description || 'Chưa có mô tả.';
    const meta = document.createElement('div'); meta.className = 'meta';
    addMeta(meta, l.visibility === 'public' ? 'Công khai' : 'Riêng tư');
    if (l.tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = l.tag.name; t.style.background = l.tag.color; addMeta(meta, t); }
    const del = document.createElement('button'); del.className = 'del'; del.type = 'button'; del.textContent = 'Xóa thư viện';
    del.disabled = state.status === 'locked';
    del.addEventListener('click', async () => {
      if (!(await askConfirm(`Xóa thư viện "${l.title}"? Thao tác này không thể hoàn tác.`))) return;
      const r = await sb.from('libraries').delete().eq('id', l.id);
      if (r.error) return toast('Không xóa được thư viện.');
      toast('Đã xóa thư viện.'); loadLibraries();
    });
    const open = btn('Quản lý từ', () => openLibrary(l.id, l.title));
    card.append(h, d, meta, open, del); list.append(card);
  });
}
async function onCreateLibrary(e) {
  e.preventDefault();
  const f = e.target, out = $('#lib-msg'), title = f.title.value.trim();
  if (!title) return say(out, 'Hãy nhập tên thư viện.');
  busy(f, true);
  const { error } = await sb.from('libraries').insert({
    owner_id: state.user.id, source: 'personal', title, description: f.description.value.trim(),
    visibility: 'private', tag_id: f.tag_id.value || null });
  busy(f, false);
  if (error) return say(out, 'Không tạo được thư viện. Tài khoản có thể đang bị khóa.');
  f.reset(); say(out, ''); toast('Đã tạo thư viện.'); loadLibraries();
}

// ===== Thư viện & từ vựng (định dạng A : B) =====
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const btn = (text, fn, cls = 'btn small ghost') => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); if (/\b(btn|del)\b/.test(cls)) decorate(b); return b; };
const clean = (v) => String(v || '').trim().replace(/\s+/g, ' ');
const variants = (v) => {
  const seen = new Set(), out = [];
  String(v || '').split('|').forEach((x) => { const c = clean(x); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); } });
  return out.length ? out : (clean(v) ? [clean(v)] : []);
};
const normItem = (v) => variants(v).join(' | '), showV = (v) => variants(v).join(' / ');
const variantsOk = (v) => v.split(' | ').every((x) => /[\p{L}\p{N}]/u.test(x));
const keyOf = (a, b) => (normItem(a) + '\u0001' + normItem(b)).toLowerCase();
const MIN_ITEMS = 8, SRC_LABEL = { personal: 'Cá nhân', system: 'Hệ thống', community: 'Cộng đồng' };
let current = null, curLib = null, curItems = [], tagCache = null, previewRows = [], studyFrom = null;
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const hasText = (v) => /[\p{L}\p{N}]/u.test(v);
function resetTags() { tagCache = null; ['#browse-tag', '#edit-tag', '#tag-select'].forEach((q) => { $(q).length = 1; }); }
async function fillTags(sel) {
  if (!tagCache) { const { data } = await sb.from('tags').select('id,name').order('name'); tagCache = data || []; }
  if (sel.options.length <= 1) tagCache.forEach((t) => sel.append(new Option(t.name, t.id)));
}
function tagChip(t) { const c = el('span', t.name, 'tag'); c.style.background = t.color; return c; }
function openLibrary(id, title) { current = { id, title }; location.hash = '#/library'; }

function parseLines(text, existing) {
  const seen = new Set(existing), rows = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const parts = raw.split(':'), row = { n: i + 1, raw };
    if (parts.length !== 2) row.err = parts.length < 2 ? 'Thiếu dấu ":" phân cách.' : 'Mỗi dòng chỉ được có đúng một dấu ":".';
    else {
      const a = normItem(parts[0]), b = normItem(parts[1]);
      if (!a || !b) row.err = 'Thiếu vế A hoặc vế B.';
      else if (!variantsOk(a) || !variantsOk(b)) row.err = 'Nội dung không hợp lệ: mỗi đáp án cần có chữ hoặc số.';
      else if (a.length > 300 || b.length > 300) row.err = 'Mỗi vế tối đa 300 ký tự (tính cả các đáp án đồng nghĩa).';
      else if (seen.has(keyOf(a, b))) row.err = 'Trùng với mục đã có.';
      else { seen.add(keyOf(a, b)); row.a = a; row.b = b; }
    }
    rows.push(row);
  });
  return rows;
}
async function renderLibrary() {
  if (!current) { location.hash = '#/dashboard'; return; }
  const [lr, ir] = await Promise.all([
    sb.from('libraries').select('id,title,description,visibility,source,owner_id,tag_id,moderation,tag:tags(name,color)').eq('id', current.id).single(),
    sb.from('library_items').select('id,term,meaning').eq('library_id', current.id).order('position').order('created_at')]);
  if (lr.error || ir.error) { toast('Không tải được thư viện.'); location.hash = '#/libraries'; return; }
  curLib = lr.data; curItems = ir.data; current.title = curLib.title;
  const mine = curLib.owner_id === state.user.id && curLib.source !== 'system';
  const editable = (mine && curLib.moderation !== 'locked') || (curLib.source === 'system' && state.role === 'boss');
  const n = curItems.length, ready = n >= MIN_ITEMS;
  $('#lib-title').textContent = curLib.title; $('#lib-desc').textContent = curLib.description || '';
  $('#lib-stats').textContent = `${n} mục, ${SRC_LABEL[curLib.source]}, ${curLib.visibility === 'public' ? 'công khai' : 'riêng tư'}` + (mine && MOD_NOTE[curLib.moderation] ? '. ' + MOD_NOTE[curLib.moderation] : '');
  const tg = $('#lib-tag'); tg.hidden = !curLib.tag;
  if (curLib.tag) { tg.textContent = curLib.tag.name; tg.style.background = curLib.tag.color; }
  $('#lib-study').disabled = !ready;
  $('#lib-study-note').textContent = ready ? '' : `Bản nháp: cần tối thiểu ${MIN_ITEMS} mục để học hoặc công khai (còn thiếu ${MIN_ITEMS - n}).`;
  $('#lib-edit').hidden = !editable; $('#lib-import-box').hidden = !editable;
  if (editable) {
    const f = $('#lib-edit').elements; await fillTags($('#edit-tag'));
    f.title.value = curLib.title; f.description.value = curLib.description || ''; f.visibility.value = curLib.visibility; f.tag_id.value = curLib.tag_id || '';
  }
  const list = $('#item-list'); list.replaceChildren(); $('#item-empty').hidden = n > 0;
  curItems.forEach((it) => {
    const c = el('article', null, 'lib'); c.append(el('h4', showV(it.term)), el('p', showV(it.meaning)));
    if (editable) c.append(btn('Xóa mục', async () => {
      const r = await sb.from('library_items').delete().eq('id', it.id);
      if (r.error) return toast('Không xóa được mục.');
      renderLibrary();
    }, 'del'));
    list.append(c);
  });
  renderSocial(); renderMod();
}
async function onSaveLibrary(e) {
  e.preventDefault();
  const f = e.target, x = f.elements, out = $('#edit-msg'), title = clean(x.title.value);
  if (!title) return say(out, 'Hãy nhập tên thư viện.');
  busy(f, true);
  const { error } = await sb.from('libraries').update({ title, description: x.description.value.trim(), visibility: x.visibility.value, tag_id: x.tag_id.value || null }).eq('id', curLib.id);
  busy(f, false);
  if (error) return say(out, /8 mục/.test(error.message) ? `Cần tối thiểu ${MIN_ITEMS} mục từ để công khai thư viện.` : 'Không lưu được thay đổi.');
  say(out, ''); toast('Đã lưu thư viện.'); renderLibrary();
}
function onImportPreview() {
  const rows = parseLines($('#import-form').elements.text.value, curItems.map((i) => keyOf(i.term, i.meaning)));
  previewRows = rows.filter((r) => !r.err);
  const ul = $('#import-list'); ul.replaceChildren();
  rows.forEach((r) => ul.append(el('li', r.err ? `Dòng ${r.n}: ${r.err}` : `Dòng ${r.n}: ${r.a} : ${r.b}`, r.err ? 'bad' : 'good')));
  const bad = rows.length - previewRows.length;
  say($('#import-msg'), rows.length ? `${previewRows.length} dòng hợp lệ, ${bad} dòng lỗi sẽ bị bỏ qua. Sửa nội dung rồi xem trước lại nếu cần.` : 'Chưa có dòng nào để nhập.', previewRows.length > 0);
  $('#import-go').disabled = previewRows.length === 0;
}
async function onImportGo(e) {
  e.preventDefault();
  if (!previewRows.length) return;
  busy(e.target, true);
  const base = curItems.length;
  const { error } = await sb.from('library_items').insert(previewRows.map((r, i) => ({ library_id: curLib.id, term: r.a, meaning: r.b, position: base + i })));
  busy(e.target, false);
  if (error) return say($('#import-msg'), 'Không nhập được. Bạn có thể không có quyền sửa thư viện này.');
  toast(`Đã nhập ${previewRows.length} mục.`); e.target.reset(); previewRows = []; $('#import-list').replaceChildren(); say($('#import-msg'), ''); $('#import-go').disabled = true; renderLibrary();
}
async function onAddItem(e) {
  e.preventDefault();
  const f = e.target, out = $('#item-msg'), a = normItem(f.term.value), b = normItem(f.meaning.value);
  if (!a || !b || !variantsOk(a) || !variantsOk(b)) return say(out, 'Hãy nhập cả vế A và vế B.');
  if (curItems.some((i) => keyOf(i.term, i.meaning) === keyOf(a, b))) return say(out, 'Mục này đã có trong thư viện.');
  busy(f, true);
  const { error } = await sb.from('library_items').insert({ library_id: curLib.id, term: a, meaning: b, position: curItems.length });
  busy(f, false);
  if (error) return say(out, 'Không thêm được mục. Bạn có thể không có quyền sửa thư viện này.');
  f.reset(); say(out, ''); renderLibrary();
}

// ===== Danh sách / khám phá thư viện =====
let browseTab = 'mine';
async function fetchLibs(tab, text, tag) {
  let q = sb.from('libraries').select('id,title,description,visibility,source,tag:tags(name,color),items:library_items(count)');
  if (tab === 'mine') q = q.eq('owner_id', state.user.id).neq('source', 'system');
  else if (tab === 'system') q = q.eq('source', 'system').eq('visibility', 'public').in('moderation', ['ok', 'reported']);
  else q = q.eq('visibility', 'public').neq('source', 'system').neq('owner_id', state.user.id).in('moderation', ['ok', 'reported']);
  if (text) q = q.ilike('title', `%${text.replace(/[%_,()]/g, ' ')}%`);
  if (tag) q = q.eq('tag_id', tag);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(60);
  return error ? null : data.map((l) => ({ ...l, n: l.items && l.items[0] ? l.items[0].count : 0 }));
}
let browseSeq = 0;
const MOD_LABEL = { ok: 'Công khai', reported: 'Có báo cáo', hidden: 'Đã ẩn', locked: 'Đã khóa' };
const MOD_NOTE = { hidden: 'Thư viện đang bị ẩn bởi quản trị nên không hiển thị trong cộng đồng.', locked: 'Thư viện đang bị khóa bởi quản trị: không hiển thị trong cộng đồng và không thể chỉnh sửa.' };
const REASONS = { inappropriate: 'Nội dung không phù hợp', misleading: 'Nội dung sai lệch, gây hiểu nhầm', spam: 'Spam', violation: 'Vi phạm quy định', other: 'Lý do khác' };
async function renderLibraries() {
  document.querySelectorAll('#browse-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === browseTab)));
  $('#browse-sort-label').hidden = browseTab !== 'community';
  await fillTags($('#browse-tag'));
  const my = ++browseSeq; $('#browse-loading').hidden = false; $('#browse-empty').hidden = true;
  const list = $('#browse-list');
  const text = clean($('#browse-q').value), tag = $('#browse-tag').value;
  let rows;
  if (browseTab === 'community') {
    const { data, error } = await sb.rpc('community_libraries', { q: text, tagid: tag || null, sortby: $('#browse-sort').value, lim: 60 });
    rows = error ? null : data.map((l) => ({ id: l.id, title: l.title, description: l.description, n: l.items, tag: l.tag_name ? { name: l.tag_name, color: l.tag_color } : null, author: l.author, avg: l.avg_rating, cnt: l.rating_count, learners: l.learners }));
  } else rows = await fetchLibs(browseTab, text, tag);
  if (my !== browseSeq) return;
  $('#browse-loading').hidden = true;
  if (!rows) return toast('Không tải được danh sách thư viện.');
  const empty = $('#browse-empty'); empty.hidden = rows.length > 0;
  empty.textContent = browseTab === 'mine' ? 'Bạn chưa có thư viện nào khớp. Tạo thư viện ở Bảng điều khiển.' : 'Chưa có thư viện công khai nào khớp bộ lọc.';
  list.replaceChildren();
  rows.forEach((l) => {
    const c = el('article', null, 'lib'), meta = el('div', null, 'meta');
    addMeta(meta, `${l.n} mục`); if (l.tag) addMeta(meta, tagChip(l.tag));
    if (l.author) addMeta(meta, `Tác giả: ${l.author}`, l.cnt ? `★ ${Number(l.avg).toFixed(1)} (${l.cnt})` : 'Chưa có đánh giá', `${l.learners} người học`);
    if (browseTab === 'mine' && l.n < MIN_ITEMS) addMeta(meta, 'Bản nháp');
    c.append(el('h4', l.title), el('p', l.description || 'Chưa có mô tả.'), meta, btn('Xem chi tiết', () => openLibrary(l.id, l.title)));
    list.append(c);
  });
}

// ===== Đánh giá, báo cáo, kiểm duyệt trong trang chi tiết =====
async function renderSocial() {
  const box = $('#lib-social');
  const { data, error } = curLib.visibility === 'public' ? await sb.rpc('library_social', { lib: curLib.id }) : { data: null };
  box.hidden = !!error || !data;
  if (box.hidden) return;
  $('#lib-author').textContent = 'Tác giả: ' + (curLib.source === 'system' ? 'Hệ thống' : data.author);
  $('#lib-rating').textContent = data.count ? `Điểm trung bình ${Number(data.avg).toFixed(1)}/5 (${data.count} lượt đánh giá)` : 'Chưa có đánh giá.';
  const stars = $('#rate-stars'); stars.replaceChildren();
  $('#rate-row').hidden = !data.can_rate; $('#rate-note').hidden = data.can_rate || curLib.owner_id !== state.user.id;
  for (let n = 1; n <= 5; n++) {
    const b = el('button', '★', 'star' + (data.mine >= n ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-label', `${n} sao`);
    b.addEventListener('click', () => rate(n, data.mine != null)); stars.append(b);
  }
  $('#report-form').hidden = !data.can_report;
}
async function rate(n, had) {
  const r = had ? await sb.from('library_ratings').update({ stars: n }).eq('library_id', curLib.id) : await sb.from('library_ratings').insert({ library_id: curLib.id, stars: n });
  if (r.error) return toast('Không lưu được đánh giá.');
  toast('Đã lưu đánh giá.'); renderSocial();
}
async function onReport(e) {
  e.preventDefault();
  const f = e.target, out = $('#report-msg'); busy(f, true);
  const { error } = await sb.from('content_reports').insert({ library_id: curLib.id, reason: f.elements.reason.value, details: f.elements.details.value.trim() });
  busy(f, false);
  if (error) return say(out, error.code === '23505' ? 'Bạn đã báo cáo thư viện này và báo cáo đang được xử lý.' : /quá nhiều/.test(error.message) ? 'Bạn đã gửi quá nhiều báo cáo hôm nay. Hãy thử lại sau.' : 'Không gửi được báo cáo.');
  f.reset(); say(out, 'Đã gửi báo cáo. Cảm ơn bạn.', true);
}
async function renderMod() {
  const box = $('#lib-mod'); box.hidden = !(can('moderate_libraries') && curLib.visibility === 'public' && (curLib.source !== 'system' || state.role === 'boss'));
  if (box.hidden) return;
  const st = curLib.moderation, bx = $('#mod-btns'); bx.replaceChildren();
  $('#mod-state').textContent = 'Trạng thái: ' + MOD_LABEL[st];
  const act = (label, to, cls) => bx.append(btn(label, async () => {
    if (!(await askConfirm(`${label} thư viện "${curLib.title}"?`))) return;
    await rpc('set_library_moderation', { lib: curLib.id, new_status: to, note: $('#mod-note').value }, 'Đã cập nhật trạng thái.', renderLibrary);
  }, cls));
  if (st === 'ok' || st === 'reported') { act('Ẩn', 'hidden'); act('Khóa', 'locked'); } else { act(st === 'locked' ? 'Mở khóa' : 'Mở lại', 'ok', 'btn small'); if (st === 'hidden') act('Khóa', 'locked'); }
  const h = await sb.rpc('admin_recent_activity', { lim: 20, for_target: curLib.id });
  $('#mod-hist').replaceChildren(...(h.data || []).map((x) => el('li', `${new Date(x.created_at).toLocaleString('vi-VN')}: ${x.actor || '—'}, ${ACTION(x.action)}${x.details && x.details.note ? ' (' + x.details.note + ')' : ''}`)));
}

// ===== Trò chơi học =====
let G = null;
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = (v) => clean(v).toLowerCase();
const normWord = (v) => norm(v).replace(/^[.,;:!?"']+|[.,;:!?"']+$/g, '');
const PV = (it) => (G.dir === 'en_vi' ? it.tv : it.mv), AV = (it) => (G.dir === 'en_vi' ? it.mv : it.tv);
const P = (it) => PV(it).join(' / '), A = (it) => AV(it).join(' / ');
const pick1 = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isAns = (it, v) => AV(it).some((x) => norm(x) === norm(v));
const overlaps = (a, b) => AV(a).some((v) => isAns(b, v));
const TYPE_LABEL = { flashcard: 'Flashcard', mcq: 'Trắc nghiệm', type: 'Nhập đáp án', match: 'Ghép cặp', fill: 'Điền vào chỗ trống' };
function studyFromLib() { studyFrom = { id: curLib.id, src: curLib.source === 'system' ? 'system' : curLib.owner_id === state.user.id ? 'mine' : 'community' }; location.hash = '#/study'; }
function showPanel(p) { $('#study-setup').hidden = p !== 'setup'; $('#study-play').hidden = p !== 'play'; $('#study-result').hidden = p !== 'result'; }
async function loadStudyLibs() {
  const sel = $('#st-lib'); sel.replaceChildren(new Option('Đang tải…', ''));
  const rows = await fetchLibs($('#st-src').value, '', '');
  sel.replaceChildren();
  if (!rows || !rows.length) { sel.append(new Option('Chưa có thư viện nào', '')); return; }
  rows.forEach((l) => { const o = new Option(`${l.title} (${l.n} mục${l.n < MIN_ITEMS ? ', bản nháp' : ''})`, l.id); o.disabled = l.n < MIN_ITEMS; sel.append(o); });
  const first = [...sel.options].find((o) => !o.disabled); sel.value = first ? first.value : '';
  if (!first) say($('#st-msg'), `Chưa có thư viện nào đủ ${MIN_ITEMS} mục để học trong nguồn này.`);
}
async function renderStudy() {
  if (G && !G.over) return showPanel('play');
  showPanel('setup'); say($('#st-msg'), '');
  if (studyFrom) { $('#st-src').value = studyFrom.src; await loadStudyLibs(); $('#st-lib').value = studyFrom.id; studyFrom = null; }
  else await loadStudyLibs();
}
function onModeChange() {
  const speed = $('#st-mode').value === 'speed', n = $('#st-num');
  $('#st-num-label').textContent = speed ? 'Thời gian (giây)' : 'Số câu';
  n.min = speed ? 10 : 1; n.max = speed ? 3600 : 100; n.value = speed ? 60 : 10;
}
async function startGame(e) {
  e.preventDefault();
  const out = $('#st-msg'), libId = $('#st-lib').value, mode = $('#st-mode').value, num = parseInt($('#st-num').value, 10);
  const types = [...document.querySelectorAll('#st-types input:checked')].map((i) => i.value);
  if (!libId) return say(out, 'Hãy chọn nguồn và thư viện cụ thể.');
  if (!types.length) return say(out, 'Hãy chọn ít nhất một dạng câu hỏi.');
  const lo = mode === 'speed' ? 10 : 1, hi = mode === 'speed' ? 3600 : 100;
  if (!(num >= lo && num <= hi)) return say(out, mode === 'speed' ? 'Thời gian từ 10 đến 3600 giây.' : 'Số câu từ 1 đến 100.');
  busy(e.target, true); say(out, 'Đang chuẩn bị…', true);
  const { data: items, error } = await sb.from('library_items').select('id,term,meaning').eq('library_id', libId);
  if (error || items.length < MIN_ITEMS) { busy(e.target, false); return say(out, `Thư viện cần tối thiểu ${MIN_ITEMS} mục để học.`); }
  const r = await sb.from('study_sessions').insert({ library_id: libId, mode, direction: 'mixed', planned_count: mode === 'classic' ? num : null, planned_seconds: mode === 'speed' ? num : null }).select('id').single();
  busy(e.target, false);
  if (r.error) return say(out, 'Không bắt đầu được phiên học. ' + dbHint(r.error));
  G = { sid: r.data.id, items: items.map((i) => ({ ...i, term: clean(i.term), meaning: clean(i.meaning), tv: variants(i.term), mv: variants(i.meaning) })), mode, dir: 'en_vi', types, flashOnly: types.length === 1 && types[0] === 'flashcard', flash: 0, missed: new Set(), limit: num, done: 0, correct: 0, bag: [], pending: [], failed: false, t0: Date.now(), over: false, q: null };
  say(out, ''); showPanel('play'); G.timer = setInterval(tick, 250); tick(); nextQuestion();
}
function tick() {
  if (!G || G.over) return;
  const sec = (Date.now() - G.t0) / 1000;
  if (G.mode === 'speed') {
    const left = Math.max(0, G.limit - sec);
    $('#g-info').textContent = 'Còn ' + fmt(Math.ceil(left)); $('#g-fill').style.width = (100 * left / G.limit) + '%';
    if (left <= 0) finishGame();
  } else { $('#g-info').textContent = `Câu ${Math.min(G.done + 1, G.limit)}/${G.limit} — ${fmt(sec)}`; $('#g-fill').style.width = (100 * G.done / G.limit) + '%'; }
  $('#g-score').textContent = G.flashOnly ? `Thẻ đã xem: ${G.flash}` : `Đúng ${G.correct}/${G.done}`;
}
function nextItem() { if (!G.bag.length) G.bag = shuffle(G.items); return G.bag.pop(); }
function build(t, it) {
  const others = G.items.filter((x) => x.id !== it.id && !overlaps(it, x));
  if (t === 'flashcard' || t === 'type') return { t, item: it };
  if (t === 'mcq') {
    const pool = []; shuffle(others).forEach((x) => { if (!pool.some((u) => overlaps(u, x))) pool.push(x); });
    const right = pick1(AV(it)), wc = (v) => v.split(' ').length;
    const d = pool.sort((a, b) => Math.abs(wc(AV(a)[0]) - wc(right)) - Math.abs(wc(AV(b)[0]) - wc(right))).slice(0, 3);
    return d.length < 3 ? null : { t, item: it, options: shuffle([right, ...d.map((x) => pick1(AV(x)))]) };
  }
  if (t === 'fill') {
    const words = pick1(AV(it)).split(' '), cores = words.map(normWord); let pos = -1;
    cores.forEach((c, i) => { if (c && (pos < 0 || c.length > cores[pos].length)) pos = i; });
    return pos < 0 ? null : { t, item: it, words, pos };
  }
  if (t === 'match') {
    const set = [it]; shuffle(others).forEach((x) => { if (set.length < 4 && !set.some((u) => overlaps(u, x))) set.push(x); });
    return set.length < 4 ? null : { t, item: it, set, shown: set.map((x) => pick1(AV(x))) };
  }
  return null;
}
function nextQuestion() {
  if (!G || G.over) return;
  clearTimeout(G.auto);
  if (G.mode === 'classic' && G.done >= G.limit) return finishGame();
  G.dir = Math.random() < 0.5 ? 'en_vi' : 'vi_en';
  const it = nextItem(); let q = null;
  for (const t of shuffle(G.types)) { q = build(t, it); if (q) break; }
  G.q = q || build('flashcard', it); renderQ(G.q);
}
function record(q, it, answer, extra = {}) {
  G.pending.push(sb.from('study_attempts').insert({ session_id: G.sid, item_id: it.id, qtype: q.t, direction: G.dir, answer: answer == null ? null : String(answer).slice(0, 400), ...extra }).then((r) => { if (r.error) { G.failed = true; G.err = G.err || r.error; } }));
}
function settle(ok, msg) {
  G.done++; if (ok) G.correct++;
  const fb = $('#g-fb'); fb.textContent = msg; fb.className = 'msg' + (ok ? ' ok' : '');
  tick();
  if (G.mode === 'speed') G.auto = setTimeout(nextQuestion, ok ? 600 : 1500);
  else { setBtn($('#g-next'), G.done >= G.limit ? 'Xem kết quả' : 'Câu tiếp'); $('#g-next').hidden = false; $('#g-next').focus(); }
}
function settleFlash(ok, it) {
  G.flash++; if (!ok) G.missed.add(it.id); if (G.flashOnly) G.done++;
  const fb = $('#g-fb'); fb.textContent = ok ? 'Đã nhớ (flashcard không tính điểm).' : 'Sẽ ôn lại từ này (flashcard không tính điểm).'; fb.className = 'msg' + (ok ? ' ok' : '');
  tick();
  if (G.mode === 'speed') G.auto = setTimeout(nextQuestion, 500);
  else { setBtn($('#g-next'), G.flashOnly && G.done >= G.limit ? 'Xem kết quả' : 'Câu tiếp'); $('#g-next').hidden = false; $('#g-next').focus(); }
}
function askText(q, body, check, extra, wrongMsg) {
  const inp = el('input'); inp.autocomplete = 'off'; inp.autocapitalize = 'none'; inp.setAttribute('aria-label', 'Câu trả lời');
  const go = btn('Kiểm tra', () => {
    const v = inp.value; if (!clean(v)) return inp.focus();
    inp.disabled = true; go.disabled = true;
    const ok = check(v); record(q, q.item, v, extra); settle(ok, ok ? 'Đúng!' : wrongMsg);
  }, 'btn');
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
  body.append(inp, el('p'), go); inp.focus();
}
function renderQ(q) {
  const body = $('#g-body'), it = q.item; body.replaceChildren();
  $('#g-fb').textContent = ''; $('#g-fb').className = 'msg'; $('#g-next').hidden = true; $('#g-type').textContent = TYPE_LABEL[q.t] + (q.t === 'flashcard' ? ' (không tính điểm)' : '') + ' · ' + (G.dir === 'en_vi' ? 'Anh → Việt' : 'Việt → Anh');
  $('#g-prompt').textContent = q.t === 'match' ? 'Ghép mỗi mục với nghĩa tương ứng' : P(it);
  if (q.t === 'flashcard') {
    const show = btn('Xem đáp án', () => {
      show.remove(); body.append(el('p', A(it), 'reveal'));
      const rate = (ok) => { record(q, it, null, { self_correct: ok }); settleFlash(ok, it); [...body.querySelectorAll('button')].forEach((b) => { b.disabled = true; }); };
      const r = el('p', null, 'row'); r.append(btn('Chưa nhớ', () => rate(false), 'btn ghost'), btn('Đã nhớ', () => rate(true), 'btn')); body.append(r);
    }, 'btn'); body.append(show);
  } else if (q.t === 'mcq') {
    const grid = el('div', null, 'opts'); body.append(grid);
    q.options.forEach((o) => grid.append(btn(o, (ev) => {
      const ok = isAns(it, o);
      body.querySelectorAll('.opt').forEach((x) => { x.disabled = true; if (isAns(it, x.textContent)) x.classList.add('ok'); });
      if (!ok) ev.currentTarget.classList.add('bad');
      record(q, it, o); settle(ok, ok ? 'Đúng!' : 'Chưa đúng. Đáp án: ' + A(it));
    }, 'opt')));
  } else if (q.t === 'type') {
    if (AV(it).length > 1) body.append(el('p', 'Có nhiều đáp án đồng nghĩa, chỉ cần nhập một trong số đó.', 'muted'));
    askText(q, body, (v) => isAns(it, v), {}, 'Chưa đúng. Đáp án: ' + A(it));
  } else if (q.t === 'fill') {
    const shown = q.words.map((w, i) => (i === q.pos ? '_____' : w)).join(' ');
    body.append(el('p', shown, 'reveal'), el('p', 'Điền phần bị ẩn:', 'muted'));
    askText(q, body, (v) => AV(it).some((x) => normWord(x.split(' ')[q.pos] || '') === normWord(v)), { blank_pos: q.pos + 1 }, 'Chưa đúng. Đáp án: ' + A(it));
  } else if (q.t === 'match') {
    const right = shuffle(q.set.map((x, i) => ({ id: x.id, text: q.shown[i] }))), first = {}, wrongSet = new Set(); let sel = null, matched = 0;
    const wrap = el('div', null, 'pairs'), lc = el('div'), rc = el('div'); wrap.append(lc, rc); body.append(wrap);
    q.set.forEach((x) => lc.append(Object.assign(btn(P(x), (ev) => {
      if (ev.currentTarget.classList.contains('ok')) return;
      lc.querySelectorAll('.opt').forEach((b) => b.classList.remove('sel')); ev.currentTarget.classList.add('sel'); sel = x;
    }, 'opt'), {})));
    right.forEach((x) => rc.append(btn(x.text, (ev) => {
      if (!sel || ev.currentTarget.classList.contains('ok')) return;
      if (first[sel.id] === undefined) first[sel.id] = x.text;
      if (x.id === sel.id) {
        ev.currentTarget.classList.add('ok'); ev.currentTarget.disabled = true;
        const lb = [...lc.children].find((b) => b.textContent === P(sel)); lb.classList.remove('sel'); lb.classList.add('ok'); lb.disabled = true;
        sel = null; matched++;
        if (matched === q.set.length) { const qid = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); q.set.forEach((m) => record(q, m, first[m.id], { qid })); settle(wrongSet.size === 0, wrongSet.size === 0 ? 'Đúng hết!' : `Đã ghép xong, sai ${wrongSet.size} cặp ở lần chọn đầu.`); }
      } else { wrongSet.add(sel.id); ev.currentTarget.classList.add('bad'); const b = ev.currentTarget; setTimeout(() => b.classList.remove('bad'), 600); }
    }, 'opt')));
  }
}
async function finishGame() {
  if (!G || G.over) return;
  G.over = true; clearInterval(G.timer); clearTimeout(G.auto);
  const g = G; showPanel('result'); $('#res-stats').replaceChildren(); $('#res-weak').replaceChildren(); say($('#res-note'), 'Đang lưu kết quả…', true);
  await Promise.all(g.pending);
  await sb.rpc('finish_study_session', { sid: g.sid });
  const [ss, at] = await Promise.all([
    sb.from('study_sessions').select('total,correct,duration_seconds').eq('id', g.sid).single(),
    sb.from('study_attempts').select('item_id,correct,qtype').eq('session_id', g.sid)]);
  if (ss.error || at.error) return say($('#res-note'), 'Không tải được kết quả đã lưu.');
  const { total, correct, duration_seconds: dur } = ss.data, flash = at.data.filter((x) => x.qtype === 'flashcard').length;
  const box = $('#res-stats'), tiles = el('div', null, 'tiles');
  box.replaceChildren(ringEl(total ? Math.round(100 * correct / total) : null), tiles);
  tile(tiles, 'Tổng số câu', total, 'list'); tile(tiles, 'Số câu đúng', correct, 'check', 'good'); tile(tiles, 'Số câu sai', total - correct, 'x', 'bad'); tile(tiles, 'Thời gian học', fmt(dur || 0), 'clock');
  if (flash) tile(tiles, 'Flashcard đã xem (không tính điểm)', flash, 'book', 'wide');
  const ids = new Set(at.data.filter((x) => x.qtype !== 'flashcard' && !x.correct).map((x) => x.item_id)); g.missed.forEach((id) => ids.add(id));
  const wrong = [...ids].map((id) => g.items.find((i) => i.id === id)).filter(Boolean);
  $('#res-empty').hidden = wrong.length > 0;
  wrong.forEach((i) => $('#res-weak').append(el('li', `${showV(i.term)} : ${showV(i.meaning)}`)));
  say($('#res-note'), g.failed ? 'Một số câu trả lời chưa lưu được nên thống kê có thể thiếu. ' + dbHint(g.err) : '');
}

// ===== Tiến độ cá nhân =====
async function renderProgress() {
  $('#pg-loading').hidden = false;
  const [s, w] = await Promise.all([
    sb.from('study_sessions').select('mode,direction,total,correct,duration_seconds,started_at,lib:libraries(title)').not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(30),
    sb.from('word_progress').select('correct,wrong,item:library_items(term,meaning)').gt('wrong', 0).order('wrong', { ascending: false }).limit(50)]);
  $('#pg-loading').hidden = true;
  if (s.error || w.error) return toast('Không tải được tiến độ.');
  const tot = s.data.reduce((a, x) => a + (x.total || 0), 0), cor = s.data.reduce((a, x) => a + (x.correct || 0), 0), time = s.data.reduce((a, x) => a + (x.duration_seconds || 0), 0);
  const box = $('#pg-stats'); box.replaceChildren();
  [['Phiên học', s.data.length, 'book'], ['Số câu đã làm', tot, 'list'], ['Độ chính xác', tot ? Math.round(100 * cor / tot) + '%' : '—', 'check'], ['Thời gian học', fmt(time), 'clock']]
    .forEach(([k, v, ic]) => tile(box, k, v, ic));
  const weak = w.data.filter((x) => x.item && x.wrong > x.correct).slice(0, 20);
  $('#pg-weak-empty').hidden = weak.length > 0; $('#pg-weak').replaceChildren(...weak.map((x) => el('li', `${showV(x.item.term)} : ${showV(x.item.meaning)} (sai ${x.wrong}, đúng ${x.correct})`)));
  $('#pg-empty').hidden = s.data.length > 0;
  $('#pg-list').replaceChildren(...s.data.map((x) => el('li', `${new Date(x.started_at).toLocaleDateString('vi-VN')}: ${x.lib ? x.lib.title : 'Thư viện đã ẩn'}, ${x.mode === 'speed' ? 'Speed' : 'Classic'}, ${{ en_vi: 'Anh → Việt', vi_en: 'Việt → Anh', mixed: 'Hai chiều' }[x.direction] || ''}, ${x.correct}/${x.total} câu đúng`)));
}

// ===== Quản trị (quyền được kiểm tra lại ở database bằng RLS/RPC) =====
const isStaff = () => state.role === 'boss' || state.role === 'admin';
const can = (p) => state.role === 'boss' || state.perms.includes(p);
const PERMS = { manage_tags: 'Quản lý thẻ', lock_users: 'Khóa/mở khóa tài khoản', moderate_libraries: 'Kiểm duyệt thư viện và báo cáo' };
const RP_STATUS = { open: 'Chưa xử lý', in_review: 'Đang xử lý', accepted: 'Đã chấp nhận', rejected: 'Đã từ chối' };
const ACTION = (a) => String(a).replace(/_/g, ' ');
const debounce = (fn, ms = 300) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const stat = (box, k, v, ic) => tile(box, k, v, ic);
const when = (d) => new Date(d).toLocaleString('vi-VN');
function askConfirm(text) {
  return new Promise((res) => {
    const d = $('#confirm-dlg'); $('#confirm-text').textContent = text; d.returnValue = '';
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }); d.showModal();
  });
}
async function rpc(fn, args, okMsg, after) {
  const { error } = await sb.rpc(fn, args);
  if (error) { toast('Thao tác thất bại: ' + (error.message || 'không đủ quyền')); return false; }
  toast(okMsg); (after || renderAdmin)(); return true;
}
let atab = 'overview';
const ATABS = [['overview', 'Tổng quan', () => true], ['users', 'Người dùng', () => can('lock_users')], ['libraries', 'Thư viện', () => can('moderate_libraries')], ['reports', 'Báo cáo', () => can('moderate_libraries')], ['tags', 'Thẻ', () => can('manage_tags')]];
function renderAdmin() {
  const allowed = ATABS.filter((t) => t[2]()); if (!allowed.some((t) => t[0] === atab)) atab = 'overview';
  const bar = $('#adm-tabs'); bar.replaceChildren();
  allowed.forEach(([k, label]) => { const b = el('button', label, 'tab'); b.type = 'button'; b.setAttribute('aria-selected', String(k === atab)); b.addEventListener('click', () => { atab = k; renderAdmin(); }); bar.append(b); });
  document.querySelectorAll('[data-apanel]').forEach((p) => { p.hidden = p.dataset.apanel !== atab; });
  $('#adm-sys-box').hidden = state.role !== 'boss';
  ({ overview: renderOverview, users: renderUsers, libraries: renderAdminLibs, reports: renderReports, tags: renderTags })[atab]();
}
async function renderOverview() {
  const [s, a] = await Promise.all([sb.rpc('admin_stats'), sb.rpc('admin_recent_activity', { lim: 15, for_target: null })]);
  if (s.error) return toast('Không tải được thống kê.');
  const d = s.data, box = $('#adm-stats'); box.replaceChildren();
  [['Tổng số người dùng', d.users_total], ['Người dùng đang hoạt động', d.users_active], ['Tổng số thư viện', d.libs_total], ['Thư viện công khai', d.libs_public], ['Báo cáo chưa xử lý', d.reports_open]].forEach(([k, v], i) => stat(box, k, v, ['users', 'check', 'book', 'eye', 'flag'][i]));
  const rows = a.data || []; $('#adm-audit-empty').hidden = rows.length > 0;
  $('#adm-audit').replaceChildren(...rows.map((x) => el('li', `${when(x.created_at)}: ${x.actor || '—'}, ${ACTION(x.action)}`)));
}
async function renderUsers() {
  const boss = state.role === 'boss', text = clean($('#usr-q').value).toLowerCase().replace(/[%_,()]/g, '');
  let pq = sb.from('profiles').select('id,username,status').order('username').limit(50);
  if (text) pq = pq.ilike('username', `%${text}%`);
  const [p, r, a] = await Promise.all([pq, sb.from('user_roles').select('user_id,role'),
    boss ? sb.from('admin_permissions').select('user_id,permission') : Promise.resolve({ data: [] })]);
  if (p.error || r.error) return toast('Không tải được danh sách người dùng.');
  const roles = Object.fromEntries(r.data.map((x) => [x.user_id, x.role]));
  const box = $('#adm-users'); box.replaceChildren();
  p.data.filter((u) => u.id !== state.user.id).forEach((u) => {
    const role = roles[u.id] || 'user', locked = u.status === 'locked', row = el('div', null, 'lib'), acts = el('div', null, 'row');
    row.append(el('h4', u.username), el('p', `${ROLE_LABEL[role]}, ${locked ? 'đã khóa' : 'hoạt động'}`));
    if (role !== 'boss' && (role !== 'admin' || boss)) acts.append(btn(locked ? 'Mở khóa' : 'Khóa', async () => {
      if (!(await askConfirm(`${locked ? 'Mở khóa' : 'Khóa'} tài khoản "${u.username}"?`))) return;
      rpc('set_account_status', { target: u.id, new_status: locked ? 'active' : 'locked' }, 'Đã cập nhật tài khoản.');
    }));
    if (boss && role !== 'boss') acts.append(btn(role === 'admin' ? 'Gỡ Admin' : 'Bổ nhiệm Admin', async () => {
      if (!(await askConfirm(`${role === 'admin' ? 'Gỡ quyền Admin của' : 'Bổ nhiệm Admin cho'} "${u.username}"?`))) return;
      rpc('set_admin', { target: u.id, make_admin: role !== 'admin' }, 'Đã cập nhật vai trò.');
    }));
    if (boss && role !== 'boss') acts.append(btn('Xóa vĩnh viễn', async () => {
      if (!(await askConfirm(`Xóa vĩnh viễn tài khoản "${u.username}"? Mọi thư viện và dữ liệu học của tài khoản sẽ bị xóa và không thể khôi phục.`))) return;
      rpc('delete_account', { target: u.id }, 'Đã xóa tài khoản.');
    }, 'del'));
    row.append(acts);
    if (boss && role === 'admin') {
      const have = (a.data || []).filter((x) => x.user_id === u.id).map((x) => x.permission);
      Object.entries(PERMS).forEach(([k, label]) => {
        const l = el('label', label, 'perm'), c = document.createElement('input');
        c.type = 'checkbox'; c.checked = have.includes(k);
        c.addEventListener('change', () => rpc('set_admin_permission', { target: u.id, perm: k, allowed: c.checked }, 'Đã cập nhật quyền.'));
        l.prepend(c); row.append(l);
      });
    }
    box.append(row);
  });
  $('#adm-users-empty').hidden = box.children.length > 0;
}
async function renderAdminLibs() {
  const { data, error } = await sb.rpc('admin_libraries', { q: clean($('#al-q').value), srcf: $('#al-src').value, modst: $('#al-mod').value });
  if (error) return toast('Không tải được danh sách thư viện.');
  const box = $('#al-list'); box.replaceChildren(); $('#al-empty').hidden = data.length > 0;
  data.forEach((l) => {
    const c = el('div', null, 'lib'), meta = el('div', null, 'meta');
    addMeta(meta, l.source === 'system' ? 'Hệ thống' : 'Người dùng', l.visibility === 'public' ? 'Công khai' : 'Riêng tư', MOD_LABEL[l.moderation], `${l.items} mục`);
    if (l.open_reports) addMeta(meta, `${l.open_reports} báo cáo chờ`);
    c.append(el('h4', l.title), el('p', l.author ? 'Tác giả: ' + l.author : ''), meta, btn('Chi tiết và kiểm duyệt', () => openLibrary(l.id, l.title)));
    if (state.role === 'boss' && l.source === 'system') c.append(btn('Xóa thư viện', async () => {
      if (!(await askConfirm(`Xóa thư viện hệ thống "${l.title}"?`))) return;
      const r = await sb.from('libraries').delete().eq('id', l.id);
      if (r.error) return toast('Không xóa được thư viện.');
      renderAdminLibs();
    }, 'del'));
    box.append(c);
  });
}
async function renderReports() {
  const { data, error } = await sb.rpc('admin_reports', { st: $('#rp-status').value });
  if (error) return toast('Không tải được báo cáo.');
  const box = $('#rp-list'); box.replaceChildren(); $('#rp-empty').hidden = data.length > 0;
  data.forEach((r) => {
    const c = el('div', null, 'lib'), meta = el('div', null, 'meta');
    addMeta(meta, RP_STATUS[r.status], `Người báo cáo: ${r.reporter || 'đã xóa'}`, when(r.created_at));
    c.append(el('h4', r.library_title), el('p', REASONS[r.reason]), meta, btn('Xem chi tiết', () => showReport(r)));
    box.append(c);
  });
}
function showReport(r) {
  const d = $('#rp-detail'); d.hidden = false; d.replaceChildren();
  d.append(el('h3', 'Báo cáo: ' + r.library_title), el('p', 'Lý do: ' + REASONS[r.reason]), el('p', r.details ? 'Mô tả: ' + r.details : 'Không có mô tả bổ sung.'),
    el('p', `Người báo cáo: ${r.reporter || 'đã xóa'}, ${when(r.created_at)}`), el('p', `Trạng thái báo cáo: ${RP_STATUS[r.status]}. Trạng thái thư viện: ${MOD_LABEL[r.library_moderation]}.`));
  if (r.resolution) d.append(el('p', 'Ghi chú xử lý: ' + r.resolution));
  const open = r.status === 'open' || r.status === 'in_review', note = el('input'), acts = el('div', null, 'row');
  note.maxLength = 300; note.placeholder = 'Ghi chú xử lý (không bắt buộc)'; note.setAttribute('aria-label', 'Ghi chú xử lý');
  const close = () => { d.hidden = true; };
  const act = (label, st, confirmIt, cls) => btn(label, async () => {
    if (confirmIt && !(await askConfirm(`${label} báo cáo này?`))) return;
    if (await rpc('resolve_report', { rid: r.id, new_status: st, note: note.value }, 'Đã cập nhật báo cáo.', renderReports)) close();
  }, cls || 'btn small');
  if (open) d.append(note);
  if (r.status === 'open') acts.append(act('Đánh dấu đang xử lý', 'in_review', false, 'btn small ghost'));
  if (open) acts.append(act('Chấp nhận', 'accepted', true), act('Từ chối', 'rejected', true));
  acts.append(btn('Xem thư viện', () => openLibrary(r.library_id, r.library_title)), btn('Đóng', close));
  d.append(acts);
  if (open) d.append(el('p', 'Chấp nhận nghĩa là báo cáo đúng. Hãy ẩn hoặc khóa thư viện ở trang chi tiết nếu cần; báo cáo không tự xóa thư viện.', 'muted'));
  d.scrollIntoView({ block: 'nearest' });
}
let editTag = null;
function resetTagForm() { editTag = null; $('#tag-form').reset(); setBtn($('#tag-submit'), 'Thêm thẻ'); $('#tag-cancel').hidden = true; say($('#tag-msg'), ''); }
async function renderTags() {
  const { data, error } = await sb.from('tags').select('id,name,description,color').order('name');
  if (error) return toast('Không tải được thẻ.');
  const box = $('#adm-tags'); box.replaceChildren();
  data.forEach((t) => {
    const c = el('div', null, 'lib'); c.style.borderLeftColor = t.color; c.append(el('h4', t.name), el('p', t.description));
    c.append(btn('Sửa', () => {
      editTag = t; const f = $('#tag-form').elements; f.name.value = t.name; f.description.value = t.description; f.color.value = t.color;
      setBtn($('#tag-submit'), 'Lưu thẻ'); $('#tag-cancel').hidden = false; f.name.focus();
    }), btn('Xóa thẻ', async () => {
      if (!(await askConfirm(`Xóa thẻ "${t.name}"?`))) return;
      const r = await sb.from('tags').delete().eq('id', t.id);
      if (r.error) return toast(/dùng/.test(r.error.message) ? r.error.message : 'Không xóa được thẻ.');
      resetTags(); renderTags();
    }, 'del'));
    box.append(c);
  });
}
async function onAddTag(e) {
  e.preventDefault();
  const f = e.target, out = $('#tag-msg'), x = f.elements, name = clean(x.name.value);
  if (!name) return say(out, 'Hãy nhập tên thẻ.');
  const row = { name, description: x.description.value.trim(), color: x.color.value };
  busy(f, true);
  const { error } = editTag ? await sb.from('tags').update(row).eq('id', editTag.id) : await sb.from('tags').insert(row);
  busy(f, false);
  if (error) return say(out, /duplicate|unique/i.test(error.message) ? 'Tên thẻ đã tồn tại.' : 'Không lưu được thẻ. Bạn có thể không có quyền.');
  resetTagForm(); resetTags(); renderTags();
}
async function onAddSystem(e) {
  e.preventDefault();
  const f = e.target, out = $('#sys-msg'), title = clean(f.elements.title.value);
  if (!title) return say(out, 'Hãy nhập tên thư viện.');
  busy(f, true);
  const { error } = await sb.from('libraries').insert({ owner_id: state.user.id, source: 'system', visibility: 'private', title, description: f.elements.description.value.trim() });
  busy(f, false);
  if (error) return say(out, 'Không tạo được thư viện hệ thống.');
  f.reset(); say(out, ''); toast('Đã tạo bản nháp. Thêm tối thiểu 8 mục rồi công khai ở trang chi tiết.'); renderAdminLibs();
}

// ===== Khởi động =====
async function sync(session) { state.user = session ? session.user : null; await loadProfile(); route(); }
async function init() {
  document.querySelectorAll('.btn, .del, nav a').forEach((n) => decorate(n));
  document.querySelectorAll('select').forEach(enhanceSelect);
  document.addEventListener('click', (e) => document.querySelectorAll('.cs').forEach((w) => { if (!w.contains(e.target)) { w.querySelector('.cs-list').hidden = true; w.querySelector('.cs-btn').setAttribute('aria-expanded', 'false'); } }));
  $('#login-form').addEventListener('submit', onLogin);
  $('#register-form').addEventListener('submit', onRegister);
  $('#lib-form').addEventListener('submit', onCreateLibrary);
  $('#pw-form').addEventListener('submit', onPassword);
  $('#logout-btn').addEventListener('click', onLogout);
  $('#item-form').addEventListener('submit', onAddItem);
  $('#tag-form').addEventListener('submit', onAddTag);
  $('#sys-form').addEventListener('submit', onAddSystem);
  $('#lib-edit').addEventListener('submit', onSaveLibrary);
  $('#import-preview').addEventListener('click', onImportPreview);
  $('#import-form').addEventListener('submit', onImportGo);
  $('#import-form').elements.text.addEventListener('input', () => { $('#import-go').disabled = true; });
  $('#lib-study').addEventListener('click', studyFromLib);
  document.querySelectorAll('#browse-tabs .tab').forEach((t) => t.addEventListener('click', () => { browseTab = t.dataset.tab; renderLibraries(); }));
  let bt; $('#browse-q').addEventListener('input', () => { clearTimeout(bt); bt = setTimeout(renderLibraries, 300); });
  $('#browse-tag').addEventListener('change', renderLibraries);
  $('#study-setup').addEventListener('submit', startGame);
  $('#st-src').addEventListener('change', loadStudyLibs);
  $('#st-mode').addEventListener('change', onModeChange);
  $('#g-next').addEventListener('click', nextQuestion);
  $('#g-quit').addEventListener('click', finishGame);
  $('#report-form').addEventListener('submit', onReport);
  $('#browse-sort').addEventListener('change', renderLibraries);
  $('#usr-q').addEventListener('input', debounce(renderUsers));
  $('#al-q').addEventListener('input', debounce(renderAdminLibs));
  $('#al-src').addEventListener('change', renderAdminLibs);
  $('#al-mod').addEventListener('change', renderAdminLibs);
  $('#rp-status').addEventListener('change', renderReports);
  $('#tag-cancel').addEventListener('click', resetTagForm);
  $('#res-again').addEventListener('click', () => { G = null; renderStudy(); });
  window.addEventListener('hashchange', route);
  if (!sb) { route(); return; }
  const { data } = await sb.auth.getSession();
  await sync(data.session);
  // Không await Supabase trực tiếp trong callback để tránh deadlock.
  sb.auth.onAuthStateChange((ev, session) => {
    const uid = session ? session.user.id : null;
    if (ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED' || uid === (state.user ? state.user.id : null)) return;
    setTimeout(() => sync(session), 0);
  });
}
document.addEventListener('DOMContentLoaded', init);
