import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dynamicDir = path.join(__dirname, 'src/content/dynamic');
const trashDir = path.join(dynamicDir, '.trash');
const galleryDir = path.join(__dirname, 'public/gallery');
const galleryConfigFile = path.join(__dirname, 'src/config/galleryConfig.ts');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// 颜色
const G = '\x1b[90m'; // gray
const C = '\x1b[36m'; // cyan
const Y = '\x1b[33m'; // yellow
const R = '\x1b[32m'; // green
const B = '\x1b[1m';  // bold
const N = '\x1b[0m';  // reset

const dim = (s) => `${G}${s}${N}`;
const bold = (s) => `${B}${s}${N}`;
const pad = (n) => String(n).padStart(2, '0');

let clockTimer = null;

/* ─── 文件操作 ─── */

function readFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fm = {};
  match[1].split('\n').forEach(line => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      let val = kv[2].trim();
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      fm[kv[1]] = val;
    }
  });
  return { fm, content: match[2].trimStart(), raw };
}

function writeFrontMatter(filePath, fm, content) {
  const fmLines = Object.entries(fm).map(([k, v]) => {
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (k === 'published') return `${k}: ${v}`;
    return `${k}: "${v}"`;
  });
  const output = ['---', ...fmLines, '---', '', content].join('\n');
  fs.writeFileSync(filePath, output, 'utf-8');
}

function getFiles() {
  if (!fs.existsSync(dynamicDir)) return [];
  return fs.readdirSync(dynamicDir).filter(f => f.endsWith('.md')).sort().reverse();
}

function getTrashFiles() {
  if (!fs.existsSync(trashDir)) return [];
  return fs.readdirSync(trashDir).filter(f => f.endsWith('.md')).sort().reverse();
}

function getFileMeta(filePath) {
  const data = readFrontMatter(filePath);
  if (!data) return { fm: { published: '', pinned: false, location: '' }, content: '', raw: '' };
  return data;
}

function preview(text, max = 50) {
  const t = text.trim().replace(/\n/g, ' ');
  return t.length > max ? t.slice(0, max) + '...' : t;
}

function fmtTime(t) {
  return t ? t.replace('T', ' ') : '-';
}

/* ─── 菜单 ─── */

function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function menu() {
  stopClock();
  clear();
  const files = getFiles();
  const trash = getTrashFiles();
  const pinned = files.filter(f => {
    const { fm } = getFileMeta(path.join(dynamicDir, f));
    return fm.pinned;
  }).length;

  console.log(`\n  ${bold('Firefly')} 动态管理  ${dim(nowStr())}`);
  const albums = readAlbums();
  console.log(`  ${dim(files.length + ' 条动态' + (pinned ? ' · ' + pinned + ' 条置顶' : '') + (trash.length ? ' · ♻️ ' + trash.length : '') + ' · ' + albums.length + ' 个相册')}`);
  line();

  const opts = [
    ['1', '写动态'],
    ['2', '浏览'],
    ['3', '编辑'],
    ['4', '删除'],
    ['5', '回收站'],
    ['6', '搜索'],
    ['7', '相册管理'],
    ['8', '推送 GitHub'],
  ];
  opts.forEach(([k, v]) => console.log(`  ${C}${k}${N}  ${v}`));
  console.log('');
  console.log(`  ${G}0${N}  退出`);
  console.log(`  ${G}r${N}  刷新`);

  const clockRow = 1;
  clockTimer = setInterval(() => {
    readline.cursorTo(process.stdout, 0, clockRow);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`  ${bold('Firefly')} 动态管理  ${dim(nowStr())}`);
    readline.cursorTo(process.stdout, 0, 14);
  }, 1000);

  ask(`\n  选一个 `, (c) => {
    stopClock();
    const t = c.trim();
    const act = {
      '1': publish, '2': browse, '3': edit, '4': del,
      '5': trashMenu, '6': search, '7': albumMenu, '8': gitPush,
      '0': () => { console.log('\n  拜拜~'); rl.close(); },
      'r': menu
    };
    (act[t] || (() => { console.log('  ?'); setTimeout(menu, 400); }))();
  });
}

/* ─── 工具函数 ─── */

function clear() { stopClock(); console.clear(); }
function line() { console.log(`  ${G}${'─'.repeat(40)}${N}`); }

function ask(prompt, cb) {
  rl.question(prompt + ` ${C}›${N} `, cb);
}

function done(msg) { console.log(`  ${R}✓${N} ${msg}`); }
function fail(msg) { console.log(`  ${Y}⚠${N} ${msg}`); }

function waitAndMenu() {
  ask(`\n  回车回菜单`, () => menu());
}

