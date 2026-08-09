#!/usr/bin/env node
/**
 * ====================================================================
 *  📸 AlbumFlow — 相册 × 动态 融合管理系统 (CLI)
 *  博客: Firefly (Astro)
 *  功能: 相册管理 + 动态管理 + 照片管理 + 一键部署
 * ====================================================================
 */
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===================== 路径配置 =====================
const DIRS = {
  dynamic: path.join(__dirname, 'src/content/dynamic'),
  trash:   path.join(__dirname, 'src/content/dynamic/.trash'),
  gallery: path.join(__dirname, 'public/gallery'),
  config:  path.join(__dirname, 'src/config'),
};
const GALLERY_CONFIG_FILE = path.join(DIRS.config, 'galleryConfig.ts');

// ===================== 工具函数 =====================
const C = '\x1b[36m', Y = '\x1b[33m', G = '\x1b[90m';
const R = '\x1b[32m', B = '\x1b[1m',  N = '\x1b[0m';
const dim = s => `${G}${s}${N}`;
const bold = s => `${B}${s}${N}`;
const pad = n => String(n).padStart(2, '0');

let clockTimer = null;

function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clear() { stopClock(); console.clear(); }
function line() { console.log(`  ${G}${'─'.repeat(50)}${N}`); }
function hr()  { console.log(`  ${G}${'┈'.repeat(25)}${N}`); }

function ask(prompt, cb) {
  rl.question(`  ${prompt} ${C}›${N} `, cb);
}

function done(msg) { console.log(`  ${R}✓${N} ${msg}`); }
function fail(msg) { console.log(`  ${Y}⚠${N} ${msg}`); }

function stopClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function waitAndMenu() {
  ask(`回车回菜单`, () => menu());
}

// ===================== 动态相关文件操作 =====================
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
    return `${k}: "${v}"`;
  });
  const output = ['---', ...fmLines, '---', '', content].join('\n');
  fs.writeFileSync(filePath, output, 'utf-8');
}

function getDynamicFiles() {
  if (!fs.existsSync(DIRS.dynamic)) return [];
  return fs.readdirSync(DIRS.dynamic).filter(f => f.endsWith('.md')).sort().reverse();
}

function getTrashFiles() {
  if (!fs.existsSync(DIRS.trash)) return [];
  return fs.readdirSync(DIRS.trash).filter(f => f.endsWith('.md')).sort().reverse();
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

// ===================== 相册相关文件操作 =====================
/**
 * 读取相册配置（解析 galleryConfig.ts）
 */
function readAlbumConfig() {
  const raw = fs.readFileSync(GALLERY_CONFIG_FILE, 'utf-8');
  // 尝试提取 albums 数组
  const albums = [];
  // 使用正则提取每个 album 对象
  const albumRegex = /\{\s*\n([\s\S]*?)\n\s*\},?/g;
  let match;
  while ((match = albumRegex.exec(raw)) !== null) {
    const block = match[1];
    const album = {};
    // 提取各个字段
    const idMatch = block.match(/id:\s*["']([^"']+)["']/);
    if (idMatch) album.id = idMatch[1];
    else continue; // id 是必须的

    const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
    if (nameMatch) album.name = nameMatch[1];

    const descMatch = block.match(/description:\s*["']([^"']*)["']/);
    if (descMatch) album.description = descMatch[1];

    const locMatch = block.match(/location:\s*["']([^"']*)["']/);
    if (locMatch) album.location = locMatch[1];

    const dateMatch = block.match(/date:\s*["']([^"']*)["']/);
    if (dateMatch) album.date = dateMatch[1];

    const coverMatch = block.match(/cover:\s*["']([^"']*)["']/);
    if (coverMatch) album.cover = coverMatch[1];

    const tagsMatch = block.match(/tags:\s*\[([^\]]*)\]/);
    if (tagsMatch) {
      const tagsStr = tagsMatch[1];
      album.tags = tagsStr.split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean);
    } else {
      album.tags = [];
    }

    const pwMatch = block.match(/password:\s*["']([^"']*)["']/);
    if (pwMatch) album.password = pwMatch[1];

    const phMatch = block.match(/passwordHint:\s*["']([^"']*)["']/);
    if (phMatch) album.passwordHint = phMatch[1];

    // 扫描照片
    album.photos = scanAlbumPhotos(album.id);

    albums.push(album);
  }
  return albums;
}

/**
 * 扫描相册照片
 */
function scanAlbumPhotos(albumId) {
  const dir = path.join(DIRS.gallery, albumId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
    .sort();
  // urls.txt 中的远程照片
  const urlsFile = path.join(dir, 'urls.txt');
  let remotePhotos = [];
  if (fs.existsSync(urlsFile)) {
    remotePhotos = fs.readFileSync(urlsFile, 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  }
  return [...files, ...remotePhotos.map(u => `🌐 ${u.slice(0, 40)}...`)];
}

/**
 * 保存相册配置到 galleryConfig.ts
 */
function saveAlbumConfig(albums) {
  // 读取现有文件，找到 albums: [ 和最后一个 ], 之间的内容并替换
  let raw = fs.readFileSync(GALLERY_CONFIG_FILE, 'utf-8');

  const albumEntries = albums.map(a => {
    const lines = ['\t\t{'];
    lines.push(`\t\t\tid: "${a.id}",`);
    lines.push(`\t\t\tname: "${a.name}",`);
    if (a.description) lines.push(`\t\t\tdescription: "${a.description}",`);
    if (a.cover) lines.push(`\t\t\tcover: "${a.cover}",`);
    if (a.date) lines.push(`\t\t\tdate: "${a.date}",`);
    if (a.location) lines.push(`\t\t\tlocation: "${a.location}",`);
    if (a.tags && a.tags.length) {
      lines.push(`\t\t\ttags: [${a.tags.map(t => `"${t}"`).join(', ')}],`);
    }
    if (a.password) lines.push(`\t\t\tpassword: "${a.password}",`);
    if (a.passwordHint) lines.push(`\t\t\tpasswordHint: "${a.passwordHint}",`);
    lines.push('\t\t}');
    return lines.join('\n');
  }).join(',\n');

  // 替换 albums 数组内容
  const arrayStart = raw.indexOf('albums: [');
  const arrayEnd = raw.indexOf('];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) {
    fail('无法解析 galleryConfig.ts 中的 albums 数组');
    return false;
  }

  const before = raw.slice(0, arrayStart + 9); // 'albums: ['
  const after = raw.slice(arrayEnd);
  raw = before + '\n' + albumEntries + '\n\t' + after;

  fs.writeFileSync(GALLERY_CONFIG_FILE, raw, 'utf-8');
  return true;
}

/**
 * 获取相册照片数量
 */
function getAlbumPhotoCount(albumId) {
  const dir = path.join(DIRS.gallery, albumId);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f)).length;
}

