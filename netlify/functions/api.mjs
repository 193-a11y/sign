// Netlify Function — /api/*  (Node 22, Netlify Database = Postgres)
// 근무자는 로그인 없이 학교 선택 + 이름·연락처 입력 + 서명으로 신청, 관리자만 로그인.
// 환경변수(필수): ADMIN_PASSWORD(최초 총괄 계정 생성용), SESSION_SECRET
// 선택: DUTY_MULT(당직경비 차감 배수, 기본 2)

const ROLES = ['당직경비', '미화', '시설관리'];
const TYPES = {
  '연차': {},
  '오전반차': { half: 1 },
  '오후반차': { half: 1 },
  '무급휴가': {},
  '경조사휴가': {},
};
const MAX_ADMINS = 10;
const ADMIN_TTL = 12 * 3600e3;
const PBKDF2_ITER = 210000;

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
const todayKST = () => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const normPhone = s => {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2);
  return /^0\d{8,10}$/.test(d) ? d : null;
};
const intId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

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

/* ---------- 암호·세션(관리자) ---------- */
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
const pubAdmin = a => ({ id: a.id, username: a.username, name: a.name, role: a.role });

async function tooMany(kind, key, max, windowMs) {
  const r = await first('SELECT COUNT(*)::int AS c FROM attempts WHERE kind=$1 AND ip=$2 AND ts>$3', [kind, key, Date.now() - windowMs]);
  return (r?.c || 0) >= max;
}
async function recordAttempt(kind, key) {
  await run('INSERT INTO attempts(kind,ip,ts) VALUES($1,$2,$3)', [kind, key, Date.now()]);
  if (Math.random() < 0.05) await run('DELETE FROM attempts WHERE ts<$1', [Date.now() - 86400e3]);
}

