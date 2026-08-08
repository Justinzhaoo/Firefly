/**
 * 壁纸批量下载脚本
 * 从 Picsum 下载高质量壁纸到本地，告别网络延迟和超时问题
 * 
 * 使用方法：node scripts/download-wallpapers.js
 */

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// 桌面端壁纸目录（4K 分辨率 3840x2160）
const DESKTOP_DIR = path.join(projectRoot, "public", "assets", "images", "DesktopWallpaper");
// 移动端壁纸目录（1080x1920）
const MOBILE_DIR = path.join(projectRoot, "public", "assets", "images", "MobileWallpaper");

// 下载数量配置
const TOTAL_DESKTOP = 30;  // 桌面端 30 张
const TOTAL_MOBILE = 20;   // 移动端 20 张

// 并发下载数量
const CONCURRENCY = 5;

// 已存在的文件列表，用于跳过已下载的
const existingDesktop = new Set();
const existingMobile = new Set();

// 统计信息
let successCount = 0;
let failCount = 0;
let skipCount = 0;

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 创建目录: ${dir}`);
  }
}

// 获取已下载的文件列表
function getExistingFiles(dir) {
  const files = new Set();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      files.add(f);
    }
  }
  return files;
}

// 下载单个文件（支持重定向）
function downloadFile(url, destPath, retries = 2) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;

    const request = protocol.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/webp,image/avif,image/*,*/*",
      },
      timeout: 15000,
    }, (response) => {
      // 处理重定向
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        console.log(`  ↪ 重定向到 ${response.headers.location}`);
        downloadFile(response.headers.location, destPath, retries).then(resolve);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        if (retries > 0) {
          console.log(`  ❌ 状态码 ${response.statusCode}，剩余重试 ${retries} 次`);
          setTimeout(() => {
            downloadFile(url, destPath, retries - 1).then(resolve);
          }, 1000);
        } else {
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
        }
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        const stats = fs.statSync(destPath);
        if (stats.size > 1024) { // 至少 1KB 才算有效
          resolve({ success: true, size: stats.size });
        } else {
          fs.unlinkSync(destPath);
          if (retries > 0) {
            setTimeout(() => {
              downloadFile(url, destPath, retries - 1).then(resolve);
            }, 1000);
          } else {
            resolve({ success: false, error: "文件太小" });
          }
        }
      });
    });

    request.on("error", (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (retries > 0) {
        setTimeout(() => {
          downloadFile(url, destPath, retries - 1).then(resolve);
        }, 1000);
      } else {
        resolve({ success: false, error: err.message });
      }
    });

    request.on("timeout", () => {
      request.destroy();
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      if (retries > 0) {
        setTimeout(() => {
          downloadFile(url, destPath, retries - 1).then(resolve);
        }, 1000);
      } else {
        resolve({ success: false, error: "超时" });
      }
    });
  });
}

// 获取一个不重复的 Picsum ID
function getRandomPicsumId(existingIds) {
  let id;
  do {
    id = Math.floor(Math.random() * 500); // Picsum 可靠的 ID 范围 0-499
  } while (existingIds.has(id));
  existingIds.add(id);
  return id;
}

// 下载壁纸批次
async function downloadBatch(type, count, dir, resolution, existingFiles) {
  console.log(`\n📥 开始下载 ${type} 壁纸 (${resolution})`);
  console.log(`   目标: ${dir}`);
  console.log(`   数量: ${count} 张`);
  
  ensureDir(dir);
  
  const usedIds = new Set();
  const tasks = [];
  
  // 检查已下载的文件，跳过已存在的
  let actualCount = 0;
  for (let i = 0; i < count; i++) {
    const id = getRandomPicsumId(usedIds);
    const ext = "webp";
    const fileName = `${type === "桌面" ? "d" : "m"}${id}.${ext}`;
    
    if (existingFiles.has(fileName)) {
      skipCount++;
      continue;
    }
    
    const url = `https://picsum.photos/id/${id}/${resolution}`;
    const dest = path.join(dir, fileName);
    tasks.push({ id, fileName, url, dest });
    actualCount++;
  }
  
  console.log(`   需下载: ${actualCount} 张，已跳过: ${count - actualCount} 张`);
  
  if (actualCount === 0) {
    console.log(`   ✅ 全部已存在，无需下载`);
    return;
  }
  
  // 并发控制下载
  let completed = 0;
  const total = tasks.length;
  
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((task) => downloadFile(task.url, task.dest))
    );
    
    for (let j = 0; j < batch.length; j++) {
      const task = batch[j];
      const result = results[j];
      completed++;
      
      if (result.success) {
        successCount++;
        console.log(`   ✅ [${completed}/${total}] ${task.fileName} (${(result.size / 1024).toFixed(1)} KB)`);
      } else {
        failCount++;
        // 清理失败文件
        if (fs.existsSync(task.dest)) fs.unlinkSync(task.dest);
        console.log(`   ❌ [${completed}/${total}] ${task.fileName} - ${result.error}`);
      }
    }
  }
}

// 主函数
async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║       🌄 Firefly 壁纸批量下载工具        ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`开始时间: ${new Date().toLocaleString()}`);
  
  // 获取已存在的文件
  const existingDesktopFiles = getExistingFiles(DESKTOP_DIR);
  const existingMobileFiles = getExistingFiles(MOBILE_DIR);
  
  console.log(`\n📂 已存在的桌面壁纸: ${existingDesktopFiles.size} 张`);
  console.log(`📂 已存在的移动壁纸: ${existingMobileFiles.size} 张`);
  
  const startTime = Date.now();
  
  // 下载桌面壁纸（4K）
  await downloadBatch("桌面", TOTAL_DESKTOP, DESKTOP_DIR, "3840/2160", existingDesktopFiles);
  
  // 下载移动壁纸（1080x1920）
  await downloadBatch("移动", TOTAL_MOBILE, MOBILE_DIR, "1080/1920", existingMobileFiles);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║           📊 下载完成总结                ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`   ✅ 成功: ${successCount} 张`);
  console.log(`   ⏭️  跳过: ${skipCount} 张`);
  console.log(`   ❌ 失败: ${failCount} 张`);
  console.log(`   ⏱️  耗时: ${elapsed} 秒`);
  console.log(`   📁 桌面壁纸目录: ${DESKTOP_DIR}`);
  console.log(`   📁 移动壁纸目录: ${MOBILE_DIR}`);
  console.log("\n💡 下一步：运行 node scripts/update-wallpaper-config.js 来更新配置");
}

main().catch(console.error);