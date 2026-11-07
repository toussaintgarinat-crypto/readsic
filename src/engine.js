// Moteur de synthèse Web Audio : scènes par lieu (crossfade) + couche de tension globale.
import { PLACES, MODES, VALENCE_MODE } from './places.js';
import { mulberry32, seedOf, makeMotif } from './motif.js';
import { karplusStrong } from './synth.js';

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
    this.comp = comp;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; comp.connect(this.analyser); // mesure de niveau (tests, indicateurs)
    this.pluckCache = new Map();
    this.loadSamples(); // facultatif : remplace la synthèse d'un instrument si un échantillon est fourni

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

  // Enregistrement de la sortie audio (ce que vous entendez) -> Blob audio (webm/opus).
  recordStart() {
    if (!this.ctx || this.recorder) return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.comp.connect(dest);
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recChunks = []; this.recDest = dest;
    this.recorder = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.recChunks.push(e.data);
    this.recorder.start(1000);
    return true;
  }
  recordStop() {
    const rec = this.recorder; if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        this.comp.disconnect(this.recDest);
        const blob = new Blob(this.recChunks, { type: rec.mimeType });
        this.recorder = null; this.recChunks = []; resolve(blob);
      };
      rec.stop();
    });
  }

  // Niveau RMS instantané de la sortie (0..1).
  level() {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize); this.analyser.getFloatTimeDomainData(buf);
    return Math.sqrt(buf.reduce((t, x) => t + x * x, 0) / buf.length);
  }

  // Échantillons facultatifs : samples/manifest.json = { "flute": { "file": "flute_C4.wav", "baseHz": 261.63, "gain": 1 }, … }
  // Un instrument sans échantillon (ou en échec de chargement) reste synthétisé.
  async loadSamples() {
    this.samples = {};
    try {
      const r = await fetch('samples/manifest.json'); if (!r.ok) return;
      const man = await r.json();
      await Promise.all(Object.entries(man).map(async ([inst, m]) => {
        try {
          const res = await fetch('samples/' + m.file); if (!res.ok) return;
          const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.samples[inst] = { buffer, baseHz: m.baseHz, gain: m.gain ?? 1 };
        } catch { /* échantillon illisible : synthèse */ }
      }));
    } catch { /* pas de manifeste */ }
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

  // Corde pincée : tampon Karplus-Strong mis en cache (une seule synthèse par hauteur).
  pluckBuffer(f) {
    const key = Math.round(f * 2);
    let e = this.pluckCache.get(key);
    if (!e) {
      const { data, nominalHz } = karplusStrong(f, this.ctx.sampleRate, 2.5, { seed: key });
      const buffer = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate); buffer.copyToChannel(data, 0);
      e = { buffer, nominalHz }; this.pluckCache.set(key, e);
      if (this.pluckCache.size > 200) this.pluckCache.delete(this.pluckCache.keys().next().value);
    }
    return e;
  }

  playNote(s, inst, f, time, dur, vel) {
    const ctx = this.ctx;
    time = Math.max(ctx.currentTime, time + (Math.random() - 0.5) * 0.02); // légère humanisation
    vel *= 0.85 + Math.random() * 0.3;
    const out = ctx.createGain(), pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    out.connect(pan).connect(s.filter);
    const stopAll = [];
    const osc = (type, freq, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; stopAll.push(o); return o; };
    const through = (src, gainVal, ...chain) => { const g = ctx.createGain(); g.gain.value = gainVal; let n = src.connect(g); for (const c of chain) n = n.connect(c); n.connect(out); return g; };
    const env = (a, peak, hold, rel) => { out.gain.setValueAtTime(0.0001, time); out.gain.linearRampToValueAtTime(peak, time + a); out.gain.setValueAtTime(peak, time + a + hold); out.gain.exponentialRampToValueAtTime(0.0001, time + a + hold + rel); return time + a + hold + rel; };
    let end;

    const smp = this.samples?.[inst];
    if (smp && f / smp.baseHz > 0.5 && f / smp.baseHz < 2) { // échantillon fourni : hauteur ajustée par playbackRate
      const src = ctx.createBufferSource(); src.buffer = smp.buffer; src.playbackRate.value = f / smp.baseHz;
      src.connect(out); out.gain.setValueAtTime(vel * 1.5 * smp.gain, time); out.gain.setTargetAtTime(0.0001, time + dur, 0.4);
      src.start(time); end = time + dur + 2; src.stop(end); src.onended = () => pan.disconnect(); return;
    }

    switch (inst) {
      case 'pluck': { // corde pincée (Karplus-Strong)
        const { buffer, nominalHz } = this.pluckBuffer(f);
        const src = ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = f / nominalHz;
        src.connect(out); end = env(0.002, vel * 1.9, dur * 0.4, 1.8); src.start(time); src.stop(end); stopAll.push(src); break;
      }
      case 'bell': { // cloche FM : rapport modulateur/porteuse non entier, indice qui retombe
        const car = osc('sine', f), mod = osc('sine', f * 3.5), mg = ctx.createGain();
        mg.gain.setValueAtTime(f * 2.5, time); mg.gain.exponentialRampToValueAtTime(f * 0.15, time + 1.8);
        mod.connect(mg).connect(car.frequency);
        const partial = osc('sine', f * 2.01); through(partial, 0.25);
        car.connect(out); end = env(0.003, vel * 0.45, dur * 0.3, 2.2); break;
      }
      case 'flute': { // souffle + vibrato qui s'installe après l'attaque
        const o = osc('sine', f), v = osc('sine', 5.2), va = ctx.createGain();
        va.gain.setValueAtTime(0, time); va.gain.linearRampToValueAtTime(f * 0.008, time + 0.35);
        v.connect(va).connect(o.frequency); o.connect(out); through(osc('triangle', f * 2), 0.12);
        const br = ctx.createBufferSource(); br.buffer = this.noise; br.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 4;
        const bg = ctx.createGain(); bg.gain.setValueAtTime(vel * 0.5, time); bg.gain.exponentialRampToValueAtTime(vel * 0.06, time + 0.25);
        br.connect(bp).connect(bg).connect(out); br.start(time); stopAll.push(br);
        end = env(0.09, vel * 0.7, dur, 0.5); break;
      }
      case 'strings': { // ensemble : 3 dents de scie désaccordées, filtre qui s'ouvre
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
        lp.frequency.setValueAtTime(600, time); lp.frequency.linearRampToValueAtTime(1900, time + 0.7); lp.frequency.exponentialRampToValueAtTime(800, time + dur + 1);
        [-11, 0, 11].forEach((d) => { const o = osc('sawtooth', f, d + (Math.random() - 0.5) * 4); through(o, 0.33, lp); });
        lp.connect(out); end = env(0.55, vel * 1.1, dur, 1.2); break;
      }
      case 'brass': { // attaque cuivrée : le filtre s'ouvre vite puis se referme
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(350, time); lp.frequency.linearRampToValueAtTime(2000, time + 0.12); lp.frequency.exponentialRampToValueAtTime(900, time + 0.6);
        [0, 6].forEach((d) => through(osc('sawtooth', f, d), 0.5, lp)); lp.connect(out);
        end = env(0.07, vel * 0.9, dur, 0.5); break;
      }
      default: osc('sine', f).connect(out); end = env(0.02, vel, dur, 0.5);
    }
    stopAll.forEach((o) => { if (o.start && !o.buffer) o.start(time); if (!o.buffer) o.stop(end + 0.1); });
    stopAll[0].onended = () => pan.disconnect();
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
