import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { CatNoiseModel, relativeVolume } from '../noise-cat-engine.js';

function feed(model, volume, duration) {
  for (let elapsed = 0; elapsed < duration; elapsed += 50) model.update(volume, 50);
}

test('relative microphone volume handles silence and stays between 0 and 100', () => {
  assert.equal(relativeVolume(new Float32Array(2048)), 0);
  assert.equal(relativeVolume([]), 0);
  assert.equal(relativeVolume([1, -1]), 100);
  assert(relativeVolume([.01, -.01]) > relativeVolume([.001, -.001]));
});

test('a short sound does not wake the cat; sustained noise wakes it only once', () => {
  const cat = new CatNoiseModel(52);
  feed(cat, 100, 200);
  feed(cat, 0, 1000);
  assert.equal(cat.wakeCount, 0);
  feed(cat, 75, 2000);
  assert.equal(cat.state, 'awake');
  assert.equal(cat.wakeCount, 1);
  feed(cat, 75, 10000);
  assert.equal(cat.wakeCount, 1);
});

test('warning gives gentle feedback, sustained quiet restores sleep, a new wake counts', () => {
  const cat = new CatNoiseModel(52);
  feed(cat, 46, 2000);
  assert.equal(cat.state, 'warning');
  assert.equal(cat.wakeCount, 0);
  feed(cat, 0, 4000);
  assert.equal(cat.state, 'sleeping');
  feed(cat, 100, 2000);
  feed(cat, 0, 1500);
  assert.equal(cat.state, 'awake', 'A short quiet gap does not flicker back to sleep');
  feed(cat, 0, 3000);
  assert.equal(cat.state, 'sleeping');
  feed(cat, 100, 2000);
  assert.equal(cat.wakeCount, 2);
});

test('quiet streak, best record, pause and reset follow actual elapsed time', () => {
  const cat = new CatNoiseModel();
  feed(cat, 0, 5000);
  assert.equal(cat.quietMs, 5000);
  assert.equal(cat.bestQuietMs, 5000);
  feed(cat, 100, 2000);
  assert.equal(cat.quietMs, 0);
  const bestBeforePause = cat.bestQuietMs;
  cat.pause();
  assert.equal(cat.wakeCount, 1);
  assert.equal(cat.bestQuietMs, bestBeforePause, 'Pause preserves the best record including the smoothing interval');
  assert.equal(cat.level, 0);
  assert.equal(cat.state, 'sleeping');
  cat.reset();
  assert.equal(cat.wakeCount, 0);
  assert.equal(cat.bestQuietMs, 0);
  cat.update(0, 60000);
  assert.equal(cat.quietMs, 150, 'A stalled frame must not add a minute of quiet');
});

test('threshold adjustment distinguishes quiet study from group discussion', () => {
  const sensitive = new CatNoiseModel(38), relaxed = new CatNoiseModel(68);
  feed(sensitive, 52, 2000);
  feed(relaxed, 52, 2000);
  assert.equal(sensitive.state, 'awake');
  assert.equal(relaxed.state, 'sleeping');
});

