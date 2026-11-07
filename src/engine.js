// Moteur de synthèse Web Audio : scènes par lieu (crossfade) + couche de tension globale.
import { PLACES, MODES, VALENCE_MODE } from './places.js';
import { mulberry32, seedOf, makeMotif } from './motif.js';

const lerp = (a, b, k) => a + (b - a) * k;

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
  // Elle construit peu à peu un accord diminué 7 (1, ♭3, ♭5, 𝄫7 — cf. « accords diminués » du Drive) :
  // tonique -> triton -> tierce mineure -> sixte, au fil de la tension.
  buildTensionLayer() {
    const ctx = this.ctx;
    this.tGain = ctx.createGain(); this.tGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    this.tOscs = [0, 6, 3, 9].map((semi, k) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 65.4 * 2 ** (semi / 12);
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(lp); o.start();
      return { o, g, semi, th: [0, 0.2, 0.5, 0.75][k] };
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

  rootOf(s) { return s.place.rootHz * 2 ** (s.offset / 12); }

  // Réaccorde drone + couche de tension sur la tonique courante (lieu + modulation), en glissando.
  retune(s, glide) {
    const now = this.ctx.currentTime, root = this.rootOf(s);
    s.drone.forEach(({ o, semi }) => o.frequency.setTargetAtTime(root * 2 ** (semi / 12), now, glide));
    this.tOscs.forEach(({ o, semi }) => o.frequency.setTargetAtTime(root * 2 ** (semi / 12), now, glide));
    this.retuneColor(s, glide);
  }

  // Couleur d'accord du drone : la tierce du mode courant (majeure/mineure selon le mode).
  retuneColor(s, glide) {
    const scale = this.scaleOf(s), third = scale[2];
    s.color.frequency.setTargetAtTime(this.rootOf(s) * 2 ** ((third + 12) / 12), this.ctx.currentTime, glide);
  }

  modeName(s) { return VALENCE_MODE[this.valence] ?? s.place.mode; }
  scaleOf(s) { return MODES[this.modeName(s)].iv; }

  // Modulation narrative : décale la tonique du lieu (offset en demi-tons) avec un glissando de ~1,5 s.
  modulate(offset) {
    const s = this.scene; if (!s || s.offset === offset) return;
    s.offset = offset;
    this.retune(s, 0.6);
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
    const offset = snapshot?.offset ?? 0; // tonalité mémorisée (modulation) restaurée à l'identique
    const root0 = place.rootHz * 2 ** (offset / 12);
    const drone = [0, 7, -12].map((semi, k) => {
      const o = ctx.createOscillator();
      o.type = k === 2 ? 'sine' : 'triangle';
      o.frequency.value = root0 * 2 ** (semi / 12);
      o.detune.value = (k - 1) * 6;
      const g = ctx.createGain(); g.gain.value = k === 2 ? 0.1 : 0.06;
      o.connect(g).connect(filter); o.start();
      return { o, semi };
    });
    // Tierce du mode, une octave au-dessus : donne sa couleur (majeure/mineure) à la nappe.
    const color = ctx.createOscillator(); color.type = 'sine';
    const cg = ctx.createGain(); cg.gain.value = 0.035;
    color.connect(cg).connect(filter); color.start();

    const motif = makeMotif(id);
    const scene = {
      id, place, bus, filter, motif, drone, color, offset, colorKey: '',
      motifIdx: snapshot?.motifIdx ?? 0,
      rng: mulberry32(seedOf(id) + (snapshot?.motifIdx ?? 0)),
      step: 0,
      nextTime: now + 0.1,
      dispose() { [...drone.map((d) => d.o), color].forEach((o) => { try { o.stop(); } catch { /* déjà arrêté */ } }); bus.disconnect(); filter.disconnect(); send.disconnect(); },
    };
    this.scene = scene;
    if (snapshot?.valence) this.valence = snapshot.valence; // gamme mémorisée restaurée instantanément
    bus.gain.linearRampToValueAtTime(1, now + FADE);

    // la couche de tension suit la tonalité du lieu
    this.retune(scene, 1);
  }

  snapshot() {
    const s = this.scene; if (!s) return null;
    return { motifIdx: s.motifIdx, valence: this.valence, movement: this.cur.movement, offset: s.offset };
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
    this.tOscs.forEach(({ g, th }) => g.gain.setTargetAtTime(Math.min(1, Math.max(0, (t - th) / 0.3)), now, 0.5));
    const key = this.modeName(s) + '|' + s.offset;
    if (key !== s.colorKey) { s.colorKey = key; this.retuneColor(s, 0.4); }
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
      const scale = this.scaleOf(s);
      let deg = s.motif[s.motifIdx % s.motif.length];
      if (s.rng() < 0.15) deg += s.rng() < 0.5 ? -1 : 1; // légère variation
      s.motifIdx++;
      const oct = Math.floor(deg / scale.length);
      const semi = scale[((deg % scale.length) + scale.length) % scale.length] + 12 * oct;
      const freq = this.rootOf(s) * 2 ** (place.octave - 1) * 2 ** (semi / 12);
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

  // Leitmotif de personnage : joué une fois, transposé dans la tonalité et le mode courants du lieu.
  playLeitmotif(c) {
    const s = this.scene, ctx = this.ctx; if (!s || !ctx) return false;
    const scale = this.scaleOf(s), t0 = ctx.currentTime + 0.15, beat = 60 / (s.place.tempo * 0.9);
    c.motif.forEach((deg, k) => {
      const oct = Math.floor(deg / scale.length);
      const semi = scale[((deg % scale.length) + scale.length) % scale.length] + 12 * oct;
      const f = this.rootOf(s) * 2 ** s.place.octave * 2 ** (semi / 12);
      this.playNote(s, c.instrument, f, t0 + k * beat * 0.75, beat * 0.9, 0.22);
    });
    this.leitmotifCount = (this.leitmotifCount ?? 0) + 1;
    return true;
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
