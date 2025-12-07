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
  const liveEl = document.getElementById("live");
  const livePanel = document.getElementById("livePanel");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsClose = document.getElementById("settingsClose");
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
  }

  function getBounds() {
    const pts = data.master || [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    // pad a bit
    const pad = 100;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  function project(pt, bounds, w, h) {
    const sx = w / (bounds.maxX - bounds.minX || 1);
    const sy = h / (bounds.maxY - bounds.minY || 1);
    const scale = Math.min(sx, sy) * 0.95;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const ox = w / 2;
    const oy = h / 2;
    return {
      x: ox + (pt.x - cx) * scale,
      y: oy - (pt.y - cy) * scale, // invert Y for screen
    };
  }

  const palette = [
    "#ffb100", "#6bc5ff", "#ff6b6b", "#7bd389", "#f78bff", "#ffd166",
    "#7af8ff", "#c084fc", "#90e0ef", "#ff9f1c",
  ];

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (staticCanvas.width && staticCanvas.height) {
      ctx.drawImage(staticCanvas, 0, 0);
    }
    const bounds = boundsCache || getBounds();

    // Cars (head only)
    (data.cars || []).forEach((car, idx) => {
      const color = palette[idx % palette.length];
      const head = headAtTime(idx, currentTime);
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
    };
  }

  function buildLegend() {
    legendEl.innerHTML = "";
    (data.cars || []).forEach((car, idx) => {
      const color = palette[idx % palette.length];
      const el = document.createElement("span");
      el.className = "swatch";
      el.innerHTML = `<span class="dot" style="background:${color}"></span>${car.source || "car " + (idx + 1)}`;
      legendEl.appendChild(el);
    });
    if ((data.events || []).length > 0) {
      const evs = document.createElement("span");
      evs.className = "swatch";
      evs.innerHTML = `<span class="dot" style="background:${eventColor("reset")}"></span>events`;
      legendEl.appendChild(evs);
    }
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
    deltaPlayer.addEventListener("change", () => {
      updateDelta();
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
      default: return "#cdd7e1";
    }
  }

  function buildEvents() {
    eventsEl.innerHTML = "";
    (data.events || []).forEach((ev) => {
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

  function updateLive() {
    if (!liveEl) return;
    liveEl.innerHTML = "";
    (data.cars || []).forEach((car, idx) => {
      const head = positionAtTime(car.points || [], currentTime);
      const speed = unit === "kmh" ? head?.speedKMH ?? null : head?.speedMPH ?? null;
      const gear = head?.gear ?? null;
      const row = document.createElement("div");
      row.className = "live-row";
      const name = document.createElement("span");
      name.textContent = car.source || `Car ${idx + 1}`;
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
    });
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
