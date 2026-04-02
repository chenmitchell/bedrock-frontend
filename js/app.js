/**
 * BEDROCK 磐石 — 前端應用程式 v3.0
 * Enhanced Due Diligence Platform
 *
 * 完整設計系統 · 左側導航欄 · 深色主題 · 參考 Outpost Dashboard
 * 單頁應用（SPA）· 三場景切換 · Cytoscape 拓樸圖
 * 場景：login → welcome（儀表板）→ workspace（調查工作台）
 */

(function () {
    'use strict';

    // ================================================================
    // API 客戶端
    // ================================================================
    const API_BASE = window.location.hostname === 'localhost'
        ? 'http://localhost:8080/api'
        : 'https://api.bedrock.mitch.tw/api';

    const api = {
        async request(method, path, body, timeoutMs = 30000) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            };
            if (body) opts.body = JSON.stringify(body);

            try {
                const res = await fetch(API_BASE + path, opts);
                clearTimeout(timer);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: res.statusText }));
                    throw new Error(err.detail || `HTTP ${res.status}`);
                }
                if (res.status === 204) return null;
                return res.json();
            } catch (e) {
                clearTimeout(timer);
                if (e.name === 'AbortError') throw new Error('請求逾時，請稍後再試');
                throw e;
            }
        },
        get(path) { return this.request('GET', path); },
        post(path, body) { return this.request('POST', path, body); },
        put(path, body) { return this.request('PUT', path, body); },
        patch(path, body) { return this.request('PATCH', path, body); },
        del(path) { return this.request('DELETE', path); },
    };

    // ================================================================
    // Toast 通知
    // ================================================================
    const Toast = {
        _container: null,
        _getContainer() {
            if (!this._container) {
                this._container = document.createElement('div');
                this._container.className = 'toast-container';
                document.body.appendChild(this._container);
            }
            return this._container;
        },
        show(message, type = 'info', duration = 3500) {
            const el = document.createElement('div');
            el.className = `toast toast-${type}`;
            el.textContent = message;
            this._getContainer().appendChild(el);
            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(12px)';
                el.style.transition = 'all 0.3s';
                setTimeout(() => el.remove(), 300);
            }, duration);
        },
        success(msg) { this.show(msg, 'success'); },
        error(msg) { this.show(msg, 'error'); },
        warning(msg) { this.show(msg, 'warning'); },
    };
    window.Toast = Toast;

    // ================================================================
    // 場景管理
    // ================================================================
    function showScene(name) {
        const scenes = ['login', 'welcome', 'workspace'];
        scenes.forEach(s => {
            const el = document.getElementById(s + '-scene');
            if (el) el.style.display = (s === name) ? '' : 'none';
        });
        document.body.className = 'scene-' + name;

        // 控制側邊導航欄顯示
        const navSidebar = document.getElementById('nav-sidebar');
        if (navSidebar) {
            navSidebar.style.display = (name === 'login') ? 'none' : 'flex';
        }

        // 調整 canvas 大小
        if (name === 'login' && window._bedrockLoginCanvas) {
            window._bedrockLoginCanvas.resize();
        }
        if (name === 'welcome' && window._bedrockWelcomeCanvas) {
            window._bedrockWelcomeCanvas.resize();
        }
    }
    window.showScene = showScene;

    // 切換導航頁籤
    function switchWelcomeTab(tabName) {
        const sections = {
            investigations: 'investigations-section',
            admin: 'admin-section'
        };

        Object.values(sections).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        const activeSection = document.getElementById(sections[tabName]);
        if (activeSection) activeSection.style.display = '';

        // 更新頁籤狀態
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('nav-tab-active');
            tab.setAttribute('aria-selected', 'false');
        });

        const activeTab = document.getElementById('tab-' + tabName);
        if (activeTab) {
            activeTab.classList.add('nav-tab-active');
            activeTab.setAttribute('aria-selected', 'true');
        }

        // 如果切到管理頁籤，加載管理資料
        if (tabName === 'admin') {
            loadAdminData();
        }
    }
    window.switchWelcomeTab = switchWelcomeTab;

    // 返回儀表板時刷新調查列表
    function goBackToDashboard() {
        showScene('welcome');
        loadInvestigations();
    }
    window.goBackToDashboard = goBackToDashboard;

    // ================================================================
    // 應用程式狀態
    // ================================================================
    const state = {
        user: null,
        investigations: [],
        currentInvId: null,
        currentInv: null,
        cy: null,          // Cytoscape 實例
        crawling: false,
        _pollTimer: null,  // pollCrawlProgress timer ID
        _analysisTimer: null, // runAnalysis 後的 setTimeout ID
        investigationsFilter: 'all',
        investigationsSearch: '',
    };

    // ================================================================
    // 登入邏輯（暫時 mock，Auth 最後加）
    // ================================================================
    function setupLogin() {
        const btnLogin = document.getElementById('btn-login');
        const inputEmail = document.getElementById('input-email');
        const inputPassword = document.getElementById('input-password');
        const toggleRequireLogin = document.getElementById('toggle-require-login');
        const toggleSwitch = document.querySelector('.toggle-switch');

        if (!btnLogin) return;

        // 從 localStorage 恢復開關狀態
        const savedRequireLogin = localStorage.getItem('bedrock_require_login') === 'true';
        if (toggleRequireLogin) {
            toggleRequireLogin.checked = savedRequireLogin;
            if (toggleSwitch) {
                toggleSwitch.setAttribute('aria-checked', savedRequireLogin.toString());
            }
        }

        // 開關變更事件
        if (toggleRequireLogin) {
            toggleRequireLogin.addEventListener('change', (e) => {
                const checked = e.target.checked;
                localStorage.setItem('bedrock_require_login', checked.toString());
                if (toggleSwitch) {
                    toggleSwitch.setAttribute('aria-checked', checked.toString());
                }
            });
        }

        btnLogin.addEventListener('click', () => {
            const email = inputEmail.value.trim();
            const pass = inputPassword.value.trim();

            if (!email || !pass) {
                Toast.warning('請輸入帳號密碼');
                return;
            }

            // Mock 登入（之後替換為 API 呼叫）
            state.user = { email, name: email.split('@')[0] };
            updateGreeting();
            showScene('welcome');
            loadInvestigations();
        });

        // Enter 鍵登入
        [inputEmail, inputPassword].forEach(el => {
            if (el) el.addEventListener('keydown', e => {
                if (e.key === 'Enter') btnLogin.click();
            });
        });
    }

    // 檢查是否需要跳過登入
    function checkAndSkipLogin() {
        const requireLogin = localStorage.getItem('bedrock_require_login') === 'true';
        if (!requireLogin) {
            // 自動 mock 登入並進入儀表板
            state.user = { email: 'dev@bedrock.local', name: 'test' };
            showScene('welcome');
            updateGreeting();
            loadInvestigations();
        }
    }

    function updateGreeting() {
        const el = document.getElementById('welcome-greeting');
        if (!el || !state.user) return;

        const name = state.user.name || 'Investigator';
        el.textContent = `歡迎回來，${name}`;

        // 更新所有用戶名顯示
        ['nav-username', 'nav-username-welcome'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = name;
        });

        // 更新頭像
        const avatar = document.getElementById('nav-user-avatar');
        if (avatar && name) {
            avatar.textContent = name.charAt(0).toUpperCase();
        }
    }

    // ================================================================
    // 調查列表
    // ================================================================
    async function loadInvestigations() {
        const listEl = document.getElementById('investigations-list');
        if (!listEl) return;

        try {
            const data = await api.get('/investigations');
            state.investigations = data.items || data || [];
        } catch (e) {
            console.warn('[BEDROCK] 無法載入調查:', e.message);
            state.investigations = [];
        }

        renderInvestigations();
    }

    // getDemoInvestigations 已移除 — 不再使用 demo 資料

    function renderInvestigations() {
        const listEl = document.getElementById('investigations-list');
        if (!listEl) return;

        // 應用過濾和搜尋
        let filtered = state.investigations.filter(inv => {
            const matchFilter = state.investigationsFilter === 'all' || inv.status === state.investigationsFilter;
            const matchSearch = inv.title.toLowerCase().includes(state.investigationsSearch.toLowerCase()) ||
                                (inv.description || '').toLowerCase().includes(state.investigationsSearch.toLowerCase());
            return matchFilter && matchSearch;
        });

        if (state.investigations.length === 0) {
            listEl.innerHTML = `
                <div class="investigations-empty">
                    <i class="fas fa-folder-open"></i>
                    <h3>尚無調查案件</h3>
                    <p>點擊右上方「新增調查」建立第一個案件。<br>
                    輸入統一編號或公司名稱，系統會自動追蹤董監事關係與企業拓樸。</p>
                    <div class="ws-guide-steps" style="margin:20px auto 0; max-width:320px;">
                        <div class="ws-guide-step">
                            <span class="ws-guide-step-num">1</span>
                            <span>點擊「新增調查」，輸入案件名稱與查詢目標</span>
                        </div>
                        <div class="ws-guide-step">
                            <span class="ws-guide-step-num">2</span>
                            <span>進入調查後，點擊「開始」啟動搜尋</span>
                        </div>
                        <div class="ws-guide-step">
                            <span class="ws-guide-step-num">3</span>
                            <span>系統自動展開企業關係網路圖，偵測異常</span>
                        </div>
                    </div>
                </div>`;
            return;
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `
                <div class="investigations-empty">
                    <i class="fas fa-search"></i>
                    <h3>未找到符合的案件</h3>
                    <p>嘗試調整搜尋條件或篩選條件</p>
                </div>`;
            return;
        }

        // 更新統計卡片
        updateDashboardKPIs();

        listEl.innerHTML = filtered.map(inv => {
            const statusMap = {
                draft: '草稿',
                crawling: '搜尋中',
                analyzing: '分析中',
                completed: '已完成',
            };
            const statusLabel = statusMap[inv.status] || inv.status;
            const statusClass = `status-${inv.status || 'draft'}`;

            const nodeCount = inv.node_count || 0;
            const flagCount = inv.red_flag_count || 0;

            // 計算下一步提示
            let nextStepHtml = '';
            if (inv.status === 'completed') {
                nextStepHtml = `<span class="card-next-step card-next-review"><i class="fas fa-chart-bar"></i> 檢視報告</span>`;
            } else if (flagCount > 0) {
                nextStepHtml = `<span class="card-next-step card-next-review"><i class="fas fa-chart-bar"></i> 檢視結果</span>`;
            } else if (nodeCount > 0) {
                nextStepHtml = `<span class="card-next-step card-next-analyze"><i class="fas fa-microscope"></i> 下一步：分析</span>`;
            } else if (inv.status === 'crawling') {
                nextStepHtml = `<span class="card-next-step card-next-crawling"><i class="fas fa-spinner fa-spin"></i> 搜尋中…</span>`;
            } else {
                nextStepHtml = `<span class="card-next-step card-next-start"><i class="fas fa-play"></i> 下一步：搜尋</span>`;
            }

            return `
                <div class="investigation-card" data-id="${inv.id}">
                    <div class="investigation-card-header">
                        <div style="flex: 1; cursor: pointer;" onclick="openInvestigation('${inv.id}')">
                            <span class="investigation-card-title">${esc(inv.title)}</span>
                        </div>
                        <div style="display: flex; gap: 12px; align-items: start;">
                            <span class="status-badge ${statusClass}">${statusLabel}</span>
                            <button class="btn-card-delete" data-id="${inv.id}" onclick="deleteInvestigation(event, '${inv.id}', ${nodeCount})" aria-label="刪除調查" title="刪除此調查"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                    <div class="investigation-card-desc" onclick="openInvestigation('${inv.id}')" style="cursor: pointer;">${esc(inv.description || '')}</div>
                    <div class="investigation-card-footer" onclick="openInvestigation('${inv.id}')" style="cursor: pointer;">
                        <span class="investigation-card-meta">
                            ${nodeCount} 節點 · ${flagCount} 紅旗
                        </span>
                        ${nextStepHtml}
                        <span class="investigation-card-meta">${formatDate(inv.updated_at)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 更新儀表板 KPI 統計
    function updateDashboardKPIs() {
        const total = state.investigations.length;
        const active = state.investigations.filter(i => ['crawling', 'analyzing'].includes(i.status)).length;
        const totalFlags = state.investigations.reduce((sum, i) => sum + (i.red_flag_count || 0), 0);
        const totalNodes = state.investigations.reduce((sum, i) => sum + (i.node_count || 0), 0);

        const kpiElements = {
            'kpi-total-investigations': total,
            'kpi-active-investigations': active,
            'kpi-total-flags': totalFlags,
            'kpi-total-nodes': totalNodes,
        };

        Object.entries(kpiElements).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    }

    // ================================================================
    // 新增調查 Modal
    // ================================================================
    function setupNewInvestigation() {
        const btnNew = document.getElementById('btn-new-investigation');
        const btnConfirm = document.getElementById('btn-confirm-new');
        const overlay = document.getElementById('modal-overlay');

        if (btnNew) {
            btnNew.addEventListener('click', () => {
                if (overlay) overlay.style.display = '';
            });
        }

        if (btnConfirm) {
            btnConfirm.addEventListener('click', async () => {
                // Prevent double-click
                if (btnConfirm.disabled) return;
                btnConfirm.disabled = true;
                const originalText = btnConfirm.textContent;
                btnConfirm.textContent = '建立中…';

                const title = document.getElementById('new-inv-title').value.trim();
                const desc = document.getElementById('new-inv-desc').value.trim();
                const seedType = document.getElementById('new-inv-seed-type')?.value || 'company';
                const seed = document.getElementById('new-inv-seed').value.trim();

                if (!title) {
                    Toast.warning('請輸入案件名稱');
                    btnConfirm.disabled = false;
                    btnConfirm.textContent = originalText;
                    return;
                }

                try {
                    const payload = {
                        title,
                        description: desc || null,
                        seed_type: seedType,
                    };
                    // 建立時帶入種子值，後端會自動建立種子記錄
                    if (seed) payload.seed_value = seed;
                    const inv = await api.post('/investigations', payload);
                    Toast.success('調查案件已建立');
                    closeModal();
                    await loadInvestigations();
                    if (inv && inv.id) {
                        openInvestigation(inv.id);
                        // 有種子就自動啟動爬蟲 — 使用者不需要再按「開始」
                        if (seed) {
                            setTimeout(async () => {
                                try {
                                    await api.post(`/investigations/${inv.id}/crawl/start`);
                                    state.crawling = true;
                                    updateCrawlUI();
                                    Toast.success('已自動開始搜尋關聯企業…');
                                    pollCrawlProgress();
                                } catch (crawlErr) {
                                    console.warn('[BEDROCK] 自動爬取啟動失敗:', crawlErr.message);
                                    Toast.warning('請手動點擊「開始」啟動搜尋');
                                }
                            }, 500);
                        }
                    }
                } catch (e) {
                    console.warn('[BEDROCK] 建立失敗:', e.message);
                    Toast.error('建立調查失敗: ' + e.message);
                    // Re-enable button on error
                    btnConfirm.disabled = false;
                    btnConfirm.textContent = originalText;
                }
            });
        }
    }

    function closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.style.display = 'none';
        // 清空表單
        ['new-inv-title', 'new-inv-desc', 'new-inv-seed'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }
    window.closeModal = closeModal;

    // 刪除調查
    async function deleteInvestigation(event, invId, nodeCount = 0) {
        event.stopPropagation();  // 防止觸發卡片的 openInvestigation

        let msg = '確定要刪除此調查案件嗎？此動作無法復原。';
        if (nodeCount > 0) {
            msg = `此案件包含 ${nodeCount} 個節點及相關分析資料。\n確定要永久刪除嗎？此動作無法復原！`;
        }
        if (!confirm(msg)) return;

        // 有資料的案件二次確認
        if (nodeCount > 0) {
            if (!confirm(`最後確認：刪除後所有節點、紅旗、集群資料都會消失。繼續？`)) return;
        }

        try {
            await api.del(`/investigations/${invId}`);
            Toast.success('調查已刪除');
            loadInvestigations();
        } catch (e) {
            console.warn('[BEDROCK] 刪除失敗:', e.message);
            Toast.error('刪除失敗: ' + e.message);
        }
    }
    window.deleteInvestigation = deleteInvestigation;

    // 設置儀表板搜尋和篩選
    function setupDashboardControls() {
        const searchInput = document.getElementById('investigations-search');
        const filterBtns = document.querySelectorAll('.filter-btn');
        const navTabs = document.querySelectorAll('.nav-tab');
        const userMenuBtn = document.getElementById('btn-user-menu');
        const userMenuDropdown = document.getElementById('user-menu-dropdown');

        // 搜尋功能
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.investigationsSearch = e.target.value;
                renderInvestigations();
            });
        }

        // 篩選功能
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('filter-btn-active'));
                btn.classList.add('filter-btn-active');
                state.investigationsFilter = btn.dataset.filter;
                renderInvestigations();
            });
        });

        // 導航頁籤
        navTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.id.replace('tab-', '');
                switchWelcomeTab(tabName);
            });
        });

        // 使用者選單
        if (userMenuBtn) {
            userMenuBtn.addEventListener('click', () => {
                if (userMenuDropdown) {
                    const isVisible = userMenuDropdown.style.display !== 'none';
                    userMenuDropdown.style.display = isVisible ? 'none' : '';
                }
            });
        }

        // 登出按鈕
        const btnLogout = document.getElementById('btn-user-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                state.user = null;
                localStorage.removeItem('bedrock_require_login');
                showScene('login');
            });
        }

        // 關閉使用者選單（點擊其他地方）
        document.addEventListener('click', (e) => {
            if (userMenuDropdown && !e.target.closest('.nav-user-menu')) {
                userMenuDropdown.style.display = 'none';
            }
        });
    }

    // ================================================================
    // 管理後台
    // ================================================================
    async function loadAdminData() {
        await loadAdminUsers();
        await loadAdminSettings();
        await loadAdminAudit();
        await loadDataSyncStatus();
        await checkSearXNGStatus();
    }

    async function loadAdminUsers() {
        const tbody = document.getElementById('admin-users-tbody');
        if (!tbody) return;

        try {
            // 從 API 獲取使用者資料
            const data = await api.get('/admin/users');
            const users = data.items || data || [];

            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">暫無使用者</td></tr>';
                return;
            }

            tbody.innerHTML = users.map(u => `
                <tr>
                    <td>${esc(u.name || u.username || 'N/A')}</td>
                    <td>${esc(u.email)}</td>
                    <td>${esc(u.role || '使用者')}</td>
                    <td>${formatDate(u.created_at)}</td>
                    <td>
                        <button class="admin-action-btn" style="margin-right:8px;">編輯</button>
                        <button class="admin-action-btn" style="color:#B22D20;">刪除</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入使用者失敗:', e.message);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#B22D20;">載入失敗: ${esc(e.message)}</td></tr>`;
        }
    }

    async function loadAdminSettings() {
        const content = document.getElementById('admin-settings-content');
        if (!content) return;

        try {
            // 載入關鍵字
            const keywordsList = document.getElementById('admin-keywords-list');
            if (keywordsList) {
                try {
                    const keywordsData = await api.get('/keywords');
                    const keywords = keywordsData.items || keywordsData || [];
                    if (keywords.length > 0) {
                        keywordsList.innerHTML = `
                            <div class="admin-list">
                                ${keywords.slice(0, 5).map(kw => `
                                    <div class="admin-list-item">${esc(kw.keyword || kw)}</div>
                                `).join('')}
                                ${keywords.length > 5 ? `<div class="admin-list-item" style="color:#999;">… 及其他 ${keywords.length - 5} 個</div>` : ''}
                            </div>`;
                    } else {
                        keywordsList.innerHTML = '<p style="color:#999;">暫無關鍵字</p>';
                    }
                } catch (e) {
                    keywordsList.innerHTML = '<p style="color:#B22D20;">載入關鍵字失敗</p>';
                }
            }

            // 載入系統配置
            const configList = document.getElementById('admin-config-list');
            if (configList) {
                try {
                    const settingsData = await api.get('/settings');
                    const settings = settingsData.items || settingsData || [];
                    if (settings.length > 0) {
                        configList.innerHTML = `
                            <table class="admin-table" style="width:100%; margin-top:10px;">
                                <tr><th>設定項</th><th>值</th><th>操作</th></tr>
                                ${settings.slice(0, 5).map(s => `
                                    <tr>
                                        <td>${esc(s.key || s)}</td>
                                        <td><code style="background:#f5f5f3; padding:2px 6px; border-radius:3px;">${esc(s.value || '')}</code></td>
                                        <td><button class="admin-action-btn">編輯</button></td>
                                    </tr>
                                `).join('')}
                            </table>`;
                    } else {
                        configList.innerHTML = '<p style="color:#999;">暫無系統設定</p>';
                    }
                } catch (e) {
                    configList.innerHTML = '<p style="color:#B22D20;">載入設定失敗</p>';
                }
            }
        } catch (e) {
            console.warn('[BEDROCK] 載入設定失敗:', e.message);
        }
    }

    async function loadAdminAudit() {
        const tbody = document.getElementById('admin-audit-tbody');
        if (!tbody) return;

        try {
            // 從 API 獲取稽核紀錄
            const data = await api.get('/admin/audit-log');
            const audits = data.items || data || [];

            if (audits.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#999;">暫無稽核紀錄</td></tr>';
                return;
            }

            const actionMap = {
                'create_investigation': '建立調查',
                'start_crawl': '啟動爬蟲',
                'add_seed': '新增種子',
                'analyze': '執行分析',
                'export': '匯出報告',
                'login': '登入',
                'logout': '登出',
                'delete_investigation': '刪除調查',
            };

            tbody.innerHTML = audits.map(a => {
                const actionLabel = actionMap[a.action] || a.action;
                const statusLabel = a.status === 'success' || a.status === 'ok' ? '成功' : '失敗';
                return `
                    <tr>
                        <td>${formatDate(a.timestamp || a.created_at)}</td>
                        <td>${esc(a.user || a.username || 'N/A')}</td>
                        <td>${actionLabel}</td>
                        <td>${esc(a.resource || a.target || 'N/A')}</td>
                        <td><span class="status-badge status-${a.status}">${statusLabel}</span></td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入稽核紀錄失敗:', e.message);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#B22D20;">載入失敗: ${esc(e.message)}</td></tr>`;
        }
    }

    // ================================================================
    // 資料同步管理
    // ================================================================
    async function loadDataSyncStatus() {
        try {
            const data = await api.get('/admin/sync-status');
            const lastTime = document.getElementById('sync-last-time');
            const hashStatus = document.getElementById('sync-hash-status');
            const statsTbody = document.getElementById('sync-stats-tbody');

            if (lastTime) {
                lastTime.textContent = data.last_sync_time
                    ? formatDate(data.last_sync_time) + ` ${new Date(data.last_sync_time).toLocaleTimeString('zh-TW')}`
                    : '未曾同步';
            }

            if (hashStatus) {
                hashStatus.textContent = data.data_hash || 'N/A';
            }

            if (statsTbody && data.sync_stats && Array.isArray(data.sync_stats)) {
                statsTbody.innerHTML = data.sync_stats.map(s => `
                    <tr>
                        <td>${esc(s.resource_type || s.type || '未知')}</td>
                        <td>${s.record_count || 0}</td>
                        <td>${formatDate(s.last_updated)}</td>
                    </tr>
                `).join('');
            } else if (statsTbody) {
                statsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#999;">暫無同步資料</td></tr>';
            }
        } catch (e) {
            console.warn('[BEDROCK] 載入同步狀態失敗:', e.message);
            const lastTime = document.getElementById('sync-last-time');
            if (lastTime) lastTime.textContent = '載入失敗: ' + e.message;
        }
    }

    async function triggerDataSync() {
        const btnSync = document.getElementById('btn-sync-now');
        if (!btnSync) return;

        const originalHtml = btnSync.innerHTML;
        btnSync.disabled = true;
        btnSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同步中…';

        try {
            const result = await api.post('/admin/sync', {});
            Toast.success(`資料同步完成：${result.synced_records || 0} 筆記錄`);
            await loadDataSyncStatus();
        } catch (e) {
            console.warn('[BEDROCK] 同步失敗:', e.message);
            Toast.error('資料同步失敗: ' + e.message);
        } finally {
            btnSync.disabled = false;
            btnSync.innerHTML = originalHtml;
        }
    }
    window.triggerDataSync = triggerDataSync;

    // 關鍵字管理
    async function loadKeywords() {
        try {
            const data = await api.get('/keywords');
            const keywords = data.items || data || [];

            // 按等級分組
            const levelL1 = keywords.filter(k => k.level === 'L1');
            const levelL2 = keywords.filter(k => k.level === 'L2');
            const levelL3 = keywords.filter(k => k.level === 'L3');

            // 渲染 L1
            const l1Container = document.getElementById('kw-level-l1');
            if (l1Container) {
                l1Container.innerHTML = renderKeywordTable(levelL1);
            }

            // 渲染 L2
            const l2Container = document.getElementById('kw-level-l2');
            if (l2Container) {
                l2Container.innerHTML = renderKeywordTable(levelL2);
            }

            // 渲染 L3
            const l3Container = document.getElementById('kw-level-l3');
            if (l3Container) {
                l3Container.innerHTML = renderKeywordTable(levelL3);
            }

        } catch(e) {
            console.error('[BEDROCK] 載入關鍵字失敗:', e.message);
            Toast.error('載入關鍵字失敗: ' + e.message);
        }
    }
    window.loadKeywords = loadKeywords;

    function renderKeywordTable(keywords) {
        if (keywords.length === 0) {
            return '<div class="text-muted">暫無關鍵字</div>';
        }

        const categoryLabels = {
            'negative_media': '負面媒體',
            'risk_entity': '高風險實體',
            'industry': '產業分類',
            'location': '地點',
            'custom': '自訂'
        };

        return `
            <div class="keyword-items">
                ${keywords.map(kw => `
                    <div class="keyword-item">
                        <span class="keyword-text">${esc(kw.keyword || kw.text || kw)}</span>
                        <span class="keyword-tag" style="background:rgba(74, 158, 191, 0.15); color:#3A7CA5;">${esc(categoryLabels[kw.category] || kw.category || '未分類')}</span>
                        <button class="keyword-btn-delete" onclick="deleteKeyword('${esc(kw.id || kw.keyword)}', '${kw.level}')">刪除</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    async function addKeyword() {
        const textInput = document.getElementById('kw-input-text');
        const categorySelect = document.getElementById('kw-input-category');
        const levelSelect = document.getElementById('kw-input-level');

        const text = (textInput.value || '').trim();
        const category = categorySelect.value || 'custom';
        const level = levelSelect.value || 'L3';

        if (!text) {
            Toast.warning('請輸入關鍵字');
            return;
        }

        try {
            await api.post('/keywords', {
                keyword: text,
                category: category,
                level: level
            });
            Toast.success('關鍵字已新增');
            textInput.value = '';
            loadKeywords();
        } catch(e) {
            Toast.error('新增失敗: ' + e.message);
        }
    }
    window.addKeyword = addKeyword;

    async function deleteKeyword(keywordId, level) {
        if (!confirm('確定要刪除此關鍵字嗎？')) return;

        try {
            await api.del(`/keywords/${keywordId}`);
            Toast.success('關鍵字已刪除');
            loadKeywords();
        } catch(e) {
            Toast.error('刪除失敗: ' + e.message);
        }
    }
    window.deleteKeyword = deleteKeyword;

    async function verifyDataSync() {
        const btnVerify = document.getElementById('btn-sync-verify');
        if (!btnVerify) return;

        const originalHtml = btnVerify.innerHTML;
        btnVerify.disabled = true;
        btnVerify.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 驗證中…';

        try {
            const result = await api.post('/admin/sync/verify', {});
            if (result.is_valid) {
                Toast.success('資料完整性驗證通過');
            } else {
                Toast.warning('資料完整性驗證失敗：' + (result.errors || []).join('、'));
            }
        } catch (e) {
            console.warn('[BEDROCK] 驗證失敗:', e.message);
            Toast.error('驗證失敗: ' + e.message);
        } finally {
            btnVerify.disabled = false;
            btnVerify.innerHTML = originalHtml;
        }
    }
    window.verifyDataSync = verifyDataSync;

    async function checkSearXNGStatus() {
        const statusEl = document.getElementById('searxng-status');
        const testBtn = document.getElementById('btn-searxng-test');

        // 檢測 SearXNG 狀態
        async function performHealthCheck() {
            try {
                const data = await api.get('/admin/health');
                const isHealthy = data.status === 'ok' || data.status === 'healthy';
                if (statusEl) {
                    statusEl.innerHTML = isHealthy
                        ? '<span class="status-badge status-success">已連線</span>'
                        : '<span class="status-badge status-error">未連線</span>';
                }
                return isHealthy;
            } catch (e) {
                console.warn('[BEDROCK] 健康檢查失敗:', e.message);
                if (statusEl) {
                    statusEl.innerHTML = '<span class="status-badge status-error">檢測失敗</span>';
                }
                return false;
            }
        }

        // 初始檢查
        await performHealthCheck();

        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                const originalHtml = testBtn.innerHTML;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 連線測試中…';
                try {
                    const isHealthy = await performHealthCheck();
                    if (isHealthy) {
                        Toast.success('SearXNG 連線正常');
                    } else {
                        Toast.warning('SearXNG 連線異常');
                    }
                } catch (e) {
                    Toast.error('SearXNG 連線測試失敗');
                } finally {
                    testBtn.disabled = false;
                    testBtn.innerHTML = originalHtml;
                }
            });
        }
    }

    // ================================================================
    // 調查工作台
    // ================================================================
    function openInvestigation(id) {
        // 清除上一個調查的 timer，避免 memory leak
        if (state._pollTimer) { clearTimeout(state._pollTimer); state._pollTimer = null; }
        if (state._analysisTimer) { clearTimeout(state._analysisTimer); state._analysisTimer = null; }
        state.crawling = false;

        const numId = parseInt(id);
        state.currentInvId = numId;
        state.currentInv = state.investigations.find(i => i.id == numId) || { title: '調查案件', status: 'draft' };

        // 更新工作台標題
        const wsTitle = document.getElementById('ws-title');
        const wsStatus = document.getElementById('ws-status');
        if (wsTitle) wsTitle.textContent = state.currentInv.title;
        if (wsStatus) {
            const statusMap = { draft: '草稿', crawling: '搜尋中', analyzing: '分析中', completed: '已完成' };
            wsStatus.textContent = statusMap[state.currentInv.status] || '草稿';
        }

        showScene('workspace');
        initCytoscape();
        _hintDismissed = false;  // 重新開放引導提示
        updateWorkflowStepper();

        // 重置所有側邊欄為空白，避免顯示前一個調查的殘留資料
        const resetPairs = [
            ['seeds-list', 'seed-count'],
            ['clusters-list', 'cluster-count'],
            ['red-flags-list', 'flag-count'],
            ['media-list', 'media-count'],
        ];
        resetPairs.forEach(([listId, countId]) => {
            const list = document.getElementById(listId);
            const count = document.getElementById(countId);
            if (list) list.innerHTML = '';
            if (count) count.textContent = '0';
        });

        // 重置空狀態
        const emptyState = document.getElementById('cy-empty-state');
        if (emptyState) emptyState.style.display = '';
        loadInvestigationData(numId);
    }
    window.openInvestigation = openInvestigation;

    async function loadInvestigationData(id) {
        // 先載入種子列表
        loadSeeds(id);

        // 載入圖資料
        try {
            const data = await api.get(`/investigations/${id}/graph`);
            if (data && data.elements && data.elements.length > 0) {
                renderGraph(data.elements);
            }
        } catch (e) {
            console.warn('[BEDROCK] 載入圖資料失敗:', e.message);
        }

        // 載入集群、紅旗、負面新聞
        loadClusters(id);
        loadRedFlags(id);
        loadMedia(id);

        // 延遲更新 stepper (等紅旗等資料載完)
        setTimeout(() => updateWorkflowStepper(), 500);
    }

    // ================================================================
    // 種子列表
    // ================================================================
    async function loadSeeds(invId) {
        const listEl = document.getElementById('seeds-list');
        const countEl = document.getElementById('seed-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/seeds`);
            const seeds = data.items || data || [];
            if (countEl) countEl.textContent = seeds.length;

            if (seeds.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">尚無查詢目標，請在上方輸入統編或人名</div>';
                return;
            }

            // 有 seeds → 更新 stepper 到至少 crawl 步驟
            if (seeds.length > 0) {
                const currentStep = detectWorkflowStep();
                if (currentStep === 'seed') updateWorkflowStepper('crawl');
            }

            const typeLabels = { tax_id: '統編', company: '公司', person: '人名' };
            listEl.innerHTML = seeds.map(s => {
                const typeLabel = typeLabels[s.seed_type] || s.seed_type;
                const resolvedName = s.resolved_company_name || '';
                const status = s.company_status || '';
                const capital = s.capital ? (s.capital >= 10000 ? `${Math.round(s.capital / 10000)} 萬` : `${s.capital.toLocaleString()} 元`) : '';
                const rep = s.representative || '';
                const statusColor = status === '核准設立' ? '#27AE60' : status === '解散' ? '#C0392B' : '#888';
                return `
                    <div class="ws-list-item ws-seed-item" data-seed-id="${s.id}" style="cursor:pointer;" onclick="focusSeedNode('${esc(s.seed_value)}')">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="ws-seed-type">${typeLabel}</span>
                            <span style="font-weight:600; font-size:12px;">${esc(s.seed_value)}</span>
                        </div>
                        ${resolvedName ? `<div style="font-size:12px; color:#3A7CA5; font-weight:600; margin-top:3px;">${esc(resolvedName)}</div>` : ''}
                        ${(status || capital || rep) ? `
                        <div style="font-size:10px; color:#999; margin-top:2px; display:flex; gap:6px; flex-wrap:wrap;">
                            ${status ? `<span style="color:${statusColor};">${esc(status)}</span>` : ''}
                            ${capital ? `<span>資本 ${capital}</span>` : ''}
                            ${rep ? `<span>代表：${esc(rep)}</span>` : ''}
                        </div>` : ''}
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入種子失敗:', e.message);
            if (countEl) countEl.textContent = '0';
            listEl.innerHTML = '<div class="ws-list-empty">載入失敗</div>';
        }
    }

    function focusSeedNode(seedValue) {
        if (!state.cy) return;
        // Try to find node by entity_id or label matching
        const node = state.cy.nodes().filter(n => {
            const d = n.data();
            return d.entity_id === seedValue || d.label === seedValue || d.id === seedValue;
        });
        if (node.length > 0) {
            state.cy.center(node[0]);
            node[0].select();
            showNodeDetail(node[0].data());
        }
    }
    window.focusSeedNode = focusSeedNode;

    // ================================================================
    // Cytoscape 初始化
    // ================================================================
    function initCytoscape() {
        if (state.cy) {
            state.cy.destroy();
            state.cy = null;
        }

        const container = document.getElementById('cy');
        if (!container || typeof cytoscape === 'undefined') return;

        state.cy = cytoscape({
            container,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'font-family': 'Inter, Noto Sans TC, sans-serif',
                        'font-size': '11px',
                        'color': '#4A4A47',
                        'text-valign': 'bottom',
                        'text-margin-y': 6,
                        'width': 'data(size)',
                        'height': 'data(size)',
                        'background-color': 'data(color)',
                        'border-width': 1.5,
                        'border-color': 'data(border_color)',
                        'text-max-width': '90px',
                        'text-wrap': 'ellipsis',
                    },
                },
                {
                    selector: 'node[type="company"]',
                    style: {
                        'shape': 'roundrectangle',
                        'background-color': '#3A7CA5',
                        'border-color': '#2D6485',
                        'color': '#2C2C2A',
                    },
                },
                {
                    selector: 'node[type="person"]',
                    style: {
                        'shape': 'ellipse',
                        'background-color': '#B8860B',
                        'border-color': '#8B6508',
                        'color': '#2C2C2A',
                    },
                },
                {
                    selector: 'node[risk_level="CRITICAL"]',
                    style: {
                        'background-color': '#C0392B',
                        'border-color': '#8B0000',
                        'border-width': 3.5,
                        'shadow-blur': 15,
                        'shadow-color': '#C0392B',
                        'shadow-opacity': 0.6,
                        'shadow-offset-x': 0,
                        'shadow-offset-y': 0,
                        'font-weight': 'bold',
                        'color': '#8B0000',
                    },
                },
                {
                    selector: 'node[risk_level="WARNING"]',
                    style: {
                        'background-color': '#E67E22',
                        'border-color': '#D35400',
                        'border-width': 2.5,
                        'shadow-blur': 10,
                        'shadow-color': '#E67E22',
                        'shadow-opacity': 0.4,
                        'shadow-offset-x': 0,
                        'shadow-offset-y': 0,
                        'color': '#8B4513',
                    },
                },
                {
                    selector: 'node[flagged]',
                    style: {
                        'border-color': '#C0392B',
                        'border-width': 2.5,
                    },
                },
                {
                    selector: 'node.marked',
                    style: {
                        'border-width': 4,
                        'border-color': '#FFD700',
                        'border-style': 'double'
                    },
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-color': '#3A7CA5',
                        'border-width': 3,
                        'overlay-opacity': 0.08,
                        'overlay-color': '#3A7CA5',
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 1,
                        'line-color': '#C5C0B8',
                        'curve-style': 'bezier',
                        'target-arrow-shape': 'triangle',
                        'target-arrow-color': '#C5C0B8',
                        'arrow-scale': 0.7,
                        'label': 'data(label)',
                        'font-size': '9px',
                        'color': '#ADADAB',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                    },
                },
                {
                    selector: 'edge[type="director"]',
                    style: {
                        'line-style': 'dashed',
                        'line-dash-pattern': [4, 3],
                        'line-color': '#95E1D3',
                        'target-arrow-color': '#95E1D3',
                    },
                },
                {
                    selector: 'edge[type="representative"]',
                    style: {
                        'line-color': '#3A7CA5',
                        'target-arrow-color': '#3A7CA5',
                        'width': 2,
                    },
                },
                {
                    selector: 'edge[type="shareholder"]',
                    style: {
                        'line-color': '#4ECDC4',
                        'target-arrow-color': '#4ECDC4',
                        'width': 1.5,
                    },
                },
                {
                    selector: 'edge[type="historical"]',
                    style: {
                        'line-style': 'dotted',
                        'line-color': '#ADADAB',
                        'target-arrow-color': '#ADADAB',
                        'opacity': 0.5,
                    },
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'line-color': '#3A7CA5',
                        'target-arrow-color': '#3A7CA5',
                        'width': 2,
                    },
                },
                // High-risk PERSON nodes get extra-bold gold pulsing border
                {
                    selector: 'node[type="person"][risk_level="CRITICAL"]',
                    style: {
                        'background-color': '#DC143C',
                        'border-color': '#FFD700',
                        'border-width': 5,
                        'border-style': 'double',
                        'shadow-blur': 20,
                        'shadow-color': '#DC143C',
                        'shadow-opacity': 0.7,
                        'font-weight': 'bold',
                        'font-size': '13px',
                        'color': '#8B0000',
                    },
                },
                {
                    selector: 'node[type="person"][risk_level="WARNING"]',
                    style: {
                        'background-color': '#FF8C00',
                        'border-color': '#FFD700',
                        'border-width': 3.5,
                        'border-style': 'double',
                        'shadow-blur': 12,
                        'shadow-color': '#FF8C00',
                        'shadow-opacity': 0.5,
                        'font-weight': 'bold',
                        'color': '#8B4513',
                    },
                },
            ],
            layout: { name: 'grid' },
            minZoom: 0.2,
            maxZoom: 3,
            wheelSensitivity: 0.3,
        });

        // 節點點擊 → 顯示詳情
        state.cy.on('tap', 'node', function (e) {
            showNodeDetail(e.target.data());
        });

        // 點擊空白 → 關閉詳情
        state.cy.on('tap', function (e) {
            if (e.target === state.cy) closeDetail();
        });

        setupCytoscapeToolbar();
    }

    function renderGraph(elements) {
        if (!state.cy) return;
        state.cy.elements().remove();
        state.cy.add(elements);
        // 大圖用 concentric（快速），小圖用 cola（美觀）
        const nodeCount = elements.filter(e => e.group === 'nodes').length;
        if (nodeCount > 150) {
            state.cy.layout({
                name: 'concentric',
                animate: false,
                concentric: function(node) {
                    // 有紅旗的放中心
                    return node.data('flag_count') ? 10 : node.connectedEdges().length;
                },
                levelWidth: function() { return 3; },
                minNodeSpacing: 20,
            }).run();
            Toast.show(`${nodeCount} 個節點，使用快速排版`, 'info', 2000);
        } else {
            runLayout('cola');
        }
        // 有資料就隱藏空狀態，顯示圖例
        const emptyState = document.getElementById('cy-empty-state');
        const legend = document.getElementById('graph-legend');
        if (elements.length > 0) {
            if (emptyState) emptyState.style.display = 'none';
            if (legend) legend.style.display = '';
        }
    }

    // renderDemoGraph 已移除 — 不再使用 demo 資料

    function runLayout(name) {
        if (!state.cy) return;

        const layouts = {
            cola: {
                name: 'cola',
                animate: true,
                animationDuration: 500,
                nodeSpacing: 30,
                edgeLength: 120,
                convergenceThreshold: 0.01,
                randomize: false,
                avoidOverlap: true,
            },
            grid: {
                name: 'grid',
                animate: true,
                animationDuration: 300,
                rows: undefined,
                cols: undefined,
            },
        };

        const layoutOpts = layouts[name] || layouts.cola;
        state.cy.layout(layoutOpts).run();
    }

    // ================================================================
    // ================================================================
    // 節點操作按鈕（深追/標記/排除）
    // ================================================================
    let currentSelectedNode = null;

    function setupNodeOperationButtons() {
        const btnDeepCrawl = document.getElementById('btn-deep-crawl');
        const btnMark = document.getElementById('btn-mark-node');
        const btnExclude = document.getElementById('btn-exclude-node');

        if (btnDeepCrawl) {
            btnDeepCrawl.addEventListener('click', async () => {
                if (!currentSelectedNode || !state.currentInvId) {
                    Toast.warning('請先選擇一個節點');
                    return;
                }
                Toast.show('正在從此節點深入追蹤…', 'info');
                try {
                    await api.post(`/investigations/${state.currentInvId}/crawl/start`, {
                        seed_name: currentSelectedNode
                    });
                    Toast.success('深入追蹤已啟動');
                    state.crawling = true;
                    updateCrawlUI();
                    pollCrawlProgress();
                } catch(e) {
                    Toast.error('深入追蹤失敗: ' + e.message);
                }
            });
        }

        if (btnMark) {
            btnMark.addEventListener('click', async () => {
                if (!currentSelectedNode || !state.cy) {
                    Toast.warning('請先選擇一個節點');
                    return;
                }
                const node = state.cy.getElementById(currentSelectedNode);
                if (!node || !node.length) return;

                if (node.hasClass('marked')) {
                    node.removeClass('marked');
                    Toast.show('已取消標記', 'info');
                } else {
                    node.addClass('marked');
                    Toast.success('已標記為重點關注');
                }
            });
        }

        if (btnExclude) {
            btnExclude.addEventListener('click', async () => {
                if (!currentSelectedNode || !state.cy) {
                    Toast.warning('請先選擇一個節點');
                    return;
                }
                if (!confirm(`確定要將「${currentSelectedNode}」從調查範圍排除嗎？`)) return;

                const node = state.cy.getElementById(currentSelectedNode);
                if (!node || !node.length) return;

                node.style('opacity', 0.2);
                node.connectedEdges().style('opacity', 0.1);
                Toast.warning(`已排除「${currentSelectedNode}」`);

                // 關閉詳情面板
                const detailPanel = document.getElementById('ws-detail');
                if (detailPanel) detailPanel.style.display = 'none';
            });
        }
    }

    // Cytoscape 工具列
    // ================================================================
    function setupCytoscapeToolbar() {
        const btnZoomIn = document.getElementById('btn-zoom-in');
        const btnZoomOut = document.getElementById('btn-zoom-out');
        const btnFit = document.getElementById('btn-fit');
        const btnCola = document.getElementById('btn-layout-cola');
        const btnGrid = document.getElementById('btn-layout-grid');
        const btnExportPng = document.getElementById('btn-export-png');

        if (btnZoomIn) btnZoomIn.addEventListener('click', () => {
            if (state.cy) state.cy.zoom(state.cy.zoom() * 1.3);
        });
        if (btnZoomOut) btnZoomOut.addEventListener('click', () => {
            if (state.cy) state.cy.zoom(state.cy.zoom() / 1.3);
        });
        if (btnFit) btnFit.addEventListener('click', () => {
            if (state.cy) state.cy.fit(undefined, 40);
        });
        if (btnCola) btnCola.addEventListener('click', () => runLayout('cola'));
        if (btnGrid) btnGrid.addEventListener('click', () => runLayout('grid'));
        if (btnExportPng) btnExportPng.addEventListener('click', exportGraphPng);
    }

    function exportGraphPng() {
        if (!state.cy) return;
        const png = state.cy.png({ full: true, scale: 2, bg: '#F0F0EE' });
        const a = document.createElement('a');
        a.href = png;
        a.download = `bedrock_graph_${Date.now()}.png`;
        a.click();
        Toast.success('圖片已匯出');
    }

    // ================================================================
    // 節點詳情面板
    // ================================================================
    function showNodeDetail(data) {
        const panel = document.getElementById('ws-detail');
        const title = document.getElementById('detail-title');
        const content = document.getElementById('detail-content');
        if (!panel || !title || !content) return;

        // 記錄當前選定的節點
        currentSelectedNode = data.id;

        title.textContent = data.label || data.id;
        panel.style.display = '';

        const isCompany = data.type === 'company';
        const riskLevel = data.risk_level || 'NONE';
        const riskColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#2980B9', NONE: '#27AE60' };
        const riskLabels = { CRITICAL: '高風險', WARNING: '中風險', INFO: '低風險', NONE: '正常' };
        const riskColor = riskColors[riskLevel] || '#27AE60';
        const riskLabel = riskLabels[riskLevel] || '正常';

        // 取得連線資訊
        const cyNode = state.cy ? state.cy.getElementById(data.id) : null;
        const edges = cyNode ? cyNode.connectedEdges() : [];
        const edgeCount = edges.length;

        // 組織連線詳情
        let connectionsHtml = '';
        if (edges.length > 0) {
            const edgeTypeLabels = {
                director: '董監事', representative: '法人代表',
                shareholder: '股東', historical: '歷史關聯',
            };
            connectionsHtml = edges.map(e => {
                const ed = e.data();
                const otherNodeId = ed.source === data.id ? ed.target : ed.source;
                const otherNode = state.cy.getElementById(otherNodeId);
                const otherLabel = otherNode.length ? otherNode.data('label') : otherNodeId;
                const direction = ed.source === data.id ? '→' : '←';
                const typeLabel = edgeTypeLabels[ed.type] || ed.type;
                return `
                    <div class="ws-detail-connection" style="padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.06); cursor:pointer;" onclick="(function(){ if(window.__bedrockCy) { var n = window.__bedrockCy.getElementById('${otherNodeId}'); if(n.length){ window.__bedrockCy.center(n); n.select(); } } })()">
                        <span style="color:#888; font-size:11px;">${direction}</span>
                        <span style="font-weight:500;">${esc(otherLabel)}</span>
                        <span style="background:rgba(58,124,165,0.12); color:#3A7CA5; font-size:10px; padding:1px 6px; border-radius:8px; margin-left:4px;">${esc(ed.label || typeLabel)}</span>
                    </div>`;
            }).join('');
        }

        // 紅旗詳情
        const flags = data.flags || [];
        const ruleNames = {
            'SHELL_COMPANY': '殼公司', 'RAPID_DISSOLVE': '快速註銷', 'PHOENIX_COMPANY': '鳳凰公司',
            'CIRCULAR_OWNERSHIP': '循環持股', 'NOMINEE_DIRECTOR': '代理董事', 'CAPITAL_ANOMALY': '資本異常',
            'ADDRESS_CLUSTER': '地址聚集', 'FREQUENT_CHANGE': '頻繁變更', 'DORMANT_REVIVAL': '休眠復甦',
            'CROSS_HOLDING': '交叉持股', 'AGE_ANOMALY': '年齡異常', 'MASS_DIRECTOR': '大量董事',
            'REGISTRATION_BURST': '註冊激增', 'STAR_STRUCTURE': '星形結構', 'BRIDGE_NODE': '橋接節點',
            'UBO_DEEP_PATH': 'UBO 深層路徑', 'CAPITAL_VOLATILITY': '資本劇烈跳動',
            'BATCH_REGISTRATION': '批量登記', 'DIRECTOR_MUSICAL_CHAIRS': '董事走馬燈',
            'UBO_CONCENTRATION': 'UBO 資本集中', 'HIDDEN_UBO': '隱藏實質受益人',
            'SUSPICIOUS_INDUSTRY_MIX': '異常產業組合', 'CROSS_INVESTIGATION': '跨調查關聯',
        };
        let flagsHtml = '';
        if (flags.length > 0) {
            flagsHtml = flags.map(f => {
                const sevColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#2980B9' };
                const sevLabels = { CRITICAL: '嚴重', WARNING: '警告', INFO: '資訊' };
                const c = sevColors[f.severity] || '#999';
                const sl = sevLabels[f.severity] || f.severity;
                const rn = ruleNames[f.rule_id] || f.rule_id;
                return `
                    <div style="padding:6px 0; border-left:3px solid ${c}; padding-left:8px; margin-bottom:4px;">
                        <div style="font-weight:600; font-size:12px;">
                            <span style="color:${c};">[${sl}]</span> ${esc(rn)}
                        </div>
                        <div style="font-size:11px; color:#666; margin-top:2px;">${esc(f.description || '')}</div>
                    </div>`;
            }).join('');
        }

        // 格式化資本額
        const capitalStr = data.capital != null
            ? `NT$ ${Number(data.capital).toLocaleString()}`
            : '未知';

        content.innerHTML = `
            <!-- 風險等級標籤 -->
            <div style="background:${riskColor}; color:white; padding:6px 12px; border-radius:6px; font-weight:600; font-size:13px; text-align:center; margin-bottom:12px;">
                ${riskLevel !== 'NONE' ? '⚠ ' : '✓ '}${riskLabel}${flags.length > 0 ? ` — ${flags.length} 項異常` : ''}
            </div>

            <div class="ws-detail-section">
                <div class="ws-detail-section-title">基本資料</div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">類型</span>
                    <span class="ws-detail-value">${isCompany ? '公司法人' : '自然人'}</span>
                </div>
                ${isCompany ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">統一編號</span>
                    <span class="ws-detail-value" style="font-family:monospace;">${esc(data.entity_id)}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">公司狀態</span>
                    <span class="ws-detail-value">${esc(data.status || '未知')}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">資本額</span>
                    <span class="ws-detail-value">${capitalStr}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">代表人</span>
                    <span class="ws-detail-value">${esc(data.representative || '未知')}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">登記地址</span>
                    <span class="ws-detail-value" style="font-size:11px; word-break:break-all;">${esc(data.address || '未知')}</span>
                </div>
                ` : `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">職稱</span>
                    <span class="ws-detail-value">${esc(data.title || '董監事')}</span>
                </div>
                `}
            </div>

            <div class="ws-detail-section">
                <div class="ws-detail-section-title">關聯架構 (${edgeCount})</div>
                ${connectionsHtml || '<div style="color:#999; font-size:12px;">無連線</div>'}
            </div>

            ${flags.length > 0 ? `
            <div class="ws-detail-section">
                <div class="ws-detail-section-title" style="color:${riskColor};">⚑ 異常原因 (${flags.length})</div>
                ${flagsHtml}
            </div>
            ` : ''}
        `;

        // 暴露 cy 給 onclick 導航用
        window.__bedrockCy = state.cy;

        // 加載風險評分
        loadNodeRiskScore(data.entity_id || data.id);
    }

    function closeDetail() {
        const panel = document.getElementById('ws-detail');
        if (panel) panel.style.display = 'none';
    }
    window.closeDetail = closeDetail;

    // 風險評分顯示
    async function loadNodeRiskScore(taxId) {
        if (!taxId) return;
        const scoreContainer = document.getElementById('node-risk-score');
        if (!scoreContainer) return;

        try {
            const data = await api.get(`/companies/${taxId}/risk-score`);

            const levelColors = {
                NORMAL: '#4ade80', NOTICE: '#60a5fa',
                WARNING: '#fbbf24', HIGH: '#f97316', CRITICAL: '#ef4444'
            };
            const levelLabels = {
                NORMAL: '正常', NOTICE: '留意',
                WARNING: '警告', HIGH: '高風險', CRITICAL: '極高風險'
            };

            const riskScore10 = Math.round((data.risk_score || 0)) / 10;
            const riskLevel = data.risk_level || 'NORMAL';
            const riskColor = levelColors[riskLevel] || '#4ade80';
            const riskLabelText = levelLabels[riskLevel] || '正常';

            // Indicator descriptions mapping
            const indicatorDescriptions = {
                '殼公司指標': '公司資本額極低、僅一名董事、或使用虛擬地址',
                '資本異常指標': '資本額有劇烈變動（暴增或驟降）',
                '地址聚集指標': '同一地址登記多家公司',
                '代理董事指標': '同一人擔任多家公司董事',
                '董事異動指標': '短期內頻繁更換代表人或董事',
                'UBO隱藏指標': '透過多層法人持股隱藏實質受益人',
                '生命週期指標': '公司快速成立又解散，或疑似鳳凰公司',
                '變更頻率指標': '公司登記資料變更異常頻繁',
                '循環持股指標': '偵測到 A→B→A 或 A→B→C→A 持股循環',
                '星形結構指標': '一人/實體控制多家公司的星形結構',
                '橋接節點指標': '連接不同群組的關鍵橋接節點',
            };

            // Build indicators HTML - only show non-zero indicators
            let indicatorsHtml = '';
            if (data.indicators && data.indicators.length > 0) {
                const activeIndicators = data.indicators.filter(i => i.normalized_score > 0);
                if (activeIndicators.length > 0) {
                    indicatorsHtml = `
                        <div style="margin-top:12px;">
                            <div style="font-weight:600; font-size:12px; color:#666; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:4px;">
                                風險指標明細（0-10 分）
                            </div>
                            ${activeIndicators.sort((a,b) => b.normalized_score - a.normalized_score).map(ind => {
                                const score10 = Math.round(ind.normalized_score * 10) / 10;
                                const fillPct = Math.min(100, ind.normalized_score * 10);
                                const barColor = ind.normalized_score >= 7 ? '#ef4444' :
                                               ind.normalized_score >= 4 ? '#f97316' :
                                               ind.normalized_score >= 2 ? '#fbbf24' : '#4ade80';
                                const desc = indicatorDescriptions[ind.name] || '';
                                const sevLabel = ind.normalized_score >= 7 ? '高' :
                                               ind.normalized_score >= 4 ? '中' : '低';
                                return `
                                    <div style="margin-bottom:10px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                                            <span style="font-size:12px; font-weight:600; color:#333;">${esc(ind.name)}</span>
                                            <span style="font-size:12px; font-weight:700; color:${barColor}; min-width:60px; text-align:right;">
                                                ${score10}/10
                                                <span style="font-size:10px; background:${barColor}22; color:${barColor}; padding:1px 4px; border-radius:3px; margin-left:2px;">${sevLabel}</span>
                                            </span>
                                        </div>
                                        <div style="height:6px; background:#f0f0f0; border-radius:3px; overflow:hidden;">
                                            <div style="height:100%; width:${fillPct}%; background:${barColor}; border-radius:3px; transition:width 0.3s;"></div>
                                        </div>
                                        ${desc ? `<div style="font-size:10px; color:#999; margin-top:2px;">${esc(desc)}</div>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `;
                }
            }

            // Cross-validation warnings
            let cvHtml = '';
            if (data.cross_validations && data.cross_validations.length > 0) {
                cvHtml = `
                    <div style="margin-top:10px; padding:8px; background:#fef2f2; border-radius:6px; border-left:3px solid #ef4444;">
                        <div style="font-size:11px; font-weight:700; color:#b91c1c; margin-bottom:4px;">⚠ 複合風險模式</div>
                        ${data.cross_validations.map(cv => `
                            <div style="font-size:11px; color:#7f1d1d; margin-bottom:2px;">
                                <span style="background:#ef444422; padding:0 4px; border-radius:2px; font-weight:600;">×${cv.multiplier}</span>
                                ${esc(cv.description)}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            scoreContainer.innerHTML = `
                <div style="padding:12px; background:#fafafa; border-radius:8px; border:1px solid #eee;">
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                        <div style="width:56px; height:56px; border-radius:50%; background:${riskColor}18; border:3px solid ${riskColor}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <span style="font-size:18px; font-weight:800; color:${riskColor};">${riskScore10.toFixed(1)}</span>
                        </div>
                        <div>
                            <div style="font-size:14px; font-weight:700; color:${riskColor};">${riskLabelText}</div>
                            <div style="font-size:11px; color:#999;">
                                綜合風險 ${riskScore10.toFixed(1)}/10
                                ${data.confidence ? ` · 信心度 ${data.confidence}` : ''}
                            </div>
                        </div>
                    </div>
                    ${data.summary ? `<div style="font-size:11px; color:#666; line-height:1.5; margin-bottom:8px; padding:6px 8px; background:#fff; border-radius:4px; border:1px solid #f0f0f0;">${esc(data.summary)}</div>` : ''}
                    ${indicatorsHtml}
                    ${cvHtml}
                </div>
            `;
            scoreContainer.style.display = '';
        } catch(e) {
            scoreContainer.innerHTML = '<div style="color:#999; font-size:12px; padding:8px;">風險評分暫無法計算</div>';
            scoreContainer.style.display = '';
        }
    }
    window.loadNodeRiskScore = loadNodeRiskScore;

    // ================================================================
    // 左側面板資料載入
    // ================================================================
    async function loadClusters(invId) {
        const listEl = document.getElementById('clusters-list');
        const countEl = document.getElementById('cluster-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/clusters`);
            const clusters = data.items || data || [];
            if (countEl) countEl.textContent = clusters.length;

            if (clusters.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">尚無集群，請先執行搜尋與分析</div>';
                return;
            }

            // 按 algorithm 分類顯示
            const algorithmLabels = {
                'address_cluster': { icon: '📍', label: '地址聚集' },
                'star_structure': { icon: '⭐', label: '星形控制' },
                'city_cluster': { icon: '🏙️', label: '地理群' },
                'shared_shareholder': { icon: '🔗', label: '共同股東' },
                'union_find': { icon: '🔗', label: '關聯群' },
            };

            listEl.innerHTML = clusters.map(c => {
                const algo = algorithmLabels[c.algorithm] || { icon: '📋', label: c.algorithm || '自訂' };
                const memberCount = (c.member_tax_ids || []).length;
                const confidence = c.confidence ? Math.round(c.confidence * 100) : 0;
                const confColor = confidence >= 70 ? '#C0392B' : confidence >= 40 ? '#E67E22' : '#95A5A6';
                return `
                    <div class="ws-list-item" onclick="highlightCluster(${JSON.stringify(c.member_tax_ids || []).replace(/"/g, '&quot;')})" style="cursor:pointer;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:14px;">${algo.icon}</span>
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.name || c.label || c.cluster_id}</div>
                                <div style="font-size:10px; color:#999;">${algo.label} · ${memberCount} 家 · 信心 <span style="color:${confColor};">${confidence}%</span></div>
                            </div>
                        </div>
                    </div>`;
            }).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入集群失敗:', e.message);
            if (countEl) countEl.textContent = '0';
            listEl.innerHTML = '<div class="ws-list-empty">尚無集群資料</div>';
        }
    }

    async function loadRedFlags(invId) {
        const listEl = document.getElementById('red-flags-list');
        const countEl = document.getElementById('flag-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/red-flags`);
            const flags = data.red_flags || data.items || [];
            if (countEl) countEl.textContent = data.total || flags.length;

            if (flags.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">尚無紅旗，請先執行搜尋與分析</div>';
                return;
            }

            // 紅旗名稱映射
            const ruleNames = {
                // 原始 13 條規則
                'SHELL_COMPANY': '殼公司',
                'RAPID_DISSOLVE': '快速註銷',
                'PHOENIX_COMPANY': '鳳凰公司',
                'CIRCULAR_OWNERSHIP': '循環持股',
                'NOMINEE_DIRECTOR': '代理董事',
                'CAPITAL_ANOMALY': '資本異常',
                'ADDRESS_CLUSTER': '地址聚集',
                'FREQUENT_CHANGE': '頻繁變更',
                'DORMANT_REVIVAL': '休眠復甦',
                'CROSS_HOLDING': '交叉持股',
                'AGE_ANOMALY': '年齡異常',
                'MASS_DIRECTOR': '大量董事',
                'REGISTRATION_BURST': '註冊激增',
                // 圖結構分析
                'STAR_STRUCTURE': '星形結構',
                'BRIDGE_NODE': '橋接節點',
                'UBO_DEEP_PATH': 'UBO 深層路徑',
                // 時序異常
                'CAPITAL_VOLATILITY': '資本劇烈跳動',
                'BATCH_REGISTRATION': '批量登記',
                // 歷史資料
                'DIRECTOR_MUSICAL_CHAIRS': '董事走馬燈',
                // 實質受益人
                'UBO_CONCENTRATION': 'UBO 資本集中',
                'HIDDEN_UBO': '隱藏實質受益人',
                // 產業組合
                'SUSPICIOUS_INDUSTRY_MIX': '異常產業組合',
                // 跨調查
                'CROSS_INVESTIGATION': '跨調查關聯',
            };
            const severityColors = {
                'CRITICAL': 'var(--risk-high)',
                'WARNING': 'var(--risk-medium)',
                'INFO': 'var(--risk-low)',
            };
            const severityLabels = {
                'CRITICAL': '嚴重',
                'WARNING': '警告',
                'INFO': '資訊',
            };

            listEl.innerHTML = flags.map(f => {
                const ruleName = ruleNames[f.rule_id] || f.rule_id;
                const desc = (f.detail && f.detail.description) || '';
                const color = severityColors[f.severity] || '#999';
                const sevLabel = severityLabels[f.severity] || f.severity;
                return `
                    <div class="ws-list-item" style="border-left: 3px solid ${color};">
                        <div class="ws-list-item-title">
                            <span style="color:${color}; font-weight:600;">[${sevLabel}]</span>
                            ${esc(ruleName)}
                        </div>
                        <div class="ws-list-item-sub">${esc(desc)}</div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入紅旗失敗:', e.message);
            listEl.innerHTML = '<div class="ws-list-empty">載入失敗</div>';
            if (countEl) countEl.textContent = '0';
        }
    }

    async function loadMedia(invId) {
        const listEl = document.getElementById('media-list');
        const countEl = document.getElementById('media-count');
        if (!listEl) return;

        // 先清空，避免顯示前一個調查的資料
        listEl.innerHTML = '<div class="ws-list-empty">尚無負面新聞</div>';
        if (countEl) countEl.textContent = '0';

        try {
            const data = await api.get(`/investigations/${invId}/media`);
            // API 回傳格式: { total, verdicts: [...] }
            let items = [];
            if (data && Array.isArray(data.verdicts)) items = data.verdicts;
            else if (data && Array.isArray(data.items)) items = data.items;
            else if (Array.isArray(data)) items = data;

            if (items.length === 0) {
                if (countEl) countEl.textContent = '0';
                listEl.innerHTML = '<div class="ws-list-empty">尚無負面新聞</div>';
                return;
            }
            if (countEl) countEl.textContent = items.length;
            renderSidebarList(listEl, items, m => m.source_title || m.title || '未知', m => {
                try { return m.source_url ? new URL(m.source_url).hostname : (m.source || ''); }
                catch { return m.source || ''; }
            });
        } catch (e) {
            console.warn('[BEDROCK] 載入負面新聞失敗:', e.message);
        }
    }

    function renderSidebarList(container, items, titleFn, subFn) {
        if (items.length === 0) {
            container.innerHTML = '<div class="ws-list-empty">暫無資料</div>';
            return;
        }
        container.innerHTML = items.map(item => `
            <div class="ws-list-item">
                <div class="ws-list-item-title">${esc(titleFn(item))}</div>
                <div class="ws-list-item-sub">${esc(subFn(item))}</div>
            </div>
        `).join('');
    }

    // 搜尋負面新聞
    async function searchNegativeNews() {
        if (!state.currentInvId) {
            Toast.warning('請先選擇一個調查案件');
            return;
        }

        const btnSearch = document.getElementById('btn-search-media');
        if (!btnSearch) return;

        const originalText = btnSearch.innerHTML;
        btnSearch.disabled = true;
        btnSearch.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 搜尋中…';

        try {
            Toast.success('已開始搜尋負面新聞，此操作可能需要 1-2 分鐘…');
            const result = await api.post(`/investigations/${state.currentInvId}/media/search`, {});
            Toast.success(`搜尋完成，找到 ${result.count || 0} 則報導`);
            await loadMedia(state.currentInvId);
        } catch (e) {
            console.warn('[BEDROCK] 搜尋負面新聞失敗:', e.message);
            Toast.error('搜尋失敗: ' + e.message);
        } finally {
            btnSearch.disabled = false;
            btnSearch.innerHTML = originalText;
        }
    }
    window.searchNegativeNews = searchNegativeNews;

    // ================================================================
    // 爬取控制
    // ================================================================
    function setupCrawlControls() {
        const btnStart = document.getElementById('btn-start-crawl');
        const btnPause = document.getElementById('btn-pause-crawl');
        const btnStop = document.getElementById('btn-stop-crawl');
        const seedInput = document.getElementById('seed-input');
        const btnAddSeed = document.getElementById('btn-add-seed');
        const progressEl = document.getElementById('crawl-progress');

        if (btnStart) {
            btnStart.addEventListener('click', async () => {
                if (!state.currentInvId) return;
                try {
                    const depthSelect = document.getElementById('crawl-depth');
                    const maxDepth = depthSelect ? parseInt(depthSelect.value) : 3;
                    await api.post(`/investigations/${state.currentInvId}/crawl/start`, { max_depth: maxDepth || 0 });
                    state.crawling = true;
                    updateCrawlUI();
                    Toast.success('搜尋已開始，自動追蹤關聯企業…');
                    pollCrawlProgress();
                } catch (e) {
                    console.error('[BEDROCK] 啟動爬取失敗:', e.message);
                    Toast.error('啟動搜尋失敗: ' + e.message);
                }
            });
        }

        if (btnPause) {
            btnPause.addEventListener('click', async () => {
                try {
                    await api.post(`/investigations/${state.currentInvId}/crawl/pause`);
                    Toast.warning('搜尋已暫停');
                } catch (e) {
                    console.warn('[BEDROCK] 暫停失敗:', e.message);
                    Toast.error('暫停失敗: ' + e.message);
                }
                state.crawling = false;
                if (state._pollTimer) { clearTimeout(state._pollTimer); state._pollTimer = null; }
                updateCrawlUI();
            });
        }

        if (btnStop) {
            btnStop.addEventListener('click', async () => {
                try {
                    await api.post(`/investigations/${state.currentInvId}/crawl/stop`);
                    Toast.warning('搜尋已停止');
                } catch (e) {
                    console.warn('[BEDROCK] 停止失敗:', e.message);
                    Toast.error('停止失敗: ' + e.message);
                }
                state.crawling = false;
                if (state._pollTimer) { clearTimeout(state._pollTimer); state._pollTimer = null; }
                updateCrawlUI();
            });
        }

        if (btnAddSeed && seedInput) {
            btnAddSeed.addEventListener('click', () => addSeed(seedInput.value.trim()));
            seedInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') addSeed(seedInput.value.trim());
            });
        }
    }

    async function addSeed(value) {
        if (!value || !state.currentInvId) return;

        // 判斷種子類型：8 位數字 = 統編，否則 = 公司名或人名
        let seedType = 'company';
        if (/^\d{8}$/.test(value)) {
            seedType = 'tax_id';
        }

        try {
            await api.post(`/investigations/${state.currentInvId}/seeds`, {
                seed_type: seedType,
                seed_value: value,
            });
            Toast.success(`已新增查詢目標: ${value}（${seedType === 'tax_id' ? '統編' : '公司名'}）`);
            // 重新載入種子列表
            if (state.currentInvId) loadSeeds(state.currentInvId);
        } catch (e) {
            console.warn('[BEDROCK] 新增種子失敗:', e.message);
            Toast.error('新增查詢目標失敗: ' + e.message);
        }
        const seedInput = document.getElementById('seed-input');
        if (seedInput) seedInput.value = '';
    }

    function updateCrawlUI() {
        const btnStart = document.getElementById('btn-start-crawl');
        const btnPause = document.getElementById('btn-pause-crawl');
        const btnStop = document.getElementById('btn-stop-crawl');
        const progressEl = document.getElementById('crawl-progress');

        if (btnStart) btnStart.disabled = state.crawling;
        if (btnPause) btnPause.disabled = !state.crawling;
        if (btnStop) btnStop.disabled = !state.crawling;
        if (progressEl) progressEl.style.display = state.crawling ? '' : 'none';
    }

    function simulateCrawl() {
        let progress = 0;
        const fill = document.getElementById('crawl-progress-fill');
        const text = document.getElementById('crawl-progress-text');
        const interval = setInterval(() => {
            if (!state.crawling || progress >= 100) {
                clearInterval(interval);
                state.crawling = false;
                updateCrawlUI();
                if (progress >= 100) Toast.success('搜尋完成');
                return;
            }
            progress += Math.random() * 8;
            if (progress > 100) progress = 100;
            if (fill) fill.style.width = progress + '%';
            if (text) text.textContent = `${Math.floor(progress)}%`;
        }, 800);
    }

    async function pollCrawlProgress() {
        if (!state.crawling || !state.currentInvId) return;
        try {
            const data = await api.get(`/investigations/${state.currentInvId}/crawl/status`);
            const fill = document.getElementById('crawl-progress-fill');
            const text = document.getElementById('crawl-progress-text');
            const progressEl = document.getElementById('crawl-progress');
            const pct = data.percentage || 0;
            const processed = data.nodes_processed || 0;
            const discovered = data.nodes_discovered || 0;
            const entity = data.current_entity || '';

            if (fill) fill.style.width = pct + '%';
            if (progressEl) progressEl.setAttribute('aria-valuenow', pct);
            if (text) {
                const depthInfo = data.current_depth ? ` · 第 ${data.current_depth}/${data.max_depth || '?'} 層` : '';
                text.textContent = `${processed}/${discovered} 節點 (${pct}%)${depthInfo}${entity ? ' — ' + entity : ''}`;
            }

            // === 即時更新關聯圖（每次 poll 都刷新，讓使用者看到圖慢慢長出來）===
            if (processed > 0 && state.cy) {
                try {
                    const graphData = await api.get(`/investigations/${state.currentInvId}/graph`);
                    if (graphData && graphData.elements && graphData.elements.length > 0) {
                        // 增量更新：只加入新節點/邊，避免重新 layout 已有節點
                        const existingIds = new Set();
                        state.cy.elements().forEach(el => existingIds.add(el.id()));
                        const newElements = graphData.elements.filter(el => !existingIds.has(el.data.id));
                        if (newElements.length > 0) {
                            state.cy.add(newElements);
                            // 對新加入的節點做局部 layout
                            const newNodes = state.cy.nodes().filter(n => !existingIds.has(n.id()));
                            if (newNodes.length > 0 && state.cy.nodes().length <= 150) {
                                state.cy.layout({
                                    name: 'cola',
                                    animate: true,
                                    animationDuration: 300,
                                    nodeSpacing: 30,
                                    edgeLength: 120,
                                    randomize: false,
                                    avoidOverlap: true,
                                    fit: state.cy.nodes().length <= 20,
                                }).run();
                            }
                            // 隱藏空狀態
                            const emptyState = document.getElementById('cy-empty-state');
                            if (emptyState) emptyState.style.display = 'none';
                        }
                    }
                } catch (graphErr) {
                    console.warn('[BEDROCK] 即時圖更新失敗:', graphErr.message);
                }
            }

            if (data.status === 'completed' || data.status === 'stopped') {
                state.crawling = false;
                updateCrawlUI();
                // 顯示完整摘要
                const msg = data.error_message
                    ? `搜尋完成（${processed} 節點）\n${data.error_message}`
                    : `搜尋完成：發現 ${discovered} 個關聯、處理 ${processed} 個節點`;
                Toast.success(msg);
                if (fill) fill.style.width = '100%';
                if (text) text.textContent = `完成 — ${processed} 個節點`;
                loadInvestigationData(state.currentInvId);
                _hintDismissed = false;  // 搜尋完成後重新顯示引導
                updateWorkflowStepper('analyze');
                state._analysisTimer = setTimeout(() => runAnalysis(), 1000);
                return;
            }
            if (data.status === 'error') {
                state.crawling = false;
                updateCrawlUI();
                Toast.error('搜尋錯誤: ' + (data.error_message || '未知'));
                return;
            }
        } catch (e) {
            console.warn('[BEDROCK] 查詢進度失敗:', e.message);
        }
        if (state.crawling) {
            state._pollTimer = setTimeout(() => pollCrawlProgress(), 2000);
        }
    }

    // ================================================================
    // 圖結構分析
    // ================================================================
    function setupAnalysis() {
        const btnAnalyze = document.getElementById('btn-analyze');
        if (btnAnalyze) {
            btnAnalyze.addEventListener('click', () => runAnalysis(true));
        }
    }

    async function runAnalysis(markCompleted = false) {
        if (!state.currentInvId) return;

        // 顯示分析進度條（複用 crawl progress UI）
        const fill = document.getElementById('crawl-progress-fill');
        const text = document.getElementById('crawl-progress-text');
        const progressEl = document.getElementById('crawl-progress');
        if (progressEl) progressEl.style.display = '';
        if (fill) fill.style.width = '10%';
        if (text) text.textContent = '分析中 — 星形結構偵測…';

        const steps = [
            { pct: '20%', label: '循環持股偵測…' },
            { pct: '35%', label: '橋接節點偵測…' },
            { pct: '50%', label: 'UBO 深層路徑分析…' },
            { pct: '65%', label: '地址聚集偵測…' },
            { pct: '80%', label: '資本異常偵測…' },
        ];

        // 模擬分階段進度（後端是同步一次算完，前端模擬分階段）
        let stepIdx = 0;
        const stepTimer = setInterval(() => {
            if (stepIdx < steps.length) {
                if (fill) fill.style.width = steps[stepIdx].pct;
                if (text) text.textContent = `分析中 — ${steps[stepIdx].label}`;
                stepIdx++;
            }
        }, 1500);

        try {
            const analyzeUrl = `/investigations/${state.currentInvId}/analyze${markCompleted ? '?mark_completed=true' : ''}`;
            const result = await api.post(analyzeUrl, null, 120000);
            clearInterval(stepTimer);

            const count = result.total_anomalies || 0;
            const flagsSaved = result.red_flags_saved || 0;

            if (fill) fill.style.width = '100%';
            if (text) text.textContent = `分析完成 — ${count} 個異常、${flagsSaved} 個紅旗`;
            Toast.success(`分析完成：發現 ${count} 個異常，寫入 ${flagsSaved} 個紅旗`);

            // 重新載入所有側邊欄資料（紅旗 + 集群 + 媒體）
            loadRedFlags(state.currentInvId);
            loadClusters(state.currentInvId);
            loadMedia(state.currentInvId);

            // 更新 stepper 到 review 步驟
            _hintDismissed = false;
            updateWorkflowStepper('review');

            // 如果紅旗數量較多（>30），自動打開分析儀表板
            if (flagsSaved > 30) {
                setTimeout(() => openAnalysisDashboard(), 500);
            }

            // 在圖上標記有紅旗的節點
            if (state.cy && result.anomalies) {
                result.anomalies.forEach(a => {
                    const targetId = a.target_id;
                    if (targetId) {
                        const node = state.cy.getElementById(targetId);
                        if (node && node.length) {
                            node.data('flagged', true);
                        }
                    }
                });
            }

            // 3 秒後隱藏進度條
            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
            }, 3000);
        } catch (e) {
            clearInterval(stepTimer);
            console.warn('[BEDROCK] 分析失敗:', e.message);
            Toast.error('分析失敗: ' + e.message);
            if (fill) fill.style.width = '0%';
            if (text) text.textContent = '分析失敗';
            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
            }, 3000);
        }
    }

    // ================================================================
    // 匯出報告
    // ================================================================
    function setupExport() {
        const btnExport = document.getElementById('btn-export');
        if (btnExport) {
            btnExport.addEventListener('click', async (e) => {
                if (!state.currentInvId) return;

                // 顯示導出格式選擇菜單
                const menu = document.createElement('div');
                menu.className = 'export-menu';
                menu.style.position = 'absolute';
                menu.style.background = '#fff';
                menu.style.border = '1px solid #e0ddd8';
                menu.style.borderRadius = '6px';
                menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                menu.style.zIndex = '1000';
                menu.style.minWidth = '120px';

                const formats = [
                    { name: 'HTML', ext: 'html', icon: 'fa-file-code' },
                    { name: 'PDF', ext: 'pdf', icon: 'fa-file-pdf' },
                    { name: 'JSON', ext: 'json', icon: 'fa-code' },
                ];

                formats.forEach(fmt => {
                    const item = document.createElement('button');
                    item.style.display = 'flex';
                    item.style.alignItems = 'center';
                    item.style.gap = '10px';
                    item.style.width = '100%';
                    item.style.padding = '10px 15px';
                    item.style.background = 'none';
                    item.style.border = 'none';
                    item.style.cursor = 'pointer';
                    item.style.textAlign = 'left';
                    item.style.color = '#333';
                    item.style.transition = 'all 0.2s';
                    item.innerHTML = `<i class="fas ${fmt.icon}" style="width:20px;"></i>${fmt.name}`;

                    item.addEventListener('mouseover', () => {
                        item.style.background = '#f5f5f3';
                    });
                    item.addEventListener('mouseout', () => {
                        item.style.background = 'none';
                    });

                    item.addEventListener('click', async () => {
                        await exportInvestigation(fmt.ext);
                        document.body.removeChild(menu);
                    });

                    menu.appendChild(item);
                });

                // 定位菜單
                const rect = btnExport.getBoundingClientRect();
                menu.style.top = (rect.bottom + 5) + 'px';
                menu.style.right = (window.innerWidth - rect.right) + 'px';

                document.body.appendChild(menu);

                // 點擊外部關閉
                const closeMenu = () => {
                    if (document.body.contains(menu)) {
                        document.body.removeChild(menu);
                    }
                    document.removeEventListener('click', closeMenu);
                };
                setTimeout(() => {
                    document.addEventListener('click', closeMenu);
                }, 0);
            });
        }
    }

    async function exportInvestigation(format) {
        if (!state.currentInvId) return;

        try {
            Toast.show(`正在產生 ${format.toUpperCase()} 報告…`, 'info');
            const res = await fetch(API_BASE + `/investigations/${state.currentInvId}/export/${format}`, {
                method: 'GET',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || '匯出失敗');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bedrock_report_${state.currentInvId}.${format}`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success(`報告已匯出為 ${format.toUpperCase()}`);
        } catch (e) {
            console.warn('[BEDROCK] 匯出失敗:', e.message);
            Toast.error('匯出失敗: ' + e.message);
        }
    }
    window.exportInvestigation = exportInvestigation;

    // ================================================================
    // 分析儀表板
    // ================================================================
    let _dashboardData = null;
    let _dashboardFilterInGraph = false;  // 是否只顯示圖內的

    function openAnalysisDashboard() {
        if (!state.currentInvId) {
            Toast.warning('請先選擇一個調查案件');
            return;
        }
        const overlay = document.getElementById('analysis-dashboard-overlay');
        if (overlay) overlay.style.display = 'flex';
        loadAnalysisDashboard();
    }
    window.openAnalysisDashboard = openAnalysisDashboard;

    function closeAnalysisDashboard() {
        const overlay = document.getElementById('analysis-dashboard-overlay');
        if (overlay) overlay.style.display = 'none';
    }
    window.closeAnalysisDashboard = closeAnalysisDashboard;

    async function loadAnalysisDashboard() {
        try {
            const data = await api.get(`/investigations/${state.currentInvId}/analysis-dashboard`);
            _dashboardData = data;
            renderAnalysisDashboard(data);
        } catch (e) {
            console.warn('[BEDROCK] 載入分析儀表板失敗:', e.message);
            Toast.error('載入分析儀表板失敗: ' + e.message);
        }
    }

    /** 檢查 target 是否在當前 cytoscape 圖上 */
    function isTargetInGraph(targetId) {
        if (!state.cy || !targetId) return false;
        // 嘗試直接 ID match
        const direct = state.cy.getElementById(targetId);
        if (direct && direct.length > 0) return true;
        // 嘗試 entity_id match
        const byEntity = state.cy.nodes().filter(n => n.data('entity_id') === targetId);
        return byEntity.length > 0;
    }

    function renderAnalysisDashboard(data) {
        // 嚴重程度卡
        const el = (id) => document.getElementById(id);
        el('ad-total').textContent = data.total_flags || 0;
        el('ad-critical').textContent = (data.severity_summary || {}).CRITICAL || 0;
        el('ad-warning').textContent = (data.severity_summary || {}).WARNING || 0;
        el('ad-info').textContent = (data.severity_summary || {}).INFO || 0;

        // 分類群組
        renderCategoryGroups(data.category_groups || {});

        // Top 10
        renderTopFindings(data.top_critical || []);

        // 實體熱點
        renderEntityHotspots(data.entity_hotspots || []);
    }

    function renderCategoryGroups(groups) {
        const container = document.getElementById('analysis-category-list');
        if (!container) return;

        const catColorMap = {
            structure: '#6366F1',
            capital: '#F59E0B',
            temporal: '#8B5CF6',
            industry: '#10B981',
            cross_inv: '#EF4444',
            other: '#6B7280',
        };

        // 按 order 排序
        const sorted = Object.entries(groups).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));

        if (sorted.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--color-text-muted); font-size:0.85rem;">尚無分析結果，請先執行分析</div>';
            return;
        }

        container.innerHTML = sorted.map(([catKey, cat]) => {
            const sev = cat.by_severity || {};
            const sevText = [];
            if (sev.CRITICAL) sevText.push(`<span style="color:var(--color-danger);">${sev.CRITICAL} 嚴重</span>`);
            if (sev.WARNING) sevText.push(`<span style="color:var(--color-warning);">${sev.WARNING} 警告</span>`);
            if (sev.INFO) sevText.push(`<span style="color:var(--color-success);">${sev.INFO} 資訊</span>`);

            const rules = cat.rules || [];
            const rulesHtml = rules.map(r => {
                const rSev = r.by_severity || {};
                const dots = [];
                if (rSev.CRITICAL) dots.push(`<span class="sev-dot critical" title="${rSev.CRITICAL} 嚴重"></span>`);
                if (rSev.WARNING) dots.push(`<span class="sev-dot warning" title="${rSev.WARNING} 警告"></span>`);
                if (rSev.INFO) dots.push(`<span class="sev-dot info" title="${rSev.INFO} 資訊"></span>`);

                // 範例
                const samples = (r.sample_flags || []).map(s => {
                    const desc = (s.detail && s.detail.description) || s.target_id || '';
                    const inGraph = isTargetInGraph(s.target_id);
                    const badge = inGraph ? '' : '<span class="out-of-scope-badge">圖外</span>';
                    return `<div class="analysis-sample-item" onclick="dashboardHighlightTarget('${esc(s.target_id || '')}', '${esc(s.target_type || '')}')">
                        <span style="color:${s.severity === 'CRITICAL' ? 'var(--color-danger)' : s.severity === 'WARNING' ? 'var(--color-warning)' : 'var(--color-success)'};">●</span>
                        ${esc(desc.substring(0, 80))}${desc.length > 80 ? '…' : ''}
                        ${badge}
                    </div>`;
                }).join('');

                return `
                    <div class="analysis-rule-row" onclick="toggleRuleSamples(this)">
                        <span class="analysis-rule-name">${esc(r.label)}</span>
                        <div class="analysis-rule-severity-dots">${dots.join('')}</div>
                        <span class="analysis-rule-count">${r.count}</span>
                    </div>
                    <div class="analysis-rule-samples">${samples || '<div style="font-size:0.72rem; color:var(--color-text-muted); padding:4px;">無範例</div>'}</div>
                `;
            }).join('');

            return `
                <div class="analysis-cat-card" onclick="toggleCatCard(event, this)">
                    <div class="analysis-cat-header">
                        <div class="analysis-cat-icon cat-${catKey}">
                            <i class="fas ${cat.icon || 'fa-flag'}"></i>
                        </div>
                        <div class="analysis-cat-info">
                            <div class="analysis-cat-name">${esc(cat.label)}</div>
                            <div class="analysis-cat-stats">${cat.total} 筆 · ${sevText.join(' / ') || '無'}</div>
                        </div>
                        <span class="analysis-cat-arrow"><i class="fas fa-chevron-right"></i></span>
                    </div>
                    <div class="analysis-cat-body" onclick="event.stopPropagation()">
                        ${rulesHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderTopFindings(topList) {
        const container = document.getElementById('analysis-top-list');
        if (!container) return;

        if (topList.length === 0) {
            container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--color-text-muted); font-size:0.82rem;">尚無紅旗</div>';
            return;
        }

        container.innerHTML = topList.map((f, idx) => {
            const desc = (f.detail && f.detail.description) || '';
            const rankClass = f.severity === 'CRITICAL' ? 'rank-critical' : f.severity === 'WARNING' ? 'rank-warning' : '';
            const inGraph = isTargetInGraph(f.target_id);
            const badge = inGraph ? '' : '<span class="out-of-scope-badge">圖外</span>';

            return `
                <div class="analysis-top-item" onclick="dashboardHighlightTarget('${esc(f.target_id || '')}', '${esc(f.target_type || '')}')">
                    <div class="analysis-top-rank ${rankClass}">${idx + 1}</div>
                    <div class="analysis-top-content">
                        <div class="analysis-top-title">
                            <span style="color:${f.severity === 'CRITICAL' ? 'var(--color-danger)' : f.severity === 'WARNING' ? 'var(--color-warning)' : 'var(--color-success)'};">[${f.severity === 'CRITICAL' ? '嚴重' : f.severity === 'WARNING' ? '警告' : '資訊'}]</span>
                            ${esc(f.rule_label)}
                        </div>
                        <div class="analysis-top-desc" title="${esc(desc)}">${esc(desc.substring(0, 60))}${desc.length > 60 ? '…' : ''}</div>
                    </div>
                    ${badge}
                </div>
            `;
        }).join('');
    }

    function renderEntityHotspots(hotspots) {
        const container = document.getElementById('analysis-hotspot-list');
        if (!container) return;

        if (hotspots.length === 0) {
            container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--color-text-muted); font-size:0.82rem;">尚無實體資料</div>';
            return;
        }

        const maxCount = Math.max(...hotspots.map(h => h.flag_count));

        container.innerHTML = hotspots.map(h => {
            const barColor = h.critical > 0 ? 'var(--color-danger)' : h.warning > 0 ? 'var(--color-warning)' : 'var(--color-success)';
            const typeLabel = h.target_type === 'company' ? '公司' : h.target_type === 'person' ? '自然人' : h.target_type;
            const inGraph = isTargetInGraph(h.target_id);
            const badge = inGraph ? '' : '<span class="out-of-scope-badge">圖外</span>';
            const rulesSummary = (h.rules || []).length + ' 種類型';

            return `
                <div class="analysis-hotspot-item" onclick="dashboardHighlightTarget('${esc(h.target_id || '')}', '${esc(h.target_type || '')}')">
                    <div class="analysis-hotspot-bar" style="background:${barColor};"></div>
                    <div class="analysis-hotspot-info">
                        <div class="analysis-hotspot-name">${esc(h.target_id)}</div>
                        <div class="analysis-hotspot-meta">${typeLabel} · ${rulesSummary} · ${h.critical || 0} 嚴重 ${h.warning || 0} 警告</div>
                    </div>
                    ${badge}
                    <div class="analysis-hotspot-count">${h.flag_count}</div>
                </div>
            `;
        }).join('');
    }

    /** 點擊紅旗 → 在圖上高亮對應節點 */
    function dashboardHighlightTarget(targetId, targetType) {
        if (!targetId) return;

        // 關閉儀表板 overlay
        closeAnalysisDashboard();

        if (!state.cy) {
            Toast.warning('圖譜尚未載入');
            return;
        }

        // 清除之前的高亮
        state.cy.nodes().removeClass('marked');

        // 嘗試找到節點
        let node = state.cy.getElementById(targetId);
        if (!node || node.length === 0) {
            // 嘗試用 entity_id
            const byEntity = state.cy.nodes().filter(n => n.data('entity_id') === targetId);
            if (byEntity.length > 0) {
                node = byEntity;
            }
        }

        if (node && node.length > 0) {
            node.addClass('marked');
            state.cy.animate({
                fit: { eles: node, padding: 100 },
                duration: 500,
            });
            Toast.show(`已定位到 ${targetId}`, 'info');
        } else {
            Toast.warning(`「${targetId}」不在目前顯示的圖上（可能被深度篩選過濾，或屬於其他調查案件）`);
        }
    }
    window.dashboardHighlightTarget = dashboardHighlightTarget;

    /** 切換只顯示圖內紅旗 */
    function toggleDashboardInGraphFilter(checked) {
        _dashboardFilterInGraph = checked;
        if (_dashboardData) renderAnalysisDashboard(_dashboardData);
    }
    window.toggleDashboardInGraphFilter = toggleDashboardInGraphFilter;

    /** 切換大類卡片展開/收合 */
    function toggleCatCard(event, card) {
        // 不要在 body 內觸發
        if (event.target.closest('.analysis-cat-body')) return;
        card.classList.toggle('expanded');
    }
    window.toggleCatCard = toggleCatCard;

    /** 切換子規則範例顯示 */
    function toggleRuleSamples(ruleRow) {
        event.stopPropagation();
        ruleRow.classList.toggle('expanded');
    }
    window.toggleRuleSamples = toggleRuleSamples;

    // ================================================================
    // 引導步驟流程 (Workflow Stepper)
    // ================================================================
    const WORKFLOW_STEPS = ['seed', 'crawl', 'analyze', 'review'];
    let _currentWorkflowStep = 'seed';
    let _hintDismissed = false;

    /** 根據調查狀態與資料來判斷目前的工作流步驟 */
    function detectWorkflowStep() {
        if (!state.currentInv) return 'seed';

        const inv = state.currentInv;
        const nodeCount = inv.node_count || 0;
        const flagCount = inv.red_flag_count || 0;
        const status = inv.status || 'draft';

        // 已完成 → review
        if (status === 'completed') return 'review';
        // 有紅旗 → review (可能是跑完分析了)
        if (flagCount > 0) return 'review';
        // 有節點但沒紅旗 → analyze
        if (nodeCount > 0 && flagCount === 0) return 'analyze';
        // 搜尋中
        if (status === 'crawling') return 'crawl';
        // 分析中
        if (status === 'analyzing') return 'analyze';
        // 草稿 → 看有沒有 seeds
        return 'seed';
    }

    function updateWorkflowStepper(stepOverride) {
        const step = stepOverride || detectWorkflowStep();
        _currentWorkflowStep = step;

        const stepOrder = { seed: 0, crawl: 1, analyze: 2, review: 3 };
        const currentIdx = stepOrder[step] || 0;

        WORKFLOW_STEPS.forEach((s, idx) => {
            const el = document.getElementById(`wf-step-${s}`);
            if (!el) return;
            el.classList.remove('active', 'done');
            if (idx < currentIdx) {
                el.classList.add('done');
            } else if (idx === currentIdx) {
                el.classList.add('active');
            }
        });

        // 更新連接線
        for (let i = 1; i <= 3; i++) {
            const line = document.getElementById(`wf-line-${i}`);
            if (line) {
                line.classList.toggle('done', i <= currentIdx);
            }
        }

        // 替 done step 的數字改成勾號
        WORKFLOW_STEPS.forEach((s, idx) => {
            const numEl = document.querySelector(`#wf-step-${s} .workflow-step-num`);
            if (!numEl) return;
            if (idx < currentIdx) {
                numEl.innerHTML = '<i class="fas fa-check" style="font-size:9px;"></i>';
            } else {
                numEl.textContent = idx + 1;
            }
        });

        // 顯示引導提示
        if (!_hintDismissed) {
            showWorkflowHint(step);
        }
    }

    function showWorkflowHint(step) {
        const bar = document.getElementById('workflow-hint-bar');
        const text = document.getElementById('workflow-hint-text');
        const btnText = document.getElementById('workflow-hint-btn-text');
        if (!bar || !text || !btnText) return;

        const hints = {
            seed: { text: '步驟 1/4：請在左側輸入統一編號或公司名，新增調查目標。', btn: '新增目標', show: true },
            crawl: { text: '步驟 2/4：調查目標已新增完成。點擊「開始」按鈕搜尋關聯企業網路。', btn: '開始搜尋', show: true },
            analyze: { text: '步驟 3/4：搜尋完成！點擊「分析」偵測可疑模式與紅旗。', btn: '執行分析', show: true },
            review: { text: '步驟 4/4：分析完成！打開儀表板檢視歸納後的結果，或匯出報告。', btn: '開啟儀表板', show: true },
        };

        const hint = hints[step];
        if (!hint || !hint.show) {
            bar.style.display = 'none';
            return;
        }

        text.textContent = hint.text;
        btnText.textContent = hint.btn;
        bar.style.display = 'flex';
    }

    function executeWorkflowHint() {
        switch (_currentWorkflowStep) {
            case 'seed':
                // 聚焦到輸入框
                const seedInput = document.getElementById('seed-input');
                if (seedInput) seedInput.focus();
                break;
            case 'crawl':
                // 點擊開始搜尋
                const btnCrawl = document.getElementById('btn-start-crawl');
                if (btnCrawl && !btnCrawl.disabled) btnCrawl.click();
                break;
            case 'analyze':
                // 點擊分析
                const btnAnalyze = document.getElementById('btn-analyze');
                if (btnAnalyze) btnAnalyze.click();
                break;
            case 'review':
                openAnalysisDashboard();
                break;
        }
        dismissWorkflowHint();
    }
    window.executeWorkflowHint = executeWorkflowHint;

    function dismissWorkflowHint() {
        _hintDismissed = true;
        const bar = document.getElementById('workflow-hint-bar');
        if (bar) bar.style.display = 'none';
    }
    window.dismissWorkflowHint = dismissWorkflowHint;

    // ================================================================
    // 工具函式
    // ================================================================
    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(d) {
        if (!d) return '';
        try {
            const dt = new Date(d);
            return dt.toLocaleDateString('zh-TW');
        } catch {
            return d;
        }
    }

    // ================================================================
    // 新導航系統（v3.0）
    // ================================================================
    function switchNavItem(event) {
        event.preventDefault();
        const navItem = event.currentTarget;
        const navName = navItem.dataset.nav;

        // 更新 active 狀態
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        navItem.classList.add('active');

        // 根據導航項切換頁面（如需要）
        switch (navName) {
            case 'overview':
            case 'investigations':
                showScene('welcome');
                if (navName === 'investigations') {
                    switchWelcomeTab('investigations');
                }
                loadInvestigations();
                break;
            case 'reports':
                showScene('welcome');
                switchWelcomeTab('investigations');
                break;
            case 'settings':
            case 'users':
            case 'audit':
                showScene('welcome');
                switchWelcomeTab('admin');
                const adminTabMap = { settings: 'settings', users: 'users', audit: 'audit' };
                if (adminTabMap[navName]) {
                    switchAdminTab(adminTabMap[navName]);
                }
                break;
        }
    }
    window.switchNavItem = switchNavItem;

    function toggleUserMenu() {
        const dropdown = document.getElementById('user-menu-dropdown') || document.getElementById('user-menu-dropdown-welcome');
        if (dropdown) {
            dropdown.style.display = dropdown.style.display === 'none' ? '' : 'none';
        }
    }
    window.toggleUserMenu = toggleUserMenu;

    function handleUserSettings() {
        Toast.show('使用者設定（功能建設中）', 'info');
        toggleUserMenu();
    }
    window.handleUserSettings = handleUserSettings;

    function handleLogout() {
        if (confirm('確定要登出嗎？')) {
            state.user = null;
            localStorage.removeItem('bedrock_session');
            showScene('login');
            toggleUserMenu();
            Toast.success('已登出');
        }
    }
    window.handleLogout = handleLogout;

    function switchAdminTab(tabName) {
        const adminTabs = document.querySelectorAll('.admin-tab');
        const adminPanels = document.querySelectorAll('.admin-panel');

        adminTabs.forEach(tab => {
            tab.classList.remove('admin-tab-active');
            tab.setAttribute('aria-selected', 'false');
        });
        adminPanels.forEach(panel => {
            panel.classList.remove('admin-panel-active');
            panel.style.display = 'none';
        });

        const activeTab = document.getElementById('admin-tab-' + tabName);
        const activePanel = document.getElementById('admin-' + tabName + '-panel');

        if (activeTab) {
            activeTab.classList.add('admin-tab-active');
            activeTab.setAttribute('aria-selected', 'true');
        }
        if (activePanel) {
            activePanel.classList.add('admin-panel-active');
            activePanel.style.display = '';
        }

        if (tabName === 'users' || tabName === 'audit') {
            loadAdminData();
        }
        if (tabName === 'keywords') {
            loadKeywords();
        }
    }
    window.switchAdminTab = switchAdminTab;

    function filterInvestigations(filter) {
        state.investigationsFilter = filter;

        // 更新按鈕狀態
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('filter-btn-active');
            if (btn.dataset.filter === filter) {
                btn.classList.add('filter-btn-active');
            }
        });

        renderInvestigations();
    }
    window.filterInvestigations = filterInvestigations;

    function openNewInvestigationModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.style.display = '';
    }
    window.openNewInvestigationModal = openNewInvestigationModal;

    function confirmNewInvestigation() {
        const btnConfirm = document.getElementById('btn-confirm-new');
        if (btnConfirm) btnConfirm.click();
    }
    window.confirmNewInvestigation = confirmNewInvestigation;

    // ================================================================
    // 初始化
    // ================================================================
    function init() {
        console.log('[BEDROCK] 磐石 EDD 平台 v3.0 啟動');
        showScene('login');
        setupLogin();
        setupNewInvestigation();
        setupDashboardControls();
        setupCrawlControls();
        setupAnalysis();
        setupExport();
        setupAdminTabs();
        setupKeywordControls();
        setupWorkspaceMediaSearch();
        setupNodeOperationButtons();

        // 延遲檢查是否跳過登入，確保 UI 已準備好
        setTimeout(() => {
            checkAndSkipLogin();
        }, 100);
    }

    // 圖例顯示/隱藏
    function toggleLegend() {
        const legend = document.getElementById('graph-legend');
        if (legend) {
            const isVisible = legend.style.display !== 'none';
            legend.style.display = isVisible ? 'none' : '';
        }
    }
    window.toggleLegend = toggleLegend;

    // 歷史關聯顯示/隱藏
    let showHistorical = true;
    function toggleHistoricalEdges() {
        if (!state.cy) return;
        showHistorical = !showHistorical;
        const historicalEdges = state.cy.edges('[type="historical"]');
        if (showHistorical) {
            historicalEdges.style('display', 'element');
            Toast.show('已顯示歷史關聯', 'info');
        } else {
            historicalEdges.style('display', 'none');
            Toast.show('已隱藏歷史關聯', 'info');
        }
        // Update button state
        const btn = document.getElementById('btn-toggle-historical');
        if (btn) {
            btn.classList.toggle('ws-tool-btn-active', showHistorical);
            btn.title = showHistorical ? '隱藏歷史關聯' : '顯示歷史關聯';
        }
    }
    window.toggleHistoricalEdges = toggleHistoricalEdges;

    // 歷史關聯時間範圍篩選
    function filterHistoricalByRange() {
        if (!state.cy) return;
        const rangeSelect = document.getElementById('historical-range');
        const years = rangeSelect ? parseInt(rangeSelect.value) : 0;

        const historicalEdges = state.cy.edges('[type="historical"]');

        if (!years || years === 0) {
            // Show all historical edges (if toggle is on)
            if (showHistorical) {
                historicalEdges.style('display', 'element');
            }
            Toast.show(`顯示所有歷史關聯`, 'info');
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

        historicalEdges.forEach(edge => {
            const endDate = edge.data('end_date') || edge.data('dissolved_date');
            if (endDate) {
                const edgeDate = new Date(endDate);
                if (edgeDate >= cutoffDate) {
                    edge.style('display', showHistorical ? 'element' : 'none');
                } else {
                    edge.style('display', 'none');
                }
            } else {
                // No date info — show by default
                edge.style('display', showHistorical ? 'element' : 'none');
            }
        });
        Toast.show(`篩選 ${years} 年內的歷史關聯`, 'info');
    }
    window.filterHistoricalByRange = filterHistoricalByRange;

    // 面板展開/收合 + 更新 grid-template-columns
    function updateGridColumns() {
        const body = document.querySelector('.workspace-body');
        if (!body) return;
        const sidebarCollapsed = document.querySelector('.ws-sidebar.collapsed');
        const detailCollapsed = document.querySelector('.ws-detail.collapsed');
        if (sidebarCollapsed && detailCollapsed) {
            body.style.gridTemplateColumns = '40px 1fr 40px';
        } else if (sidebarCollapsed) {
            body.style.gridTemplateColumns = '40px 1fr minmax(200px, 360px)';
        } else if (detailCollapsed) {
            body.style.gridTemplateColumns = 'minmax(200px, 260px) 1fr 40px';
        } else {
            body.style.gridTemplateColumns = '';  // 回到 CSS 預設
        }
    }

    function toggleSidebar() {
        const sidebar = document.querySelector('.ws-sidebar');
        const btn = document.getElementById('btn-collapse-sidebar');
        if (!sidebar || !btn) return;
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        btn.textContent = isCollapsed ? '▶' : '◀';
        btn.title = isCollapsed ? '展開左側面板' : '收合左側面板';
        updateGridColumns();
        if (state.cy) setTimeout(() => state.cy.resize(), 100);
    }
    window.toggleSidebar = toggleSidebar;

    function toggleDetailPanel() {
        const panel = document.getElementById('ws-detail');
        const btn = document.getElementById('btn-collapse-detail');
        if (!panel || !btn) return;
        panel.classList.toggle('collapsed');
        const isCollapsed = panel.classList.contains('collapsed');
        btn.textContent = isCollapsed ? '◀' : '▶';
        btn.title = isCollapsed ? '展開右側面板' : '收合右側面板';
        updateGridColumns();
        if (state.cy) setTimeout(() => state.cy.resize(), 100);
    }
    window.toggleDetailPanel = toggleDetailPanel;

    // ==================== 深度減法篩選 ====================
    // 從 seed 節點出發 BFS，計算每個節點的距離（hop），超過指定值則隱藏

    /**
     * 計算 Cytoscape 圖中所有節點到 seed 的 BFS 距離
     * @returns {Map<string, number>} nodeId → hop count
     */
    function computeNodeDepths() {
        if (!state.cy) return new Map();

        const depthMap = new Map();
        const visited = new Set();
        const queue = [];

        // 取得 seed 節點的 entity_id
        const seedItems = document.querySelectorAll('.ws-seed-item');
        const seedValues = new Set();
        seedItems.forEach(el => {
            const onclick = el.getAttribute('onclick') || '';
            const match = onclick.match(/focusSeedNode\('(.+?)'\)/);
            if (match) seedValues.add(match[1]);
        });

        // 在圖中找到 seed 節點（seed 距離 = 0）
        state.cy.nodes().forEach(node => {
            const d = node.data();
            const entityId = d.entity_id || d.id;
            if (seedValues.has(entityId) || seedValues.has(d.label)) {
                depthMap.set(node.id(), 0);
                visited.add(node.id());
                queue.push(node);
            }
        });

        // BFS
        while (queue.length > 0) {
            const current = queue.shift();
            const currentDepth = depthMap.get(current.id());

            // 遍歷鄰居（不管邊的方向）
            current.neighborhood('node').forEach(neighbor => {
                if (!visited.has(neighbor.id())) {
                    visited.add(neighbor.id());
                    depthMap.set(neighbor.id(), currentDepth + 1);
                    queue.push(neighbor);
                }
            });
        }

        // 未連通的節點給一個大數值
        state.cy.nodes().forEach(node => {
            if (!depthMap.has(node.id())) {
                depthMap.set(node.id(), 999);
            }
        });

        return depthMap;
    }

    // 快取 depth map（圖結構不變時不重算）
    let _cachedDepthMap = null;
    let _cachedNodeCount = 0;

    function getDepthMap() {
        const nodeCount = state.cy ? state.cy.nodes().length : 0;
        if (!_cachedDepthMap || _cachedNodeCount !== nodeCount) {
            _cachedDepthMap = computeNodeDepths();
            _cachedNodeCount = nodeCount;
        }
        return _cachedDepthMap;
    }

    function invalidateDepthCache() {
        _cachedDepthMap = null;
        _cachedNodeCount = 0;
    }

    function filterByDepth(maxDepth) {
        if (!state.cy) return;
        maxDepth = parseInt(maxDepth);
        const label = document.getElementById('depth-filter-label');
        const slider = document.getElementById('depth-filter-slider');

        const depthMap = getDepthMap();
        const actualMax = Math.max(...[...depthMap.values()].filter(v => v < 999));

        // 更新 slider max 為實際最大深度
        if (slider && actualMax > 0 && actualMax < 100) {
            slider.max = Math.max(actualMax, 2);
        }

        if (maxDepth >= actualMax || maxDepth >= 10) {
            // 全部顯示
            state.cy.nodes().style('display', 'element');
            state.cy.edges().style('display', 'element');
            if (label) label.textContent = '全部';
            return;
        }

        if (label) label.textContent = `${maxDepth} 層`;

        // 隱藏超過深度的節點與其相連的邊
        let shown = 0, hidden = 0;
        state.cy.nodes().forEach(node => {
            const depth = depthMap.get(node.id()) || 999;
            if (depth <= maxDepth) {
                node.style('display', 'element');
                shown++;
            } else {
                node.style('display', 'none');
                hidden++;
            }
        });

        // 邊：兩端都可見才顯示
        state.cy.edges().forEach(edge => {
            const srcDepth = depthMap.get(edge.source().id()) || 999;
            const tgtDepth = depthMap.get(edge.target().id()) || 999;
            if (srcDepth <= maxDepth && tgtDepth <= maxDepth) {
                edge.style('display', 'element');
            } else {
                edge.style('display', 'none');
            }
        });

        Toast.show(`顯示 ${maxDepth} 層內 ${shown} 個節點（隱藏 ${hidden} 個）`, 'info');
    }
    window.filterByDepth = filterByDepth;

    function resetDepthFilter() {
        const slider = document.getElementById('depth-filter-slider');
        const label = document.getElementById('depth-filter-label');
        if (slider) slider.value = slider.max || 10;
        if (label) label.textContent = '全部';
        invalidateDepthCache();
        if (state.cy) {
            state.cy.nodes().style('display', 'element');
            state.cy.edges().style('display', 'element');
        }
        Toast.show('已重設為顯示全部層', 'info');
    }
    window.resetDepthFilter = resetDepthFilter;

    // 高亮集群內的節點（點擊集群列表時觸發）
    function highlightCluster(memberTaxIds) {
        if (!state.cy || !memberTaxIds || memberTaxIds.length === 0) return;

        // 先清除之前的高亮
        state.cy.nodes().removeClass('marked');

        // 高亮集群成員
        const memberSet = new Set(memberTaxIds);
        let matched = 0;
        state.cy.nodes().forEach(node => {
            const entityId = node.data('entity_id') || node.data('id');
            if (memberSet.has(entityId)) {
                node.addClass('marked');
                matched++;
            }
        });

        // 自動聚焦到這些節點
        const markedNodes = state.cy.nodes('.marked');
        if (markedNodes.length > 0) {
            state.cy.animate({
                fit: { eles: markedNodes, padding: 60 },
                duration: 500,
            });
        }
        Toast.show(`已標記 ${matched} 個集群成員`, 'info');
    }
    window.highlightCluster = highlightCluster;

    // 設置管理頁籤切換
    function setupAdminTabs() {
        try {
            const adminTabs = document.querySelectorAll('.admin-tab');
            const adminPanels = document.querySelectorAll('.admin-panel');

            adminTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    try {
                        const tabId = tab.id;
                        if (!tabId) return;
                        const panelId = tabId.replace('admin-tab-', 'admin-') + '-panel';

                        adminTabs.forEach(t => {
                            t.classList.remove('admin-tab-active');
                            t.setAttribute('aria-selected', 'false');
                        });
                        adminPanels.forEach(p => p.style.display = 'none');

                        tab.classList.add('admin-tab-active');
                        tab.setAttribute('aria-selected', 'true');
                        const panel = document.getElementById(panelId);
                        if (panel) panel.style.display = '';

                        // Load data for specific tabs
                        const tabName = tabId.replace('admin-tab-', '');
                        if (tabName === 'users' || tabName === 'audit') {
                            loadAdminData();
                        }
                        if (tabName === 'keywords') {
                            loadKeywords();
                        }
                    } catch(e) {
                        console.error('[BEDROCK] Admin tab click error:', e);
                    }
                });
            });
        } catch(e) {
            console.error('[BEDROCK] setupAdminTabs error:', e);
        }
    }

    // 設置關鍵字管理控制
    function setupKeywordControls() {
        const btnAddKeyword = document.getElementById('btn-add-keyword');
        if (btnAddKeyword) {
            btnAddKeyword.addEventListener('click', addKeyword);
        }
    }

    // 設置工作台的負面新聞搜尋按鈕
    function setupWorkspaceMediaSearch() {
        const btnSearchMedia = document.getElementById('btn-search-media');
        if (btnSearchMedia) {
            btnSearchMedia.addEventListener('click', searchNegativeNews);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
