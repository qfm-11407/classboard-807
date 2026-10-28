// The meter is relative microphone input (0–100), not calibrated sound pressure dB.
export function relativeVolume(samples) {
  if (!samples.length) return 0;
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  const rms = Math.sqrt(squares / samples.length);
  return Math.max(0, Math.min(100, (20 * Math.log10(Math.max(rms, 1e-8)) + 65) / 55 * 100));
}

export class CatNoiseModel {
  constructor(threshold = 52) {
    this.threshold = threshold;
    this.reset();
  }
  reset() {
    this.state = 'sleeping';
    this.level = 0;
    this.warningMs = 0;
    this.loudMs = 0;
    this.calmMs = 0;
    this.quietMs = 0;
    this.bestQuietMs = 0;
    this.wakeCount = 0;
  }
  pause() {
    this.state = 'sleeping';
    this.level = 0;
    this.warningMs = this.loudMs = this.calmMs = this.quietMs = 0;
  }
  update(input, elapsedMs) {
    const dt = Math.max(0, Math.min(150, elapsedMs));
    this.level += (Math.max(0, Math.min(100, input)) - this.level) * (1 - Math.exp(-dt / 150));
    const loud = this.level >= this.threshold;
    const calm = this.level < this.threshold - 15;
    this.loudMs = loud ? this.loudMs + dt : 0;
    this.warningMs = this.level >= this.threshold - 10 ? this.warningMs + dt : 0;
    this.calmMs = calm ? this.calmMs + dt : 0;
    if (this.state !== 'awake' && this.loudMs >= 900) {
      this.state = 'awake';
      this.wakeCount++;
    } else if (this.state === 'sleeping' && this.warningMs >= 350) {
      this.state = 'warning';
    } else if (this.state !== 'sleeping' && this.calmMs >= 2600) {
      this.state = 'sleeping';
    }
    this.quietMs = this.state === 'sleeping' && this.level < this.threshold - 10 ? this.quietMs + dt : 0;
    this.bestQuietMs = Math.max(this.bestQuietMs, this.quietMs);
    return this;
  }
}
