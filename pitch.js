/* =====================================================================
   ECHO TUNE · the pitch engine
   ---------------------------------------------------------------------
   This file turns microphone samples into "this string is at 109.83 Hz,
   which is 3.1 cents flat of A". It has no screen code at all, so the
   same file runs in the app and in the test scripts on a computer.

   How it hears a note, step by step:
   1. CLEAN UP. Every sample passes two gentle filters: one removes
      rumble below 30 Hz (handling noise, wind), one removes hiss above
      5 kHz. A guitar's pitch information sits between the two.
   2. FIND THE NOTE ROUGHLY. About 50 times a second we take the last
      85 ms of sound and compare it with shifted copies of itself. When
      the shift equals one vibration of the string, the copy lines up
      with the original almost perfectly. That shift is the "period".
      The comparison is the McLeod Pitch Method (MPM), a normalised
      autocorrelation that is well known for guitar and voice. It finds
      the true period even when the iPhone's microphone hears the low E
      string's fundamental only faintly.
   3. MEASURE IT PRECISELY. The sound is filtered down to two narrow
      bands: the note's fundamental and its 2nd harmonic. That shuts out
      other strings that are still ringing, and it makes the reading
      follow the fundamental (the pitch a clip-on tuner reads), not the
      slightly sharp upper overtones of a stiff string. On that filtered
      sound, it measures 1, 2, 3 … up to 16 vibrations in a row and fits
      a straight line through them: measuring 14 vibrations of a high E
      and dividing by 14 is 14 times as precise as measuring one. Each
      position is read between samples by fitting a small curve.
   4. DECIDE. A reading only counts when the sound is loud enough above
      the room's background, clearly periodic, and the note holds most
      of the sound's energy.

   The Tuner class at the bottom turns readings into what the screen
   shows: which string you're playing, how many cents off it is, a
   steady (smoothed) value, and when it counts as in tune.
   ===================================================================== */

/* ---------- 1. Notes, frequencies and tunings ---------- */

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

// MIDI numbers count semitones: A4 (the A above middle C) is 69, E2 (the low E string) is 40.
export const midiToFreq = (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
// A cent is 1/100 of a semitone; 1200 cents make an octave.
export const centsOff = (freq, target) => 1200 * Math.log2(freq / target);

// "Eb2" → { midi: 39, letter: 'E', accidental: '♭', octave: 2 }
export function parseNote(text) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(text);
  if (!m) throw new Error('Not a note: ' + text);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  return { midi: 12 * (octave + 1) + base + shift, letter: m[1], accidental: m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '', octave };
}

// The name of any MIDI note, spelt with sharps or flats.
export function noteOf(midi, flats = false) {
  const pc = ((midi % 12) + 12) % 12;
  const name = (flats ? FLAT_NAMES : SHARP_NAMES)[pc];
  return { midi, letter: name[0], accidental: name.slice(1), octave: Math.floor(midi / 12) - 1 };
}

