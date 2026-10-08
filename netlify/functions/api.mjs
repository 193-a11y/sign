// Netlify Function — /api/*  (Node 22, Netlify Database = Postgres)
// 환경변수(필수): ADMIN_PASSWORD(최초 총괄 계정 생성용), SESSION_SECRET, PHONE_KEY(전화번호 암호화 키 — 한 번 정하면 바꾸지 말 것)
// 선택: DUTY_MULT(당직경비 차감 배수, 기본 2)

const ROLES = ['당직경비', '미화', '시설관리'];
const TYPES = {
  '연차': { d: 1 },
  '오전반차': { d: 1, half: 1 },
  '오후반차': { d: 1, half: 1 },
  '무급휴가': { d: 0 },
  '경조사휴가': { d: 0 },
};
const DEDUCT = Object.keys(TYPES).filter(k => TYPES[k].d);
const DEDUCT_SQL = DEDUCT.map(t => `'${t}'`).join(',');           // 상수 목록(사용자 입력 아님)
const MAX_ADMINS = 10;
const WORKER_TTL = 7 * 24 * 3600e3, ADMIN_TTL = 12 * 3600e3;
const PBKDF2_ITER = 210000;

// 공휴일 기본값(참고용). 관리자 화면에서 수정하면 settings 테이블 값이 우선합니다.
const DEFAULT_HOL = [
 '2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02','2026-05-01','2026-05-05','2026-05-24','2026-05-25','2026-06-03','2026-06-06','2026-08-15','2026-08-17','2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25',
 '2027-01-01','2027-02-06','2027-02-07','2027-02-08','2027-02-09','2027-03-01','2027-05-01','2027-05-03','2027-05-05','2027-05-13','2027-06-06','2027-07-17','2027-07-19','2027-08-15','2027-08-16','2027-09-14','2027-09-15','2027-09-16','2027-10-03','2027-10-04','2027-10-09','2027-10-11','2027-12-25','2027-12-27'
];

/* ---------- DB (Netlify Database = Postgres) ---------- */
let _db = null;
async function query(text, params = []) {
  if (globalThis.__TEST_DB__) return globalThis.__TEST_DB__.query(text, params);   // 로컬 시험용
  if (!_db) { const { getDatabase } = await import('@netlify/database'); _db = getDatabase(); }
  return _db.pool.query(text, params);
}
const all = async (t, p) => (await query(t, p)).rows;
const first = async (t, p) => (await query(t, p)).rows[0] || null;
const run = async (t, p) => { await query(t, p); };

const enc = s => new TextEncoder().encode(s);
const b64u = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = u8 => [...u8].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const fail = (error, status = 400) => json({ error }, status);

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseD(s)) === s;
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const todayKST = () => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const normPhone = s => {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('8210')) d = '0' + d.slice(2);
  return /^01\d{8,9}$/.test(d) ? d : null;
};
const intId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function calcDays(s, e, weekend, hol) {
  const a = parseD(s), b = parseD(e);
  if (b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const w = d.getDay();
    if (weekend || (w !== 0 && w !== 6 && !hol.has(ymd(d)))) n++;
  }
  return n;
}
const dutyMult = env => { const n = Number(env.DUTY_MULT); return n > 0 && n <= 5 ? n : 2; };   // 당직 1회(오후 출근~다음날 오전 퇴근) = 2일 차감

async function getHolidays() {
  const row = await first("SELECT svalue FROM settings WHERE skey='holidays'");
  if (row) { try { const a = JSON.parse(row.svalue); if (Array.isArray(a)) return a; } catch (e) {} }
  return DEFAULT_HOL;
}

/* ---------- 암호·세션 ---------- */
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(data))));
}
async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc(s))); }
async function safeEqual(a, b) {
  const A = await sha(a), B = await sha(b); let r = 0;
  for (let i = 0; i < A.length; i++) r |= A[i] ^ B[i];
  return r === 0;
}
async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256)));
}
const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const phoneHash = (env, digits) => hmac(env.PHONE_KEY, 'phone:' + digits);

