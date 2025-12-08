(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const playBtn = document.getElementById("playPause");
  const scrub = document.getElementById("scrub");
  const timeLabel = document.getElementById("timeLabel");
  const legendEl = document.getElementById("legend");
  const lapsEl = document.getElementById("laps");
  const eventsEl = document.getElementById("events");
  const deltaCanvas = document.getElementById("delta");
  const deltaCtx = deltaCanvas.getContext("2d");
  const deltaInfo = document.getElementById("deltaInfo");
  const deltaPlayer = document.getElementById("deltaPlayer");
  const steerCanvas = document.getElementById("steer");
  const steerCtx = steerCanvas.getContext("2d");
  const steerInfo = document.getElementById("steerInfo");
  const liveEl = document.getElementById("live");
  const livePanel = document.getElementById("livePanel");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsClose = document.getElementById("settingsClose");
  const showControlsAll = document.getElementById("showControlsAll");
  const showEventsToggle = document.getElementById("showEvents");
  const eventFilterEl = document.getElementById("eventFilter");
  const staticCanvas = document.createElement("canvas");
  const staticCtx = staticCanvas.getContext("2d");

  let data = null;
  let playing = false;
  let lastTs = 0;
  let currentTime = 0;
  let maxTime = 0;
  let unit = "mph";
  let boundsCache = null;
  let lastHudUpdate = 0;
  const hudInterval = 100; // ms
  let carCursors = [];
  let frameCapMs = 1000 / 45;
  let selectedCar = null; // null = show all
  let showControls = false;
  let showEvents = false;
  let eventTypes = new Set(["crash", "collision", "reset", "surface", "overtake"]);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const drect = deltaCanvas.getBoundingClientRect();
    deltaCanvas.width = drect.width * dpr;
    deltaCanvas.height = drect.height * dpr;
    deltaCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (steerCanvas && steerCtx) {
      const srect = steerCanvas.getBoundingClientRect();
      steerCanvas.width = srect.width * dpr;
      steerCanvas.height = srect.height * dpr;
      steerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    staticCanvas.width = rect.width;
    staticCanvas.height = rect.height;
    staticCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (data) {
      renderStatic();
      draw();
    }
  }

  window.addEventListener("resize", resize);

  function fetchData() {
    fetch("data.json")
      .then((r) => r.json())
      .then((j) => {
        data = j;
        maxTime = computeMaxTime();
        scrub.max = maxTime || 1;
        statusEl.textContent = `Loaded master (${data.master.length} pts), ${data.cars?.length || 0} cars, ${data.events?.length || 0} events`;
        buildDeltaPlayer();
        buildLegend();
        buildLaps();
        buildEvents();
        updateLive();
        initDrag();
        initSettings();
        renderStatic();
        carCursors = new Array(data.cars?.length || 0).fill(0);
        resize();
      })
      .catch((err) => {
        statusEl.textContent = `Failed to load data.json: ${err}`;
        console.error(err);
      });
  }

  function initDrag() {
    if (!livePanel) return;
    let dragging = false;
    let startX = 0, startY = 0;
    let panelX = livePanel.offsetLeft;
    let panelY = livePanel.offsetTop;
    const header = document.getElementById("liveHeader");
    const target = header || livePanel;
    const onDown = (e) => {
      if (window.innerWidth <= 900) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      panelX = livePanel.offsetLeft;
      panelY = livePanel.offsetTop;
      livePanel.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      livePanel.style.left = `${panelX + dx}px`;
      livePanel.style.top = `${panelY + dy}px`;
      livePanel.style.right = "auto";
      livePanel.style.position = "fixed";
    };
    const onUp = () => {
      dragging = false;
      livePanel.style.cursor = "grab";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointerdown", onDown);
  }

  function initSettings() {
    if (!settingsBtn || !settingsOverlay) return;
    settingsBtn.addEventListener("click", () => {
      settingsOverlay.style.display = "flex";
    });
    if (settingsClose) {
      settingsClose.addEventListener("click", () => {
        settingsOverlay.style.display = "none";
      });
    }
    settingsOverlay.addEventListener("click", (e) => {
      if (e.target === settingsOverlay) {
        settingsOverlay.style.display = "none";
      }
    });
    const radios = settingsOverlay.querySelectorAll("input[name=unit]");
    radios.forEach((r) => {
      r.addEventListener("change", (e) => {
        unit = e.target.value;
        settingsOverlay.style.display = "none";
        updateLive();
      });
      if (r.checked) unit = r.value;
    });
    if (showControlsAll) {
      showControlsAll.checked = showControls;
      showControlsAll.addEventListener("change", (e) => {
        showControls = e.target.checked;
        updateLive();
      });
    }
    if (showEventsToggle) {
      showEventsToggle.checked = showEvents;
      showEventsToggle.addEventListener("change", (e) => {
        showEvents = e.target.checked;
        buildEventFilter();
        renderStatic();
        draw();
      });
    }
  }

  function orient(pt) {
    // Mirror X to correct left/right flip; Y orientation handled in projection invert.
    return { x: -pt.x, y: pt.y };
  }

  function getBounds() {
    const pts = data.master || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      const o = orient(p);
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
      maxX = Math.max(maxX, o.x);
      maxY = Math.max(maxY, o.y);
    });
    // pad a bit
    const pad = 100;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  function project(pt, bounds, w, h) {
    const o = orient(pt);
    const sx = w / (bounds.maxX - bounds.minX || 1);
    const sy = h / (bounds.maxY - bounds.minY || 1);
    const scale = Math.min(sx, sy) * 0.95;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const ox = w / 2;
    const oy = h / 2;
    return {
      x: ox + (o.x - cx) * scale,
      y: oy - (o.y - cy) * scale, // invert Y for screen
    };
  }

  const palette = [
    "#ffb100", "#6bc5ff", "#ff6b6b", "#7bd389", "#f78bff", "#ffd166",
    "#7af8ff", "#c084fc", "#90e0ef", "#ff9f1c",
  ];

  function filteredCars() {
    if (selectedCar === null) return data.cars || [];
    const car = (data.cars || [])[selectedCar];
    return car ? [car] : [];
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (staticCanvas.width && staticCanvas.height) {
      ctx.drawImage(staticCanvas, 0, 0);
    }
    const bounds = boundsCache || getBounds();

    // Cars (head only)
    filteredCars().forEach((car, idx) => {
      const globalIdx = selectedCar !== null ? selectedCar : idx;
      const color = palette[globalIdx % palette.length];
      const head = headAtTime(globalIdx, currentTime);
      if (head) {
        const { x, y } = project({ x: head.masterX, y: head.masterY }, bounds, w, h);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

  }

  function renderStatic() {
    if (!data) return;
    boundsCache = getBounds();
    const w = canvas.width;
    const h = canvas.height;
    staticCtx.setTransform(1, 0, 0, 1, 0, 0);
    staticCanvas.width = w;
    staticCanvas.height = h;
    staticCtx.clearRect(0, 0, w, h);
    const bounds = boundsCache;
    // Heatmap
    if (data.heatmap && data.heatmap.length > 1) {
      const accels = data.heatmap.map((p) => p.avgAccel).filter((v) => isFinite(v));
      const scale = heatScale(accels);
      staticCtx.lineWidth = 4;
      for (let i = 0; i < data.heatmap.length - 1; i++) {
        const a = data.heatmap[i];
        const b = data.heatmap[i + 1];
        const { x: ax, y: ay } = project(a, bounds, w, h);
        const { x: bx, y: by } = project(b, bounds, w, h);
        staticCtx.strokeStyle = heatColor((a.avgAccel + b.avgAccel) / 2, scale);
        staticCtx.beginPath();
        staticCtx.moveTo(ax, ay);
        staticCtx.lineTo(bx, by);
        staticCtx.stroke();
      }
    }
    // Master track
    staticCtx.strokeStyle = "#6e7791";
    staticCtx.lineWidth = 2;
    staticCtx.beginPath();
    data.master.forEach((p, i) => {
      const { x, y } = project(p, bounds, w, h);
      if (i === 0) staticCtx.moveTo(x, y);
      else staticCtx.lineTo(x, y);
    });
    staticCtx.stroke();

    // Events on map (optional)
    if (showEvents && data.events && data.events.length) {
      data.events.forEach((ev) => {
        const t = (ev.type || "").toLowerCase();
        if (!eventTypes.has(t)) return;
        const pt = { x: ev.masterX ?? ev.x, y: ev.masterY ?? ev.y };
        if (!isFinite(pt.x) || !isFinite(pt.y)) return;
        const { x, y } = project(pt, bounds, w, h);
        staticCtx.fillStyle = eventColor(ev.type || "");
        staticCtx.beginPath();
        staticCtx.arc(x, y, 4, 0, Math.PI * 2);
        staticCtx.fill();
      });
    }
  }

  function heatScale(vals) {
    if (!vals || vals.length === 0) return 1;
    const absVals = vals.map((v) => Math.abs(v)).filter((v) => isFinite(v)).sort((a, b) => a - b);
    if (absVals.length === 0) return 1;
    const idx = Math.floor(absVals.length * 0.9);
    return Math.max(0.2, absVals[idx] || absVals[absVals.length - 1] || 1);
  }

  function heatColor(v, scale) {
    if (!isFinite(v)) return "#666";
    const maxAbs = Math.max(0.2, Math.abs(scale));
    const t = Math.max(-1, Math.min(1, v / maxAbs)); // -1..1
    const amber = { r: 255, g: 177, b: 0 };
    const green = { r: 93, g: 211, b: 158 };
    const red = { r: 255, g: 107, b: 107 };
    if (t >= 0) {
      // accel: amber -> green
      const r = Math.round(amber.r + (green.r - amber.r) * t);
      const g = Math.round(amber.g + (green.g - amber.g) * t);
      const b = Math.round(amber.b + (green.b - amber.b) * t);
      return `rgb(${r},${g},${b})`;
    }
    // decel: amber -> red
    const tt = Math.abs(t);
    const r = Math.round(amber.r + (red.r - amber.r) * tt);
    const g = Math.round(amber.g + (red.g - amber.g) * tt);
    const b = Math.round(amber.b + (red.b - amber.b) * tt);
    return `rgb(${r},${g},${b})`;
  }

  function positionAtTime(points, t) {
    if (!points || points.length === 0) return null;
    if (t <= points[0].time) return { ...points[0] };
    if (t >= points[points.length - 1].time) return { ...points[points.length - 1] };
    // binary search
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (points[mid].time <= t) lo = mid; else hi = mid;
    }
    const p1 = points[lo], p2 = points[hi];
    const span = p2.time - p1.time || 1;
    const alpha = (t - p1.time) / span;
    return {
      masterX: p1.masterX + (p2.masterX - p1.masterX) * alpha,
      masterY: p1.masterY + (p2.masterY - p1.masterY) * alpha,
      relS: p1.relS + (p2.relS - p1.relS) * alpha,
      lap: p1.lap,
      speedMPH: p1.speedMPH + (p2.speedMPH - p1.speedMPH) * alpha,
      speedKMH: p1.speedKMH + (p2.speedKMH - p1.speedKMH) * alpha,
      gear: p1.gear,
      delta: p1.delta + (p2.delta - p1.delta) * alpha,
      longAcc: p1.longAcc + (p2.longAcc - p1.longAcc) * alpha,
      latAcc: p1.latAcc + (p2.latAcc - p1.latAcc) * alpha,
      yawRate: p1.yawRate + (p2.yawRate - p1.yawRate) * alpha,
      yawDegS: p1.yawDegS + (p2.yawDegS - p1.yawDegS) * alpha,
      throttle: p1.throttle + (p2.throttle - p1.throttle) * alpha,
      brake: p1.brake + (p2.brake - p1.brake) * alpha,
      steerDeg: p1.steerDeg + (p2.steerDeg - p1.steerDeg) * alpha,
    };
  }

  function buildLegend() {
    legendEl.innerHTML = "";
    (data.cars || []).forEach((car, idx) => {
      const color = palette[idx % palette.length];
      const el = document.createElement("span");
      el.className = "swatch" + (selectedCar === idx ? " selected" : "");
      el.innerHTML = `<span class="dot" style="background:${color}"></span>${car.source || "car " + (idx + 1)}`;
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        selectedCar = selectedCar === idx ? null : idx;
        deltaPlayer.value = selectedCar === null ? 0 : idx;
        buildLegend();
        buildEvents();
        updateLive();
        updateDelta(true);
        draw();
      });
      legendEl.appendChild(el);
    });
    buildEventFilter();
  }

  function buildEventFilter() {
    if (!eventFilterEl) return;
    eventFilterEl.innerHTML = "";
    const types = ["crash", "collision", "reset", "surface", "overtake"];
    types.forEach((t) => {
      const id = `ev-${t}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = eventTypes.has(t);
      cb.addEventListener("change", (e) => {
        if (e.target.checked) eventTypes.add(t); else eventTypes.delete(t);
        buildEvents();
        renderStatic();
        draw();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` ${t}`));
      eventFilterEl.appendChild(label);
    });
    eventFilterEl.style.display = showEvents ? "flex" : "none";
  }

  function ms(x) { return (x * 1000).toFixed(0); }
  function fmt(t) {
    if (!isFinite(t)) return "-";
    const s = Math.floor(t);
    const msPart = Math.floor((t - s) * 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${ss.toString().padStart(2, "0")}.${msPart.toString().padStart(3, "0")}`;
  }

  function buildLaps() {
    lapsEl.innerHTML = "";
    (data.cars || []).forEach((car, idx) => {
      const color = palette[idx % palette.length];
      const title = document.createElement("h2");
      title.textContent = car.source || `Car ${idx + 1}`;
      title.style.color = color;
      lapsEl.appendChild(title);
      if (!car.lapTimes || car.lapTimes.length === 0) {
        const p = document.createElement("div");
        p.textContent = "No lap data";
        p.style.color = "#888";
        lapsEl.appendChild(p);
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      const head = document.createElement("tr");
      head.innerHTML = "<th>Lap</th><th>Lap Time</th><th>S1</th><th>Δ</th><th>S2</th><th>Δ</th><th>S3</th><th>Δ</th>";
      table.appendChild(head);
      car.lapTimes.forEach((lt) => {
        const row = document.createElement("tr");
        const deltas = lt.sectorDelta || [];
        const secs = lt.sectorTime || [];
        row.innerHTML = `
          <td>${lt.lap}</td>
          <td>${fmt(lt.lapTime)}</td>
          <td>${fmt(secs[0] ?? NaN)}</td>
          <td class="${deltaClass(deltas[0])}">${deltaText(deltas[0])}</td>
          <td>${fmt(secs[1] ?? NaN)}</td>
          <td class="${deltaClass(deltas[1])}">${deltaText(deltas[1])}</td>
          <td>${fmt(secs[2] ?? NaN)}</td>
          <td class="${deltaClass(deltas[2])}">${deltaText(deltas[2])}</td>
        `;
        table.appendChild(row);
      });
      wrap.appendChild(table);
      lapsEl.appendChild(wrap);
    });
  }

  function buildDeltaPlayer() {
    deltaPlayer.innerHTML = "";
    (data.cars || []).forEach((car, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = car.source || `Car ${idx + 1}`;
      deltaPlayer.appendChild(opt);
    });
    if (selectedCar !== null) {
      deltaPlayer.value = selectedCar;
    }
    deltaPlayer.addEventListener("change", () => {
      selectedCar = parseInt(deltaPlayer.value, 10);
      buildLegend();
      buildEvents();
      updateLive();
      updateDelta();
      updateSteering();
      draw();
    });
  }

  function deltaClass(d) {
    if (!isFinite(d) || d === 0) return "";
    return d > 0 ? "delta-neg" : "delta-pos";
  }
  function deltaText(d) {
    if (!isFinite(d)) return "";
    if (d === 0) return "0";
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(3)}`;
  }

  function eventColor(t) {
    switch ((t || "").toLowerCase()) {
      case "crash": return "#ff6b6b";
      case "collision": return "#f3a712";
      case "reset": return "#5dd39e";
      case "surface": return "#6bc5ff";
      case "overtake": return "#f78bff";
      default: return "#cdd7e1";
    }
  }

  function buildEvents() {
    eventsEl.innerHTML = "";
    const list = (data.events || []).filter((ev) => {
      if (selectedCar !== null) {
        const car = (data.cars || [])[selectedCar];
        if (car && ev.source !== car.source && ev.target !== car.source) return false;
      }
      if (!eventTypes.has((ev.type || "").toLowerCase())) return false;
      return true;
    });
    list.forEach((ev) => {
      const row = document.createElement("div");
      row.className = "event-row";
      const color = eventColor(ev.type);
      row.innerHTML = `
        <span class="dot" style="background:${color}"></span>
        <span class="pill" style="background:${color}22;border:1px solid ${color}55">${ev.type}</span>
        <span>${(ev.source || "").split("/").pop()}</span>
        <span>t=${ev.time?.toFixed(2) ?? "?"}s</span>
        <span>lap ${ev.lap ?? "?"}</span>
      `;
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const t = ev.time ?? 0;
        playing = false;
        playBtn.textContent = "Play";
        updateTime(t);
      });
      eventsEl.appendChild(row);
    });
  }

  fetchData();

  function computeMaxTime() {
    let m = 0;
    (data.cars || []).forEach((car) => {
      const pts = car.points || [];
      if (pts.length > 0) {
        m = Math.max(m, pts[pts.length - 1].time);
      }
    });
    return m;
  }

  function updateTime(t) {
    currentTime = Math.min(Math.max(0, t), maxTime || 0);
    scrub.value = currentTime;
    timeLabel.textContent = fmt(currentTime);
    updateHUD(true);
    draw();
  }

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    lastTs = performance.now();
    if (playing) requestAnimationFrame(tick);
  });

  scrub.addEventListener("input", (e) => {
    playing = false;
    playBtn.textContent = "Play";
    updateTime(parseFloat(e.target.value));
  });

  function tick(ts) {
    if (!playing) return;
    const elapsed = ts - lastTs;
    if (elapsed < frameCapMs) {
      requestAnimationFrame(tick);
      return;
    }
    lastTs = ts;
    const dt = elapsed / 1000;
    updateTime(currentTime + dt);
    if (currentTime >= maxTime) {
      playing = false;
      playBtn.textContent = "Play";
      return;
    }
    requestAnimationFrame(tick);
  }

  function updateHUD(force) {
    const now = performance.now();
    if (!force && now - lastHudUpdate < hudInterval) return;
    lastHudUpdate = now;
    updateDelta();
    updateSteering();
    updateLive();
  }

  function headAtTime(carIdx, t) {
    const car = (data.cars || [])[carIdx];
    if (!car || !car.points || car.points.length === 0) return null;
    const pts = car.points;
    let c = carCursors[carIdx] || 0;
    const last = pts.length - 1;
    if (t <= pts[0].time) {
      carCursors[carIdx] = 0;
      return { ...pts[0] };
    }
    if (t >= pts[last].time) {
      carCursors[carIdx] = last;
      return { ...pts[last] };
    }
    if (t < pts[c].time || t > pts[c+1]?.time) {
      // binary search
      let lo = 0, hi = last;
      while (hi - lo > 1) {
        const mid = (hi + lo) >> 1;
        if (pts[mid].time <= t) lo = mid; else hi = mid;
      }
      c = lo;
    } else {
      while (c + 1 < last && pts[c + 1].time < t) {
        c++;
      }
    }
    const p1 = pts[c];
    const p2 = pts[c + 1];
    const span = p2.time - p1.time || 1;
    const alpha = (t - p1.time) / span;
    carCursors[carIdx] = c;
    return {
      masterX: p1.masterX + (p2.masterX - p1.masterX) * alpha,
      masterY: p1.masterY + (p2.masterY - p1.masterY) * alpha,
      relS: p1.relS + (p2.relS - p1.relS) * alpha,
      lap: p1.lap,
      speedMPH: p1.speedMPH + (p2.speedMPH - p1.speedMPH) * alpha,
      speedKMH: p1.speedKMH + (p2.speedKMH - p1.speedKMH) * alpha,
      gear: p1.gear,
      delta: p1.delta + (p2.delta - p1.delta) * alpha,
      longAcc: p1.longAcc + (p2.longAcc - p1.longAcc) * alpha,
      latAcc: p1.latAcc + (p2.latAcc - p1.latAcc) * alpha,
      yawRate: p1.yawRate + (p2.yawRate - p1.yawRate) * alpha,
      yawDegS: p1.yawDegS + (p2.yawDegS - p1.yawDegS) * alpha,
      throttle: p1.throttle + (p2.throttle - p1.throttle) * alpha,
      brake: p1.brake + (p2.brake - p1.brake) * alpha,
      steerDeg: p1.steerDeg + (p2.steerDeg - p1.steerDeg) * alpha,
    };
  }

  function updateDelta() {
    const idx = parseInt(deltaPlayer.value || "0", 10) || 0;
    const car = (data.cars || [])[idx];
    if (!car || !car.points || car.points.length === 0) {
      deltaCtx.clearRect(0, 0, deltaCanvas.clientWidth, deltaCanvas.clientHeight);
      deltaInfo.textContent = "No data";
      return;
    }
    const head = positionAtTime(car.points, currentTime);
    if (!head) {
      deltaCtx.clearRect(0, 0, deltaCanvas.clientWidth, deltaCanvas.clientHeight);
      deltaInfo.textContent = "";
      return;
    }
    const lap = head.lap;
    const deltas = car.points.filter((p) => p.lap === lap && isFinite(p.delta));
    deltas.sort((a, b) => a.relS - b.relS);
    if (deltas.length === 0) {
      deltaCtx.clearRect(0, 0, deltaCanvas.clientWidth, deltaCanvas.clientHeight);
      deltaInfo.textContent = "";
      return;
    }
    const w = deltaCanvas.clientWidth;
    const h = deltaCanvas.clientHeight;
    deltaCtx.clearRect(0, 0, w, h);
    const xs = deltas.map((d) => d.relS);
    const ys = deltas.map((d) => d.delta || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    let maxAbs = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)));
    if (maxAbs === 0) maxAbs = 0.1;
    const minY = -maxAbs;
    const maxY = maxAbs;
    const toX = (v) => ((v - minX) / (maxX - minX || 1)) * w;
    // Positive delta (slower) is below midline; negative (faster) above.
    const mid = h / 2;
    const toY = (v) => mid + (v / maxAbs) * (h / 2);

    // zero line centered
    deltaCtx.strokeStyle = "rgba(255,255,255,0.3)";
    deltaCtx.lineWidth = 1;
    deltaCtx.beginPath();
    deltaCtx.moveTo(0, h / 2);
    deltaCtx.lineTo(w, h / 2);
    deltaCtx.stroke();

    // Build filled path closed to midline
    const fillPath = new Path2D();
    deltas.forEach((p, i) => {
      const x = toX(p.relS);
      const y = toY(p.delta || 0);
      if (i === 0) {
        fillPath.moveTo(x, mid);
        fillPath.lineTo(x, y);
      } else {
        fillPath.lineTo(x, y);
      }
      if (i === deltas.length - 1) {
        fillPath.lineTo(x, mid);
        fillPath.closePath();
      }
    });

    // Shade above (ahead/negative) in green
    deltaCtx.save();
    deltaCtx.beginPath();
    deltaCtx.rect(0, 0, w, mid);
    deltaCtx.clip();
    deltaCtx.fillStyle = "rgba(93, 211, 158, 0.25)";
    deltaCtx.fill(fillPath);
    deltaCtx.restore();

    // Shade below (behind/positive) in red
    deltaCtx.save();
    deltaCtx.beginPath();
    deltaCtx.rect(0, mid, w, mid);
    deltaCtx.clip();
    deltaCtx.fillStyle = "rgba(255, 107, 107, 0.25)";
    deltaCtx.fill(fillPath);
    deltaCtx.restore();

    // delta line
    deltaCtx.strokeStyle = palette[0];
    deltaCtx.lineWidth = 1.5;
    deltaCtx.beginPath();
    deltas.forEach((p, i) => {
      const x = toX(p.relS);
      const y = toY(p.delta || 0);
      if (i === 0) deltaCtx.moveTo(x, y); else deltaCtx.lineTo(x, y);
    });
    deltaCtx.stroke();

    // zero line on top again
    deltaCtx.strokeStyle = "rgba(255,255,255,0.4)";
    deltaCtx.lineWidth = 1;
    deltaCtx.beginPath();
    deltaCtx.moveTo(0, h / 2);
    deltaCtx.lineTo(w, h / 2);
    deltaCtx.stroke();

    deltaInfo.textContent = `${car.source} lap ${lap} delta vs best sectors`;
  }

  function updateSteering() {
    if (!steerCanvas || !steerCtx) return;
    const idx = selectedCar !== null ? selectedCar : parseInt(deltaPlayer.value || "0", 10) || 0;
    const car = (data.cars || [])[idx];
    if (!car || !car.points || car.points.length === 0) {
      steerCtx.clearRect(0, 0, steerCanvas.clientWidth, steerCanvas.clientHeight);
      if (steerInfo) steerInfo.textContent = "";
      return;
    }
    const head = positionAtTime(car.points, currentTime);
    if (!head) return;
    const lap = head.lap;
    const points = car.points.filter((p) => p.lap === lap && isFinite(p.steerDeg));
    points.sort((a, b) => a.relS - b.relS);
    if (points.length === 0) {
      steerCtx.clearRect(0, 0, steerCanvas.clientWidth, steerCanvas.clientHeight);
      if (steerInfo) steerInfo.textContent = "";
      return;
    }
    const w = steerCanvas.clientWidth;
    const h = steerCanvas.clientHeight;
    steerCtx.clearRect(0, 0, w, h);
    const xs = points.map((p) => p.relS);
    const ys = points.map((p) => p.steerDeg); // deg
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    let maxAbs = Math.max(Math.abs(Math.min(...ys)), Math.abs(Math.max(...ys)));
    if (maxAbs === 0) maxAbs = 0.1;
    const mid = h / 2;
    const toX = (v) => ((v - minX) / (maxX - minX || 1)) * w;
    const toY = (v) => mid + (v / maxAbs) * (h / 2);

    steerCtx.strokeStyle = "rgba(255,255,255,0.3)";
    steerCtx.lineWidth = 1;
    steerCtx.beginPath();
    steerCtx.moveTo(0, mid);
    steerCtx.lineTo(w, mid);
    steerCtx.stroke();

    steerCtx.strokeStyle = palette[idx % palette.length];
    steerCtx.lineWidth = 1.5;
    steerCtx.beginPath();
    points.forEach((p, i) => {
      const x = toX(p.relS);
      const y = toY(ys[i]);
      if (i === 0) steerCtx.moveTo(x, y); else steerCtx.lineTo(x, y);
    });
    steerCtx.stroke();

    if (steerInfo) {
      steerInfo.textContent = `${car.source} lap ${lap} steering (deg), ±${maxAbs.toFixed(1)} scale`;
    }
  }

  function updateLive() {
    if (!liveEl) return;
    liveEl.innerHTML = "";
    filteredCars().forEach((car, idx) => {
      const globalIdx = selectedCar !== null ? selectedCar : idx;
      const head = positionAtTime(car.points || [], currentTime);
      const speed = unit === "kmh" ? head?.speedKMH ?? null : head?.speedMPH ?? null;
      const gear = head?.gear ?? null;
      const throttle = head?.throttle ?? 0;
      const brake = head?.brake ?? 0;
      const latG = head && isFinite(head.latAcc) ? head.latAcc / 9.81 : null;
      const longG = head && isFinite(head.longAcc) ? head.longAcc / 9.81 : null;
      const yaw = head && isFinite(head.yawRate) ? head.yawRate * (180 / Math.PI) : null;
      const row = document.createElement("div");
      row.className = "live-row";
      const name = document.createElement("span");
      name.textContent = car.source || `Car ${globalIdx + 1}`;
      const vals = document.createElement("span");
      vals.textContent = `${speed ? speed.toFixed(1) : "--"} ${unit === "kmh" ? "km/h" : "mph"} | Gear ${gear ?? "-"}`;
      row.appendChild(name);
      row.appendChild(vals);
      liveEl.appendChild(row);

      const bar = document.createElement("div");
      bar.className = "speed-bar";
      const fill = document.createElement("div");
      fill.className = "speed-fill";
      const capped = Math.max(0, Math.min(1, (speed || 0) / maxSpeedEstimate()));
      fill.style.width = `${capped * 100}%`;
      bar.appendChild(fill);
      liveEl.appendChild(bar);
      const label = document.createElement("span");
      label.className = "speed-label";
      label.textContent = `0 - ${maxSpeedEstimate()} ${unit === "kmh" ? "km/h" : "mph"} scale`;
      liveEl.appendChild(label);

      // Controls / dynamics meters
      const shouldShowControls = showControls || selectedCar !== null;
      if (shouldShowControls) {
        liveEl.appendChild(makeMeter("Throttle", throttle, "#5dd39e"));
        liveEl.appendChild(makeMeter("Brake", brake, "#ff6b6b"));
      }

      const dynamics = document.createElement("div");
      dynamics.className = "live-row";
      const dynLabel = document.createElement("span");
      dynLabel.textContent = "Lat/Long/Yaw";
      const dynVals = document.createElement("span");
      dynVals.textContent = `${latG !== null ? latG.toFixed(2) : "--"}g / ${longG !== null ? longG.toFixed(2) : "--"}g / ${yaw !== null ? yaw.toFixed(1) : "--"}°/s`;
      dynamics.appendChild(dynLabel);
      dynamics.appendChild(dynVals);
      liveEl.appendChild(dynamics);
    });
  }

  function makeMeter(label, value, color) {
    const wrap = document.createElement("div");
    wrap.className = "meter";
    const row = document.createElement("div");
    row.className = "live-row meter-row";
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = `${(value * 100).toFixed(0)}%`;
    row.appendChild(l);
    row.appendChild(v);
    const bar = document.createElement("div");
    bar.className = "meter-bar";
    const fill = document.createElement("div");
    fill.className = "meter-fill";
    fill.style.background = color;
    fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    bar.appendChild(fill);
    wrap.appendChild(row);
    wrap.appendChild(bar);
    return wrap;
  }

  function maxSpeedEstimate() {
    const speeds = [];
    (data.cars || []).forEach((car) => {
      (car.points || []).forEach((p) => {
        const s = unit === "kmh" ? p.speedKMH : p.speedMPH;
        if (isFinite(s)) speeds.push(s);
      });
    });
    if (!speeds.length) return unit === "kmh" ? 300 : 200;
    speeds.sort((a, b) => a - b);
    const idx = Math.floor(speeds.length * 0.95);
    return Math.max(unit === "kmh" ? 100 : 60, Math.round(speeds[idx]));
  }
})();
