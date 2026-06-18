/* ============================================================
   app.js — application controller (library + editor + modals)
   ============================================================ */
import { Storage, uid } from "./storage.js";
import { Engine, PAGE_W, PAGE_H } from "./engine.js";
import { Scanner } from "./scanner.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const COLORS = [
  "#1f2530", "#2f6df6", "#e8453c", "#16a34a", "#f59e0b",
  "#9333ea", "#db2777", "#0891b2", "#78350f", "#ffffff",
];
const COVER_GRADIENTS = [
  "linear-gradient(135deg,#6c8cff,#9d7bff)",
  "linear-gradient(135deg,#ff8f6b,#ff5fa2)",
  "linear-gradient(135deg,#2dd4bf,#3b82f6)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#34d399,#059669)",
  "linear-gradient(135deg,#a78bfa,#7c3aed)",
  "linear-gradient(135deg,#22d3ee,#0ea5e9)",
  "linear-gradient(135deg,#fb7185,#e11d48)",
];

const state = { notebooks: [], sort: "updated", query: "", current: null };

let engine, scanner;

/* ============================================================
   INIT
   ============================================================ */
init();
async function init() {
  engine = new Engine({
    paper: $("#paper"), ink: $("#ink"), live: $("#live"),
    wrap: $("#canvas-wrap"), stage: $("#stage"),
  });
  engine.onHistory = updateHistoryButtons;
  engine.onChange = debouncedSave;
  engine.onZoom = updateZoomLabel;

  scanner = new Scanner($("#scanner"));

  buildColorSwatches();
  wireLibrary();
  wireEditor();
  setTool("fountain");
  setColor(COLORS[0]);
  setSize(5);

  await refreshLibrary();
  registerSW();

  window.addEventListener("resize", () => { if ($("#editor").classList.contains("active")) engine.fit(); });
}

/* ============================================================
   LIBRARY
   ============================================================ */
