// app.js — UI, กล้องถ่ายอัตโนมัติ, เก็บผล, export
const $ = s => document.querySelector(s);
const CH = OMR.CHOICES;
const SHARP_MIN = 120;      // ความคมขั้นต่ำ (Laplacian variance) ก่อนยอมรับภาพ
const STABLE_TICKS = 3;     // ต้องนิ่งกี่เฟรมติดกันก่อนถ่าย
const NAME_MODEL = 'claude-opus-5-5';

// ---------- storage ----------
// เปิดเป็นเว็บทั่วไป -> localStorage · เปิดบน claude.ai -> เก็บในพื้นที่ส่วนตัวของผู้ใช้ (db capability)
const inClaude = () => typeof window.claude?.use === 'function';
const cloud = { db: null, uid: null, last: new Map(), q: Promise.resolve() };
let db = inClaude() ? { exams: [], settings: {} } : load();
function load() {
  try { return JSON.parse(localStorage.getItem('omr.v1')) || { exams: [], settings: {} }; }
  catch { return { exams: [], settings: {} }; }
}
function save() {
  if (cloud.db) return syncCloud();
  try { localStorage.setItem('omr.v1', JSON.stringify(db)); }
  catch { toast('พื้นที่เก็บข้อมูลเต็ม — export แล้วลบชุดเก่าออก'); }
}
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// 1 เอกสารต่อชุดข้อสอบ + 1 เอกสารต่อกระดาษ 1 แผ่น (ภาพชื่อทำให้รวมกันแล้วใหญ่เกินขีดจำกัดต่อเอกสาร)
function cloudDocs() {
  const base = 'data/users/' + cloud.uid, m = new Map();
  m.set(base + '/settings', db.settings);
  for (const e of db.exams) {
    const { records, ...ex } = e;
    m.set(`${base}/ex_${e.id}`, ex);
    for (const r of records) { if (!r.id) r.id = rid(); m.set(`${base}/ex_${e.id}/records/${r.id}`, r); }
  }
  return m;
}
function syncCloud() {
  const next = cloudDocs(), ops = [];
  for (const [p, d] of next) { const j = JSON.stringify(d); if (cloud.last.get(p) !== j) { ops.push([p, j]); cloud.last.set(p, j); } }
  for (const p of [...cloud.last.keys()]) if (!next.has(p)) { ops.push([p, null]); cloud.last.delete(p); }
  cloud.q = cloud.q.then(async () => {
    for (const [p, j] of ops) {
      try { j === null ? await cloud.db.doc(p).delete() : await cloud.db.doc(p).set(JSON.parse(j)); }
      catch (err) {
        console.warn('db', err);
        toast(err?.code === 'quota_exceeded' ? 'พื้นที่เก็บข้อมูลเต็ม — export แล้วลบชุดเก่า' : 'บันทึกไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต');
      }
    }
  });
}
async function initCloud() {
  if (!inClaude()) return;
  const [store, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  const uid = user && await user.id();
  if (!store || !uid) return;
  const base = 'data/users/' + uid;
  const snap = await store.collection(base).get();
  const exams = []; let settings = {};
  for (const d of snap.docs) {
    if (d.id === 'settings') settings = { ...d.data() };
    else if (d.id.startsWith('ex_')) {
      const rs = await store.doc(`${base}/${d.id}`).collection('records').get();
      exams.push({ ...d.data(), records: rs.docs.map(x => ({ ...x.data() })).sort((a, b) => a.at - b.at) });
    }
  }
  exams.sort((a, b) => a.created - b.created);
  cloud.db = store; cloud.uid = uid;
  // สิ่งที่ทำไปก่อนโหลดเสร็จจะไม่หาย
  const fresh = db.exams.filter(e => !exams.some(x => x.id === e.id));
  db = { exams: [...exams, ...fresh], settings: { ...settings, ...db.settings } };
  cloudDocs().forEach((v, p) => { if (!fresh.some(e => p.includes('ex_' + e.id))) cloud.last.set(p, JSON.stringify(v)); });
  if (fresh.length) syncCloud();
  if (cur) cur = exam(cur.id) || cur;
  const on = document.querySelector('.screen.on')?.id;
  if (on === 'home' || on === 'results' || on === 'settings') show(on);
}
const exam = id => db.exams.find(e => e.id === id);
let cur = null; // ชุดที่เปิดอยู่

// ---------- helpers ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  window.scrollTo(0, 0);
  if (id === 'home') renderHome();
  if (id === 'results') renderResults();
  if (id === 'settings') renderSettings();
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

// ---------- home ----------
function renderHome() {
  const ul = $('#examList');
  $('#examCount').textContent = db.exams.length ? `${db.exams.length} ชุด` : '';
  if (!db.exams.length) { ul.innerHTML = '<li class="empty2" style="border:0;display:block">ยังไม่มีชุดข้อสอบ — เริ่มชุดแรกได้เลย</li>'; return; }
  ul.innerHTML = db.exams.slice().reverse().map(e =>
    `<li data-id="${e.id}"><span class="dot"></span><div class="main"><div class="t">${esc(e.subject)}</div><div class="s">${e.n} ข้อ · ${fmtTime(e.created)}</div></div><div class="n">${e.records.length}<small> แผ่น</small></div></li>`).join('');
  ul.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => { cur = exam(li.dataset.id); show('results'); });
}
$('#newExam').onclick = () => openEdit(null);

