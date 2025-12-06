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

  let data = null;
  let playing = false;
  let lastTs = 0;
  let currentTime = 0;
  let maxTime = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (data) draw();
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
        buildLegend();
        buildLaps();
        buildEvents();
        resize();
      })
      .catch((err) => {
        statusEl.textContent = `Failed to load data.json: ${err}`;
        console.error(err);
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

    const bounds = getBounds();

    // Master track
    ctx.strokeStyle = "#6e7791";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.master.forEach((p, i) => {
      const { x, y } = project(p, bounds, w, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Cars (head only)
    (data.cars || []).forEach((car, idx) => {
      const color = palette[idx % palette.length];
      const pts = car.points || [];
      // head
      const head = positionAtTime(pts, currentTime);
      if (head) {
        const { x, y } = project(head, bounds, w, h);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Events
    (data.events || []).forEach((ev) => {
      const { x, y } = project({ x: ev.masterX, y: ev.masterY }, bounds, w, h);
      const color = eventColor(ev.type);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function positionAtTime(points, t) {
    if (!points || points.length === 0) return null;
    if (t <= points[0].time) return { x: points[0].masterX, y: points[0].masterY };
    if (t >= points[points.length - 1].time) return { x: points[points.length - 1].masterX, y: points[points.length - 1].masterY };
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
      x: p1.masterX + (p2.masterX - p1.masterX) * alpha,
      y: p1.masterY + (p2.masterY - p1.masterY) * alpha,
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
      lapsEl.appendChild(table);
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
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    updateTime(currentTime + dt);
    if (currentTime >= maxTime) {
      playing = false;
      playBtn.textContent = "Play";
      return;
    }
    requestAnimationFrame(tick);
  }
})();