function wireLibrary() {
  $("#btn-new").onclick = () => openNewNotebookModal();
  $("#btn-scan-lib").onclick = () => scanToNewNotebook();
  $("#search").addEventListener("input", (e) => { state.query = e.target.value.toLowerCase(); renderLibrary(); });
  $$("#sort-seg button").forEach((b) => b.onclick = () => {
    $$("#sort-seg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.sort = b.dataset.sort; renderLibrary();
  });
}

async function refreshLibrary() {
  state.notebooks = await Storage.all();
  renderLibrary();
}

function renderLibrary() {
  const grid = $("#grid");
  let items = state.notebooks.slice();
  if (state.query) items = items.filter((n) => n.title.toLowerCase().includes(state.query));
  items.sort((a, b) => {
    if (state.sort === "name") return a.title.localeCompare(b.title);
    if (state.sort === "created") return b.created - a.created;
    return b.updated - a.updated;
  });

  $("#empty-state").classList.toggle("hidden", state.notebooks.length > 0);
  grid.innerHTML = "";
  for (const nb of items) grid.appendChild(cardEl(nb));
}

function cardEl(nb) {
  const card = document.createElement("div");
  card.className = "card";
  const grad = COVER_GRADIENTS[(nb.coverIdx ?? 0) % COVER_GRADIENTS.length];
  const thumb = nb.thumb ? `<div class="cover-thumb" style="background-image:url('${nb.thumb}')"></div>` : "";
  card.innerHTML = `
    <div class="cover" style="background:${grad}">
      ${thumb}
      <span class="cover-badge">${nb.pages.length} S.</span>
      <div class="cover-title">${escapeHtml(nb.title)}</div>
    </div>
    <div class="card-meta">
      <div class="nm">${escapeHtml(nb.title)}</div>
      <div class="dt">${fmtDate(nb.updated)}</div>
    </div>`;
  card.querySelector(".cover").onclick = () => openNotebook(nb.id);
  card.querySelector(".card-meta").onclick = () => openNotebook(nb.id);
  return card;
}

function openNewNotebookModal() {
  const papers = [
    { id: "blank", lbl: "Blanko" }, { id: "lined", lbl: "Liniert" },
    { id: "grid", lbl: "Kariert" }, { id: "dots", lbl: "Punkte" },
  ];
  const body = document.createElement("div");
  body.innerHTML = `
    <h3>Neues Notizbuch</h3>
    <p>Titel, Cover und Papierart wählen.</p>
    <input class="field" id="m-title" placeholder="Titel" value="Notizbuch" />
    <div class="label">Cover</div>
    <div class="opt-grid" id="m-covers"></div>
    <div class="label">Papier</div>
    <div class="opt-grid" id="m-papers"></div>
    <div class="row">
      <button class="btn ghost" data-close>Abbrechen</button>
      <button class="btn primary" id="m-create">Erstellen</button>
    </div>`;
  let coverIdx = 0, paper = "lined";
  const cg = body.querySelector("#m-covers");
  COVER_GRADIENTS.forEach((g, i) => {
    const d = document.createElement("div");
    d.className = "opt" + (i === 0 ? " sel" : "");
    d.style.background = g;
    d.onclick = () => { coverIdx = i; cg.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel")); d.classList.add("sel"); };
    cg.appendChild(d);
  });
  const pg = body.querySelector("#m-papers");
  papers.forEach((p) => {
    const d = document.createElement("div");
    d.className = "opt" + (p.id === paper ? " sel" : "");
    d.style.background = paperPreview(p.id);
    d.textContent = p.lbl;
    d.onclick = () => { paper = p.id; pg.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel")); d.classList.add("sel"); };
    pg.appendChild(d);
  });
  const m = modal(body);
  body.querySelector("#m-create").onclick = async () => {
    const title = body.querySelector("#m-title").value.trim() || "Notizbuch";
    const nb = newNotebook(title, paper, coverIdx);
    await Storage.put(nb);
    m.close();
    await refreshLibrary();
    openNotebook(nb.id);
  };
}

function newNotebook(title, paper, coverIdx) {
  return {
    id: uid(), title, coverIdx, created: Date.now(), updated: Date.now(),
    thumb: null,
    pages: [newPage(paper)],
  };
}
function newPage(paper = "blank", bg = null) {
  return { id: uid(), paper, color: "#ffffff", bg, strokes: [], texts: [] };
}

/* ============================================================
   EDITOR
   ============================================================ */
function wireEditor() {
  $("#btn-back").onclick = () => closeEditor();
  $("#doc-title").addEventListener("input", (e) => { state.current.title = e.target.value; debouncedSave(); });
  $("#btn-undo").onclick = () => engine.undo();
  $("#btn-redo").onclick = () => engine.redo();
  $("#btn-prev-page").onclick = () => gotoPage(engine.pageIndex - 1);
  $("#btn-next-page").onclick = () => gotoPage(engine.pageIndex + 1);
  $("#page-indicator").onclick = () => openPagesOverview();
  $("#page-indicator").style.cursor = "pointer";
  $("#btn-add-page").onclick = () => addPage();
  $("#btn-scan-ed").onclick = () => scanToCurrent();
  $("#btn-export").onclick = () => openExportMenu();
  $("#btn-menu").onclick = () => openEditorMenu();

  $$(".tool").forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  $$(".size-dot").forEach((b) => b.onclick = () => setSize(parseFloat(b.dataset.size)));
  $$(".shape-btn").forEach((b) => b.onclick = () => setShape(b.dataset.shape));
  $("#custom-color").addEventListener("input", (e) => setColor(e.target.value, true));

  engine.onTextPlace = (x, y, existing) => editText(existing, x, y);

  $("#zoom-in").onclick = () => engine.zoomBy(1.2);
  $("#zoom-out").onclick = () => engine.zoomBy(1 / 1.2);
  $("#zoom-fit").onclick = () => { engine.fit(); updateZoomLabel(); };

  // wheel zoom on desktop
  $("#stage").addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = $("#stage").getBoundingClientRect();
    engine.zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top);
    updateZoomLabel();
  }, { passive: false });

  // keyboard
  document.addEventListener("keydown", (e) => {
    if (!$("#editor").classList.contains("active")) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); e.shiftKey ? engine.redo() : engine.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); engine.redo(); }
    const map = { f: "fountain", b: "ballpoint", p: "pencil", h: "highlighter", e: "eraser", v: "hand", l: "lasso", s: "shapes", t: "text" };
    if (map[e.key]) setTool(map[e.key]);
  });
}

