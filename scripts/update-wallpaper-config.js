/**
 * 壁纸配置更新脚本
 * 自动扫描本地壁纸目录，生成配置数组并写入 backgroundWallpaper.ts
 * 
 * 使用方法：node scripts/update-wallpaper-config.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const DESKTOP_DIR = path.join(projectRoot, "public", "assets", "images", "DesktopWallpaper");
const MOBILE_DIR = path.join(projectRoot, "public", "assets", "images", "MobileWallpaper");
const CONFIG_PATH = path.join(projectRoot, "src", "config", "backgroundWallpaper.ts");

// 支持的图片格式
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"];

// 获取目录下所有图片
function getImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => {
      // 提取数字部分排序，保证 d1 d2 d3 顺序正确
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      return numA - numB;
    })
    .map((f) => `/assets/images/${path.basename(dir)}/${f}`);
}

// 生成配置数组的字符串表示
function formatArray(array, indent = "\t\t\t") {
  if (array.length === 0) return "[]";
  return `[\n${array.map((s) => `\t\t\t\t"${s}"`).join(",\n")}\n${indent}]`;
}

// 主函数
function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║        🔧 壁纸配置更新工具               ║");
  console.log("╚══════════════════════════════════════════╝");
  
  const desktopImages = getImages(DESKTOP_DIR);
  const mobileImages = getImages(MOBILE_DIR);
  
  console.log(`\n📂 桌面壁纸: ${desktopImages.length} 张`);
  console.log(`📂 移动壁纸: ${mobileImages.length} 张`);
  
  if (desktopImages.length === 0 && mobileImages.length === 0) {
    console.log("\n❌ 没有找到任何壁纸图片，请先运行 node scripts/download-wallpapers.js");
    process.exit(1);
  }
  
  // 读取现有配置文件
  let config = fs.readFileSync(CONFIG_PATH, "utf-8");
  
  // 构建新的 desktop 数组
  const desktopArrayStr = formatArray(desktopImages);
  const mobileArrayStr = formatArray(mobileImages);
  
  // 替换 desktop 配置（从 "desktop: [" 到对应的 "]"）
  config = config.replace(
    /desktop:\s*\[[\s\S]*?\n\s*\]/,
    `desktop: ${desktopArrayStr}`
  );
  
  // 替换 mobile 配置
  config = config.replace(
    /mobile:\s*\[[\s\S]*?\n\s*\]/,
    `mobile: ${mobileArrayStr}`
  );
  
  // 写入配置文件
  fs.writeFileSync(CONFIG_PATH, config, "utf-8");
  
  console.log(`\n✅ 配置已更新: ${CONFIG_PATH}`);
  console.log("\n📄 更新后的壁纸配置:");
  console.log(`   desktop: ${desktopImages.length} 张`);
  console.log(`   mobile: ${mobileImages.length} 张`);
  console.log("\n💡 现在可以运行 npm run build 或 npm run dev 查看效果");
}

main();