// Run the actual UI controller with browser/audio substitutes to check resource
// cleanup and permission races without opening the user's microphone.
function setup(getMedia) {
  const elements = new Map(), documentEvents = {}, windowEvents = {};
  const element = () => ({ dataset:{}, style:{setProperty(){}}, textContent:'', disabled:false, hidden:false, value:'',
    events:{}, attrs:{}, addEventListener(type, callback) { this.events[type] = callback; },
    setAttribute(key, value) { this.attrs[key] = value; } });
  const get = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const presets = [38, 52, 68].map(threshold => Object.assign(element(), { dataset:{threshold:String(threshold)} }));
  const root = Object.assign(element(), { querySelector:get, querySelectorAll:() => presets });
  const host = { querySelector:() => root };
  const contexts = [];
  class AudioContext {
    constructor() { this.state = 'suspended'; this.disconnected = false; contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createAnalyser() { return { fftSize:2048, getFloatTimeDomainData(array) { array.fill(0); } }; }
    createMediaStreamSource() { const audio = this; return { connect(){}, disconnect(){ audio.disconnected = true; } }; }
  }
  const window = { isSecureContext:true, AudioContext, addEventListener:(event, callback) => { windowEvents[event] = callback; } };
  const document = { getElementById:() => host, addEventListener:(event, callback) => { documentEvents[event] = callback; }, hidden:false };
  const code = readFileSync(new URL('../noise-cat.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '');
  vm.runInNewContext(code, { window, document, navigator:{mediaDevices:{getUserMedia:getMedia}}, CatNoiseModel, relativeVolume,
    localStorage:{getItem:() => null, setItem(){}}, cancelAnimationFrame(){}, requestAnimationFrame:() => 1,
    Float32Array, performance:{now:() => 0}, console });
  return { window, document, documentEvents, get, contexts, presets };
}

function fakeStream() {
  const track = { stopped:false, events:{}, stop() { this.stopped = true; }, addEventListener(name, callback) { this.events[name] = callback; } };
  return { getTracks:() => [track], getAudioTracks:() => [track], track };
}

test('the start button opens audio; stop disconnects the source, track and context; restart works', async () => {
  const streams = [];
  const ui = setup(async constraints => { assert.equal(constraints.video, false); const stream = fakeStream(); streams.push(stream); return stream; });
  await ui.get('.nc-start').events.click();
  assert.equal(ui.get('.nc-start').textContent, '暫停偵測');
  assert.equal(ui.get('.nc-calibrate').disabled, false);
  ui.window.ClassroomNoiseCat.stop();
  assert.equal(streams[0].track.stopped, true);
  assert.equal(ui.contexts[0].state, 'closed');
  assert.equal(ui.contexts[0].disconnected, true);
  await ui.get('.nc-start').events.click();
  assert.equal(streams.length, 2);
  ui.document.hidden = true;
  ui.documentEvents.visibilitychange();
  assert.equal(streams[1].track.stopped, true, 'A hidden document stops capture');
});

test('leaving during a pending permission request stops a late stream', async () => {
  let resolveMedia;
  let requested;
  const mediaRequested = new Promise(resolve => { requested = resolve; });
  const ui = setup(() => new Promise(resolve => { resolveMedia = resolve; requested(); }));
  const starting = ui.get('.nc-start').events.click();
  await mediaRequested;
  ui.window.ClassroomNoiseCat.stop();
  const stream = fakeStream();
  resolveMedia(stream);
  await starting;
  assert.equal(stream.track.stopped, true);
  assert.equal(ui.contexts[0].state, 'closed');
  assert.notEqual(ui.get('.nc-start').textContent, '暫停偵測');
});

test('permission refusal and missing devices leave no audio context and permit retry', async () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
    const ui = setup(async () => { const error = new Error(name); error.name = name; throw error; });
    await ui.get('.nc-start').events.click();
    assert.equal(ui.contexts[0].state, 'closed');
    assert.equal(ui.get('.nc-error').hidden, false);
    assert.equal(ui.get('.nc-start').disabled, false);
    assert.equal(ui.get('.nc-calibrate').disabled, true);
  }
});

test('board integrates the third tool and stops capture on navigation and close', () => {
  const board = readFileSync(new URL('../board.html', import.meta.url), 'utf8');
  assert.match(board, /type="module" src="noise-cat.js\?v=[\w-]+"/);
  assert.match(board, /id="class-tool-noise-cat-panel"/);
  assert.match(board, /onclick="switchClassTool\('noise-cat'\)"/);
  assert.match(board, /if \(type !== 'wheel'\) window.ClassroomNoiseCat\?\.stop\(\)/);
  assert.match(board, /function closeApp\(\)\s*\{\s*window.ClassroomNoiseCat\?\.stop\(\)/);
  assert.match(board, /if \(classToolMode !== 'noise-cat'\) window.ClassroomNoiseCat\?\.stop\(\)/);
});
