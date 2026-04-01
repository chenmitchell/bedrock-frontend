# BEDROCK v3.0 — 設計系統文檔

## 快速導覽

### CSS 變數系統

#### 色彩系統
```css
:root {
  /* 主色 */
  --color-bg: #0f1117;
  --color-surface: #1e2028;
  --color-border: #2d2e3a;
  
  /* 強調色 */
  --color-accent: #4A9EBF;
  --color-success: #34C759;
  --color-warning: #FF9500;
  --color-danger: #FF3B30;
  
  /* 文字 */
  --color-text-primary: #e8e8ec;
  --color-text-secondary: #9b9ba7;
  --color-text-muted: #6b6b78;
}
```

#### 間距系統
```css
--space-xs: 4px;      /* 微調 */
--space-sm: 8px;      /* 小間距 */
--space-md: 16px;     /* 標準間距 */
--space-lg: 24px;     /* 大間距 */
--space-xl: 32px;     /* 超大間距 */
--space-2xl: 48px;    /* 巨大間距 */
```

#### 圓角系統
```css
--radius-sm: 6px;      /* 按鈕等 */
--radius-md: 10px;     /* 表單等 */
--radius-lg: 14px;     /* 卡片 */
--radius-full: 9999px; /* 圓形 */
```

### 組件速查

#### 按鈕
```html
<!-- Primary（主要） -->
<button class="btn btn-primary">建立</button>

<!-- Secondary（次要） -->
<button class="btn btn-secondary">取消</button>

<!-- Ghost（幽靈） -->
<button class="btn btn-ghost">更多</button>

<!-- Danger（危險） -->
<button class="btn btn-danger">刪除</button>

<!-- 小尺寸 -->
<button class="btn btn-sm btn-primary">新增</button>
```

#### 卡片
```html
<div class="card">
  <h3>卡片標題</h3>
  <p>卡片內容…</p>
</div>

<!-- KPI 卡片 -->
<div class="kpi-card">
  <div class="kpi-icon"><i class="fas fa-folder"></i></div>
  <div class="kpi-label">標籤</div>
  <div class="kpi-value">123</div>
</div>
```

#### 表單
```html
<label>標籤文字</label>
<input type="text" placeholder="輸入框…">

<select>
  <option>選項 1</option>
  <option>選項 2</option>
</select>

<textarea rows="3"></textarea>
```

#### 徽章
```html
<span class="badge badge-success">成功</span>
<span class="badge badge-warning">警告</span>
<span class="badge badge-danger">危險</span>
```

#### Modal
```html
<div class="modal-overlay" style="display:none;">
  <div class="modal-box">
    <h3 class="modal-title">標題</h3>
    <div class="modal-body">內容…</div>
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel">取消</button>
      <button class="modal-btn modal-btn-confirm">確認</button>
    </div>
  </div>
</div>
```

### 佈局類別

#### Flex
```html
<!-- 基礎 flex -->
<div class="flex">…</div>

<!-- 列方向 -->
<div class="flex flex-col">…</div>

<!-- 居中 -->
<div class="flex flex-center">…</div>

<!-- 兩端對齊 -->
<div class="flex flex-between">…</div>

<!-- 間距 -->
<div class="flex flex-gap-md">…</div>
```

### JavaScript API

#### 場景切換
```javascript
showScene('login');    // 登入場景
showScene('welcome');  // 儀表板
showScene('workspace'); // 工作台
```

#### 導航
```javascript
switchNavItem(event);          // 導航項切換
switchWelcomeTab('investigations'); // 頁籤切換
switchAdminTab('users');       // 管理頁籤
filterInvestigations('all');   // 篩選案件
```

#### 用戶菜單
```javascript
toggleUserMenu();      // 開關用戶菜單
handleUserSettings();  // 用戶設定
handleLogout();        // 登出
```

#### Modal
```javascript
openNewInvestigationModal(); // 開啟新增 Modal
closeModal();                // 關閉 Modal
confirmNewInvestigation();   // 確認新增
```

#### 調查管理
```javascript
loadInvestigations();        // 載入案件列表
renderInvestigations();      // 渲染案件列表
openInvestigation(id);       // 打開案件
deleteInvestigation(event, id); // 刪除案件
```

### 文件結構

```
/css/main.css               — 1519 行完整設計系統
/index.html                 — 三場景 SPA（登入/儀表板/工作台）
/js/app.js                  — 核心應用邏輯 + v3.0 導航系統
/js/cytoscape-config.js    — 圖譜配置
/js/network-bg.js           — Canvas 背景動畫
```

### 響應式斷點

```css
@media (max-width: 768px) {
  /* 平板及以下：側邊欄隱藏 */
  .nav-sidebar { display: none; }
  /* 主要內容全寬 */
  #welcome-scene, #workspace-scene { margin-left: 0; }
}

@media (max-width: 480px) {
  /* 手機及以下 */
  /* KPI 卡片堆疊為 1 列 */
  .dashboard-kpi-cards { grid-template-columns: 1fr; }
  /* 調查卡片堆疊 */
  .investigations-grid { grid-template-columns: 1fr; }
}
```

### 常見修改

#### 更改主題色
```css
:root {
  --color-accent: #新顏色;
  --color-accent-hover: #更深色;
}
```

#### 調整間距
```css
:root {
  --space-lg: 新值px;
}
```

#### 修改字體
```css
:root {
  --font-body: 'Helvetica', sans-serif;
  --font-display: 'Georgia', serif;
}
```

### WCAG 無障礙性

- 所有按鈕都有 `aria-label`
- 所有表單都有 `<label>`
- 所有圖片都有 `alt` 或 `aria-hidden`
- 焦點可見（3px 外框）
- 色彩對比度滿足 WCAG AA 標準

### 版本歷史

- **v3.0** (2026-04-02) — 完整設計系統重建
  - 新增左側導航欄
  - 完整的 CSS 變數系統
  - 響應式設計優化
  - LOGO SVG 設計

- **v2.7** — 前版本

---
**更新時間**: 2026-04-02
**維護者**: BEDROCK 開發團隊