// ===================== 主菜单 =====================
function menu() {
  stopClock();
  clear();

  const dynamicFiles = getDynamicFiles();
  const trash = getTrashFiles();
  const albums = readAlbumConfig();

  const pinnedCount = dynamicFiles.filter(f => {
    const { fm } = getFileMeta(path.join(DIRS.dynamic, f));
    return fm.pinned;
  }).length;

  console.log(`\n  ${bold('📸 AlbumFlow')}  相册 × 动态 融合管理  ${dim(nowStr())}`);
  console.log(`  ${dim(`${dynamicFiles.length} 条动态${pinnedCount ? ' · 📌' + pinnedCount + ' 置顶' : ''}${trash.length ? ' · ♻️ ' + trash.length : ''}  |  ${albums.length} 个相册`)}`);
  line();
  console.log(`  ${C}1${N}  💬 动态管理`);
  console.log(`  ${C}2${N}  📚 相册管理`);
  console.log(`  ${C}3${N}  🔗 融合操作（相册 → 动态）`);
  console.log(`  ${dim('──')}`);
  console.log(`  ${C}0${N}  退出  |  ${C}r${N}  刷新`);

  const clockRow = 1;
  clockTimer = setInterval(() => {
    readline.cursorTo(process.stdout, 0, clockRow);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`  ${bold('📸 AlbumFlow')}  相册 × 动态 融合管理  ${dim(nowStr())}`);
    readline.cursorTo(process.stdout, 0, 12);
  }, 1000);

  ask(`选一个功能`, (c) => {
    stopClock();
    const t = c.trim();
    if (t === '1') dynamicMenu();
    else if (t === '2') albumMenu();
    else if (t === '3') fusionMenu();
    else if (t === '0') { console.log(`\n  下次见~ 👋`); rl.close(); }
    else if (t === 'r') menu();
    else { console.log('  ?'); setTimeout(menu, 400); }
  });
}

// ===================== 动态管理子菜单 =====================
function dynamicMenu() {
  clear();
  const files = getDynamicFiles();
  const trash = getTrashFiles();

  console.log(`\n  ${bold('💬 动态管理')}  ${dim(files.length + ' 条动态' + (trash.length ? ' · ♻️ 回收站 ' + trash.length : ''))}`);
  line();
  console.log(`  ${C}1${N}  ✏️  写动态`);
  console.log(`  ${C}2${N}  📋 浏览`);
  console.log(`  ${C}3${N}  🔧 编辑`);
  console.log(`  ${C}4${N}  🗑️  删除`);
  console.log(`  ${C}5${N}  ♻️  回收站`);
  console.log(`  ${C}6${N}  🔍 搜索`);
  console.log(`  ${dim('──')}`);
  console.log(`  ${C}0${N}  返回主菜单`);

  ask(`选一个`, (c) => {
    const t = c.trim();
    if (t === '1') publishDynamic();
    else if (t === '2') browseDynamics();
    else if (t === '3') editDynamic();
    else if (t === '4') deleteDynamic();
    else if (t === '5') trashMenu();
    else if (t === '6') searchDynamic();
    else if (t === '0') menu();
    else { console.log('  ?'); setTimeout(dynamicMenu, 400); }
  });
}