function pwErrorAdmin(pw, username) {
  if (pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (pw.length > 100) return '비밀번호가 너무 깁니다.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return '비밀번호에 아이디를 포함할 수 없습니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 모두 포함하세요.';
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

/* ---------- 근무자(로그인 없음) ---------- */
async function activeSchools() {
  return (await all('SELECT name FROM schools WHERE active=1 ORDER BY name')).map(r => r.name);
}

async function apply(req, env, ip) {
  const b = await body(req);
  if (b.website) return json({ ok: true, id: 'XXXXXXXX', days: 0 });          // 봇 함정 칸(사람은 비워둠)
  const school = clean(b.school, 80), name = clean(b.name, 30), phone = normPhone(b.phone);
  const job = b.job, type = b.type, T = TYPES[type];
  if (!school || !(await first('SELECT 1 AS x FROM schools WHERE name=$1 AND active=1', [school]))) return fail('목록에서 근무지를 선택해 주세요.');
  if (name.length < 2) return fail('성함을 입력해 주세요.');
  if (!phone) return fail('연락처를 확인해 주세요. 예: 010-1234-5678');
  if (!ROLES.includes(job)) return fail('직종을 선택해 주세요.');
  if (!T) return fail('휴가 종류를 확인해 주세요.');
  if (job === '당직경비' && T.half) return fail('당직경비는 반차를 신청할 수 없습니다. 연차로 신청해 주세요.');
  if (!validDate(b.start) || !validDate(b.end)) return fail('기간을 선택해 주세요.');
  const start = b.start, end = T.half ? b.start : b.end;
  if (end < start) return fail('종료일이 시작일보다 빠릅니다.');
  if ((parseD(end) - parseD(start)) / 86400000 > 366) return fail('기간이 너무 깁니다.');

  if ((await tooMany('apply', ip, 60, 3600e3)) || (await tooMany('applyp', phone, 10, 3600e3)))
    return fail('짧은 시간에 너무 많이 신청했습니다. 잠시 후 다시 시도해 주세요.', 429);

  const hol = new Set(await getHolidays());
  const duty = job === '당직경비';                         // 당직경비: 토·일·공휴일 포함, 출근일 1회당 2일
  // 당직경비는 격일 근무: 시작일부터 이틀 간격이 출근일, 마지막 출근일의 다음 날 아침이 퇴근. 출근 1회 = 2일.
  const shifts = duty ? Math.floor(Math.round((parseD(end) - parseD(start)) / 86400000) / 2) + 1 : 0;
  const lastShift = duty ? (() => { const d = parseD(start); d.setDate(d.getDate() + 2 * (shifts - 1)); return ymd(d); })() : end;
  const days = T.half ? 0.5 : duty ? shifts * dutyMult(env) : calcDays(start, end, false, hol);
  if (!(days > 0)) return fail('선택한 기간이 모두 휴일입니다.');

  const reason = type === '경조사휴가' ? clean(b.reason, 100) : '개인사정';
  if (!reason) return fail('경조사휴가는 사유를 직접 작성해야 합니다.');
  const notes = clean(b.notes, 120);
  const sig = String(b.sig || '');
  if (!sig.startsWith('data:image/png;base64,') || sig.length < 400 || sig.length > 250000) return fail('서명을 확인해 주세요.');

  // 당직경비: 입력한 기간은 "출근일"이고, 신청서에는 마지막 출근일의 다음 날(퇴근일)까지 자동으로 잡는다.
  const endStored = duty ? (() => { const d = parseD(lastShift); d.setDate(d.getDate() + 1); return ymd(d); })() : end;
  const dup = await first(
    `SELECT type,start_date,end_date FROM requests
     WHERE name=$1 AND phone=$2 AND status IN ('pending','approved') AND start_date<=$3
       AND (CASE WHEN job='당직경비' THEN to_char(end_date::date - 1,'YYYY-MM-DD') ELSE end_date END)>=$4 LIMIT 1`,
    [name, phone, lastShift, start]);
  if (dup) return fail(`이미 신청한 기간과 겹칩니다. (${dup.type} ${dup.start_date}~${dup.end_date})`, 409);

  await recordAttempt('apply', ip); await recordAttempt('applyp', phone);
  const id = newCode();
  await run(
    `INSERT INTO requests(id,school,name,phone,job,type,start_date,end_date,days,wk,reason,notes,late,sig,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, school, name, phone, job, type, start, endStored, days, duty ? 1 : 0, reason, notes, start < todayKST() ? 1 : 0, sig, Date.now()]);
  return json({ ok: true, id, days });
}

/* ---------- 관리자 ---------- */
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
      `SELECT id,school,name,phone,job,type,start_date,end_date,days,wk,reason,notes,late,status,note,created_at,decided_at,decided_by
       FROM requests ORDER BY created_at DESC LIMIT 5000`);
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
  if (path === '/admin/schools') {
    const rows = await all(
      `SELECT s.id,s.name,s.active,COUNT(r.id)::int AS n FROM schools s LEFT JOIN requests r ON r.school=s.name GROUP BY s.id ORDER BY s.name`);
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

  if (path === '/admin/schools-add') {                       // 학교 목록 추가(이미 있으면 다시 사용으로)
    const names = [...new Set((Array.isArray(b.names) ? b.names : []).map(x => clean(x, 80)).filter(Boolean))];
    if (!names.length) return fail('추가할 학교 이름이 없습니다.');
    if (names.length > 2000) return fail('한 번에 2000개까지 추가할 수 있습니다.');
    const before = (await first('SELECT COUNT(*)::int AS c FROM schools')).c;
    for (let i = 0; i < names.length; i += 200) {
      const chunk = names.slice(i, i + 200), params = [Date.now()];
      const tuples = chunk.map((n, k) => { params.push(n); return `($${k + 2},1,$1)`; });
      await run(`INSERT INTO schools(name,active,created_at) VALUES ${tuples.join(',')} ON CONFLICT (name) DO UPDATE SET active=1`, params);
    }
    const after = (await first('SELECT COUNT(*)::int AS c FROM schools')).c;
    return json({ ok: true, added: after - before, total: names.length });
  }
  if (path === '/admin/school-update') {                     // 이름 변경 / 숨김(사용 안 함) / 다시 사용
    const s = await first('SELECT * FROM schools WHERE id=$1', [intId(b.id)]);
    if (!s) return fail('근무지를 찾을 수 없습니다.', 404);
    if (typeof b.name === 'string' && clean(b.name, 80) && clean(b.name, 80) !== s.name) {
      const nn = clean(b.name, 80);
      if (await first('SELECT 1 AS x FROM schools WHERE name=$1', [nn])) return fail('이미 있는 근무지 이름입니다.', 409);
      await run('UPDATE schools SET name=$1 WHERE id=$2', [nn, s.id]);
      await run('UPDATE requests SET school=$1 WHERE school=$2', [nn, s.name]);        // 기존 신청서 표기도 함께 변경
    }
    if (typeof b.active === 'boolean') await run('UPDATE schools SET active=$1 WHERE id=$2', [b.active ? 1 : 0, s.id]);
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
    const r = await first('SELECT status FROM requests WHERE id=$1', [id]);
    if (!r) return fail('신청을 찾을 수 없습니다.', 404);
    const now = Date.now(), act = b.action;
    if (act === 'approve' && ['pending', 'rejected'].includes(r.status))
      await run("UPDATE requests SET status='approved', note='', decided_at=$1, decided_by=$2 WHERE id=$3", [now, me.name, id]);
    else if (act === 'reject' && ['pending', 'approved'].includes(r.status)) {
      if (!note) return fail('반려 사유를 입력하세요.');
      await run("UPDATE requests SET status='rejected', note=$1, decided_at=$2, decided_by=$3 WHERE id=$4", [note, now, me.name, id]);
    } else if (act === 'cancel' && r.status === 'approved')
      await run("UPDATE requests SET status='cancelled', note=$1, decided_at=$2, decided_by=$3 WHERE id=$4", [note || '취소 처리', now, me.name, id]);
    else if (act === 'delete')                                   // 잘못 들어온 신청 삭제(근무자는 직접 철회 불가)
      await run('DELETE FROM requests WHERE id=$1', [id]);
    else return fail('현재 상태에서는 처리할 수 없습니다. 화면을 새로고침하세요.', 409);
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
      return json({ holidays: await getHolidays(), dutyMult: dutyMult(env), schools: await activeSchools() });
    if (path === '/session' && request.method === 'GET') {
      const a = await getAdmin(request, env); return json({ admin: a ? pubAdmin(a) : null });
    }
    if (path === '/apply' && request.method === 'POST') return await apply(request, env, ip);
    if (path.startsWith('/admin/')) return await adminRoutes(request, env, url, path, ip);
    return fail('not found', 404);
  } catch (e) {
    console.error('API error', path, e && (e.stack || e.message || e));
    return fail('요청을 처리하지 못했습니다.', e instanceof SyntaxError || e.message === 'bad content-type' || e.message === 'too large' ? 400 : 500);
  }
}

export default async (request, context) =>
  handle(request, context?.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown');

export const config = { path: '/api/*' };
