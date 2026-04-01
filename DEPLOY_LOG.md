# BEDROCK 前端部署紀錄

## 2026-04-02 v2.6 — 完整工作流實裝

### 變更內容
1. **登入安全開關**：iOS 風格滑動開關，控制是否需要登入驗證
   - 預設關閉（開發階段跳過登入）
   - localStorage 記住選擇 (`bedrock_require_login`)
   - 視覺設計符合 Apple 精緻風格，含焦點狀態和動效

2. **調查狀態管理**：完整的狀態流程
   - draft（灰色）→ crawling（藍色）→ analyzing（紫色）→ completed（綠色）
   - 調查卡片即時更新狀態 badge
   - 工作台導航列顯示當前調查狀態

3. **報告匯出功能**：三種格式
   - HTML 報告：完整排版、統計圖表、紅旗清單、叢集資訊
   - PDF 報告：使用 weasyprint 生成（可選）
   - JSON 報告：原始資料導出
   - 工作台導出按鈕顯示下拉菜單選擇格式

4. **調查刪除機制**
   - 僅 0 節點的調查才能刪除（測試調查）
   - 卡片右上角紅色刪除按鈕
   - 確認對話框防誤刪
   - 刪除後自動刷新列表

5. **CSS 樣式增強**
   - iOS 風格登入開關（48px × 28px）
   - 調查卡片刪除按鈕：紅色主題，hover 效果
   - 狀態 badge 配色：draft/crawling/analyzing/completed

### 技術細節
- 自動登入邏輯在 init() 中延遲 100ms 執行，確保 UI 就緒
- 導出菜單使用動態 DOM 創建，支持菜單外點擊關閉
- 刪除函式防止冒泡，避免觸發卡片的 openInvestigation
- 所有用戶交互都有 Toast 通知反饋

### 品管修正（P0）
- 開關狀態持久化到 localStorage
- 導出格式選擇菜單自動定位（右對齊）
- 刪除確認對話框中文提示
- API 錯誤詳細訊息顯示

## 2026-04-02 v2.5 — 全面升級

### 變更內容
1. **即時關聯圖**：爬蟲過程中每 2 秒增量更新 Cytoscape 圖形
2. **分析進度條**：顯示各階段進度（星形/循環/橋接/UBO/地址/資本）
3. **Dashboard 自動刷新**：返回儀表板時重新載入調查列表
4. **節點詳情全面升級**：統編、狀態、資本額、代表人、地址、關聯架構、紅旗原因
5. **風險節點視覺凸顯**：CRITICAL 紅色光暈、WARNING 橘色光暈
6. **邊線分色**：董監事(綠虛線)、法人代表(藍實線)、股東(青色)、歷史(灰點線)
7. **圖例面板**：左下角顯示節點和邊的圖例
8. **自動啟動爬蟲**：建立調查帶種子時自動開始搜尋
9. **大圖效能優化**：>150 節點改用 concentric layout 避免凍結
10. **loadMedia bug 修正**：安全處理 API 回傳格式

### 品管修正（P0）
- poll 遞迴改用可追蹤 timer，切換調查時清除
- pause/stop 按鈕加入 error handling
- openInvestigation 時清除舊 timer 避免 memory leak
- API 呼叫加入 30 秒超時（AbortController）
- 分析 API 獨立 120 秒超時

### 部署方式
- GitHub Push → Zeabur 自動部署
- Repo: chenmitchell/bedrock-frontend
