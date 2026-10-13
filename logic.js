// Pure helpers: formatting, parsing, CSV and stats. No DOM access.
const FuelLogic = (() => {
  'use strict';

  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  const round2 = (n) => Math.round(n * 100) / 100;
  const pad2 = (n) => String(n).padStart(2, '0');

  function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return s === '' ? NaN : Number(s);
  }

  // ---------- dates (stored as ISO yyyy-mm-dd, shown in Thai Buddhist era) ----------

  function todayISO(now = new Date()) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function isoToParts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  }

  function partsToISO(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // 2-digit years are Buddhist era (69 -> 2569); 4-digit years >= 2400 are BE too.
  function toCEYear(y, digits) {
    if (digits <= 2) return 2500 + y - 543;
    return y >= 2400 ? y - 543 : y;
  }

  const beShort = (y) => pad2((y + 543) % 100);

  function formatDate(iso) {
    const { y, m, d } = isoToParts(iso);
    return `${d} ${TH_MONTHS[m - 1]} ${beShort(y)}`;
  }

  function formatDateShort(iso) {
    const { m, d } = isoToParts(iso);
    return `${d} ${TH_MONTHS[m - 1]}`;
  }

  // key is 'yyyy-mm'
  function formatMonth(key, full = false) {
    const [y, m] = key.split('-').map(Number);
    return full ? `${TH_MONTHS_FULL[m - 1]} ${y + 543}` : `${TH_MONTHS[m - 1]} ${beShort(y)}`;
  }

  const monthAbbr = (m) => TH_MONTHS[m - 1];

  function dayNumber(iso) {
    const { y, m, d } = isoToParts(iso);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  function addMonthsISO(iso, delta) {
    const { y, m, d } = isoToParts(iso);
    const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(Math.min(d, last))}`;
  }

  // Accepts yyyy-mm-dd or d/m/yyyy (CE or BE), as Excel may rewrite dates on re-save.
  function parseFlexibleDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return partsToISO(toCEYear(+m[1], 4), +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (m) return partsToISO(toCEYear(+m[3], m[3].length), +m[2], +m[1]);
    return null;
  }

  // ---------- numbers ----------

  const fmt = (n, digits) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const formatBaht = (n) => fmt(n, Number.isInteger(round2(n)) ? 0 : 2);

  function compact(n) {
    if (Math.abs(n) < 1000) return fmt(n, 0);
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }

  // ---------- entries ----------

  function fieldError(field, message) {
    const err = new Error(message);
    err.field = field;
    return err;
  }

  // Validates raw form/import values. Missing liters or price is derived from the other.
  function normalizeEntry(raw) {
    const date = parseFlexibleDate(raw.date);
    if (!date) throw fieldError('date', 'วันที่ไม่ถูกต้อง');
    const km = toNumber(raw.km);
    if (!(km > 0)) throw fieldError('km', 'กรอกระยะทาง (กม.)');
    const amount = toNumber(raw.amount);
    if (!(amount > 0)) throw fieldError('amount', 'กรอกจำนวนเงิน (บาท)');
    let liters = toNumber(raw.liters);
    let price = toNumber(raw.price);
    if (!(liters > 0) && price > 0) liters = round2(amount / price);
    if (!(liters > 0)) throw fieldError('liters', 'กรอกปริมาณลิตร หรือราคาต่อลิตร');
    if (!(price > 0)) price = round2(amount / liters);
    const fuel = String(raw.fuel || '').trim() || 'E20';
    const note = String(raw.note || '').trim();
    return { date, km, fuel, liters, price, amount, note };
  }

  const kmPerLiter = (e) => (e.liters > 0 ? e.km / e.liters : NaN);
  const bahtPerKm = (e) => (e.km > 0 ? e.amount / e.km : NaN);

  function dedupeKey(e) {
    return [e.date, round2(e.km), round2(e.liters), round2(e.amount)].join('|');
  }

  function totals(list) {
    const t = { count: list.length, km: 0, liters: 0, amount: 0 };
    for (const e of list) {
      t.km += e.km;
      t.liters += e.liters;
      t.amount += e.amount;
    }
    t.kmPerLiter = t.liters > 0 ? t.km / t.liters : NaN;
    t.bahtPerKm = t.km > 0 ? t.amount / t.km : NaN;
    return t;
  }

  // Every calendar month from the first to the last entry, ascending, empty months included.
  function monthlySeries(list) {
    if (!list.length) return [];
    const groups = new Map();
    for (const e of list) {
      const key = e.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const keys = [...groups.keys()].sort();
    let [y, m] = keys[0].split('-').map(Number);
    const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
    const out = [];
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${pad2(m)}`;
      out.push({ key, ...totals(groups.get(key) || []) });
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(round2(v));
    return ticks;
  }

  // ---------- import from free-form notes ----------
  // Matches the format the owner keeps in Notes:
  //   14 ก.ย. 69
  //   685.3 กม.  E20 30.80 ลิตร (34.09 บ./ลิตร)
  //   1,050 บาท (22.25 กม./ลิตร)

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 'ก.ย.' also matches 'ก.ย', 'กย.' and 'ก. ย.'
  const abbrPattern = (abbr) => abbr.split('.').filter(Boolean).map(escapeRe).join('\\.?\\s*') + '\\.?';
  const MONTH_PATTERNS = TH_MONTHS.map((abbr, i) => `${escapeRe(TH_MONTHS_FULL[i])}|${abbrPattern(abbr)}`);
  const MONTH_RES = MONTH_PATTERNS.map((p) => new RegExp(`^(?:${p})$`));
  const DATE_RE = new RegExp(`(\\d{1,2})\\s*(${MONTH_PATTERNS.join('|')})\\s*(\\d{4}|\\d{2})(?!\\d)`, 'g');

  const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)';
  const KM_RE = new RegExp(`${NUM}\\s*(?:กม|km)(?!\\.?\\s*\\/)\\.?`, 'i');
  const LITERS_RE = new RegExp(`${NUM}\\s*(?:ลิตร|L(?![a-z]))`, 'i');
  const PRICE_RE = new RegExp(`${NUM}\\s*(?:บาท|บ)\\.?\\s*\\/\\s*(?:ลิตร|L)`, 'i');
  const AMOUNT_RE = new RegExp(`${NUM}\\s*(?:บาท|บ\\.)(?!\\s*\\/)`);
  const FUEL_RE = /E\s?20|E\s?85|แก๊สโซฮอล์\s*9[15]|โซฮอล์\s*9[15]|เบนซิน(?:\s*95)?|ดีเซล(?:\s*(?:B\s?\d+|พรีเมียม))?/i;

  function guessFuel(block, kmMatch, litersMatch, fallback) {
    if (kmMatch && litersMatch && litersMatch.index > kmMatch.index) {
      const between = block.slice(kmMatch.index + kmMatch[0].length, litersMatch.index).replace(/^[\s.·,-]+|[\s.·,-]+$/g, '');
      if (between && between.length <= 20 && !/\d{3,}/.test(between)) return between;
    }
    const m = block.match(FUEL_RE);
    return m ? m[0].replace(/\s+/g, ' ') : fallback;
  }

  function parseNotes(text) {
    const dates = [...String(text).matchAll(DATE_RE)];
    const entries = [];
    const errors = [];
    let lastFuel = 'E20';
    dates.forEach((dm, i) => {
      const block = text.slice(dm.index + dm[0].length, i + 1 < dates.length ? dates[i + 1].index : text.length);
      const monthIndex = MONTH_RES.findIndex((re) => re.test(dm[2]));
      const iso = partsToISO(toCEYear(+dm[3], dm[3].length), monthIndex + 1, +dm[1]);
      const kmMatch = block.match(KM_RE);
      const litersMatch = block.match(LITERS_RE);
      const priceMatch = block.match(PRICE_RE);
      const amountMatch = block.match(AMOUNT_RE);
      try {
        const entry = normalizeEntry({
          date: iso,
          km: kmMatch && kmMatch[1],
          liters: litersMatch && litersMatch[1],
          price: priceMatch && priceMatch[1],
          amount: amountMatch && amountMatch[1],
          fuel: guessFuel(block, kmMatch, litersMatch, lastFuel),
        });
        lastFuel = entry.fuel;
        entries.push(entry);
      } catch (err) {
        errors.push(`${dm[0].trim()}: ${err.message}`);
      }
    });
    return { entries, errors };
  }

  // ---------- CSV ----------

  const CSV_COLUMNS = ['date', 'km', 'fuel', 'liters', 'price', 'amount', 'note'];

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(list) {
    const rows = [CSV_COLUMNS.join(',')];
    for (const e of list) rows.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
    return rows.join('\r\n') + '\r\n';
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function parseCSV(text) {
    const rows = parseCSVRows(String(text).replace(/^﻿/, ''));
    const entries = [];
    const errors = [];
    if (!rows.length) return { entries, errors: ['ไฟล์ว่าง'] };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const missing = ['date', 'km', 'amount'].filter((c) => !header.includes(c));
    if (missing.length) return { entries, errors: [`ไม่พบคอลัมน์ ${missing.join(', ')}`] };
    rows.slice(1).forEach((r, i) => {
      const raw = {};
      header.forEach((h, j) => { raw[h] = r[j]; });
      try {
        entries.push(normalizeEntry(raw));
      } catch (err) {
        errors.push(`แถว ${i + 2}: ${err.message}`);
      }
    });
    return { entries, errors };
  }

  return {
    round2, toNumber, todayISO, formatDate, formatDateShort, formatMonth, monthAbbr, dayNumber,
    addMonthsISO, parseFlexibleDate, fmt, formatBaht, compact, normalizeEntry, kmPerLiter,
    bahtPerKm, dedupeKey, totals, monthlySeries, niceTicks, parseNotes, toCSV, parseCSV,
  };
})();
