# BEDROCK 前端部署紀錄

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