async function openNotebook(id) {
  const nb = await Storage.get(id);
  if (!nb) return;
  state.current = nb;
  $("#doc-title").value = nb.title;
  $("#library").classList.remove("active");
  $("#editor").classList.add("active");
  engine.load(nb, 0);
  updatePageIndicator();
  updateZoomLabel();
}

async function closeEditor() {
  await saveCurrent(true);
  $("#editor").classList.remove("active");
  $("#library").classList.add("active");
  state.current = null;
  await refreshLibrary();
}

function gotoPage(i) {
  if (i < 0 || i >= state.current.pages.length) return;
  engine.setPage(i);
  updatePageIndicator();
  updateZoomLabel();
  engine.fit();
}

function addPage(paper) {
  const p = newPage(paper ?? engine.page.paper);
  state.current.pages.push(p);
  engine.setPage(state.current.pages.length - 1);
  updatePageIndicator();
  engine.fit();
  saveCurrent();
  toast("Seite hinzugefügt");
}

function updatePageIndicator() {
  $("#page-indicator").textContent = `${engine.pageIndex + 1} / ${state.current.pages.length}`;
  $("#btn-prev-page").disabled = engine.pageIndex === 0;
  $("#btn-next-page").disabled = engine.pageIndex === state.current.pages.length - 1;
}
function updateHistoryButtons() {
  $("#btn-undo").disabled = !engine.canUndo();
  $("#btn-redo").disabled = !engine.canRedo();
}
function updateZoomLabel() { $("#zoom-label").textContent = Math.round(engine.scale * 100) + "%"; }

/* tools */
function setTool(t) {
  if (engine.tool !== t) engine.clearSelection();
  engine.tool = t;
  $$(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  $("#shape-group").classList.toggle("hidden", t !== "shapes");
  const stage = $("#stage");
  stage.style.cursor = t === "hand" ? "grab" : t === "eraser" ? "cell"
    : t === "text" ? "text" : t === "lasso" ? "default" : "crosshair";
}
function setShape(s) {
  engine.shapeType = s;
  $$(".shape-btn").forEach((b) => b.classList.toggle("active", b.dataset.shape === s));
}

/* ---------------- text editing overlay ---------------- */
function editText(existing, x, y) {
  const isNew = !existing;
  const item = existing || { id: uid(), x, y, text: "", size: Math.max(22, Math.round(engine.size * 6)), color: engine.color };

  const ta = document.createElement("textarea");
  ta.className = "text-edit-overlay";
  ta.value = item.text || "";
  ta.rows = 1;
  document.body.appendChild(ta);

  const place = () => {
    const r = $("#canvas-wrap").getBoundingClientRect();
    ta.style.left = (r.left + item.x * engine.scale) + "px";
    ta.style.top = (r.top + item.y * engine.scale) + "px";
    ta.style.fontSize = (item.size * engine.scale) + "px";
    ta.style.color = item.color;
    ta.style.width = Math.max(60, (item.w || 120) * engine.scale) + "px";
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };

  if (!isNew) engine.setEditingText(item.id);
  place();
  setTimeout(() => { ta.focus(); ta.select(); }, 0);

  const oldText = item.text || "";
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); ta.blur(); } });

  let done = false;
  ta.addEventListener("blur", () => {
    if (done) return; done = true;
    item.text = ta.value.replace(/\s+$/, "");
    ta.remove();
    engine.setEditingText(null);
    if (isNew) {
      if (item.text.trim()) engine.addTextItem(item);
    } else {
      if (!item.text.trim()) engine.deleteTextItem(item);
      else engine.commitTextEdit(item, oldText);
    }
    saveCurrent();
  });
}
function setSize(s) {
  engine.size = s;
  $$(".size-dot").forEach((b) => b.classList.toggle("active", parseFloat(b.dataset.size) === s));
}
function setColor(c, fromPicker) {
  engine.color = c;
  if (fromPicker) addRecentColor(c);
  $$(".swatch").forEach((b) => b.classList.toggle("active", b.dataset.color === c));
  $("#custom-color").value = toHex(c);
}
function buildColorSwatches() {
  const g = $("#color-group");
  g.innerHTML = "";
  const recents = loadRecents();
  [...COLORS, ...recents].forEach((c) => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.dataset.color = c;
    b.style.background = c;
    if (c.toLowerCase() === "#ffffff") b.style.borderColor = "rgba(0,0,0,0.25)";
    b.onclick = () => setColor(c);
    g.appendChild(b);
  });
}
function loadRecents() {
  try { return JSON.parse(localStorage.getItem("inkwell-colors") || "[]"); } catch { return []; }
}
function addRecentColor(c) {
  c = c.toLowerCase();
  if (COLORS.map((x) => x.toLowerCase()).includes(c)) return;
  let r = loadRecents().filter((x) => x.toLowerCase() !== c);
  r.unshift(c);
  r = r.slice(0, 5);
  localStorage.setItem("inkwell-colors", JSON.stringify(r));
  buildColorSwatches();
  $$(".swatch").forEach((b) => b.classList.toggle("active", b.dataset.color === c));
}

