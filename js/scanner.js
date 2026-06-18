/* ============================================================
   scanner.js — camera document scanner
   auto edge detection + draggable corners + perspective unwarp
   ============================================================ */
export class Scanner {
  constructor(root) {
    this.root = root;
    this.video = root.querySelector("#cam");
    this.capCanvas = root.querySelector("#scan-canvas");
    this.review = root.querySelector("#scan-review");
    this.editCv = root.querySelector("#scan-edit");
    this.stream = null;
    this.facing = "environment";
    this.filter = "color";
    this.rawData = null;      // full-res ImageData
    this.corners = null;      // in display coords [TL,TR,BR,BL]
    this.dispScale = 1;
    this.drag = -1;
    this.resolve = null;

    root.querySelector("#scan-close").onclick = () => this.cancel();
    root.querySelector("#scan-flip").onclick = () => this.flip();
    root.querySelector("#scan-shoot").onclick = () => this.shoot();
    root.querySelector("#scan-retake").onclick = () => this.retake();
    root.querySelector("#scan-auto").onclick = () => this.autoCorners();
    root.querySelector("#scan-use").onclick = () => this.use();

    root.querySelectorAll("#filter-seg button").forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll("#filter-seg button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.filter = b.dataset.filter;
        this._renderEdit();
      };
    });

    this._bindEdit();
  }

  open() {
    return new Promise(async (resolve) => {
      this.resolve = resolve;
      this.root.classList.remove("hidden");
      this.review.classList.add("hidden");
      this.rawData = null;
      try {
        await this._start();
      } catch (err) {
        alert("Kamera nicht verfügbar: " + err.message +
          "\nTipp: HTTPS oder localhost nötig, und Kamerazugriff erlauben.");
        this.cancel();
      }
    });
  }

  async _start() {
    this._stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
  }
  _stop() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  async flip() {
    this.facing = this.facing === "environment" ? "user" : "environment";
    try { await this._start(); } catch (e) {}
  }

  shoot() {
    const v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w) return;
    const cv = this.capCanvas;
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(v, 0, 0, w, h);
    this.rawData = cv.getContext("2d").getImageData(0, 0, w, h);
    this._stop();
    this.review.classList.remove("hidden");
    this._layoutEdit();
    this.autoCorners();
  }

  retake() {
    this.review.classList.add("hidden");
    this.rawData = null;
    this._start().catch(() => {});
  }

  /* ---------------- edit canvas ---------------- */
  _layoutEdit() {
    const area = this.root.querySelector("#scan-edit-area");
    const ar = area.getBoundingClientRect();
    const iw = this.rawData.width, ih = this.rawData.height;
    const maxW = ar.width - 8, maxH = ar.height - 8;
    this.dispScale = Math.min(maxW / iw, maxH / ih);
    const dw = Math.round(iw * this.dispScale), dh = Math.round(ih * this.dispScale);
    this.editCv.width = dw; this.editCv.height = dh;
    this.editCv.style.width = dw + "px";
    this.editCv.style.height = dh + "px";
  }

  _renderEdit() {
    if (!this.rawData) return;
    const ctx = this.editCv.getContext("2d");
    const dw = this.editCv.width, dh = this.editCv.height;

    // filtered preview of the full photo (for visual feedback)
    const tmp = document.createElement("canvas");
    tmp.width = this.rawData.width; tmp.height = this.rawData.height;
    const tctx = tmp.getContext("2d");
    const out = tctx.createImageData(this.rawData.width, this.rawData.height);
    applyFilter(this.rawData.data, out.data, this.filter, this.rawData.width, this.rawData.height);
    tctx.putImageData(out, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(tmp, 0, 0, dw, dh);

    if (!this.corners) return;
    const c = this.corners;
    // shaded outside
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, dw, dh);
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill("evenodd");
    ctx.restore();

    // quad outline
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
    ctx.closePath();
    ctx.strokeStyle = "#6c8cff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // handles
    for (const p of c) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, 7);
      ctx.fillStyle = "rgba(108,140,255,0.25)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, 7);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#6c8cff"; ctx.stroke();
    }
  }

  _bindEdit() {
    const cv = this.editCv;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
    };
    cv.addEventListener("pointerdown", (e) => {
      if (!this.corners) return;
      e.preventDefault();
      const p = pos(e);
      let best = -1, bd = 26;
      this.corners.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = i; } });
      this.drag = best;
      if (best >= 0) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (this.drag < 0) return;
      e.preventDefault();
      const p = pos(e);
      this.corners[this.drag] = {
        x: Math.max(0, Math.min(cv.width, p.x)),
        y: Math.max(0, Math.min(cv.height, p.y)),
      };
      this._renderEdit();
    });
    const end = () => { this.drag = -1; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  /* ---------------- auto corner detection ---------------- */
  autoCorners() {
    const det = detectDocumentCorners(this.rawData);
    if (det) {
      this.corners = det.map((p) => ({ x: p.x * this.dispScale, y: p.y * this.dispScale }));
    } else {
      // fallback: small inset rectangle
      const dw = this.editCv.width, dh = this.editCv.height, m = 0.06;
      this.corners = [
        { x: dw * m, y: dh * m }, { x: dw * (1 - m), y: dh * m },
        { x: dw * (1 - m), y: dh * (1 - m) }, { x: dw * m, y: dh * (1 - m) },
      ];
    }
    this._renderEdit();
  }

  /* ---------------- finalize ---------------- */
  use() {
    // corners back to full-res image coords
    const src = this.corners.map((p) => ({ x: p.x / this.dispScale, y: p.y / this.dispScale }));
    const warped = warpPerspective(this.rawData, src);   // ImageData
    // apply filter to warped result
    const fcv = document.createElement("canvas");
    fcv.width = warped.width; fcv.height = warped.height;
    const fctx = fcv.getContext("2d");
    const out = fctx.createImageData(warped.width, warped.height);
    applyFilter(warped.data, out.data, this.filter, warped.width, warped.height);
    fctx.putImageData(out, 0, 0);
    this._finish(fcv.toDataURL("image/jpeg", 0.9));
  }

  cancel() { this._finish(null); }

  _finish(val) {
    this._stop();
    this.root.classList.add("hidden");
    this.review.classList.add("hidden");
    const r = this.resolve; this.resolve = null;
    if (r) r(val);
  }
}

