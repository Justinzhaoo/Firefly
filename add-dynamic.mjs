import readline from 'readline';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dynamicDir = path.join(__dirname, 'src/content/dynamic');
const trashDir = path.join(dynamicDir, '.trash');
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

/* ─── 加密 ─── */

const CONFIG_FILE = path.join(__dirname, '.dynamic-key');

function loadKey() {
  try {
    return fs.readFileSync(CONFIG_FILE, 'utf-8').trim();
  } catch { return ''; }
}

function saveKey(k) {
  fs.writeFileSync(CONFIG_FILE, k, 'utf-8');
}

function isEncrypted() {
  return !!loadKey();
}

function encryptText(text, password) {
  const key = crypto.scryptSync(password, 'firefly-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + enc;
}

function decryptText(encrypted, password) {
  const parts = encrypted.split(':');
  if (parts.length !== 3) return null;
  const key = crypto.scryptSync(password, 'firefly-salt', 32);
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(parts[2], 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return null; }
}

function encryptFile(filePath, password) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  fs.writeFileSync(filePath, encryptText(raw, password), 'utf-8');
}

function decryptFile(filePath, password) {
  const enc = fs.readFileSync(filePath, 'utf-8');
  const dec = decryptText(enc, password);
  if (dec === null) return false;
  fs.writeFileSync(filePath, dec, 'utf-8');
  return true;
}

// 加密某个目录下所有 .md 文件（返回备份 map，用于还原）
function encryptAllMd(dir, password) {
  if (!fs.existsSync(dir) || !password) return null;
  const backup = new Map();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const fp = path.join(dir, f);
    backup.set(f, fs.readFileSync(fp, 'utf-8'));
    encryptFile(fp, password);
  }
  return backup;
}

// 从备份还原 .md 文件
function restoreAllMd(dir, backup) {
  if (!backup) return;
  for (const [f, content] of backup) {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) fs.writeFileSync(fp, content, 'utf-8');
  }
}

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
  const enc = isEncrypted();

  console.log(`\n  ${bold('Firefly')} 动态管理  ${dim(nowStr())}`);
  console.log(`  ${dim(files.length + ' 条动态' + (pinned ? ' · ' + pinned + ' 条置顶' : '') + (trash.length ? ' · ♻️ ' + trash.length : ''))}${enc ? G + ' · 🔒 已加密' : ''}${N}`);
  line();

  const opts = [
    ['1', '写动态'],
    ['2', '浏览'],
    ['3', '编辑'],
    ['4', '删除'],
    ['5', '回收站'],
    ['6', '搜索'],
  ];
  opts.forEach(([k, v]) => console.log(`  ${C}${k}${N}  ${v}`));
  console.log('');
  console.log(`  ${G}7${N}  加密设置  ${dim(enc ? '🔒 已开启' : '🔓 未加密')}`);
  console.log(`  ${G}0${N}  退出`);
  console.log(`  ${G}r${N}  刷新`);

  const clockRow = 1;
  clockTimer = setInterval(() => {
    readline.cursorTo(process.stdout, 0, clockRow);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`  ${bold('Firefly')} 动态管理  ${dim(nowStr())}`);
    readline.cursorTo(process.stdout, 0, 16);
  }, 1000);

  ask(`\n  选一个 `, (c) => {
    stopClock();
    const t = c.trim();
    const act = {
      '1': publish, '2': browse, '3': edit, '4': del,
      '5': trashMenu, '6': search, '7': encSettings,
      '0': () => { console.log('\n  拜拜~'); rl.close(); },
      'r': menu
    };
    (act[t] || (() => { console.log('  ?'); setTimeout(menu, 400); }))();
  });
}

/* ─── 加密设置 ─── */

function encSettings() {
  clear();
  const hasKey = isEncrypted();
  console.log(`\n  ${bold('加密设置')}`);
  line();
  if (hasKey) {
    console.log(`  当前: 🔒 已加密`);
    console.log('  1  关闭加密（解密所有文件）');
    console.log('  2  修改密码');
  } else {
    console.log(`  当前: 🔓 未加密`);
    console.log('  1  开启加密（设置密码）');
  }
  console.log('  0  返回');
  ask(`\n  选一个 `, (c) => {
    const t = c.trim();
    if (t === '0') { menu(); return; }
    if (!hasKey && t === '1') setNewKey();
    else if (hasKey && t === '1') disableEnc();
    else if (hasKey && t === '2') changeKey();
    else { console.log('  ?'); setTimeout(encSettings, 400); }
  });
}

function setNewKey() {
  ask(`  设置密码（不能为空）`, (pw) => {
    if (!pw.trim()) { fail('密码不能为空'); setTimeout(encSettings, 400); return; }
    ask(`  再次输入`, (pw2) => {
      if (pw !== pw2) { fail('两次不一致'); setTimeout(encSettings, 400); return; }
      saveKey(pw);

      // 加密所有现有文件
      const dynBak = encryptAllMd(dynamicDir, pw);
      const trashBak = encryptAllMd(trashDir, pw);
      // 立即解密回来（本地用 plaintext，git 推的时候才加密）
      restoreAllMd(dynamicDir, dynBak);
      restoreAllMd(trashDir, trashBak);

      done('已开启加密');
      // 把当前加密状态推一次
      ask(`  推送加密文件？(Y/n)`, (push) => {
        if (push.toLowerCase() !== 'n') {
          encryptAndPush(pw, () => menu());
        } else { menu(); }
      });
    });
  });
}

