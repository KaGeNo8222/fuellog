// UI layer: storage, routing, dashboard, entry form, history, statistics charts and settings.
(() => {
  'use strict';

  const L = FuelLogic;
  const APP_VERSION = '1.2.0';
  const STORE_KEY = 'fuellog.entries.v1';
  const META_KEY = 'fuellog.meta.v1';
  const FUELS = ['E20', 'แก๊สโซฮอล์ 95', 'แก๊สโซฮอล์ 91', 'E85', 'เบนซิน 95', 'ดีเซล B7', 'ดีเซล B20', 'ดีเซลพรีเมียม'];
  const VIEWS = ['home', 'add', 'history', 'stats', 'settings'];
  const TITLES = { add: 'บันทึกการเติมน้ำมัน', history: 'ประวัติการเติมน้ำมัน', stats: 'สถิติการใช้งาน', settings: 'ตั้งค่า' };
  const RANGE_MONTHS = { '6m': 6, '12m': 12, all: 0 };
  const RECENT_COUNT = 3;
  const BACKUP_REMINDER_DAYS = 30;
  const DAY_MS = 86400000;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // ---------- storage ----------

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      alert(`บันทึกข้อมูลลงเครื่องไม่สำเร็จ\n${err.message}`);
      return false;
    }
  }

  const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);

  let entries = readJSON(STORE_KEY, []).sort(byNewest);
  const meta = readJSON(META_KEY, {});

  function saveEntries() {
    entries.sort(byNewest);
    const ok = writeJSON(STORE_KEY, entries);
    // Ask iOS not to evict our storage under pressure.
    if (ok && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return ok;
  }

  const saveMeta = () => writeJSON(META_KEY, meta);

  const newId = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // ---------- small UI helpers ----------

  let toastTimer;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  const dayToISO = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

  function groupByMonth(list) {
    const months = new Map();
    for (const e of list) {
      const key = e.date.slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(e);
    }
    return months;
  }

  function tile(label, value, unit, note, accent) {
    const node = el('div', 'tile');
    const valueNode = el('div', accent ? 'tile-value accent' : 'tile-value', value);
    valueNode.append(' ', el('small', null, unit));
    node.append(el('div', 'tile-label', label), valueNode);
    if (note) node.append(el('div', 'tile-note', note));
    return node;
  }

  // One fill-up as a tappable row; `detailed` adds price per liter and the note.
  function entryRow(e, detailed) {
    const li = el('li');
    const btn = el('button', 'row-entry');
    btn.type = 'button';
    btn.dataset.id = e.id;
    const main = el('div', 'row-main');
    main.append(
      el('div', 'row-date', L.formatDate(e.date)),
      el('div', 'row-detail', `${L.fmt(e.km, 1)} กม. • ${L.fmt(e.liters, 2)} ลิตร • ${e.fuel}`),
    );
    if (detailed) main.append(el('div', 'row-detail', [`${L.fmt(e.price, 2)} บ./ลิตร`, e.note].filter(Boolean).join(' • ')));
    const side = el('div', 'row-side');
    side.append(
      el('div', 'row-amount', `฿${L.formatBaht(e.amount)}`),
      el('div', 'row-kpl', `${L.fmt(L.kmPerLiter(e), 2)} กม./ลิตร`),
    );
    btn.append(main, side);
    li.append(btn);
    return li;
  }

  document.addEventListener('click', (ev) => {
    const row = ev.target.closest('.row-entry');
    if (row) location.hash = `#edit/${encodeURIComponent(row.dataset.id)}`;
  });

  // ---------- routing ----------

  let currentView = 'home';
  let returnHash = '#home';

  function route() {
    const [name, arg] = location.hash.slice(1).split('/');
    let view = VIEWS.includes(name) ? name : 'home';
    let tab = view;
    if (name === 'edit') {
      const entry = entries.find((e) => e.id === decodeURIComponent(arg || ''));
      if (!entry) {
        location.replace('#history');
        return;
      }
      loadForm(entry);
      view = 'add';
      tab = 'history';
    } else if (view === 'add' && editingId) {
      loadForm(null);
    }

    currentView = view;
    if (view !== 'settings') returnHash = location.hash || '#home';
    for (const key of VIEWS) $(`#view-${key}`).hidden = key !== view;
    document.querySelectorAll('.tabbar a').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#brand').hidden = view !== 'home';
    $('#title').hidden = view === 'home';
    $('#title').textContent = view === 'add' && editingId ? 'แก้ไขรายการ' : TITLES[view] || '';
    // On the form the header holds Save, which stays reachable while the keyboard covers the bottom.
    $('#gear').hidden = view === 'settings' || view === 'add';
    $('#head-save').hidden = view !== 'add';
    $('#back').hidden = view !== 'settings';
    $('#back').setAttribute('href', returnHash);
    if (view === 'stats') renderSummary();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderHome();
    renderHistory();
    renderSettings();
    if (currentView === 'stats') renderSummary();
  }

  // ---------- dashboard ----------

  function periodLabel(list) {
    const first = L.formatMonth(list[list.length - 1].date.slice(0, 7), true);
    const last = L.formatMonth(list[0].date.slice(0, 7), true);
    if (first === last) return last;
    const [firstMonth, firstYear] = first.split(' ');
    return firstYear === last.split(' ')[1] ? `${firstMonth}–${last}` : `${first}–${last}`;
  }

  function renderHome() {
    const has = entries.length > 0;
    $('#home-body').hidden = !has;
    $('#home-period').hidden = !has;
    $('#home-empty').hidden = has;
    renderBackupBanner();
    if (!has) return;

    const t = L.totals(entries);
    $('#home-period').textContent = `ภาพรวมการใช้รถ • ${periodLabel(entries)}`;
    $('#home-tiles').replaceChildren(
      tile('อัตราสิ้นเปลืองเฉลี่ย', L.fmt(t.kmPerLiter, 2), 'กม./ลิตร', null, true),
      tile('ค่าใช้จ่ายทั้งหมด', L.formatBaht(t.amount), 'บาท'),
      tile('ค่าเชื้อเพลิงเฉลี่ย', L.fmt(t.bahtPerKm, 2), 'บาท/กม.'),
      tile('ระยะทางรวม', L.fmt(t.km, 1), 'กม.'),
    );
    $('#home-recent').replaceChildren(...entries.slice(0, RECENT_COUNT).map((e) => entryRow(e, false)));
  }

  function renderBackupBanner() {
    let days = 0;
    if (entries.length) {
      const since = meta.lastBackup || Math.min(...entries.map((e) => e.createdAt || Date.now()));
      days = Math.floor((Date.now() - since) / DAY_MS);
    }
    $('#backup-banner').hidden = days < BACKUP_REMINDER_DAYS;
    $('#backup-banner-text').textContent = meta.lastBackup
      ? `ไม่ได้สำรองข้อมูลมา ${days} วัน`
      : 'ยังไม่เคยสำรองข้อมูล';
  }

  // ---------- history ----------

  function renderHistory() {
    const box = $('#history-list');
    box.replaceChildren();
    $('#history-empty').hidden = entries.length > 0;
    for (const [key, items] of groupByMonth(entries)) {
      const head = el('h2', 'month-head');
      head.append(
        el('span', null, L.formatMonth(key, true)),
        el('span', null, `${items.length} ครั้ง • ${L.formatBaht(L.totals(items).amount)} บาท`),
      );
      const list = el('ul', 'rows');
      list.append(...items.map((e) => entryRow(e, true)));
      const card = el('div', 'card list-card');
      card.append(list);
      box.append(head, card);
    }
  }

  // ---------- entry form (add & edit) ----------

  const form = $('#entry-form');
  const f = form.elements;
  let editingId = null;
  let litersManual = false;

  function lastPriceFor(fuel) {
    const e = entries.find((x) => x.fuel === fuel);
    return e ? e.price : null;
  }

  function fillFuelOptions(selected) {
    const names = [...new Set([...FUELS, ...entries.map((e) => e.fuel), selected])];
    f.fuel.replaceChildren(...names.map((name) => {
      const option = el('option', null, name);
      option.value = name;
      return option;
    }));
    f.fuel.value = selected;
  }

  function setError(field, message) {
    form.querySelectorAll('.invalid').forEach((n) => n.classList.remove('invalid'));
    const box = $('#form-error');
    box.hidden = !message;
    box.textContent = message || '';
    if (field && f[field]) {
      f[field].closest('.field').classList.add('invalid');
      f[field].focus();
    }
  }

  function recalc() {
    const amount = L.toNumber(f.amount.value);
    const price = L.toNumber(f.price.value);
    if (!litersManual) f.liters.value = amount > 0 && price > 0 ? (amount / price).toFixed(2) : '';
    f.liters.classList.toggle('auto', !litersManual);

    const km = L.toNumber(f.km.value);
    const liters = L.toNumber(f.liters.value);
    $('#pv-kpl').textContent = km > 0 && liters > 0 ? L.fmt(km / liters, 2) : '–';
    $('#pv-bpk').textContent = km > 0 && amount > 0 ? L.fmt(amount / km, 2) : '–';
    renderCheck(km, liters, price > 0 ? price : amount / liters);
  }

  // Flags likely typos (e.g. 7529 for 752.9) against the owner's own history; never blocks saving.
  function renderCheck(km, liters, price) {
    const box = $('#pv-check');
    const others = entries.filter((e) => e.id !== editingId);
    const avg = others.length ? L.totals(others).kmPerLiter : NaN;
    const prev = others.find((e) => e.fuel === f.fuel.value);
    let warning = null;
    if (km > 0 && liters > 0 && avg > 0 && Math.abs(km / liters - avg) / avg > 0.3) {
      warning = `กม./ลิตรต่างจากค่าเฉลี่ย ${L.fmt(avg, 2)} มาก ลองตรวจระยะทางกับลิตรอีกครั้ง`;
    } else if (price > 0 && prev && Math.abs(price - prev.price) / prev.price > 0.15) {
      warning = `ราคาต่างจากครั้งก่อน (${L.fmt(prev.price, 2)}) มาก ลองตรวจราคาอีกครั้ง`;
    }
    box.classList.toggle('warn', Boolean(warning));
    box.textContent = warning ? `⚠ ${warning}` : avg > 0 ? `ค่าเฉลี่ยของคุณ ${L.fmt(avg, 2)} กม./ลิตร` : '';
    box.hidden = !box.textContent;
  }

  // Loads an entry for editing, or resets to a blank new entry when `entry` is null.
  // A half-typed new entry survives tab switches; it is only reset after save or after editing.
  function loadForm(entry) {
    editingId = entry ? entry.id : null;
    const fuel = entry ? entry.fuel : (entries[0] ? entries[0].fuel : FUELS[0]);
    const lastPrice = lastPriceFor(fuel);
    fillFuelOptions(fuel);
    f.date.value = entry ? entry.date : L.todayISO();
    f.km.value = entry ? entry.km : '';
    f.amount.value = entry ? entry.amount : '';
    f.price.value = entry ? entry.price : (lastPrice == null ? '' : lastPrice);
    f.liters.value = entry ? entry.liters : '';
    f.note.value = entry ? entry.note || '' : '';
    litersManual = Boolean(entry);
    $('#save-entry').textContent = entry ? 'บันทึกการแก้ไข' : 'บันทึก';
    $('#cancel-edit').hidden = !entry;
    $('#delete-entry').hidden = !entry;
    setError(null, '');
    recalc();
  }

  f.km.addEventListener('input', recalc);
  f.amount.addEventListener('input', recalc);
  f.price.addEventListener('input', recalc);
  f.liters.addEventListener('input', () => {
    litersManual = f.liters.value.trim() !== '';
    recalc();
  });
  f.fuel.addEventListener('change', () => {
    const price = lastPriceFor(f.fuel.value);
    if (!editingId && price != null) f.price.value = price;
    recalc();
  });

  // Links to the form open it inside the tap itself, so iOS raises the keyboard on the first empty field.
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href="#add"]');
    if (!link) return;
    ev.preventDefault();
    if (location.hash !== '#add') history.pushState(null, '', '#add');
    route();
    const firstEmpty = [f.km, f.amount, f.price].find((input) => !input.value);
    if (firstEmpty) firstEmpty.focus();
  });

  // Select the whole value on focus so typing replaces the prefilled price.
  form.querySelectorAll('input[inputmode="decimal"]').forEach((input) => {
    input.addEventListener('focus', () => setTimeout(() => input.setSelectionRange(0, input.value.length), 0));
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    let entry;
    try {
      entry = L.normalizeEntry({
        date: f.date.value,
        km: f.km.value,
        fuel: f.fuel.value,
        amount: f.amount.value,
        price: f.price.value,
        liters: f.liters.value,
        note: f.note.value,
      });
    } catch (err) {
      setError(err.field, err.message);
      return;
    }
    const wasEditing = Boolean(editingId);
    if (wasEditing) {
      const i = entries.findIndex((e) => e.id === editingId);
      entries[i] = { ...entries[i], ...entry, updatedAt: Date.now() };
    } else {
      entries.push({ id: newId(), createdAt: Date.now(), ...entry });
    }
    saveEntries();
    loadForm(null);
    renderAll();
    location.hash = wasEditing ? '#history' : '#home';
    toast(wasEditing ? 'บันทึกการแก้ไขแล้ว' : `บันทึกแล้ว • ${L.fmt(L.kmPerLiter(entry), 2)} กม./ลิตร`);
  });

  $('#delete-entry').addEventListener('click', () => {
    const entry = entries.find((e) => e.id === editingId);
    if (!entry || !confirm(`ลบรายการวันที่ ${L.formatDate(entry.date)}?`)) return;
    entries = entries.filter((e) => e.id !== editingId);
    saveEntries();
    loadForm(null);
    renderAll();
    location.hash = '#history';
    toast('ลบแล้ว');
  });

  // ---------- statistics ----------

  function rangeEntries() {
    const months = RANGE_MONTHS[meta.range] || 0;
    if (!months) return entries;
    const cutoff = L.addMonthsISO(L.todayISO(), -months);
    return entries.filter((e) => e.date > cutoff);
  }

  function priceTile(list) {
    const latest = list[0];
    const prev = entries.slice(entries.indexOf(latest) + 1).find((e) => e.fuel === latest.fuel);
    let note = latest.fuel;
    if (prev) {
      const diff = L.round2(latest.price - prev.price);
      note += diff === 0 ? ' • เท่าครั้งก่อน' : ` • ${diff > 0 ? '▲' : '▼'} ${L.fmt(Math.abs(diff), 2)} จากครั้งก่อน`;
    }
    return tile('ราคาล่าสุด', L.fmt(latest.price, 2), 'บ./ลิตร', note);
  }

  const chartHiders = new Set();

  function renderSummary() {
    const range = meta.range || 'all';
    document.querySelectorAll('#range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    const list = rangeEntries();
    $('#summary-empty').hidden = list.length > 0;
    $('#summary-body').hidden = list.length === 0;
    chartHiders.clear();
    if (!list.length) return;

    const t = L.totals(list);
    $('#hero-value').textContent = L.fmt(t.kmPerLiter, 2);
    $('#hero-sub').textContent = `จาก ${t.count} ครั้ง • ${L.fmt(t.km, 1)} กม. • ${L.fmt(t.liters, 2)} ลิตร`;
    $('#tiles').replaceChildren(
      tile('ค่าน้ำมันรวม', L.formatBaht(t.amount), 'บาท', `เฉลี่ย ${L.formatBaht(L.round2(t.amount / t.count))} บาท/ครั้ง`),
      tile('ค่าน้ำมันต่อระยะทาง', L.fmt(t.bahtPerKm, 2), 'บาท/กม.'),
      tile('ระยะทางรวม', L.fmt(t.km, 1), 'กม.', `เฉลี่ย ${L.fmt(t.km / t.count, 1)} กม./ครั้ง`),
      priceTile(list),
    );

    const points = list.slice().reverse().map((e) => ({ x: L.dayNumber(e.date), y: L.kmPerLiter(e), entry: e }));
    lineChart($('#chart-kpl'), points, t.kmPerLiter);
    const months = L.monthlySeries(list);
    columnChart($('#chart-monthly'), months);
    renderMonthTable(months.filter((m) => m.count).reverse(), t);
  }

  $('#range').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-range]');
    if (!btn) return;
    meta.range = btn.dataset.range;
    saveMeta();
    renderSummary();
  });

  function renderMonthTable(months, t) {
    const td = (text) => el('td', null, text);
    const row = (label, m) => {
      const tr = el('tr');
      const th = el('th', null, label);
      th.scope = 'row';
      tr.append(th, td(L.fmt(m.km, 1)), td(L.fmt(m.liters, 2)), td(L.formatBaht(m.amount)), td(L.fmt(m.kmPerLiter, 2)));
      return tr;
    };
    $('#month-table tbody').replaceChildren(...months.map((m) => row(L.formatMonth(m.key), m)));
    $('#month-table tfoot').replaceChildren(row('รวม', t));
  }

  // ---------- charts (inline SVG, single series) ----------

  function chartFrame(container, height, label) {
    container.replaceChildren();
    const width = Math.max(container.clientWidth, 240);
    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label }, container);
    const tip = el('div', 'tip');
    tip.hidden = true;
    container.append(tip);
    return { root, width, tip };
  }

  function showTip(container, tip, x, value, detail) {
    tip.replaceChildren(el('strong', null, value), el('span', null, detail));
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(x - w / 2, 0), container.clientWidth - w)}px`;
    tip.style.transform = 'translateY(-100%)';
  }

  // Pointer/touch scrubbing snaps to the nearest x; arrow keys step when the chart has focus.
  function attachScrubber(root, xs, onShow, onHide) {
    let active = -1;
    const nearest = (px) => xs.reduce((best, x, i) => (Math.abs(x - px) < Math.abs(xs[best] - px) ? i : best), 0);
    const show = (i) => { active = i; onShow(i); };
    const hide = () => { active = -1; onHide(); };
    const fromPointer = (ev) => show(nearest(ev.clientX - root.getBoundingClientRect().left));
    root.addEventListener('pointerdown', fromPointer);
    root.addEventListener('pointermove', fromPointer);
    root.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hide(); });
    root.setAttribute('tabindex', '0');
    root.addEventListener('focus', () => show(active < 0 ? xs.length - 1 : active));
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', (ev) => {
      const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      show(Math.min(Math.max(active + step, 0), xs.length - 1));
    });
    chartHiders.add(hide);
  }

  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.chart')) chartHiders.forEach((hide) => hide());
  });

  const tickDigits = (ticks) => (ticks.every(Number.isInteger) ? 0 : ticks.every((t) => Number.isInteger(L.round2(t * 10))) ? 1 : 2);

  function timeTicks(x0, x1, firstX, lastX) {
    const ticks = [];
    const start = dayToISO(x0);
    let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
    for (;;) {
      if (++m > 12) { m = 1; y++; }
      const day = Date.UTC(y, m - 1, 1) / DAY_MS;
      if (day > x1) break;
      ticks.push({ x: day, label: m === 1 ? `${L.monthAbbr(m)} ${String((y + 543) % 100).padStart(2, '0')}` : L.monthAbbr(m) });
    }
    if (ticks.length >= 2) {
      const step = Math.ceil(ticks.length / 6);
      return ticks.filter((_, i) => i % step === 0);
    }
    // Under two month boundaries: label the first and last fill-up dates instead.
    const first = { x: firstX, label: L.formatDateShort(dayToISO(firstX)), anchor: 'middle' };
    if (lastX === firstX) return [first];
    return [{ ...first, anchor: 'start' }, { x: lastX, label: L.formatDateShort(dayToISO(lastX)), anchor: 'end' }];
  }

  function lineChart(container, points, avg) {
    const H = 200;
    const last = points[points.length - 1];
    const { root, width, tip } = chartFrame(container, H,
      `กม./ลิตร ${points.length} ครั้ง ล่าสุด ${L.fmt(last.y, 2)} เฉลี่ย ${L.fmt(avg, 2)}`);
    const m = { top: 16, right: 46, bottom: 26, left: 34 };
    const pw = width - m.left - m.right;
    const ph = H - m.top - m.bottom;

    const values = points.map((p) => p.y).concat(avg);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    const ticks = L.niceTicks(lo - pad, hi + pad, 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    let x0 = points[0].x;
    let x1 = last.x;
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    const sx = (x) => m.left + ((x - x0) / (x1 - x0)) * pw;
    const sy = (y) => m.top + (1 - (y - y0) / (y1 - y0)) * ph;

    const grid = svg('g', { class: 'grid' }, root);
    const digits = tickDigits(ticks);
    ticks.forEach((t, i) => {
      if (i > 0) svg('line', { x1: m.left, x2: m.left + pw, y1: sy(t), y2: sy(t) }, grid);
      svg('text', { x: m.left - 6, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = L.fmt(t, digits);
    });
    svg('line', { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph, class: 'axis' }, root);
    for (const t of timeTicks(x0, x1, points[0].x, last.x)) {
      svg('text', { x: sx(t.x), y: H - 6, 'text-anchor': t.anchor || 'middle' }, root).textContent = t.label;
    }

    // The average line is keyed in the card header; a label on the plot would collide with the series.
    svg('line', { x1: m.left, x2: m.left + pw, y1: sy(avg), y2: sy(avg), class: 'ref' }, root);
    $('#kpl-avg-key').replaceChildren(el('i'), `เฉลี่ย ${L.fmt(avg, 2)}`);

    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    svg('path', { d, class: 'series-line' }, root);
    const showDots = points.length <= 24;
    points.forEach((p) => {
      if (showDots || p === last) svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, class: 'dot' }, root);
    });
    svg('text', { x: sx(last.x) + 9, y: sy(last.y) + 4, class: 'end-label' }, root).textContent = L.fmt(last.y, 2);

    const cross = svg('line', { y1: m.top, y2: m.top + ph, class: 'crosshair', visibility: 'hidden' }, root);
    const focusDot = svg('circle', { r: 5, class: 'dot', visibility: 'hidden' }, root);
    svg('rect', { x: 0, y: 0, width, height: H, class: 'hit' }, root);

    const xs = points.map((p) => sx(p.x));
    attachScrubber(root, xs, (i) => {
      const p = points[i];
      for (const [k, v] of [['x1', xs[i]], ['x2', xs[i]], ['visibility', 'visible']]) cross.setAttribute(k, v);
      for (const [k, v] of [['cx', xs[i]], ['cy', sy(p.y)], ['visibility', 'visible']]) focusDot.setAttribute(k, v);
      showTip(container, tip, xs[i], `${L.fmt(p.y, 2)} กม./ลิตร`,
        `${L.formatDate(p.entry.date)} • ${L.fmt(p.entry.km, 1)} กม. • ${L.fmt(p.entry.liters, 2)} ลิตร`);
    }, () => {
      cross.setAttribute('visibility', 'hidden');
      focusDot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    });
  }

  function columnChart(container, months) {
    const H = 190;
    const latest = months[months.length - 1];
    const { root, width, tip } = chartFrame(container, H,
      `ค่าน้ำมันรายเดือน ${months.length} เดือน ล่าสุด ${L.formatBaht(latest.amount)} บาท`);
    const m = { top: 20, right: 4, bottom: 26, left: 38 };
    const pw = width - m.left - m.right;
    const ph = H - m.top - m.bottom;

    const ticks = L.niceTicks(0, Math.max(...months.map((x) => x.amount)), 4);
    const top = ticks[ticks.length - 1];
    const sy = (v) => m.top + (1 - v / top) * ph;
    const base = sy(0);

    const grid = svg('g', { class: 'grid' }, root);
    ticks.forEach((t, i) => {
      if (i > 0) svg('line', { x1: m.left, x2: m.left + pw, y1: sy(t), y2: sy(t) }, grid);
      svg('text', { x: m.left - 6, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, root).textContent = L.compact(t);
    });
    svg('line', { x1: m.left, x2: m.left + pw, y1: base, y2: base, class: 'axis' }, root);

    const band = pw / months.length;
    const bw = Math.min(24, band * 0.6);
    const labelStep = Math.ceil(36 / band);
    const xs = months.map((_, i) => m.left + band * (i + 0.5));
    const bars = months.map((mo, i) => {
      const cx = xs[i];
      if ((months.length - 1 - i) % labelStep === 0) {
        svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, root).textContent = L.monthAbbr(Number(mo.key.slice(5)));
      }
      if (!mo.amount) return null;
      const yTop = sy(mo.amount);
      const r = Math.min(4, base - yTop, bw / 2);
      const x = cx - bw / 2;
      return svg('path', {
        class: 'bar',
        d: `M${x},${base}V${yTop + r}A${r},${r} 0 0 1 ${x + r},${yTop}H${x + bw - r}A${r},${r} 0 0 1 ${x + bw},${yTop + r}V${base}Z`,
      }, root);
    });
    svg('text', { x: xs[xs.length - 1], y: sy(latest.amount) - 6, class: 'cap-label' }, root).textContent = L.formatBaht(latest.amount);
    svg('rect', { x: 0, y: 0, width, height: H, class: 'hit' }, root);

    attachScrubber(root, xs, (i) => {
      const mo = months[i];
      bars.forEach((b, j) => b && b.classList.toggle('active', j === i));
      showTip(container, tip, xs[i], `${L.formatBaht(mo.amount)} บาท`,
        `${L.formatMonth(mo.key, true)} • ${mo.count} ครั้ง • ${L.fmt(mo.liters, 2)} ลิตร`);
    }, () => {
      bars.forEach((b) => b && b.classList.remove('active'));
      tip.hidden = true;
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (currentView === 'stats') renderSummary(); }, 150);
  });

  // ---------- settings: backup & import ----------

  function renderSettings() {
    $('#stat-count').textContent = `${entries.length} รายการ`;
    $('#stat-backup').textContent = meta.lastBackup ? L.formatDate(L.todayISO(new Date(meta.lastBackup))) : 'ยังไม่เคย';
    $('#app-version').textContent = APP_VERSION;
    const start = meta.startView || 'add';
    document.querySelectorAll('#start-view button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.start === start)));
  }

  $('#start-view').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-start]');
    if (!btn) return;
    meta.startView = btn.dataset.start;
    saveMeta();
    renderSettings();
  });

  function importEntries(found, errors) {
    if (!found.length) {
      alert(['ไม่พบรายการที่นำเข้าได้', ...errors.slice(0, 5)].join('\n'));
      return false;
    }
    const seen = new Set(entries.map(L.dedupeKey));
    const fresh = found.filter((e) => {
      const key = L.dedupeKey(e);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const lines = [`พบ ${found.length} รายการ`];
    if (found.length > fresh.length) lines.push(`ซ้ำกับที่มีอยู่ ${found.length - fresh.length} รายการ (จะข้าม)`);
    if (errors.length) lines.push(`อ่านไม่ได้ ${errors.length} รายการ:`, ...errors.slice(0, 5));
    if (!fresh.length) {
      alert(lines.concat('', 'ไม่มีรายการใหม่ให้นำเข้า').join('\n'));
      return false;
    }
    lines.push('', `นำเข้า ${fresh.length} รายการใหม่?`);
    if (!confirm(lines.join('\n'))) return false;
    const now = Date.now();
    fresh.forEach((e, i) => entries.push({ id: newId(), createdAt: now + i, ...e }));
    saveEntries();
    renderAll();
    toast(`นำเข้า ${fresh.length} รายการแล้ว`);
    return true;
  }

  $('#export-csv').addEventListener('click', async () => {
    if (!entries.length) {
      alert('ยังไม่มีข้อมูลให้ส่งออก');
      return;
    }
    const name = `fuellog-${L.todayISO()}.csv`;
    // BOM so Excel opens Thai text correctly.
    const file = new File(['﻿' + L.toCSV(entries.slice().reverse())], name, { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = el('a');
        a.href = URL.createObjectURL(file);
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      meta.lastBackup = Date.now();
      saveMeta();
      renderSettings();
      renderBackupBanner();
      toast('ส่งออกแล้ว');
    } catch (err) {
      if (err.name !== 'AbortError') alert(`ส่งออกไม่สำเร็จ\n${err.message}`);
    }
  });

  $('#import-csv').addEventListener('click', () => $('#import-file').click());

  $('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const result = L.parseCSV(await file.text());
    if (importEntries(result.entries, result.errors)) location.hash = '#history';
  });

  $('#paste-import').addEventListener('click', () => {
    const box = $('#paste-text');
    if (!box.value.trim()) {
      box.focus();
      return;
    }
    const result = L.parseNotes(box.value);
    if (importEntries(result.entries, result.errors)) {
      box.value = '';
      location.hash = '#history';
    }
  });

  $('#wipe').addEventListener('click', () => {
    if (!entries.length) return;
    if (!confirm(`ลบข้อมูลทั้งหมด ${entries.length} รายการ?\nกู้คืนไม่ได้ ถ้ายังไม่ได้ส่งออก CSV ควรส่งออกก่อน`)) return;
    entries = [];
    saveEntries();
    loadForm(null);
    renderAll();
    toast('ลบข้อมูลทั้งหมดแล้ว');
  });

  // ---------- offline support & updates ----------

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) $('#update-banner').hidden = false;
    });
  }

  $('#update-banner').addEventListener('click', () => location.reload());

  window.addEventListener('hashchange', route);
  // A fresh launch (no hash) lands on the form by default: the app is mostly opened at the pump.
  if (!location.hash && (meta.startView || 'add') === 'add') history.replaceState(null, '', '#add');
  loadForm(null);
  renderHome();
  renderHistory();
  renderSettings();
  route();
  registerServiceWorker();
})();
