/* ============================================================
   engine.js — drawing engine (pages, tools, pressure, zoom/pan)
   ============================================================ */

export const PAGE_W = 1240;   // logical page units (A4 ratio)
export const PAGE_H = 1754;

export const TOOLS = {
  fountain:    { variable: true,  alpha: 1,    composite: "source-over", min: 0.35, max: 1.6,  smooth: 0.55 },
  ballpoint:   { variable: false, alpha: 1,    composite: "source-over", min: 1,    max: 1,    smooth: 0.4  },
  pencil:      { variable: true,  alpha: 0.85, composite: "source-over", min: 0.7,  max: 1.1,  smooth: 0.3, grain: true },
  highlighter: { variable: false, alpha: 0.32, composite: "multiply",    min: 1,    max: 1,    smooth: 0.5, sizeMul: 4 },
};

export class Engine {
  constructor({ paper, ink, live, wrap, stage }) {
    this.paperCv = paper; this.inkCv = ink; this.liveCv = live;
    this.wrap = wrap; this.stage = stage;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.notebook = null;
    this.pageIndex = 0;

    this.tool = "fountain";
    this.color = "#1f2530";
    this.size = 5;

    this.scale = 1; this.tx = 0; this.ty = 0;
    this.undoStack = []; this.redoStack = [];

    this.drawing = false;
    this.current = null;
    this.lastPt = null;

    // multi-touch gesture + lasso state
    this.pointers = new Map();
    this.gesture = null;
    this._suppressDraw = false;
    this.selection = null;
    this._lassoPts = null;
    this._movingSel = false;

    this._setupCanvases();
    this._bindPointer();
    this.onChange = () => {};
    this.onHistory = () => {};
    this.onZoom = () => {};
  }

  get page() { return this.notebook.pages[this.pageIndex]; }

  _setupCanvases() {
    for (const cv of [this.paperCv, this.inkCv, this.liveCv]) {
      cv.width = PAGE_W * this.dpr;
      cv.height = PAGE_H * this.dpr;
      cv.style.width = PAGE_W + "px";
      cv.style.height = PAGE_H + "px";
      cv.getContext("2d").setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.wrap.style.width = PAGE_W + "px";
    this.wrap.style.height = PAGE_H + "px";
  }

  load(notebook, pageIndex = 0) {
    this.notebook = notebook;
    this.pageIndex = Math.max(0, Math.min(pageIndex, notebook.pages.length - 1));
    this.undoStack = []; this.redoStack = [];
    this.renderAll();
    this.fit();
    this.onHistory();
  }

  setPage(i) {
    if (i < 0 || i >= this.notebook.pages.length) return;
    this.clearSelection();
    this.pageIndex = i;
    this.undoStack = []; this.redoStack = [];
    this.renderAll();
    this.onHistory();
    this.onChange();
  }

  /* ---------------- rendering ---------------- */
  renderAll() { this._renderPaper(); this._renderInk(); }

  _renderPaper() {
    const ctx = this.paperCv.getContext("2d");
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    const p = this.page;

    // base color
    ctx.fillStyle = p.color || "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    // background image (scan / imported)
    if (p.bg) {
      const img = this._bgImg && this._bgImgSrc === p.bg ? this._bgImg : null;
      if (img) {
        this._drawCover(ctx, img);
      } else {
        const im = new Image();
        im.onload = () => { this._bgImg = im; this._bgImgSrc = p.bg; this._renderPaper(); };
        im.src = p.bg;
        return;
      }
    }

    // ruling
    const ruling = p.paper || "blank";
    if (ruling === "blank") return;
    ctx.strokeStyle = "rgba(60,90,160,0.18)";
    ctx.lineWidth = 1;
    const gap = 48;
    if (ruling === "lined") {
      for (let y = gap * 2; y < PAGE_H; y += gap) line(ctx, 60, y, PAGE_W - 40, y);
      ctx.strokeStyle = "rgba(220,90,90,0.25)";
      line(ctx, 90, 0, 90, PAGE_H);
    } else if (ruling === "grid") {
      for (let x = gap; x < PAGE_W; x += gap) line(ctx, x, 0, x, PAGE_H);
      for (let y = gap; y < PAGE_H; y += gap) line(ctx, 0, y, PAGE_W, y);
    } else if (ruling === "dots") {
      ctx.fillStyle = "rgba(60,90,160,0.3)";
      for (let x = gap; x < PAGE_W; x += gap)
        for (let y = gap; y < PAGE_H; y += gap) {
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
        }
    }
  }

  _drawCover(ctx, img) {
    const ir = img.width / img.height, pr = PAGE_W / PAGE_H;
    let w, h, x, y;
    if (ir > pr) { h = PAGE_H; w = h * ir; x = (PAGE_W - w) / 2; y = 0; }
    else { w = PAGE_W; h = w / ir; x = 0; y = (PAGE_H - h) / 2; }
    ctx.drawImage(img, x, y, w, h);
  }

  _renderInk() {
    const ctx = this.inkCv.getContext("2d");
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    for (const s of this.page.strokes) this._renderStroke(ctx, s);
  }

  _renderStroke(ctx, s) {
    const def = TOOLS[s.tool] || TOOLS.ballpoint;
    const pts = s.points;
    if (!pts.length) return;
    ctx.save();
    ctx.globalAlpha = def.alpha;
    ctx.globalCompositeOperation = def.composite;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const base = s.size * (def.sizeMul || 1);

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, base * (def.variable ? def.min : 1) / 2, 0, 7);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (!def.variable) {
      ctx.lineWidth = base;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    } else {
      // variable width: stroke each segment with interpolated width
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const pr = (a.p + b.p) / 2;
        const w = base * (def.min + (def.max - def.min) * pr);
        ctx.lineWidth = Math.max(0.4, w);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------------- pointer ---------------- */
  _bindPointer() {
    const live = this.liveCv;
    const opts = { passive: false };
    live.addEventListener("pointerdown", (e) => this._down(e), opts);
    live.addEventListener("pointermove", (e) => this._move(e), opts);
    live.addEventListener("pointerup", (e) => this._up(e), opts);
    live.addEventListener("pointercancel", (e) => this._up(e), opts);
    live.addEventListener("pointerleave", (e) => this._up(e), opts);
  }

  _toPage(e) {
    const r = this.wrap.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / this.scale,
      y: (e.clientY - r.top) / this.scale,
    };
  }

  _pressure(e, pt) {
    if (e.pointerType === "pen" && e.pressure > 0) return e.pressure;
    if (e.pointerType === "touch" && e.pressure > 0 && e.pressure !== 0.5) return e.pressure;
    // velocity-based fallback
    if (this.lastPt) {
      const d = Math.hypot(pt.x - this.lastPt.x, pt.y - this.lastPt.y);
      return Math.max(0.18, Math.min(1, 1 - d / 45));
    }
    return 0.6;
  }

  _touchCount() {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === "touch") n++;
    return n;
  }

