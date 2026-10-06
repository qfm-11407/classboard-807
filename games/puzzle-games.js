(() => {
  const $ = id => document.getElementById(id), rules = window.ClassroomPuzzles;
  const game = document.body.dataset.game, host = $('play-area'), overlay = $('overlay');
  const configs = {
    'spot-difference': { title:'眼明手快', accent:'#ffce83', subtitle:'觀察細節 · 找出不同', intro:'找出唯一不同的圖案。60 秒挑戰 10 題，只有 3 顆生命；選錯 3 次就結束！', help:'點選不同的圖案；選錯失去一顆生命，三顆用完即結束。', total:10 },
    'memory-match': { title:'記憶翻牌', accent:'#cfb4ff', subtitle:'翻開卡片 · 找到夥伴', intro:'每次翻開兩張卡片，找到相同圖案。起始 1000 分，每次配錯扣 45 分，每秒扣 2 分，完成後結算。', help:'相同即配對，不同稍後蓋回。結算：1000 分 − 每次配錯 45 分 − 每秒 2 分，最低 0 分。', total:1 },
    'balance-ball': { title:'平衡高手', accent:'#a8e5bd', subtitle:'觸控傾斜 · 穩穩前進', intro:'在平台上按住並拖曳，往哪個方向拖，小球就往那個方向滾。拖得越遠，傾斜越大；放開即煞車。避開黑洞，到旗子過關！', help:'平台上按住拖曳控球，放開即煞車；也可按方向按鈕或鍵盤。掉洞回起點，共 3 關。', total:3 },
    'light-maze': { title:'光線解謎', accent:'#9ad9ff', subtitle:'轉動鏡面 · 點亮星星', intro:'點擊鏡子切換斜面，觀察光線反射。讓光線從箭頭出發，照到星星！', help:'只有鏡子可以旋轉。光線碰到邊界就停止，照到星星即可過關，共 3 關。', total:3 },
    'bubble-connect': { title:'泡泡連線', accent:'#ffadcc', subtitle:'連起同色 · 完成配對', intro:'從有數字的泡泡出發，連到相同顏色與數字的泡泡。路線不能交叉，全部配對連好就過關！', help:'拖曳或逐格點選連線，全部配對連好即過關。點起點可重畫，走回原路可退回，共 3 關。', total:3 },
  };
  const config = configs[game];
  if (!config) return;
  const icons = ['🍓','🍋','🍇','🍒','🥝','🍉','🍍','🍊','🦋','🐳','🐢','🐙'];
  const colors = ['#ff8399','#70d9ff','#ffdb72','#b4a0ff','#85e9af'];
  let state = 'ready', level = 1, elapsed = 0, last = 0, frame = 0, round = 0, errors = 0, actions = 0;
  let memory, spot, light, flow, ball, tilt = null, hideAt = 0, wrongAt = 0, wrongButton = null, drag = null;
  const held = new Map(), keys = new Set();
  document.body.style.setProperty('--lime',config.accent);
  $('title').textContent = config.title;
  $('subtitle').textContent = config.subtitle;
  $('dialog-title').textContent = config.title;
  $('dialog-description').textContent = config.intro;
  $('help').textContent = config.help;
  document.title = `${config.title}｜互動遊戲室`;
  const modeKey = () => String(level);
  function announce(message) { $('announcement').textContent = message; }
  function stats() {
    const completed = game === 'memory-match' ? (memory?.matched.size || 0)/2 : game === 'bubble-connect' ? rules.flowProgress(flow?.paths || [],flow?.ends || [],flow?.n || 1).connected : round;
    const total = game === 'memory-match' ? (memory?.deck.length || [12,16,24][level-1])/2 : game === 'bubble-connect' ? flow?.ends.length || level+2 : config.total;
    $('progress').textContent = `${completed} / ${total}`;
    $('progress-label').textContent = ['memory-match','bubble-connect'].includes(game) ? '完成配對' : '完成題數';
    $('time').textContent = game === 'spot-difference' ? Math.max(0,Math.ceil(60-elapsed)) : Math.floor(elapsed);
    $('time-label').textContent = game === 'spot-difference' ? '剩餘時間' : '使用時間';
    if (game === 'spot-difference') {
      $('details').parentElement.querySelector('span').textContent = '剩餘生命';
      const lives = Math.max(0,3-errors);
      $('details').innerHTML = `<span class="life-icons" role="img" aria-label="剩餘 ${lives} 顆生命">${Array.from({length:3},(_,i) => `<span class="life-heart${i >= lives ? ' lost' : ''}" aria-hidden="true">♥</span>`).join('')}</span>`;
    } else $('details').textContent = `${game === 'memory-match' ? `配錯 ${errors} 次 · 翻牌 ${memory?.turns || 0} 回` : game === 'light-maze' ? `轉鏡 ${actions} 次` : game === 'bubble-connect' ? `第 ${Math.max(1,Math.min(round+(['between','finished'].includes(state) ? 0 : 1),3))} 關` : `失誤 ${errors} 次`}`;
    $('best').textContent = window.ClassroomGameScores.dailyBest(game,modeKey()) ?? '—';
  }
  function activate(button, action) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || state !== 'running') return;
      event.preventDefault(); event.stopPropagation(); advance(performance.now());
      if (state === 'running') action();
    });
    button.addEventListener('click', event => { if (event.detail === 0 && state === 'running') { advance(performance.now()); if (state === 'running') action(); } });
  }
  function cell(label, content, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'puzzle-cell';
    button.setAttribute('aria-label',label); button.innerHTML = content;
    if (action) activate(button,action);
    return button;
  }
  function grid(n, rows = n) {
    host.replaceChildren();
    const board = document.createElement('div'); board.className = 'puzzle-board'; board.style.setProperty('--columns',n); board.style.setProperty('--rows',rows);
    board.setAttribute('role','group'); board.setAttribute('aria-label',`${n} 欄 ${rows} 列遊戲棋盤`);
    host.append(board);
    fitBoard(board,n,rows);
    return board;
  }
  function fitBoard(board,n,rows) {
    const fit = () => { board.style.setProperty('--board-side',`${Math.max(0,Math.min(host.clientWidth-24,(host.clientHeight-24)*n/rows))}px`); };
    fit(); board._resize = new ResizeObserver(fit); board._resize.observe(host);
  }
  function clearBoard() {
    host.querySelectorAll('.puzzle-board').forEach(board => board._resize?.disconnect());
    clearControls(); drag = null; hideAt = 0; wrongButton = null;
    host.replaceChildren();
  }
  function renderMemory() {
    memory.buttons.forEach((button,index) => {
      const visible = memory.open.includes(index) || memory.matched.has(index);
      button.innerHTML = `<span aria-hidden="true">${visible ? icons[memory.deck[index]] : '✦'}</span>`;
      button.classList.toggle('revealed',visible); button.classList.toggle('matched',memory.matched.has(index));
      button.disabled = memory.matched.has(index);
      button.setAttribute('aria-label',`卡片 ${index+1}，${memory.matched.has(index) ? '已配對' : visible ? icons[memory.deck[index]] : '未翻開'}`);
    }); stats();
  }
  function buildMemory() {
    const pairs = [6,8,12][level-1], columns = level === 3 ? 6 : 4;
    const board = grid(columns,pairs*2/columns); board.classList.add('memory-board');
    memory = {deck:rules.memoryDeck(pairs), matched:new Set(), open:[], locked:false, turns:0};
    memory.buttons = memory.deck.map((_,index) => {
      const button = cell('', '', () => {
        const result = rules.memoryTurn(memory,index);
        if (result === 'mismatch') { errors++; hideAt = elapsed + .85; }
        renderMemory();
        if (result === 'complete') finish(true);
      }); board.append(button); return button;
    }); renderMemory();
  }
  function symbol(kind, odd) {
    const base = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
    const end = '</svg>';
    if (kind === 0) return `${base}<circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" stroke-width="8"/><circle cx="50" cy="${odd ? 38 : 50}" r="10" fill="currentColor"/>${end}`;
    if (kind === 1) {
      const petals = odd ? 5 : 6;
      return base + Array.from({length:petals},(_,i) => `<ellipse cx="50" cy="27" rx="11" ry="20" fill="currentColor" transform="rotate(${i*360/petals} 50 50)"/>`).join('') + '<circle cx="50" cy="50" r="12" fill="#192334"/>' + end;
    }
    if (kind === 2) return `${base}<path d="M50 15L85 80H15Z" fill="currentColor" transform="rotate(${odd ? 180 : 0} 50 50)"/>${end}`;
    if (kind === 3) return `${base}<ellipse cx="50" cy="50" rx="18" ry="35" fill="currentColor" transform="rotate(${odd ? -40 : 40} 50 50)"/><path d="M50 24V76" stroke="#192334" stroke-width="4" transform="rotate(${odd ? -40 : 40} 50 50)"/>${end}`;
    if (kind === 4) return `${base}<path d="M20 38H55V20L85 50L55 80V62H20Z" fill="currentColor" transform="rotate(${odd ? 180 : 0} 50 50)"/>${end}`;
    return `${base}<path d="M65 15A37 37 0 1 0 65 85A30 30 0 0 1 65 15Z" fill="currentColor" transform="rotate(${odd ? 180 : 0} 50 50)"/>${end}`;
  }
  function buildSpot() {
    const n = Math.min(6,level+2+Math.floor(round/4)), board = grid(n), odd = Math.floor(Math.random()*n*n), kind = round%6;
    board.classList.add('spot-board'); const question = spot = {odd,n,buttons:[]};
    for (let index = 0; index < n*n; index++) {
      const button = cell(`第 ${Math.floor(index/n)+1} 列第 ${index%n+1} 欄圖案`,symbol(kind,index===odd), () => {
        if (spot !== question) return;
        if (index === spot.odd) { round++; if (round === 10) finish(true); else { clearBoard(); buildSpot(); stats(); announce(`答對了，完成 ${round} 題！`); } }
        else { errors++; wrongButton?.classList.remove('wrong'); wrongButton = button; wrongAt = elapsed+.3; button.classList.add('wrong'); stats(); if (errors >= 3) finish(false,'lives'); else announce(`選錯了，剩餘 ${3-errors} 顆生命。再看仔細一點！`); }
      }); board.append(button); spot.buttons.push(button);
    }
  }
  function buildLight() {
    const layout = rules.lightLayouts[(round+level-1)%3], board = grid(layout.n); board.classList.add('light-board');
    const mirrors = Object.fromEntries(layout.mirrors.map(([index]) => [index,Math.random()<.5 ? '/' : '\\']));
    if (rules.traceLight(layout,mirrors).success) mirrors[layout.mirrors[0][0]] = mirrors[layout.mirrors[0][0]] === '/' ? '\\' : '/';
    light = {layout,mirrors,buttons:[],board};
    for (let index = 0; index < layout.n*layout.n; index++) {
      const button = cell('', '', mirrors[index] ? () => { actions++; mirrors[index] = mirrors[index] === '/' ? '\\' : '/'; renderLight(); if (rules.traceLight(layout,mirrors).success) stageComplete(); } : null);
      if (!mirrors[index]) { button.disabled = true; button.classList.add('empty-cell'); }
      board.append(button); light.buttons.push(button);
    }
    light.beam = document.createElementNS('http://www.w3.org/2000/svg','svg'); light.beam.classList.add('beam-layer'); light.beam.setAttribute('viewBox',`0 0 ${layout.n*100} ${layout.n*100}`); light.beam.setAttribute('aria-hidden','true'); board.append(light.beam);
    renderLight();
  }
  function renderLight() {
    const {layout,mirrors} = light;
    light.buttons.forEach((button,index) => {
      button.innerHTML = index === layout.source ? '<span class="source-mark" aria-hidden="true">➜</span>' : index === layout.goal ? '<span class="goal-mark" aria-hidden="true">★</span>' : mirrors[index] ? `<span class="mirror-mark" aria-hidden="true">${mirrors[index]}</span>` : '';
      button.setAttribute('aria-label',index === layout.source ? '光線起點' : index === layout.goal ? '星星目標' : mirrors[index] ? `鏡子 ${index+1}，${mirrors[index] === '/' ? '右斜' : '左斜'}，點擊旋轉` : '空格');
    });
    const trace = rules.traceLight(layout,mirrors);
    light.beam.innerHTML = `<polyline points="${trace.points.map(([x,y]) => `${x*100},${y*100}`).join(' ')}" fill="none" stroke="#ffde75" stroke-width="5" stroke-linejoin="round"/>`;
    $('stage-note').textContent = `第 ${round+1} 關 · ${layout.mirrors.length} 面鏡子 · 點鏡子改變方向`;
    stats();
  }
  function renderFlow() {
    const progress = rules.flowProgress(flow.paths,flow.ends,flow.n);
    flow.buttons.forEach((button,index) => {
      const endpoint = flow.ends.findIndex(pair => pair.includes(index)), pathGroup = flow.paths.findIndex(path => path.includes(index)), group = endpoint >= 0 ? endpoint : pathGroup;
      button.style.setProperty('--path-color', group < 0 ? 'transparent' : colors[group]);
      button.classList.toggle('on-path',pathGroup >= 0);
      button.innerHTML = endpoint >= 0 ? `<span class="flow-end" aria-hidden="true">${endpoint+1}</span>` : '';
      button.setAttribute('aria-label',`第 ${Math.floor(index/flow.n)+1} 列第 ${index%flow.n+1} 欄，${endpoint >= 0 ? `第 ${endpoint+1} 組泡泡` : pathGroup >= 0 ? `第 ${pathGroup+1} 組路線` : '空格'}`);
    });
    flow.lines.innerHTML = flow.paths.map((path,group) => `<polyline points="${path.map(index => `${(index%flow.n+.5)*100},${(Math.floor(index/flow.n)+.5)*100}`).join(' ')}" fill="none" stroke="${colors[group]}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    $('stage-note').textContent = `第 ${round+1} 關 · ${progress.connected}/${flow.ends.length} 組連好 · 全部連好就過關`;
    stats(); if (progress.success && state === 'running') stageComplete();
  }
  function beginFlow(index) {
    const endpoint = flow.ends.findIndex(pair => pair.includes(index));
    if (endpoint >= 0) { flow.paths[endpoint] = [index]; flow.group = endpoint; }
    else {
      const group = flow.paths.findIndex(path => path.includes(index));
      if (group >= 0) { flow.group = group; flow.paths[group] = flow.paths[group].slice(0,flow.paths[group].indexOf(index)+1); }
      else if (flow.group >= 0) rules.extendFlow(flow.paths,flow.ends,flow.group,index,flow.n);
    }
    renderFlow();
  }
  function moveFlow(index) {
    if (flow.group < 0) return;
    const path = flow.paths[flow.group], from = path.at(-1), n = flow.n;
    if (from === index) return;
    if (from%n !== index%n && Math.floor(from/n) !== Math.floor(index/n)) return;
    const step = from%n === index%n ? (index>from ? n : -n) : (index>from ? 1 : -1);
    for (let next = from+step; step>0 ? next<=index : next>=index; next+=step) if (!rules.extendFlow(flow.paths,flow.ends,flow.group,next,n)) break;
    renderFlow();
  }
  function tapFlow(index) {
    const path = flow.paths[flow.group];
    const extendable = path?.length && (path.length === 1 || !flow.ends[flow.group].includes(path.at(-1)));
    if (extendable && index !== path[0] && rules.adjacent(path.at(-1),index,flow.n) && (flow.ends[flow.group].includes(index) || !flow.ends.some(pair => pair.includes(index)))) moveFlow(index);
    else beginFlow(index);
  }
  function buildFlow() {
    const puzzle = rules.flowPuzzle(level+3,(round*2+Math.floor(Math.random()*2))%8), board = grid(puzzle.n); board.classList.add('flow-board');
    flow = {...puzzle,paths:puzzle.ends.map(() => []),group:-1,board,buttons:[]};
    const indexAt = event => {
      const rect = board.getBoundingClientRect(), x = Math.floor((event.clientX-rect.left)/rect.width*flow.n), y = Math.floor((event.clientY-rect.top)/rect.height*flow.n);
      return x < 0 || y < 0 || x >= flow.n || y >= flow.n ? -1 : y*flow.n+x;
    };
    for (let index = 0; index < puzzle.n*puzzle.n; index++) {
      const button = cell('', ''); button.addEventListener('click',event => {
        if (event.detail !== 0 || state !== 'running') return;
        tapFlow(index);
      }); board.append(button); flow.buttons.push(button);
    }
    flow.lines = document.createElementNS('http://www.w3.org/2000/svg','svg'); flow.lines.classList.add('flow-layer'); flow.lines.setAttribute('viewBox',`0 0 ${puzzle.n*100} ${puzzle.n*100}`); flow.lines.setAttribute('aria-hidden','true'); board.append(flow.lines);
    board.addEventListener('pointerdown',event => { if (state !== 'running' || event.button !== 0 || drag !== null) return; const index = indexAt(event); if (index < 0) return; event.preventDefault(); board.setPointerCapture(event.pointerId); drag = event.pointerId; actions++; tapFlow(index); });
    board.addEventListener('pointermove',event => { if (state !== 'running' || drag !== event.pointerId) return; const index = indexAt(event); if (index >= 0) moveFlow(index); });
    board.addEventListener('pointerup',event => { if (drag === event.pointerId) { board.releasePointerCapture(event.pointerId); drag = null; } });
    board.addEventListener('pointercancel',() => { drag = null; });
    renderFlow();
  }
  function control() {
    const pressed = new Set([...held.values(),...keys]);
    if (tilt) return {x:tilt.x,y:tilt.y,brake:pressed.has('brake')};
    const x = Number(pressed.has('right'))-Number(pressed.has('left')), y = Number(pressed.has('down'))-Number(pressed.has('up')), length = Math.max(1,Math.hypot(x,y));
    return {x:x/length,y:y/length,brake:pressed.has('brake') || (!x && !y)};
  }
  function clearControls() {
    held.clear(); keys.clear(); tilt = null;
    host.querySelectorAll('.pressed').forEach(button => button.classList.remove('pressed'));
    host.querySelectorAll('.tilt-stick').forEach(stick => { stick.hidden = true; });
  }
  function buildBalance() {
    host.replaceChildren(); const course = rules.balanceCourses[round]; ball = {...course.start,vx:0,vy:0};
    const arena = document.createElement('div'); arena.className = 'balance-arena';
    arena.setAttribute('aria-label','觸控平台，按住並拖曳控制傾斜，放開煞車');
    arena.innerHTML = `<svg id="balance-scene" viewBox="0 0 800 480" role="img" aria-label="平衡平台，避開黑洞，前往右上方旗子"><defs><radialGradient id="ball-fill" cx="30%" cy="25%"><stop stop-color="#fff"/><stop offset="1" stop-color="#65bddc"/></radialGradient></defs><rect x="5" y="5" width="790" height="470" rx="22" fill="#172e32" stroke="#85e9af66" stroke-width="8"/><path d="M50 60H750M50 140H750M50 220H750M50 300H750M50 380H750M140 40V440M260 40V440M380 40V440M500 40V440M620 40V440" stroke="#ffffff08"/>${course.walls.map(wall => `<rect x="${wall.x}" y="${wall.y}" width="${wall.w}" height="${wall.h}" rx="6" fill="#859b9d"/>`).join('')}${course.holes.map(hole => `<circle cx="${hole.x}" cy="${hole.y}" r="${19+level*2}" fill="#060d14" stroke="#ff839977" stroke-width="3"/>`).join('')}<circle cx="${course.goal.x}" cy="${course.goal.y}" r="30" fill="#85e9af22" stroke="#85e9af" stroke-width="3"/><text x="${course.goal.x}" y="${course.goal.y+8}" text-anchor="middle" font-size="25" fill="#85e9af">⚑</text><circle id="balance-ball" cx="${ball.x}" cy="${ball.y}" r="12" fill="url(#ball-fill)" stroke="#fff" stroke-width="2"/></svg>`;
    const stick = document.createElement('div'); stick.className = 'tilt-stick'; stick.hidden = true; stick.setAttribute('aria-hidden','true');
    const knob = document.createElement('div'); knob.className = 'tilt-knob'; stick.append(knob); arena.append(stick);
    const updateTilt = event => {
      const dx = event.clientX-tilt.startX, dy = event.clientY-tilt.startY, distance = Math.hypot(dx,dy), scale = Math.max(tilt.radius,distance);
      tilt.x = dx/scale; tilt.y = dy/scale;
      knob.style.transform = `translate(${tilt.x*32}px,${tilt.y*32}px)`;
    };
    arena.addEventListener('pointerdown',event => {
      if (state !== 'running' || event.button !== 0 || tilt) return;
      event.preventDefault(); arena.setPointerCapture(event.pointerId);
      const rect = arena.getBoundingClientRect();
      tilt = {pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,radius:Math.min(90,rect.width*.16),x:0,y:0};
      stick.style.left = `${event.clientX-rect.left}px`; stick.style.top = `${event.clientY-rect.top}px`; knob.style.transform = 'translate(0,0)'; stick.hidden = false;
    });
    arena.addEventListener('pointermove',event => { if (state === 'running' && tilt?.pointerId === event.pointerId) { event.preventDefault(); updateTilt(event); } });
    const releaseTilt = event => { if (tilt?.pointerId === event.pointerId) { tilt = null; stick.hidden = true; } };
    arena.addEventListener('pointerup',releaseTilt); arena.addEventListener('pointercancel',releaseTilt); arena.addEventListener('lostpointercapture',releaseTilt);
    const pad = document.createElement('div'); pad.className = 'balance-pad'; pad.setAttribute('role','group'); pad.setAttribute('aria-label','方向控制，按住傾斜，空白鍵煞車');
    for (const [action,label] of [['left','◀ 左'],['up','▲ 上'],['brake','煞車'],['down','▼ 下'],['right','右 ▶']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = label;
      button.addEventListener('pointerdown',event => { if (state !== 'running' || event.button !== 0) return; event.preventDefault(); button.setPointerCapture(event.pointerId); held.set(event.pointerId,action); button.classList.add('pressed'); });
      const release = event => { held.delete(event.pointerId); button.classList.remove('pressed'); };
      button.addEventListener('pointerup',release); button.addEventListener('pointercancel',release); button.addEventListener('lostpointercapture',release); pad.append(button);
    }
    host.append(arena,pad); $('stage-note').textContent = `第 ${round+1} 關 · 平台上按住拖曳控球 · 放開煞車`;
  }
  function buildRound() {
    clearBoard(); $('stage-note').textContent = '';
    if (game === 'memory-match') buildMemory(); else if (game === 'spot-difference') buildSpot(); else if (game === 'light-maze') buildLight(); else if (game === 'bubble-connect') buildFlow(); else buildBalance();
    stats();
  }
  function dialog(tag,title,description,button) {
    $('dialog-tag').textContent = tag; $('dialog-title').textContent = title; $('dialog-description').textContent = description; $('start').textContent = button;
    host.inert = true; overlay.hidden = false; $('start').focus({preventScroll:true});
    host.hidden = state === 'between' || state === 'finished'; $('stage-note').hidden = host.hidden;
  }
  function run() { state = 'running'; host.inert = false; host.hidden = false; $('stage-note').hidden = false; overlay.hidden = true; $('pause').disabled = false; $('pause').textContent = '暫停'; last = performance.now(); frame = requestAnimationFrame(tick); }
  function start() {
    cancelAnimationFrame(frame); level = Number(document.querySelector('input[name="difficulty"]:checked').value); elapsed = 0; round = 0; errors = 0; actions = 0;
    $('results').hidden = true; $('restart').hidden = true; $('difficulty-options').hidden = true; state = 'ready'; buildRound(); run(); announce('挑戰開始！');
  }
  function stageComplete() {
    round++; clearControls(); drag = null;
    if (round >= config.total) { finish(true); return; }
    state = 'between'; cancelAnimationFrame(frame); $('pause').disabled = true; $('restart').hidden = false; stats();
    dialog('NICELY DONE',`第 ${round} 關完成！`,'休息一下，再挑戰下一關。','下一關'); announce(`第 ${round} 關完成。`);
  }
  function finish(success,reason = 'time') {
    if (state !== 'running') return;
    state = 'finished'; cancelAnimationFrame(frame); clearControls(); drag = null;
    const score = Math.max(0,Math.round((game === 'spot-difference' ? round*100 : 1000) - elapsed*2 - errors*35 - (game === 'memory-match' ? Math.max(0,memory.turns-memory.deck.length/2)*10 : 0)));
    window.ClassroomGameScores.record(game,modeKey(),score);
    $('results').textContent = `${score} 分`; $('results').hidden = false; $('difficulty-options').hidden = false; $('restart').hidden = true; $('pause').disabled = true;
    const ending = success ? '挑戰完成' : reason === 'lives' ? '生命用完' : '時間到';
    dialog(success ? 'CHALLENGE COMPLETE' : reason === 'lives' ? 'OUT OF LIVES' : 'TIME IS UP',`${ending}！`,`使用 ${Math.floor(elapsed)} 秒，${game === 'spot-difference' ? `找到 ${round} 題` : game === 'memory-match' ? `翻牌 ${memory.turns} 回` : `完成 ${round} 關`}，失誤 ${errors} 次。`,'再玩一次');
    stats(); announce(`${ending}，${score} 分。`);
  }
  function advance(now) {
    if (state !== 'running') return;
    const dt = Math.max(0,(now-last)/1000); last = now; elapsed += dt;
    if (game === 'spot-difference' && elapsed >= 60) { elapsed = 60; finish(false); return; }
    if (hideAt && elapsed >= hideAt) { memory.open = []; memory.locked = false; hideAt = 0; renderMemory(); }
    if (wrongButton && elapsed >= wrongAt) { wrongButton.classList.remove('wrong'); wrongButton = null; }
    if (game === 'balance-ball') {
      const input = control(), result = rules.balanceStep(ball,rules.balanceCourses[round],input,Math.min(.1,dt),level);
      $('balance-scene').style.transform = `perspective(1000px) rotateX(${-input.y*3}deg) rotateY(${input.x*3}deg)`;
      $('balance-ball').setAttribute('cx',ball.x); $('balance-ball').setAttribute('cy',ball.y);
      if (result === 'fall') { errors++; announce('掉進洞裡，回到起點再試！'); }
      if (result === 'goal') { stageComplete(); return; }
    }
    stats();
  }
  function tick(now) { advance(now); if (state === 'running') frame = requestAnimationFrame(tick); }
  function pause() {
    if (state !== 'running') return; advance(performance.now()); if (state !== 'running') return;
    state = 'paused'; cancelAnimationFrame(frame); clearControls(); drag = null;
    $('pause').textContent = '繼續'; $('restart').hidden = false; $('difficulty-options').hidden = true;
    dialog('TAKE A BREATH','休息一下，再繼續。','時間、棋盤與小球都已暫停。','繼續挑戰'); announce('遊戲已暫停。');
  }
  function resume() { if (state === 'paused' && !document.hidden) run(); }
  $('start').addEventListener('click',() => { if (state === 'paused') resume(); else if (state === 'between') { buildRound(); run(); } else start(); });
  $('restart').addEventListener('click',start);
  $('pause').addEventListener('click',() => state === 'running' ? pause() : resume());
  $('reset-board').hidden = !['bubble-connect','balance-ball','light-maze'].includes(game);
  $('reset-board').addEventListener('click',() => { if (state !== 'running') return; actions++; buildRound(); announce('此關已重置。'); });
  document.querySelectorAll('input[name="difficulty"]').forEach(input => input.addEventListener('change',() => { if (!['ready','finished'].includes(state)) return; level = Number(input.value); stats(); }));
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  window.addEventListener('blur',clearControls);
  const keyActions = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',' ':'brake'};
  document.addEventListener('keydown',event => { if (event.key === 'Escape') pause(); if (game === 'balance-ball' && state === 'running' && keyActions[event.key]) { event.preventDefault(); keys.add(keyActions[event.key]); } });
  document.addEventListener('keyup',event => { if (keyActions[event.key]) keys.delete(keyActions[event.key]); });
  $('fullscreen').hidden = !document.fullscreenEnabled;
  $('fullscreen').addEventListener('click',async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('game').requestFullscreen(); } catch { announce('目前無法開啟全螢幕，仍可遊玩。'); } });
  document.addEventListener('fullscreenchange',() => { $('fullscreen').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; });
  if (new URLSearchParams(window.location.search).has('embedded') && window.parent !== window) {
    document.body.classList.add('embedded'); const back = document.querySelector('.back-link'); back.textContent = '← 互動區';
    back.addEventListener('click',event => { event.preventDefault(); pause(); window.parent.postMessage({type:'classroom-interaction-back'},window.location.protocol === 'file:' ? '*' : window.location.origin); });
    window.addEventListener('message',event => { if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'classroom-game-pause') pause(); });
  }
  window.ClassroomGameScores.attach({trigger:$('open-score-rank'),game,mode:modeKey,title:config.title,modeLabel:() => ['簡易','正常','挑戰'][level-1],beforeOpen:pause,onChange:() => { $('best').textContent = window.ClassroomGameScores.dailyBest(game,modeKey()) ?? '—'; }});
  stats();
})();