async function makeToken(env, kind, id, ver, ttl) {
  const exp = Date.now() + ttl, base = `${kind}.${id}.${exp}.${ver}`;
  return base + '.' + await hmac(env.SESSION_SECRET, base);
}
async function readToken(env, req, cname, kind) {      // → {id, ver} | null
  if (!env.SESSION_SECRET) return null;
  const m = new RegExp('(?:^|;\\s*)' + cname + '=([^;]+)').exec(req.headers.get('Cookie') || '');
  if (!m) return null;
  const p = decodeURIComponent(m[1]).split('.');
  if (p.length !== 5 || p[0] !== kind || Number(p[2]) < Date.now()) return null;
  if (!(await safeEqual(p[4], await hmac(env.SESSION_SECRET, p.slice(0, 4).join('.'))))) return null;
  return { id: Number(p[1]), ver: p[3] };
}
const cookie = (name, v, maxAge) => `${name}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function getAdmin(req, env) {
  const t = await readToken(env, req, 'sid', 'a'); if (!t) return null;
  const a = await first('SELECT id,username,name,role,active,pw_ver FROM admins WHERE id=$1', [t.id]);
  return a && a.active && String(a.pw_ver) === t.ver ? a : null;
}
async function getWorker(req, env) {
  const t = await readToken(env, req, 'wid', 'w'); if (!t) return null;
  const e = await first('SELECT * FROM employees WHERE id=$1', [t.id]);
  return e && e.active && e.pw_hash && String(e.pw_ver) === t.ver ? e : null;
}
const pubAdmin = a => ({ id: a.id, username: a.username, name: a.name, role: a.role });
const pubWorker = e => ({ id: e.id, name: e.name, site: e.site, role: e.role, tail: e.phone_tail });

async function tooMany(kind, ip, max, windowMs) {
  const r = await first('SELECT COUNT(*)::int AS c FROM attempts WHERE kind=$1 AND ip=$2 AND ts>$3', [kind, ip, Date.now() - windowMs]);
  return (r?.c || 0) >= max;
}
async function recordAttempt(kind, ip) {
  await run('INSERT INTO attempts(kind,ip,ts) VALUES($1,$2,$3)', [kind, ip, Date.now()]);
  if (Math.random() < 0.05) await run('DELETE FROM attempts WHERE ts<$1', [Date.now() - 86400e3]);
}

function pwErrorAdmin(pw, username) {
  if (pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (pw.length > 100) return '비밀번호가 너무 깁니다.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return '비밀번호에 아이디를 포함할 수 없습니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 모두 포함하세요.';
  return null;
}
function pwErrorWorker(pw, digits) {
  if (pw.length < 6) return '비밀번호는 6자 이상이어야 합니다.';
  if (pw.length > 50) return '비밀번호가 너무 깁니다.';
  if (/^(.)\1+$/.test(pw)) return '같은 문자만 반복한 비밀번호는 사용할 수 없습니다.';
  const d = String(digits || '');
  if (d && (pw.includes(d) || pw.includes(d.slice(-4)) || pw.includes(d.slice(-8)))) return '전화번호가 들어간 비밀번호는 사용할 수 없습니다.';
  return null;
}

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))].map(x => A[x % A.length]).join('');
}
async function body(req) {
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) throw new Error('bad content-type');
  const t = await req.text();
  if (t.length > 400000) throw new Error('too large');
  return JSON.parse(t || '{}');
}

/* ---------- 근무자 ---------- */
async function findByIdentity(env, name, phone) {
  const digits = normPhone(phone), nk = norm(name);
  if (!digits || !nk) return { digits, nk, ph: null, emp: null };
  const ph = await phoneHash(env, digits);
  const emp = await first('SELECT * FROM employees WHERE phone_hash=$1 AND name_key=$2', [ph, nk]);
  return { digits, nk, ph, emp };
}
async function workerLogin(req, env, ip, setup) {
  if (!env.PHONE_KEY || !env.SESSION_SECRET) return fail('서버 설정(PHONE_KEY, SESSION_SECRET)이 비어 있습니다.', 500);
  const b = await body(req);
  const { digits, nk, ph, emp } = await findByIdentity(env, b.name, b.phone);
  if (!digits || !nk) return fail('이름과 전화번호를 정확히 입력하세요.');
  const ukey = ph.slice(0, 16);
  if ((await tooMany('wlogin', ip, 60, 15 * 60e3)) || (await tooMany('wloginu', ukey, 6, 15 * 60e3)))
    return fail('시도가 너무 많습니다. 15분 뒤 다시 시도하세요.', 429);
  const bad = async () => { await recordAttempt('wlogin', ip); await recordAttempt('wloginu', ukey); return fail('이름 또는 전화번호가 명단과 일치하지 않거나, 비밀번호가 올바르지 않습니다.', 401); };
  if (!emp || !emp.active) { await pbkdf2('x', '00'.repeat(16)); return bad(); }

  if (setup) {                                                         // 첫 가입: 비밀번호 설정
    if (emp.pw_hash) return fail('이미 가입된 계정입니다. 비밀번호로 로그인하세요. (비밀번호를 잊었다면 관리자에게 초기화를 요청하세요)', 409);
    const pw = String(b.password || ''); const pe = pwErrorWorker(pw, digits); if (pe) return fail(pe);
    const site = emp.site || String(b.site || '').trim().slice(0, 40), role = emp.role || b.role;
    if (!site) return fail('근무지를 입력하세요.');
    if (!ROLES.includes(role)) return fail('직무를 선택하세요.');
    const salt = newSalt();
    const done = await all('UPDATE employees SET pw_salt=$1, pw_hash=$2, site=$3, role=$4, last_login=$5 WHERE id=$6 AND pw_hash IS NULL RETURNING id',
      [salt, await pbkdf2(pw, salt), site, role, Date.now(), emp.id]);
    if (!done.length) return fail('이미 가입된 계정입니다.', 409);
    const e2 = { ...emp, site, role };
    return json({ ok: true, me: pubWorker(e2) }, 200, { 'Set-Cookie': cookie('wid', await makeToken(env, 'w', emp.id, emp.pw_ver, WORKER_TTL), WORKER_TTL / 1000) });
  }
  if (!emp.pw_hash) return json({ needSetup: true, name: emp.name, site: emp.site, role: emp.role });
  if (!b.password || !(await safeEqual(await pbkdf2(String(b.password), emp.pw_salt), emp.pw_hash))) return bad();
  await run('UPDATE employees SET last_login=$1 WHERE id=$2', [Date.now(), emp.id]);
  return json({ ok: true, me: pubWorker(emp) }, 200, { 'Set-Cookie': cookie('wid', await makeToken(env, 'w', emp.id, emp.pw_ver, WORKER_TTL), WORKER_TTL / 1000) });
}

async function balanceOf(e) {
  const r = await first(
    `SELECT COALESCE(SUM(CASE WHEN status='approved' THEN days END),0) AS ap,
            COALESCE(SUM(CASE WHEN status='pending' THEN days END),0) AS pe
     FROM requests WHERE employee_id=$1 AND type IN (${DEDUCT_SQL})`, [e.id]);
  const used = e.used_before || 0;
  return { total: e.total, used_before: used, ap: r.ap, pe: r.pe, rem: e.total == null ? null : e.total - used - r.ap - r.pe };
}

async function apply(req, env, w) {
  const b = await body(req);
  if (await tooMany('apply', String(w.id), 20, 3600e3)) return fail('짧은 시간에 너무 많이 신청했습니다. 잠시 후 다시 시도하세요.', 429);
  const role = w.role, type = b.type, T = TYPES[type];
  if (!w.site || !ROLES.includes(role)) return fail('근무지·직무 정보가 없습니다. 관리자에게 문의하세요.', 409);
  if (!T) return fail('휴가 종류를 확인하세요.');
  if (role === '당직경비' && T.half) return fail('당직경비는 반차를 신청할 수 없습니다. 연차로 신청하세요.');
  if (!validDate(b.start) || !validDate(b.end)) return fail('기간을 선택하세요.');
  const start = b.start, end = T.half ? b.start : b.end;
  if (end < start) return fail('종료일이 시작일보다 빠릅니다.');
  if ((parseD(end) - parseD(start)) / 86400000 > 366) return fail('기간이 너무 깁니다.');

  const hol = new Set(await getHolidays());
  const duty = role === '당직경비';                         // 당직경비: 토·일·공휴일 포함, 출근일 1회당 2일
  const days = T.half ? 0.5 : calcDays(start, end, duty, hol) * (duty ? dutyMult(env) : 1);
  if (!(days > 0)) return fail('선택한 기간이 모두 휴일입니다.');

  const reason = type === '경조사휴가' ? String(b.reason || '').trim().slice(0, 100) : '개인사정';
  if (!reason) return fail('경조사휴가는 사유를 직접 작성해야 합니다.');
  const sig = String(b.sig || '');
  if (!sig.startsWith('data:image/png;base64,') || sig.length < 400 || sig.length > 250000) return fail('서명을 확인하세요.');

  const dup = await first(
    "SELECT type,start_date,end_date FROM requests WHERE employee_id=$1 AND status IN ('pending','approved') AND start_date<=$2 AND end_date>=$3 LIMIT 1",
    [w.id, end, start]);
  if (dup) return fail(`이미 신청한 기간과 겹칩니다. (${dup.type} ${dup.start_date}~${dup.end_date})`, 409);

  if (T.d && w.total != null) {
    const bal = await balanceOf(w);
    if (days > bal.rem) return fail(`잔여 연차(${bal.rem}일)보다 많이 신청할 수 없습니다. 무급휴가 등은 관리자에게 문의하세요.`, 409);
  }
  await recordAttempt('apply', String(w.id));
  const id = newCode();
  await run(
    'INSERT INTO requests(id,employee_id,type,start_date,end_date,days,wk,reason,late,sig,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [id, w.id, type, start, end, days, duty ? 1 : 0, reason, start < todayKST() ? 1 : 0, sig, Date.now()]);
  return json({ ok: true, id, days });
}

async function workerRoutes(req, env, path, w) {
  if (path === '/worker/me') return json({ me: pubWorker(w), balance: await balanceOf(w) });
  if (path === '/worker/requests') {
    const rows = await all(
      'SELECT id,type,start_date,end_date,days,reason,status,note,cancel_req,cancel_denied,late,created_at FROM requests WHERE employee_id=$1 ORDER BY start_date DESC LIMIT 200', [w.id]);
    return json({ items: rows });
  }
  if (req.method !== 'POST') return fail('not found', 404);
  const b = await body(req);
  if (path === '/worker/password') {
    if (!(await safeEqual(await pbkdf2(String(b.current || ''), w.pw_salt), w.pw_hash))) return fail('현재 비밀번호가 올바르지 않습니다.', 403);
    const pe = pwErrorWorker(String(b.next || ''), ''); if (pe) return fail(pe);
    const salt = newSalt(), ver = w.pw_ver + 1;
    await run('UPDATE employees SET pw_salt=$1, pw_hash=$2, pw_ver=$3 WHERE id=$4', [salt, await pbkdf2(String(b.next), salt), ver, w.id]);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('wid', await makeToken(env, 'w', w.id, ver, WORKER_TTL), WORKER_TTL / 1000) });
  }
  const id = String(b.id || '').trim().toUpperCase();
  const r = await first('SELECT status FROM requests WHERE id=$1 AND employee_id=$2', [id, w.id]);   // 본인 건만
  if (!r) return fail('신청을 찾을 수 없습니다.', 404);
  if (path === '/withdraw') {
    if (r.status !== 'pending') return fail('승인 전(대기) 신청만 철회할 수 있습니다.', 409);
    await run('DELETE FROM requests WHERE id=$1 AND employee_id=$2', [id, w.id]);
  } else if (path === '/cancel-request') {
    if (r.status !== 'approved') return fail('승인된 신청만 취소를 요청할 수 있습니다.', 409);
    await run('UPDATE requests SET cancel_req=1, cancel_denied=0 WHERE id=$1 AND employee_id=$2', [id, w.id]);
  } else return fail('not found', 404);
  return json({ ok: true });
}

/* ---------- 관리자 ---------- */
async function rosterUpsert(env, rows, offset) {
  if (!env.PHONE_KEY) return fail('서버에 PHONE_KEY가 설정되지 않았습니다.', 500);
  if (!Array.isArray(rows) || rows.length > 300) return fail('한 번에 300행까지 올릴 수 있습니다.');
  const existing = new Set((await all('SELECT name_key, phone_hash FROM employees')).map(r => r.name_key + '|' + r.phone_hash));
  const good = [], skipped = []; let added = 0, updated = 0;
  const seen = new Set();
  const num = v => (v === '' || v == null || isNaN(Number(v)) || Number(v) < 0 || Number(v) > 366 || (Number(v) * 2) % 1) ? null : Number(v);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [], line = offset + i + 1;
    const name = String(r[0] ?? '').trim().slice(0, 30), digits = normPhone(r[1]);
    if (!name && !r[1]) continue;
    if (!name) { skipped.push({ row: line, reason: '이름 없음' }); continue; }
    if (!digits) { skipped.push({ row: line, name, reason: '전화번호 형식 오류' }); continue; }
    const site = String(r[2] ?? '').trim().slice(0, 40) || null;
    const role = ROLES.includes(String(r[3] ?? '').trim()) ? String(r[3]).trim() : null;
    const ph = await phoneHash(env, digits), key = norm(name) + '|' + ph;
    if (seen.has(key)) { skipped.push({ row: line, name, reason: '명단에 같은 이름·번호가 중복됨' }); continue; }
    seen.add(key);
    existing.has(key) ? updated++ : added++;
    good.push([name, norm(name), ph, digits.slice(-4), site, role, num(r[4]), num(r[5]), Date.now()]);
  }
  for (let i = 0; i < good.length; i += 100) {                          // 100명씩 한 번에 저장(한 문장 = 원자적)
    const chunk = good.slice(i, i + 100), params = [], tuples = [];
    chunk.forEach((g, k) => {
      const b = k * 9;
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::text,$${b + 6}::text,$${b + 7}::float8,$${b + 8}::float8,$${b + 9}::float8)`);
      params.push(...g);
    });
    await run(
      `INSERT INTO employees(name,name_key,phone_hash,phone_tail,site,role,total,used_before,created_at) VALUES ${tuples.join(',')}
       ON CONFLICT (name_key,phone_hash) DO UPDATE SET name=EXCLUDED.name, active=1,
         site=COALESCE(EXCLUDED.site, employees.site), role=COALESCE(EXCLUDED.role, employees.role),
         total=COALESCE(EXCLUDED.total, employees.total), used_before=COALESCE(EXCLUDED.used_before, employees.used_before)`, params);
  }
  return json({ ok: true, added, updated, skipped });
}

