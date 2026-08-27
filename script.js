  // ===================================================================
  // STATE
  // ===================================================================
  const CANVAS_W = 1022, CANVAS_H = 564;
  const canvasStack = document.getElementById('canvasStack');
  const canvasWrapper = document.getElementById('canvasWrapper');
  const interactionCanvas = document.getElementById('interactionCanvas');
  const ictx = interactionCanvas.getContext('2d');
  const coordsDisplay = document.getElementById('coordsDisplay');
  const dimsDisplay = document.getElementById('dimsDisplay');

  let layers = [];         // {id, name, canvas, ctx, visible, opacity, blendMode, locked}
  let activeLayerId = null;
  let nextLayerId = 1;
  let currentTool = 'brush';
  let currentColor = { h: 187, s: 100, v: 100, hex: '#00e5ff' };
  let brush = { size: 25, opacity: 100, hardness: 50, flow: 80, stabilizer: 20, pressure: true };
  let symmetryOn = false;
  let gridOn = false;
  let zoom = 100;
  let selection = null;    // {x,y,w,h,shape:'rect'|'ellipse', inverted:bool}
  let clipboard = null;    // {w,h,dataURL}
  let undoStack = [];
  let redoStack = [];
  let isDrawing = false;
  let lastPt = null;
  let strokePoints = [];
  let dragStart = null;
  let airbrushTimer = null;

  function setCanvasSize(w, h) {
    canvasStack.style.width = w + 'px';
    canvasStack.style.height = h + 'px';
    interactionCanvas.width = w; interactionCanvas.height = h;
    interactionCanvas.style.width = w + 'px'; interactionCanvas.style.height = h + 'px';
    dimsDisplay.textContent = `${w} × ${h} px`;
  }
  setCanvasSize(CANVAS_W, CANVAS_H);

  // ===================================================================
  // LAYERS
  // ===================================================================
  function makeLayerCanvas() {
    const c = document.createElement('canvas');
    c.width = interactionCanvas.width; c.height = interactionCanvas.height;
    c.className = 'layer-canvas';
    c.style.width = canvasStack.style.width;
    c.style.height = canvasStack.style.height;
    return c;
  }

  function createLayer(name, {fill=null, insertTop=true} = {}) {
    const canvas = makeLayerCanvas();
    const ctx = canvas.getContext('2d');
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const layer = { id: nextLayerId++, name, canvas, ctx, visible: true, opacity: 100, blendMode: 'source-over', locked: false };
    if (insertTop) layers.unshift(layer); else layers.push(layer);
    reflowLayerDom();
    return layer;
  }

  function reflowLayerDom() {
    // remove existing layer canvases (keep interactionCanvas + gridOverlay)
    [...canvasStack.querySelectorAll('canvas.layer-canvas')].forEach(c => { if (c !== interactionCanvas) c.remove(); });
    // DOM paint order = bottom layer first; layers[] is top-first
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      l.canvas.style.display = l.visible ? '' : 'none';
      l.canvas.style.opacity = (l.opacity / 100).toString();
      l.canvas.style.mixBlendMode = l.blendMode;
      canvasStack.insertBefore(l.canvas, interactionCanvas);
    }
  }

  function getActiveLayer() { return layers.find(l => l.id === activeLayerId); }

  function renderLayers() {
    const list = document.getElementById('layersList');
    list.innerHTML = '';
    layers.forEach(layer => {
      const row = document.createElement('div');
      row.className = 'layer-row flex items-center justify-between p-1.5 bg-appToolbar/50 hover:bg-appToolbar border border-appBorder rounded text-appSecondaryText' + (layer.id === activeLayerId ? ' active-layer' : '');
      row.draggable = true;
      row.dataset.layerId = layer.id;

      const thumb = document.createElement('canvas');
      thumb.width = 24; thumb.height = 24; thumb.className = 'thumb w-6 h-6 border border-appBorder rounded bg-white/10';
      const tctx = thumb.getContext('2d');
      tctx.drawImage(layer.canvas, 0, 0, 24, 24);

      row.innerHTML = `
        <div class="flex items-center space-x-2 flex-1 min-w-0">
          <i class="fa-regular ${layer.visible ? 'fa-eye' : 'fa-eye-slash'} eye-toggle cursor-pointer"></i>
          <span class="thumb-slot"></span>
          <span class="name-label truncate cursor-text">${layer.name}</span>
        </div>
        <i class="fa-solid ${layer.locked ? 'fa-lock' : 'fa-lock-open'} lock-toggle cursor-pointer"></i>
      `;
      row.querySelector('.thumb-slot').appendChild(thumb);
      if (layer.id === activeLayerId) row.classList.add('btn-active');

      row.querySelector('.eye-toggle').addEventListener('click', (e) => {
        e.stopPropagation(); layer.visible = !layer.visible; reflowLayerDom(); renderLayers();
      });
      row.querySelector('.lock-toggle').addEventListener('click', (e) => {
        e.stopPropagation(); layer.locked = !layer.locked; renderLayers();
      });
      row.querySelector('.name-label').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const newName = prompt('เปลี่ยนชื่อเลเยอร์:', layer.name);
        if (newName) { layer.name = newName; renderLayers(); }
      });
      row.addEventListener('click', () => { setActiveLayer(layer.id); });

      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', layer.id); });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
        reorderLayer(draggedId, layer.id);
      });

      list.appendChild(row);
    });
    updateMemoryDisplay();
  }

  function reorderLayer(draggedId, targetId) {
    if (draggedId === targetId) return;
    const fromIdx = layers.findIndex(l => l.id === draggedId);
    const toIdx = layers.findIndex(l => l.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = layers.splice(fromIdx, 1);
    layers.splice(toIdx, 0, moved);
    reflowLayerDom(); renderLayers();
  }

  function setActiveLayer(id) {
    activeLayerId = id;
    const layer = getActiveLayer();
    if (layer) {
      document.getElementById('blendModeSelect').value = layer.blendMode;
      document.getElementById('layerOpacityInput').value = layer.opacity;
    }
    renderLayers();
  }

  function addLayer() {
    pushHistory();
    const layer = createLayer(`เลเยอร์ ${nextLayerId - 1}`);
    setActiveLayer(layer.id);
    showToast('เพิ่มเลเยอร์ใหม่แล้ว');
  }

  function deleteLayer() {
    if (layers.length <= 1) { showToast('ต้องมีอย่างน้อย 1 เลเยอร์'); return; }
    pushHistory();
    const idx = layers.findIndex(l => l.id === activeLayerId);
    layers.splice(idx, 1);
    const newActive = layers[Math.min(idx, layers.length - 1)];
    reflowLayerDom();
    setActiveLayer(newActive.id);
    showToast('ลบเลเยอร์แล้ว');
  }

  function duplicateLayer() {
    const src = getActiveLayer(); if (!src) return;
    pushHistory();
    const idx = layers.findIndex(l => l.id === activeLayerId);
    const canvas = makeLayerCanvas();
    canvas.getContext('2d').drawImage(src.canvas, 0, 0);
    const layer = { id: nextLayerId++, name: src.name + ' (copy)', canvas, ctx: canvas.getContext('2d'), visible: true, opacity: src.opacity, blendMode: src.blendMode, locked: false };
    layers.splice(idx, 0, layer);
    reflowLayerDom(); setActiveLayer(layer.id);
    showToast('ทำสำเนาเลเยอร์แล้ว');
  }

  function mergeLayerDown() {
    const idx = layers.findIndex(l => l.id === activeLayerId);
    if (idx === -1 || idx === layers.length - 1) { showToast('ไม่มีเลเยอร์ด้านล่างให้รวม'); return; }
    pushHistory();
    const top = layers[idx], bottom = layers[idx + 1];
    bottom.ctx.globalAlpha = top.opacity / 100;
    bottom.ctx.globalCompositeOperation = top.blendMode;
    bottom.ctx.drawImage(top.canvas, 0, 0);
    bottom.ctx.globalAlpha = 1; bottom.ctx.globalCompositeOperation = 'source-over';
    layers.splice(idx, 1);
    reflowLayerDom(); setActiveLayer(bottom.id);
    showToast('รวมเลเยอร์แล้ว');
  }

  function flattenImage() {
    pushHistory();
    const merged = makeLayerCanvas();
    const mctx = merged.getContext('2d');
    mctx.fillStyle = '#ffffff'; mctx.fillRect(0, 0, merged.width, merged.height);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]; if (!l.visible) continue;
      mctx.globalAlpha = l.opacity / 100; mctx.globalCompositeOperation = l.blendMode;
      mctx.drawImage(l.canvas, 0, 0);
    }
    mctx.globalAlpha = 1; mctx.globalCompositeOperation = 'source-over';
    layers = [{ id: nextLayerId++, name: 'พื้นหลัง (Background)', canvas: merged, ctx: mctx, visible: true, opacity: 100, blendMode: 'source-over', locked: false }];
    reflowLayerDom(); setActiveLayer(layers[0].id);
    showToast('รวมภาพทั้งหมดเป็นเลเยอร์เดียวแล้ว');
  }

  // ===================================================================
  // HISTORY (undo/redo) — full snapshot of layer stack
  // ===================================================================
  function snapshotState() {
    return {
      activeLayerId,
      layers: layers.map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, locked: l.locked, dataURL: l.canvas.toDataURL(), w: l.canvas.width, h: l.canvas.height }))
    };
  }
  function pushHistory() {
    undoStack.push(snapshotState());
    if (undoStack.length > 40) undoStack.shift();
    redoStack = [];
  }
  function restoreState(state, cb) {
    let loaded = 0; const total = state.layers.length;
    const newLayers = [];
    if (total === 0) { finish(); return; }
    state.layers.forEach((ld, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = ld.w; canvas.height = ld.h; canvas.className = 'layer-canvas';
      canvas.style.width = canvasStack.style.width; canvas.style.height = canvasStack.style.height;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0); loaded++; if (loaded === total) finish(); };
      img.src = ld.dataURL;
      newLayers[i] = { id: ld.id, name: ld.name, canvas, ctx, visible: ld.visible, opacity: ld.opacity, blendMode: ld.blendMode, locked: ld.locked };
    });
    function finish() {
      layers = newLayers;
      reflowLayerDom();
      setActiveLayer(state.activeLayerId ?? (layers[0] && layers[0].id));
      if (cb) cb();
    }
  }
  function undo() {
    if (undoStack.length === 0) { showToast('ไม่มีขั้นตอนให้ย้อนกลับ'); return; }
    redoStack.push(snapshotState());
    restoreState(undoStack.pop());
  }
  function redo() {
    if (redoStack.length === 0) { showToast('ไม่มีขั้นตอนให้ทำซ้ำ'); return; }
    undoStack.push(snapshotState());
    restoreState(redoStack.pop());
  }

  // ===================================================================
  // COLOR PANEL
  // ===================================================================
  function hsvToHex(h, s, v) {
    s /= 100; v /= 100;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r=0,g=0,b=0;
    if (h < 60) [r,g,b]=[c,x,0]; else if (h<120) [r,g,b]=[x,c,0]; else if (h<180) [r,g,b]=[0,c,x];
    else if (h<240) [r,g,b]=[0,x,c]; else if (h<300) [r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
    const toHex = n => Math.round((n+m)*255).toString(16).padStart(2,'0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }
  function hexToHsv(hex) {
    hex = hex.replace('#','');
    const r = parseInt(hex.substr(0,2),16)/255, g = parseInt(hex.substr(2,2),16)/255, b = parseInt(hex.substr(4,2),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    let h = 0;
    if (d !== 0) {
      if (max===r) h = 60*(((g-b)/d)%6); else if (max===g) h = 60*(((b-r)/d)+2); else h = 60*(((r-g)/d)+4);
    }
    if (h < 0) h += 360;
    const s = max===0 ? 0 : (d/max)*100, v = max*100;
    return { h, s, v };
  }

  const colorSquareCanvas = document.getElementById('colorSquare');
  const sqctx = colorSquareCanvas.getContext('2d');
  function drawColorSquare() {
    const w = colorSquareCanvas.width, h = colorSquareCanvas.height;
    const base = hsvToHex(currentColor.h, 100, 100);
    sqctx.fillStyle = base; sqctx.fillRect(0,0,w,h);
    const whiteGrad = sqctx.createLinearGradient(0,0,w,0);
    whiteGrad.addColorStop(0,'rgba(255,255,255,1)'); whiteGrad.addColorStop(1,'rgba(255,255,255,0)');
    sqctx.fillStyle = whiteGrad; sqctx.fillRect(0,0,w,h);
    const blackGrad = sqctx.createLinearGradient(0,0,0,h);
    blackGrad.addColorStop(0,'rgba(0,0,0,0)'); blackGrad.addColorStop(1,'rgba(0,0,0,1)');
    sqctx.fillStyle = blackGrad; sqctx.fillRect(0,0,w,h);
    // indicator
    const ix = (currentColor.s/100) * w, iy = (1 - currentColor.v/100) * h;
    sqctx.beginPath(); sqctx.arc(ix, iy, 5, 0, Math.PI*2);
    sqctx.strokeStyle = '#fff'; sqctx.lineWidth = 2; sqctx.stroke();
    sqctx.strokeStyle = '#000'; sqctx.lineWidth = 1; sqctx.stroke();
  }
  function setColor(hex, fromHex=false) {
    currentColor.hex = hex;
    const hsv = hexToHsv(hex);
    currentColor.h = fromHex ? hsv.h : currentColor.h;
    currentColor.s = hsv.s; currentColor.v = hsv.v;
    document.getElementById('currentColorSwatch').style.background = hex;
    document.getElementById('hexInput').value = hex.toUpperCase();
    document.getElementById('hueSlider').value = currentColor.h;
    drawColorSquare();
    updateBrushPreview();
  }
  function setColorFromHSV() {
    const hex = hsvToHex(currentColor.h, currentColor.s, currentColor.v);
    currentColor.hex = hex;
    document.getElementById('currentColorSwatch').style.background = hex;
    document.getElementById('hexInput').value = hex.toUpperCase();
    updateBrushPreview();
  }

  colorSquareCanvas.addEventListener('pointerdown', e => {
    colorSquareCanvas.setPointerCapture(e.pointerId);
    pickFromSquare(e);
    const mv = ev => pickFromSquare(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  function pickFromSquare(e) {
    const rect = colorSquareCanvas.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX-rect.left)/rect.width,0),1);
    const y = Math.min(Math.max((e.clientY-rect.top)/rect.height,0),1);
    currentColor.s = x*100; currentColor.v = (1-y)*100;
    setColorFromHSV(); drawColorSquare();
  }
  document.getElementById('hueSlider').addEventListener('input', e => {
    currentColor.h = parseFloat(e.target.value);
    setColorFromHSV(); drawColorSquare();
  });
  document.querySelectorAll('[data-color]').forEach(sw => {
    sw.addEventListener('click', () => setColor(sw.dataset.color, true));
  });
  document.getElementById('hexInput').addEventListener('change', e => {
    let v = e.target.value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(v)) { showToast('รหัสสีไม่ถูกต้อง'); return; }
    if (v[0] !== '#') v = '#' + v;
    setColor(v, true);
  });
  drawColorSquare();

  // ===================================================================
  // BRUSH SETTINGS
  // ===================================================================
  function bindSlider(id, valId, suffix, target, key) {
    const el = document.getElementById(id), val = document.getElementById(valId);
    el.addEventListener('input', () => { brush[key] = parseFloat(el.value); val.textContent = el.value + suffix; updateBrushPreview(); });
  }
  bindSlider('sizeSlider','sizeVal','px',brush,'size');
  bindSlider('opacitySlider','opacVal','%',brush,'opacity');
  bindSlider('hardnessSlider','hardVal','%',brush,'hardness');
  bindSlider('flowSlider','flowVal','%',brush,'flow');
  bindSlider('stabilizerSlider','stabVal','%',brush,'stabilizer');
  document.getElementById('pressureSelect').addEventListener('change', e => brush.pressure = e.target.value === 'on');

  function updateBrushPreview() {
    const path = document.getElementById('brushPreviewPath');
    path.setAttribute('stroke', currentColor.hex);
    path.setAttribute('stroke-width', Math.max(1, brush.size / 6));
    path.setAttribute('stroke-opacity', brush.opacity/100);
  }
  updateBrushPreview();

  // ===================================================================
  // TOOL SELECTION
  // ===================================================================
  function setTool(tool) {
    if (tool === 'toast') { showToast('เครื่องมือนี้ยังไม่รองรับในเวอร์ชันนี้'); return; }
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('btn-active'));
    document.querySelectorAll(`[data-tool="${tool}"]`).forEach(b => b.classList.add('btn-active'));
    interactionCanvas.style.cursor = ['move'].includes(tool) ? 'grab' : (tool === 'eyedropper' ? 'copy' : 'crosshair');
    clearOverlay();
    // On narrow screens the tool panel is a drawer covering the canvas —
    // close it once a tool is picked so drawing isn't blocked.
    if (window.innerWidth <= 1024 && typeof closePanels === 'function') closePanels();
  }
  document.querySelectorAll('[data-tool]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); setTool(el.dataset.tool); });
  });
  setTool('brush');

  // ===================================================================
  // DRAWING ENGINE
  // ===================================================================
  function clearOverlay() { ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height); if (selection) drawSelectionOverlay(); }

  function canvasPoint(e) {
    const rect = interactionCanvas.getBoundingClientRect();
    const scaleX = interactionCanvas.width / rect.width;
    const scaleY = interactionCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function applyClip(ctx) {
    if (!selection) return false;
    ctx.save();
    ctx.beginPath();
    if (selection.shape === 'ellipse') {
      ctx.ellipse(selection.x + selection.w/2, selection.y + selection.h/2, Math.abs(selection.w)/2, Math.abs(selection.h)/2, 0, 0, Math.PI*2);
    } else {
      ctx.rect(selection.x, selection.y, selection.w, selection.h);
    }
    if (selection.inverted) {
      ctx.rect(interactionCanvas.width, 0, -interactionCanvas.width, interactionCanvas.height);
      ctx.clip('evenodd');
    } else {
      ctx.clip();
    }
    return true;
  }

  function strokeDab(ctx, x, y, size, hardness, color, alpha, composite) {
    ctx.save();
    ctx.globalCompositeOperation = composite || 'source-over';
    ctx.globalAlpha = alpha;
    if (hardness >= 95) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI*2); ctx.fill();
    } else {
      const blur = Math.max(1, size * (1 - hardness/100));
      ctx.shadowColor = color; ctx.shadowBlur = blur;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, size/2 - blur/4), 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function mirroredX(x) { return interactionCanvas.width - x; }

  // "แรงกดปากกา (Pressure)" had a working dropdown but never actually
  // changed anything — this makes it functional for stylus/pen input.
  function getPressureSize(e) {
    if (brush.pressure && e && e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) {
      return Math.max(1, brush.size * (0.25 + e.pressure * 0.75));
    }
    return brush.size;
  }

  function drawFreehandSegment(layer, from, to, sizeOverride) {
    const composite = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    const alpha = brush.opacity/100 * (currentTool === 'airbrush' ? 0.35 : 1);
    const size = sizeOverride || brush.size;
    const dist = Math.hypot(to.x-from.x, to.y-from.y);
    const step = Math.max(1, size/8);
    const n = Math.max(1, Math.ceil(dist/step));
    for (let i=0;i<=n;i++) {
      const t = i/n;
      const x = from.x + (to.x-from.x)*t, y = from.y + (to.y-from.y)*t;
      strokeDab(layer.ctx, x, y, size, currentTool==='pencil'?100:brush.hardness, currentColor.hex, alpha, composite);
      if (symmetryOn) strokeDab(layer.ctx, mirroredX(x), y, size, currentTool==='pencil'?100:brush.hardness, currentColor.hex, alpha, composite);
    }
  }

  function smudgeSegment(layer, from, to) {
    const ctx = layer.ctx;
    const r = brush.size/2;
    try {
      const img = ctx.getImageData(Math.max(0,from.x-r), Math.max(0,from.y-r), r*2, r*2);
      ctx.save();
      ctx.globalAlpha = brush.flow/100;
      ctx.putImageData(img, to.x-r, to.y-r);
      ctx.restore();
    } catch(err) {}
  }

  function blurSegment(layer, pt) {
    const ctx = layer.ctx, r = brush.size;
    const sx = Math.max(0, pt.x-r), sy = Math.max(0, pt.y-r);
    const sw = Math.min(layer.canvas.width-sx, r*2), sh = Math.min(layer.canvas.height-sy, r*2);
    if (sw<=0||sh<=0) return;
    const temp = document.createElement('canvas'); temp.width=sw; temp.height=sh;
    const tctx = temp.getContext('2d');
    tctx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.save();
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r/2, 0, Math.PI*2); ctx.clip();
    ctx.filter = `blur(${Math.max(1,brush.size/8)}px)`;
    ctx.clearRect(sx, sy, sw, sh);
    ctx.drawImage(temp, sx, sy, sw, sh);
    ctx.filter = 'none';
    ctx.restore();
  }

  function floodFill(layer, startX, startY, fillHex) {
    const ctx = layer.ctx;
    const w = layer.canvas.width, h = layer.canvas.height;
    const imgData = ctx.getImageData(0,0,w,h);
    const data = imgData.data;
    startX = Math.floor(startX); startY = Math.floor(startY);
    if (startX<0||startY<0||startX>=w||startY>=h) return;
    const idx0 = (startY*w+startX)*4;
    const target = [data[idx0],data[idx0+1],data[idx0+2],data[idx0+3]];
    const fr = parseInt(fillHex.substr(1,2),16), fg = parseInt(fillHex.substr(3,2),16), fb = parseInt(fillHex.substr(5,2),16);
    if (target[0]===fr && target[1]===fg && target[2]===fb && target[3]===255) return;
    const tol = 32;
    const matches = (i) => Math.abs(data[i]-target[0])<=tol && Math.abs(data[i+1]-target[1])<=tol && Math.abs(data[i+2]-target[2])<=tol && Math.abs(data[i+3]-target[3])<=tol;
    const stack = [[startX,startY]];
    const visited = new Uint8Array(w*h);
    while (stack.length) {
      const [x,y] = stack.pop();
      if (x<0||y<0||x>=w||y>=h) continue;
      const p = y*w+x; if (visited[p]) continue;
      const i = p*4; if (!matches(i)) continue;
      visited[p]=1;
      data[i]=fr; data[i+1]=fg; data[i+2]=fb; data[i+3]=255;
      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    ctx.putImageData(imgData,0,0);
  }

  function eyedrop(x,y) {
    for (const layer of layers) {
      if (!layer.visible) continue;
      const d = layer.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      if (d[3] > 10) {
        const hex = '#' + [d[0],d[1],d[2]].map(n=>n.toString(16).padStart(2,'0')).join('');
        setColor(hex, true);
        return;
      }
    }
    showToast('ไม่พบสีที่จุดนี้');
  }

  function drawSelectionOverlay() {
    if (!selection) return;
    ictx.save();
    ictx.strokeStyle = '#00e5ff'; ictx.lineWidth = 1.5; ictx.setLineDash([6,4]);
    if (selection.shape === 'ellipse') {
      ictx.beginPath();
      ictx.ellipse(selection.x+selection.w/2, selection.y+selection.h/2, Math.abs(selection.w)/2, Math.abs(selection.h)/2, 0, 0, Math.PI*2);
      ictx.stroke();
    } else {
      ictx.strokeRect(selection.x, selection.y, selection.w, selection.h);
    }
    ictx.restore();
  }

  function normRect(x0,y0,x1,y1) {
    return { x: Math.min(x0,x1), y: Math.min(y0,y1), w: Math.abs(x1-x0), h: Math.abs(y1-y0) };
  }

  function drawShapePreview(kind, x0,y0,x1,y1) {
    ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height);
    ictx.save();
    ictx.strokeStyle = currentColor.hex; ictx.lineWidth = Math.max(1,brush.size/6); ictx.globalAlpha = brush.opacity/100;
    ictx.beginPath();
    if (kind==='line') { ictx.moveTo(x0,y0); ictx.lineTo(x1,y1); }
    else if (kind==='rect-shape') { const r=normRect(x0,y0,x1,y1); ictx.rect(r.x,r.y,r.w,r.h); }
    else if (kind==='circle-shape') { const r=normRect(x0,y0,x1,y1); ictx.ellipse(r.x+r.w/2, r.y+r.h/2, r.w/2, r.h/2, 0,0,Math.PI*2); }
    else if (kind==='triangle-shape') { ictx.moveTo((x0+x1)/2,y0); ictx.lineTo(x0,y1); ictx.lineTo(x1,y1); ictx.closePath(); }
    ictx.stroke();
    ictx.restore();
    if (selection) drawSelectionOverlay();
  }

  function commitShape(layer, kind, x0,y0,x1,y1) {
    const ctx = layer.ctx;
    const clipped = applyClip(ctx);
    ctx.strokeStyle = currentColor.hex; ctx.lineWidth = Math.max(1,brush.size/6); ctx.globalAlpha = brush.opacity/100;
    ctx.beginPath();
    if (kind==='line') { ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); }
    else if (kind==='rect-shape') { const r=normRect(x0,y0,x1,y1); ctx.rect(r.x,r.y,r.w,r.h); }
    else if (kind==='circle-shape') { const r=normRect(x0,y0,x1,y1); ctx.ellipse(r.x+r.w/2, r.y+r.h/2, r.w/2, r.h/2, 0,0,Math.PI*2); }
    else if (kind==='triangle-shape') { ctx.moveTo((x0+x1)/2,y0); ctx.lineTo(x0,y1); ctx.lineTo(x1,y1); ctx.closePath(); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (clipped) ctx.restore();
  }

  interactionCanvas.addEventListener('pointerdown', (e) => {
    interactionCanvas.setPointerCapture(e.pointerId);
    const layer = getActiveLayer();
    const pt = canvasPoint(e);
    if (!layer) return;
    if (layer.locked && !['move','eyedropper'].includes(currentTool)) { showToast('เลเยอร์นี้ถูกล็อกอยู่'); return; }

    if (currentTool === 'eyedropper') { eyedrop(pt.x, pt.y); return; }

    if (currentTool === 'rect-select' || currentTool === 'ellipse-select') {
      dragStart = pt; isDrawing = true; return;
    }
    if (currentTool === 'fill') {
      pushHistory();
      const clipped = applyClip(layer.ctx);
      floodFill(layer, pt.x, pt.y, currentColor.hex);
      if (clipped) layer.ctx.restore();
      renderLayers(); return;
    }
    if (currentTool === 'gradient') { dragStart = pt; isDrawing = true; return; }
    if (currentTool === 'move') {
      dragStart = { x: e.clientX, y: e.clientY, scrollLeft: canvasWrapper.parentElement.scrollLeft, scrollTop: canvasWrapper.parentElement.scrollTop };
      isDrawing = true; interactionCanvas.style.cursor = 'grabbing'; return;
    }
    if (['line','rect-shape','circle-shape','triangle-shape'].includes(currentTool)) {
      dragStart = pt; isDrawing = true; return;
    }
    // freehand tools
    pushHistory();
    isDrawing = true; lastPt = pt; strokePoints = [pt];
    const clipped = applyClip(layer.ctx);
    if (currentTool === 'blur-tool') blurSegment(layer, pt);
    else if (currentTool === 'smudge') { /* need previous point, wait for move */ }
    else drawFreehandSegment(layer, pt, pt, getPressureSize(e));
    if (clipped) layer.ctx.restore();

    if (currentTool === 'airbrush') {
      airbrushTimer = setInterval(() => {
        if (!lastPt) return;
        const c2 = applyClip(layer.ctx);
        drawFreehandSegment(layer, lastPt, lastPt);
        if (c2) layer.ctx.restore();
      }, 60);
    }
    renderLayers();
  });

  window.addEventListener('pointermove', (e) => {
    const pt = canvasPoint(e);
    if (pt.x>=0 && pt.y>=0 && pt.x<=interactionCanvas.width && pt.y<=interactionCanvas.height) {
      coordsDisplay.textContent = `X: ${Math.round(pt.x)}, Y: ${Math.round(pt.y)}`;
    }
    if (!isDrawing) return;
    const layer = getActiveLayer(); if (!layer) return;

    if (currentTool === 'move') {
      const scrollParent = canvasWrapper.parentElement;
      scrollParent.scrollLeft = dragStart.scrollLeft - (e.clientX - dragStart.x);
      scrollParent.scrollTop = dragStart.scrollTop - (e.clientY - dragStart.y);
      return;
    }
    if (currentTool === 'rect-select' || currentTool === 'ellipse-select') {
      const r = normRect(dragStart.x, dragStart.y, pt.x, pt.y);
      selection = { ...r, shape: currentTool==='ellipse-select' ? 'ellipse' : 'rect', inverted: false };
      ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height);
      drawSelectionOverlay();
      return;
    }
    if (currentTool === 'gradient') {
      ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height);
      ictx.save(); ictx.strokeStyle = currentColor.hex; ictx.lineWidth=1; ictx.setLineDash([4,3]);
      ictx.beginPath(); ictx.moveTo(dragStart.x,dragStart.y); ictx.lineTo(pt.x,pt.y); ictx.stroke(); ictx.restore();
      return;
    }
    if (['line','rect-shape','circle-shape','triangle-shape'].includes(currentTool)) {
      drawShapePreview(currentTool, dragStart.x, dragStart.y, pt.x, pt.y);
      return;
    }
    // freehand
    const smooth = brush.stabilizer/100;
    const sx = lastPt.x + (pt.x-lastPt.x)*(1-smooth);
    const sy = lastPt.y + (pt.y-lastPt.y)*(1-smooth);
    const smoothPt = {x: sx, y: sy};
    const clipped = applyClip(layer.ctx);
    if (currentTool === 'blur-tool') blurSegment(layer, smoothPt);
    else if (currentTool === 'smudge') smudgeSegment(layer, lastPt, smoothPt);
    else drawFreehandSegment(layer, lastPt, smoothPt, getPressureSize(e));
    if (clipped) layer.ctx.restore();
    lastPt = smoothPt;
  });

  function handlePointerEnd(e) {
    if (!isDrawing) return;
    isDrawing = false;
    if (airbrushTimer) { clearInterval(airbrushTimer); airbrushTimer = null; }
    const layer = getActiveLayer();
    const pt = canvasPoint(e);

    if (currentTool === 'move') { interactionCanvas.style.cursor = 'grab'; dragStart=null; return; }

    if (currentTool === 'gradient' && layer) {
      pushHistory();
      const clipped = applyClip(layer.ctx);
      const grad = layer.ctx.createLinearGradient(dragStart.x, dragStart.y, pt.x, pt.y);
      grad.addColorStop(0, currentColor.hex);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      layer.ctx.fillStyle = grad;
      layer.ctx.fillRect(0,0,layer.canvas.width, layer.canvas.height);
      if (clipped) layer.ctx.restore();
      ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height);
      renderLayers();
    } else if (['line','rect-shape','circle-shape','triangle-shape'].includes(currentTool) && layer) {
      pushHistory();
      commitShape(layer, currentTool, dragStart.x, dragStart.y, pt.x, pt.y);
      ictx.clearRect(0,0,interactionCanvas.width, interactionCanvas.height);
      if (selection) drawSelectionOverlay();
      renderLayers();
    } else if (currentTool === 'rect-select' || currentTool === 'ellipse-select') {
      // selection already set during move
    }
    dragStart = null; lastPt = null; strokePoints = [];
  }
  // pointerup covers mouse/touch/pen release; pointercancel covers a touch
  // gesture getting interrupted (e.g. an incoming call, an OS-level swipe) —
  // without handling it too, isDrawing could get stuck "true" on mobile.
  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);

  // ===================================================================
  // TOP-LEVEL ACTIONS
  // ===================================================================
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function clearActiveLayer() {
    const layer = getActiveLayer(); if (!layer) return;
    if (!confirm('ล้างเลเยอร์นี้ทั้งหมดหรือไม่?')) return;
    pushHistory();
    layer.ctx.clearRect(0,0,layer.canvas.width, layer.canvas.height);
    renderLayers();
  }

  function newDocument() {
    if (!confirm('สร้างเอกสารใหม่? งานที่ยังไม่บันทึกจะหายไป')) return;
    layers = []; nextLayerId = 1; undoStack = []; redoStack = []; selection = null; clipboard = null;
    createLayer('พื้นหลัง (Background)', { fill: '#ffffff' });
    setActiveLayer(layers[0].id);
    document.getElementById('docTitle').textContent = 'ไม่มีชื่อ - ระบายสีโปร';
    showToast('สร้างเอกสารใหม่แล้ว');
  }

  function exportComposite() {
    const merged = document.createElement('canvas');
    merged.width = interactionCanvas.width; merged.height = interactionCanvas.height;
    const mctx = merged.getContext('2d');
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]; if (!l.visible) continue;
      mctx.globalAlpha = l.opacity/100; mctx.globalCompositeOperation = l.blendMode;
      mctx.drawImage(l.canvas, 0, 0);
    }
    return merged;
  }

  function saveFile() {
    const merged = exportComposite();
    const link = document.createElement('a');
    link.download = 'ผลงาน-ระบายสี.png';
    link.href = merged.toDataURL('image/png');
    link.click();
    showToast('บันทึกไฟล์ภาพแล้ว');
  }

  function openFile() { document.getElementById('fileInput').click(); }
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      pushHistory();
      const layer = createLayer(file.name.slice(0,20));
      const scale = Math.min(interactionCanvas.width/img.width, interactionCanvas.height/img.height, 1);
      const w = img.width*scale, h = img.height*scale;
      layer.ctx.drawImage(img, (interactionCanvas.width-w)/2, (interactionCanvas.height-h)/2, w, h);
      setActiveLayer(layer.id);
      showToast('นำเข้ารูปภาพแล้ว');
    };
    img.src = URL.createObjectURL(file);
    e.target.value = '';
  });

  function copySelection() {
    const layer = getActiveLayer(); if (!layer) return;
    const r = selection || { x:0, y:0, w: layer.canvas.width, h: layer.canvas.height };
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    c.getContext('2d').drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    clipboard = { w: r.w, h: r.h, dataURL: c.toDataURL() };
    showToast('คัดลอกแล้ว');
  }
  function cutSelection() {
    copySelection();
    const layer = getActiveLayer(); if (!layer) return;
    pushHistory();
    const r = selection || { x:0, y:0, w: layer.canvas.width, h: layer.canvas.height };
    layer.ctx.clearRect(r.x, r.y, r.w, r.h);
    renderLayers();
    showToast('ตัดแล้ว');
  }
  function pasteClipboard() {
    if (!clipboard) { showToast('ไม่มีข้อมูลในคลิปบอร์ด'); return; }
    const layer = getActiveLayer(); if (!layer) return;
    pushHistory();
    const img = new Image();
    img.onload = () => {
      const x = (layer.canvas.width - clipboard.w)/2, y = (layer.canvas.height - clipboard.h)/2;
      layer.ctx.drawImage(img, x, y);
      renderLayers();
    };
    img.src = clipboard.dataURL;
    showToast('วางแล้ว');
  }
  function deleteSelectionArea() {
    const layer = getActiveLayer(); if (!layer) return;
    pushHistory();
    if (selection) layer.ctx.clearRect(selection.x, selection.y, selection.w, selection.h);
    else layer.ctx.clearRect(0,0,layer.canvas.width, layer.canvas.height);
    renderLayers();
  }
  function selectAll() { selection = { x:0, y:0, w: interactionCanvas.width, h: interactionCanvas.height, shape:'rect', inverted:false }; clearOverlay(); showToast('เลือกทั้งหมดแล้ว'); }
  function deselectAll() { selection = null; clearOverlay(); showToast('ยกเลิกการเลือกแล้ว'); }
  function invertSelection() {
    if (!selection) { showToast('ยังไม่มีพื้นที่ที่เลือก'); return; }
    selection.inverted = !selection.inverted; clearOverlay(); showToast('สลับพื้นที่เลือกแล้ว');
  }

  // Zoom
  function applyZoom() {
    canvasStack.style.transform = `scale(${zoom/100})`;
    canvasStack.style.transformOrigin = 'top left';
    canvasWrapper.style.width = (interactionCanvas.width * zoom/100) + 'px';
    canvasWrapper.style.height = (interactionCanvas.height * zoom/100) + 'px';
    document.getElementById('zoomLabel').textContent = Math.round(zoom) + '%';
    document.getElementById('zoomSlider').value = zoom;
  }
  function setZoom(z) { zoom = Math.min(800, Math.max(10, z)); applyZoom(); }
  document.getElementById('zoomSlider').addEventListener('input', e => setZoom(parseFloat(e.target.value)));
  applyZoom();

  function fitCanvas() {
    const section = document.querySelector('main > section');
    const availW = section.clientWidth - 60, availH = section.clientHeight - 60;
    const scale = Math.min(availW/interactionCanvas.width, availH/interactionCanvas.height, 1) * 100;
    setZoom(Math.max(10, scale));
  }

  // Image transforms
  function resizeCanvas(w, h, scaleContent) {
    pushHistory();
    layers.forEach(l => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (scaleContent) ctx.drawImage(l.canvas, 0, 0, w, h);
      else ctx.drawImage(l.canvas, 0, 0);
      l.canvas = c; l.ctx = ctx;
    });
    setCanvasSize(w, h);
    reflowLayerDom();
    fitCanvas();
    renderLayers();
  }
  function promptResize(scaleContent) {
    const w = parseInt(prompt('ความกว้างใหม่ (px):', interactionCanvas.width));
    if (!w) return;
    const h = parseInt(prompt('ความสูงใหม่ (px):', interactionCanvas.height));
    if (!h) return;
    resizeCanvas(w, h, scaleContent);
  }
  function rotateCanvas90() {
    pushHistory();
    const w = interactionCanvas.width, h = interactionCanvas.height;
    layers.forEach(l => {
      const c = document.createElement('canvas'); c.width = h; c.height = w;
      const ctx = c.getContext('2d');
      ctx.translate(h,0); ctx.rotate(Math.PI/2); ctx.drawImage(l.canvas,0,0);
      l.canvas = c; l.ctx = ctx;
    });
    setCanvasSize(h, w);
    reflowLayerDom(); fitCanvas(); renderLayers();
    showToast('หมุนภาพแล้ว');
  }
  function flipCanvasH() {
    pushHistory();
    layers.forEach(l => {
      const c = document.createElement('canvas'); c.width = l.canvas.width; c.height = l.canvas.height;
      const ctx = c.getContext('2d');
      ctx.translate(c.width,0); ctx.scale(-1,1); ctx.drawImage(l.canvas,0,0);
      l.canvas = c; l.ctx = ctx;
    });
    reflowLayerDom(); renderLayers();
    showToast('พลิกภาพแนวนอนแล้ว');
  }
  function cropToSelection() {
    if (!selection) { showToast('กรุณาเลือกพื้นที่ก่อน (M)'); return; }
    resizeAndOffset(selection.x, selection.y, selection.w, selection.h);
    selection = null; clearOverlay();
  }
  function resizeAndOffset(x,y,w,h) {
    pushHistory();
    layers.forEach(l => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(l.canvas, x, y, w, h, 0, 0, w, h);
      l.canvas = c; l.ctx = ctx;
    });
    setCanvasSize(w, h);
    reflowLayerDom(); fitCanvas(); renderLayers();
    showToast('ครอบตัดภาพแล้ว');
  }

  // Effects
  function applyGaussianBlur() {
    const layer = getActiveLayer(); if (!layer) return;
    pushHistory();
    const temp = document.createElement('canvas'); temp.width=layer.canvas.width; temp.height=layer.canvas.height;
    const tctx = temp.getContext('2d');
    tctx.filter = 'blur(4px)'; tctx.drawImage(layer.canvas,0,0);
    layer.ctx.clearRect(0,0,layer.canvas.width, layer.canvas.height);
    layer.ctx.drawImage(temp,0,0);
    renderLayers();
    showToast('ใช้ Gaussian Blur แล้ว');
  }
  function applyPixelate() {
    const layer = getActiveLayer(); if (!layer) return;
    pushHistory();
    const factor = 12;
    const temp = document.createElement('canvas'); temp.width=layer.canvas.width/factor; temp.height=layer.canvas.height/factor;
    const tctx = temp.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(layer.canvas, 0,0, temp.width, temp.height);
    layer.ctx.imageSmoothingEnabled = false;
    layer.ctx.clearRect(0,0,layer.canvas.width, layer.canvas.height);
    layer.ctx.drawImage(temp, 0,0, layer.canvas.width, layer.canvas.height);
    layer.ctx.imageSmoothingEnabled = true;
    renderLayers();
    showToast('ใช้ Pixelate แล้ว');
  }

  // Blend/opacity controls
  document.getElementById('blendModeSelect').addEventListener('change', e => {
    const layer = getActiveLayer(); if (!layer) return;
    layer.blendMode = e.target.value; reflowLayerDom();
  });
  document.getElementById('layerOpacityInput').addEventListener('input', e => {
    const layer = getActiveLayer(); if (!layer) return;
    layer.opacity = Math.min(100, Math.max(0, parseFloat(e.target.value)||0)); reflowLayerDom();
  });

  // Grid / Hide UI / Symmetry
  function toggleGrid() { gridOn = !gridOn; document.getElementById('gridOverlay').style.display = gridOn ? 'block' : 'none'; document.getElementById('gridBtn').classList.toggle('btn-active', gridOn); }
  function toggleUI() { document.body.classList.toggle('hide-ui'); }
  function toggleSymmetry() { symmetryOn = !symmetryOn; document.getElementById('symmetryBtn').classList.toggle('btn-active', symmetryOn); showToast(symmetryOn ? 'เปิดสมมาตรแล้ว' : 'ปิดสมมาตรแล้ว'); }

  // ===================================================================
  // ACTION DISPATCH
  // ===================================================================
  const actions = {
    'new': newDocument, 'open': openFile, 'save': saveFile,
    'undo': undo, 'redo': redo,
    'cut': cutSelection, 'copy': copySelection, 'paste': pasteClipboard,
    'delete-selection': deleteSelectionArea, 'select-all': selectAll, 'deselect': deselectAll, 'invert-selection': invertSelection,
    'zoom-in': () => setZoom(zoom+25), 'zoom-out': () => setZoom(zoom-25), 'zoom-fit': fitCanvas, 'zoom-100': () => setZoom(100),
    'toggle-grid': toggleGrid, 'toggle-ui': toggleUI, 'toggle-symmetry': toggleSymmetry,
    'resize-canvas': () => promptResize(false), 'resize-image': () => promptResize(true),
    'rotate-canvas': rotateCanvas90, 'flip-canvas': flipCanvasH, 'crop': cropToSelection,
    'layer-new': addLayer, 'layer-delete': deleteLayer, 'layer-duplicate': duplicateLayer, 'layer-merge-down': mergeLayerDown, 'flatten': flattenImage,
    'clear-layer': clearActiveLayer,
    'show-shortcuts': showShortcuts, 'show-about': showAbout,
    'toast': () => showToast('ฟีเจอร์นี้ยังไม่รองรับในเวอร์ชันนี้'),
  };
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); const fn = actions[el.dataset.action]; if (fn) fn(); });
  });
  document.querySelectorAll('[data-effect]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const eff = el.dataset.effect;
      if (eff === 'gaussian-blur') applyGaussianBlur();
      else if (eff === 'pixelate') applyPixelate();
      else showToast('เอฟเฟกต์นี้ยังไม่รองรับในเวอร์ชันนี้');
    });
  });

  // ===================================================================
  // KEYBOARD SHORTCUTS
  // ===================================================================
  const keyToolMap = { v:'move', m:'rect-select', b:'brush', p:'pencil', l:'line', r:'rect-shape', u:'circle-shape', g:'fill', i:'eyedropper', e:'eraser' };
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k==='k') { e.preventDefault(); toggleSearchModal(); }
      else if (k==='z') { e.preventDefault(); undo(); }
      else if (k==='y') { e.preventDefault(); redo(); }
      else if (k==='s') { e.preventDefault(); saveFile(); }
      else if (k==='n') { e.preventDefault(); newDocument(); }
      else if (k==='o') { e.preventDefault(); openFile(); }
      else if (k==='x') { e.preventDefault(); cutSelection(); }
      else if (k==='c') { e.preventDefault(); copySelection(); }
      else if (k==='v') { e.preventDefault(); pasteClipboard(); }
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); toggleUI(); return; }
    if (e.key.toLowerCase() === 's' && !e.ctrlKey) { toggleSymmetry(); return; }
    const mapped = keyToolMap[e.key.toLowerCase()];
    if (mapped) setTool(mapped);
  });

  // ===================================================================
  // SEARCH MODAL
  // ===================================================================
  const toolIndex = [
    {label:'Move (ย้าย)', icon:'fa-arrow-pointer', shortcut:'V', run:()=>setTool('move')},
    {label:'Rectangle Selection (เลือกสี่เหลี่ยม)', icon:'fa-square', shortcut:'M', run:()=>setTool('rect-select')},
    {label:'Ellipse Selection (เลือกวงรี)', icon:'fa-circle', shortcut:'', run:()=>setTool('ellipse-select')},
    {label:'Pen (ปากกา)', icon:'fa-pen-nib', shortcut:'', run:()=>setTool('pen')},
    {label:'Pencil (ดินสอ)', icon:'fa-pencil', shortcut:'P', run:()=>setTool('pencil')},
    {label:'Brush (แปรง)', icon:'fa-paint-brush', shortcut:'B', run:()=>setTool('brush')},
    {label:'Airbrush (สเปรย์)', icon:'fa-spray-can', shortcut:'', run:()=>setTool('airbrush')},
    {label:'Eraser (ยางลบ)', icon:'fa-eraser', shortcut:'E', run:()=>setTool('eraser')},
    {label:'Line (เส้นตรง)', icon:'fa-slash', shortcut:'L', run:()=>setTool('line')},
    {label:'Rectangle (สี่เหลี่ยม)', icon:'fa-square', shortcut:'R', run:()=>setTool('rect-shape')},
    {label:'Circle (วงกลม)', icon:'fa-circle', shortcut:'U', run:()=>setTool('circle-shape')},
    {label:'Triangle (สามเหลี่ยม)', icon:'fa-play', shortcut:'', run:()=>setTool('triangle-shape')},
    {label:'Fill Bucket (เทสี)', icon:'fa-fill-drip', shortcut:'G', run:()=>setTool('fill')},
    {label:'Gradient (ไล่สี)', icon:'fa-gradient', shortcut:'', run:()=>setTool('gradient')},
    {label:'Eyedropper (หลอดดูดสี)', icon:'fa-eye-dropper', shortcut:'I', run:()=>setTool('eyedropper')},
    {label:'Blur Tool (เบลอ)', icon:'fa-droplet', shortcut:'', run:()=>setTool('blur-tool')},
    {label:'Smudge (ป้ายสี)', icon:'fa-hand-pointer', shortcut:'', run:()=>setTool('smudge')},
    {label:'Gaussian Blur (เอฟเฟกต์)', icon:'fa-droplet', shortcut:'', run:applyGaussianBlur},
    {label:'Pixelate / Mosaic', icon:'fa-th', shortcut:'', run:applyPixelate},
    {label:'New Layer (เลเยอร์ใหม่)', icon:'fa-plus', shortcut:'', run:addLayer},
    {label:'Undo', icon:'fa-rotate-left', shortcut:'Ctrl+Z', run:undo},
    {label:'Redo', icon:'fa-rotate-right', shortcut:'Ctrl+Y', run:redo},
    {label:'Save (บันทึก)', icon:'fa-floppy-disk', shortcut:'Ctrl+S', run:saveFile},
    {label:'Toggle Grid (แสดงกริด)', icon:'fa-ruler-combined', shortcut:'', run:toggleGrid},
    {label:'Toggle Symmetry (สมมาตร)', icon:'fa-arrows-split-up-and-left', shortcut:'S', run:toggleSymmetry},
  ];
  function renderSearchResults(filter='') {
    const results = document.getElementById('searchResults');
    results.innerHTML = '';
    const f = filter.toLowerCase();
    toolIndex.filter(t => t.label.toLowerCase().includes(f)).forEach(t => {
      const row = document.createElement('div');
      row.className = 'p-2 hover:bg-appHover rounded cursor-pointer flex justify-between items-center';
      row.innerHTML = `<span><i class="fa-solid ${t.icon} mr-2 text-appCyan"></i>${t.label}</span>` +
        (t.shortcut ? `<span class="text-[10px] bg-appToolbar px-1.5 py-0.5 rounded border border-appBorder">${t.shortcut}</span>` : '');
      row.addEventListener('click', () => { t.run(); toggleSearchModal(); });
      results.appendChild(row);
    });
  }
  document.getElementById('searchInput').addEventListener('input', e => renderSearchResults(e.target.value));
  function toggleSearchModal() {
    const modal = document.getElementById('searchModal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
      renderSearchResults('');
      document.getElementById('searchInput').value = '';
      document.getElementById('searchInput').focus();
    }
  }

  // ===================================================================
  // INFO MODALS
  // ===================================================================
  function openInfoModal(title, html) {
    document.getElementById('infoModalTitle').textContent = title;
    document.getElementById('infoModalBody').innerHTML = html;
    document.getElementById('infoModal').classList.add('open');
  }
  function closeInfoModal() { document.getElementById('infoModal').classList.remove('open'); }
  document.getElementById('infoModal').addEventListener('click', e => { if (e.target.id === 'infoModal') closeInfoModal(); });
  function showShortcuts() {
    openInfoModal('Keyboard Shortcuts', `
      <div>V — Move · M — Rectangle Select · B — Brush · P — Pencil · E — Eraser</div>
      <div>L — Line · R — Rectangle · U — Circle · G — Fill Bucket · I — Eyedropper</div>
      <div>S — Toggle Symmetry · Tab — Hide/Show UI</div>
      <div>Ctrl+Z — Undo · Ctrl+Y — Redo · Ctrl+S — Save · Ctrl+N — New · Ctrl+O — Open</div>
      <div>Ctrl+X/C/V — Cut/Copy/Paste · Ctrl+K — Search Tools</div>
    `);
  }
  function showAbout() {
    openInfoModal('About', `<div>ระบายสีโปร — เดโมแอปวาดภาพบนเว็บ สร้างด้วย HTML5 Canvas ล้วน ๆ ไม่มีการอัปโหลดข้อมูลออกจากเบราว์เซอร์ของคุณ</div>`);
  }

  // ===================================================================
  // FPS + MEMORY
  // ===================================================================
  let frames = 0, lastFpsTime = performance.now();
  function fpsLoop(now) {
    frames++;
    if (now - lastFpsTime >= 1000) {
      document.getElementById('fpsDisplay').textContent = 'FPS: ' + frames;
      frames = 0; lastFpsTime = now;
    }
    requestAnimationFrame(fpsLoop);
  }
  requestAnimationFrame(fpsLoop);
  function updateMemoryDisplay() {
    const bytes = layers.reduce((sum,l) => sum + l.canvas.width*l.canvas.height*4, 0);
    document.getElementById('memDisplay').textContent = 'Memory: ' + (bytes/1024/1024).toFixed(1) + ' MB';
  }

  // ===================================================================
  // MOBILE: TAP-TO-OPEN DROPDOWNS
  // (":hover" menus in the top bar don't work on touch devices)
  // ===================================================================
  function initDropdownTapSupport() {
    document.querySelectorAll('.group').forEach(group => {
      const trigger = Array.from(group.children).find(el => !el.classList.contains('dropdown-menu'));
      if (!trigger) return;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = group.classList.contains('open');
        document.querySelectorAll('.group.open').forEach(g => g.classList.remove('open'));
        if (!wasOpen) group.classList.add('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.group.open').forEach(g => g.classList.remove('open'));
    });
  }
  initDropdownTapSupport();

  // ===================================================================
  // MOBILE: SIDE PANEL DRAWERS
  // ===================================================================
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const mobileOverlay = document.getElementById('mobileOverlay');
  function openPanel(panel) {
    closePanels();
    panel.classList.add('panel-open');
    mobileOverlay.classList.add('show');
  }
  function closePanels() {
    leftPanel.classList.remove('panel-open');
    rightPanel.classList.remove('panel-open');
    mobileOverlay.classList.remove('show');
  }
  document.getElementById('toggleLeftPanel').addEventListener('click', () => openPanel(leftPanel));
  document.getElementById('toggleRightPanel').addEventListener('click', () => openPanel(rightPanel));
  document.querySelectorAll('[data-close-panel]').forEach(btn => btn.addEventListener('click', closePanels));
  mobileOverlay.addEventListener('click', closePanels);

  // ===================================================================
  // INIT
  // ===================================================================
  createLayer('พื้นหลัง (Background)', { fill: '#ffffff', insertTop: false });
  createLayer('เลเยอร์ 1', { insertTop: false });
  createLayer('เลเยอร์ 2', { insertTop: false });
  createLayer('เลเยอร์ 3', { insertTop: false });
  setActiveLayer(layers[0].id);
  fitCanvas();
  showToast('พร้อมใช้งาน — เลือกเครื่องมือแล้วเริ่มวาดได้เลย');
