(() => {
  const link = document.getElementById('open-board-preview');
  const dialog = document.getElementById('board-preview-dialog');
  const frame = document.getElementById('board-preview-frame');
  const close = document.getElementById('close-board-preview');
  if (!link || !dialog || !frame || !close) return;
  const mobile = window.matchMedia('(max-width:700px), (hover:none) and (pointer:coarse) and (max-width:1024px)');
  let previous = null;

  link.addEventListener('click', event => {
    // Desktop and modified clicks keep the normal safe new-tab link behavior.
    if (!mobile.matches || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof dialog.showModal !== 'function') return;
    event.preventDefault();
    if (dialog.open) return;
    dialog.showModal();
    const style = document.body.style;
    previous = { x:window.scrollX, y:window.scrollY, styles:{} };
    for (const key of ['position', 'top', 'width', 'overflow']) previous.styles[key] = style[key];
    style.position = 'fixed';
    style.top = `-${previous.y}px`;
    style.width = '100%';
    style.overflow = 'hidden';
    frame.src = link.href;
    close.focus({ preventScroll:true });
  });

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    // Unload the student preview so hidden games/listeners do not keep running.
    frame.removeAttribute('src');
    if (!previous) return;
    const saved = previous;
    previous = null;
    for (const [key, value] of Object.entries(saved.styles)) document.body.style[key] = value;
    window.scrollTo(saved.x, saved.y);
    link.focus({ preventScroll:true });
  });
})();
