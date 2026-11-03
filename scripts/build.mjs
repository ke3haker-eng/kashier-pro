// يولّد قائمة الكاش المسبق داخل sw.js ويحدّث رقم الإصدار. التشغيل: node scripts/build.mjs [version]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['tests', 'scripts', 'docs', 'server', 'node_modules', 'dist', '.git', 'data']);
const out = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name.startsWith('.') || SKIP.has(f.name) && d === root) continue; const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out.push(path.relative(root, p).split(path.sep).join('/')); } })(root);
const keep = out.filter(f => !/^(sw\.js|README.*|.*\.zip|.*\.md)$/.test(f)).sort();
const list = ['./', ...keep];
const ver = process.argv[2] || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
let sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'kp-${ver}';`).replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = ${JSON.stringify(list)};`);
fs.writeFileSync(path.join(root, 'sw.js'), sw);
// يزامن رقم الإصدار في src/version.js (يظهر في الإعدادات) وفي package.json عند تمرير إصدار جديد
const vf = path.join(root, 'src', 'version.js');
fs.writeFileSync(vf, fs.readFileSync(vf, 'utf8').replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${ver}'`));
if (process.argv[2]) { const pj = path.join(root, 'package.json'); const j = JSON.parse(fs.readFileSync(pj, 'utf8')); j.version = ver; fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n'); }
console.log(`sw.js: ${list.length} ملف، الإصدار kp-${ver}`);