function listFiles(files, page, pageSize, dir) {
  const start = page * pageSize;
  const end = Math.min(start + pageSize, files.length);
  for (let i = start; i < end; i++) {
    const f = files[i];
    const fp = path.join(dir, f);
    const { fm, content } = getFileMeta(fp);
    const num = String(i + 1).padStart(2);
    const pin = fm.pinned ? `${Y}📌${N} ` : '   ';
    const date = dim(fmtTime(fm.published));
    const loc = fm.location ? ` ${G}📍${N}${fm.location}` : '';
    const txt = dim(preview(content));
    console.log(`  ${pin}${C}${num}${N}  ${bold(f)}`);
    console.log(`      ${date}${loc}`);
    if (txt) console.log(`      ${txt}`);
  }
}

function paginate(files, dir, actionFn, title) {
  const pageSize = 8;
  const totalPages = Math.ceil(files.length / pageSize);
  let currentPage = 0;

  function showPage(page) {
    clear();
    console.log(`\n  ${bold(title)}  ${dim(files.length + ' 条')}`);
    line();
    listFiles(files, page, pageSize, dir);
    console.log('');
    const nav = [];
    if (page > 0) nav.push(`p 上一页`);
    if (page < totalPages - 1) nav.push(`n 下一页`);
    if (nav.length) console.log(`  ${dim(nav.join('  ·  '))}`);
    ask(`  编号查看，0 返回`, (input) => {
      const t = input.trim();
      if (t === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') menu();
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ?');
          setTimeout(() => showPage(page), 400);
        } else {
          actionFn(files[num - 1], dir, () => {
            const updated = dir === trashDir ? getTrashFiles() : getFiles();
            if (updated.length === 0) menu();
            else paginate(updated, dir, actionFn, title);
          });
        }
      }
    });
  }
  showPage(0);
}

function showDetail(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);
  const pin = fm.pinned ? ' 📌 置顶' : '';
  console.log(`\n  ${bold(filename)}${pin}`);
  line();
  console.log(`  ${fmtTime(fm.published)}  ${fm.location ? '📍 ' + fm.location : ''}`);
  line();
  console.log('');
  console.log(content);
  console.log('');
  line();
  ask(`  回车返回`, () => backFn());
}

/* ─── 部署 ─── */

function deploy(filename, commitMsg, cb, isDelete = false) {
  clear();
  console.log(`\n  ${bold('部署')}`);
  line();
  console.log(`  1  仅本地`);
  console.log(`  2  直接推送（推荐）`);
  console.log(`  3  本地构建 + 推送`);
  ask(`\n  选一个 (默认 2)`, (choice) => {
    const c = choice.trim() || '2';
    if (c === '1') { done('已保存'); cb(); return; }

    try {
      if (isDelete) execSync(`git rm "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      else execSync(`git add "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' });
    } catch (e) { fail('git 提交有问题，可能没有变更'); }

    if (c === '2') {
      console.log(`  推送中...`);
      try { execSync('git push', { cwd: __dirname, stdio: 'pipe' }); done('已推送，等 Vercel 自动部署'); }
      catch (e) { fail('推送失败，检查网络'); }
    } else {
      console.log(`  构建中...`);
      try {
        execSync('pnpm build', { cwd: __dirname, stdio: 'pipe' });
        done('构建成功，推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('完成！');
      } catch (e) { fail('构建失败'); }
    }
    cb();
  });
}

/* ══════════════════════════════════
   1. 写动态
   ══════════════════════════════════ */

function publish() {
  clear();
  console.log(`\n  ${bold('写动态')}`);
  line();
  console.log(`  输入内容，一行一行写`);
  console.log(`  写完输入 ${bold('DONE')} 结束\n`);

  const lines = [];
  function askLine() {
    ask('', (line) => {
      if (line.trim().toUpperCase() === 'DONE') {
        if (!lines.join('').trim()) { fail('内容不能为空'); askLine(); return; }
        previewPublish(lines);
      } else {
        lines.push(line);
        askLine();
      }
    });
  }
  askLine();
}

function previewPublish(lines) {
  clear();
  console.log(`\n  ${bold('预览')}`);
  line();
  lines.forEach(l => console.log(`  ${l}`));
  ask(`\n  确认发布？(Y/n)`, (ok) => {
    if (ok.trim().toLowerCase() === 'n') { fail('取消'); setTimeout(menu, 400); return; }
    askDateTime(lines);
  });
}

function askDateTime(lines) {
  const now = new Date();
  const YYYY = now.getFullYear(), MM = pad(now.getMonth() + 1), DD = pad(now.getDate());
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());

  clear();
  console.log(`\n  ${bold('日期时间')}`);
  line();
  ask(`  日期 (回车 ${YYYY}-${MM}-${DD})`, (dateInput) => {
    let y = YYYY, mo = MM, d = DD;
    if (dateInput.trim()) {
      const p = dateInput.trim().split(/[-/]/);
      if (p.length === 3) { y = p[0]; mo = pad(parseInt(p[1])); d = pad(parseInt(p[2])); }
    }
    ask(`  时间 (回车 ${hh}:${mm}:${ss})`, (timeInput) => {
      let hr = hh, mi = mm, se = ss;
      if (timeInput.trim()) {
        const p = timeInput.trim().split(':');
        if (p.length >= 2) { hr = pad(parseInt(p[0])); mi = pad(parseInt(p[1])); se = p.length >= 3 ? pad(parseInt(p[2])) : '00'; }
      }
      const dateStr = `${y}-${mo}-${d}`;
      const timeStr = `${dateStr}T${hr}:${mi}:${se}`;

      let maxSeq = 0;
      if (fs.existsSync(dynamicDir)) {
        fs.readdirSync(dynamicDir).forEach(f => {
          const m = f.match(new RegExp(`^${y}-${mo}-${d}-(\\d+)\\.md$`));
          if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        });
      }
      const seq = String(maxSeq + 1).padStart(6, '0');
      const filename = `${dateStr}-${seq}.md`;
      askMeta(lines, timeStr, filename);
    });
  });
}

function askMeta(lines, timeStr, filename) {
  clear();
  console.log(`\n  ${bold('附加信息')}  ${dim(filename)}`);
  line();
  ask(`  位置 (可选)`, (loc) => {
    ask(`  置顶？(y/N)`, (pin) => {
      const fm = { published: timeStr, pinned: pin.toLowerCase() === 'y', location: loc.trim() || '' };
      if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true });
      writeFrontMatter(path.join(dynamicDir, filename), fm, lines.join('\n'));
      done(`已创建 ${filename}`);
      deploy(filename, `chore: add dynamic - ${filename}`, menu);
    });
  });
}

