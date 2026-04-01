/**
 * BEDROCK 磐石 — 前端應用程式 v2.0
 * Enhanced Due Diligence Platform
 *
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
            state.user = { email: 'dev@bedrock.local', name: 'Developer' };
            updateGreeting();
            showScene('welcome');
            loadInvestigations();
        }
    }

    function updateGreeting() {
        const el = document.getElementById('welcome-greeting');
        if (!el || !state.user) return;

        const hour = new Date().getHours();
        let greeting;
        if (hour < 12) greeting = 'Good morning';
        else if (hour < 18) greeting = 'Good afternoon';
        else greeting = 'Good evening';

        const name = state.user.name || 'Investigator';
        el.textContent = `${greeting}, ${name}.`;

        const navUser = document.getElementById('nav-username');
        if (navUser) navUser.textContent = name;
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

            // 只有 0 節點的調查才顯示刪除按鈕
            const nodeCount = inv.node_count || 0;
            const showDelete = nodeCount === 0;

            return `
                <div class="investigation-card" data-id="${inv.id}">
                    <div class="investigation-card-header">
                        <div style="flex: 1; cursor: pointer;" onclick="openInvestigation('${inv.id}')">
                            <span class="investigation-card-title">${esc(inv.title)}</span>
                        </div>
                        <div style="display: flex; gap: 12px; align-items: start;">
                            <span class="status-badge ${statusClass}">${statusLabel}</span>
                            ${showDelete ? `<button class="btn-card-delete" data-id="${inv.id}" onclick="deleteInvestigation(event, '${inv.id}')" aria-label="刪除調查" title="刪除此調查"><i class="fas fa-trash-alt"></i></button>` : ''}
                        </div>
                    </div>
                    <div class="investigation-card-desc" onclick="openInvestigation('${inv.id}')" style="cursor: pointer;">${esc(inv.description || '')}</div>
                    <div class="investigation-card-footer" onclick="openInvestigation('${inv.id}')" style="cursor: pointer;">
                        <span class="investigation-card-meta">
                            ${nodeCount} 節點 · ${inv.red_flag_count || 0} 紅旗
                        </span>
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
                const title = document.getElementById('new-inv-title').value.trim();
                const desc = document.getElementById('new-inv-desc').value.trim();
                const seedType = document.getElementById('new-inv-seed-type')?.value || 'company';
                const seed = document.getElementById('new-inv-seed').value.trim();

                if (!title) {
                    Toast.warning('請輸入案件名稱');
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

    // 刪除調查（只有 0 節點的調查可以刪除）
    async function deleteInvestigation(event, invId) {
        event.stopPropagation();  // 防止觸發卡片的 openInvestigation

        const confirmed = confirm('確定要刪除此調查案件嗎？此動作無法復原。');
        if (!confirmed) return;

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
        await checkSearXNGStatus();
    }

    async function loadAdminUsers() {
        const tbody = document.getElementById('admin-users-tbody');
        if (!tbody) return;

        try {
            // Mock 使用者資料
            const users = [
                { id: 1, name: 'Alice Chen', email: 'alice@bedrock.tw', role: '管理員', created_at: '2024-01-15' },
                { id: 2, name: 'Bob Wang', email: 'bob@bedrock.tw', role: '分析師', created_at: '2024-02-01' },
                { id: 3, name: 'Mitch Lee', email: 'mitch@bedrock.tw', role: '調查員', created_at: '2024-01-20' },
            ];

            tbody.innerHTML = users.map(u => `
                <tr>
                    <td>${esc(u.name)}</td>
                    <td>${esc(u.email)}</td>
                    <td>${esc(u.role)}</td>
                    <td>${formatDate(u.created_at)}</td>
                    <td>
                        <button class="admin-action-btn" style="margin-right:8px;">編輯</button>
                        <button class="admin-action-btn" style="color:#B22D20;">刪除</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
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
            // Mock 稽核資料
            const audits = [
                { timestamp: new Date(Date.now() - 3600000).toISOString(), user: 'Alice Chen', action: 'create_investigation', resource: 'INV-001', status: 'success' },
                { timestamp: new Date(Date.now() - 7200000).toISOString(), user: 'Bob Wang', action: 'start_crawl', resource: 'INV-001', status: 'success' },
                { timestamp: new Date(Date.now() - 10800000).toISOString(), user: 'Mitch Lee', action: 'add_seed', resource: 'INV-001', status: 'success' },
            ];

            tbody.innerHTML = audits.map(a => {
                const actionMap = {
                    'create_investigation': '建立調查',
                    'start_crawl': '啟動爬蟲',
                    'add_seed': '新增種子',
                    'analyze': '執行分析',
                    'export': '匯出報告',
                };
                return `
                    <tr>
                        <td>${formatDate(a.timestamp)}</td>
                        <td>${esc(a.user)}</td>
                        <td>${actionMap[a.action] || a.action}</td>
                        <td>${esc(a.resource)}</td>
                        <td><span class="status-badge status-${a.status}">${a.status === 'success' ? '成功' : '失敗'}</span></td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#B22D20;">載入失敗: ${esc(e.message)}</td></tr>`;
        }
    }

    async function checkSearXNGStatus() {
        const statusEl = document.getElementById('searxng-status');
        const testBtn = document.getElementById('btn-searxng-test');

        if (statusEl) {
            try {
                // Mock 檢測 SearXNG 連線狀態
                const isConnected = Math.random() > 0.3; // 70% 連線成功
                if (isConnected) {
                    statusEl.innerHTML = '<span class="status-badge status-success">已連線</span>';
                } else {
                    statusEl.innerHTML = '<span class="status-badge status-error">未連線</span>';
                }
            } catch (e) {
                statusEl.innerHTML = '<span class="status-badge status-error">檢測失敗</span>';
            }
        }

        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                testBtn.textContent = '連線測試中…';
                try {
                    // Mock 連線測試
                    await new Promise(r => setTimeout(r, 1500));
                    Toast.success('SearXNG 連線正常');
                    if (statusEl) statusEl.innerHTML = '<span class="status-badge status-success">已連線</span>';
                } catch (e) {
                    Toast.error('SearXNG 連線失敗');
                    if (statusEl) statusEl.innerHTML = '<span class="status-badge status-error">未連線</span>';
                } finally {
                    testBtn.disabled = false;
                    testBtn.innerHTML = '<i class="fas fa-plug"></i> 連線測試';
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

            const typeLabels = { tax_id: '統編', company: '公司', person: '人名' };
            listEl.innerHTML = seeds.map(s => `
                <div class="ws-list-item ws-seed-item" data-seed-id="${s.id}">
                    <div class="ws-list-item-title">
                        <span class="ws-seed-type">${typeLabels[s.seed_type] || s.seed_type}</span>
                        ${esc(s.seed_value)}
                    </div>
                    <div class="ws-list-item-sub">${formatDate(s.created_at)}</div>
                </div>
            `).join('');
        } catch (e) {
            console.warn('[BEDROCK] 載入種子失敗:', e.message);
            if (countEl) countEl.textContent = '0';
            listEl.innerHTML = '<div class="ws-list-empty">載入失敗</div>';
        }
    }

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
    }

    function closeDetail() {
        const panel = document.getElementById('ws-detail');
        if (panel) panel.style.display = 'none';
    }
    window.closeDetail = closeDetail;

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
            renderSidebarList(listEl, clusters, c => c.name, c => `${c.node_count || 0} 節點`);
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
                    await api.post(`/investigations/${state.currentInvId}/crawl/start`);
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
                text.textContent = `${processed}/${discovered} 節點 (${pct}%)${entity ? ' — ' + entity : ''}`;
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
            btnAnalyze.addEventListener('click', () => runAnalysis());
        }
    }

    async function runAnalysis() {
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
            const result = await api.post(`/investigations/${state.currentInvId}/analyze`, null, 120000);
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
    // 初始化
    // ================================================================
    function init() {
        console.log('[BEDROCK] 磐石 EDD 平台 v2.0 啟動');
        showScene('login');
        setupLogin();
        setupNewInvestigation();
        setupDashboardControls();
        setupCrawlControls();
        setupAnalysis();
        setupExport();
        setupAdminTabs();
        setupWorkspaceMediaSearch();

        // 延遲檢查是否跳過登入，確保 UI 已準備好
        setTimeout(() => {
            checkAndSkipLogin();
        }, 100);
    }

    // 設置管理頁籤切換
    function setupAdminTabs() {
        const adminTabs = document.querySelectorAll('.admin-tab');
        const adminPanels = document.querySelectorAll('.admin-panel');

        adminTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.id;
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
            });
        });
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