/* ============================================================
   SCANNING
   ============================================================ */
async function scanToCurrent() {
  const url = await scanner.open();
  if (!url) return;
  const p = newPage("blank", url);
  state.current.pages.push(p);
  engine.setPage(state.current.pages.length - 1);
  updatePageIndicator();
  engine.fit();
  await saveCurrent();
  toast("Scan als neue Seite hinzugefügt");
}

async function scanToNewNotebook() {
  const url = await scanner.open();
  if (!url) return;
  const nb = newNotebook("Scan " + fmtDate(Date.now()), "blank", Math.floor(Math.random() * COVER_GRADIENTS.length));
  nb.pages = [newPage("blank", url)];
  await Storage.put(nb);
  await refreshLibrary();
  openNotebook(nb.id);
}

/* ============================================================
   PAGE OVERVIEW
   ============================================================ */
async function openPagesOverview() {
  const body = document.createElement("div");
  body.innerHTML = `
    <h3>Seiten</h3>
    <p>Tippen zum Öffnen · umsortieren oder löschen.</p>
    <div class="pages-grid" id="pg-grid"></div>
    <div class="row">
      <button class="btn ghost" data-close>Schließen</button>
      <button class="btn primary" id="pg-add">＋ Seite</button>
    </div>`;
  const m = modal(body);
  const grid = body.querySelector("#pg-grid");

  const render = async () => {
    grid.innerHTML = "";
    for (let i = 0; i < state.current.pages.length; i++) {
      const pg = state.current.pages[i];
      const cv = await engine.renderPageToCanvas(pg);
      const t = document.createElement("canvas");
      t.width = 120; t.height = Math.round(120 * PAGE_H / PAGE_W);
      t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);

      const cell = document.createElement("div");
      cell.className = "pg-cell" + (i === engine.pageIndex ? " cur" : "");
      const thumb = document.createElement("div");
      thumb.className = "pg-thumb";
      thumb.appendChild(t);
      thumb.onclick = () => { m.close(); gotoPage(i); };

      const bar = document.createElement("div");
      bar.className = "pg-bar";
      bar.innerHTML = `<span class="pg-num">${i + 1}</span>
        <span class="pg-acts">
          <button data-a="up" ${i === 0 ? "disabled" : ""}>◀</button>
          <button data-a="down" ${i === state.current.pages.length - 1 ? "disabled" : ""}>▶</button>
          <button data-a="del" class="danger">🗑️</button>
        </span>`;
      bar.querySelector('[data-a="up"]').onclick = async () => { swapPages(i, i - 1); await render(); };
      bar.querySelector('[data-a="down"]').onclick = async () => { swapPages(i, i + 1); await render(); };
      bar.querySelector('[data-a="del"]').onclick = async () => {
        if (state.current.pages.length <= 1) { toast("Letzte Seite kann nicht gelöscht werden"); return; }
        state.current.pages.splice(i, 1);
        if (engine.pageIndex >= state.current.pages.length) engine.pageIndex = state.current.pages.length - 1;
        engine.setPage(engine.pageIndex);
        updatePageIndicator(); engine.fit(); await saveCurrent();
        await render();
      };

      cell.appendChild(thumb);
      cell.appendChild(bar);
      grid.appendChild(cell);
    }
  };

  body.querySelector("#pg-add").onclick = async () => { addPage(); await render(); };
  await render();
}

function swapPages(a, b) {
  if (b < 0 || b >= state.current.pages.length) return;
  const pages = state.current.pages;
  const cur = pages[engine.pageIndex];
  [pages[a], pages[b]] = [pages[b], pages[a]];
  engine.pageIndex = pages.indexOf(cur);
  engine.renderAll();
  updatePageIndicator();
  saveCurrent();
}

