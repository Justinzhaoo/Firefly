import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dynamicDir = path.join(__dirname, 'src/content/dynamic');
const trashDir = path.join(dynamicDir, '.trash');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const Y = now.getFullYear();
const M = pad(now.getMonth() + 1);
const D = pad(now.getDate());
const h = pad(now.getHours());
const m = pad(now.getMinutes());
const s = pad(now.getSeconds());

/* ───────── 工具函数 ───────── */

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
  return fs.readdirSync(dynamicDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
}

function getTrashFiles() {
  if (!fs.existsSync(trashDir)) return [];
  return fs.readdirSync(trashDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
}

function getFileMeta(filePath) {
  const data = readFrontMatter(filePath);
  if (!data) return { fm: { published: '', pinned: false, location: '' }, content: '', raw: '' };
  return data;
}

function previewText(text, max = 45) {
  const t = text.trim().replace(/\n/g, ' ');
  return t.length > max ? t.slice(0, max) + '...' : t;
}

function listFiles(files, page, pageSize, sourceDir) {
  const dir = sourceDir || dynamicDir;
  const start = page * pageSize;
  const end = Math.min(start + pageSize, files.length);
  for (let i = start; i < end; i++) {
    const f = files[i];
    const fp = path.join(dir, f);
    const { fm, content } = getFileMeta(fp);
    const pin = fm.pinned ? ' 📌' : '   ';
    const date = (fm.published || '').replace('T', ' ');
    console.log(`  ${pin} ${(i + 1).toString().padStart(3)}. ${f}`);
    console.log(`      🕐 ${date}  ${fm.location ? '📍 ' + fm.location : ''}`);
    console.log(`      💬 ${previewText(content)}`);
  }
}

/* ───────── 部署选项 ───────── */

function doGitOps(files, commitMsg, callback) {
  console.log('');
  console.log('  ── 部署选项 ──');
  console.log('    1️⃣  仅保存到本地（不构建不推送）');
  console.log('    2️⃣  直接推送（Vercel 自动构建，速度快）');
  console.log('    3️⃣  本地构建 + 推送（最完整，较慢）');
  console.log('');
  rl.question('  请选择 (1/2/3，回车默认 2）: ', (choice) => {
    const c = choice.trim() || '2';
    if (c === '1') {
      console.log(`  💡 已保存到本地`);
      callback();
      return;
    }

    for (const f of files) {
      execSync(`git add "src/content/dynamic/${path.basename(f)}"`, { cwd: __dirname, stdio: 'pipe' });
    }
    execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' });

    if (c === '2') {
      console.log('  ⏳ 直接推送（Vercel 自动构建）...');
      execSync('git push', { cwd: __dirname, stdio: 'inherit' });
      console.log('');
      console.log('  ✨ 推送成功！Vercel 自动部署中~');
      console.log('  等 1-2 分钟刷新网站即可看到更新');
    } else {
      console.log('  ⏳ 本地构建中...');
      execSync('pnpm build', { cwd: __dirname, stdio: 'inherit' });
      console.log('  ⏳ 推送中...');
      execSync('git push', { cwd: __dirname, stdio: 'inherit' });
      console.log('  ✨ 完成！Vercel 自动部署中~');
    }
    callback();
  });
}

function doGitOpsDelete(filename, commitMsg, callback) {
  console.log('');
  console.log('  ── 部署选项 ──');
  console.log('    1️⃣  仅删除本地（不推送）');
  console.log('    2️⃣  直接推送删除（Vercel 自动构建）');
  console.log('    3️⃣  本地构建 + 推送删除');
  console.log('');
  rl.question('  请选择 (1/2/3，回车默认 2）: ', (choice) => {
    const c = choice.trim() || '2';
    if (c === '1') {
      console.log(`  💡 已删除本地文件`);
      callback();
      return;
    }

    execSync(`git rm "src/content/dynamic/${filename}"`, { cwd: __dirname, stdio: 'pipe' });
    execSync(`git commit -m "${commitMsg}"`, { cwd: __dirname, stdio: 'pipe' });

    if (c === '2') {
      console.log('  ⏳ 直接推送（Vercel 自动构建）...');
      execSync('git push', { cwd: __dirname, stdio: 'inherit' });
      console.log('  ✨ 推送成功！Vercel 自动部署中~');
    } else {
      console.log('  ⏳ 本地构建中...');
      execSync('pnpm build', { cwd: __dirname, stdio: 'inherit' });
      console.log('  ⏳ 推送中...');
      execSync('git push', { cwd: __dirname, stdio: 'inherit' });
      console.log('  ✨ 完成！Vercel 自动部署中~');
    }
    callback();
  });
}

/* ───────── 主菜单 ───────── */

function showBanner() {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║    📝 Firefly Blog 动态管理      ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log('  ──────────────────────────────────');
  console.log('');
}

function showMenu() {
  showBanner();
  console.log('  请选择操作：');
  console.log('    1️⃣  发布新动态');
  console.log('    2️⃣  浏览动态');
  console.log('    3️⃣  编辑动态');
  console.log('    4️⃣  删除动态（移入回收站）');
  console.log('    5️⃣  ♻️ 回收站（恢复/永久删除）');
  console.log('    6️⃣  搜索动态');
  console.log('    0️⃣  退出');
  console.log('');
  rl.question('  请输入数字 (0-6): ', (choice) => {
    const c = choice.trim();
    if (c === '1') startPublish();
    else if (c === '2') startBrowse();
    else if (c === '3') startEdit();
    else if (c === '4') startDelete();
    else if (c === '5') startTrash();
    else if (c === '6') startSearch();
    else if (c === '0') { console.log('  👋 拜拜~'); rl.close(); }
    else { console.log('  ❌ 无效输入\n'); showMenu(); }
  });
}

/* ───────── 1. 发布 ───────── */

let publishLines = [];

function startPublish() {
  publishLines = [];
  showBanner();
  console.log('  📝 请输入内容，一行一行输入');
  console.log('  ✅ 输完后单独输入 DONE 回车');
  console.log('');
  askPubLine();
}

function askPubLine() {
  rl.question('  > ', (line) => {
    if (line.trim().toUpperCase() === 'DONE') {
      if (!publishLines.join('').trim()) {
        console.log('  ❌ 内容不能为空！\n');
        askPubLine();
        return;
      }
      showPublishPreview();
    } else {
      publishLines.push(line);
      askPubLine();
    }
  });
}

function showPublishPreview() {
  console.log('');
  console.log('  ── 内容预览 ──');
  publishLines.forEach(l => console.log(`  ${l}`));
  console.log('  ─────────────\n');
  rl.question('  ✅ 确认发布？(Y/n): ', (ok) => {
    if (ok.trim().toLowerCase() === 'n') {
      console.log('  ❌ 已取消');
      finish();
      return;
    }
    askPubDateTime();
  });
}

function askPubDateTime() {
  console.log('');
  rl.question(`  📅 日期（回车默认 ${Y}-${M}-${D}）: `, (dateInput) => {
    let year = Y, month = M, day = D;
    if (dateInput.trim()) {
      const parts = dateInput.trim().split(/[-/]/);
      if (parts.length === 3) {
        year = parts[0];
        month = pad(parseInt(parts[1]));
        day = pad(parseInt(parts[2]));
      } else {
        console.log('  ⚠️ 格式不对，使用默认日期');
      }
    }
    rl.question(`  ⏰ 时间（回车默认 ${h}:${m}:${s}，格式 时:分:秒）: `, (timeInput) => {
      let hour = h, min = m, sec = s;
      if (timeInput.trim()) {
        const parts = timeInput.trim().split(':');
        if (parts.length >= 2) {
          hour = pad(parseInt(parts[0]));
          min = pad(parseInt(parts[1]));
          sec = parts.length >= 3 ? pad(parseInt(parts[2])) : '00';
        } else {
          console.log('  ⚠️ 格式不对，使用默认时间');
        }
      }
      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${dateStr}T${hour}:${min}:${sec}`;

      let maxSeq = 0;
      if (fs.existsSync(dynamicDir)) {
        fs.readdirSync(dynamicDir).forEach((f) => {
          const match = f.match(new RegExp(`^${year}-${month}-${day}-(\\d+)\\.md$`));
          if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
        });
      }
      const seq = String(maxSeq + 1).padStart(6, '0');
      const filename = `${dateStr}-${seq}.md`;
      const filepath = path.join(dynamicDir, filename);
      console.log(`  ── 文件名: ${filename}`);

      rl.question('  📍 位置（可选，直接回车跳过）: ', (loc) => {
        rl.question('  📌 置顶？(y/N): ', (pin) => {
          const fm = {
            published: timeStr,
            pinned: pin.toLowerCase() === 'y',
            location: loc || '',
          };
          writeFrontMatter(filepath, fm, publishLines.join('\n'));
          console.log('');
          console.log(`  ✅ 动态已创建: ${filename}`);

          doGitOps([filepath], `chore: add dynamic - ${filename}`, finish);
        });
      });
    });
  });
}

/* ───────── 2. 浏览 ───────── */

function startBrowse() {
  showBanner();
  const files = getFiles();
  if (files.length === 0) {
    console.log('  📭 暂无动态');
    finish();
    return;
  }

  const pageSize = 10;
  const totalPages = Math.ceil(files.length / pageSize);
  let currentPage = 0;

  function showPage(page) {
    console.log(`  📋 共 ${files.length} 条动态  ── 第 ${page + 1}/${totalPages} 页 ──\n`);
    listFiles(files, page, pageSize, dynamicDir);
    console.log('');
    if (totalPages > 1) console.log('  n: 下一页  p: 上一页');
    console.log('  输入编号查看详情，或 0 返回');
    rl.question('  > ', (input) => {
      const t = input.trim();
      if (t.toLowerCase() === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t.toLowerCase() === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') finish();
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ❌ 无效编号\n');
          showPage(page);
          return;
        }
        showDetail(files[num - 1], dynamicDir, () => showPage(page));
      }
    });
  }
  showPage(0);
}

function showDetail(filename, dir, backFn) {
  const fp = path.join(dir, filename);
  const { fm, content } = getFileMeta(fp);
  console.log('');
  console.log('  ══════════════════════════════════');
  console.log(`  📄 ${filename}`);
  console.log(`  🕐 ${fm.published || ''}`);
  console.log(`  📍 ${fm.location || '(无)'}`);
  console.log(`  📌 ${fm.pinned ? '是' : '否'}`);
  console.log('  ────────────────────────────────');
  console.log(content);
  console.log('  ══════════════════════════════════');
  console.log('');
  rl.question('  按回车返回', () => backFn());
}

/* ───────── 3. 编辑 ───────── */

function startEdit() {
  showBanner();
  const files = getFiles();
  if (files.length === 0) {
    console.log('  📭 暂无动态');
    finish();
    return;
  }

  const pageSize = 10;
  const totalPages = Math.ceil(files.length / pageSize);

  function showPage(page) {
    console.log(`  📋 选择要编辑的动态  ── 第 ${page + 1}/${totalPages} 页 ──\n`);
    listFiles(files, page, pageSize, dynamicDir);
    console.log('');
    if (totalPages > 1) console.log('  n: 下一页  p: 上一页');
    console.log('  输入编号编辑，或 0 返回');
    rl.question('  > ', (input) => {
      const t = input.trim();
      if (t.toLowerCase() === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t.toLowerCase() === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') finish();
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ❌ 无效编号\n');
          showPage(page);
          return;
        }
        editFile(files[num - 1]);
      }
    });
  }
  showPage(0);
}

function editFile(filename) {
  const fp = path.join(dynamicDir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log('');
  console.log(`  📝 编辑: ${filename}`);
  console.log('  ──────────────');
  console.log('  当前内容:');
  console.log(content);
  console.log('  ──────────────');
  console.log('');
  console.log('  请输入新内容（一行一行输入，DONE 结束）');
  console.log('  直接输入 DONE 回车 = 不修改内容');
  console.log('');

  let newLines = [];
  function askEditLine() {
    rl.question('  > ', (line) => {
      if (line.trim().toUpperCase() === 'DONE') {
        const finalContent = newLines.length > 0 ? newLines.join('\n') : content;
        console.log('\n  ── 新内容预览 ──');
        console.log(finalContent);
        console.log('  ───────────────\n');
        rl.question('  ✅ 确认修改此内容？(Y/n): ', (ok) => {
          if (ok.trim().toLowerCase() === 'n') {
            console.log('  ❌ 已取消');
            finish();
            return;
          }
          editMeta(filename, finalContent, fm);
        });
      } else {
        newLines.push(line);
        askEditLine();
      }
    });
  }
  askEditLine();
}

function editMeta(filename, content, oldFm) {
  const fp = path.join(dynamicDir, filename);
  console.log('');
  console.log('  当前元数据:');
  console.log(`  🕐 时间: ${oldFm.published || ''}`);
  console.log(`  📍 位置: ${oldFm.location || ''}`);
  console.log(`  📌 置顶: ${oldFm.pinned}`);
  console.log('');

  rl.question(`  🕐 新时间（回车不变，格式 ${Y}-${M}-${D}T${h}:${m}:${s}）: `, (timeInput) => {
    const newTime = timeInput.trim() || oldFm.published;
    rl.question(`  📍 新位置（回车不变，输入 "-" 清空）: `, (locInput) => {
      let newLoc = oldFm.location;
      if (locInput.trim() === '-') newLoc = '';
      else if (locInput.trim()) newLoc = locInput.trim();
      rl.question(`  📌 置顶？(y/N/回车不变): `, (pinInput) => {
        let newPin = oldFm.pinned;
        if (pinInput.trim().toLowerCase() === 'y') newPin = true;
        else if (pinInput.trim().toLowerCase() === 'n') newPin = false;

        const newFm = {
          published: newTime,
          location: newLoc,
          pinned: newPin,
        };
        writeFrontMatter(fp, newFm, content);
        console.log(`  ✅ 已更新: ${filename}`);

        doGitOps([fp], `chore: update dynamic - ${filename}`, finish);
      });
    });
  });
}

/* ───────── 4. 删除（移入回收站） ───────── */

function startDelete() {
  showBanner();
  const files = getFiles();
  if (files.length === 0) {
    console.log('  📭 暂无动态');
    finish();
    return;
  }

  const pageSize = 10;
  const totalPages = Math.ceil(files.length / pageSize);

  function showPage(page) {
    console.log(`  📋 选择要删除的动态  ── 第 ${page + 1}/${totalPages} 页 ──\n`);
    listFiles(files, page, pageSize, dynamicDir);
    console.log('');
    if (totalPages > 1) console.log('  n: 下一页  p: 上一页');
    console.log('  输入编号移入回收站，或 0 返回');
    rl.question('  > ', (input) => {
      const t = input.trim();
      if (t.toLowerCase() === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t.toLowerCase() === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') finish();
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ❌ 无效编号\n');
          showPage(page);
          return;
        }
        confirmDelete(files[num - 1]);
      }
    });
  }
  showPage(0);
}

function confirmDelete(filename) {
  const fp = path.join(dynamicDir, filename);
  const { fm, content } = getFileMeta(fp);
  console.log('\n  ── 即将移入回收站 ──');
  console.log(`  📄 ${filename}`);
  console.log(`  🕐 ${fm.published || ''}`);
  console.log('  ──────────────');
  console.log(content);
  console.log('  ──────────────\n');

  rl.question('  ⚠️  确认移入回收站？(y/N): ', (confirm) => {
    if (confirm.toLowerCase() !== 'y') {
      console.log('  ✅ 已取消');
      finish();
      return;
    }

    // 移到回收站
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, filename);
    fs.renameSync(fp, trashPath);
    console.log(`  ♻️ 已移入回收站: ${filename}`);

    // 回收站里的删除也要推 git
    console.log('');
    console.log('  ── 部署选项 ──');
    console.log('    1️⃣  仅本地删除（不推送）');
    console.log('    2️⃣  推送删除（Vercel 自动构建）');
    console.log('    3️⃣  本地构建 + 推送删除');
    console.log('');
    rl.question('  请选择 (1/2/3，回车默认 2）: ', (choice) => {
      const c = choice.trim() || '2';
      if (c === '1') {
        console.log('  💡 本地已删除，回收站可恢复');
        finish();
        return;
      }

      execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
      execSync(`git commit -m "chore: delete dynamic - ${filename}"`, { cwd: __dirname, stdio: 'pipe' });

      if (c === '2') {
        console.log('  ⏳ 直接推送（Vercel 自动构建）...');
        execSync('git push', { cwd: __dirname, stdio: 'inherit' });
        console.log('  ✨ 推送成功！');
      } else {
        console.log('  ⏳ 本地构建中...');
        execSync('pnpm build', { cwd: __dirname, stdio: 'inherit' });
        console.log('  ⏳ 推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'inherit' });
        console.log('  ✨ 完成！');
      }
      finish();
    });
  });
}

/* ───────── 5. 回收站 ───────── */

function startTrash() {
  showBanner();
  const files = getTrashFiles();
  if (files.length === 0) {
    console.log('  ♻️ 回收站为空');
    finish();
    return;
  }

  console.log(`  ♻️ 回收站 (${files.length} 条)`);
  console.log('  ⚠️  这里的动态不会显示在博客上\n');

  const pageSize = 10;
  const totalPages = Math.ceil(files.length / pageSize);

  function showPage(page) {
    console.log(`  ── 第 ${page + 1}/${totalPages} 页 ──\n`);
    listFiles(files, page, pageSize, trashDir);
    console.log('');
    if (totalPages > 1) console.log('  n: 下一页  p: 上一页');
    console.log('  输入编号操作，或 0 返回');
    console.log('  r: 恢复全部  empty: 清空回收站');
    rl.question('  > ', (input) => {
      const t = input.trim().toLowerCase();
      if (t === 'n' && page < totalPages - 1) showPage(page + 1);
      else if (t === 'p' && page > 0) showPage(page - 1);
      else if (t === '0') finish();
      else if (t === 'r') restoreAll(files);
      else if (t === 'empty') emptyTrash(files);
      else {
        const num = parseInt(t, 10);
        if (isNaN(num) || num < 1 || num > files.length) {
          console.log('  ❌ 无效编号\n');
          showPage(page);
          return;
        }
        trashAction(files[num - 1], () => {
          // 重新进入回收站
          startTrash();
        });
      }
    });
  }
  showPage(0);
}

function trashAction(filename, backFn) {
  const fp = path.join(trashDir, filename);
  const { fm, content } = getFileMeta(fp);

  console.log('\n  ──────── ♻️ 回收站 ────────');
  showDetail(filename, trashDir, () => {
    console.log('  请选择操作：');
    console.log('    1️⃣  恢复此动态');
    console.log('    2️⃣  永久删除');
    console.log('    0️⃣  返回');
    console.log('');
    rl.question('  > ', (choice) => {
      const c = choice.trim();
      if (c === '1') {
        // 恢复
        const targetPath = path.join(dynamicDir, filename);
        // 检查是否有同名文件冲突
        if (fs.existsSync(targetPath)) {
          console.log('  ❌ 目标位置已有同名文件，请先删除或重命名');
          backFn();
          return;
        }
        fs.renameSync(fp, targetPath);
        console.log(`  ✅ 已恢复: ${filename}`);

        // 推送
        console.log('');
        rl.question('  🚀 推送恢复？(y/N): ', (push) => {
          if (push.toLowerCase() === 'y') {
            execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
            execSync(`git commit -m "chore: restore dynamic - ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
            console.log('  ⏳ 推送中...');
            execSync('git push', { cwd: __dirname, stdio: 'inherit' });
            console.log('  ✨ 已推送，Vercel 自动部署中~');
          } else {
            console.log('  💡 已恢复本地文件');
          }
          backFn();
        });
      } else if (c === '2') {
        rl.question('  ⚠️  确认永久删除？不可恢复！(y/N): ', (confirm) => {
          if (confirm.toLowerCase() !== 'y') {
            console.log('  ✅ 已取消');
            backFn();
            return;
          }
          fs.unlinkSync(fp);
          console.log(`  💀 已永久删除: ${filename}`);

          rl.question('  🚀 推送删除？(y/N): ', (push) => {
            if (push.toLowerCase() === 'y') {
              execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
              execSync(`git commit -m "chore: permanently delete dynamic - ${filename}"`, { cwd: __dirname, stdio: 'pipe' });
              console.log('  ⏳ 推送中...');
              execSync('git push', { cwd: __dirname, stdio: 'inherit' });
              console.log('  ✨ 已推送');
            }
            backFn();
          });
        });
      } else {
        backFn();
      }
    });
  });
}