// Strings are listed from the 6th (thickest, lowest) to the 1st (thinnest, highest).
export const TUNINGS = [
  { id: 'standard', name: 'Standard', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'half-down', name: 'Half step down', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
  { id: 'whole-down', name: 'Whole step down', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'drop-d', name: 'Drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'double-drop-d', name: 'Double drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'drop-c-sharp', name: 'Drop C♯', notes: ['C#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'] },
  { id: 'drop-c', name: 'Drop C', notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
  { id: 'drop-b', name: 'Drop B', notes: ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'] },
  { id: 'dadgad', name: 'DADGAD', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
  { id: 'open-d', name: 'Open D', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { id: 'open-e', name: 'Open E', notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
  { id: 'open-g', name: 'Open G', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'open-a', name: 'Open A', notes: ['E2', 'A2', 'E3', 'A3', 'C#4', 'E4'] },
  { id: 'open-c', name: 'Open C', notes: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'] },
].map((t) => ({ ...t, strings: t.notes.map(parseNote) }));

/* ---------- 2. Building blocks ---------- */

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A fast Fourier transform (radix 2). Here it is simply a quick way to compare
// the sound with every shifted copy of itself at once.
class FFT {
  constructor(n) {
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n >> 1);
    this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }
  // Transforms re + i·im in place. inverse = true runs it backwards (without dividing by n).
  run(re, im, inverse) {
    const n = this.n, rev = this.rev, cs = this.cos, sn = this.sin, sign = inverse ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let k = 0; k < half; k++) {
        const wr = cs[k * step], wi = sign * sn[k * step];
        for (let a = k; a < n; a += size) {
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

// A "biquad" is the standard small filter in audio (recipes from Robert Bristow-Johnson's cookbook).
// q = 1/√2 gives the flattest pass band (Butterworth). A band-pass keeps a narrow band around `freq`.
function makeFilter(type, freq, fs, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * Math.min(freq, fs * 0.45)) / fs;
  const cw = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }            // band-pass, 0 dB at the centre
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0, z1: 0, z2: 0 };
}
function filterSample(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
// Runs a filter over data[0 … n) in place, starting from silence.
function filterArray(f, data, n) {
  const { b0, b1, b2, a1, a2 } = f;
  let z1 = 0, z2 = 0;
  for (let i = 0; i < n; i++) {
    const x = data[i], y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
  }
}

// Fits a parabola through three equally spaced values and returns where its top is (−0.5 … 0.5) and how high.
function parabolaPeak(a, b, c) {
  const den = a - 2 * b + c;
  if (den >= 0) return { shift: 0, value: b };
  const shift = clamp((0.5 * (a - c)) / den, -0.5, 0.5);
  return { shift, value: b - 0.25 * (a - c) * shift };
}

/* ---------- 3. The pitch detector ---------- */

const BAND_Q = 8;          // sharpness of the precise bands (three filters in a row: about ±½ semitone wide,
const BAND_STAGES = 3;     // 20 dB quieter a whole tone away, 40 dB quieter a fourth away)

export class PitchDetector {
  /**
   * @param {number} sampleRate  samples per second from the microphone (48000 on most iPhones)
   * @param {object} [opts]  minFreq / maxFreq: the range it listens for (default 38–1600 Hz,
   *                         from a bass's low E up to the 24th fret of a guitar's high E)
   */
  constructor(sampleRate, opts = {}) {
    this.fs = sampleRate;
    this.minFreq = opts.minFreq ?? 38;
    this.maxFreq = opts.maxFreq ?? 1600;
    this.threshold = 0.9;      // MPM: the first peak at least 90 % as good as the best one is the period
    this.minClarity = 0.6;     // weaker than this, the sound isn't a clear note
    this.window = nextPow2(sampleRate * 0.085);                          // 4096 samples at 44.1 or 48 kHz (85 ms)
    this.hop = Math.max(128, Math.round(sampleRate / 50 / 128) * 128);   // a reading about 50 times a second
    this.maxWarmup = Math.round(sampleRate * 0.6);                       // the narrow filters' settling time, at most
    this.fftSize = this.window * 2;                                      // room for every shift without wrapping round
    this.fft = new FFT(this.fftSize);
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.x = new Float64Array(this.window);
    this.maxLag = Math.min(this.window >> 1, Math.ceil(this.fs / this.minFreq) + 2);
    this.nsdf = new Float64Array(this.maxLag + 2);
    const span = this.window + this.maxWarmup;
    this.seg = new Float64Array(span);
    this.band1 = new Float64Array(span);
    this.band2 = new Float64Array(span);
    this.sq = new Float64Array(this.window + 1);
    this.ringSize = nextPow2(span + this.hop * 2);
    this.ring = new Float64Array(this.ringSize);
    this.hp = makeFilter('highpass', 30, sampleRate);
    this.lp = makeFilter('lowpass', 5000, sampleRate);
    this.written = 0;          // samples received so far
    this.sinceHop = 0;
    this.hint = null;          // a frequency to prefer (the string being tuned), or null
    this.strict = false;
    this.watch = null;        // frequencies whose loudness is reported in every reading (the strings)
    this.floor = 0.0005;       // the room's background level, learned while listening
    this.hopEnergy = 0;
    this.prevEnergy = [0, 0, 0];
    this.lastOnset = -1;
  }

  // strict = true (a string picked by hand): only ever measure near it.
  setHint(freq, strict = false) { this.hint = freq > 0 ? freq : null; this.strict = !!strict; }
  setWatch(freqs) { this.watch = freqs && freqs.length ? freqs.slice() : null; }

  // Feed new microphone samples. Returns one reading for every ~20 ms of sound completed.
  push(samples) {
    const out = [];
    const mask = this.ringSize - 1;
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i];
      if (!(v === v)) v = 0;                                   // a NaN from a broken source becomes silence
      v = filterSample(this.lp, filterSample(this.hp, v));
      this.ring[this.written & mask] = v;
      this.written++;
      this.hopEnergy += v * v;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        out.push(this.analyze());
      }
    }
    return out;
  }

  // Copies the newest `count` samples out of the ring into `dest`.
  copyLatest(dest, count) {
    const mask = this.ringSize - 1, start = this.written - count;
    for (let i = 0; i < count; i++) dest[i] = this.ring[(start + i) & mask];
  }

  // One reading: listen, then keep the picture of the room's background up to date.
  analyze() {
    const hopRms = Math.sqrt(this.hopEnergy / this.hop);
    const before = Math.max(...this.prevEnergy);
    const onset = this.hopEnergy > 4 * before && hopRms > 2 * this.floor && hopRms > 0.002;   // a 6 dB jump
    if (onset) this.lastOnset = this.written / this.fs;
    this.prevEnergy.shift(); this.prevEnergy.push(this.hopEnergy);
    this.hopEnergy = 0;
    const reading = this.listen(onset);
    if (!reading.voiced) {
      // The background is learned only while no note is playing: it follows quieter moments
      // quickly and louder ones slowly (3 dB a second), so a long-ringing string never becomes "background".
      if (hopRms < this.floor) this.floor = Math.max(0.00002, this.floor * 0.7 + hopRms * 0.3);
      else this.floor = Math.min(0.05, this.floor * Math.pow(10, (3 / 20) * (this.hop / this.fs)));
    } else if (reading.rms < this.floor * 2) {
      reading.voiced = false;            // a note, but less than 6 dB above the room: not trusted
    }
    reading.floorDb = 20 * Math.log10(this.floor);
    return reading;
  }

  listen(onset) {
    const fs = this.fs, W = this.window, N = this.fftSize, x = this.x;
    const time = this.written / fs;
    this.copyLatest(x, W);
    let mean = 0;
    for (let i = 0; i < W; i++) mean += x[i];
    mean /= W;
    let energy = 0;
    for (let i = 0; i < W; i++) { x[i] -= mean; energy += x[i] * x[i]; }
    const rms = Math.sqrt(energy / W);
    const reading = {
      time, rms, db: rms > 0 ? 20 * Math.log10(rms) : -120, floorDb: 0,
      onset, sinceOnset: this.lastOnset < 0 ? Infinity : time - this.lastOnset,
      voiced: false, freq: 0, clarity: 0, coherence: 0, share: 0, periods: 0, targeted: false, bands: null,
    };
    if (rms < 0.0005) { reading.why = 'quiet'; return reading; }   // below −66 dB: too quiet to be a string you're playing

    // --- step 2: the sound against shifted copies of itself (autocorrelation, via the FFT)
    const re = this.re, im = this.im;
    re.fill(0); im.fill(0);
    re.set(x);
    this.fft.run(re, im, false);
    if (this.watch) reading.bands = this.watch.map((f) => this.peakPower(f) + this.peakPower(2 * f));
    for (let k = 0; k < N; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    this.fft.run(re, im, true);                // now re[τ] / N = Σ x[j]·x[j+τ]

    // McLeod's normalised version: each shift divided by the energy of the two parts compared.
    // 1 = a perfect match, 0 = unrelated, −1 = opposite.
    const L = this.maxLag, nsdf = this.nsdf;
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau <= L + 1; tau++) {
      m -= x[tau - 1] * x[tau - 1] + x[W - tau] * x[W - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] / N) / m : 0;
    }

    // --- the "key maxima": the best match inside each positive stretch of the curve
    const lagLo = Math.max(2, Math.floor(fs / this.maxFreq));
    const keys = [];
    let tau = 1;
    while (tau <= L && nsdf[tau] > 0) tau++;          // skip the trivial match at zero shift
    while (tau <= L) {
      while (tau <= L && nsdf[tau] <= 0) tau++;
      if (tau > L) break;
      let best = tau;
      while (tau <= L && nsdf[tau] > 0) { if (nsdf[tau] > nsdf[best]) best = tau; tau++; }
      if (best >= lagLo && best < L) {
        const p = parabolaPeak(nsdf[best - 1], nsdf[best], nsdf[best + 1]);
        keys.push({ lag: best + p.shift, value: Math.min(1, p.value) });
      }
    }
    let top = 0;
    for (const k of keys) top = Math.max(top, k.value);

    reading.top = top;
    reading.keys = keys;

    // Which period to measure. The candidates, in order of preference:
    // · when we know which string you're tuning (picked by hand, or just plucked): the clear peak
    //   closest to that string;
    // · MPM's rule: the FIRST peak nearly as good as the best one (later peaks are 2, 3 … periods,
    //   which would read an octave or more too low);
    // · several strings ringing at once can make a misleading "common" period. Then: the string
    //   being tuned, measured in its own narrow band, or (with no string in mind) the other clear
    //   peaks, highest note first.
    // Each candidate is measured precisely, and the first one that really holds a steady note wins.
    const FIFTH = Math.log2(1.5);
    const nearHint = (k) => Math.abs(Math.log2(fs / k.lag / this.hint)) < FIFTH;
    const tries = [];
    if (this.hint) {
      // A peak within 2½ semitones of the string (half the gap to the next string) counts even when weak.
      // A string picked by hand may be further off: then a clear peak within a fifth.
      const nearest = (range, minValue) => {
        let best = null, bestDist = range;
        for (const k of keys) {
          if (k.value < minValue) continue;
          const d = Math.abs(Math.log2(fs / k.lag / this.hint));
          if (d < bestDist) { bestDist = d; best = k; }
        }
        return best;
      };
      const best = nearest(250 / 1200, 0.3) || (this.strict ? nearest(FIFTH, Math.max(0.45, 0.5 * top)) : null);
      if (best) tries.push(best);
    }
    const mpm = top >= this.minClarity ? keys.find((k) => k.value >= this.threshold * top) : null;
    if (mpm && !tries.includes(mpm)) {
      if (!this.hint || nearHint(mpm)) tries.push(mpm);
      else if (!this.strict && mpm.value >= 0.8) tries.push(mpm);   // another string, clearly playing
    }
    if (this.hint) {
      if (top >= 0.3) tries.push(null);                             // null: measure around the string itself
      // A string picked by hand only ever measures near that string; a string just plucked gives way at last.
      if (!this.strict && mpm && !tries.includes(mpm)) tries.push(mpm);
    } else for (const k of keys) if (k.value >= 0.45 && !tries.includes(k)) tries.push(k);
    if (!tries.length) { reading.why = 'no clear note'; return reading; }

    // --- step 3: the precise measurement (again, re-centred, if it lands away from where it started)
    let fine = null, pick = null, work = 0;
    reading.why = 'unsteady';
    for (const cand of tries) {
      if (work >= 4) break;                          // enough effort for one reading
      const centre = cand ? fs / cand.lag : this.hint;
      let f = this.refine(centre, energy); work++;
      if (f && Math.abs(centsOff(f.freq, centre)) > 10) { f = this.refine(f.freq, energy) || f; work++; }
      if (!f) continue;
      const good = cand
        ? f.share >= 0.1 && f.coherence >= 0.85
        : f.share >= 0.2 && f.coherence >= 0.92 && Math.abs(centsOff(f.freq, this.hint)) < 300;
      if (good) { fine = f; pick = cand; break; }
      reading.why = f.share < (cand ? 0.1 : 0.2) ? 'note too faint in the mix' : 'unsteady';
    }
    if (!fine) return reading;
    reading.why = '';
    reading.voiced = true;
    reading.targeted = !pick;
    reading.clarity = pick ? pick.value : top;
    reading.freq = fine.freq;
    reading.coherence = fine.coherence;
    reading.share = fine.share;
    reading.periods = fine.periods;
    reading.band = fine.band;
    return reading;
  }

  // Loudest point of the spectrum within ±60 cents of `freq` (a Hann-windowed spectrum, read from the FFT).
  peakPower(freq) {
    const N = this.fftSize, re = this.re, im = this.im;
    const c = (freq * N) / this.fs;
    if (c > N / 2 - 4) return 0;
    const lo = Math.max(2, Math.min(Math.floor(c * 0.9659), Math.round(c) - 1));
    const hi = Math.max(Math.ceil(c * 1.0353), Math.round(c) + 1);
    let best = 0;
    for (let k = lo; k <= hi; k++) {
      const hr = 0.5 * re[k] - 0.25 * (re[k - 2] + re[k + 2]);
      const hm = 0.5 * im[k] - 0.25 * (im[k - 2] + im[k + 2]);
      best = Math.max(best, hr * hr + hm * hm);
    }
    return best;
  }

  // The precise measurement. The sound is filtered to two narrow bands, the note's fundamental and
  // its 2nd harmonic, and each band is measured on its own:
  // · both agree (within 1.5 cents): they are averaged, weighted by how loud each is;
  // · they disagree (another string's overtone leaking into one band): the fundamental wins;
  // · the fundamental is very faint (the iPhone's microphone and a low string): the 2nd harmonic is used.
  refine(freq, windowEnergy) {
    const fs = this.fs, W = this.window;
    // The narrow filters need some sound to settle before the measured part: 10 of their time constants.
    const U = clamp(Math.round(((10 * BAND_Q) / (Math.PI * freq)) * fs), Math.round(0.06 * fs), this.maxWarmup);
    const n = W + U, seg = this.seg, b1 = this.band1, b2 = this.band2;
    this.copyLatest(seg, n);
    b1.set(seg.subarray(0, n));
    for (let s = 0; s < BAND_STAGES; s++) filterArray(makeFilter('bandpass', freq, fs, BAND_Q), b1, n);
    const one = this.measure(b1.subarray(U, n), fs / freq);      // the newest W samples, once the filters have settled
    let two = null;
    if (2 * freq < fs * 0.4) {
      b2.set(seg.subarray(0, n));
      for (let s = 0; s < BAND_STAGES; s++) filterArray(makeFilter('bandpass', 2 * freq, fs, BAND_Q), b2, n);
      two = this.measure(b2.subarray(U, n), fs / freq / 2);
    }
    const e1 = one ? one.energy : 0, e2 = two ? two.energy : 0;
    const share = (e1 + e2) / Math.max(1e-30, windowEnergy);   // how much of the sound the note holds
    let freqOut, used, coherence, band;
    if (one && (!two || e1 >= 0.1 * e2)) {
      const f1 = fs / one.period, f2 = two ? fs / two.period / 2 : 0;
      if (two && Math.abs(centsOff(f2, f1)) < 1.5) {
        freqOut = Math.exp((e1 * Math.log(f1) + e2 * Math.log(f2)) / (e1 + e2));
        coherence = Math.min(one.coherence, two.coherence);
        band = 'both';
      } else {
        freqOut = f1; coherence = one.coherence; band = 'fundamental';
      }
      used = one.periods;
    } else if (two) {
      freqOut = fs / two.period / 2; coherence = two.coherence; used = two.periods / 2; band = '2nd harmonic';
    } else return null;
    return { freq: freqOut, periods: used, coherence, share, band };
  }

  // Measures the period of one narrow band y (W samples) that vibrates about every `lag` samples.
  measure(y, lag) {
    const W = this.window, sq = this.sq;
    sq[0] = 0;
    for (let i = 0; i < W; i++) sq[i + 1] = sq[i] + y[i] * y[i];
    if (!(sq[W] > 0)) return null;

    // How well the band matches itself shifted by t samples (the same normalised measure as above).
    const at = (t) => {
      let r = 0;
      for (let j = 0, len = W - t; j < len; j++) r += y[j] * y[j + t];
      const mm = sq[W - t] + (sq[W] - sq[t]);
      return mm > 0 ? (2 * r) / mm : 0;
    };

    // Measure 1, 2, 3 … K vibrations (as many as fit in half the window, at most 16) and fit
    // period = (length of k vibrations) / k through all of them, longer stretches counting more.
    const K = Math.max(1, Math.min(16, Math.floor(W / 2 / lag)));
    let period = lag, sumWK2 = 0, sumWKT = 0, used = 0, last = 0;
    for (let k = 1; k <= K; k++) {
      const guess = k * period;
      let c = Math.round(guess);
      if (c + 2 >= W - 8) break;
      let vc = at(c), vl = at(c - 1), vr = at(c + 1);
      const steps = k === 1 ? Math.max(6, Math.ceil(lag * 0.06)) : 4;   // climb to the top of the hill
      for (let s = 0; s < steps && (vl > vc || vr > vc); s++) {
        if (vl > vc) { c--; vr = vc; vc = vl; vl = at(c - 1); }
        else { c++; vl = vc; vc = vr; vr = at(c + 1); }
      }
      if (vl > vc || vr > vc || vc < 0.5 || (k > 1 && Math.abs(c - guess) > 3)) break;   // lost the thread
      const p = parabolaPeak(vl, vc, vr);
      const t = c + p.shift;
      const w = Math.max(0, p.value) ** 2 * (W - t);
      sumWK2 += w * k * k;
      sumWKT += w * k * t;
      period = sumWKT / sumWK2;
      used = k;
      last = p.value;
    }
    if (!used) return null;
    return { period, periods: used, coherence: Math.min(1, last), energy: sq[W] };
  }
}

/* ---------- 4. The tuner: readings → what the screen shows ---------- */

export class Tuner {
  constructor() {
    this.a4 = 440;
    this.tolerance = 2;        // cents either side of perfect that count as in tune
    this.mode = 'auto';        // 'auto' (finds the string), 'manual' (the string you tapped), 'chromatic' (any note)
    this.tuning = TUNINGS[0];
    this.locked = -1;          // the string chosen by hand in manual mode
    this.flats = false;        // note names in chromatic mode
    this.tuned = [false, false, false, false, false, false];
    this.clear();
  }

  clear() {
    this.smooth = null;        // the steady pitch, in cents from A4
    this.recent = [];          // the last 0.4 s of readings (to spot a pitch sliding while a peg turns)
    this.lastOnset = -Infinity;
    this.lastVoiced = -Infinity;
    this.lastTime = 0;
    this.stringIdx = -1;       // the string being tuned (auto and manual)
    this.focus = -1;           // auto mode: the string that was just plucked, if we could tell
    this.disagree = 0;
    this.bandHist = [];
    this.jump = [];
    this.inTuneFor = 0;
    this.outFor = 0;
    this.chromaMidi = null;
    this.state = { status: 'idle', level: -120 };
  }

  // The frequency of each string in the current tuning and reference pitch.
  targets() { return this.tuning.strings.map((s) => midiToFreq(s.midi, this.a4)); }
  // What the detector should prefer: the string picked by hand (strictly), or the one just plucked.
  hint() {
    if (this.mode === 'manual' && this.locked >= 0) return { freq: this.targets()[this.locked], strict: true };
    if (this.mode === 'auto' && this.focus >= 0) return { freq: this.targets()[this.focus], strict: false };
    return { freq: null, strict: false };
  }
  // Which frequencies the detector should report the loudness of (auto mode only).
  watch() { return this.mode === 'auto' ? this.targets() : null; }

  setTuning(t) { this.tuning = t; this.tuned.fill(false); this.clear(); }
  setA4(hz) { this.a4 = hz; this.tuned.fill(false); this.clear(); }
  setMode(mode, locked = -1) {
    this.mode = mode;
    this.locked = mode === 'manual' ? locked : -1;
    this.clear();
  }

  // Which string a frequency belongs to: { idx, cents }.
  nearestString(freq) {
    const targets = this.targets();
    let idx = 0, best = Infinity;
    targets.forEach((t, i) => {
      const c = Math.abs(centsOff(freq, t));
      if (c < best) { best = c; idx = i; }
    });
    return { idx, cents: centsOff(freq, targets[idx]) };
  }

  // Auto mode: when one string's band suddenly gets much louder, that is the string just plucked.
  // (It keeps the tuner on that string even while the previous one is still ringing.)
  spotPluck(bands) {
    this.bandHist.push(bands);
    if (this.bandHist.length > 4) this.bandHist.shift();
    if (this.bandHist.length < 4) return;
    const [h0, h1, h2] = this.bandHist;
    const loudest = Math.max(...bands);
    let best = -1, gainBest = 0;
    const jumped = [];
    bands.forEach((now, s) => {
      const before = Math.min(h0[s], h1[s], h2[s]);
      if (now >= 4 * before && now >= 0.2 * loudest) {     // 6 dB louder, and a main part of the sound
        jumped.push(s);
        if (now - before > gainBest) { gainBest = now - before; best = s; }
      }
    });
    if (best < 0) return;
    // Two strings an octave apart both jumping (Open D, Open G …): that's the pitch detector's call, not ours.
    const t = this.targets();
    if (jumped.some((s) => s !== best && Math.abs(Math.abs(Math.log2(t[s] / t[best])) - 1) < 0.05)) return;
    if (this.focus !== best) {
      this.focus = best; this.disagree = 0;
      this.smooth = null; this.jump = []; this.recent = [];   // start the new string's reading afresh
    }
  }

  update(r) {
    const dt = clamp(r.time - this.lastTime, 0, 0.2);
    this.lastTime = r.time;
    const level = r.db;
    if (this.mode === 'auto' && r.bands) this.spotPluck(r.bands);

    if (!r.voiced) {
      const quiet = r.time - this.lastVoiced;
      if (quiet > 0.6) this.focus = -1;
      if (this.smooth == null || quiet > 2.5) {
        this.state = { status: 'idle', level };
        this.smooth = null;
      } else if (quiet > 0.25) this.state = { ...this.state, status: 'fading', level };
      else this.state = { ...this.state, level };
      this.inTuneFor = 0;
      return this.state;
    }

    let freq = r.freq;
    if (this.mode === 'auto') {
      // A reading far from every string, but an octave from one, is the 2nd harmonic or a sub-harmonic: fold it back.
      const near = this.nearestString(freq);
      if (Math.abs(near.cents) > 150) {
        for (const ratio of [0.5, 2]) {
          if (Math.abs(this.nearestString(freq * ratio).cents) < 100) { freq *= ratio; break; }
        }
      }
      // The plucked string keeps the focus only while the readings agree with it. A reading that
      // belongs to another string is not shown; three in a row and the focus moves on.
      if (this.focus >= 0) {
        if (this.nearestString(freq).idx !== this.focus) {
          if (++this.disagree < 3) return this.state;
          this.focus = -1; this.disagree = 0;
        } else this.disagree = 0;
      }
    }

    // --- smoothing: steady when the pitch is steady, quick when it moves
    const raw = 1200 * Math.log2(freq / this.a4);
    if (r.onset) this.lastOnset = r.time;
    let waiting = false;                     // true while a big jump is not yet confirmed
    if (this.smooth == null || r.time - this.lastVoiced > 0.5) {
      this.smooth = raw; this.jump = []; this.recent = [];
    } else {
      const diff = Math.abs(raw - this.smooth);
      if (diff > 35) {
        // A big jump: a new note, or a glitch. Three readings that agree with each other mean a new note.
        this.jump.push(raw);
        waiting = true;
        if (this.jump.length >= 3) {
          const j = this.jump.slice(-3).sort((a, b) => a - b);
          if (j[2] - j[0] < 25) { this.smooth = j[1]; this.jump = []; this.recent = []; waiting = false; }
          else this.jump.shift();
        }
      } else {
        this.jump = [];
        // Time constant: 0.2 s when within half a cent, down to 0.06 s when the pitch is moving.
        const tc = clamp(0.22 - 0.045 * diff, 0.06, 0.2);
        this.smooth += (raw - this.smooth) * (1 - Math.exp(-dt / tc));
      }
    }
    this.lastVoiced = r.time;
    // Turning a peg makes the pitch slide steadily. Smoothing alone would show a sliding note late,
    // so when the last 0.4 s of readings lie on a clear straight slope (and no pluck started in that
    // time), the display follows that line instead. A steady note is never affected.
    if (!waiting) this.recent.push({ t: r.time, c: raw });
    while (this.recent.length && r.time - this.recent[0].t > 0.4) this.recent.shift();
    let shown = this.smooth;
    if (this.recent.length >= 10 && r.time - this.lastOnset > 0.45) {
      const n = this.recent.length;
      let st = 0, sc = 0;
      for (const p of this.recent) { st += p.t; sc += p.c; }
      const mt = st / n, mc = sc / n;
      let stt = 0, stc = 0;
      for (const p of this.recent) { stt += (p.t - mt) ** 2; stc += (p.t - mt) * (p.c - mc); }
      const slope = stc / stt;                                  // cents per second
      let res = 0;
      for (const p of this.recent) res += (p.c - (mc + slope * (p.t - mt))) ** 2;
      const fit = Math.sqrt(res / n);
      const w = clamp((Math.abs(slope) - 6) / 6, 0, 1) * (fit < 0.6 ? 1 : 0);
      if (w > 0) shown += w * (mc + slope * (r.time - mt) - this.smooth);
    }
    const smoothFreq = this.a4 * Math.pow(2, shown / 1200);

    // --- what we're tuning to
    let target, stringIdx = -1, note;
    if (this.mode === 'chromatic') {
      const midiF = 69 + shown / 100;
      // Keep the current note until the pitch is clearly past halfway to the next (no flicker at ±50).
      if (this.chromaMidi == null || Math.abs(midiF - this.chromaMidi) > 0.56) this.chromaMidi = Math.round(midiF);
      target = midiToFreq(this.chromaMidi, this.a4);
      note = noteOf(this.chromaMidi, this.flats);
    } else {
      if (this.mode === 'manual' && this.locked >= 0) stringIdx = this.locked;
      else if (this.focus >= 0) stringIdx = this.focus;
      else stringIdx = this.nearestString(smoothFreq).idx;   // the steady pitch already ignores one-off readings
      this.stringIdx = stringIdx;
      target = this.targets()[stringIdx];
      const s = this.tuning.strings[stringIdx];
      note = { midi: s.midi, letter: s.letter, accidental: s.accidental, octave: s.octave };
    }

    const cents = centsOff(smoothFreq, target);

    // --- in tune? It has to stay inside the zone for 0.3 s to count.
    let justTuned = false;
    if (Math.abs(cents) <= this.tolerance) {
      this.inTuneFor += dt; this.outFor = 0;
      if (this.inTuneFor >= 0.3 && stringIdx >= 0 && !this.tuned[stringIdx]) { this.tuned[stringIdx] = true; justTuned = true; }
    } else {
      this.inTuneFor = 0;
      this.outFor += dt;
      // A ticked string that is now clearly out of tune for a second loses its tick.
      if (stringIdx >= 0 && this.tuned[stringIdx] && Math.abs(cents) > this.tolerance + 3 && this.outFor > 1) this.tuned[stringIdx] = false;
    }
    const inTune = this.inTuneFor >= 0.3 || (this.state.status === 'in-tune' && Math.abs(cents) <= this.tolerance + 0.5);

    this.state = {
      status: inTune ? 'in-tune' : cents < 0 ? 'flat' : 'sharp',
      note, target, stringIdx, cents, freq: smoothFreq, rawFreq: freq, rawCents: centsOff(freq, target), inTuneFor: this.inTuneFor,
      clarity: r.clarity, level, justTuned, onset: r.onset,
    };
    return this.state;
  }
}