/* ══════════════════════════════════
   2. 浏览
   ══════════════════════════════════ */

function browse() {
  const files = getFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(menu, 400); return; }
  paginate(files, dynamicDir, showDetail, '浏览');
}

/* ══════════════════════════════════
   3. 编辑
   ══════════════════════════════════ */

function edit() {
  const files = getFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(menu, 400); return; }
  paginate(files, dynamicDir, editSelect, '编辑');
}

function editSelect(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log(`\n  ${bold('编辑: ' + filename)}`);
  line();
  console.log(`  当前内容:\n`);
  content.split('\n').forEach(l => console.log(`  ${l}`));
  console.log(`\n  输入新内容（DONE 跳过）`);

  const newLines = [];
  function askLine() {
    ask('', (line) => {
      if (line.trim().toUpperCase() === 'DONE') {
        const final = newLines.length ? newLines.join('\n') : content;
        clear();
        console.log(`\n  ${bold('修改预览')}`);
        line();
        console.log(final);
        ask(`\n  确认？(Y/n)`, (ok) => {
          if (ok.trim().toLowerCase() === 'n') { fail('取消'); setTimeout(menu, 400); return; }
          editMeta(filename, fp, final, fm, backFn);
        });
      } else {
        newLines.push(line);
        askLine();
      }
    });
  }
  askLine();
}

function editMeta(filename, fp, content, oldFm, backFn) {
  clear();
  console.log(`\n  ${bold('元数据')}`);
  line();
  console.log(`  当前: ${fmtTime(oldFm.published)}  📍 ${oldFm.location || '-'}  ${oldFm.pinned ? '📌 置顶' : ''}`);
  ask(`\n  新时间 (回车不变)`, (t) => {
    const newTime = t.trim() || oldFm.published;
    ask(`  新位置 (回车不变, -清空)`, (l) => {
      let newLoc = oldFm.location;
      if (l.trim() === '-') newLoc = '';
      else if (l.trim()) newLoc = l.trim();
      ask(`  置顶？(y/N/回车不变)`, (p) => {
        let newPin = oldFm.pinned;
        if (p.trim().toLowerCase() === 'y') newPin = true;
        else if (p.trim().toLowerCase() === 'n') newPin = false;
        writeFrontMatter(fp, { published: newTime, location: newLoc, pinned: newPin }, content);
        done(`已更新 ${filename}`);
        deploy(filename, `chore: update dynamic - ${filename}`, backFn);
      });
    });
  });
}

/* ══════════════════════════════════
   4. 删除
   ══════════════════════════════════ */

function del() {
  const files = getFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(menu, 400); return; }
  paginate(files, dynamicDir, confirmDelete, '删除');
}

