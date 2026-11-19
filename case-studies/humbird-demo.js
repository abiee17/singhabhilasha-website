(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $("hb-stage");
  if (!stage) return;
  const A = $("hb-demo").dataset.assets;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The game's own numbers (HumBirdTuning), in metres and seconds.
  const T = { lane: 2.6, floor: 2.0, cruise: 6, glideFloor: 4.2, dip: 1.5, gravity: 24, maxSink: 7.5,
              climb: 6.5, climbSmooth: 0.15, laneSmooth: 0.05, song: 8, refill: 2.5, launchMin: 0.35,
              magnet: 1.8, magnetAhead: 2.5 };
  const WORLD_H = T.floor + 4 * T.lane + 0.7;          // metres of sky the stage shows
  const LANES = [["LOW", "--l-low"], ["MID", "--l-mid"], ["HIGH", "--l-high"], ["V-HIGH", "--l-vhigh"]];
  const PERCH_ART = ["plat-mushroom", "plat-sunflower", "plat-teacup", "plat-toucan-branch", "plat-clothesline"];
  const laneY = (i) => T.floor + (i + 0.5) * T.lane;

  const world = $("hb-world"), birdEl = $("hb-bird"), birdImg = $("hb-bird-img");
  const songEl = $("hb-song"), songFill = $("hb-song-fill"), msgEl = $("hb-msg");
  const cover = $("hb-cover"), demo = $("hb-demo"), goEl = $("hb-go"), pickTitle = $("hb-pick-t"), pickNote = $("hb-pick-n");
  const warmEl = $("hb-warm"), warmText = $("hb-warm-t"), warmFill = $("hb-warm-fill"), warmHz = $("hb-warm-hz");
  const layers = [[$("hb-sky"), 0.02], [$("hb-mid"), 0.25], [$("hb-near"), 0.6]];

  // Lane bands and tags.
  const laneEls = LANES.map(([name, color], i) => {
    const band = document.createElement("div");
    band.className = "hb-lane";
    band.style.cssText = `bottom:calc(var(--m)*${T.floor + i * T.lane});background:var(${color})`;
    const tag = document.createElement("div");
    tag.className = "hb-lane-tag";
    tag.textContent = name;
    tag.style.cssText = `bottom:calc(var(--m)*${laneY(i)});background:var(${color})`;
    $("hb-lanes").append(band, tag);
    return band;
  });

  // One metre = var(--m) pixels inside the stage, so a resize is a single property change.
  let ppm = 20;
  const M = (metres) => `calc(var(--m)*${metres.toFixed(3)})`;
  const fit = () => {
    ppm = stage.clientHeight / WORLD_H;
    stage.style.setProperty("--m", ppm + "px");
    draw();
  };

  // Unity's SmoothDamp, so lane changes and the weighted climb move the way they do in the game.
  function smoothDamp(cur, target, vel, smooth, maxSpeed, dt) {
    const o = 2 / Math.max(1e-4, smooth), x = o * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const goal = target, maxCh = maxSpeed * smooth;
    const ch = Math.max(-maxCh, Math.min(maxCh, cur - target));
    target = cur - ch;
    const tmp = (vel + o * ch) * dt;
    vel = (vel - o * tmp) * e;
    let out = target + (ch + tmp) * e;
    if ((goal - cur > 0) === (out > goal)) { out = goal; vel = 0; }
    return [out, vel];
  }

  let perches = [], drops = [];
  const s = { state: "perched", x: 0, y: laneY(1), vx: 0, vy: 0, song: T.song, lane: 1, hum: false,
              recovering: false, last: null, rest: 1, nectar: 0, breaths: 0, drained: false, note: "", noteUntil: 0 };

  function addPerch(x, lane) {
    const el = document.createElement("div");
    el.className = "hb-perch";
    el.style.left = M(x);
    el.style.top = `calc(100% - var(--m)*${(laneY(lane) - 0.42).toFixed(3)})`;
    const img = document.createElement("img");
    img.src = A + PERCH_ART[perches.length % PERCH_ART.length] + ".webp";
    img.alt = "";
    el.append(img);
    world.append(el);
    const p = { x, lane, el };
    perches.push(p);
    return p;
  }
  function extend() {
    while (perches[perches.length - 1].x < s.x + 60) {
      const prev = perches[perches.length - 1];
      let lane = prev.lane + (Math.random() < 0.5 ? -1 : 1);
      if (lane < 0) lane = 1;
      if (lane > 3) lane = 2;
      const next = addPerch(prev.x + 17 + Math.random() * 6, lane);
      // Nectar traces the route: stay in the old lane, then step to the new one.
      for (let x = prev.x + 3; x < next.x - 2; x += 2.2) {
        const y = laneY(x < prev.x + (next.x - prev.x) * 0.45 ? prev.lane : next.lane);
        const el = document.createElement("div");
        el.className = "hb-drop";
        el.style.left = M(x);
        el.style.bottom = M(y);
        world.append(el);
        drops.push({ x, y, el, got: false });
      }
    }
    while (perches.length > 3 && perches[0] !== s.last && perches[0].x < s.x - 30) perches.shift().el.remove();
    while (drops.length && drops[0].x < Math.min(s.x - 30, s.last.x - 5)) drops.shift().el.remove();
  }
  function land(p) {
    s.state = "perched"; s.x = p.x; s.y = laneY(p.lane); s.vx = s.vy = 0; s.rest = 0;
    s.recovering = false; s.last = p; s.drained = s.song < T.song * 0.98;
  }
  function say(text, seconds) { s.note = text; s.noteUntil = performance.now() + seconds * 1000; }
  const inp = { key: false, ptr: false, mic: false };       // any one of them counts as a hum

  function step(dt) {
    const canSing = s.hum && s.song > 0;
    if (s.state === "perched") {
      s.rest += dt;
      if (!s.hum) {
        const before = s.song;
        s.song = Math.min(T.song, s.song + dt * T.song / T.refill);
        if (s.drained && before < T.song && s.song >= T.song) { s.breaths++; s.drained = false; }
      } else if (s.rest > 0.5 && s.song >= T.song * T.launchMin) {
        s.state = "flying"; s.vx = T.glideFloor; s.vy = 0;
      }
    } else if (s.state === "flying") {
      if (!canSing) {
        s.vy = Math.min(Math.max(-3, Math.min(3, s.vy)), -T.dip);     // she dips at once
        s.state = "gliding";
      } else {
        s.song = Math.max(0, s.song - dt);
        s.vx += Math.max(-12 * dt, Math.min(12 * dt, T.cruise - s.vx));
        const target = laneY(s.lane);
        if (s.recovering && target - s.y < 0.15) s.recovering = false;
        [s.y, s.vy] = s.recovering
          ? smoothDamp(s.y, target, s.vy, T.climbSmooth, T.climb, dt)
          : smoothDamp(s.y, target, s.vy, T.laneSmooth, Infinity, dt);
        s.x += s.vx * dt;
        for (const p of perches)
          if (p !== s.last && Math.abs(p.x - s.x) < 0.5 && Math.abs(laneY(p.lane) - s.y) < T.lane * 0.3) { land(p); break; }
      }
    } else {                                                           // gliding
      if (canSing) {
        if (s.vy < 0) s.vy = 0;
        s.state = "flying"; s.recovering = true;                       // the climb back has weight
      } else {
        s.vy = Math.max(s.vy - T.gravity * dt, -T.maxSink);
        s.vx += Math.max(-1.5 * dt, Math.min(1.5 * dt, T.glideFloor - s.vx));
        s.x += s.vx * dt; s.y += s.vy * dt;
        for (const p of perches) {
          const ahead = p.x - s.x;
          if (p !== s.last && ahead > -0.5 && ahead < T.magnetAhead && Math.abs(laneY(p.lane) - s.y) < T.magnet) { land(p); break; }
        }
        if (s.state === "gliding" && s.y <= 0.5) {
          land(s.last);
          say("She drifts back to her last perch. Nothing is lost.", 2.6);
        }
      }
    }
    for (const d of drops)
      if (!d.got && Math.abs(d.x - s.x) < 0.7 && Math.abs(d.y - s.y) < 1.0) { d.got = true; d.el.classList.add("got"); s.nectar++; }
    extend();
  }

  let lastState = "", lastMsg = null;
  function draw() {
    const cam = s.x - (stage.clientWidth * 0.26) / ppm;
    world.style.transform = `translateX(${(-cam * ppm).toFixed(1)}px)`;
    for (const [el, k] of layers) el.style.backgroundPositionX = (-cam * ppm * k).toFixed(1) + "px";
    birdEl.style.bottom = M(s.y);
    const tilt = s.state === "perched" ? 0 : Math.max(-28, Math.min(22, -s.vy * 3.2));
    birdEl.style.transform = `rotate(${tilt}deg)`;
    if (s.state !== lastState) {
      birdImg.src = A + (s.state === "perched" ? "bird-perch" : "bird-fly") + ".webp";
      birdEl.classList.toggle("fly", s.state === "flying" && !reduce);
      lastState = s.state;
    }
    laneEls.forEach((el, i) => el.classList.toggle("active", i === s.lane));
    songFill.style.transform = `scaleX(${(s.song / T.song).toFixed(3)})`;
    songEl.classList.toggle("low", s.song < T.song * 0.25);
    $("hb-nectar").textContent = s.nectar;
    $("hb-breaths").textContent = s.breaths;
    let msg = "";
    if (performance.now() < s.noteUntil) msg = s.note;
    else if (!playing) msg = "";
    else if (s.state === "perched") msg = s.hum && s.song < T.song * T.launchMin ? (mic.on ? "Go quiet to breathe in first." : "Let go to breathe in first.") : s.song < T.song ? (s.hum ? (mic.on ? "Go quiet and she breathes her song back in." : "") : "Breathing in…") : (mic.on ? "Hum and she lifts off." : "Hold to hum and she lifts off.");
    else if (s.state === "gliding") msg = s.song <= 0 ? "Out of song. Glide to a perch." : "Hum to catch her.";
    else if (s.song < T.song * 0.25) msg = "Song is running low. Find a perch.";
    if (msg !== lastMsg) { msgEl.textContent = msg; lastMsg = msg; }
  }

  // ── microphone: the game's lane fitting, ported. Sound is analysed here and goes nowhere. ──
  const refitBtn = $("hb-refit"), readEl = $("hb-read");
  const mic = { on: false, ctx: null, stream: null, an: null, buf: null, half: null, diff: null,
                floor: 0.003, voiced: false, quiet: 0, recent: [], locked: false, hz: 0,
                lo: 0, hi: 0, has: false, qLane: 1, shown: 0 };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // VoiceRange: the lowest and highest notes heard, widening at a limited rate.
  function observe(hz, dt) {
    if (hz < 60 || hz > 800) return;
    if (!mic.has) { mic.lo = mic.hi = hz; mic.has = true; return; }
    const grow = 150 * dt;
    if (hz < mic.lo) mic.lo = Math.max(hz, mic.lo - grow);
    else if (hz > mic.hi) mic.hi = Math.min(hz, mic.hi + grow);
  }
  const fitted = () => mic.has && mic.hi - mic.lo >= 80;
  function pitch01(hz) {                                   // 0-1 across the range, in octaves, 8% trimmed off each end
    let lo = 140, hi = 495, inset = 0;                     // the HumDial's fixed bands until the range is known
    if (fitted()) { lo = mic.lo; hi = mic.hi; inset = 0.08; }
    const a = Math.log2(lo), b = Math.log2(hi), pad = (b - a) * inset;
    return clamp01((Math.log2(Math.max(hz, 1)) - a - pad) / (b - a - 2 * pad));
  }
  function quantize(p) {                                   // LaneQuantizer.Step with 4% sticky edges
    for (let guard = 0; guard < 4; guard++) {
      if (mic.qLane < 3 && p > (mic.qLane + 1) / 4 + 0.04) mic.qLane++;
      else if (mic.qLane > 0 && p < mic.qLane / 4 - 0.04) mic.qLane--;
      else break;
    }
    return mic.qLane;
  }

  // Loudness and pitch of the newest window of sound (YIN's normalised difference, at half the sample rate).
  function listen(buf, rate) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const n = buf.length >> 1, h = mic.half, d = mic.diff, r = rate / 2;
    for (let i = 0; i < n; i++) h[i] = 0.5 * (buf[2 * i] + buf[2 * i + 1]);
    const minLag = Math.max(2, Math.floor(r / 800)), maxLag = Math.min(Math.ceil(r / 60), n >> 1), span = n - maxLag;
    let running = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let acc = 0;
      for (let i = 0; i < span; i++) { const x = h[i] - h[i + lag]; acc += x * x; }
      running += acc;
      d[lag] = running > 0 ? acc * lag / running : 1;
    }
    let at = -1;
    for (let lag = minLag; lag <= maxLag; lag++)
      if (d[lag] < 0.15) { while (lag < maxLag && d[lag + 1] < d[lag]) lag++; at = lag; break; }
    if (at < 0) { let low = 1; for (let lag = minLag; lag <= maxLag; lag++) if (d[lag] < low) { low = d[lag]; at = lag; } }
    if (at < 0) return { rms, hz: 0, clear: 0 };
    let nudge = 0;
    if (at > 1 && at < maxLag) { const a = d[at - 1], b = d[at], c = d[at + 1], den = a - 2 * b + c; if (den > 1e-9) nudge = 0.5 * (a - c) / den; }
    return { rms, hz: r / (at + nudge), clear: 1 - d[at] };
  }

  function micFrame(dt) {
    mic.an.getFloatTimeDomainData(mic.buf);
    const f = listen(mic.buf, mic.ctx.sampleRate);
    // The room's own noise level: drops at once, creeps up slowly, and only ever learns from sound that
    // is not a clear note, so a steady hum that has not opened the gate yet cannot raise the bar on itself.
    if (f.rms < mic.floor) mic.floor = Math.max(0.0005, f.rms);
    else if (!mic.voiced && f.clear < 0.5) mic.floor = Math.min(0.02, mic.floor + (f.rms - mic.floor) * Math.min(1, dt * 0.5));
    const tone = f.hz >= 60 && f.hz <= 800;
    const on = tone && f.clear > 0.75 && f.rms > Math.max(0.006, mic.floor * 3.5);
    const still = tone && f.clear > 0.5 && f.rms > Math.max(0.004, mic.floor * 2.2);
    if (!mic.voiced) { if (on) { mic.voiced = true; mic.quiet = 0; } }
    else if (still) mic.quiet = 0;
    else if ((mic.quiet += dt) >= 0.06) mic.voiced = false;

    if (!mic.voiced) { mic.recent.length = 0; mic.locked = false; }
    else if (still) {                                       // HumBirdInput's pitch follower
      const q = mic.recent;
      q.unshift(f.hz); if (q.length > 3) q.pop();
      const pair = q.length >= 2 ? 0.5 * (q[0] + q[1]) : 0;
      if (!mic.locked) {
        if (q.length >= 2 && Math.abs(q[0] - q[1]) <= 0.12 * q[1]) { mic.hz = pair; mic.locked = true; }   // two readings must agree
      } else if (q.length >= 2 && Math.abs(q[0] - q[1]) <= 0.06 * q[1] && Math.abs(pair - mic.hz) > 0.10 * mic.hz) {
        mic.hz = pair;                                      // a deliberate step to a new note: go now
      } else {
        const target = q.length >= 3 ? Math.max(Math.min(q[0], q[1]), Math.min(Math.max(q[0], q[1]), q[2])) : q[0];
        mic.hz += (target - mic.hz) * (1 - Math.exp(-40 * dt));
      }
      if (mic.locked) { observe(mic.hz, dt); s.lane = quantize(pitch01(mic.hz)); }
    }
    inp.mic = mic.voiced;

    const now = performance.now();
    if (now - mic.shown > 120) {
      mic.shown = now;
      const range = fitted() ? `your lanes ${Math.round(mic.lo)}–${Math.round(mic.hi)} Hz` : "fixed lanes until it has heard more of your range";
      readEl.innerHTML = mic.voiced && mic.locked
        ? `hearing ${Math.round(mic.hz)} Hz<i style="background:var(${LANES[s.lane][1]})">${LANES[s.lane][0]}</i>${range}`
        : `listening… ${range}`;
    }
  }

  // Asks for the microphone and starts listening. Resolves false if there is none or it was refused.
  async function micOpen() {
    if (mic.on) return true;
    const devices = navigator.mediaDevices, Ctx = window.AudioContext || window.webkitAudioContext;
    if (!devices || !devices.getUserMedia || !Ctx) return false;
    const ctx = new Ctx();                                             // made inside the click, so it is allowed to run
    let stream;
    try {
      // Phone-call clean-up filters treat a steady hum as noise and remove it, so they are all off.
      stream = await devices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (_) {
      ctx.close().catch(() => {});
      return false;
    }
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
    mic.stream = stream; mic.ctx = ctx;
    mic.an = ctx.createAnalyser();
    mic.an.fftSize = ctx.sampleRate > 60000 ? 4096 : 2048;             // about 43 ms, the game's own window
    mic.an.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(mic.an);               // analysed only: never played, never stored
    mic.buf = new Float32Array(mic.an.fftSize);
    mic.half = new Float32Array(mic.an.fftSize >> 1);
    mic.diff = new Float32Array((mic.an.fftSize >> 2) + 2);
    mic.voiced = false; mic.locked = false; mic.recent.length = 0; mic.floor = 0.003; mic.qLane = s.lane;
    mic.on = true; inp.ptr = false;
    return true;
  }
  function micOff() {
    if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
    if (mic.ctx) mic.ctx.close().catch(() => {});
    mic.stream = mic.ctx = mic.an = null;
    mic.on = false; mic.voiced = false; inp.mic = false;
    readEl.textContent = "";
  }
  // ── running: pick how to fly, warm up the voice, 3-2-1, go ──
  const PRIVACY = pickNote.textContent, WARM_ASK = warmText.textContent;
  const modeBtns = [...demo.querySelectorAll("button[data-mode]")];
  let playing = false, raf = 0, prev = 0, mode = null, busy = false, counting = false, countTimer = 0;
  let warming = false, warmQuiet = 0, warmDone = false;
  function sync() {
    for (const b of modeBtns) {
      if (b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", String(mode === b.dataset.mode));
      b.disabled = busy;
    }
    refitBtn.hidden = mode !== "mic";
  }
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (mic.on) micFrame(dt);
    if (warming) warmStep(dt);
    else { s.hum = inp.key || inp.ptr || inp.mic; step(dt); }
    draw();
    if (playing || warming) raf = requestAnimationFrame(frame);
  }
  function start() {
    if (playing) return;
    playing = true;
    stage.classList.add("on");
    stage.focus({ preventScroll: true });
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function toPerch() {                                                 // back on her last perch with a full song
    s.song = T.song; s.hum = false;
    land(s.last);
  }

  // The warm-up: before she flies, one hum from low to high fits the four lanes to this voice.
  // Same rule as the game: done once it has heard 80 Hz of range and the player has gone quiet.
  function warmUp() {
    cancelAnimationFrame(raf);
    playing = false; stage.classList.remove("on");
    toPerch();
    warming = true; warmQuiet = 0; warmDone = false;
    cover.hidden = true; warmEl.hidden = false;
    warmText.textContent = WARM_ASK;
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function warmStep(dt) {
    const got = clamp01((mic.has ? mic.hi - mic.lo : 0) / 80), pct = Math.round(got * 100);
    warmQuiet = mic.voiced ? 0 : warmQuiet + dt;
    warmFill.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    warmHz.textContent = mic.voiced && mic.locked ? `hearing ${Math.round(mic.hz)} Hz · ${pct}%`
      : mic.has ? `${Math.round(mic.lo)}–${Math.round(mic.hi)} Hz so far · ${pct}%` : "listening…";
    if (got >= 1 && !warmDone) { warmDone = true; warmText.textContent = "She knows your voice. Take a breath."; }
    if (got >= 1 && warmQuiet >= 0.4) endWarm();
  }
  function endWarm() {
    if (!warming) return;
    warming = false; warmEl.hidden = true;
    cancelAnimationFrame(raf);
    countdown();
  }
  $("hb-warm-skip").addEventListener("click", endWarm);

  function countdown() {
    counting = true;
    cover.hidden = true; goEl.hidden = false;
    say(mode === "mic" ? "Get ready to hum." : "Get ready. Hold the scene to hum.", 2.4);
    draw();
    const steps = ["3", "2", "1", "Go!"];
    let i = 0;
    (function tick() {
      goEl.textContent = steps[i];
      goEl.classList.remove("pop"); void goEl.offsetWidth; goEl.classList.add("pop");
      if (++i < steps.length) { countTimer = setTimeout(tick, 750); return; }
      counting = false;
      start();
      countTimer = setTimeout(() => { goEl.hidden = true; }, 650);
    })();
  }
  // One entry point for the overlay's two options and the switch under the stage.
  async function choose(next) {
    if (busy || counting) return;
    if (warming) {
      if (next === "mic") return;
      warming = false; warmEl.hidden = true; cancelAnimationFrame(raf);
    }
    if (next === "mic" && !mic.on) {
      busy = true; sync();
      pickNote.textContent = "Waiting for the microphone…";
      const ok = await micOpen();
      busy = false;
      if (!ok) {
        const why = "The microphone is not available here. Choose No microphone and hold the scene to fly.";
        pickNote.textContent = why;
        if (playing) say(why, 5);
        sync();
        return;
      }
    } else if (next === "touch") micOff();
    mode = next;
    pickNote.textContent = PRIVACY;
    sync();
    if (mode === "mic" && !fitted()) { warmUp(); return; }             // no range for this voice yet: test it first
    if (!playing) { countdown(); return; }
    say(mode === "touch" ? "Microphone off. Hold the scene to hum." : "Microphone on. Hum and she flies.", 4);
    stage.focus({ preventScroll: true });
  }
  // A new player: forget the voice range and the counters, and run the warm-up again.
  refitBtn.addEventListener("click", () => {
    if (busy || counting) return;
    mic.has = false; mic.lo = mic.hi = 0;
    s.nectar = 0; s.breaths = 0;
    if (mic.on && (playing || warming)) warmUp();
    else { pickNote.textContent = "Voice range cleared. The next microphone flight starts with a warm-up."; draw(); }
  });
  function pause() {
    if (!playing && !counting && !warming) return;
    clearTimeout(countTimer); counting = false; goEl.hidden = true;
    warming = false; warmEl.hidden = true;
    playing = false; s.hum = inp.key = inp.ptr = inp.mic = false;
    micOff();
    cancelAnimationFrame(raf);
    stage.classList.remove("on");
    pickTitle.textContent = "Paused. How will you keep flying?";
    cover.hidden = false;
    sync(); draw();
  }
  demo.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b) choose(b.dataset.mode);
  });

  // ── input: hold = hum, height = pitch ──
  function laneFromPointer(e) {
    const r = stage.getBoundingClientRect();
    const y = (r.bottom - e.clientY) / ppm;
    s.lane = Math.max(0, Math.min(3, Math.floor((y - T.floor) / T.lane)));
  }
  stage.addEventListener("pointerdown", (e) => {
    if (!playing || mic.on) return;                                    // with a working mic, touch is not a stand-in
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    laneFromPointer(e); inp.ptr = true;
  });
  stage.addEventListener("pointermove", (e) => { if (playing && !mic.on && (e.pointerType === "mouse" || inp.ptr)) laneFromPointer(e); });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(type, () => { inp.ptr = false; });
  stage.addEventListener("keydown", (e) => {
    if (!playing) return;
    if (e.code === "Space") { inp.key = true; e.preventDefault(); }
    else if (e.code === "ArrowUp") { s.lane = Math.min(3, s.lane + 1); e.preventDefault(); }
    else if (e.code === "ArrowDown") { s.lane = Math.max(0, s.lane - 1); e.preventDefault(); }
    else if (e.key >= "1" && e.key <= "4") s.lane = +e.key - 1;
    else if (e.key === "Escape") pause();
  });
  stage.addEventListener("keyup", (e) => { if (e.code === "Space") { inp.key = false; e.preventDefault(); } });
  stage.addEventListener("blur", () => { inp.key = inp.ptr = false; });
  if ("IntersectionObserver" in window)
    new IntersectionObserver((entries) => { if (!entries[0].isIntersecting) pause(); }, { threshold: 0.15 }).observe(stage);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  // ── first frame: she is sitting on her first perch with a full song ──
  s.last = addPerch(0, 1);
  extend();
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  fit();
})();