function disableEnc() {
  const pw = loadKey();
  // 用密码解密所有文件，然后删掉 key
  const dynBak = encryptAllMd(dynamicDir, pw);
  const trashBak = encryptAllMd(trashDir, pw);
  // 解密回来 = 用密码解密加密的内容
  if (dynBak) {
    for (const [f] of dynBak) {
      const fp = path.join(dynamicDir, f);
      if (fs.existsSync(fp)) decryptFile(fp, pw);
    }
  }
  if (trashBak) {
    for (const [f] of trashBak) {
      const fp = path.join(trashDir, f);
      if (fs.existsSync(fp)) decryptFile(fp, pw);
    }
  }

  try { fs.unlinkSync(CONFIG_FILE); } catch {}
  // 重新 push（不加密版本）
  done('已关闭加密');
  ask(`  推送解密文件？(Y/n)`, (push) => {
    if (push.toLowerCase() !== 'n') {
      try {
        execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
        execSync('git commit -m "chore: disable encryption"', { cwd: __dirname, stdio: 'pipe' });
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('已推送');
      } catch (e) { fail('推送失败'); }
    }
    menu();
  });
}

function changeKey() {
  const oldPw = loadKey();
  ask(`  当前密码`, (oldInput) => {
    if (oldInput !== oldPw) { fail('密码错误'); setTimeout(encSettings, 400); return; }
    ask(`  新密码`, (pw) => {
      if (!pw.trim()) { fail('不能为空'); setTimeout(encSettings, 400); return; }
      ask(`  再次输入`, (pw2) => {
        if (pw !== pw2) { fail('两次不一致'); setTimeout(encSettings, 400); return; }

        // 先用旧密码解密所有文件，再用新密码加密
        const files = [...getFiles().map(f => path.join(dynamicDir, f)), ...getTrashFiles().map(f => path.join(trashDir, f))];
        for (const fp of files) {
          if (fs.existsSync(fp)) {
            const enc = fs.readFileSync(fp, 'utf-8');
            const dec = decryptText(enc, oldPw);
            if (dec !== null) fs.writeFileSync(fp, dec, 'utf-8');
          }
        }
        // 现在是明文，用新密码加密备份（用于推送），再解密回来
        saveKey(pw);
        const dynBak = encryptAllMd(dynamicDir, pw);
        const trashBak = encryptAllMd(trashDir, pw);
        restoreAllMd(dynamicDir, dynBak);
        restoreAllMd(trashDir, trashBak);

        done('密码已修改');
        ask(`  推送更新？(Y/n)`, (push) => {
          if (push.toLowerCase() !== 'n') {
            encryptAndPush(pw, () => menu());
          } else { menu(); }
        });
      });
    });
  });
}

/* ─── 加密推送 ─── */

function encryptAndPush(password, cb) {
  console.log(`\n  🔒 加密文件...`);
  const dynBak = encryptAllMd(dynamicDir, password);
  const trashBak = encryptAllMd(trashDir, password);

  try {
    execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
    execSync('git commit -m "chore: encrypted update"', { cwd: __dirname, stdio: 'pipe' });
    console.log(`  📤 推送中...`);
    execSync('git push', { cwd: __dirname, stdio: 'pipe' });
    done('推送成功（GitHub 上文件已加密）');
  } catch (e) {
    fail('git 操作出问题，文件已解密回来');
  }

  // 不管成功失败，都解密回来
  restoreAllMd(dynamicDir, dynBak);
  restoreAllMd(trashDir, trashBak);
  console.log(`  🔓 本地文件已解密`);
  cb();
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

    const pw = loadKey();

    // 如果有加密，先加密所有文件
    let dynBak = null, trashBak = null;
    if (pw) {
      dynBak = encryptAllMd(dynamicDir, pw);
      trashBak = encryptAllMd(trashDir, pw);
    }

    try {
      if (isDelete) execSync(`git rm "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      else execSync(`git add "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
      execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' });
    } catch (e) { fail('git 提交有问题'); }

    if (c === '2') {
      console.log(`  推送中...`);
      try { execSync('git push', { cwd: __dirname, stdio: 'pipe' }); done('已推送'); }
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

    // 解密回来
    if (pw) {
      restoreAllMd(dynamicDir, dynBak);
      restoreAllMd(trashDir, trashBak);
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
      const pw = loadKey();
      let dynBak = null;
      if (pw) dynBak = encryptAllMd(dynamicDir, pw);
      try {
        execSync(`git add "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
        execSync(`git commit -m "chore: restore dynamic - ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
        execSync('git push', { cwd: __dirname, stdio: 'pipe' });
        done('已推送');
      } catch (e) { fail('推送失败'); }
      if (pw) restoreAllMd(dynamicDir, dynBak);
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
        const pw = loadKey();
        let dynBak = null, trashBak = null;
        if (pw) { dynBak = encryptAllMd(dynamicDir, pw); trashBak = encryptAllMd(trashDir, pw); }
        try {
          execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
          execSync(`git commit -m "chore: permanently delete ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
          execSync('git push', { cwd: __dirname, stdio: 'pipe' });
          done('已推送');
        } catch (e) { fail('推送失败'); }
        if (pw) { restoreAllMd(dynamicDir, dynBak); restoreAllMd(trashDir, trashBak); }
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

/* ─── 启动 ─── */

if (!fs.existsSync(dynamicDir)) fs.mkdirSync(dynamicDir, { recursive: true });
if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

menu();