function restoreAll(files) {
  console.log('');
  rl.question(`  ♻️  恢复全部 ${files.length} 条动态？(y/N): `, (confirm) => {
    if (confirm.toLowerCase() !== 'y') {
      console.log('  ✅ 已取消');
      finish();
      return;
    }

    let count = 0;
    for (const f of files) {
      const src = path.join(trashDir, f);
      const dst = path.join(dynamicDir, f);
      if (!fs.existsSync(dst)) {
        fs.renameSync(src, dst);
        count++;
      } else {
        console.log(`  ⚠️ 跳过 ${f}（同名冲突）`);
      }
    }
    console.log(`  ✅ 已恢复 ${count} 条动态`);

    rl.question('  🚀 推送恢复？(y/N): ', (push) => {
      if (push.toLowerCase() === 'y') {
        execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
        execSync(`git commit -m "chore: restore all dynamics from trash"`, { cwd: __dirname, stdio: 'pipe' });
        console.log('  ⏳ 推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'inherit' });
        console.log('  ✨ 已推送');
      }
      finish();
    });
  });
}

function emptyTrash(files) {
  console.log('');
  rl.question(`  ⚠️  永久删除回收站全部 ${files.length} 条？不可恢复！(y/N): `, (confirm) => {
    if (confirm.toLowerCase() !== 'y') {
      console.log('  ✅ 已取消');
      finish();
      return;
    }

    for (const f of files) {
      fs.unlinkSync(path.join(trashDir, f));
    }
    console.log(`  💀 已永久删除 ${files.length} 条动态`);

    rl.question('  🚀 推送删除？(y/N): ', (push) => {
      if (push.toLowerCase() === 'y') {
        execSync('git add -A', { cwd: __dirname, stdio: 'pipe' });
        execSync(`git commit -m "chore: empty trash"`, { cwd: __dirname, stdio: 'pipe' });
        console.log('  ⏳ 推送中...');
        execSync('git push', { cwd: __dirname, stdio: 'inherit' });
        console.log('  ✨ 已推送');
      }
      finish();
    });
  });
}

/* ───────── 6. 搜索 ───────── */

function startSearch() {
  showBanner();
  console.log('  🔍 搜索动态内容');
  console.log('');
  rl.question('  请输入关键词: ', (keyword) => {
    const kw = keyword.trim();
    if (!kw) {
      console.log('  ❌ 关键词不能为空\n');
      finish();
      return;
    }

    const files = getFiles();
    const results = [];

    for (const f of files) {
      const fp = path.join(dynamicDir, f);
      const raw = fs.readFileSync(fp, 'utf-8');
      if (raw.toLowerCase().includes(kw.toLowerCase())) {
        const { fm, content } = getFileMeta(fp);
        results.push({ filename: f, fm, content });
      }
    }

    if (results.length === 0) {
      console.log(`  📭 未找到包含 "${kw}" 的动态`);
      finish();
      return;
    }

    console.log(`\n  🔎 找到 ${results.length} 条结果：\n`);
    results.forEach((r, i) => {
      const pin = r.fm.pinned ? ' 📌' : '   ';
      const date = (r.fm.published || '').replace('T', ' ');
      console.log(`  ${pin} ${i + 1}. ${r.filename}`);
      console.log(`      🕐 ${date}`);
      console.log(`      💬 ${previewText(r.content, 80)}`);
      console.log('');
    });

    console.log('  输入编号查看详情，或 0 返回');
    rl.question('  > ', (input) => {
      const num = parseInt(input.trim(), 10);
      if (num > 0 && num <= results.length) {
        showDetail(results[num - 1].filename, dynamicDir, startSearch);
      } else {
        finish();
      }
    });
  });
}

/* ───────── 返回菜单 ───────── */

function finish() {
  console.log('');
  rl.question('  ↩️  按回车返回主菜单，或输入 q 退出: ', (input) => {
    if (input.trim().toLowerCase() === 'q') {
      console.log('  👋 拜拜~');
      rl.close();
    } else {
      showMenu();
    }
  });
}

/* ───────── 启动 ───────── */

// 确保回收站目录存在
if (!fs.existsSync(trashDir)) {
  fs.mkdirSync(trashDir, { recursive: true });
}

showMenu();