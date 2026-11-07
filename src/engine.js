// Moteur de synthèse Web Audio : scènes par lieu (crossfade) + couche de tension globale.
import { PLACES, MODES, VALENCE_MODE } from './places.js';

const lerp = (a, b, k) => a + (b - a) * k;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

// Leitmotif déterministe par lieu : même lieu => même mélodie, à chaque visite.
function makeMotif(placeId) {
  const r = mulberry32(seedOf(placeId));
  const len = 6 + Math.floor(r() * 3);
  const m = [0];
  for (let i = 1; i < len; i++) m.push(Math.max(-2, Math.min(7, m[i - 1] + Math.round((r() - 0.5) * 5))));
  return m;
}

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.scene = null;
    this.target = { tension: 0, valence: 'neutre', movement: 0.3 };
    this.cur = { tension: 0, movement: 0.3 };
    this.valence = 'neutre';
    this.volume = 0.7;
    this.onTick = null;
  }

  get running() { return !!this.ctx; }
  get placeId() { return this.scene?.id ?? null; }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Réverbération (réponse impulsionnelle bruitée) partagée.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8);
    this.reverb.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.buildTensionLayer();
    this.timer = setInterval(() => this.tick(), 100);
  }

  stop() {
    clearInterval(this.timer);
    this.ctx?.close();
    this.ctx = null; this.scene = null;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  makeImpulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    }
    return buf;
  }

  // Couche de tension : globale, elle se superpose au thème du lieu au lieu de le remplacer.
  buildTensionLayer() {
    const ctx = this.ctx;
    this.tGain = ctx.createGain(); this.tGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    this.tOscs = [0, 6].map((semi) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 65.4 * 2 ** (semi / 12); o.connect(lp); o.start();
      return { o, semi };
    });
    // trémolo dont la vitesse augmente avec la tension
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 2;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.5;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    this.lfo.connect(lfoAmt).connect(trem.gain); this.lfo.start();
    lp.connect(trem).connect(this.tGain);
    this.tGain.connect(this.master);
    this.tGain.connect(this.reverb);
  }

  // --- Scènes -------------------------------------------------------------
  // snapshot (optionnel) : état mémorisé du lieu -> restauré à l'identique.
  enterPlace(id, snapshot = null) {
    const ctx = this.ctx; if (!ctx) return;
    const place = PLACES[id] ?? PLACES.defaut;
    const now = ctx.currentTime, FADE = 3;

    const old = this.scene;
    if (old) {
      old.bus.gain.cancelScheduledValues(now);
      old.bus.gain.setValueAtTime(old.bus.gain.value, now);
      old.bus.gain.linearRampToValueAtTime(0, now + FADE);
      setTimeout(() => old.dispose(), (FADE + 4) * 1000); // laisse mourir la queue de réverb
    }

    const bus = ctx.createGain(); bus.gain.value = 0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = place.cutoff;
    const send = ctx.createGain(); send.gain.value = place.reverb;
    filter.connect(bus); bus.connect(this.master); bus.connect(send); send.connect(this.reverb);

    // Nappe de fond propre au lieu : fondamentale + quinte légèrement désaccordées.
    const drone = [0, 7, -12].map((semi, k) => {
      const o = ctx.createOscillator();
      o.type = k === 2 ? 'sine' : 'triangle';
      o.frequency.value = place.rootHz * 2 ** (semi / 12);
      o.detune.value = (k - 1) * 6;
      const g = ctx.createGain(); g.gain.value = k === 2 ? 0.1 : 0.06;
      o.connect(g).connect(filter); o.start();
      return o;
    });

    const motif = makeMotif(id);
    const scene = {
      id, place, bus, filter, motif,
      motifIdx: snapshot?.motifIdx ?? 0,
      rng: mulberry32(seedOf(id) + (snapshot?.motifIdx ?? 0)),
      step: 0,
      nextTime: now + 0.1,
      dispose() { drone.forEach((o) => { try { o.stop(); } catch { /* déjà arrêté */ } }); bus.disconnect(); filter.disconnect(); send.disconnect(); },
    };
    this.scene = scene;
    if (snapshot?.valence) this.valence = snapshot.valence; // gamme mémorisée restaurée instantanément
    bus.gain.linearRampToValueAtTime(1, now + FADE);

    // la couche de tension suit la tonalité du lieu
    this.tOscs.forEach(({ o, semi }) => o.frequency.setTargetAtTime(place.rootHz * 2 ** (semi / 12), now, 1));
  }

  snapshot() {
    const s = this.scene; if (!s) return null;
    return { motifIdx: s.motifIdx, valence: this.valence, movement: this.cur.movement };
  }

  setTarget(t) { this.target = { ...this.target, ...t }; }

  // --- Boucle de planification ---------------------------------------------
  tick() {
    const ctx = this.ctx, s = this.scene; if (!ctx || !s) return;
    // lissage des paramètres (~2-3 s de constante de temps) : pas de coq-à-l'âne
    this.cur.tension = lerp(this.cur.tension, this.target.tension, 0.05);
    this.cur.movement = lerp(this.cur.movement, this.target.movement, 0.05);
    if (this.target.valence !== this.valence) this.valence = this.target.valence;

    const t = this.cur.tension, now = ctx.currentTime;
    this.tGain.gain.setTargetAtTime(0.14 * t ** 1.6, now, 0.5);
    this.lfo.frequency.setTargetAtTime(2 + 8 * t, now, 0.5);
    s.filter.frequency.setTargetAtTime(s.place.cutoff * (1 + 1.2 * t), now, 0.5);

    while (s.nextTime < now + 0.25) {
      this.scheduleStep(s, s.nextTime);
      const tempo = s.place.tempo * (0.8 + 0.6 * this.cur.movement + 0.4 * t);
      s.nextTime += 60 / tempo / 2; // croches
      s.step++;
    }
    this.onTick?.({ tension: t, movement: this.cur.movement, valence: this.valence });
  }

  scheduleStep(s, time) {
    const { place } = s, t = this.cur.tension, mv = this.cur.movement;
    const prob = Math.min(0.95, place.density * (0.25 + 0.9 * mv));
    if (s.rng() < prob) {
      const modeName = VALENCE_MODE[this.valence] ?? place.mode;
      const scale = MODES[modeName];
      let deg = s.motif[s.motifIdx % s.motif.length];
      if (s.rng() < 0.15) deg += s.rng() < 0.5 ? -1 : 1; // légère variation
      s.motifIdx++;
      const oct = Math.floor(deg / scale.length);
      const semi = scale[((deg % scale.length) + scale.length) % scale.length] + 12 * oct;
      const freq = place.rootHz * 2 ** (place.octave - 1) * 2 ** (semi / 12);
      const dur = 60 / place.tempo * (1.2 + (1 - mv) * 1.5);
      this.playNote(s, place.instrument, freq, time, dur, 0.16 + 0.1 * t);
    }
    // Percussions : n'apparaissent qu'avec la tension.
    if (t > 0.4 && s.step % 4 === 0 && s.rng() < t) this.kick(s, time, 0.25 + 0.4 * t);
    if (t > 0.65 && s.step % 2 === 1) this.hat(s, time, 0.05 + 0.08 * t);
  }

  env(g, time, a, peak, dur, rel) {
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + a);
    g.gain.exponentialRampToValueAtTime(0.0001, time + a + dur + rel);
  }

  playNote(s, inst, f, time, dur, vel) {
    const ctx = this.ctx, g = ctx.createGain(), end = time + dur + 2.5;
    const mk = (type, freq, detune = 0) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
      o.start(time); o.stop(end); return o;
    };
    let oscs = [], filt = null;
    switch (inst) {
      case 'flute': {
        const o = mk('sine', f); const v = ctx.createOscillator(); v.frequency.value = 5;
        const va = ctx.createGain(); va.gain.value = f * 0.006; v.connect(va).connect(o.frequency); v.start(time); v.stop(end);
        oscs = [o, mk('triangle', f * 2)]; this.env(g, time, 0.1, vel, dur, 0.6); break;
      }
      case 'pluck': oscs = [mk('triangle', f), mk('sine', f * 2)]; this.env(g, time, 0.005, vel, dur * 0.3, 0.4); break;
      case 'bell': oscs = [mk('sine', f), mk('sine', f * 2.76), mk('sine', f * 5.4)]; this.env(g, time, 0.003, vel * 0.9, dur * 0.8, 1.6); break;
      case 'strings': oscs = [mk('sawtooth', f, -8), mk('sawtooth', f, 8)]; filt = 900; this.env(g, time, 0.5, vel * 0.5, dur, 1.2); break;
      case 'brass': oscs = [mk('sawtooth', f), mk('sawtooth', f, 5)]; filt = 1100; this.env(g, time, 0.14, vel * 0.55, dur, 0.5); break;
      default: oscs = [mk('sine', f)]; this.env(g, time, 0.02, vel, dur, 0.5);
    }
    let node = g;
    if (filt) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filt; lp.connect(g); node = lp; }
    oscs.forEach((o) => o.connect(node));
    g.connect(s.filter);
    oscs[0].onended = () => g.disconnect();
  }

  kick(s, time, vel) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, time); o.frequency.exponentialRampToValueAtTime(38, time + 0.18);
    g.gain.setValueAtTime(vel, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    o.connect(g).connect(this.master); o.start(time); o.stop(time + 0.35);
  }

  hat(s, time, vel) {
    const ctx = this.ctx, src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; hp.type = 'highpass'; hp.frequency.value = 6500;
    g.gain.setValueAtTime(vel, time); g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(hp).connect(g).connect(this.master); src.start(time); src.stop(time + 0.06);
  }
}