/* ============================================================
   MENUS
   ============================================================ */
function openEditorMenu() {
  const body = document.createElement("div");
  body.innerHTML = `
    <h3>Optionen</h3>
    <div class="menu-list">
      <button data-a="paper"><span class="mic">▦</span> Papierart der Seite ändern</button>
      <button data-a="import"><span class="mic">🖼️</span> Bild importieren</button>
      <button data-a="duplicate"><span class="mic">⧉</span> Seite duplizieren</button>
      <button data-a="clear"><span class="mic">⌫</span> Seite leeren</button>
      <button data-a="delpage" class="danger"><span class="mic">🗑️</span> Seite löschen</button>
      <button data-a="delnb" class="danger"><span class="mic">🔥</span> Notizbuch löschen</button>
    </div>
    <div class="row"><button class="btn ghost" data-close>Schließen</button></div>`;
  const m = modal(body);
  body.querySelectorAll("[data-a]").forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; m.close();
    if (a === "paper") changePaperMenu();
    else if (a === "import") importImage();
    else if (a === "duplicate") duplicatePage();
    else if (a === "clear") { engine.clearPage(); toast("Seite geleert"); }
    else if (a === "delpage") deletePage();
    else if (a === "delnb") deleteNotebook();
  });
}

function changePaperMenu() {
  const papers = [["blank", "Blanko"], ["lined", "Liniert"], ["grid", "Kariert"], ["dots", "Punkte"]];
  const body = document.createElement("div");
  body.innerHTML = `<h3>Papierart</h3><div class="opt-grid" id="pp"></div>
    <div class="row"><button class="btn ghost" data-close>Schließen</button></div>`;
  const m = modal(body);
  const pp = body.querySelector("#pp");
  papers.forEach(([id, lbl]) => {
    const d = document.createElement("div");
    d.className = "opt" + (engine.page.paper === id ? " sel" : "");
    d.style.background = paperPreview(id);
    d.textContent = lbl;
    d.onclick = () => { engine.page.paper = id; engine.renderAll(); saveCurrent(); m.close(); };
    pp.appendChild(d);
  });
}

function duplicatePage() {
  const src = engine.page;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  state.current.pages.splice(engine.pageIndex + 1, 0, copy);
  engine.setPage(engine.pageIndex + 1);
  updatePageIndicator();
  saveCurrent();
  toast("Seite dupliziert");
}

function deletePage() {
  if (state.current.pages.length <= 1) { toast("Letzte Seite kann nicht gelöscht werden"); return; }
  confirmModal("Seite löschen?", "Diese Seite wird dauerhaft entfernt.", () => {
    state.current.pages.splice(engine.pageIndex, 1);
    engine.setPage(Math.max(0, engine.pageIndex - 1));
    updatePageIndicator();
    engine.fit();
    saveCurrent();
  });
}

function deleteNotebook() {
  confirmModal("Notizbuch löschen?", "Alle Seiten gehen verloren. Das kann nicht rückgängig gemacht werden.", async () => {
    await Storage.remove(state.current.id);
    closeEditor();
  });
}

function importImage() {
  const inp = $("#img-import");
  inp.value = "";
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const p = newPage("blank", reader.result);
      state.current.pages.splice(engine.pageIndex + 1, 0, p);
      engine.setPage(engine.pageIndex + 1);
      updatePageIndicator();
      engine.fit();
      await saveCurrent();
      toast("Bild importiert");
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}

/* ============================================================
   EXPORT
   ============================================================ */
function openExportMenu() {
  const body = document.createElement("div");
  body.innerHTML = `
    <h3>Exportieren</h3>
    <div class="menu-list">
      <button data-a="png"><span class="mic">🖼️</span> Aktuelle Seite als PNG</button>
      <button data-a="pdf"><span class="mic">📄</span> Ganzes Notizbuch als PDF</button>
    </div>
    <div class="row"><button class="btn ghost" data-close>Schließen</button></div>`;
  const m = modal(body);
  body.querySelectorAll("[data-a]").forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; m.close();
    if (a === "png") await exportPNG();
    else await exportPDF();
  });
}