// ===================== 写动态 =====================
function publishDynamic() {
  clear();
  console.log(`\n  ${bold('✏️ 写动态')}`);
  line();
  console.log(`  输入内容，一行一行写`);
  console.log(`  写完输入 ${bold('DONE')} 结束`);
  console.log(`  输入 ${bold('@album')} 可关联相册\n`);

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
  ask(`确认发布？(Y/n)`, (ok) => {
    if (ok.trim().toLowerCase() === 'n') { fail('取消'); setTimeout(dynamicMenu, 400); return; }
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
  ask(`日期 (回车 ${YYYY}-${MM}-${DD})`, (dateInput) => {
    let y = YYYY, mo = MM, d = DD;
    if (dateInput.trim()) {
      const p = dateInput.trim().split(/[-/]/);
      if (p.length === 3) { y = p[0]; mo = pad(parseInt(p[1])); d = pad(parseInt(p[2])); }
    }
    ask(`时间 (回车 ${hh}:${mm}:${ss})`, (timeInput) => {
      let hr = hh, mi = mm, se = ss;
      if (timeInput.trim()) {
        const p = timeInput.trim().split(':');
        if (p.length >= 2) { hr = pad(parseInt(p[0])); mi = pad(parseInt(p[1])); se = p.length >= 3 ? pad(parseInt(p[2])) : '00'; }
      }
      const dateStr = `${y}-${mo}-${d}`;
      const timeStr = `${dateStr}T${hr}:${mi}:${se}`;

      let maxSeq = 0;
      if (fs.existsSync(DIRS.dynamic)) {
        fs.readdirSync(DIRS.dynamic).forEach(f => {
          const m = f.match(new RegExp(`^${y}-${mo}-${d}-(\\d+)\\.md$`));
          if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        });
      }
      const seq = String(maxSeq + 1).padStart(6, '0');
      const filename = `${dateStr}-${seq}.md`;

      // Check if any line starts with @album
      const albumRefLines = lines.filter(l => l.trim().startsWith('@album '));
      const albumNames = albumRefLines.map(l => l.replace('@album', '').trim());

      askMeta(lines, timeStr, filename, albumNames);
    });
  });
}

function askMeta(lines, timeStr, filename, albumNames) {
  clear();
  console.log(`\n  ${bold('附加信息')}  ${dim(filename)}`);
  // 显示关联相册
  const albums = readAlbumConfig();
  if (albumNames.length) {
    const matched = albums.filter(a => albumNames.some(n => a.name.includes(n) || a.id.includes(n)));
    if (matched.length) {
      console.log(`  📚 关联相册: ${matched.map(a => a.name).join(', ')}`);
    }
  }
  line();
  ask(`位置 (可选)`, (loc) => {
    ask(`置顶？(y/N)`, (pin) => {
      const fm = {
        published: timeStr,
        pinned: pin.toLowerCase() === 'y',
        location: loc.trim() || ''
      };
      // 构建内容（保留 @album 标记作为元数据）
      let content = lines.join('\n');

      if (!fs.existsSync(DIRS.dynamic)) fs.mkdirSync(DIRS.dynamic, { recursive: true });
      writeFrontMatter(path.join(DIRS.dynamic, filename), fm, content);
      done(`已创建 ${filename}`);

      // 检查是否引用了相册，如果有，自动添加相册关联
      const matchedAlbums = albums.filter(a =>
        lines.some(l => l.includes(a.name) || l.includes(a.id))
      );
      if (matchedAlbums.length) {
        console.log(`  ${Y}💡 提示${N}: 动态引用了相册「${matchedAlbums.map(a => a.name).join('、')}」`);
        console.log(`  可在网站动态页看到相册关联卡片`);
      }

      deployDynamic(filename, `chore: add dynamic - ${filename}`, dynamicMenu);
    });
  });
}

// ===================== 浏览动态 =====================
function browseDynamics() {
  const files = getDynamicFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(dynamicMenu, 400); return; }
  paginateDynamic(files, DIRS.dynamic, showDynamicDetail, '📋 浏览动态');
}

function showDynamicDetail(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);
  const pin = fm.pinned ? ' 📌 置顶' : '';

  // 检查是否有关联相册
  const albums = readAlbumConfig();
  const relatedAlbums = albums.filter(a => content.includes(a.name) || content.includes(a.id));

  console.log(`\n  ${bold(filename)}${pin}`);
  line();
  console.log(`  ${fmtTime(fm.published)}  ${fm.location ? '📍 ' + fm.location : ''}`);
  if (relatedAlbums.length) {
    console.log(`  📚 关联相册: ${relatedAlbums.map(a => a.name).join(', ')}`);
  }
  line();
  console.log('');
  console.log(content);
  console.log('');
  line();
  ask(`回车返回`, () => backFn());
}

// ===================== 编辑动态 =====================
function editDynamic() {
  const files = getDynamicFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(dynamicMenu, 400); return; }
  paginateDynamic(files, DIRS.dynamic, editDynamicSelect, '🔧 编辑动态');
}

function editDynamicSelect(filename, dir, backFn) {
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
        ask(`确认？(Y/n)`, (ok) => {
          if (ok.trim().toLowerCase() === 'n') { fail('取消'); setTimeout(dynamicMenu, 400); return; }
          editDynamicMeta(filename, fp, final, fm, backFn);
        });
      } else {
        newLines.push(line);
        askLine();
      }
    });
  }
  askLine();
}

function editDynamicMeta(filename, fp, content, oldFm, backFn) {
  clear();
  console.log(`\n  ${bold('元数据')}`);
  line();
  console.log(`  当前: ${fmtTime(oldFm.published)}  📍 ${oldFm.location || '-'}  ${oldFm.pinned ? '📌 置顶' : ''}`);
  ask(`新时间 (回车不变)`, (t) => {
    const newTime = t.trim() || oldFm.published;
    ask(`新位置 (回车不变, -清空)`, (l) => {
      let newLoc = oldFm.location;
      if (l.trim() === '-') newLoc = '';
      else if (l.trim()) newLoc = l.trim();
      ask(`置顶？(y/N/回车不变)`, (p) => {
        let newPin = oldFm.pinned;
        if (p.trim().toLowerCase() === 'y') newPin = true;
        else if (p.trim().toLowerCase() === 'n') newPin = false;
        writeFrontMatter(fp, { published: newTime, location: newLoc, pinned: newPin }, content);
        done(`已更新 ${filename}`);
        deployDynamic(filename, `chore: update dynamic - ${filename}`, backFn);
      });
    });
  });
}

// ===================== 删除动态 =====================
function deleteDynamic() {
  const files = getDynamicFiles();
  if (!files.length) { fail('暂无动态'); setTimeout(dynamicMenu, 400); return; }
  paginateDynamic(files, DIRS.dynamic, confirmDeleteDynamic, '🗑️ 删除动态');
}

function confirmDeleteDynamic(filename, dir, backFn) {
  clear();
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log(`\n  ${bold('移到回收站: ' + filename)}`);
  line();
  console.log(`  ${fmtTime(fm.published)}`);
  line();
  console.log(`\n  ${content}\n`);
  line();

  ask(`确认删除？(y/N)`, (confirm) => {
    if (confirm.toLowerCase() !== 'y') { fail('取消'); setTimeout(backFn, 400); return; }
    if (!fs.existsSync(DIRS.trash)) fs.mkdirSync(DIRS.trash, { recursive: true });
    fs.renameSync(fp, path.join(DIRS.trash, filename));
    done('已移到回收站');
    deployDynamic(filename, `chore: delete dynamic - ${filename}`, backFn, true);
  });
}

// ===================== 回收站 =====================
function trashMenu() {
  const files = getTrashFiles();
  if (!files.length) { fail('回收站为空'); setTimeout(dynamicMenu, 400); return; }
  paginateDynamic(files, DIRS.trash, trashAction, '♻️ 回收站');
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
  ask(`选一个`, (c) => {
    if (c.trim() === '1') restoreFile(filename, fp, backFn);
    else if (c.trim() === '2') permanentlyDeleteFile(filename, fp, backFn);
    else backFn();
  });
}