// ---------- edit exam ----------
let draftKey = [];
function openEdit(e) {
  cur = e;
  $('#editTitle').textContent = e ? 'แก้ไขชุด' : 'ชุดใหม่';
  $('#fSubject').value = e ? e.subject : '';
  $('#fN').value = e ? e.n : 60;
  draftKey = e ? e.key.slice() : new Array(60).fill(-1);
  while (draftKey.length < 60) draftKey.push(-1);
  $('#fKeyText').value = ''; applyPaste();
  $('#saveExam').textContent = e ? 'บันทึก' : 'เริ่มตรวจ';
  renderKey();
  show('edit');
}
function nVal() { return Math.max(1, Math.min(60, parseInt($('#fN').value) || 60)); }
function renderKey() {
  const n = nVal();
  $('#keyGrid').innerHTML = Array.from({ length: n }, (_, q) =>
    `<div class="kq"><b>${q + 1}</b>${CH.map((c, k) => `<button data-q="${q}" data-k="${k}" class="${draftKey[q] === k ? 'on' : ''}">${c}</button>`).join('')}</div>`).join('');
}
$('#keyGrid').onclick = ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const q = +b.dataset.q, k = +b.dataset.k;
  draftKey[q] = draftKey[q] === k ? -1 : k;
  b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.k === draftKey[q]));
};
$('#fN').oninput = renderKey;
// ---------- ช่องวางเฉลยอัจฉริยะ ----------
// รองรับ: กขคง… / ก ข ค ง / A,B,C / abcd / 1234 / "1.ก 2.ข" / "ข้อ 1 ตอบ ข" / ตาราง Excel (เลขข้อ<tab>คำตอบ)
// เลขไทย/ตัวเต็มความกว้าง, หัวตาราง ("ข้อ", "เฉลย", "Answer") ถูกตัดทิ้ง
function parseKey(raw) {
  let s = raw.replace(/[๐-๙]/g, d => '๐๑๒๓๔๕๖๗๘๙'.indexOf(d))
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/คำตอบ|เฉลย|ข้อ|ตอบ|answers?|ans|key|no\.|q(?=\d)/gi, ' ');
  const val = c => { const i = 'กขคง'.indexOf(c); return i >= 0 ? i : 'abcd'.indexOf(c.toLowerCase()) >= 0 ? 'abcd'.indexOf(c.toLowerCase()) : +c - 1; };

  // 1) แบบมีเลขข้อกำกับ
  const re = /(^|[^\d])(\d{1,2})(\s*[.)\]:：\-–=]\s*|\s+)(?:([กขคง])(?![฀-๿])|([a-dA-D])(?![a-zA-Z])|([1-4])(?![\d.)]))/g;
  const pairs = [];
  const lineWise = s.trim().split(/\n/).every(l => !l.trim() || /^\s*\d{1,2}\s+\d\s*$/.test(l));
  for (const m of s.matchAll(re)) {
    // คำตอบที่เป็นตัวเลข ต้องมีตัวคั่นชัดเจน (. ) - tab) หรือบรรทัดละคู่ ไม่งั้น "1 2 3 4" จะถูกตีความผิด
    if (m[6] && !/[.)\]:：\-–=\t]/.test(m[3]) && !lineWise) continue;
    pairs.push([+m[2], val(m[4] || m[5] || m[6])]);
  }
  if (pairs.length >= 2) {
    const qs = pairs.map(p => p[0]);
    let plus1 = 0, up = 0;
    for (let i = 1; i < qs.length; i++) { if (qs[i] === qs[i - 1] + 1) plus1++; if (qs[i] > qs[i - 1]) up++; }
    const steps = qs.length - 1, okRange = qs.every(q => q >= 1 && q <= 60);
    if (okRange && new Set(qs).size >= qs.length * 0.9 && up >= steps * 0.9 && plus1 >= steps * 0.5) {
      const keys = new Array(60).fill(-1);
      pairs.forEach(([q, k]) => { keys[q - 1] = k; });
      const n = Math.max(...qs);
      const miss = keys.slice(0, n).map((k, i) => k < 0 ? i + 1 : 0).filter(Boolean);
      return { keys, n, found: n - miss.length, miss };
    }
  }

  // 2) แบบเรียงต่อกัน
  const letters = [], digits = [];
  for (const [t] of s.matchAll(/[฀-๿]+|[A-Za-z]+|\d+/g)) {
    if (/^[กขคง]+$/.test(t) || /^[a-dA-D]+$/.test(t)) letters.push(...[...t].map(val));
    else if (/^[1-4]+$/.test(t)) digits.push(...[...t].map(val));
  }
  const seq = letters.length ? letters : digits;
  const keys = new Array(60).fill(-1);
  seq.slice(0, 60).forEach((k, i) => { keys[i] = k; });
  return { keys, n: Math.min(60, seq.length), found: Math.min(60, seq.length), miss: [], over: seq.length > 60 };
}
function applyPaste() {
  const box = $('.paste'), msg = $('#pasteMsg'), v = $('#fKeyText').value;
  box.classList.remove('done', 'warn');
  if (!v.trim()) { msg.textContent = '✦ ช่องวางอัจฉริยะ'; return; }
  const r = parseKey(v);
  if (!r.n) { box.classList.add('warn'); msg.textContent = 'ไม่พบคำตอบ (ก ข ค ง / A–D / 1–4)'; return; }
  draftKey = r.keys; $('#fN').value = r.n; renderKey();
  if (r.miss.length) { box.classList.add('warn'); msg.textContent = `เรียงได้ ${r.found} ข้อ · ขาดข้อ ${r.miss.slice(0, 6).join(', ')}${r.miss.length > 6 ? '…' : ''}`; }
  else if (r.over) { box.classList.add('warn'); msg.textContent = 'เกิน 60 ข้อ — ใช้ 60 ข้อแรก'; }
  else { box.classList.add('done'); msg.textContent = `✓ เรียงเฉลยแล้ว ${r.n} ข้อ`; }
}
$('#fKeyText').oninput = applyPaste;
$('#pasteBtn').onclick = async () => {
  try { $('#fKeyText').value = await navigator.clipboard.readText(); applyPaste(); }
  catch { $('#fKeyText').focus(); toast('กดค้างในช่องแล้วเลือก "วาง"'); }
};
$('#editBack').onclick = () => show(cur ? 'results' : 'home');
$('#scanKey').onclick = () => startScan('key');
$('#saveExam').onclick = () => {
  const subject = $('#fSubject').value.trim(), n = nVal();
  if (!subject) { toast('ใส่ชื่อวิชา'); $('#fSubject').focus(); return; }
  const miss = draftKey.slice(0, n).findIndex(k => k < 0);
  if (miss >= 0) { toast(`ยังไม่ได้ใส่เฉลยข้อ ${miss + 1}`); return; }
  if (cur) {
    Object.assign(cur, { subject, n, key: draftKey.slice(0, n) });
    cur.records.forEach(r => regrade(r, cur));
    save(); show('results');
  } else {
    cur = { id: Date.now().toString(36), subject, n, key: draftKey.slice(0, n), created: Date.now(), records: [] };
    db.exams.push(cur); save(); startScan('grade');
  }
};

