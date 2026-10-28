import { CatNoiseModel, relativeVolume } from './noise-cat-engine.js?v=1';

const host = document.getElementById('class-tool-noise-cat-panel');
if (host) {
  host.innerHTML = `
    <section class="noise-cat" data-state="sleeping" data-running="false" aria-label="不要打擾小貓睡覺">
      <div class="nc-scene">
        <div class="nc-scene-top"><span class="nc-eyebrow">一起守護教室的安靜時光</span><button type="button" class="nc-expand" aria-label="全螢幕顯示小貓">⛶ 放大</button></div>
        <h3>噓⋯不要吵醒小貓</h3>
        <p class="nc-subtitle">把聲音放輕一點，讓牠做個好夢。</p>
        <div class="nc-art" aria-hidden="true">
          <svg viewBox="0 0 760 410" role="presentation">
            <defs>
              <radialGradient id="nc-glow"><stop stop-color="#e0d6ff" stop-opacity=".22"/><stop offset="1" stop-color="#b6a3e7" stop-opacity="0"/></radialGradient>
              <radialGradient id="nc-fur" cx="34%" cy="22%" r="80%"><stop stop-color="#fff2d8"/><stop offset=".38" stop-color="#ffdbad"/><stop offset=".75" stop-color="#eab17b"/><stop offset="1" stop-color="#bb784d"/></radialGradient>
              <radialGradient id="nc-face" cx="35%" cy="25%" r="78%"><stop stop-color="#fff5df"/><stop offset=".48" stop-color="#ffdfb7"/><stop offset=".82" stop-color="#efbb87"/><stop offset="1" stop-color="#c78b5e"/></radialGradient>
              <radialGradient id="nc-paw" cx="40%" cy="20%" r="85%"><stop stop-color="#fff5df"/><stop offset=".6" stop-color="#ffe0bb"/><stop offset="1" stop-color="#cb946b"/></radialGradient>
              <linearGradient id="nc-tail" x1="0" y1="0" x2=".5" y2="1"><stop stop-color="#ffe4bb"/><stop offset=".45" stop-color="#eabd88"/><stop offset="1" stop-color="#b9774d"/></linearGradient>
              <radialGradient id="nc-muzzle"><stop stop-color="#fff8e9"/><stop offset="1" stop-color="#ffe4c5" stop-opacity=".15"/></radialGradient>
              <filter id="nc-soft-shadow" x="-30%" y="-40%" width="160%" height="190%"><feDropShadow dx="2" dy="9" stdDeviation="7" flood-color="#56321e" flood-opacity=".27"/></filter>
              <filter id="nc-ground-soft" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
              <radialGradient id="nc-cushion" cx="40%" cy="15%" r="95%"><stop stop-color="#e2d5f5"/><stop offset=".45" stop-color="#bca9dd"/><stop offset="1" stop-color="#756090"/></radialGradient>
            </defs>
            <ellipse cx="385" cy="200" rx="310" ry="220" fill="url(#nc-glow)"/>
            <g fill="#e9dcb8"><path d="M110 62a35 35 0 0 0 43 44 37 37 0 1 1-43-44"/><path d="m211 101 3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path d="m621 78 3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><circle cx="581" cy="137" r="3"/><circle cx="177" cy="189" r="3"/><circle cx="647" cy="189" r="2"/></g>
            <ellipse cx="386" cy="358" rx="229" ry="23" fill="#171126" opacity=".4" filter="url(#nc-ground-soft)"/>
            <rect x="160" y="294" width="450" height="64" rx="32" fill="url(#nc-cushion)"/>
            <path d="M183 319q202 35 403 0" fill="none" stroke="#e9dfff" stroke-width="3" opacity=".4"/>
            <g class="nc-cat-body">
              <ellipse cx="414" cy="317" rx="153" ry="15" fill="#513751" opacity=".22" filter="url(#nc-ground-soft)"/>
              <ellipse cx="414" cy="259" rx="142" ry="72" fill="url(#nc-fur)" filter="url(#nc-soft-shadow)"/>
              <path d="M510 243c98-24 103 69 24 65-33-2-52-13-77-9" fill="none" stroke="url(#nc-tail)" stroke-width="36" stroke-linecap="round"/>
              <path d="M546 246q19 8 20 25M550 291l-17 13" fill="none" stroke="#b77b4e" stroke-width="13" stroke-linecap="round"/>
              <path d="m386 196 9 23m26-27 5 24m26-22 1 23" stroke="#d0925e" stroke-width="12" stroke-linecap="round"/>
              <g class="nc-head" filter="url(#nc-soft-shadow)">
                <path d="m230 226-7-84q1-14 13-5l59 42 49-37q15-10 17 7l7 81" fill="url(#nc-face)" stroke="#e5ad77" stroke-width="4" stroke-linejoin="round"/>
                <path d="m236 161 4 44 35-19zm106 2-32 24 39 19z" fill="#e7a19b"/>
                <ellipse cx="296" cy="242" rx="89" ry="69" fill="url(#nc-face)"/>
                <path d="M229 226c8-26 30-40 53-43" fill="none" stroke="#fff7df" stroke-width="5" stroke-linecap="round" opacity=".5"/>
                <ellipse cx="296" cy="265" rx="44" ry="27" fill="url(#nc-muzzle)"/>
                <path d="m281 179 5 20m14-23 0 21m16-17-6 19" stroke="#cb8c57" stroke-width="8" stroke-linecap="round"/>
                <ellipse cx="247" cy="260" rx="16" ry="9" fill="#e6a395" opacity=".6"/><ellipse cx="345" cy="260" rx="16" ry="9" fill="#e6a395" opacity=".6"/>
                <g class="nc-eyes-closed" fill="none" stroke="#694739" stroke-width="5" stroke-linecap="round"><path d="M246 242q13 13 26 0m49 0q13 13 26 0"/></g>
                <g class="nc-eyes-warning" fill="none" stroke="#694739" stroke-width="5" stroke-linecap="round"><path d="M246 244q13 12 26 0m49 2q13-12 26 0"/></g>
                <g class="nc-eyes-awake"><ellipse cx="259" cy="243" rx="13" ry="17" fill="#654a41"/><ellipse cx="334" cy="243" rx="13" ry="17" fill="#654a41"/><circle cx="263" cy="237" r="4" fill="#fff"/><circle cx="338" cy="237" r="4" fill="#fff"/></g>
                <path d="m289 260 14 0-7 7z" fill="#bc7b75"/><path d="M296 268v4m0 0q-8 9-15 0m15 0q8 9 15 0" fill="none" stroke="#885c49" stroke-width="3" stroke-linecap="round"/>
                <g stroke="#b68163" stroke-width="2.5" stroke-linecap="round"><path d="m218 254-27-5m28 15-29 4m170-14 28-5m-29 15 29 4"/></g>
              </g>
              <ellipse cx="300" cy="307" rx="39" ry="16" fill="url(#nc-paw)" filter="url(#nc-soft-shadow)"/><ellipse cx="365" cy="309" rx="35" ry="14" fill="url(#nc-paw)" filter="url(#nc-soft-shadow)"/>
              <path d="m289 307v9m12-8v10m53-9v11m12-11v11" stroke="#dfb28d" stroke-width="2.5" stroke-linecap="round"/>
            </g>
            <g class="nc-zzz" fill="#ded5f3" font-family="sans-serif" font-weight="700"><text x="406" y="145" font-size="30">z</text><text x="448" y="107" font-size="41">z</text><text x="503" y="62" font-size="52">z</text></g>
            <g class="nc-alert" fill="#ffe1b8" font-size="57" font-weight="700"><text x="402" y="158">!</text><text x="445" y="124">!</text></g>
          </svg>
        </div>
        <div class="nc-message" role="status" aria-live="polite">小貓準備睡覺了</div>
        <p class="nc-caption">按下開始，和全班一起練習輕聲說話。</p>
        <div class="nc-stats"><div><span>連續安靜</span><strong id="nc-quiet">00:00</strong></div><div><span>最長安靜</span><strong id="nc-best">00:00</strong></div><div><span>小貓醒來</span><strong><span id="nc-wakes">0</span><small> 次</small></strong></div></div>
      </div>
      <aside class="nc-controls" aria-label="音量偵測設定">
        <div class="nc-control-heading"><span class="nc-dot"></span><span class="nc-connection" role="status">麥克風尚未開啟</span></div>
        <div class="nc-volume-heading"><label for="nc-meter">目前音量</label><strong><span id="nc-level">0</span><small> / 100</small></strong></div>
        <div class="nc-meter-wrap"><div id="nc-meter" class="nc-meter" role="meter" aria-label="目前相對音量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="nc-meter-fill"></div></div><span class="nc-threshold-mark" aria-hidden="true"></span></div>
        <div class="nc-meter-labels"><span>輕聲</span><span>太大聲</span></div>
        <div class="nc-setting"><label for="nc-threshold">吵醒門檻 <output id="nc-threshold-value" for="nc-threshold">52</output></label><input id="nc-threshold" type="range" min="20" max="90" value="52"><div class="nc-meter-labels"><span>較敏感</span><span>較寬鬆</span></div></div>
        <div class="nc-presets" aria-label="課堂情境"><button type="button" data-threshold="38">安靜自習</button><button type="button" data-threshold="52" aria-pressed="true">一般課堂</button><button type="button" data-threshold="68">分組討論</button></div>
        <button type="button" class="nc-calibrate" disabled>◎ 校準教室背景音</button>
        <p class="nc-error" role="alert" hidden></p>
        <button type="button" class="nc-start">開始守護小貓</button>
        <button type="button" class="nc-reset">重新計算紀錄</button>
        <p class="nc-note">音量持續過大才會吵醒小貓，安靜一會兒就會再睡著。</p>
        <p class="nc-privacy">只即時分析音量，不錄音、不上傳。<br>數值為相對音量，會隨裝置不同。</p>
      </aside>
    </section>`;

  const root = host.querySelector('.noise-cat');
  const $ = selector => root.querySelector(selector);
  const model = new CatNoiseModel();
  let stream = null, context = null, source = null, analyser = null, samples = null;
  let animation = 0, generation = 0, pending = false, running = false, lastTime = 0;
  let calibration = null;
  const messages = {
    sleeping: ['小貓睡得好香', '謝謝你的輕聲細語，牠正在做美夢。'],
    warning: ['噓⋯小貓動了一下', '聲音再小一點，就不會吵醒牠囉。'],
    awake: ['喵？小貓醒來了', '一起安靜一下，陪牠慢慢睡回去。'],
  };
  const formatTime = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  function render() {
    const state = model.state;
    root.dataset.state = state;
    $('#nc-level').textContent = Math.round(model.level);
    $('#nc-meter').setAttribute('aria-valuenow', String(Math.round(model.level)));
    root.style.setProperty('--nc-volume', `${model.level}%`);
    $('#nc-quiet').textContent = formatTime(model.quietMs);
    $('#nc-best').textContent = formatTime(model.bestQuietMs);
    $('#nc-wakes').textContent = model.wakeCount;
    if (running) {
      const [message, caption] = messages[state];
      if ($('.nc-message').textContent !== message) $('.nc-message').textContent = message;
      $('.nc-caption').textContent = caption;
    }
  }

  function showError(message) {
    $('.nc-error').textContent = message;
    $('.nc-error').hidden = !message;
  }

  function setThreshold(value, persist = true) {
    model.threshold = Math.max(20, Math.min(90, Number(value) || 52));
    $('#nc-threshold').value = model.threshold;
    $('#nc-threshold-value').textContent = model.threshold;
    root.style.setProperty('--nc-threshold', `${model.threshold}%`);
    root.querySelectorAll('[data-threshold]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.threshold) === model.threshold)));
    model.warningMs = model.loudMs = model.calmMs = 0;
    if (persist) { try { localStorage.setItem('classroomNoiseCatThreshold', String(model.threshold)); } catch {} }
  }

  function stop(message = '偵測已暫停，麥克風已關閉') {
    const wasActive = running || pending;
    generation++;
    running = pending = false;
    cancelAnimationFrame(animation);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    source?.disconnect();
    source = analyser = samples = null;
    if (context && context.state !== 'closed') context.close().catch(() => {});
    context = null;
    calibration = null;
    root.dataset.running = 'false';
    $('.nc-start').disabled = false;
    $('.nc-start').textContent = wasActive ? '繼續守護小貓' : $('.nc-start').textContent;
    $('.nc-calibrate').disabled = true;
    $('.nc-calibrate').textContent = '◎ 校準教室背景音';
    model.pause();
    render();
    if (wasActive) {
      $('.nc-connection').textContent = message;
      $('.nc-message').textContent = '小貓休息中';
      $('.nc-caption').textContent = '準備好了，再一起守護牠的好夢。';
    }
  }

  function tick(time) {
    if (!running) return;
    // A long interruption must not count as continuous quiet or loudness.
    if (time - lastTime > 1000) { model.pause(); calibration = null; $('.nc-calibrate').disabled = false; $('.nc-calibrate').textContent = '◎ 校準教室背景音'; }
    analyser.getFloatTimeDomainData(samples);
    const level = relativeVolume(samples);
    if (calibration) {
      calibration.values.push(level);
      const remaining = Math.max(0, 3 - (time - calibration.started) / 1000);
      $('.nc-calibrate').textContent = `請保持安靜⋯ ${Math.ceil(remaining)} 秒`;
      if (!remaining) {
        const values = calibration.values.sort((a, b) => a - b);
        setThreshold(Math.round(values[Math.floor(values.length * .8)] + 20));
        calibration = null;
        $('.nc-calibrate').disabled = false;
        $('.nc-calibrate').textContent = '✓ 校準完成・可重新校準';
      }
      model.pause();
      model.level = level;
    } else model.update(level, time - lastTime);
    lastTime = time;
    render();
    animation = requestAnimationFrame(tick);
  }

  async function start() {
    if (running || pending) return;
    showError('');
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !AudioContext) {
      showError('請使用支援麥克風的 Chrome、Edge 或 Safari，並從 HTTPS 網址或 localhost 開啟。');
      return;
    }
    const request = ++generation;
    pending = true;
    $('.nc-start').disabled = true;
    $('.nc-start').textContent = '等待麥克風授權⋯';
    $('.nc-connection').textContent = '請允許使用麥克風';
    try {
      // Resume on the user gesture for browsers that restrict AudioContext startup.
      context = new AudioContext();
      await context.resume();
      if (request !== generation) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (request !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      samples = new Float32Array(analyser.fftSize);
      source = context.createMediaStreamSource(stream);
      source.connect(analyser); // No connection to speakers: never play the microphone back.
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        stop('麥克風已中斷');
        showError('麥克風連線中斷，請確認裝置後重新開始。');
      }, { once: true }));
      running = true;
      pending = false;
      model.pause();
      root.dataset.running = 'true';
      $('.nc-connection').textContent = '正在守護小貓';
      $('.nc-start').disabled = false;
      $('.nc-start').textContent = '暫停偵測';
      $('.nc-calibrate').disabled = false;
      lastTime = performance.now();
      animation = requestAnimationFrame(tick);
    } catch (error) {
      if (request !== generation) return;
      stop('麥克風未開啟');
      const errors = {
        NotAllowedError: '尚未取得麥克風權限。請按網址列旁的網站設定，允許使用麥克風後再試一次。',
        NotFoundError: '找不到麥克風，請先接上麥克風再試一次。',
        NotReadableError: '無法讀取麥克風，請確認裝置正常，或關閉正在使用麥克風的其他程式。',
        SecurityError: '瀏覽器限制了麥克風存取，請確認網站權限設定。',
      };
      showError(errors[error.name] || '無法啟動音量偵測，請確認麥克風與瀏覽器權限後再試一次。');
      $('.nc-start').textContent = '重新開啟麥克風';
    }
  }

  $('.nc-start').addEventListener('click', () => running ? stop() : start());
  $('#nc-threshold').addEventListener('input', event => setThreshold(event.target.value));
  root.querySelectorAll('[data-threshold]').forEach(button => button.addEventListener('click', () => setThreshold(button.dataset.threshold)));
  $('.nc-reset').addEventListener('click', () => { model.reset(); render(); });
  $('.nc-calibrate').addEventListener('click', () => {
    if (!running) return;
    calibration = { started: performance.now(), values: [] };
    $('.nc-calibrate').disabled = true;
    $('.nc-calibrate').textContent = '請保持安靜⋯ 3 秒';
  });
  $('.nc-expand').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === root) await document.exitFullscreen();
      else if (root.requestFullscreen) await root.requestFullscreen();
      else showError('此瀏覽器不支援全螢幕，可使用瀏覽器的放大功能。');
    } catch { showError('無法切換全螢幕，可使用瀏覽器的放大功能。'); }
  });
  document.addEventListener('fullscreenchange', () => { $('.nc-expand').textContent = document.fullscreenElement === root ? '⛶ 返回工具' : '⛶ 放大'; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => stop());
  window.ClassroomNoiseCat = { stop: () => stop() };
  try { setThreshold(localStorage.getItem('classroomNoiseCatThreshold') || 52, false); } catch { setThreshold(52, false); }
  render();
}