async function adminRoutes(req, env, url, path, ip) {
  if (path === '/admin/login' && req.method === 'POST') {
    if (!env.SESSION_SECRET) return fail('서버에 SESSION_SECRET이 설정되지 않았습니다.', 500);
    const b = await body(req);
    const username = String(b.username || '').trim().toLowerCase().slice(0, 30), password = String(b.password || '');
    if ((await tooMany('login', ip, 20, 15 * 60e3)) || (await tooMany('loginu', username, 5, 15 * 60e3)))
      return fail('로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요.', 429);
    const bad = async () => { await recordAttempt('login', ip); await recordAttempt('loginu', username); return fail('아이디 또는 비밀번호가 올바르지 않습니다.', 401); };
    let admin = await first('SELECT * FROM admins WHERE username=$1', [username]);
    if (!admin) {
      const cnt = (await first('SELECT COUNT(*)::int AS c FROM admins')).c;
      if (cnt === 0 && username === 'admin' && env.ADMIN_PASSWORD && await safeEqual(password, env.ADMIN_PASSWORD)) {
        const salt = newSalt();                                        // 최초 1회: 환경변수 비밀번호로 총괄 관리자 생성
        admin = await first("INSERT INTO admins(username,name,role,pw_salt,pw_hash,created_at) VALUES('admin','총괄 관리자','super',$1,$2,$3) RETURNING *",
          [salt, await pbkdf2(password, salt), Date.now()]);
      } else { await pbkdf2(password, '00'.repeat(16)); return bad(); }
    } else if (!admin.active || !(await safeEqual(await pbkdf2(password, admin.pw_salt), admin.pw_hash))) return bad();
    await run('UPDATE admins SET last_login=$1 WHERE id=$2', [Date.now(), admin.id]);
    return json({ ok: true, admin: pubAdmin(admin) }, 200, { 'Set-Cookie': cookie('sid', await makeToken(env, 'a', admin.id, admin.pw_ver, ADMIN_TTL), ADMIN_TTL / 1000) });
  }
  if (path === '/admin/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('sid', '', 0) });

  const me = await getAdmin(req, env);
  if (!me) return fail('로그인이 필요합니다.', 401);
  if (path === '/admin/me') return json({ ok: true, admin: pubAdmin(me) });

  if (path === '/admin/requests') {
    const rows = await all(
      `SELECT r.id,r.type,r.start_date,r.end_date,r.days,r.wk,r.reason,r.late,r.status,r.note,r.cancel_req,r.cancel_denied,r.created_at,r.decided_at,r.decided_by,
              e.id AS emp_id,e.name,e.site,e.role,e.phone_tail
       FROM requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 3000`);
    return json({ items: rows });
  }
  if (path === '/admin/sig') {
    const r = await first('SELECT sig FROM requests WHERE id=$1', [String(url.searchParams.get('id') || '').toUpperCase()]);
    return json({ sig: r?.sig || null });
  }
  if (path === '/admin/admins') {
    if (me.role !== 'super') return fail('총괄 관리자만 사용할 수 있습니다.', 403);
    const rows = await all('SELECT id,username,name,role,active,created_at,last_login FROM admins ORDER BY id');
    return json({ items: rows, max: MAX_ADMINS });
  }
  if (path === '/admin/employees') {
    const rows = await all(
      `SELECT e.id,e.name,e.site,e.role,e.phone_tail,e.total,COALESCE(e.used_before,0) AS used_before,e.active,e.last_login,
        CASE WHEN e.pw_hash IS NULL THEN 0 ELSE 1 END AS joined,
        COALESCE(SUM(CASE WHEN r.status='approved' AND r.type IN (${DEDUCT_SQL}) THEN r.days END),0) AS ap,
        COALESCE(SUM(CASE WHEN r.status='pending'  AND r.type IN (${DEDUCT_SQL}) THEN r.days END),0) AS pe
       FROM employees e LEFT JOIN requests r ON r.employee_id=e.id GROUP BY e.id ORDER BY e.name, e.phone_tail`);
    return json({ items: rows });
  }
  if (req.method !== 'POST') return fail('not found', 404);

  const b = await body(req);
  if (path === '/admin/password') {
    const row = await first('SELECT * FROM admins WHERE id=$1', [me.id]);
    const next = String(b.next || '');
    if (!(await safeEqual(await pbkdf2(String(b.current || ''), row.pw_salt), row.pw_hash))) return fail('현재 비밀번호가 올바르지 않습니다.', 403);
    const pe = pwErrorAdmin(next, row.username); if (pe) return fail(pe);
    const salt = newSalt(), ver = row.pw_ver + 1;
    await run('UPDATE admins SET pw_salt=$1, pw_hash=$2, pw_ver=$3 WHERE id=$4', [salt, await pbkdf2(next, salt), ver, me.id]);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('sid', await makeToken(env, 'a', me.id, ver, ADMIN_TTL), ADMIN_TTL / 1000) });
  }
  if (path === '/admin/admin-create' || path === '/admin/admin-update') {
    if (me.role !== 'super') return fail('총괄 관리자만 사용할 수 있습니다.', 403);
    if (path === '/admin/admin-create') {
      const username = String(b.username || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 20);
      const role = b.role === 'super' ? 'super' : 'admin', password = String(b.password || '');
      if (!/^[a-z0-9._-]{3,20}$/.test(username)) return fail('아이디는 영문 소문자·숫자·._- 3~20자로 입력하세요.');
      if (!name) return fail('이름을 입력하세요.');
      const pe = pwErrorAdmin(password, username); if (pe) return fail(pe);
      const cnt = (await first('SELECT COUNT(*)::int AS c FROM admins')).c;
      if (cnt >= MAX_ADMINS) return fail(`관리자 계정은 최대 ${MAX_ADMINS}개까지 만들 수 있습니다. 쓰지 않는 계정은 정지 상태로 남아 있어도 개수에 포함됩니다.`, 409);
      if (await first('SELECT 1 AS x FROM admins WHERE username=$1', [username])) return fail('이미 사용 중인 아이디입니다.', 409);
      const salt = newSalt();
      await run('INSERT INTO admins(username,name,role,pw_salt,pw_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)', [username, name, role, salt, await pbkdf2(password, salt), Date.now()]);
      return json({ ok: true });
    }
    const t = await first('SELECT * FROM admins WHERE id=$1', [intId(b.id)]);
    if (!t) return fail('계정을 찾을 수 없습니다.', 404);
    const sets = [], vals = [];
    const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (typeof b.name === 'string' && b.name.trim()) add('name', b.name.trim().slice(0, 20));
    const newRole = b.role === 'super' || b.role === 'admin' ? b.role : t.role;
    const newActive = typeof b.active === 'boolean' ? (b.active ? 1 : 0) : t.active;
    if ((newRole !== t.role || newActive !== t.active) && t.id === me.id) return fail('본인 계정의 권한·상태는 바꿀 수 없습니다.', 409);
    if ((newRole !== 'super' || !newActive) && t.role === 'super' && t.active) {
      const others = (await first("SELECT COUNT(*)::int AS c FROM admins WHERE role='super' AND active=1 AND id<>$1", [t.id])).c;
      if (!others) return fail('활성 총괄 관리자가 최소 1명은 있어야 합니다.', 409);
    }
    add('role', newRole); add('active', newActive);
    let bump = (newActive === 0 && t.active === 1);
    if (b.password) {
      const pe = pwErrorAdmin(String(b.password), t.username); if (pe) return fail(pe);
      const salt = newSalt(); add('pw_salt', salt); add('pw_hash', await pbkdf2(String(b.password), salt)); bump = true;
    }
    if (bump) add('pw_ver', t.pw_ver + 1);
    vals.push(t.id);
    await run(`UPDATE admins SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    return json({ ok: true });
  }

  if (path === '/admin/roster') return await rosterUpsert(env, b.rows, Number(b.offset) || 0);
  if (path === '/admin/employee') {                         // 부여 연차·근무지·직무 수정
    const id = intId(b.id); if (!id) return fail('근무자를 확인하세요.');
    const total = b.total === null || b.total === '' ? null : Number(b.total);
    const used = Number(b.used_before || 0);
    if ((total !== null && !(total >= 0 && total <= 366 && (total * 2) % 1 === 0)) || !(used >= 0 && used <= 366 && (used * 2) % 1 === 0)) return fail('0.5 단위의 올바른 숫자를 입력하세요.');
    const role = ROLES.includes(b.role) ? b.role : null, site = String(b.site || '').trim().slice(0, 40) || null;
    await run('UPDATE employees SET total=$1::float8, used_before=$2::float8, site=COALESCE($3::text,site), role=COALESCE($4::text,role) WHERE id=$5', [total, used, site, role, id]);
    return json({ ok: true });
  }
  if (path === '/admin/employee-reset') {                   // 비밀번호 초기화: 다시 "첫 로그인" 상태로, 기존 로그인 무효화
    const id = intId(b.id); if (!id) return fail('근무자를 확인하세요.');
    await run('UPDATE employees SET pw_salt=NULL, pw_hash=NULL, pw_ver=pw_ver+1 WHERE id=$1', [id]);
    return json({ ok: true });
  }
  if (path === '/admin/employee-active') {                  // 퇴사자 비활성/재사용
    const id = intId(b.id); if (!id) return fail('근무자를 확인하세요.');
    await run('UPDATE employees SET active=$1, pw_ver=pw_ver+1 WHERE id=$2', [b.active ? 1 : 0, id]);
    return json({ ok: true });
  }
  if (path === '/admin/employee-phone') {                   // 전화번호 변경(번호가 바뀐 근무자)
    const id = intId(b.id); if (!id) return fail('근무자를 확인하세요.');
    const digits = normPhone(b.phone); if (!digits) return fail('전화번호 형식을 확인하세요.');
    const ph = await phoneHash(env, digits), e = await first('SELECT name_key FROM employees WHERE id=$1', [id]);
    if (!e) return fail('근무자를 찾을 수 없습니다.', 404);
    if (await first('SELECT 1 AS x FROM employees WHERE name_key=$1 AND phone_hash=$2 AND id<>$3', [e.name_key, ph, id])) return fail('같은 이름·번호의 근무자가 이미 있습니다.', 409);
    await run('UPDATE employees SET phone_hash=$1, phone_tail=$2, pw_salt=NULL, pw_hash=NULL, pw_ver=pw_ver+1 WHERE id=$3', [ph, digits.slice(-4), id]);
    return json({ ok: true });
  }
  if (path === '/admin/holidays') {
    if (!Array.isArray(b.dates) || b.dates.length > 400 || !b.dates.every(validDate)) return fail('날짜 형식(YYYY-MM-DD)을 확인하세요.');
    const dates = [...new Set(b.dates)].sort();
    await run("INSERT INTO settings(skey,svalue) VALUES('holidays',$1) ON CONFLICT (skey) DO UPDATE SET svalue=EXCLUDED.svalue", [JSON.stringify(dates)]);
    return json({ ok: true });
  }
  if (path === '/admin/decide') {
    const id = String(b.id || '').toUpperCase(), note = String(b.note || '').slice(0, 200);
    const r = await first('SELECT status,cancel_req FROM requests WHERE id=$1', [id]);
    if (!r) return fail('신청을 찾을 수 없습니다.', 404);
    const now = Date.now(), act = b.action;
    if (act === 'approve' && ['pending', 'rejected'].includes(r.status))
      await run("UPDATE requests SET status='approved', note='', decided_at=$1, decided_by=$2, cancel_req=0, cancel_denied=0 WHERE id=$3", [now, me.name, id]);
    else if (act === 'reject' && ['pending', 'approved'].includes(r.status)) {
      if (!note) return fail('반려 사유를 입력하세요.');
      await run("UPDATE requests SET status='rejected', note=$1, decided_at=$2, decided_by=$3 WHERE id=$4", [note, now, me.name, id]);
    } else if (act === 'cancel' && r.status === 'approved')
      await run("UPDATE requests SET status='cancelled', note=$1, decided_at=$2, decided_by=$3 WHERE id=$4", [note || '취소 처리', now, me.name, id]);
    else if (act === 'deny_cancel' && r.status === 'approved' && r.cancel_req) {
      if (!note) return fail('반려 사유를 입력하세요.');
      await run('UPDATE requests SET cancel_denied=1, note=$1, decided_at=$2, decided_by=$3 WHERE id=$4', [note, now, me.name, id]);
    } else return fail('현재 상태에서는 처리할 수 없습니다. 화면을 새로고침하세요.', 409);
    return json({ ok: true });
  }
  return fail('not found', 404);
}

export async function handle(request, ip, env = process.env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  try {
    if (request.method === 'POST') {          // CSRF 보조: 같은 출처만 허용
      const o = request.headers.get('Origin');
      if (o && new URL(o).host !== url.host) return fail('forbidden', 403);
    }
    if (path === '/config' && request.method === 'GET')
      return json({ holidays: await getHolidays(), dutyMult: dutyMult(env) });
    if (path === '/session' && request.method === 'GET') {
      const a = await getAdmin(request, env); return json({ admin: a ? pubAdmin(a) : null });
    }
    if (path === '/worker/login' && request.method === 'POST') return await workerLogin(request, env, ip, false);
    if (path === '/worker/setup' && request.method === 'POST') return await workerLogin(request, env, ip, true);
    if (path === '/worker/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('wid', '', 0) });
    if (path.startsWith('/admin/')) return await adminRoutes(request, env, url, path, ip);

    const w = await getWorker(request, env);                 // 이하 근무자 로그인 필요
    if (!w) return fail('로그인이 필요합니다.', 401);
    if (path === '/apply' && request.method === 'POST') return await apply(request, env, w);
    if (path.startsWith('/worker/') || path === '/withdraw' || path === '/cancel-request') return await workerRoutes(request, env, path, w);
    return fail('not found', 404);
  } catch (e) {
    console.error('API error', path, e && (e.stack || e.message || e));
    return fail('요청을 처리하지 못했습니다.', e instanceof SyntaxError || e.message === 'bad content-type' || e.message === 'too large' ? 400 : 500);
  }
}

export default async (request, context) =>
  handle(request, context?.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown');

export const config = { path: '/api/*' };