function confirmDelete(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log(`\n  ${bold('移到回收站: ' + filename)}`);
  line();
  console.log(`  ${fmtTime(fm.published)}`);
  line();
  console.log(`\n  ${content}\n`);
  line();

  ask(`  确认删除？(y/N)`, (confirm) => {
    if (confirm.toLowerCase() !== 'y') { fail('取消'); setTimeout(backFn, 400); return; }
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    fs.renameSync(fp, path.join(trashDir, filename));
    done('已移到回收站');
    deploy(filename, `chore: delete dynamic - ${filename}`, backFn, true);
  });
}

/* ══════════════════════════════════
   5. 回收站
   ══════════════════════════════════ */

function trashMenu() {
  const files = getTrashFiles();
  if (!files.length) { fail('回收站为空'); setTimeout(menu, 400); return; }
  paginate(files, trashDir, trashAction, '回收站');
}

function trashAction(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log(`\n  ${bold('♻️ ' + filename)}`);
  line();
  console.log(`  ${fmtTime(fm.published)}`);
  line();
  console.log(`\n  ${content}\n`);
  line();
  console.log(`  1  恢复`);
  console.log(`  2  永久删除`);
  ask(`\n  选一个`, (c) => {
    if (c.trim() === '1') restoreFile(filename, fp, backFn);
    else if (c.trim() === '2') permanentlyDelete(filename, fp, backFn);
    else backFn();
  });
}

