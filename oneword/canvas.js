export class InkPad {
  constructor(canvas, onChange) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true }); this.strokes = []; this.enabled = false; this.eraser = false; this.active = null; this.pointer = null; this.onChange = onChange;
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); canvas.setPointerCapture(event.pointerId); this.pointer = event.pointerId;
      this.active = { erase: this.eraser, points: [this.point(event)] }; this.strokes.push(this.active); this.render();
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.enabled || !this.active || this.pointer !== event.pointerId) return;
      event.preventDefault(); for (const sample of event.getCoalescedEvents?.() || [event]) this.active.points.push(this.point(sample)); this.render();
    });
    const end = event => { if (this.pointer === event.pointerId) { this.active = null; this.pointer = null; this.onChange?.(); } };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end); this.render();
  }
  point(event) { const box = this.canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(512, (event.clientX - box.left) * 512 / box.width)), y: Math.max(0, Math.min(512, (event.clientY - box.top) * 512 / box.height)) }; }
  render() {
    const ctx = this.ctx; ctx.clearRect(0, 0, 512, 512);
    for (const stroke of this.strokes) {
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'; ctx.strokeStyle = '#202725'; ctx.fillStyle = '#202725'; ctx.lineWidth = stroke.erase ? 36 : 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const points = stroke.points; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (points.length === 1) { ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; this.onChange?.();
  }
  clear() { this.active = null; this.pointer = null; this.strokes = []; this.render(); }
  undo() { if (!this.enabled) return; this.active = null; this.pointer = null; this.strokes.pop(); this.render(); }
  hasInk() { const data = this.ctx.getImageData(0, 0, 512, 512).data; let ink = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 100 && ++ink > 20) return true; return false; }
  export() { const out = document.createElement('canvas'); out.width = out.height = 512; const ctx = out.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512); ctx.drawImage(this.canvas, 0, 0); return out.toDataURL('image/png'); }
}