// ---------- results ----------
function regrade(r, e) { r.score = r.ans.slice(0, e.n).reduce((s, a, i) => s + (a === e.key[i] ? 1 : 0), 0); r.total = e.n; }
function renderResults() {
  if (!cur) return show('home');
  $('#resTitle').textContent = cur.subject;
  const rs = cur.records, avg = rs.length ? rs.reduce((s, r) => s + r.score, 0) / rs.length : 0;
  $('#stats').innerHTML = rs.length
    ? `<div><b>${rs.length}</b>แผ่น</div><div><b>${avg.toFixed(1)}</b>เฉลี่ย / ${cur.n}</div><div><b>${Math.max(...rs.map(r => r.score))}</b>สูงสุด</div>`
    : '';
  const ul = $('#resList');
  if (!rs.length) { ul.innerHTML = '<li class="empty" style="border:0;display:block">ยังไม่มีกระดาษที่ตรวจ</li>'; return; }
  ul.innerHTML = rs.map((r, i) => `<li data-i="${i}"><div class="main">
      <div class="t">${r.name ? esc(r.name) : (r.img ? `<img src="${r.img}" alt="">` : '<span class="s">ไม่มีชื่อ</span>')}</div>
      <div class="s">${esc(r.sid || 'ไม่พบรหัส')}${r.seat ? ' · ที่นั่ง ' + esc(r.seat) : ''}${r.amb ? ' · ⚠︎ ' + r.amb : ''}</div></div>
      <div class="n">${r.score}<small>/${r.total}</small></div></li>`).reverse().join('');
  ul.querySelectorAll('li[data-i]').forEach(li => li.onclick = () => openDetail(+li.dataset.i));
}
$('#scanMore').onclick = () => startScan('grade');
$('#editKey').onclick = () => openEdit(cur);

