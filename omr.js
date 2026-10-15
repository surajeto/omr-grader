// omr.js — ตัวอ่านกระดาษคำตอบ (OpenCV.js) สำหรับแบบฟอร์ม ม.อุบลฯ 60 ข้อ 4 ตัวเลือก
// หลักการ: หา ArUco marker 4 มุม -> ระบุมุม/ทิศทางจาก bit pattern -> perspective warp
// -> วัดความเข้มของแต่ละวงเทียบกับกระดาษรอบวง -> ตัดสินด้วย threshold แบบ adaptive (Otsu)
const OMR = (() => {
  // พิกัดจาก PDF (หน่วย pt) อ้างอิงจากจุดศูนย์กลาง marker มุมซ้ายบน
  const T = {
    W: 245.19, H: 368.5,
    ax: [12.73, 24.35, 35.97, 47.59, 79.34, 90.96, 102.58, 114.21, 145.95, 157.58, 169.2, 180.82, 212.57, 224.19, 235.81, 247.43],
    ay: [172.17, 184.5, 196.84, 209.17, 221.5, 236.09, 248.42, 260.76, 273.09, 285.42, 300.01, 312.35, 324.68, 337.01, 349.34],
    ix: [4.3, 14.36, 24.42, 34.48, 44.55, 54.61, 64.67, 74.73, 84.8, 94.86, 104.92, 119.52, 129.58, 144.18, 154.25, 164.31],
    iy: [61.62, 71.12, 80.62, 90.11, 99.61, 109.1, 118.6, 128.1, 137.59, 147.09],
    rA: 4.1, rI: 3.65,
    // ชื่อ-สกุล (กรอบสำหรับครอปภาพลายมือ)
    name: { x: 23, y: 16, w: 221, h: 20 },
    // 4 แบบฟอร์ม x 4 มุม (TL, TR, BL, BR) — inner 4x4 bits, 1 = ดำ
    bits: [
      ['0100101011001101', '1111000001100101', '0110011010111001', '1100110011010010'],
      ['1010101101100001', '1000011000110010', '0011101100001101', '0110000111010001'],
      ['0000000100100101', '0011000010101001', '1110111001011000', '0000011001101110'],
      ['1111000101001000', '1101010111110000', '1101100111000001', '1101101101001110'],
    ],
  };
  const CENTERS = [[0, 0], [T.W, 0], [0, T.H], [T.W, T.H]];
  const M = 14, S = 4; // margin (pt), px ต่อ pt ในภาพที่ warp แล้ว
  const OUT_W = Math.round((T.W + 2 * M) * S), OUT_H = Math.round((T.H + 2 * M) * S);
  const CHOICES = ['ก', 'ข', 'ค', 'ง'];

  const rot90 = b => { const o = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i * 4 + j] = b[(3 - j) * 4 + i]; return o; };
  const PATS = [];
  T.bits.forEach((row, v) => row.forEach((s, k) => {
    let b = [...s].map(Number);
    for (let r = 0; r < 4; r++) { PATS.push({ v, k, b }); b = rot90(b); }
  }));

  function orderCW(p) { // ให้จุดเรียงตามเข็มนาฬิกา (แกน y ชี้ลง)
    const a = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);
    return a < 0 ? [p[0], p[3], p[2], p[1]] : p;
  }

  function readMarker(gray, pts) {
    const N = 48, c = N / 6;
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, pts.flatMap(p => [p.x, p.y]));
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, N, 0, N, N, 0, N]);
    const H = cv.getPerspectiveTransform(src, dst);
    const patch = new cv.Mat();
    cv.warpPerspective(gray, patch, H, new cv.Size(N, N), cv.INTER_LINEAR);
    cv.threshold(patch, patch, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    const g = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      let s = 0, n = 0;
      for (let y = Math.round(i * c + 2); y < Math.round((i + 1) * c - 2); y++)
        for (let x = Math.round(j * c + 2); x < Math.round((j + 1) * c - 2); x++) { s += patch.ucharAt(y, x); n++; }
      g.push(s / n < 128 ? 1 : 0);
    }
    src.delete(); dst.delete(); H.delete(); patch.delete();
    let border = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i === 0 || j === 0 || i === 5 || j === 5) border += g[i * 6 + j];
    if (border < 18) return null;
    const inner = [];
    for (let i = 1; i < 5; i++) for (let j = 1; j < 5; j++) inner.push(g[i * 6 + j]);
    let best = null, bd = 99, second = 99;
    for (const p of PATS) {
      let d = 0; for (let i = 0; i < 16; i++) d += p.b[i] !== inner[i];
      if (d < bd) { second = bd; bd = d; best = p; } else if (d < second && !(p.v === best.v && p.k === best.k)) second = d;
    }
    if (bd > 1 || second <= bd) return null;
    return { v: best.v, k: best.k };
  }

  // หา marker ทั้งหมดในภาพ gray (cv.Mat CV_8U)
  function findMarkers(gray) {
    const minDim = Math.min(gray.rows, gray.cols);
    const bin = new cv.Mat();
    let bs = Math.round(minDim / 10) | 1; if (bs < 15) bs = 15;
    cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, bs, 12);
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const minA = (minDim * 0.022) ** 2, maxA = (minDim * 0.2) ** 2;
    const found = {};
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const a = cv.contourArea(cnt);
      if (a >= minA && a <= maxA) {
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.06 * cv.arcLength(cnt, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const d = approx.data32S;
          const pts = orderCW([0, 1, 2, 3].map(q => ({ x: d[q * 2], y: d[q * 2 + 1] })));
          const L = [0, 1, 2, 3].map(q => Math.hypot(pts[q].x - pts[(q + 1) % 4].x, pts[q].y - pts[(q + 1) % 4].y));
          if (Math.max(...L) / Math.min(...L) < 2.2) {
            const id = readMarker(gray, pts);
            if (id) {
              const key = id.v * 4 + id.k;
              if (!found[key] || found[key].area < a) {
                found[key] = { ...id, pts, area: a, cx: pts.reduce((s, p) => s + p.x, 0) / 4, cy: pts.reduce((s, p) => s + p.y, 0) / 4 };
              }
            }
          }
        }
        approx.delete();
      }
      cnt.delete();
    }
    bin.delete(); contours.delete(); hier.delete();
    // เลือกแบบฟอร์มที่เจอ marker มากที่สุด
    const byV = [[], [], [], []];
    Object.values(found).forEach(m => byV[m.v].push(m));
    byV.sort((a, b) => b.length - a.length);
    const ms = byV[0];
    const out = [null, null, null, null];
    ms.forEach(m => out[m.k] = m);
    return { markers: out, count: ms.length, variant: ms.length ? ms[0].v : -1 };
  }

  function homography(markers, scale) {
    const s = [], d = [];
    for (let k = 0; k < 4; k++) {
      s.push(markers[k].cx * scale, markers[k].cy * scale);
      d.push((CENTERS[k][0] + M) * S, (CENTERS[k][1] + M) * S);
    }
    const sm = cv.matFromArray(4, 1, cv.CV_32FC2, s), dm = cv.matFromArray(4, 1, cv.CV_32FC2, d);
    const H = cv.getPerspectiveTransform(sm, dm);
    sm.delete(); dm.delete();
    return H;
  }

  // ปรับตำแหน่งวงเฉพาะที่ (ชดเชยกระดาษโค้ง/งอ): หาจุดที่ "ข้างในเข้ม-ขอบรอบขาว" มากที่สุด
  // แล้วเกลี่ยด้วย median ของวงข้างเคียง เพื่อไม่ให้วงใดวงหนึ่งหลุดไปเกาะตัวเลข/เส้นกรอบ
  function integral(img, w, h) {
    const W1 = w + 1, ii = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += 255 - img[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; }
    }
    return (x0, y0, x1, y1) => {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
      return ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0];
    };
  }

  // 2 รอบ: หยาบ (ค้นกว้าง เกลี่ยกว้าง) แล้วละเอียด
  function refine(img, w, h, pts) {
    const box = integral(img, w, h);
    let cur = pts.map(() => [0, 0]);
    for (const [range, nbr] of [[4.5, 26], [2.5, 18], [1.4, 13]]) {
      const step = refineStep(box, pts.map((p, i) => ({ ...p, x: p.x + cur[i][0], y: p.y + cur[i][1] })), range, nbr);
      cur = cur.map((c, i) => [c[0] + step[i][0], c[1] + step[i][1]]);
    }
    return cur;
  }

  function refineStep(box, pts, range, nbr) {
    const SR = Math.round(range * S);
    const raw = pts.map(p => {
      const X = Math.round((p.x + M) * S), Y = Math.round((p.y + M) * S);
      const a = Math.round(p.r * S * 1.12), b = Math.round(p.r * S * 1.5);
      const ai = (2 * a) ** 2, ao = (2 * b) ** 2 - ai;
      let best = -1e18, bx = 0, by = 0;
      for (let dy = -SR; dy <= SR; dy++) for (let dx = -SR; dx <= SR; dx++) {
        const x = X + dx, y = Y + dy;
        const inner = box(x - a, y - a, x + a, y + a);
        const outer = box(x - b, y - b, x + b, y + b) - inner;
        const s = inner / ai - outer / ao - 0.01 * (dx * dx + dy * dy);
        if (s > best) { best = s; bx = dx; by = dy; }
      }
      return [bx / S, by / S];
    });
    const med = a => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
    return pts.map(p => {
      const nb = [];
      pts.forEach((q, j) => { if (Math.hypot(q.x - p.x, q.y - p.y) <= nbr) nb.push(raw[j]); });
      return [med(nb.map(o => o[0])), med(nb.map(o => o[1]))];
    });
  }

  // ความเข้มของวง: 0 = ว่าง, ~0.6+ = ฝนเต็ม
  function darkness(img, w, cx, cy, r) {
    const X = (cx + M) * S, Y = (cy + M) * S, R = r * S;
    const rIn = R * 0.62, r1 = R * 1.18, r2 = R * 1.4;
    let si = 0, ni = 0; const ring = [];
    for (let y = Math.floor(Y - r2); y <= Math.ceil(Y + r2); y++) for (let x = Math.floor(X - r2); x <= Math.ceil(X + r2); x++) {
      const dd = Math.hypot(x - X, y - Y), v = img[y * w + x];
      if (dd <= rIn) { si += v; ni++; } else if (dd >= r1 && dd <= r2) ring.push(v);
    }
    ring.sort((a, b) => a - b);
    const ref = Math.max(ring[Math.floor(ring.length * 0.8)], 40);
    return Math.max(0, Math.min(1, (ref - si / ni) / ref));
  }

  // ระดับ noise ของวงว่าง: ค่าที่ไม่ใช่ค่าสูงสุดของแต่ละกลุ่มส่วนใหญ่คือวงว่าง
  function floorOf(groups) {
    const rest = [];
    groups.forEach(ds => { const m = ds.indexOf(Math.max(...ds)); ds.forEach((d, i) => i !== m && rest.push(d)); });
    rest.sort((a, b) => a - b);
    const hi = rest[Math.floor(rest.length * 0.97)] || 0;
    return Math.min(0.25, Math.max(0.12, hi + 0.05));
  }

  // เลือกตัวเลือกจากค่าความเข้ม -> index | -1 (ว่าง) | -2 (ฝนหลายช่อง)
  function pick(ds, t) {
    const order = ds.map((d, i) => [d, i]).sort((a, b) => b[0] - a[0]);
    const [d1, i1] = order[0], d2 = order[1][0];
    if (d1 < t) return { i: -1, amb: d1 > t * 0.8 };
    if (d2 >= t && d2 >= d1 * 0.6) return { i: -2, amb: true };
    return { i: i1, amb: d1 < t * 1.4 || d2 > t * 0.85 };
  }

  // วิเคราะห์ภาพเต็ม (cv.Mat RGBA) — คืนค่า null ถ้าไม่พบ 4 มุม
  function analyze(rgba, opts = {}) {
    const nq = opts.questions || 60;
    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const det = opts.det || detectScaled(gray, 1400);
    if (det.count < 4) { gray.delete(); return { ok: false, det }; }
    const H = homography(det.markers, det.scale);
    const colorWarp = new cv.Mat();
    cv.warpPerspective(rgba, colorWarp, H, new cv.Size(OUT_W, OUT_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    H.delete(); gray.delete();
    // ใช้ช่องสีแดง: ดินสอ/ปากกาน้ำเงิน-ดำยังเข้ม แต่หมึกแดง (ครูขีด) จะหายไป
    const ch = new cv.MatVector();
    cv.split(colorWarp, ch);
    const warped = ch.get(0).clone();
    for (let i = 0; i < ch.size(); i++) ch.get(i).delete();
    ch.delete();
    const blur = new cv.Mat();
    cv.GaussianBlur(warped, blur, new cv.Size(3, 3), 0);
    const img = blur.data, w = OUT_W;

    // ความคมชัด (Laplacian variance) บริเวณข้อสอบ
    const roi = warped.roi(new cv.Rect(Math.round(M * S), Math.round((M + 160) * S), Math.round(T.W * S), Math.round(200 * S)));
    const lap = new cv.Mat(), mean = new cv.Mat(), std = new cv.Mat();
    cv.Laplacian(roi, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, std);
    const sharp = std.doubleAt(0, 0) ** 2;
    roi.delete(); lap.delete(); mean.delete(); std.delete();

    const pts = [];
    for (let q = 0; q < 60; q++) for (let c = 0; c < 4; c++)
      pts.push({ x: T.ax[Math.floor(q / 15) * 4 + c], y: T.ay[q % 15], r: T.rA });
    T.ix.forEach(x => T.iy.forEach(y => pts.push({ x, y, r: T.rI })));
    const off = refine(img, w, OUT_H, pts);
    pts.forEach((p, i) => { p.x += off[i][0]; p.y += off[i][1]; p.d = darkness(img, w, p.x, p.y, p.r); });
    const A = [], I = []; // A[q][c], I[col][digit]
    for (let q = 0; q < 60; q++) A.push(pts.slice(q * 4, q * 4 + 4).map(p => p.d));
    for (let c = 0; c < 16; c++) I.push(pts.slice(240 + c * 10, 250 + c * 10).map(p => p.d));
    blur.delete(); warped.delete();

    const t = floorOf(A.slice(0, nq)), tI = floorOf(I);
    const answers = [], flags = [];
    for (let q = 0; q < nq; q++) { const p = pick(A[q], t); answers.push(p.i); flags.push(p.amb); }
    const digits = I.map(ds => { const p = pick(ds, tI); return p.i >= 0 ? String(p.i) : (p.i === -2 ? '*' : ''); });
    const studentId = digits.slice(0, 11).join(''), group = digits.slice(11, 13).join(''), seat = digits.slice(13, 16).join('');
    let cw = colorWarp;
    if (!opts.keepColor) { colorWarp.delete(); cw = null; }
    return { ok: true, det, variant: det.variant, answers, flags, studentId, group, seat, sharp, t, A, I, pts, colorWarp: cw };
  }

  // หา marker บนภาพย่อ (เร็ว) — scale ใช้แปลงพิกัดกลับภาพเต็ม
  function detectScaled(gray, maxSide) {
    const f = Math.min(1, maxSide / Math.max(gray.rows, gray.cols));
    let g = gray;
    if (f < 1) { g = new cv.Mat(); cv.resize(gray, g, new cv.Size(Math.round(gray.cols * f), Math.round(gray.rows * f)), 0, 0, cv.INTER_AREA); }
    const det = findMarkers(g);
    if (g !== gray) g.delete();
    det.scale = 1 / f;
    return det;
  }

  // ครอปภาพช่องชื่อ -> dataURL (JPEG)
  function nameCrop(colorWarp, outW = 640) {
    const n = T.name;
    const r = new cv.Rect(Math.round((n.x + M) * S), Math.round((n.y + M) * S), Math.round(n.w * S), Math.round(n.h * S));
    const roi = colorWarp.roi(r), small = new cv.Mat();
    cv.resize(roi, small, new cv.Size(outW, Math.round(outW * n.h / n.w)), 0, 0, cv.INTER_AREA);
    const c = document.createElement('canvas');
    cv.imshow(c, small);
    roi.delete(); small.delete();
    return c.toDataURL('image/jpeg', 0.7);
  }

  return { analyze, detectScaled, nameCrop, CHOICES, T, M, S, OUT_W, OUT_H };
})();