/* ============================================================
   IMAGE FILTERS
   ============================================================ */
function applyFilter(src, dst, mode, w, h) {
  if (mode === "color") {
    const c = 1.18, b = 12;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = clamp((src[i] - 128) * c + 128 + b);
      dst[i + 1] = clamp((src[i + 1] - 128) * c + 128 + b);
      dst[i + 2] = clamp((src[i + 2] - 128) * c + 128 + b);
      dst[i + 3] = 255;
    }
    return;
  }
  if (mode === "gray") {
    const c = 1.25, b = 10;
    for (let i = 0; i < src.length; i += 4) {
      let g = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      g = clamp((g - 128) * c + 128 + b);
      dst[i] = dst[i + 1] = dst[i + 2] = g; dst[i + 3] = 255;
    }
    return;
  }
  adaptiveThreshold(src, dst, w, h);
}

/* Local adaptive threshold (mean of integral-image window) for clean B/W docs */
function adaptiveThreshold(src, dst, w, h) {
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < src.length; i += 4, j++)
    gray[j] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];

  // integral image
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowsum = 0;
    for (let x = 0; x < w; x++) {
      rowsum += gray[y * w + x];
      I[(y + 1) * (w + 1) + (x + 1)] = I[y * (w + 1) + (x + 1)] + rowsum;
    }
  }
  const rad = Math.max(8, Math.floor(Math.min(w, h) / 30));
  const T = 0.86; // pixel kept white unless notably darker than local mean
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = I[(y1 + 1) * (w + 1) + (x1 + 1)] - I[y0 * (w + 1) + (x1 + 1)]
        - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / area;
      const v = gray[y * w + x] < mean * T ? 0 : 255;
      const i = (y * w + x) * 4;
      dst[i] = dst[i + 1] = dst[i + 2] = v; dst[i + 3] = 255;
    }
  }
}