function restoreFile(filename, src, backFn) {
  const dst = path.join(DIRS.dynamic, filename);
  if (fs.existsSync(dst)) { fail('目标已有同名文件'); setTimeout(backFn, 400); return; }
  fs.renameSync(src, dst);
  done(`已恢复 ${filename}`);
  ask(`推送恢复？(y/N)`, (push) => {
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

function permanentlyDeleteFile(filename, fp, backFn) {
  ask(`确认永久删除？不可恢复 (y/N)`, (c) => {
    if (c.toLowerCase() !== 'y') { fail('取消'); setTimeout(backFn, 400); return; }
    fs.unlinkSync(fp);
    done('已永久删除');
    ask(`推送删除？(y/N)`, (push) => {
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

// ===================== 搜索动态 =====================
function searchDynamic() {
  clear();
  console.log(`\n  ${bold('🔍 搜索')}`);
  line();
  ask(`关键词`, (kw) => {
    if (!kw.trim()) { fail('输入点啥'); setTimeout(searchDynamic, 400); return; }

    const files = getDynamicFiles();
    const results = [];
    for (const f of files) {
      const fp = path.join(DIRS.dynamic, f);
      const raw = fs.readFileSync(fp, 'utf-8');
      if (raw.toLowerCase().includes(kw.trim().toLowerCase())) {
        results.push({ filename: f, ...getFileMeta(fp) });
      }
    }

    clear();
    console.log(`\n  ${bold('搜索结果: ' + kw.trim())}`);
    line();
    if (!results.length) { fail('没找到'); setTimeout(dynamicMenu, 1000); return; }

    results.forEach((r, i) => {
      const pin = r.fm.pinned ? '📌 ' : '  ';
      const date = fmtTime(r.fm.published);
      const txt = preview(r.content, 70);
      console.log(`  ${pin}${C}${i + 1}${N}  ${bold(r.filename)}  ${dim(date)}`);
      console.log(`      ${txt}`);
    });
    ask(`编号查看详情，0 返回`, (input) => {
      const num = parseInt(input.trim(), 10);
      if (num > 0 && num <= results.length) showDynamicDetail(results[num - 1].filename, DIRS.dynamic, searchDynamic);
      else dynamicMenu();
    });
  });
}

// ===================== 动态分页 =====================
function paginateDynamic(files, dir, actionFn, title) {
  const pageSize = 8;
  const totalPages = Math.ceil(files.length / pageSize);
  let currentPage = 0;

  function showPage(page) {
    clear();
    const albums = readAlbumConfig();
    console.log(`\n  ${bold(title)}  ${dim(files.length + ' 条')}`);
    // 显示关联相册信息
    line();
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

      // 检测关联相册
      const related = albums.filter(a => content.includes(a.name) || content.includes(a.id));
      const albumTag = related.length ? ` ${C}📚${N}` : '';

      const txt = dim(preview(content));
      console.log(`  ${pin}${C}${num}${N}  ${bold(f)}${albumTag}`);
      console.log(`      ${date}${loc}`);
      if (txt) console.log(`      ${txt}`);
    }
    console.log('');
    const nav = [];
    if (page > 0) nav.push(`p 上一页`);
    if (page < totalPages - 1) nav.push(`n 下一页`);
    if (nav.length) console.log(`  ${dim(nav.join('  ·  '))}`);
    ask(`编号查看，0 返回`, (input) => {
      const t = input.trim();
      if (t === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') dynamicMenu();
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ?');
          setTimeout(() => showPage(page), 400);
        } else {
          actionFn(files[num - 1], dir, () => {
            const updated = dir === DIRS.trash ? getTrashFiles() : getDynamicFiles();
            if (updated.length === 0) dynamicMenu();
            else paginateDynamic(updated, dir, actionFn, title);
          });
        }
      }
    });
  }
  showPage(0);
}

// ===================== 部署动态 =====================
function deployDynamic(filename, commitMsg, cb, isDelete = false) {
  clear();
  console.log(`\n  ${bold('🚀 部署')}`);
  line();
  console.log(`  1  仅本地`);
  console.log(`  2  直接推送（推荐）`);
  console.log(`  3  本地构建 + 推送`);
  ask(`选一个 (默认 2)`, (choice) => {
    const c = choice.trim() || '2';
    if (c === '1') { done('已保存'); cb(); return; }

    try {
      if (isDelete) execSync(`git rm "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      else execSync(`git add "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      try {
        execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' });
      } catch (e) { /* no changes */ }
    } catch (e) { fail('git 操作有问题'); }

    if (c === '2') {
      console.log(`  推送中...`);
      try { execSync('git push', { cwd: __dirname, stdio: 'pipe' }); done('已推送，等自动部署'); }
      catch (e) { fail('推送失败，检查网络'); }
    } else if (c === '3') {
      console.log(`  构建中...`);
      try {
        execSync('pnpm build', { cwd: __dirname, stdio: 'pipe' });
        done('构建成功，推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('完成！');
      } catch (e) { fail('构建或推送失败'); }
    }
    cb();
  });
}

// ====================================================================
//  📚 相册管理
// ====================================================================
function albumMenu() {
  clear();
  const albums = readAlbumConfig();

  console.log(`\n  ${bold('📚 相册管理')}  ${dim(albums.length + ' 个相册')}`);
  line();
  console.log(`  ${C}1${N}  📁 新建相册`);
  console.log(`  ${C}2${N}  📋 浏览/查看`);
  console.log(`  ${C}3${N}  🔧 编辑相册信息`);
  console.log(`  ${C}4${N}  🖼️  照片管理`);
  console.log(`  ${C}5${N}  🗑️  删除相册`);
  console.log(`  ${C}6${N}  🔄 扫描照片（刷新）`);
  console.log(`  ${dim('──')}`);
  console.log(`  ${C}0${N}  返回主菜单`);

  ask(`选一个`, (c) => {
    const t = c.trim();
    if (t === '1') createAlbum();
    else if (t === '2') browseAlbums();
    else if (t === '3') editAlbum();
    else if (t === '4') photoManagement();
    else if (t === '5') deleteAlbum();
    else if (t === '6') refreshAlbums();
    else if (t === '0') menu();
    else { console.log('  ?'); setTimeout(albumMenu, 400); }
  });
}

// ---------- 新建相册 ----------
function createAlbum() {
  clear();
  console.log(`\n  ${bold('📁 新建相册')}`);
  line();
  ask(`相册 ID（英文/数字，用作URL和目录名，如 "japan-2026"）`, (id) => {
    if (!id.trim()) { fail('ID 不能为空'); setTimeout(createAlbum, 400); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
      fail('ID 只能包含字母、数字、下划线和连字符');
      setTimeout(createAlbum, 400);
      return;
    }
    const albums = readAlbumConfig();
    if (albums.find(a => a.id === id.trim())) {
      fail('该 ID 已存在');
      setTimeout(createAlbum, 400);
      return;
    }
    const albumId = id.trim();

    ask(`相册名称（如 "🌸 日本之旅"）`, (name) => {
      if (!name.trim()) { fail('名称不能为空'); setTimeout(createAlbum, 400); return; }

      ask(`相册描述（可选）`, (desc) => {
        ask(`拍摄日期（可选，格式 YYYY-MM-DD）`, (date) => {
          ask(`拍摄地点（可选）`, (location) => {
            ask(`标签（可选，逗号分隔，如 "旅行,风景"）`, (tagsStr) => {
              const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
              ask(`访问密码（可选，不填则公开）`, (password) => {
                let passwordHint = '';
                if (password.trim()) {
                  ask(`密码提示（可选）`, (hint) => { passwordHint = hint.trim(); finishCreate(albumId, name, desc, date, location, tags, password, passwordHint); });
                } else {
                  finishCreate(albumId, name, desc, date, location, tags, '', '');
                }
              });
            });
          });
        });
      });
    });
  });
}

function finishCreate(id, name, desc, date, location, tags, password, passwordHint) {
  const newAlbum = {
    id, name, description: desc || '', date: date || '', location: location || '',
    tags, password: password || '', passwordHint: passwordHint || '',
  };

  const albums = readAlbumConfig();
  albums.push(newAlbum);

  if (saveAlbumConfig(albums)) {
    // 创建照片目录
    const albumDir = path.join(DIRS.gallery, id);
    if (!fs.existsSync(albumDir)) {
      fs.mkdirSync(albumDir, { recursive: true });
    }
    done(`相册「${name}」已创建`);
    console.log(`  📂 照片目录: public/gallery/${id}/`);
    console.log(`  🔗 访问地址: /gallery/${id}/`);

    // 询问是否马上上传照片
    ask(`是否马上上传照片？(y/N)`, (upload) => {
      if (upload.toLowerCase() === 'y') {
        uploadPhotosToAlbum(id);
      } else {
        deployAlbumConfig(`chore: add album - ${id}`, albumMenu);
      }
    });
  } else {
    fail('保存失败');
    setTimeout(albumMenu, 1000);
  }
}

// ---------- 浏览相册 ----------
function browseAlbums() {
  clear();
  const albums = readAlbumConfig();

  if (!albums.length) {
    fail('暂无相册');
    setTimeout(albumMenu, 400);
    return;
  }

  console.log(`\n  ${bold('📋 相册列表')}  ${dim(albums.length + ' 个')}`);
  line();
  albums.forEach((a, i) => {
    const num = String(i + 1).padStart(2);
    const photos = scanAlbumPhotos(a.id);
    const pw = a.password ? ' 🔒' : '';
    console.log(`  ${C}${num}${N}  ${bold(a.name)}${pw}`);
    console.log(`      ${dim(a.date || '日期未设置')}  📍${a.location || '-'}  📸${photos.length}张`);
    if (a.tags && a.tags.length) console.log(`      🏷️ ${a.tags.join(', ')}`);
  });
  console.log('');
  ask(`编号查看详情，0 返回`, (input) => {
    const num = parseInt(input.trim(), 10);
    if (num > 0 && num <= albums.length) showAlbumDetail(albums[num - 1]);
    else albumMenu();
  });
}

function showAlbumDetail(album) {
  clear();
  const photos = scanAlbumPhotos(album.id);

  console.log(`\n  ${bold(`📖 ${album.name}`)}`);
  line();
  console.log(`  ID:       ${album.id}`);
  console.log(`  描述:     ${album.description || '-'}`);
  console.log(`  日期:     ${album.date || '-'}`);
  console.log(`  地点:     ${album.location || '-'}`);
  console.log(`  标签:     ${album.tags && album.tags.length ? album.tags.join(', ') : '-'}`);
  console.log(`  密码:     ${album.password ? '🔒 ' + album.password : '无'}`);
  console.log(`  照片:     ${photos.length} 张`);
  console.log(`  目录:     public/gallery/${album.id}/`);
  console.log(`  访问:     /gallery/${album.id}/`);
  if (photos.length) {
    console.log('');
    line();
    console.log(`  📸 照片列表:`);
    photos.slice(0, 20).forEach((p, i) => {
      console.log(`    ${C}${String(i + 1).padStart(2)}${N}  ${p}`);
    });
    if (photos.length > 20) console.log(`    ${dim(`...还有 ${photos.length - 20} 张`)}`);
  }
  console.log('');
  line();
  console.log(`  1  编辑信息   2  照片管理   3  删除`);
  ask(`选一个，0 返回`, (c) => {
    const t = c.trim();
    if (t === '1') editAlbumById(album.id);
    else if (t === '2') photoManagementForAlbum(album.id);
    else if (t === '3') confirmDeleteAlbumById(album.id);
    else albumMenu();
  });
}

// ---------- 编辑相册 ----------
function editAlbum() {
  const albums = readAlbumConfig();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }

  clear();
  console.log(`\n  ${bold('🔧 编辑相册')}`);
  line();
  albums.forEach((a, i) => {
    console.log(`  ${C}${i + 1}${N}  ${bold(a.name)}  ${dim(a.id)}`);
  });
  console.log('');
  ask(`选择要编辑的相册，0 返回`, (input) => {
    const num = parseInt(input.trim(), 10);
    if (num > 0 && num <= albums.length) editAlbumById(albums[num - 1].id);
    else albumMenu();
  });
}

function editAlbumById(albumId) {
  const albums = readAlbumConfig();
  const album = albums.find(a => a.id === albumId);
  if (!album) { fail('未找到相册'); setTimeout(albumMenu, 400); return; }

  clear();
  console.log(`\n  ${bold(`🔧 编辑: ${album.name}`)}`);
  line();

  ask(`名称 (回车: ${album.name})`, (name) => {
    const newName = name.trim() || album.name;

    ask(`描述 (回车: ${album.description || '-'}, -清空)`, (desc) => {
      let newDesc = album.description;
      if (desc.trim() === '-') newDesc = '';
      else if (desc.trim()) newDesc = desc.trim();

      ask(`日期 (回车: ${album.date || '-'})`, (date) => {
        const newDate = date.trim() || album.date;

        ask(`地点 (回车: ${album.location || '-'}, -清空)`, (loc) => {
          let newLoc = album.location;
          if (loc.trim() === '-') newLoc = '';
          else if (loc.trim()) newLoc = loc.trim();

          ask(`标签 (回车: ${(album.tags || []).join(', ') || '-'})`, (tagsStr) => {
            const newTags = tagsStr.trim() ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : album.tags;

            // 更新
            album.name = newName;
            album.description = newDesc;
            album.date = newDate;
            album.location = newLoc;
            album.tags = newTags;

            if (saveAlbumConfig(albums)) {
              done(`相册「${newName}」已更新`);
              deployAlbumConfig(`chore: update album - ${albumId}`, albumMenu);
            } else {
              fail('保存失败');
              setTimeout(albumMenu, 1000);
            }
          });
        });
      });
    });
  });
}

// ---------- 删除相册 ----------
function deleteAlbum() {
  const albums = readAlbumConfig();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }

  clear();
  console.log(`\n  ${bold('🗑️ 删除相册')}`);
  line();
  albums.forEach((a, i) => {
    console.log(`  ${C}${i + 1}${N}  ${bold(a.name)}  ${dim(a.id)}  📸${getAlbumPhotoCount(a.id)}张`);
  });
  console.log('');
  ask(`选择要删除的相册，0 返回`, (input) => {
    const num = parseInt(input.trim(), 10);
    if (num > 0 && num <= albums.length) confirmDeleteAlbumById(albums[num - 1].id);
    else albumMenu();
  });
}

function confirmDeleteAlbumById(albumId) {
  const albums = readAlbumConfig();
  const album = albums.find(a => a.id === albumId);
  if (!album) { fail('未找到'); setTimeout(albumMenu, 400); return; }

  clear();
  console.log(`\n  ${bold(`🗑️ 删除相册: ${album.name}`)}`);
  line();
  console.log(`  ID: ${album.id}`);
  const photoCount = getAlbumPhotoCount(albumId);
  if (photoCount > 0) console.log(`  ${Y}⚠ 该相册有 ${photoCount} 张照片${N}`);
  console.log(`  配置文件中的条目将被移除`);
  ask(`确认删除？(y/N)`, (confirm) => {
    if (confirm.toLowerCase() !== 'y') { fail('取消'); setTimeout(albumMenu, 400); return; }

    ask(`是否同时删除照片目录？(y/N)`, (delPhotos) => {
      const newAlbums = albums.filter(a => a.id !== albumId);
      if (saveAlbumConfig(newAlbums)) {
        done(`相册「${album.name}」已从配置中移除`);

        if (delPhotos.toLowerCase() === 'y') {
          const albumDir = path.join(DIRS.gallery, albumId);
          if (fs.existsSync(albumDir)) {
            fs.rmSync(albumDir, { recursive: true, force: true });
            done(`照片目录已删除`);
          }
        }

        deployAlbumConfig(`chore: delete album - ${albumId}`, albumMenu);
      } else {
        fail('删除失败');
        setTimeout(albumMenu, 1000);
      }
    });
  });
}

// ---------- 照片管理 ----------
function photoManagement() {
  const albums = readAlbumConfig();
  if (!albums.length) { fail('暂无相册'); setTimeout(albumMenu, 400); return; }

  clear();
  console.log(`\n  ${bold('🖼️ 照片管理')}`);
  line();
  albums.forEach((a, i) => {
    const cnt = getAlbumPhotoCount(a.id);
    console.log(`  ${C}${i + 1}${N}  ${bold(a.name)}  ${dim(cnt + ' 张照片 · ' + a.id)}`);
  });
  console.log('');
  ask(`选择相册，0 返回`, (input) => {
    const num = parseInt(input.trim(), 10);
    if (num > 0 && num <= albums.length) photoManagementForAlbum(albums[num - 1].id);
    else albumMenu();
  });
}

function photoManagementForAlbum(albumId) {
  const albums = readAlbumConfig();
  const album = albums.find(a => a.id === albumId);
  if (!album) { fail('未找到'); setTimeout(albumMenu, 400); return; }

  const showPhotos = () => {
    const photos = scanAlbumPhotos(albumId);
    clear();
    console.log(`\n  ${bold(`🖼️ ${album.name} — 照片管理`)}  ${dim(photos.length + ' 张')}`);
    line();

    if (photos.length) {
      photos.slice(0, 30).forEach((p, i) => {
        console.log(`  ${C}${String(i + 1).padStart(2)}${N}  ${p}`);
      });
      if (photos.length > 30) console.log(`  ${dim(`...还有 ${photos.length - 30} 张`)}`);
      console.log('');
    } else {
      console.log(`  ${dim('暂无照片')}\n`);
    }

    console.log(`  1  上传照片（复制到目录）`);
    console.log(`  2  添加远程图片 URL`);
    console.log(`  3  删除照片`);
    console.log(`  4  打开照片目录`);
    console.log(`  0  返回相册管理`);

    ask(`选一个`, (c) => {
      const t = c.trim();
      if (t === '1') uploadPhotosToAlbum(albumId, showPhotos);
      else if (t === '2') addRemotePhotos(albumId, showPhotos);
      else if (t === '3') deletePhotoFromAlbum(albumId, showPhotos);
      else if (t === '4') {
        const dir = path.join(DIRS.gallery, albumId);
        console.log(`  📂 ${dir}`);
        try {
          execSync(`start "" "${dir}"`, { stdio: 'pipe' });
        } catch(e) { /* ignore */ }
        setTimeout(showPhotos, 500);
      }
      else albumMenu();
    });
  };
  showPhotos();
}

function uploadPhotosToAlbum(albumId, backFn) {
  const albumDir = path.join(DIRS.gallery, albumId);
  if (!fs.existsSync(albumDir)) fs.mkdirSync(albumDir, { recursive: true });

  clear();
  console.log(`\n  ${bold('📤 上传照片')}`);
  line();
  console.log(`  将照片文件复制到: ${dim(albumDir)}`);
  console.log(`  支持格式: jpg/png/webp/avif/gif`);
  console.log(`  文件名建议: 排序会按字母顺序`);
  console.log(`  封面自动取 cover.* 或第一张`);
  console.log(`  提示: 可以直接把文件拖到资源管理器窗口`);

  // 尝试打开目录
  try {
    execSync(`start "" "${albumDir}"`, { stdio: 'pipe' });
  } catch(e) { /* ignore */ }

  ask(`\n复制完照片后按回车确认`, () => {
    const count = getAlbumPhotoCount(albumId);
    done(`相册现在有 ${count} 张照片`);
    if (backFn) backFn();
    else {
      deployAlbumConfig(`chore: update photos - ${albumId}`, albumMenu);
    }
  });
}

function addRemotePhotos(albumId, backFn) {
  const albumDir = path.join(DIRS.gallery, albumId);
  if (!fs.existsSync(albumDir)) fs.mkdirSync(albumDir, { recursive: true });

  clear();
  console.log(`\n  ${bold('🌐 添加远程图片 URL')}`);
  line();
  console.log(`  每行一个 URL，空行结束`);
  console.log(`  这些 URL 会保存在 urls.txt 中`);

  const urls = [];
  function askUrl() {
    ask('', (url) => {
      if (!url.trim()) {
        if (!urls.length) { fail('没有URL'); setTimeout(() => backFn(), 400); return; }

        const urlsFile = path.join(albumDir, 'urls.txt');
        const existing = fs.existsSync(urlsFile) ? fs.readFileSync(urlsFile, 'utf-8') : '';
        fs.writeFileSync(urlsFile, existing + urls.join('\n') + '\n', 'utf-8');
        done(`已添加 ${urls.length} 个远程图片`);
        if (backFn) backFn();
        return;
      }
      urls.push(url.trim());
      askUrl();
    });
  }
  askUrl();
}

function deletePhotoFromAlbum(albumId, backFn) {
  const albumDir = path.join(DIRS.gallery, albumId);
  const files = fs.existsSync(albumDir)
    ? fs.readdirSync(albumDir).filter(f => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
    : [];

  if (!files.length) { fail('没有本地照片可删除'); setTimeout(backFn, 400); return; }

  clear();
  console.log(`\n  ${bold('🗑️ 删除照片')}`);
  line();
  files.forEach((f, i) => {
    console.log(`  ${C}${i + 1}${N}  ${f}`);
  });
  console.log(`  ${C}d${N}  删除 urls.txt 中的远程引用`);
  console.log('');
  ask(`编号删除，0 返回`, (input) => {
    const t = input.trim();
    if (t === 'd') {
      const urlsFile = path.join(albumDir, 'urls.txt');
      if (fs.existsSync(urlsFile)) {
        fs.unlinkSync(urlsFile);
        done('已删除 urls.txt');
      } else {
        fail('没有 urls.txt');
      }
      setTimeout(backFn, 400);
      return;
    }
    const num = parseInt(t, 10);
    if (num > 0 && num <= files.length) {
      const filePath = path.join(albumDir, files[num - 1]);
      fs.unlinkSync(filePath);
      done(`已删除 ${files[num - 1]}`);
      deployAlbumConfig(`chore: delete photo - ${albumId}`, () => deletePhotoFromAlbum(albumId, backFn));
    } else {
      backFn();
    }
  });
}

// ---------- 刷新扫描 ----------
function refreshAlbums() {
  const albums = readAlbumConfig();
  clear();
  console.log(`\n  ${bold('🔄 扫描照片')}`);
  line();
  albums.forEach(a => {
    const cnt = getAlbumPhotoCount(a.id);
    console.log(`  ${bold(a.name)}  ${dim(cnt + ' 张照片 · ' + a.id)}`);
  });
  done('扫描完成，数据已同步');
  setTimeout(albumMenu, 1000);
}

// ---------- 部署相册 ----------
function deployAlbumConfig(commitMsg, cb) {
  clear();
  console.log(`\n  ${bold('🚀 部署相册更改')}`);
  line();
  console.log(`  1  仅本地`);
  console.log(`  2  直接推送（推荐）`);
  console.log(`  3  本地构建 + 推送`);
  ask(`选一个 (默认 2)`, (choice) => {
    const c = choice.trim() || '2';
    if (c === '1') { done('已保存'); cb(); return; }

    try {
      execSync(`git add "src/config/galleryConfig.ts"`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git add "public/gallery/"`, { cwd: __dirname, stdio: 'pipe' });
      try { execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' }); } catch(e) {}
    } catch (e) { fail('git 操作有问题'); }

    if (c === '2') {
      console.log(`  推送中...`);
      try { execSync('git push', { cwd: __dirname, stdio: 'pipe' }); done('已推送'); }
      catch (e) { fail('推送失败'); }
    } else {
      console.log(`  构建中...`);
      try {
        execSync('pnpm build', { cwd: __dirname, stdio: 'pipe' });
        done('构建成功，推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('完成！');
      } catch (e) { fail('失败'); }
    }
    cb();
  });
}

// ====================================================================
//  🔗 融合操作（相册→动态）
// ====================================================================
function fusionMenu() {
  clear();
  const albums = readAlbumConfig();
  const dynamics = getDynamicFiles();

  console.log(`\n  ${bold('🔗 融合操作')}  相册 → 动态`);
  line();
  console.log(`  1  从相册生成动态（分享相册）`);
  console.log(`  2  查看关联了相册的动态`);
  console.log(`  3  查看所有关联关系`);
  console.log(`  ${dim('──')}`);
  console.log(`  0  返回主菜单`);

  ask(`选一个`, (c) => {
    const t = c.trim();
    if (t === '1') createDynamicFromAlbum();
    else if (t === '2') browseRelatedDynamics();
    else if (t === '3') showRelationMap();
    else if (t === '0') menu();
    else { console.log('  ?'); setTimeout(fusionMenu, 400); }
  });
}

function createDynamicFromAlbum() {
  const albums = readAlbumConfig();
  if (!albums.length) { fail('暂无相册'); setTimeout(fusionMenu, 400); return; }

  clear();
  console.log(`\n  ${bold('📢 从相册生成动态')}`);
  line();
  albums.forEach((a, i) => {
    const cnt = getAlbumPhotoCount(a.id);
    console.log(`  ${C}${i + 1}${N}  ${bold(a.name)}  ${dim(cnt + ' 张 · ' + (a.description ? preview(a.description, 40) : ''))}`);
  });
  console.log('');
  ask(`选择相册，0 返回`, (input) => {
    const num = parseInt(input.trim(), 10);
    if (num > 0 && num <= albums.length) {
      const album = albums[num - 1];
      const cnt = getAlbumPhotoCount(album.id);

      clear();
      console.log(`\n  ${bold('📢 分享相册: ' + album.name)}`);
      line();
      console.log(`  将生成一条动态，内容预览:`);
      console.log(`  ${dim(`分享相册「${album.name}」`)}`);
      if (album.description) console.log(`  ${dim(album.description)}`);
      console.log(`  ${dim(`${cnt} 张照片`)}`);
      console.log('');
      ask(`确认生成？(Y/n)`, (ok) => {
        if (ok.trim().toLowerCase() === 'n') { fail('取消'); setTimeout(fusionMenu, 400); return; }

        const now = new Date();
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
        const timeStr = `${dateStr}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const filename = `${dateStr}-${String(getDynamicFiles().length + 1).padStart(6, '0')}.md`;
        const content = `分享相册「${album.name}」${album.description ? '— ' + album.description : ''}\n\n📸 共 ${cnt} 张照片\n🔗 /gallery/${album.id}/`;

        const fm = { published: timeStr, pinned: false, location: album.location || '' };

        if (!fs.existsSync(DIRS.dynamic)) fs.mkdirSync(DIRS.dynamic, { recursive: true });
        writeFrontMatter(path.join(DIRS.dynamic, filename), fm, content);
        done(`动态已创建: ${filename}`);
        console.log(`  📚 关联相册: ${album.name}`);
        console.log(`  📎 访问链接: /gallery/${album.id}/`);

        deployDynamic(filename, `chore: add dynamic from album - ${album.id}`, fusionMenu);
      });
    } else {
      fusionMenu();
    }
  });
}

function browseRelatedDynamics() {
  clear();
  const albums = readAlbumConfig();
  const files = getDynamicFiles();
  const related = [];

  files.forEach(f => {
    const fp = path.join(DIRS.dynamic, f);
    const { fm, content } = getFileMeta(fp);
    const matched = albums.filter(a => content.includes(a.name) || content.includes(a.id) || content.includes(a.location || ''));
    if (matched.length) {
      related.push({ filename: f, fm, content, albums: matched });
    }
  });

  if (!related.length) {
    fail('没有关联了相册的动态');
    setTimeout(fusionMenu, 1000);
    return;
  }

  console.log(`\n  ${bold('🔗 关联动态')}  ${dim(related.length + ' 条')}`);
  line();
  related.forEach((r, i) => {
    const num = String(i + 1).padStart(2);
    const date = fmtTime(r.fm.published);
    const txt = preview(r.content, 50);
    const albumNames = r.albums.map(a => a.name).join(', ');
    console.log(`  ${C}${num}${N}  ${bold(r.filename)}  ${dim(date)}`);
    console.log(`      📚 ${albumNames}`);
    console.log(`      ${txt}`);
  });
  console.log('');
  ask(`回车返回`, () => fusionMenu());
}

function showRelationMap() {
  clear();
  const albums = readAlbumConfig();
  const files = getDynamicFiles();

  console.log(`\n  ${bold('🗺️ 关联关系图')}`);
  line();

  albums.forEach(a => {
    const cnt = getAlbumPhotoCount(a.id);
    const relatedDynamics = files.filter(f => {
      const fp = path.join(DIRS.dynamic, f);
      const raw = fs.readFileSync(fp, 'utf-8');
      return raw.includes(a.name) || raw.includes(a.id);
    });
    console.log(`  📚 ${bold(a.name)}  ${dim(`(${cnt}张)`)}`);
    if (relatedDynamics.length) {
      relatedDynamics.forEach(f => {
        console.log(`    └─ 💬 ${dim(f)}`);
      });
    } else {
      console.log(`    ${dim('(未关联任何动态)')}`);
    }
    console.log('');
  });

  const totalDynamic = files.length;
  const relatedCount = files.filter(f => {
    const raw = fs.readFileSync(path.join(DIRS.dynamic, f), 'utf-8');
    return albums.some(a => raw.includes(a.name) || raw.includes(a.id));
  }).length;
  console.log(`  ${dim(`共 ${albums.length} 个相册，${totalDynamic} 条动态，${relatedCount} 条有关联`)}`);
  console.log('');
  ask(`回车返回`, () => fusionMenu());
}

// ====================================================================
//  启动
// ====================================================================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// 确保目录存在
if (!fs.existsSync(DIRS.dynamic)) fs.mkdirSync(DIRS.dynamic, { recursive: true });
if (!fs.existsSync(DIRS.trash)) fs.mkdirSync(DIRS.trash, { recursive: true });
if (!fs.existsSync(DIRS.gallery)) fs.mkdirSync(DIRS.gallery, { recursive: true });

console.clear();
console.log(`\n  ${bold('📸 AlbumFlow')}  相册 × 动态 融合管理系统`);
console.log(`  ${dim('博客: Firefly (Astro)')}`);
console.log(`  ${dim('按 Ctrl+C 随时退出')}`);
line();
ask(`回车开始`, () => menu());