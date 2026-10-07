// Pure puzzle and physics rules shared by the browser games and validation.
(() => {
  const adjacent = (a, b, n) => Math.abs(a % n - b % n) + Math.abs(Math.floor(a / n) - Math.floor(b / n)) === 1;
  function shuffle(items, rng = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function memoryDeck(pairs, rng = Math.random) { return shuffle(Array.from({length:pairs * 2}, (_, i) => i % pairs), rng); }
  function memoryTurn(state, index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.deck.length || state.locked || state.matched.has(index) || state.open.includes(index)) return 'ignored';
    state.open.push(index);
    if (state.open.length < 2) return 'first';
    state.turns++;
    const [a, b] = state.open;
    if (state.deck[a] === state.deck[b]) {
      state.matched.add(a); state.matched.add(b); state.open = [];
      return state.matched.size === state.deck.length ? 'complete' : 'match';
    }
    state.locked = true;
    return 'mismatch';
  }
  const lightLayouts = [
    { n:6, source:24, goal:35, mirrors:[[26,'/'],[8,'/'],[10,'\\'],[34,'\\']] },
    { n:6, source:6, goal:5, mirrors:[[8,'\\'],[26,'\\'],[28,'/'],[4,'/']] },
    { n:6, source:18, goal:11, mirrors:[[19,'\\'],[31,'\\'],[34,'/'],[10,'/']] },
    { n:7, source:35, goal:3, mirrors:[[37,'/'],[9,'/'],[12,'\\'],[33,'/'],[31,'\\']] },
    { n:7, source:7, goal:45, mirrors:[[9,'\\'],[37,'\\'],[40,'/'],[19,'\\'],[17,'/']] },
    { n:7, source:7, goal:48, mirrors:[[10,'\\'],[38,'\\'],[40,'/'],[19,'/'],[20,'\\']] },
    { n:8, source:48, goal:23, mirrors:[[50,'/'],[10,'/'],[14,'\\'],[38,'/'],[35,'\\'],[19,'/']] },
    { n:8, source:8, goal:47, mirrors:[[10,'\\'],[50,'\\'],[54,'/'],[30,'\\'],[27,'/'],[43,'\\']] },
    { n:8, source:16, goal:39, mirrors:[[20,'\\'],[52,'/'],[49,'\\'],[9,'/'],[13,'\\'],[37,'\\']] },
  ];
  function traceLight(layout, mirrors) {
    const {n, source, goal} = layout;
    let x = source % n, y = Math.floor(source / n), dx = 1, dy = 0;
    const points = [[x + .5, y + .5]], visited = new Set();
    for (let step = 0; step < n * n * 4; step++) {
      const key = `${x},${y},${dx},${dy}`;
      if (visited.has(key)) return {points, success:false, loop:true};
      visited.add(key);
      x += dx; y += dy;
      points.push([x + .5, y + .5]);
      if (x < 0 || y < 0 || x >= n || y >= n) return {points, success:false, loop:false};
      const index = y * n + x;
      if (index === goal) return {points, success:true, loop:false};
      if (mirrors[index] === '/') [dx,dy] = [-dy,-dx];
      else if (mirrors[index] === '\\') [dx,dy] = [dy,dx];
    }
    return {points, success:false, loop:true};
  }
  function flowPuzzle(n, variant = 0) {
    const snake = [];
    for (let y = 0; y < n; y++) for (let j = 0; j < n; j++) {
      let x = y % 2 ? n - 1 - j : j, row = y;
      for (let turn = 0; turn < variant % 4; turn++) [x,row] = [n - 1 - row,x];
      if (variant >= 4) x = n - 1 - x;
      snake.push(row * n + x);
    }
    const lengths = {4:[5,6,5],5:[6,7,6,6],6:[7,6,9,7,7],7:[8,9,7,8,9,8]}[n];
    if (!lengths) throw new RangeError('Unsupported bubble grid size');
    let cursor = 0;
    const solution = lengths.map(length => { const path = snake.slice(cursor,cursor + length); cursor += length; return path; });
    return { n, ends:solution.map(path => [path[0],path.at(-1)]), solution };
  }
  function extendFlow(paths, ends, group, index, n) {
    const path = paths[group];
    if (!path?.length || !Number.isInteger(index) || index < 0 || index >= n*n) return false;
    if (path.at(-1) === index) return true;
    const previous = path.indexOf(index);
    if (previous >= 0) { paths[group] = path.slice(0, previous + 1); return true; }
    if (ends[group].includes(path.at(-1)) && path.length > 1) return false;
    if (!adjacent(path.at(-1),index,n)) return false;
    if (ends.some((pair,i) => i !== group && pair.includes(index)) || paths.some((other,i) => i !== group && other.includes(index))) return false;
    path.push(index);
    return true;
  }
  function flowProgress(paths, ends, n) {
    const connected = paths.filter((path,i) => path.length > 1 && ends[i].includes(path[0]) && ends[i].includes(path.at(-1)) && path[0] !== path.at(-1)).length;
    const filled = new Set(paths.flat()).size;
    return {connected, filled, success:ends.length > 0 && connected === ends.length};
  }
  const balanceCourses = [
    { start:{x:65,y:405}, goal:{x:735,y:70}, walls:[{x:200,y:260,w:330,h:22}], holes:[{x:120,y:160},{x:590,y:370},{x:420,y:125}] },
    { start:{x:65,y:405}, goal:{x:735,y:70}, walls:[{x:240,y:170,w:22,h:210},{x:450,y:105,w:22,h:210}], holes:[{x:365,y:395},{x:660,y:190},{x:105,y:200},{x:580,y:390}] },
    { start:{x:65,y:405}, goal:{x:735,y:70}, walls:[{x:170,y:270,w:230,h:22},{x:425,y:140,w:230,h:22}], holes:[{x:120,y:120},{x:495,y:350},{x:690,y:275},{x:330,y:190},{x:600,y:65}] },
  ];
  function balanceStep(ball, course, control, seconds, difficulty = 1) {
    const radius = 12, holeRadius = 19 + difficulty * 2, steps = Math.max(1,Math.ceil(seconds / (1/120))), dt = seconds / steps;
    const reset = () => Object.assign(ball,{...course.start,vx:0,vy:0});
    for (let step = 0; step < steps; step++) {
      const drag = Math.exp(-(control.brake ? 9 : 1.2) * dt), acceleration = 240 + difficulty * 45;
      ball.vx = (ball.vx + control.x * acceleration * dt) * drag;
      ball.vy = (ball.vy + control.y * acceleration * dt) * drag;
      const speed = Math.hypot(ball.vx,ball.vy), cap = 135 + difficulty * 20;
      if (speed > cap) { ball.vx *= cap/speed; ball.vy *= cap/speed; }
      for (const axis of ['x','y']) {
        ball[axis] += ball[axis === 'x' ? 'vx' : 'vy'] * dt;
        const limit = axis === 'x' ? 800 : 480;
        if (ball[axis] < radius || ball[axis] > limit - radius) {
          ball[axis] = Math.max(radius,Math.min(limit-radius,ball[axis]));
          ball[axis === 'x' ? 'vx' : 'vy'] *= -.35;
        }
        for (const wall of course.walls) {
          if (ball.x + radius <= wall.x || ball.x - radius >= wall.x + wall.w || ball.y + radius <= wall.y || ball.y - radius >= wall.y + wall.h) continue;
          if (axis === 'x') { ball.x = ball.vx > 0 ? wall.x - radius : wall.x + wall.w + radius; ball.vx *= -.3; }
          else { ball.y = ball.vy > 0 ? wall.y - radius : wall.y + wall.h + radius; ball.vy *= -.3; }
        }
      }
      if (course.holes.some(hole => Math.hypot(ball.x-hole.x,ball.y-hole.y) < holeRadius - 3)) { reset(); return 'fall'; }
      if (Math.hypot(ball.x-course.goal.x,ball.y-course.goal.y) < 27) return 'goal';
    }
    return 'moving';
  }
  globalThis.ClassroomPuzzles = { adjacent, shuffle, memoryDeck, memoryTurn, lightLayouts, traceLight, flowPuzzle, extendFlow, flowProgress, balanceCourses, balanceStep };
})();