/* ============================================================
   AUTO DOCUMENT CORNER DETECTION
   Heuristic: downscale -> grayscale -> Sobel edges -> threshold
   -> take edge points, find quad via extreme sums/diffs.
   ============================================================ */
function detectDocumentCorners(imgData) {
  const W = imgData.width, H = imgData.height;
  const maxDim = 320;
  const scale = Math.min(1, maxDim / Math.max(W, H));
  const sw = Math.max(8, Math.round(W * scale)), sh = Math.max(8, Math.round(H * scale));

  // downscale via canvas
  const big = document.createElement("canvas");
  big.width = W; big.height = H; big.getContext("2d").putImageData(imgData, 0, 0);
  const sc = document.createElement("canvas");
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext("2d");
  sctx.drawImage(big, 0, 0, sw, sh);
  const d = sctx.getImageData(0, 0, sw, sh).data;

  const gray = new Float32Array(sw * sh);
  for (let i = 0, j = 0; i < d.length; i += 4, j++)
    gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Sobel magnitude
  const mag = new Float32Array(sw * sh);
  let maxM = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const gx = -gray[i - sw - 1] - 2 * gray[i - 1] - gray[i + sw - 1]
        + gray[i - sw + 1] + 2 * gray[i + 1] + gray[i + sw + 1];
      const gy = -gray[i - sw - 1] - 2 * gray[i - sw] - gray[i - sw + 1]
        + gray[i + sw - 1] + 2 * gray[i + sw] + gray[i + sw + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m; if (m > maxM) maxM = m;
    }
  }
  if (maxM < 1) return null;

  const thr = maxM * 0.28;
  // collect strong edge points, ignoring a thin border frame
  const pts = [];
  const bx = Math.round(sw * 0.02), by = Math.round(sh * 0.02);
  for (let y = by; y < sh - by; y++)
    for (let x = bx; x < sw - bx; x++)
      if (mag[y * sw + x] > thr) pts.push(x, y);

  if (pts.length < 40) return null;

  // find extremes: TL(min x+y), BR(max x+y), TR(max x-y), BL(min x-y)
  let tl = 0, br = 0, tr = 0, bl = 0;
  let tlV = Infinity, brV = -Infinity, trV = -Infinity, blV = Infinity;
  for (let k = 0; k < pts.length; k += 2) {
    const x = pts[k], y = pts[k + 1];
    const s = x + y, diff = x - y;
    if (s < tlV) { tlV = s; tl = k; }
    if (s > brV) { brV = s; br = k; }
    if (diff > trV) { trV = diff; tr = k; }
    if (diff < blV) { blV = diff; bl = k; }
  }
  const P = (k) => ({ x: pts[k] / scale, y: pts[k + 1] / scale });
  const corners = [P(tl), P(tr), P(br), P(bl)];

  // sanity: reject if quad too small (< 25% area) -> let caller fallback
  const area = quadArea(corners);
  if (area < W * H * 0.18) return null;
  return corners;
}

function quadArea(c) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* ============================================================
   PERSPECTIVE WARP
   src corners [TL,TR,BR,BL] in image coords -> flat rectangle
   ============================================================ */
function warpPerspective(imgData, src) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let outW = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])));
  let outH = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])));
  const cap = 2000;
  const sc = Math.min(1, cap / Math.max(outW, outH));
  outW = Math.max(16, Math.round(outW * sc));
  outH = Math.max(16, Math.round(outH * sc));

  const dst = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
  const H = getPerspective(dst, src); // maps output -> source

  const sw = imgData.width, sh = imgData.height, sd = imgData.data;
  const out = new ImageData(outW, outH);
  const od = out.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      const oi = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        od[oi] = od[oi + 1] = od[oi + 2] = 255; od[oi + 3] = 255; continue;
      }
      // bilinear
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        od[oi + c] = top * (1 - fy) + bot * fy;
      }
      od[oi + 3] = 255;
    }
  }
  return out;
}

/* homography mapping src4 -> dst4 (returns 3x3 row-major, length 9) */
function getPerspective(srcPts, dstPts) {
  // Solve for h (8 unknowns) in A h = b
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcPts[i], { x: X, y: Y } = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/* Gaussian elimination for 8x8 system */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-9;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