function openDetail(i) {
  const r = cur.records[i];
  $('#detailBody').innerHTML = `
    ${r.img ? `<img class="nameimg" src="${r.img}" alt="">` : ''}
    <label class="f"><span>ชื่อ-สกุล</span><input class="inp" id="dName" value="${esc(r.name)}"></label>
    <div class="row2"><label class="f"><span>รหัสนักศึกษา</span><input class="inp" id="dSid" inputmode="numeric" value="${esc(r.sid)}"></label>
      <label class="f" style="flex:0 0 96px"><span>คะแนน</span><div class="inp" style="display:flex;align-items:center;font-weight:700">${r.score} / ${r.total}</div></label></div>
    <div class="ans">${r.ans.slice(0, cur.n).map((a, q) => {
      const ok = a === cur.key[q];
      return `<div class="${ok ? 'ok' : 'no'}">${q + 1}. ${a >= 0 ? CH[a] : a === -2 ? '✱' : '–'}${ok ? '' : `<br><small>${CH[cur.key[q]]}</small>`}</div>`;
    }).join('')}</div>
    <div class="row2"><button class="btn danger" id="dDel">ลบ</button><button class="btn pri" id="dSave">บันทึก</button></div>`;
  $('#detail').classList.add('on');
  $('#dSave').onclick = () => { r.name = $('#dName').value.trim(); r.sid = $('#dSid').value.trim(); save(); closeDetail(); renderResults(); };
  $('#dDel').onclick = ev => { // กดสองครั้งเพื่อยืนยัน (confirm() ใช้ไม่ได้บนบางหน้าเว็บ)
    const b = ev.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'แตะอีกครั้งเพื่อลบ'; return; }
    cur.records.splice(i, 1); save(); closeDetail(); renderResults();
  };
}
function closeDetail() { $('#detail').classList.remove('on'); }
$('#detail').onclick = ev => { if (ev.target.id === 'detail') closeDetail(); };