  _down(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // two fingers -> pan/zoom gesture (works regardless of selected tool)
    if (e.pointerType !== "pen" && this._touchCount() >= 2) {
      this._cancelStroke();
      this._beginGesture();
      return;
    }
    if (this.gesture) return;
    if (this._suppressDraw) return;

    if (this.tool === "hand") { this._panStart(e); return; }
    e.preventDefault();
    try { this.liveCv.setPointerCapture(e.pointerId); } catch {}
    const pt = this._toPage(e);
    this.lastPt = pt;

    if (this.tool === "lasso") { this._lassoDown(pt); return; }

    if (this.tool === "eraser") {
      this.drawing = true; this._erased = [];
      this._erase(pt);
      return;
    }

    this.drawing = true;
    const p = this._pressure(e, pt);
    this.current = { tool: this.tool, color: this.color, size: this.size, points: [{ x: pt.x, y: pt.y, p }] };
    this._drawLive();
  }

  _move(e) {
    if (this.pointers.has(e.pointerId))
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (this.gesture) { this._gestureMove(); return; }
    if (this.tool === "hand") { this._panMove(e); return; }
    if (this.tool === "lasso") { if (this.drawing || this._movingSel) { e.preventDefault(); this._lassoMove(this._toPage(e)); } return; }
    if (!this.drawing) return;
    e.preventDefault();

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const pt = this._toPage(ev);
      if (this.tool === "eraser") { this._erase(pt); this.lastPt = pt; continue; }
      const p = this._pressure(ev, pt);
      const last = this.current.points[this.current.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.1) continue;
      this.current.points.push({ x: pt.x, y: pt.y, p });
      this.lastPt = pt;
    }
    if (this.tool !== "eraser") this._drawLive();
  }

  _up(e) {
    this.pointers.delete(e.pointerId);

    if (this.gesture) {
      if (this._touchCount() < 2) { this.gesture = null; this._suppressDraw = true; }
      if (this.pointers.size === 0) this._suppressDraw = false;
      return;
    }
    if (this.pointers.size === 0) this._suppressDraw = false;

    if (this.tool === "hand") { this._panEnd(); return; }

    if (this.tool === "lasso") { this._lassoUp(); return; }

    if (!this.drawing) return;
    this.drawing = false;
    this.lastPt = null;

    if (this.tool === "eraser") {
      if (this._erased && this._erased.length) {
        this.undoStack.push({ type: "erase", items: this._erased });
        this.redoStack = [];
        this._renderInk();
        this._commit();
      }
      this._erased = null;
      return;
    }

    if (this.current && this.current.points.length) {
      this.page.strokes.push(this.current);
      this.undoStack.push({ type: "add", stroke: this.current });
      this.redoStack = [];
      this._renderInk();
      this._clearLive();
      this._commit();
    }
    this.current = null;
  }

  _cancelStroke() {
    if (this.drawing && this.current) { this.current = null; this._clearLive(); }
    this.drawing = false;
    this.lastPt = null;
  }

  /* ---------------- two-finger pan/zoom ---------------- */
  _twoTouches() {
    const pts = [];
    for (const p of this.pointers.values()) if (p.type === "touch") pts.push(p);
    return pts.slice(0, 2);
  }
  _beginGesture() {
    const [a, b] = this._twoTouches();
    if (!a || !b) return;
    const r = this.stage.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    this.gesture = {
      dist, scale: this.scale,
      contentX: (mid.x - this.tx) / this.scale,
      contentY: (mid.y - this.ty) / this.scale,
    };
  }
  _gestureMove() {
    const [a, b] = this._twoTouches();
    if (!a || !b) return;
    const r = this.stage.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const g = this.gesture;
    this.scale = Math.max(0.2, Math.min(6, g.scale * (dist / g.dist)));
    this.tx = mid.x - g.contentX * this.scale;
    this.ty = mid.y - g.contentY * this.scale;
    this._apply();
  }

  /* ---------------- lasso select & move ---------------- */
  _lassoDown(pt) {
    if (this.selection && this._inBBox(pt, this.selection.bbox, 12 / this.scale)) {
      this._movingSel = true;
      this._moveLast = pt;
      this._moveAccum = { dx: 0, dy: 0 };
    } else {
      this.selection = null;
      this._lassoPts = [pt];
      this.drawing = true;
      this._clearLive();
    }
  }
  _lassoMove(pt) {
    if (this._movingSel) {
      const dx = pt.x - this._moveLast.x, dy = pt.y - this._moveLast.y;
      for (const s of this.selection.strokes)
        for (const p of s.points) { p.x += dx; p.y += dy; }
      this.selection.bbox.x += dx; this.selection.bbox.y += dy;
      this._moveAccum.dx += dx; this._moveAccum.dy += dy;
      this._moveLast = pt;
      this._renderInk();
      this._drawSelOverlay();
    } else if (this.drawing) {
      this._lassoPts.push(pt);
      this._drawLassoPath();
    }
  }
  _lassoUp() {
    if (this._movingSel) {
      this._movingSel = false;
      if (this._moveAccum && (this._moveAccum.dx || this._moveAccum.dy)) {
        this.undoStack.push({ type: "move", strokes: this.selection.strokes.slice(), dx: this._moveAccum.dx, dy: this._moveAccum.dy });
        this.redoStack = [];
        this._commit();
      }
      this._drawSelOverlay();
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;
    const poly = this._lassoPts || [];
    this._lassoPts = null;
    if (poly.length < 3) { this._clearLive(); return; }
    const sel = [];
    for (const s of this.page.strokes) {
      let inside = 0;
      for (const p of s.points) if (pointInPoly(p, poly)) inside++;
      if (inside > s.points.length * 0.5) sel.push(s);
    }
    if (!sel.length) { this.selection = null; this._clearLive(); return; }
    this.selection = { strokes: sel, bbox: strokesBBox(sel) };
    this._drawSelOverlay();
  }
  _inBBox(pt, b, pad = 0) {
    return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
  }
  _drawLassoPath() {
    const ctx = this.liveCv.getContext("2d");
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = "#6c8cff";
    ctx.fillStyle = "rgba(108,140,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(this._lassoPts[0].x, this._lassoPts[0].y);
    for (const p of this._lassoPts) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  _drawSelOverlay() {
    const ctx = this.liveCv.getContext("2d");
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    if (!this.selection) return;
    const b = this.selection.bbox;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = "#6c8cff";
    ctx.fillStyle = "rgba(108,140,255,0.06)";
    const pad = 8 / this.scale;
    ctx.beginPath();
    ctx.rect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  clearSelection() {
    this.selection = null; this._lassoPts = null; this._movingSel = false;
    this._clearLive();
  }

  _drawLive() {
    const ctx = this.liveCv.getContext("2d");
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    if (this.current) this._renderStroke(ctx, this.current);
  }
  _clearLive() { this.liveCv.getContext("2d").clearRect(0, 0, PAGE_W, PAGE_H); }

  _erase(pt) {
    const r = this.size * 3 + 6;
    const strokes = this.page.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (this._hit(s, pt, r)) {
        this._erased.push({ index: i, stroke: s });
        strokes.splice(i, 1);
        this._renderInk();
      }
    }
  }
  _hit(s, pt, r) {
    for (const p of s.points) if (Math.hypot(p.x - pt.x, p.y - pt.y) < r) return true;
    return false;
  }

  /* ---------------- history ---------------- */
  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    if (a.type === "add") {
      const i = this.page.strokes.indexOf(a.stroke);
      if (i >= 0) this.page.strokes.splice(i, 1);
    } else if (a.type === "erase") {
      for (const it of a.items.slice().reverse()) this.page.strokes.splice(it.index, 0, it.stroke);
    } else if (a.type === "move") {
      for (const s of a.strokes) for (const p of s.points) { p.x -= a.dx; p.y -= a.dy; }
      this.clearSelection();
    }
    this.redoStack.push(a);
    this._renderInk(); this._commit();
  }
  redo() {
    const a = this.redoStack.pop();
    if (!a) return;
    if (a.type === "add") this.page.strokes.push(a.stroke);
    else if (a.type === "erase") for (const it of a.items) {
      const idx = this.page.strokes.indexOf(it.stroke);
      if (idx >= 0) this.page.strokes.splice(idx, 1);
    } else if (a.type === "move") {
      for (const s of a.strokes) for (const p of s.points) { p.x += a.dx; p.y += a.dy; }
      this.clearSelection();
    }
    this.undoStack.push(a);
    this._renderInk(); this._commit();
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  clearPage() {
    if (!this.page.strokes.length) return;
    this.undoStack.push({ type: "erase", items: this.page.strokes.map((s, i) => ({ index: i, stroke: s })) });
    this.page.strokes = [];
    this.redoStack = [];
    this._renderInk(); this._commit();
  }

  _commit() { this.onHistory(); this.onChange(); }

  /* ---------------- zoom / pan ---------------- */
  _apply() {
    this.wrap.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.onZoom();
  }
  fit() {
    const r = this.stage.getBoundingClientRect();
    const pad = 40;
    const s = Math.min((r.width - pad) / PAGE_W, (r.height - pad) / PAGE_H);
    this.scale = s;
    this.tx = (r.width - PAGE_W * s) / 2;
    this.ty = Math.max(20, (r.height - PAGE_H * s) / 2);
    this._apply();
  }
  zoomBy(f, cx, cy) {
    const r = this.stage.getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const ns = Math.max(0.2, Math.min(6, this.scale * f));
    const k = ns / this.scale;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.scale = ns;
    this._apply();
  }
  setZoom(s) { this.zoomBy(s / this.scale); }

  _panStart(e) { this._pan = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty }; }
  _panMove(e) {
    if (!this._pan) return;
    this.tx = this._pan.tx + (e.clientX - this._pan.x);
    this.ty = this._pan.ty + (e.clientY - this._pan.y);
    this._apply();
  }
  _panEnd() { this._pan = null; }

  /* ---------------- export ---------------- */
  renderPageToCanvas(page) {
    const cv = document.createElement("canvas");
    cv.width = PAGE_W; cv.height = PAGE_H;
    const ctx = cv.getContext("2d");

    ctx.fillStyle = page.color || "#fff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    return new Promise((resolve) => {
      const finish = () => {
        drawRuling(ctx, page);
        for (const s of page.strokes) this._renderStroke(ctx, s);
        resolve(cv);
      };
      if (page.bg) {
        const im = new Image();
        im.onload = () => { this._drawCover(ctx, im); finish(); };
        im.onerror = finish;
        im.src = page.bg;
      } else finish();
    });
  }
}

function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function strokesBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawRuling(ctx, p) {
  const ruling = p.paper || "blank";
  if (ruling === "blank") return;
  ctx.save();
  ctx.strokeStyle = "rgba(60,90,160,0.18)";
  ctx.lineWidth = 1;
  const gap = 48;
  if (ruling === "lined") {
    for (let y = gap * 2; y < PAGE_H; y += gap) line(ctx, 60, y, PAGE_W - 40, y);
    ctx.strokeStyle = "rgba(220,90,90,0.25)";
    line(ctx, 90, 0, 90, PAGE_H);
  } else if (ruling === "grid") {
    for (let x = gap; x < PAGE_W; x += gap) line(ctx, x, 0, x, PAGE_H);
    for (let y = gap; y < PAGE_H; y += gap) line(ctx, 0, y, PAGE_W, y);
  } else if (ruling === "dots") {
    ctx.fillStyle = "rgba(60,90,160,0.3)";
    for (let x = gap; x < PAGE_W; x += gap)
      for (let y = gap; y < PAGE_H; y += gap) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}