function restoreFile(filename, src, backFn) {
  const dst = path.join(dynamicDir, filename);
  if (fs.existsSync(dst)) { fail('目标已有同名文件'); setTimeout(backFn, 400); return; }
  fs.renameSync(src, dst);
  done(`已恢复 ${filename}`);
  ask(`  推送恢复？(y/N)`, (push) => {
    if (push.toLowerCase() === 'y') {
      try {
        execSync(`git add "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
        execSync(`git commit -m "chore: restore dynamic - ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('已推送');
      } catch (e) { fail('推送失败'); }
    }
    setTimeout(backFn, 400);
  });
}

function permanentlyDelete(filename, fp, backFn) {
  ask(`  确认永久删除？不可恢复 (y/N)`, (c) => {
    if (c.toLowerCase() !== 'y') { fail('取消'); setTimeout(backFn, 400); return; }
    fs.unlinkSync(fp);
    done('已删除');
    ask(`  推送删除？(y/N)`, (push) => {
      if (push.toLowerCase() === 'y') {
        try {
          execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
          execSync(`git commit -m "chore: permanently delete ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
          execSync('git push', { cwd: __dirname, stdio: 'pipe' });
          done('已推送');
        } catch (e) { fail('推送失败'); }
      }
      setTimeout(backFn, 400);
    });
  });
}

/* ══════════════════════════════════
   6. 搜索
   ══════════════════════════════════ */

function search() {
  clear();
  console.log(`\n  ${bold('搜索')}`);
  line();
  ask(`  关键词`, (kw) => {
    if (!kw.trim()) { fail('输入点啥'); setTimeout(search, 400); return; }

    const files = getFiles();
    const results = [];
    for (const f of files) {
      const fp = path.join(dynamicDir, f);
      const raw = fs.readFileSync(fp, 'utf-8');
      if (raw.toLowerCase().includes(kw.trim().toLowerCase())) {
        results.push({ filename: f, ...getFileMeta(fp) });
      }
    }

    clear();
    console.log(`\n  ${bold('搜索结果: ' + kw.trim())}`);
    line();
    if (!results.length) { fail('没找到'); setTimeout(menu, 1000); return; }

    results.forEach((r, i) => {
      const pin = r.fm.pinned ? '📌 ' : '  ';
      const date = fmtTime(r.fm.published);
      const txt = preview(r.content, 70);
      console.log(`  ${pin}${C}${i + 1}${N}  ${bold(r.filename)}  ${dim(date)}`);
      console.log(`      ${txt}`);
    });
    ask(`\n  编号查看详情，0 返回`, (input) => {
      const num = parseInt(input.trim(), 10);
      if (num > 0 && num <= results.length) showDetail(results[num - 1].filename, dynamicDir, search);
      else menu();
    });
  });
}

/* ══════════════════════════════════
   7. 相册管理
   ══════════════════════════════════ */

let _albumBack = null;

function readAlbums() {
  if (!fs.existsSync(galleryConfigFile)) return [];
  const raw = fs.readFileSync(galleryConfigFile, 'utf-8');
  const albums = [];
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('{', i);
    if (start === -1) break;
    const before = raw.slice(0, start);
    if (before.includes('albums: [')) {
      let depth = 0, end = -1;
      for (let j = start; j < raw.length; j++) {
        if (raw[j] === '{') depth++;
        if (raw[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
      }
      if (end === -1) break;
      const block = raw.slice(start, end);
      const album = {};
      const idM = block.match(/id:\s*["']([^"']+)["']/);
      if (!idM) { i = end; continue; }
      album.id = idM[1];
      const nameM = block.match(/name:\s*["']([^"']+)["']/);
      if (nameM) album.name = nameM[1];
      const descM = block.match(/description:\s*["']([^"']*)["']/);
      if (descM) album.description = descM[1];
      const locM = block.match(/location:\s*["']([^"']*)["']/);
      if (locM) album.location = locM[1];
      const dateM = block.match(/date:\s*["']([^"']*)["']/);
      if (dateM) album.date = dateM[1];
      const covM = block.match(/cover:\s*["']([^"']*)["']/);
      if (covM) album.cover = covM[1];
      const tagM = block.match(/tags:\s*\[([^\]]*)\]/);
      album.tags = tagM ? tagM[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean) : [];
      const pwM = block.match(/password:\s*["']([^"']*)["']/);
      if (pwM) album.password = pwM[1];
      const phM = block.match(/passwordHint:\s*["']([^"']*)["']/);
      if (phM) album.passwordHint = phM[1];
      album.photos = scanPhotos(album.id);
      albums.push(album);
      i = end;
    } else {
      i = start + 1;
    }
  }
  return albums;
}

function scanPhotos(albumId) {
  const dir = path.join(galleryDir, albumId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f)).sort();
  const urlsFile = path.join(dir, 'urls.txt');
  let remote = [];
  if (fs.existsSync(urlsFile)) {
    remote = fs.readFileSync(urlsFile, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  }
  return [...files, ...remote];
}

function countPhotos(albumId) {
  const dir = path.join(galleryDir, albumId);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f)).length;
}

function saveAlbums(albums) {
  let raw = fs.readFileSync(galleryConfigFile, 'utf-8');
  const start = raw.indexOf('albums: [');
  if (start === -1) { fail('无法解析 galleryConfig.ts: 未找到 albums: ['); return false; }
  const arrStart = start + 8;
  let depth = 0, end = -1;
  for (let j = arrStart; j < raw.length; j++) {
    if (raw[j] === '[') depth++;
    if (raw[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) { fail('无法解析 galleryConfig.ts: 未找到数组闭合 ]'); return false; }

  const entries = albums.map(a => {
    const lines = ['\t\t{'];
    lines.push(`\t\t\tid: "${a.id}",`);
    lines.push(`\t\t\tname: "${a.name}",`);
    if (a.description) lines.push(`\t\t\tdescription: "${a.description}",`);
    if (a.cover) lines.push(`\t\t\tcover: "${a.cover}",`);
    if (a.date) lines.push(`\t\t\tdate: "${a.date}",`);
    if (a.location) lines.push(`\t\t\tlocation: "${a.location}",`);
    if (a.tags && a.tags.length) lines.push(`\t\t\ttags: [${a.tags.map(t => `"${t}"`).join(', ')}],`);
    if (a.password) lines.push(`\t\t\tpassword: "${a.password}",`);
    if (a.passwordHint) lines.push(`\t\t\tpasswordHint: "${a.passwordHint}",`);
    lines.push('\t\t}');
    return lines.join('\n');
  }).join(',\n');

  raw = raw.slice(0, arrStart + 1) + '\n' + entries + '\n\t' + raw.slice(end);
  fs.writeFileSync(galleryConfigFile, raw, 'utf-8');
  return true;
}

function deployAlbums(commitMsg, cb) {
  clear();
  console.log(`\n  ${bold('部署')}`);
  line();
  console.log(`  1  仅本地`);
  console.log(`  2  直接推送（推荐）`);
  console.log(`  3  本地构建 + 推送`);
  ask(`\n  选一个 (默认 2)`, (c) => {
    const ch = c.trim() || '2';
    if (ch === '1') { done('已保存'); cb(); return; }
    try {
      execSync(`git add "src/config/galleryConfig.ts"`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git add "public/gallery/"`, { cwd: __dirname, stdio: 'pipe' });
      try { execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' }); } catch(e) {}
    } catch(e) { fail('git 有问题'); }
    if (ch === '2') {
      console.log('  推送中...');
      try { execSync('git push', { cwd: __dirname, stdio: 'pipe' }); done('已推送'); }
      catch(e) { fail('推送失败'); }
    } else {
      try {
        execSync('pnpm build', { cwd: __dirname, stdio: 'pipe' });
        done('构建成功，推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('完成！');
      } catch(e) { fail('构建失败'); }
    }
    cb();
  });
}

// ── 相册主菜单 ──

function albumMenu() {
  _albumBack = menu;
  const albums = readAlbums();
  clear();
  console.log(`\n  ${bold('相册管理')}  ${dim(albums.length + ' 个相册')}`);
  line();
  console.log(`  ${C}1${N}  新建相册`);
  console.log(`  ${C}2${N}  浏览相册`);
  console.log(`  ${C}3${N}  编辑相册`);
  console.log(`  ${C}4${N}  照片管理`);
  console.log(`  ${C}5${N}  删除相册`);
  console.log(`  ${dim('──')}`);
  console.log(`  ${C}0${N}  返回主菜单`);
  ask(`选一个`, (c) => {
    const t = c.trim();
    if (t === '1') createAlbum();
    else if (t === '2') browseAlbums();
    else if (t === '3') editAlbum();
    else if (t === '4') photoMenu();
    else if (t === '5') deleteAlbum();
    else if (t === '0') menu();
    else { console.log('  ?'); setTimeout(albumMenu, 400); }
  });
}

// ── 新建相册 ──

function createAlbum() {
  clear();
  console.log(`\n  ${bold('新建相册')}`);
  line();
  ask(`相册ID (英文数字，如 "japan-2026")`, (id) => {
    if (!id.trim()) { fail('ID 不能为空'); setTimeout(createAlbum, 400); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) { fail('ID 只允许字母数字下划线连字符'); setTimeout(createAlbum, 400); return; }
    const albums = readAlbums();
    if (albums.find(a => a.id === id.trim())) { fail('该 ID 已存在'); setTimeout(createAlbum, 400); return; }
    const albumId = id.trim();
    ask(`相册名称`, (name) => {
      if (!name.trim()) { fail('名称不能为空'); setTimeout(createAlbum, 400); return; }
      ask(`描述 (可选)`, (desc) => {
        askDateChoice(albumId, name, desc);
      });
    });
  });
}

function askDateChoice(id, name, desc) {
  const today = new Date().toISOString().slice(0, 10);
  ask(`日期:\n  1  自定义输入\n  2  使用今天 (${today})\n  选择`, (c) => {
    if (c.trim() === '2') {
      askAlbumMeta(id, name, desc, today);
    } else {
      ask(`日期 (YYYY-MM-DD)`, (d) => {
        askAlbumMeta(id, name, desc, d.trim());
      });
    }
  });
}

function askAlbumMeta(id, name, desc, date) {
  ask(`地点 (可选)`, (loc) => {
    ask(`标签 (可选，逗号分隔)`, (tagsStr) => {
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      ask(`访问密码 (可选)`, (pw) => {
        if (pw.trim()) {
          ask(`密码提示 (可选)`, (hint) => {
            finishCreate(id, name, desc, date, loc, tags, pw.trim(), hint.trim());
          });
        } else {
          finishCreate(id, name, desc, date, loc, tags, '', '');
        }
      });
    });
  });
}

function finishCreate(id, name, desc, date, loc, tags, pw, ph) {
  const albums = readAlbums();
  albums.push({ id, name, description: desc || '', date: date || '', location: loc || '', tags, password: pw || '', passwordHint: ph || '' });
  if (saveAlbums(albums)) {
    const dir = path.join(galleryDir, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    done(`相册「${name}」已创建`);
    console.log(`  public/gallery/${id}/`);
    ask(`马上上传照片？(y/N)`, (up) => {
      if (up.toLowerCase() === 'y') managePhotoDir(id);
      else deployAlbums(`chore: add album - ${id}`, albumMenu);
    });
  } else {
    fail('保存失败');
    setTimeout(albumMenu, 1000);
  }
}

// ── 浏览相册 ──

function browseAlbums() {
  const albums = readAlbums();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('相册列表')}  ${dim(albums.length + ' 个')}`);
  line();
  albums.forEach((a, i) => {
    const cnt = countPhotos(a.id);
    const pw = a.password ? ' 🔒' : '';
    console.log(`  ${C}${String(i+1).padStart(2)}${N}  ${bold(a.name)}${pw}`);
    console.log(`      ${dim(a.date || '-')}  ${a.location || '-'}  ${cnt}张`);
  });
  ask(`\n  编号查看，0 返回`, (n) => {
    const num = parseInt(n.trim(), 10);
    if (num > 0 && num <= albums.length) showAlbum(albums[num - 1]);
    else albumMenu();
  });
}

function showAlbum(album) {
  clear();
  const photos = scanPhotos(album.id);
  console.log(`\n  ${bold(album.name)}`);
  line();
  console.log(`  ID:    ${album.id}`);
  console.log(`  描述:  ${album.description || '-'}`);
  console.log(`  日期:  ${album.date || '-'}`);
  console.log(`  地点:  ${album.location || '-'}`);
  console.log(`  标签:  ${album.tags && album.tags.length ? album.tags.join(', ') : '-'}`);
  console.log(`  密码:  ${album.password ? album.password : '无'}`);
  console.log(`  照片:  ${photos.length} 张`);
  console.log(`  目录:  public/gallery/${album.id}/`);
  if (photos.length) {
    console.log('');
    line();
    photos.slice(0, 15).forEach((p, i) => console.log(`  ${C}${String(i+1).padStart(2)}${N}  ${dim(p.slice(0, 50))}`));
    if (photos.length > 15) console.log(`  ${dim(`...还有 ${photos.length - 15} 张`)}`);
  }
  console.log('');
  line();
  console.log(`  ${C}1${N}  编辑`);
  console.log(`  ${C}2${N}  照片管理`);
  console.log(`  ${C}3${N}  删除`);
  ask(`\n  选一个，0 返回`, (c) => {
    const t = c.trim();
    if (t === '1') editAlbumById(album.id);
    else if (t === '2') managePhotoDir(album.id);
    else if (t === '3') confirmDeleteAlbum(album.id);
    else browseAlbums();
  });
}

// ── 编辑相册 ──

function editAlbum() {
  const albums = readAlbums();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('编辑相册')}`);
  line();
  albums.forEach((a, i) => console.log(`  ${C}${i+1}${N}  ${bold(a.name)}  ${dim(a.id)}`));
  ask(`\n  编号选择，0 返回`, (n) => {
    const num = parseInt(n.trim(), 10);
    if (num > 0 && num <= albums.length) editAlbumById(albums[num-1].id);
    else albumMenu();
  });
}

function editAlbumById(aid) {
  const albums = readAlbums();
  const album = albums.find(a => a.id === aid);
  if (!album) { fail('未找到'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('编辑: ' + album.name)}`);
  line();
  ask(`名称 (回车不变)`, (name) => {
    if (name.trim()) album.name = name.trim();
    ask(`描述 (回车不变, -清空)`, (desc) => {
      if (desc.trim() === '-') album.description = '';
      else if (desc.trim()) album.description = desc.trim();
      ask(`日期 (回车不变)`, (date) => {
        if (date.trim()) album.date = date.trim();
        ask(`地点 (回车不变, -清空)`, (loc) => {
          if (loc.trim() === '-') album.location = '';
          else if (loc.trim()) album.location = loc.trim();
          ask(`标签 (回车不变)`, (tagsStr) => {
            if (tagsStr.trim()) album.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
            if (saveAlbums(albums)) {
              done(`相册「${album.name}」已更新`);
              deployAlbums(`chore: update album - ${aid}`, albumMenu);
            } else { fail('保存失败'); setTimeout(albumMenu, 1000); }
          });
        });
      });
    });
  });
}

// ── 删除相册 ──

function deleteAlbum() {
  const albums = readAlbums();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('删除相册')}`);
  line();
  albums.forEach((a, i) => console.log(`  ${C}${i+1}${N}  ${bold(a.name)}  ${dim(a.id + '  ' + countPhotos(a.id) + '张')}`));
  ask(`\n  编号选择，0 返回`, (n) => {
    const num = parseInt(n.trim(), 10);
    if (num > 0 && num <= albums.length) confirmDeleteAlbum(albums[num-1].id);
    else albumMenu();
  });
}

function confirmDeleteAlbum(aid) {
  const albums = readAlbums();
  const album = albums.find(a => a.id === aid);
  if (!album) { fail('未找到'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('删除: ' + album.name)}`);
  const cnt = countPhotos(aid);
  if (cnt > 0) console.log(`  ${Y}⚠ 有 ${cnt} 张照片${N}`);
  ask(`确认删除？(y/N)`, (ok) => {
    if (ok.toLowerCase() !== 'y') { fail('取消'); setTimeout(albumMenu, 400); return; }
    ask(`同时删除照片目录？(y/N)`, (del) => {
      const newAlbums = albums.filter(a => a.id !== aid);
      if (saveAlbums(newAlbums)) {
        done('已从配置移除');
        if (del.toLowerCase() === 'y') {
          const dir = path.join(galleryDir, aid);
          if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); done('照片目录已删除'); }
        }
        deployAlbums(`chore: delete album - ${aid}`, albumMenu);
      } else { fail('失败'); setTimeout(albumMenu, 1000); }
    });
  });
}

// ── 照片管理 ──

function photoMenu() {
  const albums = readAlbums();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }
  clear();
  console.log(`\n  ${bold('照片管理')}`);
  line();
  albums.forEach((a, i) => console.log(`  ${C}${i+1}${N}  ${bold(a.name)}  ${dim(countPhotos(a.id) + ' 张')}`));
  ask(`\n  选择相册，0 返回`, (n) => {
    const num = parseInt(n.trim(), 10);
    if (num > 0 && num <= albums.length) managePhotoDir(albums[num-1].id);
    else albumMenu();
  });
}

function managePhotoDir(aid) {
  const albums = readAlbums();
  const album = albums.find(a => a.id === aid);
  if (!album) { fail('未找到'); setTimeout(albumMenu, 400); return; }
  const dir = path.join(galleryDir, aid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const show = () => {
    const photos = scanPhotos(aid);
    clear();
    console.log(`\n  ${bold(album.name)}  ${dim(photos.length + ' 张')}`);
    line();
    if (photos.length) {
      photos.slice(0, 20).forEach((p, i) => console.log(`  ${C}${String(i+1).padStart(2)}${N}  ${dim(p.slice(0, 55))}`));
      if (photos.length > 20) console.log(`  ${dim(`...还有 ${photos.length - 20} 张`)}`);
    }
    console.log('');
    console.log(`  ${C}1${N}  打开目录（放入照片后回车）`);
    console.log(`  ${C}2${N}  添加远程 URL`);
    console.log(`  ${C}3${N}  删除照片`);
    ask(`\n  选一个，0 返回`, (c) => {
      const t = c.trim();
      if (t === '1') openDirForUpload(aid, show);
      else if (t === '2') addRemoteUrls(aid, show);
      else if (t === '3') removePhoto(aid, show);
      else photoMenu();
    });
  };
  show();
}

function openDirForUpload(aid, backFn) {
  const dir = path.join(galleryDir, aid);
  try { execSync(`start "" "${dir}"`, { stdio: 'pipe' }); } catch(e) {}
  ask(`放入照片后按回车`, () => {
    const cnt = countPhotos(aid);
    done(`现在有 ${cnt} 张照片`);
    backFn();
  });
}

function addRemoteUrls(aid, backFn) {
  const dir = path.join(galleryDir, aid);
  clear();
  console.log(`\n  ${bold('添加远程 URL')}`);
  line();
  console.log(`  每行一个，空行结束\n`);
  const urls = [];
  function askUrl() {
    ask('', (url) => {
      if (!url.trim()) {
        if (!urls.length) { fail('没有 URL'); backFn(); return; }
        const uf = path.join(dir, 'urls.txt');
        const exist = fs.existsSync(uf) ? fs.readFileSync(uf, 'utf-8') : '';
        fs.writeFileSync(uf, exist + urls.join('\n') + '\n', 'utf-8');
        done(`已添加 ${urls.length} 个 URL`);
        backFn();
        return;
      }
      urls.push(url.trim());
      askUrl();
    });
  }
  askUrl();
}

function removePhoto(aid, backFn) {
  const dir = path.join(galleryDir, aid);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f)) : [];
  const urlsFile = path.join(dir, 'urls.txt');
  const hasUrls = fs.existsSync(urlsFile);

  if (!files.length && !hasUrls) { fail('没有照片'); setTimeout(backFn, 400); return; }
  clear();
  console.log(`\n  ${bold('删除照片')}`);
  line();
  files.forEach((f, i) => console.log(`  ${C}${i+1}${N}  ${f}`));
  if (hasUrls) files.length ? console.log(`  ${C}d${N}  urls.txt`) : console.log(`  ${C}d${N}  ${dim('urls.txt')}`);
  ask(`\n  编号删除，0 返回`, (n) => {
    const t = n.trim();
    if (t === 'd' && hasUrls) { fs.unlinkSync(urlsFile); done('已删除 urls.txt'); setTimeout(backFn, 400); return; }
    const num = parseInt(t, 10);
    if (num > 0 && num <= files.length) {
      fs.unlinkSync(path.join(dir, files[num-1]));
      done(`已删除 ${files[num-1]}`);
      deployAlbums(`chore: delete photo - ${aid}`, () => removePhoto(aid, backFn));
    } else backFn();
  });
}

/* ─── 推送 GitHub ─── */

function gitPush() {
  clear();
  console.log(`\n  ${bold('推送 GitHub')}\n`);
  line();
  try {
    done('git add .');
    execSync('git add .', { cwd: __dirname, stdio: 'pipe' });
  } catch (e) {
    fail('git add 失败');
    waitAndMenu();
    return;
  }

  ask('  提交信息', (msg) => {
    const m = msg.trim() || 'update';
    try {
      execSync(`git commit -m "${m}"`, { cwd: __dirname, stdio: 'pipe' });
      done('已提交');
    } catch (e) {
      const out = e.stdout?.toString() || '';
      if (out.includes('nothing to commit')) {
        fail('没有变更需要提交');
        waitAndMenu();
        return;
      }
      fail('提交失败');
      waitAndMenu();
      return;
    }

    console.log(`  ${dim('正在推送...')}`);
    try {
      execSync('git push', { cwd: __dirname, stdio: 'pipe' });
      done('推送成功 ✅');
    } catch (e) {
      fail('推送失败，检查网络或权限');
    }
    waitAndMenu();
  });
}

/* ─── 启动 ─── */

if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true });
if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

menu();