// ---------- export ----------
function rows() {
  const head = ['ลำดับ', 'รหัสนักศึกษา', 'ชื่อ-สกุล', 'กลุ่มเรียน', 'เลขที่นั่งสอบ', 'คะแนน', 'เต็ม', 'ร้อยละ', 'เวลาตรวจ', ...Array.from({ length: cur.n }, (_, i) => 'ข้อ ' + (i + 1))];
  const body = cur.records.map((r, i) => [i + 1, r.sid, r.name, r.group, r.seat, r.score, r.total, +(r.score / r.total * 100).toFixed(1), fmtTime(r.at),
    ...r.ans.slice(0, cur.n).map(a => a >= 0 ? CH[a] : a === -2 ? '*' : '')]);
  const keyRow = ['', '', 'เฉลย', '', '', '', '', '', '', ...cur.key.map(k => CH[k])];
  return [head, ...body, [], keyRow];
}
async function download(blob, name) {
  const dl = inClaude() ? await claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); }
    catch (e) { if (e?.code !== 'declined') toast('บันทึกไฟล์ไม่สำเร็จ'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fname = ext => `${cur.subject.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
$('#expCsv').onclick = () => {
  if (!cur.records.length) return toast('ยังไม่มีข้อมูล');
  const csv = rows().map(r => r.map(v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? '')).join(',')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), fname('csv'));
};
$('#expXlsx').onclick = async () => {
  if (!cur.records.length) return toast('ยังไม่มีข้อมูล');
  if (!window.XLSX) {
    toast('กำลังเตรียมไฟล์…');
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); })
      .catch(() => toast('โหลดตัวสร้าง Excel ไม่ได้ — ใช้ CSV แทน'));
    if (!window.XLSX) return;
  }
  const ws = XLSX.utils.aoa_to_sheet(rows());
  ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 7 }, { wch: 6 }, { wch: 7 }, { wch: 16 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'คะแนน');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fname('xlsx'));
};

// ---------- settings ----------
function renderSettings() {
  const s = db.settings;
  $('#sRoster').value = s.roster || ''; $('#sKey').value = s.apiKey || ''; $('#sHook').value = s.hook || '';
  // บน claude.ai: อ่านชื่อด้วย Claude ในหน้าได้เลย และหน้าเว็บส่งข้อมูลออกไปเว็บอื่นไม่ได้
  $('#sKeyRow').hidden = $('#sHookRow').hidden = inClaude();
  $('#sNote').textContent = inClaude()
    ? 'ผลตรวจเก็บในบัญชี Claude ของคุณ เห็นเฉพาะคุณ · ชื่อที่ไม่มีในรายชื่อ Claude จะอ่านจากลายมือให้'
    : 'ข้อมูลทั้งหมดเก็บในเครื่องนี้ · API key ถูกส่งไปที่ api.anthropic.com เท่านั้น';
}
$('#saveSettings').onclick = () => {
  Object.assign(db.settings, { roster: $('#sRoster').value.trim(), apiKey: $('#sKey').value.trim(), hook: $('#sHook').value.trim() });
  save(); toast('บันทึกแล้ว'); show('home');
};
function rosterName(sid) {
  if (!sid || !db.settings.roster) return '';
  for (const line of db.settings.roster.split(/\r?\n/)) {
    const [id, ...rest] = line.split(/[,\t;]/);
    if (id && id.trim() === sid) return rest.join(' ').trim();
  }
  return '';
}

// ---------- name OCR (Claude) ----------
let sdk;
const NAME_PROMPT = 'ภาพนี้คือช่อง "ชื่อ-สกุล" บนกระดาษคำตอบ อ่านชื่อและนามสกุลที่เขียนด้วยลายมือ ตอบเฉพาะชื่อ-นามสกุลเป็นข้อความบรรทัดเดียว ถ้าว่างหรืออ่านไม่ออกให้ตอบว่า -';
const cleanName = t => { t = (t || '').trim().split('\n')[0].trim(); return t === '-' ? '' : t.replace(/^ชื่อ[-–\s]*สกุล[:\s]*/, ''); };
// บน claude.ai ใช้ Claude ผ่าน sample capability (ไม่ต้องมี API key)
let sampleNs;
async function canSampleImages() {
  if (!inClaude()) return false;
  if (sampleNs === undefined) sampleNs = await claude.use('sample');
  if (!sampleNs) return false;
  const lim = await sampleNs.limits().catch(() => null);
  return !!lim?.images;
}
function dataUrlBlob(u) {
  const [h, b] = u.split(','), bin = atob(b), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: h.slice(5).split(';')[0] });
}
async function readName(dataUrl) {
  const key = db.settings.apiKey;
  if (!key) {
    if (!(await canSampleImages())) return '';
    const res = await sampleNs(NAME_PROMPT, { images: [dataUrlBlob(dataUrl)], modelTier: 'quick' });
    return cleanName(res.text);
  }
  if (!sdk) sdk = (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm')).default;
  const client = new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
  const res = await client.beta.messages.create({
    model: NAME_MODEL, max_tokens: 1024,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } },
      { type: 'text', text: NAME_PROMPT },
    ] }],
  });
  if (res.stop_reason === 'refusal') return '';
  return cleanName(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
}

function pushHook(e, r) {
  const url = db.settings.hook; if (!url || inClaude()) return;
  fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ subject: e.subject, sid: r.sid, name: r.name, group: r.group, seat: r.seat, score: r.score, total: r.total, at: new Date(r.at).toISOString(),
      answers: r.ans.slice(0, e.n).map(a => a >= 0 ? CH[a] : '').join('') }) }).catch(() => {});
}

// ---------- OpenCV ----------
let cvReady = false;
(async function waitCv() {
  while (!window.cv) await new Promise(r => setTimeout(r, 200));
  if (cv instanceof Promise) window.cv = await cv;
  while (!cv.Mat) await new Promise(r => setTimeout(r, 200));
  cvReady = true;
  if (running || $('#scan').classList.contains('on')) status($('#scan').classList.contains('photo') ? $('#status').textContent : 'วางกระดาษคำตอบในกรอบ');
})();

// ---------- scanner ----------
const video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d');
const small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
const full = document.createElement('canvas'), fctx = full.getContext('2d', { willReadFrequently: true });
let stream = null, mode = 'grade', running = false, wake = null;
let stable = 0, prev = null, pending = null, lastSig = null, absent = 0, lastGrab = 0;

function status(m) { $('#status').textContent = m; }
function updateCount() { $('#scanCount').textContent = mode === 'key' ? 'เฉลย' : `${cur.records.length} แผ่น`; }

async function startScan(m) {
  mode = m;
  if (m === 'key') $('#scanTitle').textContent = 'สแกนกระดาษเฉลย';
  else $('#scanTitle').textContent = cur.subject;
  updateCount();
  $('#card').classList.remove('on');
  $('#scan').classList.remove('photo');
  show('scan');
  if (inClaude()) {
    // หน้าบน claude.ai เปิดกล้องสดไม่ได้: เปิดแอปกล้องทันทีจากการแตะครั้งนี้ (ต้องเรียกก่อน await ใดๆ)
    photoMode(); if (isPhone()) $('#shot').click(); return;
  }
  status('กำลังเปิดกล้อง…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (err) {
    photoMode(); return; // กล้องสดใช้ไม่ได้ (เช่นเปิดบน claude.ai) -> ถ่ายผ่านแอปกล้องแทน
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const adv = {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
  } catch {}
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  stable = 0; prev = null; pending = null; lastSig = null; absent = 0;
  running = true;
  status(cvReady ? 'วางกระดาษคำตอบในกรอบ' : 'กำลังโหลดตัวตรวจ…');
  loop();
}
function stopScan() {
  running = false;
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  try { wake?.release(); } catch {} wake = null;
}
$('#scanClose').onclick = () => { stopScan(); show(mode === 'key' ? 'edit' : 'results'); };

// ---------- โหมดถ่ายรูป (เมื่อเปิดกล้องสดไม่ได้) ----------
// คอมพิวเตอร์ (เมาส์) ไม่มีแอปกล้อง: ปุ่มจะเปิดหน้าเลือกไฟล์ จึงบอกตามจริง
const isPhone = () => matchMedia('(pointer: coarse)').matches;
function photoMode() {
  $('#scan').classList.add('photo');
  lastSig = null;
  const phone = isPhone();
  $('#shootBtn').textContent = phone ? 'ถ่ายภาพกระดาษ' : 'เลือกรูปกระดาษ';
  $('#pickBtn').hidden = !phone;
  $('#shot').multiple = !phone; // บนคอมเลือกได้หลายรูปในครั้งเดียว
  status(phone
    ? (mode === 'key' ? 'ถ่ายรูปกระดาษเฉลยให้เห็นสัญลักษณ์ครบ 4 มุม' : 'ถ่ายรูปกระดาษคำตอบให้เห็นสัญลักษณ์ครบ 4 มุม')
    : 'เปิดบนคอมพิวเตอร์: เลือกรูปกระดาษได้ทีละหลายรูป · เปิดลิงก์นี้บนมือถือเพื่อถ่ายด้วยกล้อง');
}
async function gradeFiles(files) {
  files = [...files]; if (!files.length) return;
  if (!cvReady) { status('กำลังโหลดตัวตรวจ…'); while (!cvReady) await new Promise(r => setTimeout(r, 200)); }
  let ok = 0, blank = 0;
  for (const [i, f] of files.entries()) {
    status(files.length > 1 ? `กำลังตรวจ ${i + 1}/${files.length}…` : 'กำลังตรวจ…');
    await new Promise(r => setTimeout(r, 30)); // ให้ข้อความขึ้นก่อนเริ่มคำนวณ
    let r = null;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
      full.width = Math.round(bmp.width * k); full.height = Math.round(bmp.height * k);
      fctx.drawImage(bmp, 0, 0, full.width, full.height); bmp.close?.();
      const m = cv.imread(full);
      r = OMR.analyze(m, { questions: mode === 'key' ? 60 : cur.n, keepColor: true });
      m.delete();
    } catch (e) { console.error(e); }
    if (!r?.ok) { r?.colorWarp?.delete(); continue; }
    if (mode !== 'key' && isBlank(r)) { r.colorWarp.delete(); blank++; continue; }
    ok++;
    accept(r, sig(r));
    if (mode === 'key') return;
  }
  const fail = files.length - ok - blank;
  const parts = [];
  if (fail) parts.push(`${fail} รูปไม่เห็นสัญลักษณ์ครบ 4 มุม`);
  if (blank) parts.push(`${blank} แผ่นยังไม่ได้ฝน`);
  status(parts.length ? `ตรวจได้ ${ok}/${files.length} รูป · ${parts.join(' · ')}` : 'ถ่ายแผ่นต่อไป');
}
$('#shot').onchange = ev => { gradeFiles(ev.target.files); ev.target.value = ''; };
$('#pick').onchange = ev => { gradeFiles(ev.target.files); ev.target.value = ''; };
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { stopScan(); show(mode === 'key' ? 'edit' : 'results'); } });

function loop() {
  if (!running) return;
  const t0 = performance.now();
  try { tick(); } catch (e) { console.error(e); }
  setTimeout(loop, Math.max(30, 120 - (performance.now() - t0)));
}

const sig = r => r.studentId + '|' + r.answers.join(',');
const isBlank = r => !r.studentId && r.answers.filter(a => a >= 0).length < Math.max(1, r.answers.length * 0.2);

function tick() {
  if (!cvReady || !video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight, f = Math.min(1, 720 / Math.max(vw, vh));
  small.width = Math.round(vw * f); small.height = Math.round(vh * f);
  sctx.drawImage(video, 0, 0, small.width, small.height);
  const m = cv.imread(small), g = new cv.Mat();
  cv.cvtColor(m, g, cv.COLOR_RGBA2GRAY); m.delete();
  const det = OMR.detectScaled(g, 720); g.delete();
  drawOverlay(det, f);
  const ok = det.count === 4;
  $('#guide').classList.toggle('lock', ok);

  if (!ok) {
    stable = 0; prev = null;
    if (++absent >= 4) {
      if (lastSig) { lastSig = null; $('#card').classList.remove('on'); }
      pending = null;
      status(det.count ? 'ให้เห็นสัญลักษณ์ครบทั้ง 4 มุม' : (mode === 'key' ? 'วางกระดาษเฉลยในกรอบ' : (cur.records.length ? 'วางแผ่นต่อไป' : 'วางกระดาษคำตอบในกรอบ')));
    }
    return;
  }
  absent = 0;
  const pts = det.markers.map(mk => [mk.cx / f, mk.cy / f]);
  const diag = Math.hypot(vw, vh);
  const moved = prev ? Math.max(...pts.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]))) / diag : 1;
  prev = pts;
  stable = moved < 0.006 ? stable + 1 : 0;
  if (stable < STABLE_TICKS) { if (!lastSig) status('ถือนิ่งๆ…'); return; }
  if (lastSig && performance.now() - lastGrab < 900) return; // แผ่นเดิมยังวางอยู่ ไม่ต้องถ่ายถี่

  // ถ่ายภาพเต็มความละเอียดแล้วตรวจ
  lastGrab = performance.now();
  full.width = vw; full.height = vh;
  fctx.drawImage(video, 0, 0);
  const fm = cv.imread(full);
  const r = OMR.analyze(fm, { questions: mode === 'key' ? 60 : cur.n, keepColor: true });
  fm.delete();
  if (!r.ok) { r.colorWarp?.delete(); return; }
  if (r.sharp < SHARP_MIN) { r.colorWarp.delete(); if (!lastSig) status('กำลังโฟกัส…'); return; }
  const s = sig(r);
  if (s === lastSig) { r.colorWarp.delete(); return; }
  if (isBlank(r)) {
    r.colorWarp.delete(); status('กระดาษยังไม่ได้ฝน'); return;
  }
  if (!pending || pending.s !== s) { // ต้องอ่านได้ตรงกัน 2 ภาพติดกัน
    pending && pending.r.colorWarp.delete();
    pending = { s, r }; status('กำลังตรวจ…'); return;
  }
  pending.r.colorWarp.delete(); pending = null;
  accept(r, s);
}

function drawOverlay(det, f) {
  const cw = overlay.clientWidth, ch = overlay.clientHeight;
  if (overlay.width !== cw) overlay.width = cw;
  if (overlay.height !== ch) overlay.height = ch;
  octx.clearRect(0, 0, cw, ch);
  const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * k) / 2, oy = (ch - vh * k) / 2;
  octx.fillStyle = '#ffc72c';
  det.markers.forEach(mk => { if (!mk) return; octx.beginPath(); octx.arc(ox + mk.cx / f * k, oy + mk.cy / f * k, 9, 0, 7); octx.fill(); });
}

function beep() {
  try {
    const a = beep.ctx || (beep.ctx = new AudioContext()), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.18);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.2);
  } catch {}
  navigator.vibrate?.(60);
}

function accept(r, s) {
  lastSig = s;
  beep();
  if (mode === 'key') {
    r.colorWarp.delete();
    const n = r.answers.reduce((last, a, i) => a >= 0 ? i + 1 : last, 0);
    draftKey = r.answers.map(a => a >= 0 ? a : -1); while (draftKey.length < 60) draftKey.push(-1);
    if (n) $('#fN').value = n;
    stopScan(); show('edit'); renderKey();
    toast(`อ่านเฉลยได้ ${draftKey.filter(k => k >= 0).length} ข้อ — ตรวจทานแล้วกดบันทึก`);
    return;
  }
  const img = OMR.nameCrop(r.colorWarp, 480);
  r.colorWarp.delete();
  const e = cur;
  const rec = { id: rid(), sid: r.studentId, group: r.group, seat: r.seat, name: rosterName(r.studentId), img, ans: r.answers,
    amb: r.flags.filter(Boolean).length, at: Date.now() };
  regrade(rec, e);
  let updated = false;
  const dup = rec.sid ? e.records.findIndex(x => x.sid === rec.sid) : -1;
  if (dup >= 0) { if (!rec.name) rec.name = e.records[dup].name; e.records[dup] = rec; updated = true; } else e.records.push(rec);
  save(); updateCount();
  showCard(rec, updated);
  status('วางแผ่นต่อไป');
  if (!rec.name && (db.settings.apiKey || inClaude())) {
    readName(img).then(name => {
      if (!name) return;
      rec.name = name; save();
      if ($('#card').dataset.at == rec.at) showCard(rec, updated);
      if ($('#results').classList.contains('on')) renderResults();
    }).catch(err => console.warn('name OCR', err)).finally(() => pushHook(e, rec));
  } else pushHook(e, rec);
}

function showCard(r, updated) {
  const c = $('#card');
  c.dataset.at = r.at;
  c.innerHTML = `<div class="sc">${r.score}<small> / ${r.total}</small></div>
    <div class="who">${r.name ? esc(r.name) : ''}${r.sid ? ` <span style="color:var(--mute)">${esc(r.sid)}</span>` : ' <span class="danger">ไม่พบรหัสนักศึกษา</span>'}
    ${!r.name && r.img ? `<img src="${r.img}" alt="">` : ''}</div>
    ${updated ? '<div class="warn">รหัสนี้เคยตรวจแล้ว — อัปเดตคะแนนใหม่</div>' : ''}
    ${r.amb ? `<div class="warn">⚠︎ มี ${r.amb} ข้อที่ฝนไม่ชัด/ลบไม่สะอาด — ตรวจทานในรายการ</div>` : ''}
    ${$('#scan').classList.contains('photo') ? '<label class="cta next" for="shot">ถ่ายแผ่นต่อไป</label>' : ''}`;
  c.classList.add('on');
}

// ---------- init ----------
renderHome();
initCloud().catch(e => console.warn('cloud', e));
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
