import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../teacher-board-preview.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../teacher.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../teacher-board-preview.css', import.meta.url), 'utf8');
assert.match(html, /id="open-board-preview" href="board.html" target="_blank" rel="noopener noreferrer"/);
assert.match(html, /<dialog id="board-preview-dialog" aria-labelledby="board-preview-title">/);
assert.match(html, /✕ 返回教師端/);
assert.doesNotMatch(html.match(/<iframe id="board-preview-frame"[^>]*>/)[0], /allowfullscreen|allow=/, 'Embedded fullscreen must not hide the return toolbar');
assert.match(css, /height:100dvh/);
assert.match(css, /safe-area-inset-top/);
assert.match(css, /#board-preview-frame \{ flex:1; min-height:0/);

function setup(matches) {
  const elements = new Map();
  const element = id => {
    const obj = { handlers:{}, open:false, focused:false, src:undefined,
      addEventListener(name, fn) { this.handlers[name] = fn; },
      focus(options) { this.focused = options.preventScroll; },
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close(); },
      removeAttribute(name) { delete this[name]; },
    };
    elements.set(id, obj); return obj;
  };
  const link = element('open-board-preview'); link.href = 'https://example.test/board.html';
  const dialog = element('board-preview-dialog');
  const frame = element('board-preview-frame');
  const close = element('close-board-preview');
  const style = { position:'', top:'', width:'95%', overflow:'auto' };
  const scrolls = [];
  const media = { matches };
  const teacher = { panel:'scheduled', draft:'未儲存的事項', date:'2026-10-05' };
  vm.runInNewContext(source, {
    document:{ getElementById:id=>elements.get(id), body:{ style } },
    window:{ scrollX:0, scrollY:431, matchMedia(query) {
      assert.match(query, /max-width:700px/); assert.match(query, /pointer:coarse/); return media;
    }, scrollTo:(x,y)=>scrolls.push([x,y]) },
  });
  const click = extra => { const event = { button:0, prevented:false, preventDefault() { this.prevented = true; }, ...extra }; link.handlers.click(event); return event; };
  return { link, dialog, frame, close, style, scrolls, click, teacher, media };
}
const desktop = setup(false);
assert.equal(desktop.click().prevented, false);
assert.equal(desktop.dialog.open, false);
assert.equal(desktop.frame.src, undefined);
const phone = setup(true);
for (const modifier of ['ctrlKey','metaKey','shiftKey','altKey']) assert.equal(phone.click({ [modifier]:true }).prevented, false);
assert.equal(phone.click({ button:1 }).prevented, false);
assert.equal(phone.click().prevented, true);
assert.equal(phone.dialog.open, true);
assert.equal(phone.frame.src, phone.link.href);
assert.equal(phone.style.top, '-431px');
assert.equal(phone.close.focused, true);
assert.equal(phone.click().prevented, true, 'Repeated clicks do not overwrite the saved scroll position');
phone.media.matches = false; // Rotation/resize must not discard or navigate away from the preview.
phone.close.handlers.click();
assert.equal(phone.dialog.open, false);
assert.equal(phone.frame.src, undefined);
assert.deepEqual(phone.style, { position:'', top:'', width:'95%', overflow:'auto' });
assert.deepEqual(phone.scrolls, [[0,431]]);
assert.equal(phone.link.focused, true);
assert.deepEqual(phone.teacher, { panel:'scheduled', draft:'未儲存的事項', date:'2026-10-05' });
phone.media.matches = true;
phone.click(); phone.dialog.close(); // Native Escape closes through the same dialog close event.
assert.equal(phone.scrolls.length, 2);
assert.equal(phone.frame.src, undefined);
const unsupported = setup(true); unsupported.dialog.showModal = undefined;
assert.equal(unsupported.click().prevented, false, 'Older browsers retain the new-tab fallback');
console.log('Teacher board preview tests: passed (mobile overlay, desktop new tab, modifiers, focus, scroll/styles, reopen, rotation, native close, fallback).');
