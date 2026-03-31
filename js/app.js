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
        async request(method, path, body) {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            // 未來加入 JWT token
            // const token = sessionStorage.getItem('bedrock_token');
            // if (token) opts.headers['Authorization'] = `Bearer ${token}`;
            if (body) opts.body = JSON.stringify(body);

            const res = await fetch(API_BASE + path, opts);
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            return res.json();
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
    };

    // ================================================================
    // 登入邏輯（暫時 mock，Auth 最後加）
    // ================================================================
    function setupLogin() {
        const btnLogin = document.getElementById('btn-login');
        const inputEmail = document.getElementById('input-email');
        const inputPassword = document.getElementById('input-password');

        if (!btnLogin) return;

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
            // 使用 demo 資料
            state.investigations = getDemoInvestigations();
        }

        renderInvestigations();
    }

    function getDemoInvestigations() {
        return [
            {
                id: 'demo-1',
                title: 'EGOpay 集團關聯調查',
                description: '追蹤 EGOpay 集團核心人物與關聯企業之間的所有權、董監事交叉持股關係',
                status: 'crawling',
                node_count: 47,
                red_flag_count: 12,
                created_at: '2026-03-15',
                updated_at: '2026-03-28',
            },
            {
                id: 'demo-2',
                title: '國際地產洗錢通道篩查',
                description: '針對可疑跨境不動產交易鏈進行 EDD 調查，涵蓋台灣與東南亞關聯公司',
                status: 'draft',
                node_count: 0,
                red_flag_count: 0,
                created_at: '2026-03-29',
                updated_at: '2026-03-29',
            },
            {
                id: 'demo-3',
                title: '虛擬貨幣交易所合規審查',
                description: '調查某虛擬貨幣交易所的實際控制人與資金流向，評估洗錢風險',
                status: 'completed',
                node_count: 83,
                red_flag_count: 5,
                created_at: '2026-02-10',
                updated_at: '2026-03-20',
            },
        ];
    }

    function renderInvestigations() {
        const listEl = document.getElementById('investigations-list');
        if (!listEl) return;

        if (state.investigations.length === 0) {
            listEl.innerHTML = `
                <div style="grid-column: 1/-1; text-align:center; padding:48px; color:var(--text-caption);">
                    <i class="fas fa-folder-open" style="font-size:2rem; margin-bottom:12px; display:block;"></i>
                    尚無調查案件，點擊「新增調查」開始
                </div>`;
            return;
        }

        listEl.innerHTML = state.investigations.map(inv => {
            const statusMap = {
                draft: '草稿',
                crawling: '爬取中',
                analyzing: '分析中',
                completed: '已完成',
            };
            const statusLabel = statusMap[inv.status] || inv.status;
            const statusClass = `status-${inv.status || 'draft'}`;

            return `
                <div class="investigation-card" data-id="${inv.id}" onclick="openInvestigation('${inv.id}')">
                    <div class="investigation-card-header">
                        <span class="investigation-card-title">${esc(inv.title)}</span>
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="investigation-card-desc">${esc(inv.description || '')}</div>
                    <div class="investigation-card-footer">
                        <span class="investigation-card-meta">
                            ${inv.node_count || 0} 節點 · ${inv.red_flag_count || 0} 紅旗
                        </span>
                        <span class="investigation-card-meta">${formatDate(inv.updated_at)}</span>
                    </div>
                </div>
            `;
        }).join('');
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
                const seed = document.getElementById('new-inv-seed').value.trim();

                if (!title) {
                    Toast.warning('請輸入案件名稱');
                    return;
                }

                try {
                    const inv = await api.post('/investigations', {
                        title,
                        description: desc,
                        initial_seed: seed || null,
                    });
                    Toast.success('調查案件已建立');
                    closeModal();
                    await loadInvestigations();
                    if (inv && inv.id) openInvestigation(inv.id);
                } catch (e) {
                    console.warn('[BEDROCK] 建立失敗:', e.message);
                    // Demo fallback
                    const fakeId = 'demo-' + Date.now();
                    state.investigations.unshift({
                        id: fakeId,
                        title,
                        description: desc,
                        status: 'draft',
                        node_count: 0,
                        red_flag_count: 0,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    });
                    renderInvestigations();
                    closeModal();
                    Toast.success('調查案件已建立（離線模式）');
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

    // ================================================================
    // 調查工作台
    // ================================================================
    function openInvestigation(id) {
        state.currentInvId = id;
        state.currentInv = state.investigations.find(i => i.id === id) || { title: '調查案件', status: 'draft' };

        // 更新工作台標題
        const wsTitle = document.getElementById('ws-title');
        const wsStatus = document.getElementById('ws-status');
        if (wsTitle) wsTitle.textContent = state.currentInv.title;
        if (wsStatus) {
            const statusMap = { draft: '草稿', crawling: '爬取中', analyzing: '分析中', completed: '已完成' };
            wsStatus.textContent = statusMap[state.currentInv.status] || '草稿';
        }

        showScene('workspace');
        initCytoscape();
        loadInvestigationData(id);
    }
    window.openInvestigation = openInvestigation;

    async function loadInvestigationData(id) {
        try {
            const data = await api.get(`/investigations/${id}/graph`);
            if (data && data.elements) {
                renderGraph(data.elements);
            }
        } catch (e) {
            console.warn('[BEDROCK] 載入圖資料失敗:', e.message);
            renderDemoGraph();
        }

        // 載入集群、紅旗、負面新聞
        loadClusters(id);
        loadRedFlags(id);
        loadMedia(id);
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
                        'border-color': '#E0DDD8',
                        'text-max-width': '80px',
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
        runLayout('cola');
    }

    function renderDemoGraph() {
        if (!state.cy) return;

        const nodes = [
            { data: { id: 'c1', label: 'EGOpay Holdings', type: 'company', size: 40, color: '#3A7CA5' } },
            { data: { id: 'c2', label: '宏偉科技有限公司', type: 'company', size: 32, color: '#3A7CA5' } },
            { data: { id: 'c3', label: '金流國際股份有限公司', type: 'company', size: 32, color: '#3A7CA5', flagged: true } },
            { data: { id: 'c4', label: '遠東投資顧問', type: 'company', size: 28, color: '#3A7CA5' } },
            { data: { id: 'c5', label: 'Pacific Trade Ltd', type: 'company', size: 28, color: '#3A7CA5' } },
            { data: { id: 'p1', label: '張大明', type: 'person', size: 36, color: '#B8860B', flagged: true } },
            { data: { id: 'p2', label: '李小華', type: 'person', size: 30, color: '#B8860B' } },
            { data: { id: 'p3', label: '王建國', type: 'person', size: 30, color: '#B8860B' } },
            { data: { id: 'p4', label: '陳美玲', type: 'person', size: 26, color: '#B8860B' } },
            { data: { id: 'p5', label: 'David Chen', type: 'person', size: 26, color: '#B8860B' } },
        ];

        const edges = [
            { data: { source: 'p1', target: 'c1', label: '董事長', type: 'director' } },
            { data: { source: 'p1', target: 'c2', label: '實質受益人', type: 'ownership' } },
            { data: { source: 'p1', target: 'c3', label: '監察人', type: 'director' } },
            { data: { source: 'p2', target: 'c1', label: '董事', type: 'director' } },
            { data: { source: 'p2', target: 'c4', label: '負責人', type: 'director' } },
            { data: { source: 'p3', target: 'c2', label: '總經理', type: 'director' } },
            { data: { source: 'p3', target: 'c3', label: '董事', type: 'director' } },
            { data: { source: 'p4', target: 'c4', label: '股東', type: 'ownership' } },
            { data: { source: 'p5', target: 'c5', label: 'Director', type: 'director' } },
            { data: { source: 'c1', target: 'c3', label: '持股 60%', type: 'ownership' } },
            { data: { source: 'c1', target: 'c5', label: '子公司', type: 'ownership' } },
            { data: { source: 'c4', target: 'c2', label: '投資', type: 'ownership' } },
        ];

        state.cy.add([...nodes, ...edges]);
        runLayout('cola');
    }

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
        content.innerHTML = `
            <div class="ws-detail-section">
                <div class="ws-detail-section-title">基本資料</div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">類型</span>
                    <span class="ws-detail-value">${isCompany ? '公司' : '自然人'}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">ID</span>
                    <span class="ws-detail-value">${esc(data.id)}</span>
                </div>
                ${data.flagged ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">紅旗</span>
                    <span class="ws-detail-value" style="color:var(--risk-high);">⚑ 已標記</span>
                </div>` : ''}
            </div>
            <div class="ws-detail-section">
                <div class="ws-detail-section-title">關聯</div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">連線數</span>
                    <span class="ws-detail-value">${state.cy ? state.cy.getElementById(data.id).connectedEdges().length : 0}</span>
                </div>
            </div>
        `;
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
            // Demo 資料
            const demo = [
                { name: '核心持股集團', node_count: 5 },
                { name: '海外關聯公司', node_count: 3 },
            ];
            if (countEl) countEl.textContent = demo.length;
            renderSidebarList(listEl, demo, c => c.name, c => `${c.node_count} 節點`);
        }
    }

    async function loadRedFlags(invId) {
        const listEl = document.getElementById('red-flags-list');
        const countEl = document.getElementById('flag-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/red-flags`);
            const flags = data.items || data || [];
            if (countEl) countEl.textContent = flags.length;
            renderSidebarList(listEl, flags, f => f.rule_name, f => f.description);
        } catch (e) {
            const demo = [
                { rule_name: '大量資本額變更', description: '公司 EGOpay 在 2 年內變更資本額 5 次' },
                { rule_name: '年輕董事異常', description: '張大明 25 歲即擔任 3 家公司董事' },
                { rule_name: '同地址多公司', description: '信義路四段 100 號有 4 家關聯公司' },
            ];
            if (countEl) countEl.textContent = demo.length;
            renderSidebarList(listEl, demo, f => f.rule_name, f => f.description);
        }
    }

    async function loadMedia(invId) {
        const listEl = document.getElementById('media-list');
        const countEl = document.getElementById('media-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/media`);
            const items = data.items || data || [];
            if (countEl) countEl.textContent = items.length;
            renderSidebarList(listEl, items, m => m.title, m => m.source);
        } catch (e) {
            const demo = [
                { title: 'EGOpay 涉詐騙案遭搜索', source: '聯合新聞網 2026-01' },
                { title: '金流國際負責人遭約談', source: '自由時報 2025-11' },
            ];
            if (countEl) countEl.textContent = demo.length;
            renderSidebarList(listEl, demo, m => m.title, m => m.source);
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
                    Toast.success('爬取已開始');
                    pollCrawlProgress();
                } catch (e) {
                    // Demo mode
                    state.crawling = true;
                    updateCrawlUI();
                    Toast.success('爬取已開始（模擬模式）');
                    simulateCrawl();
                }
            });
        }

        if (btnPause) {
            btnPause.addEventListener('click', async () => {
                try {
                    await api.post(`/investigations/${state.currentInvId}/crawl/pause`);
                } catch (e) {}
                state.crawling = false;
                updateCrawlUI();
                Toast.warning('爬取已暫停');
            });
        }

        if (btnStop) {
            btnStop.addEventListener('click', async () => {
                try {
                    await api.post(`/investigations/${state.currentInvId}/crawl/stop`);
                } catch (e) {}
                state.crawling = false;
                updateCrawlUI();
                Toast.warning('爬取已停止');
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
        try {
            await api.post(`/investigations/${state.currentInvId}/seeds`, { value });
            Toast.success(`已新增種子: ${value}`);
        } catch (e) {
            Toast.success(`已新增種子: ${value}（離線模式）`);
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
                if (progress >= 100) Toast.success('爬取完成');
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
            if (fill) fill.style.width = (data.percentage || 0) + '%';
            if (text) text.textContent = `${data.node_count || 0} 節點`;
            if (data.status === 'completed' || data.status === 'stopped') {
                state.crawling = false;
                updateCrawlUI();
                Toast.success('爬取完成');
                loadInvestigationData(state.currentInvId);
                return;
            }
        } catch (e) {}
        if (state.crawling) setTimeout(() => pollCrawlProgress(), 3000);
    }

    // ================================================================
    // 匯出報告
    // ================================================================
    function setupExport() {
        const btnExport = document.getElementById('btn-export');
        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                if (!state.currentInvId) return;
                try {
                    Toast.show('正在產生報告…', 'info');
                    const res = await fetch(API_BASE + `/investigations/${state.currentInvId}/export/pdf`, {
                        method: 'GET',
                    });
                    if (!res.ok) throw new Error('匯出失敗');
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `bedrock_report_${state.currentInvId}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                    Toast.success('報告已匯出');
                } catch (e) {
                    Toast.warning('匯出功能尚未連接後端');
                }
            });
        }
    }

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
        setupCrawlControls();
        setupExport();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
