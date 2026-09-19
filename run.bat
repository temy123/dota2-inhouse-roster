@echo off
chcp 65001 > nul
title 도타2 인하우스 대회 관리 도구

:: 현재 폴더로 작업 디렉토리 고정
cd /d "%~dp0"

echo ============================================================
echo   도타2 인하우스 대회 관리 도구를 시작합니다...
echo ============================================================
echo.

:: Node.js 설치 여부 확인
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 Node.js를 설치한 후 다시 실행해주세요.
    echo.
    pause
    exit /b 1
)

:: node_modules 확인 및 자동 설치
if not exist "node_modules" (
    echo [안내] 필수 라이브러리를 설치하는 중입니다. 잠시만 기다려주세요...
    call npm install
    echo.
)

:: 매니저 스크립트 실행
node manager.js

echo.
pause
