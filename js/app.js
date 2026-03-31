/**
 * BEDROCK 磐石 — 前端應用程式入口
 * Enhanced Due Diligence Platform
 */

const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:8000/api'
    : 'https://api.bedrock.mitch.tw/api';

/**
 * Google OAuth 登入
 */
function handleGoogleLogin() {
    window.location.href = `${API_BASE}/auth/google/login`;
}

/**
 * 初始化應用程式
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('[BEDROCK] 磐石系統已載入 v0.1.0');
});