async function exportPNG() {
  toast("Seite wird erzeugt…");
  const cv = await engine.renderPageToCanvas(engine.page);
  cv.toBlob((blob) => {
    download(blob, `${safeName(state.current.title)}-S${engine.pageIndex + 1}.png`);
  }, "image/png");
}

async function exportPDF() {
  toast("PDF wird erstellt…");
  const pages = [];
  for (const pg of state.current.pages) {
    const cv = await engine.renderPageToCanvas(pg);
    pages.push(cv.toDataURL("image/jpeg", 0.85));
  }
  const pdf = buildPDF(pages, PAGE_W, PAGE_H);
  download(pdf, `${safeName(state.current.title)}.pdf`);
}

/* Minimal PDF writer: one full-page JPEG per page (no external lib) */
function buildPDF(jpegDataUrls, w, h) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = (data) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes); len += bytes.length; return len;
  };
  const objStart = () => offsets.push(len);

  push("%PDF-1.4\n");

  const N = jpegDataUrls.length;
  // object numbering: 1 catalog, 2 pages, then per page: page obj, content obj, image obj
  const pageObjIds = [], contentIds = [], imageIds = [];
  let oid = 3;
  for (let i = 0; i < N; i++) { pageObjIds.push(oid++); contentIds.push(oid++); imageIds.push(oid++); }

  // 1: catalog
  objStart(); push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  // 2: pages
  objStart();
  push(`2 0 obj\n<< /Type /Pages /Count ${N} /Kids [${pageObjIds.map((id) => id + " 0 R").join(" ")}] >>\nendobj\n`);

  for (let i = 0; i < N; i++) {
    const bin = dataURLtoBytes(jpegDataUrls[i]);
    // page
    objStart();
    push(`${pageObjIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 ${imageIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`);
    // content
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    objStart();
    push(`${contentIds[i]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
    // image
    objStart();
    push(`${imageIds[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n`);
    push(bin);
    push(`\nendstream\nendobj\n`);
  }

  // xref
  const xrefPos = len;
  const total = offsets.length + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}

function dataURLtoBytes(url) {
  const b64 = url.split(",")[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Gespeichert: " + name);
}

/* ============================================================
   SAVE + THUMBNAIL
   ============================================================ */
let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrent(), 700);
}
async function saveCurrent(withThumb) {
  if (!state.current) return;
  if (withThumb) state.current.thumb = await makeThumb();
  else if (!state.current.thumb) state.current.thumb = await makeThumb();
  await Storage.put(state.current);
}
async function makeThumb() {
  try {
    const cv = await engine.renderPageToCanvas(state.current.pages[0]);
    const t = document.createElement("canvas");
    t.width = 240; t.height = Math.round(240 * PAGE_H / PAGE_W);
    t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.6);
  } catch { return null; }
}

/* ============================================================
   MODAL / TOAST HELPERS
   ============================================================ */
function modal(contentEl) {
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  const box = document.createElement("div");
  box.className = "modal";
  box.appendChild(contentEl);
  back.appendChild(box);
  $("#modal-root").appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  contentEl.querySelectorAll("[data-close]").forEach((b) => b.onclick = close);
  return { close, el: box };
}

function confirmModal(title, msg, onYes) {
  const body = document.createElement("div");
  body.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(msg)}</p>
    <div class="row"><button class="btn ghost" data-close>Abbrechen</button>
    <button class="btn primary" id="cf-yes" style="background:linear-gradient(135deg,#ff6b6b,#e11d48)">Löschen</button></div>`;
  const m = modal(body);
  body.querySelector("#cf-yes").onclick = () => { m.close(); onYes(); };
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1900);
}

/* ============================================================
   UTILITIES
   ============================================================ */
function paperPreview(id) {
  if (id === "lined") return "repeating-linear-gradient(#fff 0 10px,#cdd6ee 10px 11px)";
  if (id === "grid") return "repeating-linear-gradient(#fff 0 10px,#cdd6ee 10px 11px),repeating-linear-gradient(90deg,#fff 0 10px,#cdd6ee 10px 11px)";
  if (id === "dots") return "radial-gradient(#cdd6ee 1px,#fff 1.5px) 0 0/11px 11px";
  return "#fff";
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeName(s) { return String(s).replace(/[^\w\-äöüÄÖÜ ]+/g, "").trim() || "Notizbuch"; }
function toHex(c) { if (c.startsWith("#")) return c; return "#1f6feb"; }

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
