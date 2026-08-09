@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 📸 AlbumFlow — 相册×动态管理
node manage.mjs
echo.
pause