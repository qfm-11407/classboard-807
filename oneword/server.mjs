import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { questions } from './questions.mjs';
import { judgeCharacter } from './ai.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const id = (n = 18) => randomBytes(n).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const han = value => typeof value === 'string' && /^\p{Script=Han}$/u.test(value.normalize('NFC'));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createArena(options = {}) {
  const dataDir = options.dataDir || path.join(ROOT, '.local');
  const teacherPin = options.teacherPin || process.env.ARENA_TEACHER_PIN || id(4).toUpperCase();
  const settings = { key: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', concurrency: 3 };
  const rooms = new Map(), sessions = new Set(), clients = new Map(), loginAttempts = new Map();
  const queue = [];
  let running = 0, activeRoom = '', saveTimer, saveChain = Promise.resolve(), stopping = false;
  const timers = new Map();
  const transport = options.judge || judgeCharacter;
  await mkdir(dataDir, { recursive: true });
  try {
    const stored = JSON.parse(await readFile(path.join(dataDir, 'matches.json'), 'utf8'));
    for (const room of stored.rooms || []) {
      for (const player of room.players) player.studentId ||= String(player.seat).padStart(2, '0');
      for (const round of room.rounds) {
        if (round.phase === 'writing') round.phase = 'closed';
        for (const sub of Object.values(round.submissions)) if (['queued', 'judging'].includes(sub.status)) { sub.status = 'error'; sub.error = '服務重新啟動，請重新判讀'; }
      }
      rooms.set(room.code, room);
    }
    activeRoom = rooms.has(stored.activeRoom) ? stored.activeRoom : '';
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('比賽紀錄無法讀取；請先備份 .local/matches.json 並檢查內容。'); }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { flush().catch(() => {}); }, 100); }
  function flush() {
    const data = JSON.stringify({ activeRoom, rooms: [...rooms.values()] });
    saveChain = saveChain.catch(() => {}).then(async () => {
      await writeFile(path.join(dataDir, 'matches.tmp'), data, { mode: 0o600 });
      await rename(path.join(dataDir, 'matches.tmp'), path.join(dataDir, 'matches.json'));
    });
    return saveChain;
  }
  const current = room => room.rounds.at(-1) || null;
  function publicState(room) {
    const round = current(room), shown = round && round.phase !== 'writing', revealed = round?.phase === 'revealed';
    const rows = room.players.map(player => {
      const sub = round?.submissions[player.id];
      const score = room.rounds.filter(r => r.phase === 'revealed' && r.submissions[player.id]?.correct === true).length * room.points;
      return { id: player.id, studentId: player.studentId, name: player.name, score, submitted: Boolean(sub),
        status: !sub ? 'waiting' : revealed ? sub.status : 'submitted',
        imageUrl: shown && sub ? `/api/image/${room.code}/${round.id}/${player.id}` : null,
        correct: revealed && sub?.status === 'done' ? sub.correct : null };
    });
    return { code: room.code, title: room.title, mode: room.mode, points: room.points, serverTime: Date.now(), players: rows,
      round: round ? { id: round.id, number: room.rounds.length, prompt: round.prompt, phase: round.phase, deadline: round.deadline, seconds: round.seconds,
        answer: revealed ? round.answer : null, submitted: rows.filter(p => p.submitted).length } : null };
  }
  function adminState(room) {
    const state = publicState(room), round = current(room);
    return { ...state, round: round ? { ...state.round, answer: round.answer, accepted: round.accepted,
      judged: Object.values(round.submissions).filter(s => s.status === 'done').length,
      pending: Object.values(round.submissions).filter(s => ['queued', 'judging'].includes(s.status)).length,
      unresolved: Object.values(round.submissions).filter(s => ['error', 'uncertain'].includes(s.status)).length } : null,
      players: state.players.map(player => { const sub = round?.submissions[player.id]; return { ...player, judgeStatus: sub?.status || 'waiting', error: sub?.error || '' }; }) };
  }
  function broadcast(room) {
    save(); const message = `data: ${JSON.stringify(publicState(room))}\n\n`;
    for (const res of clients.get(room.code) || []) res.write(message);
  }
  function closeRound(room) {
    const round = current(room);
    if (round?.phase === 'writing') { round.phase = 'closed'; clearTimeout(timers.get(room.code)); timers.delete(room.code); broadcast(room); }
  }
  const getRoom = code => { const room = rooms.get(String(code || '').toUpperCase()); if (!room) throw fail(404, '找不到房間，請確認房號'); return room; };
  function schedule(room, round, sub) {
    if (['queued', 'judging'].includes(sub.status) || stopping) return;
    sub.status = 'queued'; sub.error = ''; sub.correct = null;
    queue.push({ room, round, sub }); broadcast(room); pump();
  }
  async function runJob({ room, round, sub }) {
    sub.status = 'judging'; broadcast(room); const config = { ...settings };
    try {
      if (room.mode === 'practice') {
        await pause(options.practiceDelay ?? 700);
        // Intentionally NOT recognition. All practice screens explicitly say so.
        sub.correct = room.players.find(p => p.id === sub.playerId).seat % 3 !== 0; sub.status = 'done';
      } else {
        if (!config.key) throw new Error('尚未設定 API 金鑰');
        for (let attempt = 0; attempt < 2; attempt++) {
          let result;
          try { result = await transport({ image: sub.image, answer: round.answer, accepted: round.accepted, model: config.model, key: config.key }); }
          catch (error) { if (attempt === 0 && error.retryable) { await pause(1500); continue; } throw error; }
          room.usage.input += result.usage?.input || 0; room.usage.output += result.usage?.output || 0; room.usage.calls++;
          sub.correct = result.correct;
          if (result.correct !== null) { sub.status = 'done'; break; }
        }
        if (sub.correct === null) sub.status = 'uncertain';
      }
    } catch (error) { sub.status = 'error'; sub.error = error.name === 'TimeoutError' ? 'AI 連線逾時，請重新判讀' : error.message; }
    broadcast(room);
  }
  function pump() {
    while (queue.length && running < settings.concurrency && !stopping) {
      running++; runJob(queue.shift()).finally(() => { running--; pump(); });
    }
  }
  function requireAdmin(req) {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('arena_teacher='))?.slice(14);
    if (!token || !sessions.has(token)) throw fail(401, '請先輸入教師登入碼');
  }
  function requirePlayer(req, room) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const player = room.players.find(p => equal(p.token, token));
    if (!player) throw fail(401, '作答身分失效，請重新加入房間'); return player;
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, '請使用 JSON 傳送資料');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 450000) throw fail(413, '圖片過大，請重新作答'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, '資料格式錯誤'); }
  }
  function json(res, value, status = 200, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); }
  function validateImage(image) {
    if (typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > 400000) throw fail(400, '請送出有效的 PNG 手寫圖片');
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR') throw fail(400, '手寫圖片格式不正確');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width < 64 || height < 64 || width > 1024 || height > 1024) throw fail(400, '手寫圖片尺寸不正確');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'), pathname = url.pathname;
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, '不接受跨網站操作');
      if (req.method === 'GET' && pathname === '/api/health') return json(res, { ok: true });
      if (req.method === 'POST' && pathname === '/api/login') {
        const remote = req.socket.remoteAddress, record = loginAttempts.get(remote) || { count: 0, since: Date.now() };
        if (Date.now() - record.since > 60000) { record.count = 0; record.since = Date.now(); }
        record.count++; loginAttempts.set(remote, record);
        if (record.count > 12) throw fail(429, '嘗試次數過多，請一分鐘後再試');
        const data = await body(req);
        if (!equal(String(data.pin || '').trim(), teacherPin)) throw fail(401, '教師登入碼不正確');
        const token = id(24); sessions.add(token);
        return json(res, { ok: true }, 200, { 'Set-Cookie': `arena_teacher=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
      }
      if (pathname.startsWith('/api/admin/')) {
        requireAdmin(req);
        if (req.method === 'GET' && pathname === '/api/admin/state') {
          const room = url.searchParams.get('room') ? getRoom(url.searchParams.get('room')) : rooms.get(activeRoom);
          return json(res, { settings: { configured: Boolean(settings.key), model: settings.model, concurrency: settings.concurrency }, addresses: networkAddresses(server.address().port), questions,
            room: room ? { ...adminState(room), usage: room.usage } : null });
        }
        if (req.method === 'POST' && pathname === '/api/admin/settings') {
          if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw fail(403, '請在教師電腦以 localhost 開啟設定頁');
          if (running || queue.length) throw fail(409, '請等待背景判讀完成後再變更設定');
          const data = await body(req);
          if (data.key && (typeof data.key !== 'string' || !/^sk-[\w-]{10,300}$/.test(data.key.trim()))) throw fail(400, 'API 金鑰格式不正確');
          if (typeof data.model !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(data.model)) throw fail(400, '模型名稱格式不正確');
          if (!Number.isInteger(data.concurrency) || data.concurrency < 1 || data.concurrency > 6) throw fail(400, '同時判讀數須為 1～6');
          if (data.key) settings.key = data.key.trim(); settings.model = data.model; settings.concurrency = data.concurrency;
          return json(res, { ok: true, configured: Boolean(settings.key) });
        }
        if (req.method === 'POST' && pathname === '/api/admin/rooms') {
          if (queue.length || running) throw fail(409, '請等待目前判讀完成再建立新比賽');
          if (rooms.size >= 30) throw fail(409, '已保留 30 場比賽，請備份並整理本機紀錄後再建立');
          const data = await body(req);
          if (!['live', 'practice'].includes(data.mode)) throw fail(400, '請選擇比賽模式');
          if (data.mode === 'live' && !settings.key) throw fail(400, '請先設定 API 金鑰，或選擇流程演練');
          let code; do { code = id(3).toUpperCase(); } while (rooms.has(code));
          const room = { code, title: String(data.title || '單字擂台').trim().slice(0, 40), mode: data.mode, points: 10, players: [], rounds: [], usage: { input: 0, output: 0, calls: 0 } };
          if (activeRoom && rooms.has(activeRoom)) closeRound(rooms.get(activeRoom));
          rooms.set(code, room); activeRoom = code; save(); return json(res, { room: adminState(room) }, 201);
        }
        const match = pathname.match(/^\/api\/admin\/rooms\/([A-F0-9]{6})\/(start|close|reveal|retry|export)$/);
        if (match) {
          const room = getRoom(match[1]), action = match[2];
          if (action === 'export' && req.method === 'GET') {
            const lines = ['題次,學號,暱稱,模式,判定,得分'];
            const csv = value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
            for (const [i, round] of room.rounds.entries()) if (round.phase === 'revealed') for (const player of room.players) {
              const sub = round.submissions[player.id];
              lines.push([i + 1, csv(player.studentId), csv(player.name), room.mode === 'live' ? 'AI' : '流程演練', !sub ? '未交卷' : sub.status !== 'done' ? '無法判定' : sub.correct ? '對' : '錯', sub?.correct === true ? room.points : 0].join(','));
            }
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="word-arena-${room.code}.csv"`, 'Cache-Control': 'no-store' }); return res.end('\uFEFF' + lines.join('\r\n'));
          }
          if (req.method !== 'POST') throw fail(405, '操作方式不正確');
          const round = current(room);
          if (action === 'start') {
            const data = await body(req);
            if (round && round.phase !== 'revealed') throw fail(409, '請先截止並揭曉目前題目');
            if (!room.players.length) throw fail(409, '請至少一位參賽者加入後再開始');
            if (room.rounds.length >= 100) throw fail(409, '本場已達 100 題，請建立新比賽');
            if (!han(data.answer) || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 240) throw fail(400, '請輸入題目與一個正確國字');
            const accepted = data.accepted || [];
            if (!Array.isArray(accepted) || accepted.length > 8 || !accepted.every(han)) throw fail(400, '每個允許字形都必須是一個國字');
            if (!Number.isInteger(data.seconds) || data.seconds < 10 || data.seconds > 180) throw fail(400, '作答時間須為 10～180 秒');
            const next = { id: id(8), prompt: data.prompt.trim(), answer: data.answer.normalize('NFC'), accepted, seconds: data.seconds, deadline: Date.now() + data.seconds * 1000, phase: 'writing', submissions: {} };
            room.rounds.push(next); timers.set(room.code, setTimeout(() => closeRound(room), data.seconds * 1000)); broadcast(room);
          } else if (action === 'close') closeRound(room);
          else if (action === 'reveal') {
            if (!round || round.phase === 'writing') throw fail(409, '請先截止作答，再揭曉結果');
            if (Object.values(round.submissions).some(s => ['queued', 'judging'].includes(s.status))) throw fail(409, 'AI 尚在判讀，完成後即可揭曉');
            round.phase = 'revealed'; broadcast(room);
          } else if (action === 'retry') {
            if (!round || round.phase === 'revealed') throw fail(409, '已揭曉的結果不再重複判讀');
            for (const sub of Object.values(round.submissions)) if (['error', 'uncertain'].includes(sub.status)) schedule(room, round, sub);
          }
          return json(res, { room: adminState(room) });
        }
        throw fail(404, '找不到操作');
      }
      if (req.method === 'GET' && pathname === '/api/room') return json(res, publicState(getRoom(url.searchParams.get('room'))));
      if (req.method === 'GET' && pathname === '/api/events') {
        const room = getRoom(url.searchParams.get('room'));
        if ((clients.get(room.code)?.size || 0) >= 150) throw fail(429, '連線已滿，請關閉多餘頁面');
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(publicState(room))}\n\n`);
        if (!clients.has(room.code)) clients.set(room.code, new Set()); clients.get(room.code).add(res);
        req.on('close', () => clients.get(room.code)?.delete(res)); return;
      }
      if (req.method === 'POST' && pathname === '/api/join') {
        const data = await body(req), room = getRoom(data.room);
        const restored = room.players.find(p => equal(p.token, data.token));
        if (restored) return json(res, { player: { id: restored.id, studentId: restored.studentId, name: restored.name }, token: restored.token });
        if (current(room) && current(room).phase !== 'revealed') throw fail(409, '本題已開始，請等揭曉後再加入');
        if (typeof data.studentId !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(data.studentId.trim())) throw fail(400, '學號請輸入 1～20 位英數字');
        const studentId = data.studentId.trim();
        if (room.players.some(p => p.studentId.toUpperCase() === studentId.toUpperCase())) throw fail(409, '這個學號已加入；原裝置重新整理可恢復');
        if (room.players.length >= 60) throw fail(409, '本場已滿 60 人');
        const player = { id: id(8), token: id(24), seat: room.players.length + 1, studentId, name: String(data.name || '').trim().slice(0, 12) || '' };
        room.players.push(player); room.players.sort((a, b) => a.studentId.localeCompare(b.studentId, 'en', { numeric: true }) || a.studentId.localeCompare(b.studentId)); broadcast(room);
        return json(res, { player: { id: player.id, studentId: player.studentId, name: player.name }, token: player.token }, 201);
      }
      if (req.method === 'POST' && pathname === '/api/submit') {
        const data = await body(req), room = getRoom(data.room), player = requirePlayer(req, room), round = current(room);
        if (!round || round.id !== data.roundId) throw fail(409, '題目已更換，請重新載入');
        if (round.submissions[player.id]) return json(res, { ok: true, duplicate: true });
        if (round.phase !== 'writing' || Date.now() >= round.deadline) { closeRound(room); throw fail(409, '本題已截止，無法再交卷'); }
        validateImage(data.image);
        const sub = { playerId: player.id, image: data.image, correct: null, status: 'new', submittedAt: Date.now(), error: '' };
        round.submissions[player.id] = sub; schedule(room, round, sub); return json(res, { ok: true }, 201);
      }
      const imageMatch = pathname.match(/^\/api\/image\/([A-F0-9]{6})\/([a-f0-9]{16})\/([a-f0-9]{16})$/);
      if (req.method === 'GET' && imageMatch) {
        const room = getRoom(imageMatch[1]), round = room.rounds.find(r => r.id === imageMatch[2]);
        if (!round || round.phase === 'writing') throw fail(403, '截止前不公開答案圖片');
        const sub = round.submissions[imageMatch[3]];
        if (!sub) throw fail(404, '沒有交卷圖片');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' }); return res.end(Buffer.from(sub.image.split(',')[1], 'base64'));
      }
      if (req.method === 'GET') {
        const routes = { '/': 'index.html', '/teacher': 'teacher.html', '/play': 'play.html', '/screen': 'screen.html', '/style.css': 'style.css', '/app.js': 'app.js', '/canvas.js': 'canvas.js' };
        const file = routes[pathname];
        if (file) { const contents = await readFile(path.join(ROOT, 'public', file)); res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(contents); }
      }
      throw fail(404, '找不到頁面');
    } catch (error) { if (!res.headersSent) json(res, { error: error.status ? error.message : '伺服器暫時無法完成操作' }, error.status || 500); else res.end(); }
  });
  const heartbeat = setInterval(() => { for (const group of clients.values()) for (const res of group) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
  return { server, teacherPin, async shutdown() {
    stopping = true; clearInterval(heartbeat); clearTimeout(saveTimer);
    for (const timer of timers.values()) clearTimeout(timer);
    for (const group of clients.values()) for (const res of group) res.end();
    await flush(); await new Promise(resolve => server.close(resolve));
  } };
}
export function networkAddresses(port) {
  return Object.values(os.networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal).map(item => `http://${item.address}:${port}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createArena(), port = Number(process.env.PORT || 4178);
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the previous arena or choose another PORT.` : error.message); process.exitCode = 1; });
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`\nWORD ARENA | 單字擂台\n教師台：http://localhost:${port}/teacher\n教師登入碼：${app.teacherPin}\n平板連線：${networkAddresses(port).map(base => `${base}/play`).join('\n          ')}\n\nKeep this window open. Press Ctrl+C to stop.\n`);
    if (process.argv.includes('--open') && process.platform === 'win32') spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process 'http://localhost:${port}/teacher#access=${app.teacherPin}'`], { windowsHide: true, stdio: 'ignore' }).unref();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.shutdown(); process.exit(); });
}
