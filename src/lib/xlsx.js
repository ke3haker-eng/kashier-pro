// قراءة وكتابة ملفات Excel (.xlsx) بدون مكتبات: ZIP بدون ضغط عند الكتابة، وDecompressionStream عند القراءة.
const enc = new TextEncoder(), dec = new TextDecoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files) {
  const parts = [], central = []; let off = 0;
  const u16 = n => new Uint8Array([n & 255, (n >> 8) & 255]), u32 = n => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const cat = (...a) => { const l = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(l); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name);
    parts.push(lh, data);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name));
    off += lh.length + data.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(off), u16(0));
}
const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const safeName = (s, i) => (String(s || 'Sheet' + (i + 1)).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'Sheet' + (i + 1));

// sheets: [{ name, rows: [[...]], widths?: [..], header?: true }] — الأرقام تُكتب كأرقام حقيقية، والصف الأول عنوان منسّق
export function makeXLSX(sheets) {
  const sh = sheets.map((s, i) => {
    const rows = s.rows || []; const widths = s.widths || (rows[0] || []).map((_, c) => Math.min(48, Math.max(10, ...rows.slice(0, 200).map(r => String(r[c] ?? '').length + 2))));
    const rx = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => { const ref = colName(ci) + (ri + 1), st = ri === 0 && s.header !== false ? ' s="1"' : ''; if (v == null || v === '') return `<c r="${ref}"${st}/>`; if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`; return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${X(v)}</t></is></c>`; }).join('') + '</row>').join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${s.header !== false ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rx}</sheetData></worksheet>`;
  });
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${X(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sh.map((d, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: d })),
  ];
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- القراءة ----------
async function inflate(raw) { const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function unzip(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('الملف ليس بصيغة xlsx صالحة');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true), start = lo + 30 + lnl + lel; const data = b.subarray(start, start + csize);
    files[name] = async () => method === 0 ? data : inflate(data);
  }
  return files;
}
const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref)[1]; let n = 0; for (const c of m) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
export async function readXLSX(buf) {
  const files = await unzip(buf); const text = async n => files[n] ? dec.decode(await files[n]()) : null; const P = new DOMParser();
  const xml = async n => { const t = await text(n); return t ? P.parseFromString(t, 'application/xml') : null; };
  const ss = []; const sx = await xml('xl/sharedStrings.xml'); if (sx) for (const si of sx.getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels'); if (!wb) throw new Error('ملف xlsx تالف');
  const relMap = {}; for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const out = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); let target = relMap[rid] || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const sd = await xml(target); if (!sd) continue; const rows = [];
    for (const r of sd.getElementsByTagName('row')) {
      const row = [];
      for (const c of r.getElementsByTagName('c')) {
        const i = colIdx(c.getAttribute('r')), t = c.getAttribute('t'); let v = '';
        if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else { const ve = c.getElementsByTagName('v')[0]; const raw = ve ? ve.textContent : ''; v = t === 's' ? (ss[+raw] ?? '') : t === 'b' ? raw === '1' : (t === 'str' || t === 'e') ? raw : raw === '' ? '' : (isFinite(+raw) ? +raw : raw); }
        row[i] = v;
      }
      for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
      rows.push(row);
    }
    out.push({ name: s.getAttribute('name'), rows });
  }
  return out;
}
