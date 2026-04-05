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

            const headers = {};
            // GET / HEAD 不需要 Content-Type（避免觸發不必要的 CORS preflight）
            if (body) headers['Content-Type'] = 'application/json';

            // 帶上 JWT token（如有）
            const token = auth.getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const opts = {
                method,
                headers,
                credentials: 'include',  // 跨域帶 cookie（refresh token）
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
                // 提供更好的錯誤訊息（網路錯誤 vs CORS 錯誤）
                if (e instanceof TypeError && e.message === 'Failed to fetch') {
                    throw new Error('無法連線到伺服器，請檢查網路或稍後重試');
                }
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
        const scenes = ['login', 'register', 'welcome', 'workspace'];
        scenes.forEach(s => {
            const el = document.getElementById(s + '-scene');
            if (el) el.style.display = (s === name) ? 'flex' : 'none';
        });
        document.body.className = 'scene-' + name;

        // 控制側邊導航欄顯示
        const navSidebar = document.getElementById('nav-sidebar');
        if (navSidebar) {
            navSidebar.style.display = (name === 'login' || name === 'register') ? 'none' : 'flex';
        }

        // 收合 nav 時也要 resize cytoscape
        if (state.cy) setTimeout(() => state.cy.resize(), 200);

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
    // 認證狀態管理
    // ================================================================
    const auth = {
        accessToken: null,
        user: null,

        setToken(token) {
            this.accessToken = token;
            if (token) {
                sessionStorage.setItem('bedrock_access_token', token);
            } else {
                sessionStorage.removeItem('bedrock_access_token');
            }
        },

        getToken() {
            if (!this.accessToken) {
                this.accessToken = sessionStorage.getItem('bedrock_access_token');
            }
            return this.accessToken;
        },

        clearAuth() {
            this.accessToken = null;
            this.user = null;
            sessionStorage.removeItem('bedrock_access_token');
        },
    };

    // api.request 已統一在定義時注入 auth token 與 credentials

    // ================================================================
    // 登入邏輯（Google OAuth）
    // ================================================================
    function setupLogin() {
        // 優先檢查 URL fragment 中的 auth_token（新版一步到位流程）
        checkAuthToken();
        // 檢查 URL query 中的 auth_error（新版錯誤回報）
        checkAuthError();
        // 舊版：檢查 URL 是否有 OAuth callback 參數（code + state）
        checkOAuthCallback();
    }

    // 新版：從 URL fragment 讀取 auth_token（後端 GET callback 一步到位）
    async function checkAuthToken() {
        const hash = window.location.hash;
        if (!hash || !hash.includes('auth_token=')) return;

        // 擷取 token
        const token = hash.split('auth_token=')[1];
        if (!token) return;

        // 清除 URL fragment
        window.history.replaceState({}, document.title, window.location.pathname);

        console.log('[BEDROCK] Auth token received from redirect');
        auth.setToken(decodeURIComponent(token));

        const statusEl = document.getElementById('login-status');
        if (statusEl) {
            statusEl.style.display = '';
            statusEl.className = 'login-status pending';
            statusEl.textContent = '登入成功，載入中...';
        }

        try {
            const userInfo = await api.get('/auth/me');
            auth.user = userInfo;
            state.user = { email: userInfo.email, name: userInfo.full_name || userInfo.email.split('@')[0] };

            if (!userInfo.totp_enabled) {
                showScene('register');
                showRegStep(3);
                initTOTPSetup();
            } else if (userInfo.status === 'pending_approval') {
                showScene('register');
                showRegStep('pending');
            } else {
                updateGreeting();
                showScene('welcome');
                loadInvestigations();
                checkShowOnboarding();
            }
        } catch (e) {
            console.error('[BEDROCK] Failed to get user info after token redirect:', e);
            showScene('register');
            showRegStep(1);
        }
    }

    // 新版：從 URL query 讀取 auth_error（後端 GET callback 錯誤）
    function checkAuthError() {
        const params = new URLSearchParams(window.location.search);
        const authError = params.get('auth_error');
        if (!authError) return;

        window.history.replaceState({}, document.title, window.location.pathname);

        console.error('[BEDROCK] Auth error from redirect:', authError);
        const statusEl = document.getElementById('login-status');
        if (statusEl) {
            statusEl.style.display = '';
            statusEl.className = 'login-status error';
            const errorMessages = {
                'INVALID_STATE': '驗證過期，請重新登入',
                'TOKEN_EXCHANGE_FAILED': 'Google 驗證失敗，請重試',
                'PENDING_APPROVAL': '帳號審核中，請稍後',
                'ACCOUNT_SUSPENDED': '帳號已停用',
                'ACCOUNT_REJECTED': '申請已被拒絕',
            };
            statusEl.textContent = errorMessages[authError] || `登入失敗（${authError}）`;
        }
    }

    // Google OAuth 登入（含重試機制，應對 Zeabur 冷啟動）
    async function handleGoogleLogin() {
        const btn = document.getElementById('btn-google-login');
        const statusEl = document.getElementById('login-status');
        const GOOGLE_BTN_HTML = '<svg class="google-icon" width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> 以 Google 帳號登入';

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 連線中...';
            }

            // 重試機制：後端可能在冷啟動（Zeabur free tier）
            let data = null;
            let lastErr = null;
            const MAX = 3;

            for (let i = 1; i <= MAX; i++) {
                try {
                    if (i > 1) {
                        if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 喚醒伺服器中...（${i}/${MAX}）`;
                        if (statusEl) {
                            statusEl.style.display = '';
                            statusEl.className = 'login-status pending';
                            statusEl.textContent = `伺服器啟動中，請稍候...（${i}/${MAX}）`;
                        }
                    }
                    data = await api.get('/auth/google/login');
                    lastErr = null;
                    break;
                } catch (err) {
                    lastErr = err;
                    console.warn(`[BEDROCK] Login init attempt ${i}/${MAX} failed:`, err.message);
                    if (i < MAX) await new Promise(r => setTimeout(r, 2500 * i));
                }
            }

            if (lastErr || !data) {
                throw lastErr || new Error('無法連線到伺服器');
            }

            if (data.google_auth_url) {
                if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 導向 Google 登入中...';
                window.location.href = data.google_auth_url;
            } else {
                throw new Error('無法取得 Google 登入連結');
            }
        } catch (e) {
            console.error('[BEDROCK] Google OAuth error:', e);
            if (statusEl) {
                statusEl.style.display = '';
                statusEl.className = 'login-status error';
                statusEl.textContent = '登入失敗：' + e.message;
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = GOOGLE_BTN_HTML;
            }
        }
    }
    window.handleGoogleLogin = handleGoogleLogin;

    // 處理 OAuth callback（Google 重導回來後，含自動重試）
    async function checkOAuthCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const oauthState = params.get('state');

        if (!code || !oauthState) return;

        // 清除 URL 參數
        window.history.replaceState({}, document.title, window.location.pathname);

        const statusEl = document.getElementById('login-status');
        if (statusEl) {
            statusEl.style.display = '';
            statusEl.className = 'login-status pending';
            statusEl.textContent = '正在驗證登入...';
        }

        // 帶重試的 POST（後端可能正在冷啟動，503 也重試）
        const MAX_RETRIES = 4;
        let lastError = null;
        let res = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[BEDROCK] OAuth callback attempt ${attempt}/${MAX_RETRIES}`);
                if (statusEl && attempt > 1) {
                    statusEl.textContent = `正在驗證登入...（重試 ${attempt}/${MAX_RETRIES}）`;
                }
                res = await fetch(API_BASE + '/auth/google/callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ code, state: oauthState }),
                });
                // 503/502 表示後端還在重啟，也需要重試
                if (res.status >= 500 && attempt < MAX_RETRIES) {
                    console.warn(`[BEDROCK] OAuth callback server error ${res.status} (attempt ${attempt}), retrying...`);
                    await new Promise(r => setTimeout(r, 3000 * attempt)); // 3s, 6s, 9s
                    continue;
                }
                lastError = null;
                break; // 成功（含 4xx 錯誤，由後續邏輯處理）
            } catch (fetchErr) {
                lastError = fetchErr;
                console.warn(`[BEDROCK] OAuth callback fetch failed (attempt ${attempt}):`, fetchErr.message);
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 3000 * attempt));
                }
            }
        }

        if (lastError || !res) {
            console.error('[BEDROCK] OAuth callback error after retries:', lastError);
            if (statusEl) {
                statusEl.style.display = '';
                statusEl.className = 'login-status error';
                statusEl.textContent = '伺服器連線失敗，請稍後重試';
            }
            return;
        }

        try {
            const data = await res.json();

            if (data.success && data.data) {
                // 登入成功
                auth.setToken(data.data.access_token);

                // 取得使用者資訊
                try {
                    const userInfo = await api.get('/auth/me');
                    auth.user = userInfo;
                    state.user = { email: userInfo.email, name: userInfo.full_name || userInfo.email.split('@')[0] };

                    // 根據使用者狀態決定下一步
                    if (!userInfo.totp_enabled) {
                        // 需要設定 TOTP → 進入註冊流程 step 3
                        showScene('register');
                        showRegStep(3);
                        initTOTPSetup();
                    } else if (userInfo.status === 'pending_approval') {
                        // 等待審核
                        showScene('register');
                        showRegStep('pending');
                    } else {
                        // 正常進入
                        updateGreeting();
                        showScene('welcome');
                        loadInvestigations();
                        checkShowOnboarding();
                    }
                } catch (userErr) {
                    console.error('[BEDROCK] Failed to get user info:', userErr);
                    // 可能是新使用者，需要註冊
                    showScene('register');
                    showRegStep(1);
                }
            } else if (data.error) {
                const errorCode = data.error.code;
                console.error(`[BEDROCK] OAuth callback API error: ${errorCode} — ${data.error.message}`);
                if (errorCode === 'PENDING_APPROVAL') {
                    showScene('register');
                    showRegStep('pending');
                } else if (errorCode === 'TOKEN_EXCHANGE_FAILED' || errorCode === 'INVALID_STATE') {
                    // Google code 失效或 state 不合，可能是部署期間的過渡問題，提示重新登入
                    throw new Error('驗證過期，請重新點擊登入按鈕');
                } else {
                    throw new Error(data.error.message || '登入失敗');
                }
            } else {
                throw new Error('登入失敗，請重試');
            }
        } catch (e) {
            console.error('[BEDROCK] OAuth callback error:', e);
            if (statusEl) {
                statusEl.style.display = '';
                statusEl.className = 'login-status error';
                statusEl.textContent = e.message;
            }
        }
    }

    // 檢查是否有已存在的有效 token，自動恢復登入
    function checkAndSkipLogin() {
        const savedToken = auth.getToken();
        if (savedToken) {
            api.get('/auth/me').then(userInfo => {
                auth.user = userInfo;
                state.user = { email: userInfo.email, name: userInfo.full_name || userInfo.email.split('@')[0] };
                updateGreeting();
                showScene('welcome');
                loadInvestigations();
                checkShowOnboarding();
            }).catch(() => {
                auth.clearAuth();
            });
        }
    }

    // ================================================================
    // 註冊邏輯
    // ================================================================
    const regState = {
        orgType: null,       // financial / designated / judicial / other
        orgSub: null,        // 子分類
        jobAttribute: null,  // 工作屬性
        isChannel2: false,   // 是否管道二
        currentStep: 1,
    };

    // 機構子分類選項
    const orgSubOptions = {
        financial: [
            { value: 'bank', label: '銀行業' },
            { value: 'securities', label: '證券期貨業' },
            { value: 'insurance', label: '保險業' },
            { value: 'epayment', label: '電子支付機構' },
            { value: 'leasing', label: '融資性租賃業' },
            { value: 'vasp', label: '虛擬資產服務業 (VASP)' },
            { value: 'remittance', label: '外籍移工匯兌公司' },
        ],
        designated: [
            { value: 'tpp', label: '第三方支付服務業' },
            { value: 'jewelry', label: '銀樓業' },
            { value: 'realestate', label: '不動產經紀業及地政士' },
            { value: 'lawyer', label: '律師及公證人' },
            { value: 'accountant', label: '會計師' },
            { value: 'tcsp', label: '信託及公司服務提供業' },
            { value: 'pawnshop', label: '當舖業' },
        ],
        other: [
            { value: 'internal', label: '企業內部風控及內稽' },
            { value: 'credit_check', label: '一般商業徵信' },
            { value: 'other', label: '其他' },
        ],
        // judicial 不需要子分類
    };

    function selectOrgType(el) {
        // 移除其他選取狀態
        document.querySelectorAll('.reg-org-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');

        regState.orgType = el.dataset.org;
        regState.orgSub = null;

        // 顯示子分類（judicial 不需要）
        const subContainer = document.getElementById('reg-org-sub');
        const subOptions = document.getElementById('reg-org-sub-options');
        const jobField = document.getElementById('reg-job-field');

        if (regState.orgType === 'judicial') {
            // 司法警察不需子分類
            subContainer.style.display = 'none';
            jobField.style.display = '';
            updateRegNextBtn();
        } else if (orgSubOptions[regState.orgType]) {
            subContainer.style.display = '';
            subOptions.innerHTML = orgSubOptions[regState.orgType].map(opt =>
                `<label><input type="radio" name="reg-org-sub" value="${opt.value}" onchange="selectOrgSub('${opt.value}')"> ${opt.label}</label>`
            ).join('');
            jobField.style.display = '';
            updateRegNextBtn();
        } else {
            subContainer.style.display = 'none';
            jobField.style.display = '';
            updateRegNextBtn();
        }
    }
    window.selectOrgType = selectOrgType;

    function selectOrgSub(value) {
        regState.orgSub = value;
        updateRegNextBtn();
    }
    window.selectOrgSub = selectOrgSub;

    function updateRegNextBtn() {
        const btn = document.getElementById('reg-btn-next1');
        const jobSel = document.getElementById('reg-job-attribute');
        const job = jobSel ? jobSel.value : '';

        let canProceed = !!regState.orgType && !!job;
        // 需要子分類的機構類型
        if (regState.orgType && orgSubOptions[regState.orgType] && !regState.orgSub) {
            canProceed = false;
        }
        if (btn) btn.disabled = !canProceed;
    }

    // 監聽工作屬性變更
    document.addEventListener('DOMContentLoaded', () => {
        const jobSel = document.getElementById('reg-job-attribute');
        if (jobSel) {
            jobSel.addEventListener('change', () => {
                const otherInput = document.getElementById('reg-job-other');
                if (otherInput) {
                    otherInput.style.display = jobSel.value === 'other' ? '' : 'none';
                }
                updateRegNextBtn();
            });
        }
    });

    function showRegStep(step) {
        regState.currentStep = step;
        // 隱藏所有步驟
        document.querySelectorAll('.reg-step-content').forEach(el => el.style.display = 'none');
        // 顯示對應步驟
        const stepEl = document.getElementById(step === 'pending' ? 'reg-step-pending' : `reg-step-${step}`);
        if (stepEl) stepEl.style.display = '';

        // 更新步驟指示
        document.querySelectorAll('.register-steps .reg-step').forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.remove('active', 'done');
            if (s < step) el.classList.add('done');
            if (s === step) el.classList.add('active');
        });
    }

    function regNextStep(step) {
        showRegStep(step);
    }
    window.regNextStep = regNextStep;

    function regPrevStep(step) {
        showRegStep(step);
    }
    window.regPrevStep = regPrevStep;

    // 統編輸入處理
    let _taxidLookupTimer = null;
    function handleTaxIdInput(input) {
        const val = input.value.trim();
        const lookupBtn = document.getElementById('btn-taxid-lookup');
        const channel2Hint = document.getElementById('reg-channel2-hint');
        const channel1Fields = document.getElementById('reg-channel1-fields');
        const codeSourceField = document.getElementById('reg-code-source-field');
        const resultEl = document.getElementById('reg-taxid-result');
        const manualEl = document.getElementById('reg-company-manual');

        // 8 碼純數字 → 管道一，自動查詢
        if (/^\d{8}$/.test(val)) {
            regState.isChannel2 = false;
            if (lookupBtn) lookupBtn.style.display = '';
            if (channel2Hint) channel2Hint.style.display = 'none';
            if (channel1Fields) channel1Fields.style.display = '';
            if (codeSourceField) codeSourceField.style.display = 'none';
            // 自動查詢（debounce 500ms）
            clearTimeout(_taxidLookupTimer);
            _taxidLookupTimer = setTimeout(() => lookupTaxId(), 500);
        } else if (val.length > 0 && !/^\d{0,7}$/.test(val)) {
            // 非 8 碼數字，可能是特殊代碼 → 管道二
            regState.isChannel2 = true;
            if (lookupBtn) lookupBtn.style.display = 'none';
            if (channel2Hint) channel2Hint.style.display = '';
            if (channel1Fields) channel1Fields.style.display = 'none';
            if (codeSourceField) codeSourceField.style.display = '';
            if (resultEl) resultEl.style.display = 'none';
            if (manualEl) manualEl.style.display = 'none';
        } else {
            regState.isChannel2 = false;
            if (lookupBtn) lookupBtn.style.display = 'none';
            if (channel2Hint) channel2Hint.style.display = 'none';
            if (channel1Fields) channel1Fields.style.display = '';
            if (codeSourceField) codeSourceField.style.display = 'none';
            if (resultEl) resultEl.style.display = 'none';
            if (manualEl) manualEl.style.display = 'none';
            regState.taxidVerified = false;
            regState.companyName = '';
        }
    }
    window.handleTaxIdInput = handleTaxIdInput;

    // 統編查詢 — 查到自動帶入公司名稱，查不到顯示手動輸入框
    async function lookupTaxId() {
        const taxid = document.getElementById('reg-taxid').value.trim();
        const resultEl = document.getElementById('reg-taxid-result');
        const manualEl = document.getElementById('reg-company-manual');

        if (!/^\d{8}$/.test(taxid)) {
            Toast.warning('統一編號應為 8 碼數字');
            return;
        }

        // 顯示查詢中狀態
        if (resultEl) {
            resultEl.innerHTML = '<span style="color:#888;">查詢中…</span>';
            resultEl.style.display = '';
        }
        if (manualEl) manualEl.style.display = 'none';

        try {
            const data = await api.get(`/companies/search?query=${taxid}`);
            if (data && data.companies && data.companies.length > 0) {
                const co = data.companies[0];
                const companyName = co.name || co.company_name || '';
                resultEl.innerHTML = `<div style="background:#e6f4ea; padding:10px 14px; border-radius:6px; border-left:3px solid #27AE60;">
                    <strong style="font-size:1.05em; color:#1B4965;">${esc(companyName)}</strong><br>
                    <span style="color:#555;">地址：${esc(co.address || co.registered_address || '—')}</span><br>
                    <span style="color:#555;">代表人：${esc(co.representative || '—')}</span>
                    <span style="margin-left:12px; color:#555;">狀態：${esc(co.status || '—')}</span>
                </div>`;
                resultEl.style.display = '';
                if (manualEl) manualEl.style.display = 'none';
                // 記錄已驗證的公司名稱
                regState.taxidVerified = true;
                regState.companyName = companyName;
            } else {
                // 查無此統編 → 顯示手動輸入
                resultEl.innerHTML = '<span style="color:#E67E22;">查無此統一編號之登記資料</span>';
                resultEl.style.display = '';
                if (manualEl) manualEl.style.display = '';
                regState.taxidVerified = false;
                regState.companyName = '';
            }
        } catch (e) {
            resultEl.innerHTML = '<span style="color:#C0392B;">查詢失敗：' + esc(e.message) + '</span>';
            resultEl.style.display = '';
            if (manualEl) manualEl.style.display = '';
            regState.taxidVerified = false;
            regState.companyName = '';
        }
    }
    window.lookupTaxId = lookupTaxId;

    // 送出註冊
    async function submitRegistration() {
        const fullname = document.getElementById('reg-fullname').value.trim();
        const agreeTerms = document.getElementById('reg-agree-terms').checked;
        const taxid = document.getElementById('reg-taxid').value.trim();

        if (!fullname) { Toast.warning('請輸入中文姓名'); return; }
        if (!agreeTerms) { Toast.warning('請先同意服務條款與個資告知聲明'); return; }

        if (regState.isChannel2) {
            // 管道二
            const codeSource = document.getElementById('reg-code-source').value.trim();
            if (!codeSource) { Toast.warning('請填寫代碼來源'); return; }

            try {
                const res = await api.post('/auth/register/code', {
                    code: taxid,
                    code_source: codeSource,
                    full_name: fullname,
                    agree_terms: true,
                });
                Toast.success('帳號已建立');
                // 進入 TOTP 設定
                showRegStep(3);
                initTOTPSetup();
            } catch (e) {
                Toast.error('註冊失敗：' + e.message);
            }
        } else {
            // 管道一
            const phone = document.getElementById('reg-phone').value.trim();
            const jobAttr = document.getElementById('reg-job-attribute').value;

            // 統編驗證：必填，且必須已查到公司或手動填了公司名
            if (!taxid) { Toast.warning('請輸入統一編號'); return; }
            if (!/^\d{8}$/.test(taxid)) { Toast.warning('統一編號應為 8 碼數字'); return; }

            let orgName = '';
            if (regState.taxidVerified && regState.companyName) {
                orgName = regState.companyName;
            } else {
                // 查不到統編時，必須手動填公司名稱
                const manualName = (document.getElementById('reg-company-name') || {}).value || '';
                orgName = manualName.trim();
                if (!orgName) {
                    Toast.warning('查無統編資料，請手動輸入公司/機構名稱');
                    return;
                }
            }

            if (!phone || !/^09\d{8}$/.test(phone)) { Toast.warning('請輸入正確手機號碼（09 開頭 10 碼）'); return; }

            try {
                const res = await api.post('/auth/register', {
                    organization_type: regState.orgType,
                    organization_sub: regState.orgSub,
                    job_attribute: jobAttr,
                    organization_taxid: taxid,
                    organization_name: orgName,
                    full_name: fullname,
                    phone: phone,
                    agree_terms: true,
                });

                if (res.next_step === 'totp_setup') {
                    showRegStep(3);
                    initTOTPSetup();
                } else {
                    // 等待審核
                    showRegStep('pending');
                }
            } catch (e) {
                Toast.error('註冊失敗：' + e.message);
            }
        }
    }
    window.submitRegistration = submitRegistration;

    // TOTP 設定
    async function initTOTPSetup() {
        const container = document.getElementById('totp-qr-container');
        const manualKeyEl = document.getElementById('totp-manual-key');
        const keyDisplay = document.getElementById('totp-key-display');

        try {
            const data = await api.post('/auth/totp/setup', {});
            if (data && data.qr_code_url) {
                container.innerHTML = `<img src="${data.qr_code_url}" alt="TOTP QR Code" style="max-width:200px;">`;
                if (data.manual_entry_key && manualKeyEl && keyDisplay) {
                    keyDisplay.textContent = data.manual_entry_key;
                    manualKeyEl.style.display = '';
                }
            } else {
                container.innerHTML = '<p style="color:var(--color-danger);">QR Code 產生失敗，請重試</p>';
            }
        } catch (e) {
            container.innerHTML = `<p style="color:var(--color-danger);">TOTP 設定失敗：${e.message}</p>`;
        }
    }

    // TOTP 驗證
    async function verifyTOTP() {
        const code = document.getElementById('totp-verify-code').value.trim();
        if (!/^\d{6}$/.test(code)) {
            Toast.warning('請輸入 6 位數驗證碼');
            return;
        }

        const btn = document.getElementById('btn-verify-totp');
        if (btn) { btn.disabled = true; btn.textContent = '驗證中...'; }

        try {
            const data = await api.post('/auth/totp/verify', { code });
            Toast.success('TOTP 已成功啟用');

            // 如果是管道二，直接進入系統
            if (regState.isChannel2) {
                state.user = auth.user ? { email: auth.user.email, name: auth.user.full_name } : state.user;
                updateGreeting();
                showScene('welcome');
                loadInvestigations();
            } else {
                // 管道一，等待審核
                showRegStep('pending');
            }
        } catch (e) {
            Toast.error('驗證失敗：' + e.message);
            if (btn) { btn.disabled = false; btn.textContent = '驗證並完成設定'; }
        }
    }
    window.verifyTOTP = verifyTOTP;

    // Modal helpers
    function showPrivacyNotice() {
        const modal = document.getElementById('privacy-notice-modal');
        if (modal) modal.style.display = 'flex';
    }
    window.showPrivacyNotice = showPrivacyNotice;

    function showTermsOfService() {
        const modal = document.getElementById('terms-of-service-modal');
        if (modal) modal.style.display = 'flex';
    }
    window.showTermsOfService = showTermsOfService;

    function closeModalById(id) {
        const modal = document.getElementById(id);
        if (modal) modal.style.display = 'none';
    }
    window.closeModalById = closeModalById;

    // 點擊 overlay 背景關閉 modal
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) {
            e.target.style.display = 'none';
        }
    });

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
                auth.clearAuth();
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

            const roleOptions = ['admin', 'analyst', 'viewer', 'auditor'];
            const statusOptions = ['active', 'pending_approval', 'approved', 'suspended', 'rejected'];
            const roleLabels = { admin: '管理員', analyst: '分析師', viewer: '檢視者', auditor: '稽核員' };
            const statusLabels = { active: '啟用', pending_approval: '待審核', approved: '已核准', suspended: '停用', rejected: '拒絕' };

            // 待審核通知
            const pendingUsers = users.filter(u => u.status === 'pending_approval');
            if (pendingUsers.length > 0) {
                const noticeEl = document.getElementById('admin-pending-notice');
                if (noticeEl) {
                    noticeEl.innerHTML = `<div style="background:#FFF3CD; border:1px solid #FFEAA7; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; gap:10px;">
                        <i class="fas fa-exclamation-triangle" style="color:#E67E22; font-size:18px;"></i>
                        <div>
                            <strong style="color:#D35400;">${pendingUsers.length} 位使用者待審核</strong>
                            <span style="color:#888; font-size:13px; margin-left:8px;">${pendingUsers.map(u => esc(u.full_name || u.email)).join('、')}</span>
                        </div>
                    </div>`;
                    noticeEl.style.display = '';
                } else {
                    // 動態插入通知區塊
                    const container = tbody.closest('table')?.parentElement;
                    if (container) {
                        const notice = document.createElement('div');
                        notice.id = 'admin-pending-notice';
                        notice.innerHTML = `<div style="background:#FFF3CD; border:1px solid #FFEAA7; border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; gap:10px;">
                            <i class="fas fa-exclamation-triangle" style="color:#E67E22; font-size:18px;"></i>
                            <div>
                                <strong style="color:#D35400;">${pendingUsers.length} 位使用者待審核</strong>
                                <span style="color:#888; font-size:13px; margin-left:8px;">${pendingUsers.map(u => esc(u.full_name || u.email)).join('、')}</span>
                            </div>
                        </div>`;
                        container.insertBefore(notice, container.firstChild);
                    }
                }
            }

            tbody.innerHTML = users.map(u => {
                const isPending = u.status === 'pending_approval';
                const rowBg = isPending ? 'background:#FFF8E1;' : '';
                return `
                <tr style="${rowBg} cursor:pointer;" onclick="event.target.tagName === 'SELECT' || toggleUserDetail(${u.id})">
                    <td><strong>${esc(u.full_name || u.name || 'N/A')}</strong><br><small style="color:#666;">${esc(u.organization || '')}</small>
                        ${isPending ? '<span style="display:inline-block; background:#E67E22; color:#fff; font-size:10px; padding:1px 6px; border-radius:4px; margin-left:4px;">待審核</span>' : ''}
                    </td>
                    <td>${esc(u.email)}</td>
                    <td>
                        <select onclick="event.stopPropagation();" onchange="updateUserRole(${u.id}, this.value)" style="padding:3px 6px; border:1px solid #ccc; border-radius:4px;">
                            ${roleOptions.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabels[r] || r}</option>`).join('')}
                        </select>
                    </td>
                    <td>
                        <select onclick="event.stopPropagation();" onchange="updateUserStatus(${u.id}, this.value)" style="padding:3px 6px; border:1px solid #ccc; border-radius:4px;">
                            ${statusOptions.map(s => `<option value="${s}" ${u.status === s ? 'selected' : ''}>${statusLabels[s] || s}</option>`).join('')}
                        </select>
                    </td>
                    <td>${esc(u.investigation_count || 0)} 件</td>
                    <td>${formatDate(u.created_at)}</td>
                </tr>
                <tr id="user-detail-${u.id}" style="display:none;">
                    <td colspan="6" style="background:#f9fafb; padding:16px;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px;">
                            <div><span style="color:#888;">Google 名稱</span><br><strong>${esc(u.google_display_name || u.full_name || '-')}</strong></div>
                            <div><span style="color:#888;">機構類型</span><br><strong>${esc(u.organization_type || '-')}</strong></div>
                            <div><span style="color:#888;">工作屬性</span><br><strong>${esc(u.job_attribute || '-')}</strong></div>
                            <div><span style="color:#888;">統一編號</span><br><strong>${esc(u.organization_taxid || '-')}</strong></div>
                            <div><span style="color:#888;">電話</span><br><strong>${esc(u.phone || '-')}</strong></div>
                            <div><span style="color:#888;">TOTP</span><br><strong>${u.totp_enabled ? '已啟用' : '未啟用'}</strong></div>
                            <div><span style="color:#888;">註冊時間</span><br><strong>${formatDate(u.created_at)}</strong></div>
                            <div><span style="color:#888;">上次登入</span><br><strong>${formatDate(u.last_login_at) || '-'}</strong></div>
                        </div>
                        ${isPending ? `<div style="margin-top:12px; display:flex; gap:8px;">
                            <button onclick="event.stopPropagation(); updateUserStatus(${u.id}, 'active'); loadAdminUsers();" style="padding:6px 16px; background:#27AE60; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">✓ 核准</button>
                            <button onclick="event.stopPropagation(); updateUserStatus(${u.id}, 'rejected'); loadAdminUsers();" style="padding:6px 16px; background:#C0392B; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">✗ 拒絕</button>
                        </div>` : ''}
                    </td>
                </tr>`;
            }).join('');

            // 展開/收合使用者詳情
            window.toggleUserDetail = function(userId) {
                const row = document.getElementById('user-detail-' + userId);
                if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
            };
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
                    const kwDataObj = keywordsData.data || keywordsData || {};
                    // 統計總數
                    const allKws = [].concat(
                        Array.isArray(kwDataObj.L1_keywords) ? kwDataObj.L1_keywords : [],
                        Array.isArray(kwDataObj.L2_keywords) ? kwDataObj.L2_keywords : [],
                        Array.isArray(kwDataObj.L3_keywords) ? kwDataObj.L3_keywords : [],
                        Array.isArray(kwDataObj.items) ? kwDataObj.items : [],
                        Array.isArray(kwDataObj) ? kwDataObj : []
                    );
                    const keywords = allKws;
                    if (keywords.length > 0) {
                        const getKwLabel = (kw) => {
                            if (typeof kw === 'string') return kw;
                            if (typeof kw.keyword === 'string') return kw.keyword;
                            if (typeof kw.text === 'string') return kw.text;
                            if (typeof kw.name === 'string') return kw.name;
                            if (kw.keyword && typeof kw.keyword === 'object') return kw.keyword.text || JSON.stringify(kw.keyword);
                            return JSON.stringify(kw);
                        };
                        keywordsList.innerHTML = `
                            <div class="admin-list">
                                ${keywords.slice(0, 5).map(kw => `
                                    <div class="admin-list-item">${esc(getKwLabel(kw))}</div>
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
                                <tr><th>設定項</th><th>值</th><th>說明</th><th>操作</th></tr>
                                ${settings.map(s => `
                                    <tr id="config-row-${esc(s.key)}">
                                        <td><strong>${esc(s.key || '')}</strong></td>
                                        <td>
                                            <span class="config-display-${esc(s.key)}"><code style="background:#f5f5f3; padding:2px 6px; border-radius:3px;">${esc(s.value || '')}</code></span>
                                            <input class="config-input-${esc(s.key)}" type="text" value="${esc(s.value || '')}" style="display:none; width:90%; padding:4px 8px; border:1px solid #ccc; border-radius:4px;" />
                                        </td>
                                        <td style="color:#666; font-size:0.85em;">${esc(s.description || '')}</td>
                                        <td>
                                            <button class="admin-action-btn config-edit-btn" data-key="${esc(s.key)}" onclick="editConfigStart('${esc(s.key)}')">編輯</button>
                                            <button class="admin-action-btn config-save-btn" data-key="${esc(s.key)}" onclick="editConfigSave('${esc(s.key)}')" style="display:none; background:#2A7F3B; color:#fff;">儲存</button>
                                            <button class="admin-action-btn config-cancel-btn" data-key="${esc(s.key)}" onclick="editConfigCancel('${esc(s.key)}')" style="display:none;">取消</button>
                                        </td>
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
                const resource = a.resource_type ? `${a.resource_type}${a.resource_id ? '#' + a.resource_id : ''}` : (a.resource || a.target || 'N/A');
                return `
                    <tr>
                        <td>${formatDate(a.created_at || a.timestamp)}</td>
                        <td>${esc(a.user_id != null ? 'UID:' + a.user_id : (a.user || a.username || 'N/A'))}</td>
                        <td>${actionLabel}</td>
                        <td>${esc(resource)}</td>
                        <td><span class="status-badge status-success">成功</span></td>
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
            const data = await api.get('/sync/status');
            const lastTime = document.getElementById('sync-last-time');
            const hashStatus = document.getElementById('sync-hash-status');
            const statsTbody = document.getElementById('sync-stats-tbody');

            // /sync/status 回傳格式: { status, started_at, processed, ... }
            const syncTime = data.last_sync_time || data.started_at;
            if (lastTime) {
                if (syncTime) {
                    lastTime.textContent = formatDate(syncTime) + ` ${new Date(syncTime).toLocaleTimeString('zh-TW')}`;
                } else if (data.status === 'running') {
                    lastTime.textContent = '同步進行中…';
                } else {
                    lastTime.textContent = '未曾同步';
                }
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

        // 顯示進度區塊
        const progressSection = document.getElementById('sync-progress-section');
        if (progressSection) progressSection.style.display = 'block';

        try {
            const result = await api.post('/sync/start', {});
            Toast.success(result.message || '同步任務已提交，背景執行中');
            // 開始輪詢同步進度
            pollSyncProgress();
        } catch (e) {
            console.warn('[BEDROCK] 同步失敗:', e.message);
            Toast.error('資料同步失敗: ' + e.message);
            if (progressSection) progressSection.style.display = 'none';
        } finally {
            btnSync.disabled = false;
            btnSync.innerHTML = originalHtml;
        }
    }
    window.triggerDataSync = triggerDataSync;

    // 輪詢同步進度
    let _syncPollTimer = null;
    async function pollSyncProgress() {
        if (_syncPollTimer) clearInterval(_syncPollTimer);
        let pollCount = 0;
        const maxPolls = 120; // 最多輪詢 120 次（約 4 分鐘）

        _syncPollTimer = setInterval(async () => {
            pollCount++;
            try {
                const status = await api.get('/sync/status');
                const pctEl = document.getElementById('sync-progress-pct');
                const barEl = document.getElementById('sync-progress-bar');
                const detailEl = document.getElementById('sync-progress-detail');
                const speedEl = document.getElementById('sync-progress-speed');
                const errEl = document.getElementById('sync-progress-errors');

                if (status && status.progress != null) {
                    const pct = Math.round(status.progress * 100);
                    if (pctEl) pctEl.textContent = pct + '%';
                    if (barEl) barEl.style.width = pct + '%';
                    if (detailEl) detailEl.textContent = status.detail || `已處理 ${status.processed || 0} / ${status.total || '?'} 筆`;
                    if (speedEl) speedEl.textContent = status.speed ? `${status.speed} 筆/秒` : '';
                    if (errEl && status.errors && status.errors.length > 0) {
                        errEl.style.display = 'block';
                        errEl.textContent = '錯誤：' + status.errors.slice(0, 3).join('、');
                    }

                    if (pct >= 100 || status.status === 'completed') {
                        clearInterval(_syncPollTimer);
                        _syncPollTimer = null;
                        Toast.success('資料同步完成');
                        setTimeout(() => {
                            const progressSection = document.getElementById('sync-progress-section');
                            if (progressSection) progressSection.style.display = 'none';
                            loadDataSyncStatus();
                        }, 1500);
                    }
                } else {
                    // API 沒回傳進度，顯示預設
                    if (detailEl) detailEl.textContent = '背景同步中，請稍候…';
                }
            } catch (e) {
                // 靜默失敗
            }

            if (pollCount >= maxPolls) {
                clearInterval(_syncPollTimer);
                _syncPollTimer = null;
                const progressSection = document.getElementById('sync-progress-section');
                if (progressSection) progressSection.style.display = 'none';
                loadDataSyncStatus();
            }
        }, 2000);
    }

    // 關鍵字管理
    async function loadKeywords() {
        try {
            const data = await api.get('/keywords');
            // API 回傳 { status, data: { L1_keywords, L2_keywords, L3_keywords, total } }
            const kwData = data.data || data || {};
            const levelL1 = Array.isArray(kwData.L1_keywords) ? kwData.L1_keywords : [];
            const levelL2 = Array.isArray(kwData.L2_keywords) ? kwData.L2_keywords : [];
            const levelL3 = Array.isArray(kwData.L3_keywords) ? kwData.L3_keywords : [];

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
            'risk_term': '風險詞彙',
            'industry': '產業分類',
            'location': '地點',
            'custom': '自訂',
            'sanction': '制裁名單',
            'pep': '政治敏感人物'
        };

        // 安全取得關鍵字文字（防止 [object Object]）
        function getKwText(kw) {
            if (typeof kw === 'string') return kw;
            if (typeof kw.keyword === 'string') return kw.keyword;
            if (typeof kw.text === 'string') return kw.text;
            if (typeof kw.word === 'string') return kw.word;
            if (typeof kw.name === 'string') return kw.name;
            if (typeof kw.value === 'string') return kw.value;
            // 如果 keyword 是物件，嘗試取 keyword.text 或 keyword.keyword
            if (kw.keyword && typeof kw.keyword === 'object') {
                return kw.keyword.text || kw.keyword.keyword || kw.keyword.name || JSON.stringify(kw.keyword);
            }
            return JSON.stringify(kw);
        }

        function getKwId(kw) {
            if (typeof kw === 'string') return kw;
            return kw.id || kw.keyword_id || (typeof kw.keyword === 'string' ? kw.keyword : '') || '';
        }

        return `
            <div class="keyword-chips">
                ${keywords.map(kw => {
                    const text = getKwText(kw);
                    const kwId = getKwId(kw);
                    const cat = (typeof kw === 'object' ? kw.category : '') || '';
                    const catLabel = categoryLabels[cat] || cat || '';
                    return `
                    <span class="keyword-chip" title="${esc(catLabel)}">
                        <span class="keyword-chip-text">${esc(text)}</span>
                        ${catLabel ? `<span class="keyword-chip-cat">${esc(catLabel)}</span>` : ''}
                        <button class="keyword-chip-x" onclick="event.stopPropagation(); confirmDeleteKeyword('${esc(kwId)}', '${typeof kw === 'object' ? (kw.level || '') : ''}')" title="刪除此關鍵字">&times;</button>
                    </span>`;
                }).join('')}
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
        try {
            await api.del(`/keywords/${keywordId}`);
            Toast.success('關鍵字已刪除');
            loadKeywords();
        } catch(e) {
            Toast.error('刪除失敗: ' + e.message);
        }
    }
    window.deleteKeyword = deleteKeyword;

    // 刪除前確認（帶有小對話框，而非原生 confirm）
    function confirmDeleteKeyword(keywordId, level) {
        if (!keywordId) return;
        // 建立確認 overlay
        const overlay = document.createElement('div');
        overlay.className = 'kw-confirm-overlay';
        overlay.innerHTML = `
            <div class="kw-confirm-dialog">
                <div style="font-size:14px; font-weight:600; margin-bottom:12px;">確定刪除此關鍵字？</div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button class="btn btn-outline" onclick="this.closest('.kw-confirm-overlay').remove()">取消</button>
                    <button class="btn" style="background:#B22D20; color:#fff;" onclick="deleteKeyword('${esc(keywordId)}', '${level}'); this.closest('.kw-confirm-overlay').remove();">刪除</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    window.confirmDeleteKeyword = confirmDeleteKeyword;

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

        // 確保右側面板是關閉狀態
        closeDetail();

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
                // 圖渲染完成後建立縣市分群
                buildCityGroups();
            }
        } catch (e) {
            console.warn('[BEDROCK] 載入圖資料失敗:', e.message);
        }

        // 載入集群、紅旗、負面新聞、UBO 穿透、消歧義
        loadClusters(id);
        loadRedFlags(id);
        loadMedia(id);
        loadUBOChains(id);
        loadDisambiguation(id);

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
                    <div class="ws-list-item ws-seed-item" data-seed-id="${s.id}" style="cursor:pointer;" onclick="focusSeedNodeEnhanced('${esc(s.seed_value)}')">
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
            // ★ 效能優化：大圖時減少渲染負擔
            textureOnViewport: true,       // 縮放/拖曳時用低解析度紋理
            hideEdgesOnViewport: true,      // 縮放/拖曳時隱藏邊（大幅提升流暢度）
            hideLabelsOnViewport: true,     // 縮放/拖曳時隱藏標籤
            pixelRatio: 1,                 // 固定 1x 像素比（避免 Retina 4x 記憶體）
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
                        'min-zoomed-font-size': 10,  // 縮小到看不清時不渲染文字
                    },
                },
                {
                    selector: 'node[type="company"]',
                    style: {
                        'shape': 'roundrectangle',
                        'background-color': function(ele) {
                            // 色階依資本額：小資本淺藍 → 大資本深藍
                            const cap = ele.data('capital') || 0;
                            if (cap <= 0) return '#8BB8CC'; // 未知/零資本：淺灰藍
                            const logCap = Math.log10(Math.max(cap, 1));
                            const t = Math.min(logCap / 10, 1); // log10(10B)=10
                            // 色階：淺藍 #8BB8CC → 中藍 #3A7CA5 → 深藍 #1B4965
                            if (t < 0.5) {
                                const r = Math.round(139 + (58 - 139) * (t * 2));
                                const g = Math.round(184 + (124 - 184) * (t * 2));
                                const b = Math.round(204 + (165 - 204) * (t * 2));
                                return `rgb(${r},${g},${b})`;
                            } else {
                                const r = Math.round(58 + (27 - 58) * ((t - 0.5) * 2));
                                const g = Math.round(124 + (73 - 124) * ((t - 0.5) * 2));
                                const b = Math.round(165 + (101 - 165) * ((t - 0.5) * 2));
                                return `rgb(${r},${g},${b})`;
                            }
                        },
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
                // 查詢主體（seed）：特殊邊框 + 星形光暈
                {
                    selector: 'node[is_seed]',
                    style: {
                        'border-width': 4,
                        'border-color': '#1ABC9C',
                        'border-style': 'double',
                        'shadow-blur': 20,
                        'shadow-color': '#1ABC9C',
                        'shadow-opacity': 0.5,
                        'shadow-offset-x': 0,
                        'shadow-offset-y': 0,
                        'font-size': '13px',
                        'font-weight': 'bold',
                        'color': '#0E6655',
                        'text-max-width': '120px',
                        'z-index': 999,
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
                    selector: 'node.cluster-dimmed',
                    style: {
                        'opacity': 0.15,
                    },
                },
                {
                    selector: 'edge.cluster-dimmed',
                    style: {
                        'opacity': 0.08,
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
                        'width': 1.5,
                        'line-color': '#B0AEA8',
                        'curve-style': 'straight',     // ★ straight 比 bezier 快很多
                        'target-arrow-shape': 'triangle',
                        'target-arrow-color': '#B0AEA8',
                        'arrow-scale': 0.8,
                        'label': 'data(label)',
                        'font-size': '10px',
                        'font-weight': 'bold',
                        'color': '#777',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'text-background-color': '#fff',
                        'text-background-opacity': 0.7,
                        'text-background-padding': '2px',
                        'min-zoomed-font-size': 12,  // 縮小時不渲染邊標籤
                    },
                },
                // ── 色盲友善邊線設計 ──
                // 每種關聯同時使用「顏色 + 線型 + 粗細 + 箭頭形狀」四重區分
                // 配色採 Wong (2011) 色盲安全色盤
                {
                    selector: 'edge[type="director"]',
                    style: {
                        'line-color': '#0072B2',        // 藍（色盲安全）
                        'target-arrow-color': '#0072B2',
                        'line-style': 'solid',           // 實線
                        'width': 1.8,
                        'target-arrow-shape': 'triangle',
                        'color': '#0072B2',
                    },
                },
                {
                    selector: 'edge[type="representative"]',
                    style: {
                        'line-color': '#D55E00',        // 橘紅（色盲安全）
                        'target-arrow-color': '#D55E00',
                        'line-style': 'dashed',          // 虛線 ── 明確與實線區分
                        'line-dash-pattern': [8, 4],
                        'width': 2.5,
                        'target-arrow-shape': 'diamond',  // 菱形箭頭
                        'color': '#D55E00',
                    },
                },
                {
                    selector: 'edge[type="shareholder"]',
                    style: {
                        'line-color': '#009E73',        // 青綠（色盲安全）
                        'target-arrow-color': '#009E73',
                        'line-style': 'dashed',          // 虛線（長段）
                        'line-dash-pattern': [12, 3],
                        'width': 2,
                        'target-arrow-shape': 'vee',      // V 形箭頭
                        'color': '#009E73',
                    },
                },
                {
                    selector: 'edge[type="historical"]',
                    style: {
                        'line-style': 'dotted',          // 點線
                        'line-color': '#999999',
                        'target-arrow-color': '#999999',
                        'target-arrow-shape': 'triangle',
                        'opacity': 0.5,
                        'width': 1,
                        'color': '#999999',
                    },
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'line-color': '#E74C3C',
                        'target-arrow-color': '#E74C3C',
                        'width': 3,
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
            currentSelectedNode = e.target.id();
        });

        // 節點雙擊 → 展開/收合下一層（適用所有節點類型）
        state.cy.on('dbltap', 'node', function (e) {
            const node = e.target;
            const nodeData = node.data();
            _toggleNodeExpand(node, nodeData);
        });

        // 暴露給全域使用（如果需要從 UI 按鈕觸發）
        window.__bedrockToggleNodeExpand = function(nodeId) {
            if (!state.cy) return;
            const node = state.cy.getElementById(nodeId);
            if (node.length) _toggleNodeExpand(node, node.data());
        };

        function _toggleNodeExpand(node, nodeData) {
            const isCollapsed = node.data('_collapsed');
            if (isCollapsed) {
                // 恢復被收合的子節點
                const hiddenChildren = node.data('_hiddenChildren') || [];
                state.cy.batch(() => {
                    hiddenChildren.forEach(childId => {
                        const child = state.cy.getElementById(childId);
                        if (child && child.length) {
                            child.style('display', 'element');
                            child.connectedEdges().forEach(edge => {
                                const src = edge.source();
                                const tgt = edge.target();
                                if (src.style('display') !== 'none' && tgt.style('display') !== 'none') {
                                    edge.style('display', 'element');
                                }
                            });
                        }
                    });
                });
                node.data('_collapsed', false);
                node.data('_hiddenChildren', []);
                node.style('border-style', nodeData.is_seed ? 'double' : 'solid');
                Toast.show(`已展開「${nodeData.label}」的關聯（${hiddenChildren.length} 個節點）`, 'info', 1500);
                const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
                if (visible.length > 0) state.cy.fit(visible, 40);
                filterSidebarByVisibleNodes();
            } else {
                // 收合：隱藏此節點的下一層（深度更深且直接相連的）
                const depthMap = getDepthMap();
                const nodeDepth = depthMap.get(node.id()) || 0;
                const hiddenChildren = [];

                state.cy.batch(() => {
                    node.neighborhood('node').forEach(neighbor => {
                        if (neighbor.style('display') === 'none') return;
                        const neighborDepth = depthMap.get(neighbor.id()) || 0;
                        if (neighborDepth > nodeDepth) {
                            neighbor.style('display', 'none');
                            neighbor.connectedEdges().style('display', 'none');
                            hiddenChildren.push(neighbor.id());
                        }
                    });
                });

                if (hiddenChildren.length > 0) {
                    node.data('_collapsed', true);
                    node.data('_hiddenChildren', hiddenChildren);
                    node.style('border-style', 'dashed');
                    Toast.show(`已收合「${nodeData.label}」（${hiddenChildren.length} 個關聯節點）`, 'info', 1500);
                    const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
                    if (visible.length > 0) state.cy.fit(visible, 40);
                    filterSidebarByVisibleNodes();
                } else if (nodeData.type === 'company' && nodeData.tax_id && state.currentInvId) {
                    // 邊界節點且是公司：嘗試深入追蹤
                    Toast.show(`正在從「${nodeData.label}」深入追蹤…`, 'info');
                    api.post(`/investigations/${state.currentInvId}/crawl/start`, {
                        seed_name: nodeData.tax_id || nodeData.label
                    }).then(() => {
                        Toast.success('深入追蹤已啟動');
                        state.crawling = true;
                        updateCrawlUI();
                        pollCrawlProgress();
                    }).catch(err => {
                        Toast.error('深入追蹤失敗: ' + err.message);
                    });
                }
            }
        }

        // 點擊空白 → 關閉詳情
        state.cy.on('tap', function (e) {
            if (e.target === state.cy) closeDetail();
        });

        // ── Hover 浮動資訊面板 ──
        let _hoverTip = null;
        let _hoverTimeout = null;

        function createHoverTooltip() {
            if (_hoverTip) return _hoverTip;
            _hoverTip = document.createElement('div');
            _hoverTip.id = 'bedrock-hover-tip';
            _hoverTip.style.cssText = 'position:fixed; z-index:9999; pointer-events:none; background:#fff; border:1px solid #ddd; border-radius:10px; box-shadow:0 4px 20px rgba(0,0,0,0.15); padding:12px 14px; max-width:380px; min-width:240px; font-size:12px; color:#333; display:none; line-height:1.5;';
            document.body.appendChild(_hoverTip);
            return _hoverTip;
        }

        state.cy.on('mouseover', 'node', function(e) {
            if (_hoverTimeout) clearTimeout(_hoverTimeout);
            _hoverTimeout = setTimeout(() => {
                const node = e.target;
                const d = node.data();
                const tip = createHoverTooltip();
                const isComp = d.type === 'company';

                let html = '';
                if (isComp) {
                    const statusColor = d.status === '核准設立' ? '#27AE60' : (d.status === '解散' || d.status === '廢止') ? '#C0392B' : '#E67E22';
                    const cap = d.capital ? `NT$ ${Number(d.capital).toLocaleString()}` : '未知';
                    html = `<div style="font-weight:700; font-size:14px; margin-bottom:6px; color:#1B4965;">${esc(d.label)}</div>`;
                    if (d.obu_warning) html += `<div style="background:#E74C3C; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; display:inline-block; margin-bottom:6px;">⚠ 三層內無法辨識 UBO</div>`;
                    html += `<div style="display:grid; grid-template-columns:auto 1fr; gap:2px 8px; font-size:11px;">
                        <span style="color:#888;">統編</span><span style="font-family:monospace;">${esc(d.entity_id)}</span>
                        <span style="color:#888;">狀態</span><span><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};margin-right:3px;"></span>${esc(d.status || '未知')}</span>
                        ${d.company_type ? `<span style="color:#888;">類型</span><span>${esc(d.company_type)}</span>` : ''}
                        <span style="color:#888;">資本額</span><span style="font-weight:600;">${cap}</span>
                        <span style="color:#888;">代表人</span><span>${esc(d.representative || '未知')}</span>
                        ${d.established_date ? `<span style="color:#888;">設立</span><span>${esc(d.established_date)}</span>` : ''}
                        ${d.dissolved_date ? `<span style="color:#888;">解散</span><span style="color:#C0392B;">${esc(d.dissolved_date)}</span>` : ''}
                        <span style="color:#888;">地址</span><span style="font-size:10px; word-break:break-all;">${esc(d.address || '未知')}</span>
                        ${d.issued_shares ? `<span style="color:#888;">已發行股份</span><span>${parseInt(d.issued_shares).toLocaleString()} 股</span>` : ''}
                        ${d.share_amount ? `<span style="color:#888;">每股金額</span><span>NT$ ${parseInt(d.share_amount).toLocaleString()}</span>` : ''}
                    </div>`;
                    // 股東架構（簡版）
                    const dirs = d.directors_data || [];
                    const base = d.issued_shares || d.capital || 0;
                    if (dirs.length > 0 && base > 0) {
                        const shs = [];
                        dirs.forEach(dd => {
                            const name = dd['姓名'] || dd.name || '';
                            const shares = parseInt(String(dd['出資額'] || dd['持有股份數'] || dd.shares || 0).replace(/,/g, ''), 10) || 0;
                            if (shares > 0 && name) shs.push({ name, pct: shares / base * 100 });
                        });
                        shs.sort((a, b) => b.pct - a.pct);
                        if (shs.length > 0) {
                            const colors = ['#2980B9','#E67E22','#27AE60','#C0392B','#8E44AD','#16A085','#D35400','#7F8C8D'];
                            html += `<div style="margin-top:8px; border-top:1px solid #eee; padding-top:6px;">
                                <div style="font-weight:600; font-size:11px; margin-bottom:4px;">股東架構</div>
                                <div style="height:10px; display:flex; border-radius:5px; overflow:hidden; margin-bottom:4px;">
                                    ${shs.slice(0, 8).map((s, i) => `<div style="width:${Math.max(s.pct, 1)}%;background:${colors[i % colors.length]};height:100%;min-width:2px;" title="${esc(s.name)} ${s.pct.toFixed(1)}%"></div>`).join('')}
                                </div>
                                ${shs.slice(0, 5).map((s, i) => `<div style="font-size:10px; display:flex; gap:3px; align-items:center;"><span style="width:6px;height:6px;border-radius:1px;background:${colors[i % colors.length]};flex-shrink:0;"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</span><span style="font-weight:600;color:${colors[i % colors.length]};">${s.pct.toFixed(1)}%</span></div>`).join('')}
                                ${shs.length > 5 ? `<div style="font-size:9px;color:#999;">…及其他 ${shs.length - 5} 位</div>` : ''}
                            </div>`;
                        }
                    }
                    // 紅旗摘要
                    if (d.flag_count > 0) {
                        html += `<div style="margin-top:6px; background:rgba(192,57,43,0.08); padding:4px 6px; border-radius:4px; font-size:10px; color:#C0392B;">⚑ ${d.flag_count} 項異常</div>`;
                    }
                } else {
                    // 個人節點
                    html = `<div style="font-weight:700; font-size:14px; margin-bottom:6px; color:#8B6508;">${esc(d.label)}</div>`;
                    html += `<div style="font-size:11px; color:#666; margin-bottom:4px;">職稱：${esc(d.title || '董監事')}</div>`;
                    // 反查關聯公司
                    const cyNode = state.cy.getElementById(d.id);
                    if (cyNode.length) {
                        const connEdges = cyNode.connectedEdges();
                        const comps = [];
                        connEdges.forEach(ce => {
                            const ced = ce.data();
                            const oid = ced.source === d.id ? ced.target : ced.source;
                            const on = state.cy.getElementById(oid);
                            if (on.length && on.data('type') === 'company') {
                                comps.push({ label: on.data('label'), role: ced.label || ced.type, status: on.data('status'), capital: on.data('capital') });
                            }
                        });
                        if (comps.length > 0) {
                            html += `<div style="border-top:1px solid #eee; padding-top:4px; margin-top:4px;">`;
                            html += `<div style="font-weight:600; font-size:11px; margin-bottom:3px;">關聯公司 (${comps.length})</div>`;
                            comps.slice(0, 8).forEach(c => {
                                const sc = c.status === '核准設立' ? '#27AE60' : '#E67E22';
                                const cap = c.capital ? (c.capital >= 10000 ? Math.round(c.capital / 10000).toLocaleString() + '萬' : c.capital.toLocaleString()) : '';
                                html += `<div style="font-size:10px; padding:2px 0; display:flex; gap:4px; align-items:center;">
                                    <span style="width:5px;height:5px;border-radius:50%;background:${sc};flex-shrink:0;"></span>
                                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.label)}</span>
                                    <span style="color:#3A7CA5;">${esc(c.role)}</span>
                                    ${cap ? `<span style="color:#888;">${cap}</span>` : ''}
                                </div>`;
                            });
                            if (comps.length > 8) html += `<div style="font-size:9px;color:#999;">…及其他 ${comps.length - 8} 家</div>`;
                            html += `</div>`;
                        }
                    }
                }

                tip.innerHTML = html;
                tip.style.display = 'block';
                // 定位在滑鼠附近
                const rendPos = node.renderedPosition();
                const cyContainer = state.cy.container().getBoundingClientRect();
                let left = cyContainer.left + rendPos.x + 20;
                let top = cyContainer.top + rendPos.y - 20;
                // 防止超出螢幕
                if (left + 390 > window.innerWidth) left = left - 420;
                if (top + tip.offsetHeight > window.innerHeight) top = window.innerHeight - tip.offsetHeight - 10;
                if (top < 10) top = 10;
                tip.style.left = left + 'px';
                tip.style.top = top + 'px';
            }, 300);  // 300ms 延遲避免頻繁觸發
        });

        state.cy.on('mouseout', 'node', function() {
            if (_hoverTimeout) { clearTimeout(_hoverTimeout); _hoverTimeout = null; }
            if (_hoverTip) _hoverTip.style.display = 'none';
        });

        // 拖動或縮放時也隱藏 tooltip
        state.cy.on('pan zoom drag', function() {
            if (_hoverTip) _hoverTip.style.display = 'none';
            if (_hoverTimeout) { clearTimeout(_hoverTimeout); _hoverTimeout = null; }
        });

        setupCytoscapeToolbar();
    }

    function renderGraph(elements) {
        if (!state.cy) return;

        // 記錄現有節點 ID（用於動畫判斷新節點）
        const existingNodeIds = new Set();
        state.cy.nodes().forEach(n => existingNodeIds.add(n.id()));
        const isUpdate = existingNodeIds.size > 0;

        state.cy.elements().remove();
        state.cy.add(elements);

        const nodeCount = elements.filter(e => e.group === 'nodes').length;
        const seedNodes = state.cy.nodes('[?is_seed]');

        if (nodeCount > 300) {
            // 超大圖：用 grid 佈局（最快，O(n)）
            state.cy.layout({
                name: 'grid',
                animate: false,
                rows: Math.ceil(Math.sqrt(nodeCount)),
                fit: true,
                padding: 30,
            }).run();
            Toast.show(`${nodeCount} 個節點，使用快速網格排版`, 'info', 2000);
        } else if (nodeCount > 100) {
            // 大圖用 concentric（較快，不用力學模擬）
            state.cy.layout({
                name: 'concentric',
                animate: false,
                concentric: function(node) {
                    if (node.data('is_seed')) return 100;
                    if (node.data('flag_count')) return 50 + node.data('flag_count');
                    return node.connectedEdges().length;
                },
                levelWidth: function() { return 3; },
                minNodeSpacing: 15,
                fit: true,
                padding: 30,
            }).run();
            Toast.show(`${nodeCount} 個節點，使用同心圓排版`, 'info', 2000);
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

        // layout 完成後聚焦到 seed 節點
        setTimeout(() => {
            if (seedNodes.length > 0) {
                state.cy.fit(seedNodes, 80);
                // 如果 seed 很少，zoom out 一些看全貌
                if (seedNodes.length <= 3 && state.cy.zoom() > 1.5) {
                    state.cy.zoom(1.2);
                    state.cy.center(seedNodes);
                }
            }

            // 新節點出現動畫效果
            if (isUpdate) {
                state.cy.nodes().forEach(node => {
                    if (!existingNodeIds.has(node.id())) {
                        // 新節點：從透明漸入
                        node.style('opacity', 0);
                        node.animate({
                            style: { opacity: 1 },
                        }, {
                            duration: 500,
                            easing: 'ease-in-out-cubic',
                        });
                    }
                });
            }

            // 預設展開到第二層
            const depthSelect = document.getElementById('depth-filter-select');
            // 初始時顯示到第二層
            if (depthSelect && nodeCount > 10) {
                depthSelect.value = '2';
                filterByDepth(2);
            } else {
                // 節點不多就全部顯示
                const label = document.getElementById('depth-filter-label');
                if (label) label.textContent = `${nodeCount} 個節點`;
                if (depthSelect) depthSelect.value = '99';
            }
        }, 600);
    }

    // renderDemoGraph 已移除 — 不再使用 demo 資料

    function runLayout(name) {
        if (!state.cy) return;

        const layouts = {
            cola: {
                name: 'cola',
                animate: true,
                animationDuration: 800,
                nodeSpacing: 50,
                edgeLength: 150,
                convergenceThreshold: 0.001,
                randomize: false,
                avoidOverlap: true,
                handleDisconnected: true,
                flow: { axis: 'y', minSeparation: 60 },  // 上→下層次流向，減少交叉
                edgeSymDiffLength: 15,     // 對稱差長度：推開平行邊
                unconstrIter: 20,          // 無約束迭代：改善初始佈局
                userConstIter: 30,         // 使用者約束迭代
                allConstIter: 30,          // 所有約束迭代
                fit: true,
                padding: 50,
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
                closeDetail();
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

        title.innerHTML = esc(data.label || data.id) +
            (data.obu_warning ? ' <span style="display:inline-block; background:#E74C3C; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; margin-left:4px; vertical-align:middle;" title="三層內無法辨識實質受益人">⚠ UBO 不明</span>' : '');

        // 顯示浮動面板（不改變 grid）
        panel.classList.add('detail-visible');
        panel.classList.remove('collapsed');

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
                const isRep = ed.type === 'representative';
                // 法人代表邊：凸顯派任關係
                let repBadge = '';
                if (isRep) {
                    const appointingId = ed.source;
                    const appointingNode = state.cy.getElementById(appointingId);
                    const appointingLabel = appointingNode.length ? appointingNode.data('label') : '';
                    const directorName = ed.director_name || '';
                    if (isCompany && data.id === ed.target) {
                        // 被查看的是目標公司：「XX公司 派任 YY 擔任此公司董事」
                        repBadge = `<div style="margin-top:2px; font-size:10px; color:#D55E00; background:rgba(213,94,0,0.08); padding:2px 6px; border-radius:4px;">
                            <i class="fas fa-building" style="margin-right:3px;"></i>由 <b>${esc(appointingLabel || appointingId)}</b> 派任${directorName ? '（' + esc(directorName) + '）' : ''}
                        </div>`;
                    } else if (isCompany && data.id === ed.source) {
                        // 被查看的是派任法人：「此公司派任 YY 至 ZZ公司」
                        const targetNode = state.cy.getElementById(ed.target);
                        const targetLabel = targetNode.length ? targetNode.data('label') : ed.target;
                        repBadge = `<div style="margin-top:2px; font-size:10px; color:#D55E00; background:rgba(213,94,0,0.08); padding:2px 6px; border-radius:4px;">
                            <i class="fas fa-user-tie" style="margin-right:3px;"></i>派任${directorName ? ' <b>' + esc(directorName) + '</b>' : ''} 至 <b>${esc(targetLabel)}</b>
                        </div>`;
                    } else if (!isCompany) {
                        // 被查看的是人物：顯示是哪家法人派任的
                        repBadge = `<div style="margin-top:2px; font-size:10px; color:#D55E00; background:rgba(213,94,0,0.08); padding:2px 6px; border-radius:4px;">
                            <i class="fas fa-building" style="margin-right:3px;"></i>由 <b>${esc(appointingLabel || appointingId)}</b> 派任
                        </div>`;
                    }
                }
                const badgeColor = isRep ? 'background:rgba(213,94,0,0.15); color:#D55E00; font-weight:600;' : 'background:rgba(58,124,165,0.12); color:#3A7CA5;';
                const isHistEdge = ed.type === 'historical';
                return `
                    <div class="ws-detail-connection bedrock-historical-item" data-edge-type="${ed.type}" data-historical="${isHistEdge}" style="padding:5px 0; border-bottom:1px solid rgba(0,0,0,0.06); cursor:pointer; ${isHistEdge && !showHistorical ? 'display:none;' : ''}" onclick="(function(){ if(window.__bedrockCy) { var n = window.__bedrockCy.getElementById('${otherNodeId}'); if(n.length){ window.__bedrockCy.center(n); n.select(); } } })()">
                        <div>
                            <span style="color:#888; font-size:11px;">${direction}</span>
                            <span style="font-weight:500;">${esc(otherLabel)}</span>
                            <span style="${badgeColor} font-size:10px; padding:1px 6px; border-radius:8px; margin-left:4px;">${esc(ed.label || typeLabel)}</span>
                            ${isHistEdge ? '<span style="font-size:9px; color:#999; margin-left:4px;"><i class="fas fa-history"></i></span>' : ''}
                        </div>
                        ${repBadge}
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
                // 解析 description（可能包含 JSON/dict 字串）
                let descText = '';
                const descRaw = f.description || '';
                if (typeof descRaw === 'object') {
                    descText = descRaw.description || descRaw.message || '';
                } else {
                    descText = String(descRaw);
                }
                if (descText.includes("'evidence'") || descText.includes('"evidence"')) {
                    try {
                        const parsed = JSON.parse(descText.replace(/'/g, '"'));
                        if (parsed.description) descText = parsed.description;
                    } catch(e) {
                        const m = descText.match(/'description':\s*'([^']+)'/);
                        if (m) descText = m[1];
                    }
                }
                return `
                    <div style="padding:6px 0; border-left:3px solid ${c}; padding-left:8px; margin-bottom:4px;">
                        <div style="font-weight:600; font-size:12px;">
                            <span style="color:${c};">[${sl}]</span> ${esc(rn)}
                        </div>
                        <div style="font-size:11px; color:#666; margin-top:2px;">${esc(descText)}</div>
                    </div>`;
            }).join('');
        }

        // 格式化資本額
        const capitalStr = data.capital != null
            ? `NT$ ${Number(data.capital).toLocaleString()}`
            : '未知';

        // 法人派任區塊：找出所有與此節點相關的 representative 邊
        let corporateAppointmentHtml = '';
        if (edges.length > 0) {
            const repEdges = edges.filter(e => e.data('type') === 'representative');
            if (repEdges.length > 0 && isCompany) {
                const incomingReps = []; // 其他公司派任到此公司
                const outgoingReps = []; // 此公司派任到其他公司
                repEdges.forEach(e => {
                    const ed = e.data();
                    if (ed.target === data.id) {
                        const srcNode = state.cy.getElementById(ed.source);
                        incomingReps.push({
                            company: srcNode.length ? srcNode.data('label') : ed.source,
                            companyId: ed.source,
                            person: ed.director_name || ed.label.replace(/法人代表（(.+)）/, '$1') || '',
                        });
                    } else if (ed.source === data.id) {
                        const tgtNode = state.cy.getElementById(ed.target);
                        outgoingReps.push({
                            company: tgtNode.length ? tgtNode.data('label') : ed.target,
                            companyId: ed.target,
                            person: ed.director_name || ed.label.replace(/法人代表（(.+)）/, '$1') || '',
                        });
                    }
                });
                if (incomingReps.length > 0 || outgoingReps.length > 0) {
                    corporateAppointmentHtml = '<div class="ws-detail-section"><div class="ws-detail-section-title" style="color:#D55E00;"><i class="fas fa-user-tie" style="margin-right:4px;"></i>法人派任關係</div>';
                    if (incomingReps.length > 0) {
                        corporateAppointmentHtml += '<div style="font-size:11px; color:#888; margin-bottom:4px;">受派任（其他公司派人進入此公司董事會）：</div>';
                        incomingReps.forEach(r => {
                            corporateAppointmentHtml += `<div style="padding:4px 0; border-left:3px solid #D55E00; padding-left:8px; margin-bottom:3px; cursor:pointer;" onclick="(function(){ if(window.__bedrockCy) { var n = window.__bedrockCy.getElementById('${r.companyId}'); if(n.length){ window.__bedrockCy.center(n); n.select(); } } })()">
                                <span style="font-weight:600; color:#D55E00;">${esc(r.company)}</span>
                                <span style="font-size:11px; color:#666;"> → 派任 <b>${esc(r.person)}</b></span>
                            </div>`;
                        });
                    }
                    if (outgoingReps.length > 0) {
                        corporateAppointmentHtml += '<div style="font-size:11px; color:#888; margin-bottom:4px; margin-top:6px;">派出（此公司派人至其他公司董事會）：</div>';
                        outgoingReps.forEach(r => {
                            corporateAppointmentHtml += `<div style="padding:4px 0; border-left:3px solid #E67E22; padding-left:8px; margin-bottom:3px; cursor:pointer;" onclick="(function(){ if(window.__bedrockCy) { var n = window.__bedrockCy.getElementById('${r.companyId}'); if(n.length){ window.__bedrockCy.center(n); n.select(); } } })()">
                                <span style="font-weight:600; color:#E67E22;">${esc(r.company)}</span>
                                <span style="font-size:11px; color:#666;"> ← 派任 <b>${esc(r.person)}</b></span>
                            </div>`;
                        });
                    }
                    corporateAppointmentHtml += '</div>';
                }
            }
        }

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
                    <span class="ws-detail-value">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; background:${data.status === '核准設立' ? '#27AE60' : data.status === '解散' || data.status === '廢止' ? '#C0392B' : '#E67E22'};"></span>
                        ${esc(data.status || '未知')}
                    </span>
                </div>
                ${data.company_type ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">組織類型</span>
                    <span class="ws-detail-value">${esc(data.company_type)}</span>
                </div>` : ''}
                <div class="ws-detail-row">
                    <span class="ws-detail-label">資本額</span>
                    <span class="ws-detail-value">${capitalStr}</span>
                </div>
                <div class="ws-detail-row">
                    <span class="ws-detail-label">代表人</span>
                    <span class="ws-detail-value">${esc(data.representative || '未知')}</span>
                </div>
                ${data.established_date ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">設立日期</span>
                    <span class="ws-detail-value">${esc(data.established_date)}</span>
                </div>` : ''}
                ${data.dissolved_date ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">解散日期</span>
                    <span class="ws-detail-value" style="color:#C0392B;">${esc(data.dissolved_date)}</span>
                </div>` : ''}
                <div class="ws-detail-row">
                    <span class="ws-detail-label">登記地址</span>
                    <span class="ws-detail-value" style="font-size:11px; word-break:break-all;">${esc(data.address || '未知')}</span>
                </div>
                ${data.issued_shares ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">已發行股份</span>
                    <span class="ws-detail-value">${parseInt(data.issued_shares).toLocaleString()} 股</span>
                </div>` : ''}
                ${data.share_amount ? `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">每股金額</span>
                    <span class="ws-detail-value">NT$ ${parseInt(data.share_amount).toLocaleString()}</span>
                </div>` : ''}
                ${data.business_items && data.business_items.length > 0 ? `
                <div class="ws-detail-row" style="flex-direction:column;">
                    <span class="ws-detail-label" style="margin-bottom:4px;">所營事業 (${data.business_items.length})</span>
                    <div style="font-size:11px; color:#555; max-height:160px; overflow-y:auto; padding:6px 8px; background:rgba(0,0,0,0.02); border-radius:4px; line-height:1.6;">
                        ${data.business_items.map(item => esc(typeof item === 'string' ? item : (item.code || '') + ' ' + (item.name || ''))).join('<br>')}
                    </div>
                </div>` : ''}
                ` : (() => {
                    // 個人節點：從圖的邊反查所有關聯公司
                    let personCompaniesHtml = '';
                    if (cyNode && edges.length > 0) {
                        const companies = [];
                        edges.forEach(e => {
                            const ed = e.data();
                            const otherNodeId = ed.source === data.id ? ed.target : ed.source;
                            const otherNode = state.cy.getElementById(otherNodeId);
                            if (otherNode.length && otherNode.data('type') === 'company') {
                                const od = otherNode.data();
                                const role = ed.label || ed.type || '';
                                const isHistorical = ed.type === 'historical';
                                const statusColor = od.status === '核准設立' ? '#27AE60' : (od.status === '解散' || od.status === '廢止') ? '#C0392B' : '#E67E22';
                                const cap = od.capital ? (od.capital >= 10000 ? Math.round(od.capital / 10000).toLocaleString() + ' 萬' : od.capital.toLocaleString() + ' 元') : '';
                                companies.push({
                                    id: od.id, label: od.label || otherNodeId, role, isHistorical,
                                    status: od.status, statusColor, capital: cap, representative: od.representative,
                                    address: od.address, entity_id: od.entity_id,
                                });
                            }
                        });
                        if (companies.length > 0) {
                            // 分開現任與歷史
                            const currentCos = companies.filter(c => !c.isHistorical);
                            const histCos = companies.filter(c => c.isHistorical);
                            const renderCoCard = (c) => `
                                <div class="bedrock-historical-item" data-historical="${c.isHistorical}" style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.06); cursor:pointer; ${c.isHistorical ? 'opacity:0.55;' : ''}" onclick="(function(){ if(window.__bedrockCy) { var n = window.__bedrockCy.getElementById('${c.id}'); if(n.length){ window.__bedrockCy.center(n); n.select(); showNodeDetail(n.data()); } } })()">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                                        <span style="font-weight:600; font-size:14px; color:#333;">${esc(c.label)}</span>
                                        <span style="font-size:11px; padding:2px 8px; border-radius:8px; font-weight:500; background:${c.isHistorical ? '#f5f5f5; color:#999;' : 'rgba(58,124,165,0.12); color:#3A7CA5;'}">${esc(c.role)}</span>
                                    </div>
                                    <div style="font-family:monospace; font-size:12px; color:#888;">${esc(c.entity_id || '')}</div>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; font-size:12px; color:#555;">
                                        ${c.status ? `<span><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${c.statusColor}; margin-right:3px;"></span>${esc(c.status)}</span>` : ''}
                                        ${c.capital ? `<span>資本 ${c.capital}</span>` : ''}
                                        ${c.representative ? `<span>代表：${esc(c.representative)}</span>` : ''}
                                    </div>
                                    ${c.address ? `<div style="font-size:11px; color:#888; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.address)}</div>` : ''}
                                    ${c.isHistorical ? '<div style="font-size:10px; color:#E67E22; margin-top:3px;"><i class="fas fa-history" style="margin-right:2px;"></i>歷史關聯</div>' : ''}
                                </div>`;
                            personCompaniesHtml = '';
                            if (currentCos.length > 0) {
                                personCompaniesHtml += currentCos.map(renderCoCard).join('');
                            }
                            if (histCos.length > 0) {
                                const showH = showHistorical;
                                personCompaniesHtml += `<div class="bedrock-historical-section" data-historical="true" style="${showH ? '' : 'display:none;'}">
                                    <div style="font-size:11px; color:#999; padding:8px 10px 4px; border-top:1px dashed #ddd; margin-top:4px;">歷史關聯 (${histCos.length})</div>
                                    ${histCos.map(renderCoCard).join('')}
                                </div>`;
                            }
                        }
                    }
                    return `
                <div class="ws-detail-row">
                    <span class="ws-detail-label">職稱</span>
                    <span class="ws-detail-value">${esc(data.title || '董監事')}</span>
                </div>
                ${personCompaniesHtml ? `
                </div>
                <div class="ws-detail-section">
                    <div class="ws-detail-section-title"><i class="fas fa-building" style="margin-right:4px;"></i>關聯公司 (${edges.filter(e => { const o = state.cy.getElementById(e.data().source === data.id ? e.data().target : e.data().source); return o.length && o.data('type') === 'company'; }).length})</div>
                    <div style="max-height:400px; overflow-y:auto;">
                        ${personCompaniesHtml}
                    </div>
                ` : ''}
                `;
                })()}
            </div>

            ${isCompany && data.directors_data && data.directors_data.length > 0 ? (() => {
                // 董監事列表與持股比例
                const dirs = data.directors_data;
                const totalCapital = data.capital || 0;
                const issuedShares = data.issued_shares || 0;
                let dirsHtml = dirs.map(d => {
                    const name = d['姓名'] || d.name || '';
                    const title = d['職稱'] || d.title || '';
                    const repOf = d['所代表法人'] || d.representative_of || '';
                    const shares = d['出資額'] || d['持有股份數'] || d.shares || 0;
                    const sharesNum = parseInt(String(shares).replace(/,/g, ''), 10) || 0;

                    // 計算持股比例
                    let pctStr = '';
                    let pctWidth = 0;
                    if (sharesNum > 0 && totalCapital > 0) {
                        const pct = (sharesNum / totalCapital * 100);
                        pctStr = pct.toFixed(2) + '%';
                        pctWidth = Math.min(pct, 100);
                    } else if (sharesNum > 0 && issuedShares > 0) {
                        const pct = (sharesNum / issuedShares * 100);
                        pctStr = pct.toFixed(2) + '%';
                        pctWidth = Math.min(pct, 100);
                    }

                    const titleColors = {
                        '董事長': '#C0392B', '董事': '#2980B9', '監察人': '#8E44AD',
                        '獨立董事': '#16A085', '負責人': '#D35400', '合夥人': '#E67E22',
                    };
                    const tc = titleColors[title] || '#7F8C8D';

                    let repBadge = '';
                    if (repOf) {
                        const repName = Array.isArray(repOf) ? repOf.join(', ') : String(repOf);
                        repBadge = `<div style="font-size:9px; color:#D55E00; margin-top:1px;">
                            <i class="fas fa-building" style="margin-right:2px;"></i>${esc(repName)}
                        </div>`;
                    }

                    return `<div style="padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.04);">
                        <div style="display:flex; align-items:center; gap:4px;">
                            <span style="font-weight:500; font-size:12px;">${esc(name)}</span>
                            <span style="font-size:10px; padding:1px 5px; border-radius:8px; background:${tc}18; color:${tc};">${esc(title)}</span>
                        </div>
                        ${repBadge}
                        ${sharesNum > 0 ? `<div style="margin-top:2px;">
                            <div style="display:flex; align-items:center; gap:4px; font-size:10px;">
                                <span style="color:#888;">出資額</span>
                                <span style="font-family:monospace; color:#2C3E50;">NT$ ${sharesNum.toLocaleString()}</span>
                                ${pctStr ? `<span style="color:#E67E22; font-weight:600;">${pctStr}</span>` : ''}
                            </div>
                            ${pctWidth > 0 ? `<div style="height:3px; background:rgba(0,0,0,0.06); border-radius:2px; margin-top:2px;">
                                <div style="height:100%; width:${pctWidth}%; background:linear-gradient(90deg, #E67E22, #F39C12); border-radius:2px;"></div>
                            </div>` : ''}
                        </div>` : ''}
                    </div>`;
                }).join('');

                return `<div class="ws-detail-section">
                    <div class="ws-detail-section-title"><i class="fas fa-users" style="margin-right:4px;"></i>董監事名單 (${dirs.length})</div>
                    <div style="max-height:200px; overflow-y:auto;">
                        ${dirsHtml}
                    </div>
                </div>`;
            })() : ''}

            ${isCompany && data.directors_data && data.directors_data.length > 0 ? (() => {
                // 股東架構分析 — 計算持股分布
                const dirs = data.directors_data;
                const totalCapital = data.capital || 0;
                const issuedShares = data.issued_shares || 0;
                const base = issuedShares || totalCapital;
                if (base <= 0) return '';

                const shareholders = [];
                let accountedPct = 0;
                dirs.forEach(d => {
                    const name = d['姓名'] || d.name || '';
                    const shares = parseInt(String(d['出資額'] || d['持有股份數'] || d.shares || 0).replace(/,/g, ''), 10) || 0;
                    if (shares > 0 && name) {
                        const pct = shares / base * 100;
                        shareholders.push({ name, shares, pct });
                        accountedPct += pct;
                    }
                });
                if (shareholders.length === 0) return '';

                // 按持股比例排序
                shareholders.sort((a, b) => b.pct - a.pct);
                const colors = ['#2980B9', '#E67E22', '#27AE60', '#C0392B', '#8E44AD', '#16A085', '#D35400', '#7F8C8D'];

                let barHtml = shareholders.map((s, i) => {
                    const c = colors[i % colors.length];
                    const w = Math.max(s.pct, 1);
                    return `<div style="width:${w}%; background:${c}; height:100%; min-width:2px;" title="${esc(s.name)} ${s.pct.toFixed(1)}%"></div>`;
                }).join('');
                if (accountedPct < 100) {
                    barHtml += `<div style="width:${100 - accountedPct}%; background:#e0e0e0; height:100%;" title="其他/未知 ${(100-accountedPct).toFixed(1)}%"></div>`;
                }

                let legendHtml = shareholders.slice(0, 8).map((s, i) => {
                    const c = colors[i % colors.length];
                    return `<div style="display:flex; align-items:center; gap:4px; font-size:11px;">
                        <span style="width:8px; height:8px; border-radius:2px; background:${c}; flex-shrink:0;"></span>
                        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(s.name)}</span>
                        <span style="font-weight:600; color:${c};">${s.pct.toFixed(1)}%</span>
                    </div>`;
                }).join('');
                if (shareholders.length > 8) legendHtml += `<div style="font-size:10px; color:#999;">…及其他 ${shareholders.length - 8} 位</div>`;

                return `<div class="ws-detail-section">
                    <div class="ws-detail-section-title"><i class="fas fa-chart-pie" style="margin-right:4px;"></i>股東架構</div>
                    <div style="height:16px; display:flex; border-radius:8px; overflow:hidden; margin-bottom:8px;">
                        ${barHtml}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:3px;">
                        ${legendHtml}
                    </div>
                </div>`;
            })() : ''}

            ${corporateAppointmentHtml}

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

            ${isCompany ? `
            <div class="ws-detail-section bedrock-historical-section" style="${!showHistorical ? 'display:none;' : ''}">
                <div class="ws-detail-section-title" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between;" onclick="window.__bedrockToggleTimeline('${esc(data.entity_id)}')">
                    <span><i class="fas fa-history" style="margin-right:4px;"></i>歷史變動紀錄</span>
                    <i id="timeline-toggle-icon" class="fas fa-chevron-down" style="font-size:10px; transition:transform 0.3s;"></i>
                </div>
                <div id="changelog-filter-bar" style="display:none; margin-bottom:8px; flex-wrap:wrap; gap:4px;"></div>
                <div id="changelog-timeline" style="display:none;">
                    <div style="text-align:center; padding:20px; color:#999;">
                        <i class="fas fa-spinner fa-spin"></i> 載入中...
                    </div>
                </div>
            </div>
            ` : ''}
        `;

        // 暴露 cy 給 onclick 導航用
        window.__bedrockCy = state.cy;

        // 同步歷史資料顯示狀態
        syncHistoricalVisibility();

        // 加載風險評分
        loadNodeRiskScore(data.entity_id || data.id);
    }

    function closeDetail() {
        const panel = document.getElementById('ws-detail');
        if (panel) {
            panel.classList.remove('detail-visible');
        }
    }
    window.closeDetail = closeDetail;

    // ── 歷史變動時間軸 ────────────────────────────────────
    let _timelineLoaded = {};  // 快取已載入的時間軸資料
    let _timelineOpen = {};    // 記錄展開狀態
    let _timelineFilter = {};  // 當前篩選

    window.__bedrockToggleTimeline = async function(entityId) {
        const container = document.getElementById('changelog-timeline');
        const filterBar = document.getElementById('changelog-filter-bar');
        const icon = document.getElementById('timeline-toggle-icon');
        if (!container) return;

        const isOpen = container.style.display !== 'none';
        if (isOpen) {
            container.style.display = 'none';
            filterBar.style.display = 'none';
            if (icon) icon.style.transform = 'rotate(0deg)';
            _timelineOpen[entityId] = false;
            return;
        }

        container.style.display = 'block';
        filterBar.style.display = 'flex';
        if (icon) icon.style.transform = 'rotate(180deg)';
        _timelineOpen[entityId] = true;

        // 已載入過就不重新拉
        if (_timelineLoaded[entityId]) {
            _renderTimeline(entityId, _timelineFilter[entityId] || null);
            return;
        }

        // 從 API 拉資料
        try {
            const invId = state.currentInvId;
            // 用 entity_id 找 node
            const graphData = state.cy ? state.cy.nodes().filter(n => n.data('entity_id') === entityId) : [];
            let nodeId = entityId;
            if (graphData.length > 0) {
                // 從 node id 提取數字 ID
                const nid = graphData[0].data('id');
                // node id 格式可能是 "company_12345678" 或數字
                nodeId = nid;
            }

            const resp = await api.get(`/investigations/${invId}/nodes/${encodeURIComponent(entityId)}/changelog`);
            _timelineLoaded[entityId] = resp;
            _renderTimelineFilter(entityId, resp.change_types || []);
            _renderTimeline(entityId, null);
        } catch (err) {
            console.error('載入變更紀錄失敗:', err);
            container.innerHTML = `<div style="text-align:center; padding:15px; color:#C0392B; font-size:12px;">
                <i class="fas fa-exclamation-triangle"></i> 載入失敗：${esc(err.message || '未知錯誤')}
            </div>`;
        }
    };

    function _renderTimelineFilter(entityId, changeTypes) {
        const filterBar = document.getElementById('changelog-filter-bar');
        if (!filterBar || !changeTypes.length) return;

        let html = `<span style="font-size:10px; padding:3px 8px; border-radius:12px; cursor:pointer;
            background:${!_timelineFilter[entityId] ? '#3A7CA5' : 'rgba(58,124,165,0.1)'};
            color:${!_timelineFilter[entityId] ? '#fff' : '#3A7CA5'};"
            onclick="window.__bedrockFilterTimeline('${entityId}', null)">
            全部
        </span>`;

        changeTypes.forEach(ct => {
            const isActive = _timelineFilter[entityId] === ct.type;
            html += `<span style="font-size:10px; padding:3px 8px; border-radius:12px; cursor:pointer;
                background:${isActive ? ct.color : ct.color + '18'};
                color:${isActive ? '#fff' : ct.color}; white-space:nowrap;"
                onclick="window.__bedrockFilterTimeline('${entityId}', '${ct.type}')">
                <i class="fas ${ct.icon}" style="margin-right:2px; font-size:9px;"></i>${ct.label} (${ct.count})
            </span>`;
        });

        filterBar.innerHTML = html;
    }

    window.__bedrockFilterTimeline = function(entityId, changeType) {
        _timelineFilter[entityId] = changeType;
        const data = _timelineLoaded[entityId];
        if (data) {
            _renderTimelineFilter(entityId, data.change_types || []);
            _renderTimeline(entityId, changeType);
        }
    };

    function _renderTimeline(entityId, filterType) {
        const container = document.getElementById('changelog-timeline');
        if (!container) return;

        const data = _timelineLoaded[entityId];
        if (!data || !data.changes || data.changes.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:15px; color:#999; font-size:12px;">
                <i class="fas fa-inbox"></i> 尚無變更紀錄
            </div>`;
            return;
        }

        let changes = data.changes;
        if (filterType) {
            changes = changes.filter(c => c.change_type === filterType);
        }

        if (changes.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:10px; color:#999; font-size:12px;">
                此類型無變更紀錄
            </div>`;
            return;
        }

        // 按年月分組
        const groups = {};
        changes.forEach(c => {
            const key = c.change_date ? c.change_date.substring(0, 7) : '日期不明';
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        });

        let html = '<div style="position:relative; padding-left:16px;">';
        // 時間軸線
        html += '<div style="position:absolute; left:6px; top:0; bottom:0; width:2px; background:linear-gradient(to bottom, #3A7CA5, #E8E8E8);"></div>';

        Object.keys(groups).sort().reverse().forEach(monthKey => {
            const items = groups[monthKey];
            // 月份標頭
            html += `<div style="position:relative; margin-bottom:4px; margin-top:10px;">
                <div style="position:absolute; left:-14px; top:2px; width:10px; height:10px; border-radius:50%; background:#3A7CA5; border:2px solid #fff; box-shadow:0 0 0 2px #3A7CA5;"></div>
                <div style="font-weight:600; font-size:12px; color:#2C3E50; padding-left:6px;">${esc(monthKey)}</div>
            </div>`;

            items.forEach(c => {
                const beforeStr = _formatChangeValue(c.before_value, c.change_type);
                const afterStr = _formatChangeValue(c.after_value, c.change_type);
                const dateStr = c.change_date ? c.change_date.substring(5) : '';

                html += `<div style="position:relative; margin-bottom:6px; margin-left:6px; padding:6px 8px; background:rgba(0,0,0,0.02); border-radius:6px; border-left:3px solid ${c.color};">
                    <div style="position:absolute; left:-23px; top:10px; width:6px; height:6px; border-radius:50%; background:${c.color};"></div>
                    <div style="display:flex; align-items:center; gap:4px; margin-bottom:3px;">
                        <i class="fas ${c.icon}" style="font-size:10px; color:${c.color};"></i>
                        <span style="font-size:11px; font-weight:600; color:${c.color};">${esc(c.change_type_label)}</span>
                        ${dateStr ? `<span style="font-size:10px; color:#999; margin-left:auto;">${esc(dateStr)}</span>` : ''}
                    </div>
                    ${beforeStr || afterStr ? `<div style="font-size:10px; line-height:1.5;">
                        ${beforeStr ? `<div style="color:#999;"><span style="text-decoration:line-through;">${beforeStr}</span></div>` : ''}
                        ${afterStr ? `<div style="color:#2C3E50;">${afterStr}</div>` : ''}
                    </div>` : ''}
                </div>`;
            });
        });

        html += '</div>';
        html += `<div style="text-align:center; font-size:10px; color:#999; margin-top:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.06);">
            共 ${changes.length} 筆變更紀錄${data.total > changes.length ? `（總計 ${data.total} 筆）` : ''}
        </div>`;

        container.innerHTML = html;
    }

    function _formatChangeValue(val, changeType) {
        if (val === null || val === undefined || val === '') return '';
        if (typeof val === 'object') {
            // 董監事變更：可能是陣列
            if (Array.isArray(val)) {
                if (val.length === 0) return '（空）';
                // 若是董監事名單，取名字
                return val.map(item => {
                    if (typeof item === 'string') return esc(item);
                    if (item.name) return esc(item.name + (item.title ? '(' + item.title + ')' : ''));
                    return esc(JSON.stringify(item).substring(0, 60));
                }).join('、');
            }
            // JSONB 物件
            const entries = Object.entries(val);
            if (entries.length === 0) return '（空）';
            if (entries.length === 1) return esc(String(entries[0][1]));
            return entries.map(([k, v]) => esc(k + ': ' + String(v))).join('；');
        }
        // 資本額格式化
        if (changeType === 'capital_change' && !isNaN(val)) {
            return 'NT$ ' + Number(val).toLocaleString();
        }
        return esc(String(val));
    }

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
            state._clustersData = clusters;  // 快取供深度連動用
            if (countEl) countEl.textContent = clusters.length;

            // 建立 node → cluster label 映射（供分群上色用）
            state._nodeClusterMap = {};
            clusters.forEach(c => {
                const label = c.name || c.label || c.cluster_id;
                (c.member_tax_ids || []).forEach(tid => {
                    state._nodeClusterMap[tid] = label;
                });
            });

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

            listEl.innerHTML = renderClusterAccordion(clusters, algorithmLabels);
        } catch (e) {
            console.warn('[BEDROCK] 載入集群失敗:', e.message);
            if (countEl) countEl.textContent = '0';
            listEl.innerHTML = '<div class="ws-list-empty">尚無集群資料</div>';
        }
    }

    // ── 集群手風琴渲染：直接列出成員公司 ──────────────
    function renderClusterAccordion(clusters, algorithmLabels) {
        return clusters.map((c, idx) => {
            const algo = algorithmLabels[c.algorithm] || { icon: '📋', label: c.algorithm || '自訂' };
            const memberTaxIds = c.member_tax_ids || [];
            const memberCount = memberTaxIds.length;
            const confidence = c.confidence ? Math.round(c.confidence * 100) : 0;
            const confColor = confidence >= 70 ? '#C0392B' : confidence >= 40 ? '#E67E22' : '#95A5A6';

            // 從 Cytoscape 解析成員名稱
            const members = [];
            if (state.cy) {
                const idSet = new Set(memberTaxIds);
                state.cy.nodes().forEach(node => {
                    const d = node.data();
                    const eid = d.entity_id || d.id;
                    if (idSet.has(eid)) {
                        members.push({ id: d.id, label: d.label || eid, entity_id: eid, address: d.address || '', type: d.type || '', status: d.status || '', capital: d.capital || 0, representative: d.representative || '' });
                    }
                });
            }
            // 補上圖中找不到的
            const foundIds = new Set(members.map(m => m.entity_id));
            memberTaxIds.forEach(tid => {
                if (!foundIds.has(tid)) members.push({ id: tid, label: tid, entity_id: tid, address: '', type: '' });
            });

            const membersJson = JSON.stringify(memberTaxIds).replace(/"/g, '&quot;');
            const clusterName = esc(c.name || c.label || algo.label);

            return `
                <div class="ws-list-item" style="cursor:pointer; padding:8px 10px;" onclick="toggleClusterAccordion('cluster-members-${idx}', this); highlightCluster(${membersJson}, '${clusterName}')">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <i class="fas fa-chevron-right cluster-chevron" style="font-size:10px; color:#aaa; transition:transform 0.2s;"></i>
                        <span style="font-size:14px;">${algo.icon}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${clusterName}</div>
                            <div style="font-size:11px; color:#999;">${algo.label} · ${memberCount} 家 · 信心 <span style="color:${confColor};">${confidence}%</span></div>
                        </div>
                    </div>
                </div>
                <div id="cluster-members-${idx}" class="cluster-member-detail" style="display:none; margin:0 0 4px 20px; border-left:2px solid var(--color-accent, #2a8fa8); border-radius:0 0 4px 4px; background:rgba(0,0,0,0.02);">
                    ${members.map(m => {
                        const cap = m.capital ? (m.capital >= 10000 ? Math.round(m.capital/10000).toLocaleString() + ' 萬' : m.capital.toLocaleString() + ' 元') : '';
                        const statusColor = m.status === '核准設立' ? '#27AE60' : (m.status === '解散' || m.status === '廢止') ? '#C0392B' : '#E67E22';
                        return `<div style="padding:8px 10px; border-bottom:1px solid rgba(0,0,0,0.05); cursor:pointer;" onclick="event.stopPropagation(); reportClickNode('${esc(m.id)}');" onmouseover="this.style.background='rgba(42,143,168,0.08)'" onmouseout="this.style.background='transparent'">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:13px; font-weight:600;">${esc(m.label)}</span>
                                <span style="font-family:monospace; font-size:11px; color:#888;">${esc(m.entity_id)}</span>
                            </div>
                            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:3px; font-size:11px; color:#666;">
                                ${m.status ? `<span><span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${statusColor}; margin-right:2px;"></span>${esc(m.status)}</span>` : ''}
                                ${cap ? `<span>資本 ${cap}</span>` : ''}
                                ${m.representative ? `<span>代表：${esc(m.representative)}</span>` : ''}
                            </div>
                            ${m.address ? `<div style="font-size:10px; color:#999; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.address)}</div>` : ''}
                        </div>`;
                    }).join('')}
                </div>`;
        }).join('');
    }
    window.toggleClusterAccordion = function(detailId, headerEl) {
        const detail = document.getElementById(detailId);
        if (!detail) return;
        const isOpen = detail.style.display !== 'none';
        // 收合所有其他
        document.querySelectorAll('.cluster-member-detail').forEach(el => { el.style.display = 'none'; });
        document.querySelectorAll('.cluster-chevron').forEach(el => { el.style.transform = 'rotate(0deg)'; });
        if (!isOpen) {
            detail.style.display = 'block';
            const chevron = headerEl.querySelector('.cluster-chevron');
            if (chevron) chevron.style.transform = 'rotate(90deg)';
        } else {
            // 收合時同時清除遮罩
            clearClusterHighlight();
        }
    };

    // ── 縣市分群（從關聯圖節點地址提取） ──────────────
    function buildCityGroups() {
        const listEl = document.getElementById('city-groups-list');
        const countEl = document.getElementById('city-group-count');
        if (!listEl || !state.cy) return;

        // 從 Cytoscape 節點提取公司地址，用縣市歸類
        const cityMap = {};  // { "臺北市": [{ id, label, address }] }
        const taiwanCities = [
            '臺北市','台北市','新北市','桃園市','臺中市','台中市','臺南市','台南市',
            '高雄市','基隆市','新竹市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣',
            '嘉義市','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','台東縣','澎湖縣',
            '金門縣','連江縣',
        ];

        state.cy.nodes().forEach(n => {
            const d = n.data();
            if (d.type !== 'company') return;
            const addr = d.address || '';
            if (!addr) return;

            // 提取縣市
            let city = '';
            for (const c of taiwanCities) {
                if (addr.includes(c)) {
                    // 統一「臺」和「台」
                    city = c.replace('台北', '臺北').replace('台中', '臺中').replace('台南', '臺南').replace('台東', '臺東');
                    break;
                }
            }
            if (!city) city = '其他/未知';

            if (!cityMap[city]) cityMap[city] = [];
            cityMap[city].push({
                id: d.id,
                label: d.label || d.entity_id,
                address: addr,
                entity_id: d.entity_id,
            });
        });

        const cities = Object.keys(cityMap).sort((a, b) => cityMap[b].length - cityMap[a].length);
        if (countEl) countEl.textContent = cities.length;

        if (cities.length === 0) {
            listEl.innerHTML = '<div class="ws-list-empty">尚無公司地址資料</div>';
            return;
        }

        // 顏色列表
        const cityColors = ['#C0392B','#2980B9','#27AE60','#E67E22','#8E44AD','#16A085','#D35400','#2C3E50','#F39C12','#7F8C8D','#1ABC9C','#E74C3C','#3498DB','#9B59B6'];

        listEl.innerHTML = renderCityAccordion(cities, cityMap, cityColors);

        // 快取供外部使用
        state._cityGroups = cityMap;
    }

    // ── 縣市手風琴渲染 ──────────────
    function renderCityAccordion(cities, cityMap, cityColors) {
        return cities.map((city, idx) => {
            const companies = cityMap[city];
            const color = cityColors[idx % cityColors.length];
            const ids = JSON.stringify(companies.map(c => c.id)).replace(/"/g, '&quot;');
            return `
                <div class="ws-list-item" style="cursor:pointer; padding:8px 10px;" onclick="window.__bedrockHighlightCity(${ids}, '${esc(city)}', this)">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <i class="fas fa-chevron-right city-chevron" style="font-size:10px; color:#aaa; transition:transform 0.2s;"></i>
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13px; font-weight:500;">${esc(city)}</div>
                            <div style="font-size:11px; color:#999;">${companies.length} 家公司</div>
                        </div>
                    </div>
                </div>
                <div id="city-detail-${idx}" class="city-member-detail" style="display:none; margin:0 0 4px 20px; border-left:2px solid ${color}30; border-radius:0 0 4px 4px; background:rgba(0,0,0,0.02);">
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="background:rgba(0,0,0,0.04);">
                                <th style="text-align:left; padding:5px 8px; font-weight:600; color:#666;">公司名稱</th>
                                <th style="text-align:left; padding:5px 8px; font-weight:600; color:#666;">統編</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${companies.map(c => `
                                <tr style="cursor:pointer; border-bottom:1px solid rgba(0,0,0,0.05);" onclick="event.stopPropagation(); reportClickNode('${esc(c.id)}');" onmouseover="this.style.background='rgba(42,143,168,0.08)'" onmouseout="this.style.background='transparent'">
                                    <td style="padding:4px 8px; font-weight:500;">${esc(c.label)}</td>
                                    <td style="padding:4px 8px; color:#888; font-family:monospace; font-size:11px;">${esc(c.entity_id)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        }).join('');
    }

    window.__bedrockHighlightCity = function(nodeIds, cityName, headerEl) {
        // 切換該縣市的展開/收合
        const detailEls = document.querySelectorAll('.city-member-detail');
        const chevrons = document.querySelectorAll('.city-chevron');
        let targetDetail = null;
        if (headerEl) {
            targetDetail = headerEl.nextElementSibling;
        }
        const isOpen = targetDetail && targetDetail.style.display !== 'none';
        // 收合所有
        detailEls.forEach(el => { el.style.display = 'none'; });
        chevrons.forEach(el => { el.style.transform = 'rotate(0deg)'; });
        // 展開點擊的
        if (!isOpen && targetDetail) {
            targetDetail.style.display = 'block';
            const chevron = headerEl.querySelector('.city-chevron');
            if (chevron) chevron.style.transform = 'rotate(90deg)';
        }

        // 在關聯圖上高亮
        if (!state.cy) return;
        state.cy.nodes().removeClass('marked cluster-dimmed');
        state.cy.edges().removeClass('cluster-dimmed');

        const targetNodes = nodeIds.map(id => state.cy.getElementById(id)).filter(n => n.length > 0);
        if (targetNodes.length === 0) return;

        // 其他節點半透明
        state.cy.nodes().addClass('cluster-dimmed');
        state.cy.edges().addClass('cluster-dimmed');

        targetNodes.forEach(n => {
            n.removeClass('cluster-dimmed');
            n.addClass('marked');
            n.connectedEdges().forEach(e => {
                e.removeClass('cluster-dimmed');
            });
        });

        // 聚焦到這些節點
        const collection = state.cy.collection(targetNodes);
        state.cy.animate({ fit: { eles: collection, padding: 50 } }, { duration: 500 });
    };

    async function loadRedFlags(invId) {
        const listEl = document.getElementById('red-flags-list');
        const countEl = document.getElementById('flag-count');
        if (!listEl) return;

        try {
            const data = await api.get(`/investigations/${invId}/red-flags`);
            const flags = data.red_flags || data.items || [];
            state._redFlagsData = flags;  // 快取供深度連動用
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
                const targetId = esc(f.target_id || '');
                const targetType = esc(f.target_type || '');
                return `
                    <div class="ws-list-item" style="border-left: 3px solid ${color}; cursor:pointer;" onclick="highlightRedFlagTarget('${targetId}', '${targetType}', ${JSON.stringify(f.detail?.evidence || null).replace(/"/g, '&quot;')})">
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

    // ================================================================
    // 人名消歧義
    // ================================================================
    async function loadDisambiguation(invId) {
        const listEl = document.getElementById('disambig-list');
        const countEl = document.getElementById('disambig-count');
        if (!listEl) return;

        listEl.innerHTML = '<div class="ws-list-empty">分析中…</div>';
        if (countEl) countEl.textContent = '0';

        try {
            const data = await api.get(`/investigations/${invId}/disambiguation`);
            const candidates = data.candidates || [];
            const needsReview = data.needs_review || 0;
            if (countEl) countEl.textContent = needsReview || candidates.length;

            if (candidates.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">無同名人物需審查</div>';
                return;
            }

            listEl.innerHTML = candidates.slice(0, 20).map((c, idx) => {
                // 信心分數顏色
                let scoreColor, scoreBg, suggLabel;
                if (c.confidence >= 75) {
                    scoreColor = '#27AE60'; scoreBg = 'rgba(39,174,96,0.1)'; suggLabel = '同一人';
                } else if (c.confidence >= 40) {
                    scoreColor = '#F39C12'; scoreBg = 'rgba(243,156,18,0.1)'; suggLabel = '需審查';
                } else {
                    scoreColor = '#E74C3C'; scoreBg = 'rgba(231,76,60,0.1)'; suggLabel = '疑不同人';
                }

                const citiesStr = c.cities.filter(x => x !== '未知').join('、') || '未知';
                const factorsHtml = c.factors.map(f =>
                    `<div style="font-size:9px; display:flex; gap:4px; padding:1px 0;">
                        <span style="color:${f[1].startsWith('+') ? '#27AE60' : '#E74C3C'}; min-width:30px;">${esc(f[1])}</span>
                        <span style="color:#999;">${esc(f[0])}</span>
                    </div>`
                ).join('');

                const companiesHtml = c.companies.slice(0, 5).map(comp =>
                    `<div style="font-size:10px; padding:1px 0;">
                        <span style="color:#3498DB;">●</span> ${esc(comp.name)}
                        <span style="color:#999;">${esc(comp.title)} · ${esc(comp.city)}</span>
                    </div>`
                ).join('');

                return `
                    <div class="ws-list-item" style="cursor:pointer;" onclick="(function(){
                        var d=document.getElementById('disambig-detail-${idx}');
                        d.style.display=d.style.display==='none'?'block':'none';
                    })()">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:36px; height:36px; border-radius:50%; background:${scoreBg}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <span style="font-size:12px; font-weight:700; color:${scoreColor};">${c.confidence}</span>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:12px; font-weight:500;">${esc(c.name)}
                                    <span style="font-size:9px; padding:1px 5px; border-radius:3px; background:${scoreBg}; color:${scoreColor};">${suggLabel}</span>
                                </div>
                                <div style="font-size:10px; color:#999;">${c.company_count} 家公司 · ${citiesStr}</div>
                            </div>
                            <i class="fas fa-chevron-down" style="font-size:9px; color:#ccc;"></i>
                        </div>
                    </div>
                    <div id="disambig-detail-${idx}" style="display:none; padding:6px 8px 8px 16px; border-left:2px solid ${scoreColor}30;">
                        <div style="font-size:10px; font-weight:500; color:#F39C12; margin-bottom:4px;">信心分數因素</div>
                        ${factorsHtml}
                        <div style="font-size:10px; font-weight:500; color:#3498DB; margin:6px 0 4px;">關聯公司</div>
                        ${companiesHtml}
                        ${c.companies.length > 5 ? `<div style="font-size:9px; color:#999;">…還有 ${c.companies.length - 5} 家</div>` : ''}
                        ${c.suggestion !== 'high' ? `
                        <div style="margin-top:6px; display:flex; gap:6px;">
                            <button onclick="window.__bedrockSplitPerson('${esc(c.entity_id)}', ${JSON.stringify(c.companies.map(x=>x.entity_id)).replace(/"/g,'&quot;')})"
                                style="font-size:10px; padding:3px 8px; border:1px solid #E74C3C; color:#E74C3C; background:none; border-radius:4px; cursor:pointer;">
                                ✂ 拆分
                            </button>
                        </div>` : ''}
                    </div>`;
            }).join('');

            if (candidates.length > 20) {
                listEl.innerHTML += `<div style="font-size:10px; color:#999; padding:6px; text-align:center;">…還有 ${candidates.length - 20} 位</div>`;
            }

        } catch (e) {
            console.warn('[BEDROCK] 載入消歧義失敗:', e.message);
            // 404 = 功能未啟用或尚無資料，不顯示錯誤
            if (e.message && (e.message.includes('404') || e.message.includes('Not Found'))) {
                listEl.innerHTML = '<div class="ws-list-empty">尚無同名人物</div>';
            } else {
                listEl.innerHTML = '<div class="ws-list-empty">載入失敗：' + esc(e.message || '未知錯誤') + '</div>';
            }
        }
    }

    // 拆分人物的互動處理
    window.__bedrockSplitPerson = async function(personEid, companyEids) {
        if (companyEids.length < 2) {
            alert('至少需要 2 家公司才能拆分');
            return;
        }
        // 簡易拆分：把後半公司分到新人物
        const mid = Math.ceil(companyEids.length / 2);
        const groupB = companyEids.slice(mid);

        if (!confirm(`確定要將此人物拆分？\n將有 ${groupB.length} 家公司移到新人物節點。`)) return;

        try {
            const result = await api.post(`/investigations/${state.currentInvId}/disambiguation/split`, {
                person_entity_id: personEid,
                group_b: groupB,
            });
            if (result.success) {
                alert(`拆分成功！新人物：${result.new_name}（移動 ${result.edges_moved} 條關聯）`);
                // 重新載入圖和消歧義
                loadInvestigationData(state.currentInvId);
            }
        } catch (e) {
            alert('拆分失敗: ' + e.message);
        }
    };

    // ================================================================
    // UBO 穿透分析
    // ================================================================
    async function loadUBOChains(invId) {
        const listEl = document.getElementById('ubo-chains-list');
        const countEl = document.getElementById('ubo-count');
        if (!listEl) return;

        listEl.innerHTML = '<div class="ws-list-empty">載入中…</div>';
        if (countEl) countEl.textContent = '0';

        try {
            const data = await api.get(`/investigations/${invId}/ubo-chains`);
            const persons = data.persons || [];
            if (countEl) countEl.textContent = persons.length;

            if (persons.length === 0) {
                listEl.innerHTML = '<div class="ws-list-empty">尚無穿透路徑</div>';
                return;
            }

            listEl.innerHTML = persons.map((p, idx) => {
                const hasChains = p.chains && p.chains.length > 0;
                const maxDepth = p.total_depth || 0;
                const depthBadge = maxDepth >= 3
                    ? `<span style="background:#E74C3C; color:#fff; border-radius:3px; padding:1px 5px; font-size:9px; margin-left:4px;">${maxDepth}層</span>`
                    : maxDepth > 0
                        ? `<span style="background:#F39C12; color:#fff; border-radius:3px; padding:1px 5px; font-size:9px; margin-left:4px;">${maxDepth}層</span>`
                        : '';

                // 直接控制的公司數
                const directLabel = `直接 ${p.direct_count} 家`;
                const chainLabel = hasChains ? `，間接 ${p.chains.length} 條路徑` : '';

                // 展開後的詳細內容
                let detailHTML = '';
                if (hasChains) {
                    detailHTML = p.chains.slice(0, 10).map((chain, ci) => {
                        const pathNames = chain.path.map(n => n.name).join(' → ');
                        const pctDisplay = chain.effective_pct != null
                            ? `<span style="color:#27AE60; font-weight:600;">${chain.effective_pct}%</span>`
                            : '<span style="color:#999;">持股未知</span>';
                        const repNote = chain.via_rep ? `<span style="color:#8E44AD; font-size:9px;">via ${esc(chain.via_rep)}</span>` : '';

                        // 各層持股顯示
                        const layerPcts = chain.percentages.map((pct, li) => {
                            if (li === 0) return '';  // 第一層是直接持股，已顯示
                            const from = chain.path[li - 1]?.name || '?';
                            const to = chain.path[li]?.name || '?';
                            const val = pct != null ? `${pct}%` : '?';
                            return `<div style="font-size:9px; color:#666; padding-left:10px;">↳ ${esc(from)} → ${esc(to)}: ${val}</div>`;
                        }).join('');

                        return `
                            <div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                <div style="font-size:10px; color:#aaa; display:flex; align-items:center; gap:4px;">
                                    <span style="color:#8E44AD;">⛓</span>
                                    <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(pathNames)}</span>
                                    ${pctDisplay}
                                </div>
                                ${layerPcts}
                                ${repNote ? `<div style="padding-left:10px;">${repNote}</div>` : ''}
                            </div>`;
                    }).join('');

                    if (p.chains.length > 10) {
                        detailHTML += `<div style="font-size:10px; color:#999; padding:3px 0;">…還有 ${p.chains.length - 10} 條路徑</div>`;
                    }
                }

                // 直接公司列表
                const directHTML = p.direct_companies.map(c => {
                    const pctStr = c.shares_pct != null ? ` (${c.shares_pct}%)` : '';
                    return `<div style="font-size:10px; color:#ccc; padding:2px 0 2px 10px;">
                        <span style="color:#3498DB;">●</span> ${esc(c.name)}
                        <span style="color:#999;">${esc(c.title)}${pctStr}</span>
                    </div>`;
                }).join('');

                return `
                    <div class="ws-list-item" style="cursor:pointer;" onclick="(function(){
                        var d=document.getElementById('ubo-detail-${idx}');
                        d.style.display=d.style.display==='none'?'block':'none';
                        if(window.__bedrockCy){
                            var n=window.__bedrockCy.getElementById('${esc(p.entity_id)}');
                            if(n.length){window.__bedrockCy.center(n);n.select();}
                        }
                    })()">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="color:#8E44AD; font-size:14px;">👤</span>
                            <div style="flex:1; min-width:0;">
                                <div style="font-size:12px; font-weight:500;">${esc(p.name)} ${depthBadge}</div>
                                <div style="font-size:10px; color:#999;">${directLabel}${chainLabel}</div>
                            </div>
                            <i class="fas fa-chevron-down" style="font-size:9px; color:#ccc;"></i>
                        </div>
                    </div>
                    <div id="ubo-detail-${idx}" style="display:none; padding:4px 8px 8px 20px; border-left:2px solid rgba(142,68,173,0.3);">
                        <div style="font-size:10px; font-weight:500; color:#8E44AD; margin-bottom:4px;">直接控制</div>
                        ${directHTML}
                        ${hasChains ? `<div style="font-size:10px; font-weight:500; color:#8E44AD; margin:6px 0 4px;">間接控制鏈</div>${detailHTML}` : ''}
                    </div>`;
            }).join('');

        } catch (e) {
            console.warn('[BEDROCK] 載入 UBO 穿透失敗:', e.message);
            listEl.innerHTML = '<div class="ws-list-empty">載入失敗</div>';
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

            state._mediaData = items;  // 快取供深度連動用

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
                    const maxDepth = depthSelect ? parseInt(depthSelect.value) : 0;
                    const crossCaseSelect = document.getElementById('cross-case-depth');
                    const crossCaseDepth = crossCaseSelect ? parseInt(crossCaseSelect.value) : 4;
                    await api.post(`/investigations/${state.currentInvId}/crawl/start`, { max_depth: maxDepth, cross_case_depth: crossCaseDepth });
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
                                    animationDuration: 400,
                                    nodeSpacing: 45,
                                    edgeLength: 140,
                                    convergenceThreshold: 0.001,
                                    randomize: false,
                                    avoidOverlap: true,
                                    handleDisconnected: true,
                                    flow: { axis: 'y', minSeparation: 40 },
                                    unconstrIter: 10,
                                    userConstIter: 15,
                                    allConstIter: 15,
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
            btnAnalyze.addEventListener('click', () => runAnalysis());
        }
    }

    window.__bedrockReanalyze = function() { runAnalysis(); };

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

            // 重新載入所有資料（圖 + 紅旗 + 集群 + 媒體）
            loadInvestigationData(state.currentInvId);

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
            const headers = {};
            const token = localStorage.getItem('bedrock_token') || state.token;
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(API_BASE + `/investigations/${state.currentInvId}/export/${format}`, {
                method: 'GET',
                headers,
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
        // 關閉儀表板後，恢復 workflow hint 讓使用者可以再次打開
        if (state.currentInvId) {
            _hintDismissed = false;
            showWorkflowHint('review');
        }
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
        const direct = state.cy.getElementById(targetId);
        if (direct && direct.length > 0) return true;
        const byEntity = state.cy.nodes().filter(n => n.data('entity_id') === targetId);
        return byEntity.length > 0;
    }

    /** 檢查 target 是否在當前可見範圍（深度/篩選後仍顯示） */
    function isTargetVisible(targetId) {
        if (!state.cy || !targetId) return false;
        let node = state.cy.getElementById(targetId);
        if (!node || node.length === 0) {
            const byEntity = state.cy.nodes().filter(n => n.data('entity_id') === targetId);
            if (byEntity.length > 0) node = byEntity[0];
            else return false;
        }
        // 節點存在但可能被深度篩選隱藏
        return node.style('display') !== 'none' && parseFloat(node.style('opacity')) > 0.3;
    }

    /** 取得當前可見節點的 entity_id 集合（供儀表板過濾） */
    function getVisibleEntityIds() {
        if (!state.cy) return null;
        const ids = new Set();
        state.cy.nodes().forEach(n => {
            if (n.style('display') !== 'none' && parseFloat(n.style('opacity')) > 0.3) {
                const d = n.data();
                if (d.entity_id) ids.add(d.entity_id);
                if (d.id) ids.add(d.id);
                if (d.label) ids.add(d.label);
            }
        });
        return ids;
    }

    /** 根據可見節點過濾儀表板資料 */
    function filterDashboardByVisibleNodes(data) {
        if (!state.cy) return data;

        const visibleIds = getVisibleEntityIds();
        if (!visibleIds || visibleIds.size === 0) return data;

        // 總節點數與可見節點數相同 → 不需過濾
        const totalNodes = state.cy.nodes().length;
        const visibleCount = state.cy.nodes().filter(n => n.style('display') !== 'none').length;
        if (visibleCount >= totalNodes) return data;

        // 過濾 top_critical
        const filteredTop = (data.top_critical || []).filter(f =>
            visibleIds.has(f.target_id) || isTargetVisible(f.target_id)
        );

        // 過濾 entity_hotspots
        const filteredHotspots = (data.entity_hotspots || []).filter(h =>
            visibleIds.has(h.target_id) || isTargetVisible(h.target_id)
        );

        // 過濾 category_groups 中的 sample_flags 和計數
        const filteredGroups = {};
        for (const [catKey, cat] of Object.entries(data.category_groups || {})) {
            const filteredRules = (cat.rules || []).map(r => {
                const filteredSamples = (r.sample_flags || []).filter(s =>
                    visibleIds.has(s.target_id) || isTargetVisible(s.target_id)
                );
                // 用過濾後的比例估算 count
                const ratio = r.sample_flags && r.sample_flags.length > 0
                    ? filteredSamples.length / r.sample_flags.length : 1;
                return {
                    ...r,
                    sample_flags: filteredSamples,
                    count: Math.round(r.count * ratio),
                    by_severity: {
                        CRITICAL: Math.round((r.by_severity?.CRITICAL || 0) * ratio),
                        WARNING: Math.round((r.by_severity?.WARNING || 0) * ratio),
                        INFO: Math.round((r.by_severity?.INFO || 0) * ratio),
                    },
                };
            }).filter(r => r.count > 0);

            if (filteredRules.length > 0) {
                const total = filteredRules.reduce((s, r) => s + r.count, 0);
                const bySev = {};
                filteredRules.forEach(r => {
                    for (const [k, v] of Object.entries(r.by_severity || {})) {
                        bySev[k] = (bySev[k] || 0) + v;
                    }
                });
                filteredGroups[catKey] = { ...cat, rules: filteredRules, total, by_severity: bySev };
            }
        }

        // 重新計算 severity_summary
        const sevSummary = {};
        filteredTop.forEach(f => {
            sevSummary[f.severity] = (sevSummary[f.severity] || 0) + 1;
        });

        return {
            ...data,
            top_critical: filteredTop,
            entity_hotspots: filteredHotspots,
            category_groups: filteredGroups,
            severity_summary: Object.keys(sevSummary).length > 0 ? sevSummary : data.severity_summary,
            total_flags: filteredTop.length || data.total_flags,
            _filtered: true,
            _visibleCount: visibleCount,
            _totalNodes: totalNodes,
        };
    }

    function renderAnalysisDashboard(data) {
        // 根據深度/篩選過濾儀表板資料
        const filtered = _dashboardFilterInGraph ? data : filterDashboardByVisibleNodes(data);

        // 嚴重程度卡
        const el = (id) => document.getElementById(id);
        el('ad-total').textContent = filtered.total_flags || 0;
        el('ad-critical').textContent = (filtered.severity_summary || {}).CRITICAL || 0;
        el('ad-warning').textContent = (filtered.severity_summary || {}).WARNING || 0;
        el('ad-info').textContent = (filtered.severity_summary || {}).INFO || 0;

        // 如果有過濾，顯示提示
        const filterHint = document.getElementById('ad-filter-hint');
        if (filterHint) {
            if (filtered._filtered && filtered._visibleCount < filtered._totalNodes) {
                filterHint.style.display = '';
                filterHint.textContent = `目前顯示 ${filtered._visibleCount}/${filtered._totalNodes} 個節點的分析結果（依深度/篩選連動）`;
            } else {
                filterHint.style.display = 'none';
            }
        }

        // 分類群組
        renderCategoryGroups(filtered.category_groups || {});

        // Top 10
        renderTopFindings(filtered.top_critical || []);

        // 實體熱點
        renderEntityHotspots(filtered.entity_hotspots || []);
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

    /** 點擊紅旗 → 在圖上高亮對應節點 + 相關公司 */
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

        // ── 收集所有需要高亮的 ID（主體 + 相關公司）──
        const highlightIds = new Set();
        highlightIds.add(targetId);

        // 從 _dashboardData 中找出此 target 的 evidence（UBO 相關）
        const evidence = findFlagEvidence(targetId);
        if (evidence) {
            // UBO_CONCENTRATION: all_controlled 有 tax_id 列表
            if (evidence.all_controlled) {
                evidence.all_controlled.forEach(c => {
                    if (c.tax_id) highlightIds.add(c.tax_id);
                });
            }
            // direct_companies
            if (evidence.direct_companies) {
                evidence.direct_companies.forEach(tid => highlightIds.add(tid));
            }
            // HIDDEN_UBO: rep_companies, direct_companies_list
            if (evidence.rep_companies) {
                evidence.rep_companies.forEach(tid => highlightIds.add(tid));
            }
            if (evidence.direct_companies_list) {
                evidence.direct_companies_list.forEach(tid => highlightIds.add(tid));
            }
        }

        // 也把 person:xxx 格式的 ID 轉成純姓名方便匹配
        const personName = targetId.startsWith('person:') ? targetId.slice(7) : null;

        // 找到並高亮所有相關節點
        let matched = state.cy.collection();
        state.cy.nodes().forEach(node => {
            const d = node.data();
            const eid = d.entity_id || d.id;
            const label = d.label || '';

            if (highlightIds.has(eid) || highlightIds.has(label) ||
                (personName && label === personName)) {
                node.addClass('marked');
                // 確保可見
                node.style('display', 'element');
                node.style('opacity', 1);
                matched = matched.union(node);
            }
        });

        // 讓連接這些節點的邊也可見
        if (matched.length > 1) {
            matched.edgesWith(matched).style('display', 'element');
            matched.edgesWith(matched).style('opacity', 1);
        }

        if (matched.length > 0) {
            state.cy.animate({
                fit: { eles: matched, padding: 60 },
                duration: 500,
            });
            const names = matched.map(n => n.data('label') || n.data('entity_id')).slice(0, 5).join('、');
            Toast.show(`已標記 ${matched.length} 個相關節點：${names}${matched.length > 5 ? '…' : ''}`, 'info', 3000);

            // 同時顯示右側詳情面板
            if (personName) {
                const personNode = matched.filter(n => n.data('label') === personName || n.data('type') === 'person');
                if (personNode.length > 0) showNodeDetail(personNode[0].data());
            } else if (matched.length === 1) {
                showNodeDetail(matched[0].data());
            }
        } else {
            Toast.warning(`「${targetId}」不在目前顯示的圖上（可能被深度篩選過濾，或屬於其他調查案件）`);
        }
    }

    /** 從 _dashboardData 中找出某個 target 的 evidence 資料 */
    function findFlagEvidence(targetId) {
        if (!_dashboardData) return null;

        // 搜尋 top_critical
        for (const f of (_dashboardData.top_critical || [])) {
            if (f.target_id === targetId && f.detail && f.detail.evidence) {
                return f.detail.evidence;
            }
        }

        // 搜尋 category_groups 中的 sample_flags
        for (const [, cat] of Object.entries(_dashboardData.category_groups || {})) {
            for (const r of (cat.rules || [])) {
                for (const s of (r.sample_flags || [])) {
                    if (s.target_id === targetId && s.detail && s.detail.evidence) {
                        return s.detail.evidence;
                    }
                }
            }
        }

        // 搜尋 entity_hotspots
        for (const h of (_dashboardData.entity_hotspots || [])) {
            if (h.target_id === targetId && h.evidence) {
                return h.evidence;
            }
        }

        return null;
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

    /**
     * 將紅旗 evidence 物件格式化為人類可讀的 HTML
     * 不再直接顯示 JSON，而是提取關鍵欄位以易讀方式呈現
     */
    function _formatEvidenceReadable(ev) {
        if (!ev || typeof ev !== 'object') return '';
        // 如果 evidence 是字串（Python dict repr），嘗試解析
        if (typeof ev === 'string') {
            try { ev = JSON.parse(ev.replace(/'/g, '"')); } catch(e) { return esc(ev); }
        }
        const parts = [];
        // ── 星形控制結構 / 多公司控制 ──
        if (ev.director_name) parts.push('控制人：' + ev.director_name);
        if (ev.company_count) parts.push('控制公司數：' + ev.company_count + ' 家');
        if (ev.companies && Array.isArray(ev.companies)) {
            const display = ev.companies.slice(0, 5).join('、');
            const more = ev.companies.length > 5 ? '…等共 ' + ev.companies.length + ' 家' : '';
            parts.push('公司統一編號：' + display + more);
        }
        // ── 資本額異常 ──
        if (ev.capital !== undefined) parts.push('資本額：NT$ ' + Number(ev.capital).toLocaleString());
        // ── 休眠復甦 ──
        if (ev.dormant_days) {
            const yrs = Math.round(ev.dormant_days / 365 * 10) / 10;
            parts.push('休眠 ' + ev.dormant_days + ' 天（約 ' + yrs + ' 年）');
        }
        if (ev.dormant_from && ev.dormant_until) parts.push('休眠期間：' + ev.dormant_from + ' ~ ' + ev.dormant_until);
        if (ev.company_name) parts.push('公司：' + ev.company_name);
        if (ev.valid_date_count) parts.push('有效變更紀錄：' + ev.valid_date_count + ' 筆');
        if (ev.total_changelog_count) parts.push('總變更紀錄：' + ev.total_changelog_count + ' 筆');
        // ── 資本劇烈變動 ──
        if (ev.volatility_events && Array.isArray(ev.volatility_events)) {
            const evts = ev.volatility_events.slice(0, 3);
            evts.forEach(e => {
                const before = e.before != null ? 'NT$ ' + Number(e.before).toLocaleString() : '?';
                const after = e.after != null ? 'NT$ ' + Number(e.after).toLocaleString() : '?';
                const ratio = e.ratio ? '(' + (e.ratio > 1 ? '+' : '') + Math.round((e.ratio - 1) * 100) + '%)' : '';
                parts.push((e.date || '') + '：' + before + ' → ' + after + ' ' + ratio);
            });
            if (ev.volatility_events.length > 3) parts.push('…等共 ' + ev.volatility_events.length + ' 次');
        }
        // ── 地址聚集 ──
        if (ev.address) parts.push('地址：' + esc(String(ev.address).substring(0, 60)));
        if (ev.tax_ids && Array.isArray(ev.tax_ids)) {
            const display = ev.tax_ids.slice(0, 5).join('、');
            const more = ev.tax_ids.length > 5 ? '…等共 ' + ev.tax_ids.length + ' 家' : '';
            parts.push('相關公司：' + display + more);
        }
        // ── UBO 控制 ──
        if (ev.controlled_count) parts.push('控制 ' + ev.controlled_count + ' 家公司');
        if (ev.direct_count) parts.push('直接持股 ' + ev.direct_count + ' 家');
        if (ev.rep_count) parts.push('法人代表 ' + ev.rep_count + ' 家');
        if (ev.total_capital) parts.push('合計資本：NT$ ' + Number(ev.total_capital).toLocaleString());
        // ── 變更頻率 ──
        if (ev.event_count) parts.push(ev.event_count + ' 次變更');
        if (ev.threshold_days) parts.push('於 ' + ev.threshold_days + ' 天內');
        // ── 循環持股 ──
        if (ev.cycle && Array.isArray(ev.cycle)) parts.push('循環路徑：' + ev.cycle.join(' → '));
        // ── 橋接節點 ──
        if (ev.connected_companies) parts.push('連接 ' + ev.connected_companies + ' 家公司');
        // ── 批量登記 ──
        if (ev.batch_count) parts.push('同日登記 ' + ev.batch_count + ' 家');
        if (ev.batch_date) parts.push('登記日期：' + ev.batch_date);
        // ── 跨調查 ──
        if (ev.overlap_count) parts.push('出現在其他 ' + ev.overlap_count + ' 個調查中');
        if (ev.investigation_count) parts.push('出現在 ' + ev.investigation_count + ' 個調查中');
        // ── 異常產業組合 ──
        if (ev.industries && Array.isArray(ev.industries)) parts.push('產業組合：' + ev.industries.join('、'));
        // ── 董事走馬燈 ──
        if (ev.changes && Array.isArray(ev.changes)) {
            parts.push('異動次數：' + ev.changes.length + ' 次');
            ev.changes.slice(0, 3).forEach(c => {
                parts.push((c.date || '') + '：' + (c.before || '?') + ' → ' + (c.after || '?'));
            });
        }
        // ── 年齡異常 ──
        if (ev.age) parts.push('年齡：' + ev.age + ' 歲');
        // ── 實體名稱、標籤 ──
        if (ev.entity_label && !ev.director_name && !ev.company_name) parts.push('對象：' + ev.entity_label);

        // ── Fallback：顯示未處理的欄位 ──
        if (parts.length === 0) {
            const keys = Object.keys(ev).filter(k => k !== 'entity_id');
            if (keys.length > 0) {
                keys.forEach(k => {
                    const v = ev[k];
                    if (v !== null && v !== undefined && v !== '') {
                        const display = Array.isArray(v) ? v.slice(0, 5).join('、') + (v.length > 5 ? '…等' + v.length + '項' : '') : String(v);
                        parts.push(k.replace(/_/g, ' ') + '：' + display);
                    }
                });
            }
        }

        if (parts.length === 0) return '';
        return parts.map(p => '<div style="line-height:1.5;">' + esc(p) + '</div>').join('');
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
            // 呼叫後端登出（不等結果）
            api.post('/auth/logout', {}).catch(() => {});
            state.user = null;
            auth.clearAuth();
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
        if (tabName === 'database') {
            dbRefreshOverview();
        }
    }
    window.switchAdminTab = switchAdminTab;

    // ========== 系統設定編輯功能 ==========
    window.editConfigStart = function(key) {
        document.querySelector('.config-display-' + key).style.display = 'none';
        document.querySelector('.config-input-' + key).style.display = '';
        document.querySelector('.config-edit-btn[data-key="' + key + '"]').style.display = 'none';
        document.querySelector('.config-save-btn[data-key="' + key + '"]').style.display = '';
        document.querySelector('.config-cancel-btn[data-key="' + key + '"]').style.display = '';
        document.querySelector('.config-input-' + key).focus();
    };
    window.editConfigCancel = function(key) {
        document.querySelector('.config-display-' + key).style.display = '';
        document.querySelector('.config-input-' + key).style.display = 'none';
        document.querySelector('.config-edit-btn[data-key="' + key + '"]').style.display = '';
        document.querySelector('.config-save-btn[data-key="' + key + '"]').style.display = 'none';
        document.querySelector('.config-cancel-btn[data-key="' + key + '"]').style.display = 'none';
    };
    window.editConfigSave = async function(key) {
        const input = document.querySelector('.config-input-' + key);
        const newValue = input.value;
        try {
            await api.put('/settings/' + encodeURIComponent(key) + '?value=' + encodeURIComponent(newValue));
            // 更新顯示
            document.querySelector('.config-display-' + key).innerHTML =
                '<code style="background:#f5f5f3; padding:2px 6px; border-radius:3px;">' + esc(newValue) + '</code>';
            editConfigCancel(key);
            showToast('設定已更新', 'success');
        } catch (e) {
            showToast('更新失敗: ' + e.message, 'error');
        }
    };

    // ========== 使用者管理 CRUD ==========
    window.updateUserRole = async function(userId, newRole) {
        try {
            await api.patch('/admin/users/' + userId, { role: newRole });
            showToast('角色已更新', 'success');
            loadAdminUsers();
        } catch (e) {
            showToast('更新失敗: ' + e.message, 'error');
        }
    };
    window.updateUserStatus = async function(userId, newStatus) {
        try {
            await api.patch('/admin/users/' + userId, { status: newStatus });
            showToast('狀態已更新', 'success');
            loadAdminUsers();
        } catch (e) {
            showToast('更新失敗: ' + e.message, 'error');
        }
    };

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

    // 隱藏只剩歷史邊（無現任邊）的人物節點
    function updateHistoricalOrphanNodes() {
        if (!state.cy) return;
        const personNodes = state.cy.nodes('[type="person"]');
        personNodes.forEach(node => {
            const edges = node.connectedEdges();
            if (edges.length === 0) return;
            // 檢查是否有任何「非歷史」且可見的邊
            const hasVisibleCurrentEdge = edges.some(e => {
                return e.data('type') !== 'historical' && e.style('display') !== 'none';
            });
            // 檢查是否有可見的歷史邊
            const hasVisibleHistoricalEdge = edges.some(e => {
                return e.data('type') === 'historical' && e.style('display') !== 'none';
            });
            if (!hasVisibleCurrentEdge && !hasVisibleHistoricalEdge) {
                // 沒有任何可見的邊 → 隱藏此人
                node.style('display', 'none');
            } else if (!hasVisibleCurrentEdge && !showHistorical) {
                // 只有歷史邊但歷史已關閉 → 隱藏此人
                node.style('display', 'none');
            } else {
                // 有可見的現任邊或歷史邊 → 顯示
                node.style('display', 'element');
            }
        });
    }

    function toggleHistoricalEdges() {
        if (!state.cy) return;
        showHistorical = !showHistorical;
        const historicalEdges = state.cy.edges('[type="historical"]');
        if (showHistorical) {
            historicalEdges.style('display', 'element');
            Toast.show('已顯示歷史關聯（含離任人員）', 'info');
        } else {
            historicalEdges.style('display', 'none');
            Toast.show('已隱藏歷史關聯與離任人員', 'info');
        }
        // 同步隱藏/顯示只有歷史邊的人物節點
        updateHistoricalOrphanNodes();
        // Update button state
        const btn = document.getElementById('btn-toggle-historical');
        if (btn) {
            btn.classList.toggle('ws-tool-btn-active', showHistorical);
            btn.title = showHistorical ? '隱藏歷史關聯與離任人員' : '顯示歷史關聯與離任人員';
        }
        // ── 全面聯動：詳情面板、表格中的歷史項目 ──
        syncHistoricalVisibility();
        // 重新適配圖形到螢幕（不做全量 relayout，只 fit 可見節點，保持原有位置）
        setTimeout(() => {
            if (state.cy) {
                const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
                if (visible.length > 0) {
                    state.cy.fit(visible, 40);
                }
            }
        }, 100);
    }
    window.toggleHistoricalEdges = toggleHistoricalEdges;

    // 同步歷史資料顯示狀態到所有面板
    function syncHistoricalVisibility() {
        // 1. 詳情面板中帶有 data-historical="true" 的項目
        document.querySelectorAll('.bedrock-historical-item[data-historical="true"]').forEach(el => {
            el.style.display = showHistorical ? '' : 'none';
        });
        // 2. 歷史變動紀錄區塊
        const timelineSection = document.getElementById('changelog-timeline');
        const timelineTitle = timelineSection ? timelineSection.closest('.ws-detail-section') : null;
        if (timelineTitle) {
            timelineTitle.style.display = showHistorical ? '' : 'none';
        }
        // 3. 關聯架構中的歷史邊
        document.querySelectorAll('.ws-detail-connection[data-edge-type="historical"]').forEach(el => {
            el.style.display = showHistorical ? '' : 'none';
        });
    }
    window.syncHistoricalVisibility = syncHistoricalVisibility;

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
        // 同步隱藏只剩被篩掉的歷史邊的人物節點
        updateHistoricalOrphanNodes();
        // 重新適配圖形
        if (typeof autoResizeAndRelayout === 'function') {
            autoResizeAndRelayout();
        } else {
            setTimeout(() => { if (state.cy) state.cy.fit(undefined, 40); }, 100);
        }
    }
    window.filterHistoricalByRange = filterHistoricalByRange;

    // 面板展開/收合 + 更新 grid-template-columns（右側面板改為浮動，不影響 grid）
    function updateGridColumns() {
        const body = document.querySelector('.workspace-body');
        if (!body) return;
        const sidebarCollapsed = document.querySelector('.ws-sidebar.collapsed');
        body.style.gridTemplateColumns = sidebarCollapsed ? '40px 1fr' : '240px 1fr';
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

    // ==================== 主導航欄收合 ====================
    function toggleNavSidebar() {
        const nav = document.getElementById('nav-sidebar');
        if (!nav) return;
        nav.classList.toggle('nav-collapsed');
        const isCollapsed = nav.classList.contains('nav-collapsed');
        const btn = document.getElementById('btn-collapse-nav');
        if (btn) btn.title = isCollapsed ? '展開選單' : '收合選單';

        // JS fallback for browsers without :has() support
        const ml = isCollapsed ? '56px' : '';
        const w = isCollapsed ? 'calc(100% - 56px)' : '';
        ['welcome-scene', 'workspace-scene'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.marginLeft = ml; el.style.width = w; }
        });

        // 讓主要內容區域 resize
        if (state.cy) setTimeout(() => state.cy.resize(), 300);
    }
    window.toggleNavSidebar = toggleNavSidebar;

    function toggleDetailPanel() {
        // 右側面板：直接關閉（等同 closeDetail）
        closeDetail();
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

        // 取得 seed 節點的 entity_id（多種方式確保能抓到）
        const seedItems = document.querySelectorAll('.ws-seed-item');
        const seedValues = new Set();
        seedItems.forEach(el => {
            // 方法1: 從 onclick 提取（相容 focusSeedNode 和 focusSeedNodeEnhanced）
            const onclick = el.getAttribute('onclick') || '';
            const match = onclick.match(/focusSeedNode(?:Enhanced)?\('(.+?)'\)/);
            if (match) seedValues.add(match[1]);
            // 方法2: 從 data-seed-id 提取
            const seedId = el.getAttribute('data-seed-id');
            if (seedId) seedValues.add(seedId);
        });

        // 在圖中找到 seed 節點（seed 距離 = 0）
        // 優先用 is_seed 標記（由 graph API 提供）
        state.cy.nodes().forEach(node => {
            const d = node.data();
            const entityId = d.entity_id || d.id;
            if (d.is_seed || seedValues.has(entityId) || seedValues.has(d.label)) {
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

    // ==================== 自動調整節點/邊大小 + 重新排版 ====================
    function autoResizeAndRelayout() {
        if (!state.cy) return;

        const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
        const visibleEdges = state.cy.edges().filter(e => e.style('display') !== 'none');
        const count = visible.length;

        if (count === 0) return;

        // ── 動態計算節點大小與邊寬 ──
        let nodeScale, edgeScale, fontSize, spacing;
        if (count <= 10) {
            nodeScale = 2.2;   edgeScale = 2.0;   fontSize = 14;  spacing = 80;
        } else if (count <= 30) {
            nodeScale = 1.8;   edgeScale = 1.6;   fontSize = 13;  spacing = 60;
        } else if (count <= 80) {
            nodeScale = 1.4;   edgeScale = 1.3;   fontSize = 12;  spacing = 45;
        } else if (count <= 200) {
            nodeScale = 1.0;   edgeScale = 1.0;   fontSize = 11;  spacing = 30;
        } else {
            nodeScale = 0.7;   edgeScale = 0.8;   fontSize = 10;  spacing = 20;
        }

        // ★ 使用 batch() 批量更新樣式（避免每次 style() 都觸發重繪）
        state.cy.startBatch();
        visible.forEach(n => {
            const baseSize = n.data('size') || 28;
            const newSize = Math.round(baseSize * nodeScale);
            n.style({ 'width': newSize, 'height': newSize, 'font-size': fontSize + 'px' });
        });
        visibleEdges.forEach(e => {
            const type = e.data('type');
            let baseWidth = 1.5;
            if (type === 'representative') baseWidth = 2.5;
            else if (type === 'shareholder') baseWidth = 2;
            else if (type === 'director') baseWidth = 1.8;
            else if (type === 'historical') baseWidth = 1;
            e.style({ 'width': Math.max(baseWidth * edgeScale, 0.8), 'arrow-scale': Math.max(0.6, 0.8 * edgeScale) });
        });

        // ★ 大圖：隱藏邊標籤以節省渲染資源
        if (count > 80) {
            visibleEdges.style('label', '');
        }
        state.cy.endBatch();

        // ── 重新排版 ──
        if (count > 200) {
            // 超大圖：只 fit，不重排（重排會卡死）
            state.cy.fit(visible, 40);
        } else if (count > 80) {
            // 大圖：concentric（不用動畫）
            state.cy.layout({
                name: 'concentric',
                animate: false,
                eles: visible.union(visibleEdges),
                concentric: function(node) {
                    if (node.data('is_seed')) return 100;
                    if (node.data('flag_count')) return 50 + node.data('flag_count');
                    return node.connectedEdges().filter(e => e.style('display') !== 'none').length;
                },
                levelWidth: function() { return 3; },
                minNodeSpacing: spacing,
                fit: true,
                padding: 40,
            }).run();
        } else {
            // 小圖：cola（有動畫，但降低迭代次數）
            state.cy.layout({
                name: 'cola',
                animate: count <= 30,  // 只有很小的圖才動畫
                animationDuration: 400,
                eles: visible.union(visibleEdges),
                nodeSpacing: spacing,
                edgeLength: spacing * 3,
                convergenceThreshold: 0.01,  // ★ 降低精度要求，更快收斂
                randomize: false,
                avoidOverlap: true,
                handleDisconnected: true,
                flow: { axis: 'y', minSeparation: Math.max(spacing, 40) },
                unconstrIter: 10,   // ★ 減少迭代次數
                userConstIter: 15,
                allConstIter: 15,
                fit: true,
                padding: 40,
            }).run();
        }
    }

    function filterByDepth(maxDepth) {
        if (!state.cy) return;
        maxDepth = parseInt(maxDepth);
        const label = document.getElementById('depth-filter-label');

        const depthMap = getDepthMap();
        const actualMax = Math.max(...[...depthMap.values()].filter(v => v < 999), 2);

        if (maxDepth >= actualMax || maxDepth >= 10) {
            // 全部展開：帶動畫恢復所有節點
            const hiddenNodes = state.cy.nodes().filter(n => n.style('display') === 'none');
            state.cy.batch(() => {
                state.cy.nodes().style('display', 'element');
                state.cy.edges().style('display', 'element');
                // 清除所有收合狀態
                state.cy.nodes().forEach(n => {
                    n.data('_collapsed', false);
                    n.data('_hiddenChildren', []);
                    if (!n.data('is_seed')) n.style('border-style', 'solid');
                });
            });
            // 新出現的節點做淡入動畫
            if (hiddenNodes.length > 0) {
                hiddenNodes.style('opacity', 0);
                hiddenNodes.animate({ style: { opacity: 1 } }, { duration: 400 });
            }
            const totalNodes = state.cy.nodes().length;
            if (label) label.textContent = `${totalNodes} 個節點`;
            // 重新排版讓圖形自然展開
            if (hiddenNodes.length > 5) {
                runLayout('cola');
            } else {
                state.cy.fit(state.cy.nodes(), 40);
            }
            filterSidebarByVisibleNodes();
            return;
        }

        // 計算此深度的可見/隱藏節點
        const toShow = [];
        const toHide = [];
        depthMap.forEach((d, nodeId) => {
            if (d <= maxDepth) toShow.push(nodeId);
            else toHide.push(nodeId);
        });
        if (label) label.textContent = `${toShow.length} 個節點`;

        // 找出需要新隱藏和新顯示的節點（做動畫用）
        const currentlyHidden = new Set();
        state.cy.nodes().forEach(n => {
            if (n.style('display') === 'none') currentlyHidden.add(n.id());
        });
        const newlyHidden = toHide.filter(id => !currentlyHidden.has(id));
        const newlyShown = toShow.filter(id => currentlyHidden.has(id));

        // 收合動畫：先淡出要隱藏的節點
        if (newlyHidden.length > 0) {
            const fadingNodes = state.cy.collection();
            newlyHidden.forEach(id => {
                const n = state.cy.getElementById(id);
                if (n.length) fadingNodes.merge(n);
            });
            fadingNodes.animate(
                { style: { opacity: 0 } },
                {
                    duration: 300,
                    complete: () => {
                        state.cy.batch(() => {
                            fadingNodes.style('display', 'none').style('opacity', 1);
                            // 隱藏相關邊
                            state.cy.edges().forEach(edge => {
                                const srcD = depthMap.get(edge.source().id()) || 999;
                                const tgtD = depthMap.get(edge.target().id()) || 999;
                                edge.style('display', (srcD <= maxDepth && tgtD <= maxDepth) ? 'element' : 'none');
                            });
                            // 標記邊界節點為收合狀態（dashed border）
                            toShow.forEach(id => {
                                const n = state.cy.getElementById(id);
                                const nd = depthMap.get(id) || 0;
                                if (nd === maxDepth) {
                                    const hasHiddenNeighbor = n.neighborhood('node').some(
                                        nb => (depthMap.get(nb.id()) || 999) > maxDepth
                                    );
                                    if (hasHiddenNeighbor) {
                                        n.style('border-style', 'dashed');
                                        n.data('_collapsed', true);
                                    }
                                }
                            });
                        });
                        // 重新排版
                        const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
                        if (visible.length > 0) {
                            runLayout('cola');
                        }
                        filterSidebarByVisibleNodes();
                    }
                }
            );
        }

        // 展開動畫：顯示新出現的節點
        if (newlyShown.length > 0 && newlyHidden.length === 0) {
            state.cy.batch(() => {
                newlyShown.forEach(id => {
                    const n = state.cy.getElementById(id);
                    if (n.length) {
                        n.style({ display: 'element', opacity: 0 });
                        // 清除收合標記
                        n.data('_collapsed', false);
                        if (!n.data('is_seed')) n.style('border-style', 'solid');
                    }
                });
                // 顯示相關邊
                state.cy.edges().forEach(edge => {
                    const srcD = depthMap.get(edge.source().id()) || 999;
                    const tgtD = depthMap.get(edge.target().id()) || 999;
                    edge.style('display', (srcD <= maxDepth && tgtD <= maxDepth) ? 'element' : 'none');
                });
                // 清除之前邊界節點的 dashed 標記
                state.cy.nodes().filter(n => n.style('display') !== 'none').forEach(n => {
                    if (!n.data('is_seed') && n.data('_collapsed')) {
                        n.data('_collapsed', false);
                        n.style('border-style', 'solid');
                    }
                });
            });
            // 淡入新節點
            const fadingIn = state.cy.collection();
            newlyShown.forEach(id => {
                const n = state.cy.getElementById(id);
                if (n.length) fadingIn.merge(n);
            });
            fadingIn.animate({ style: { opacity: 1 } }, { duration: 400 });
            runLayout('cola');
            filterSidebarByVisibleNodes();
        }

        // 沒有變化的情況（深度選回同樣值）
        if (newlyHidden.length === 0 && newlyShown.length === 0) {
            filterSidebarByVisibleNodes();
        }

        Toast.show(`顯示第 ${maxDepth} 層：${toShow.length} 個節點`, 'info');
    }
    window.filterByDepth = filterByDepth;

    function resetDepthFilter() {
        const select = document.getElementById('depth-filter-select');
        const label = document.getElementById('depth-filter-label');
        if (select) select.value = '99';
        invalidateDepthCache();
        if (state.cy) {
            state.cy.batch(() => {
                state.cy.nodes().style('display', 'element');
                state.cy.edges().style('display', 'element');
            });
            const totalNodes = state.cy.nodes().length;
            if (label) label.textContent = `${totalNodes} 個節點`;
            state.cy.fit(state.cy.nodes(), 40);
        } else {
            if (label) label.textContent = '全部';
        }
        Toast.show('已重設為顯示全部層', 'info');
        // 恢復側邊欄到全量顯示
        filterSidebarByVisibleNodes();
    }
    window.resetDepthFilter = resetDepthFilter;

    // ==================== 深度連動：側邊欄同步過濾 ====================
    function filterSidebarByVisibleNodes() {
        if (!state.cy) return;

        // 收集當前可見節點的 entity_id 和 label
        const visibleIds = new Set();
        const visibleLabels = new Set();
        state.cy.nodes().forEach(n => {
            if (n.style('display') !== 'none') {
                const d = n.data();
                if (d.entity_id) visibleIds.add(d.entity_id);
                if (d.id) visibleIds.add(d.id);
                if (d.label) visibleLabels.add(d.label);
            }
        });

        const allVisible = visibleIds.size === 0 || visibleIds.size === state.cy.nodes().length;

        // --- 過濾集群 ---
        const clusters = state._clustersData || [];
        const clListEl = document.getElementById('clusters-list');
        const clCountEl = document.getElementById('cluster-count');
        if (clListEl && clusters.length > 0) {
            const filtered = allVisible ? clusters : clusters.filter(c => {
                const members = c.member_tax_ids || [];
                return members.some(tid => visibleIds.has(tid));
            });
            if (clCountEl) clCountEl.textContent = filtered.length;
            if (filtered.length === 0) {
                clListEl.innerHTML = '<div class="ws-list-empty">此層級無相關集群</div>';
            } else {
                renderFilteredClusters(clListEl, filtered);
            }
        }

        // --- 過濾紅旗 ---
        const flags = state._redFlagsData || [];
        const flListEl = document.getElementById('red-flags-list');
        const flCountEl = document.getElementById('flag-count');
        if (flListEl && flags.length > 0) {
            const filtered = allVisible ? flags : flags.filter(f => {
                return visibleIds.has(f.target_id) || visibleLabels.has(f.target_id);
            });
            if (flCountEl) flCountEl.textContent = filtered.length;
            if (filtered.length === 0) {
                flListEl.innerHTML = '<div class="ws-list-empty">此層級無紅旗</div>';
            } else {
                renderFilteredRedFlags(flListEl, filtered);
            }
        }

        // --- 過濾負面新聞 ---
        const media = state._mediaData || [];
        const mdListEl = document.getElementById('media-list');
        const mdCountEl = document.getElementById('media-count');
        if (mdListEl && media.length > 0) {
            const filtered = allVisible ? media : media.filter(m => {
                return visibleIds.has(m.target_id) || visibleLabels.has(m.query_used);
            });
            if (mdCountEl) mdCountEl.textContent = filtered.length;
            if (filtered.length === 0) {
                mdListEl.innerHTML = '<div class="ws-list-empty">此層級無負面新聞</div>';
            } else {
                renderSidebarList(mdListEl, filtered, m => m.source_title || m.title || '未知', m => {
                    try { return m.source_url ? new URL(m.source_url).hostname : (m.source || ''); }
                    catch { return m.source || ''; }
                });
            }
        }

        // --- 過濾縣市分群 ---
        const cityGroups = state._cityGroups || {};
        const cgListEl = document.getElementById('city-groups-list');
        const cgCountEl = document.getElementById('city-group-count');
        if (cgListEl && Object.keys(cityGroups).length > 0) {
            const filteredCityMap = {};
            const cityColors = ['#C0392B','#2980B9','#27AE60','#E67E22','#8E44AD','#16A085','#D35400','#2C3E50','#F39C12','#7F8C8D','#1ABC9C','#E74C3C','#3498DB','#9B59B6'];
            Object.keys(cityGroups).forEach(city => {
                const filtered = allVisible ? cityGroups[city] : cityGroups[city].filter(c => visibleIds.has(c.id) || visibleIds.has(c.entity_id));
                if (filtered.length > 0) filteredCityMap[city] = filtered;
            });
            const filteredCities = Object.keys(filteredCityMap).sort((a, b) => filteredCityMap[b].length - filteredCityMap[a].length);
            if (cgCountEl) cgCountEl.textContent = filteredCities.length;
            if (filteredCities.length === 0) {
                cgListEl.innerHTML = '<div class="ws-list-empty">此層級無縣市分群</div>';
            } else {
                cgListEl.innerHTML = renderCityAccordion(filteredCities, filteredCityMap, cityColors);
            }
        }

        // ── 連動儀表板：如果儀表板正在顯示，也重新過濾 ──
        refreshDashboardIfOpen();
    }

    /** 如果分析儀表板正在顯示，重新 render 以反映可見節點的變化 */
    function refreshDashboardIfOpen() {
        const overlay = document.getElementById('analysis-dashboard-overlay');
        if (overlay && overlay.style.display !== 'none' && _dashboardData) {
            renderAnalysisDashboard(_dashboardData);
        }
    }

    function renderFilteredClusters(listEl, clusters) {
        const algorithmLabels = {
            'address_cluster': { icon: '📍', label: '地址聚集' },
            'star_structure': { icon: '⭐', label: '星形控制' },
            'city_cluster': { icon: '🏙️', label: '地理群' },
            'shared_shareholder': { icon: '🔗', label: '共同股東' },
            'union_find': { icon: '🔗', label: '關聯群' },
        };
        listEl.innerHTML = renderClusterAccordion(clusters, algorithmLabels);
    }

    function renderFilteredRedFlags(listEl, flags) {
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
        const severityColors = { 'CRITICAL': 'var(--risk-high)', 'WARNING': 'var(--risk-medium)', 'INFO': 'var(--risk-low)' };
        const severityLabels = { 'CRITICAL': '嚴重', 'WARNING': '警告', 'INFO': '資訊' };

        listEl.innerHTML = flags.map(f => {
            const ruleName = ruleNames[f.rule_id] || f.rule_id;
            const desc = (f.detail && f.detail.description) || '';
            const color = severityColors[f.severity] || '#999';
            const sevLabel = severityLabels[f.severity] || f.severity;
            const targetId = esc(f.target_id || '');
            const targetType = esc(f.target_type || '');
            return `
                <div class="ws-list-item" style="border-left: 3px solid ${color}; cursor:pointer;" onclick="highlightRedFlagTarget('${targetId}', '${targetType}', ${JSON.stringify(f.detail?.evidence || null).replace(/"/g, '&quot;')})">
                    <div class="ws-list-item-title">
                        <span style="color:${color}; font-weight:600;">[${sevLabel}]</span>
                        ${esc(ruleName)}
                    </div>
                    <div class="ws-list-item-sub">${esc(desc)}</div>
                </div>`;
        }).join('');
    }

    // 高亮集群內的節點（點擊集群列表時觸發）
    // 遮罩非成員，凸顯成員
    function highlightCluster(memberTaxIds, clusterLabel) {
        if (!state.cy || !memberTaxIds || memberTaxIds.length === 0) return;

        // 先清除之前的遮罩
        state.cy.nodes().removeClass('marked cluster-dimmed');
        state.cy.edges().removeClass('cluster-dimmed');

        const memberSet = new Set(memberTaxIds);
        let matched = 0;
        state.cy.batch(() => {
            state.cy.nodes().forEach(node => {
                const entityId = node.data('entity_id') || node.data('id');
                if (memberSet.has(entityId)) {
                    node.addClass('marked');
                    matched++;
                } else {
                    node.addClass('cluster-dimmed');
                }
            });
            // 邊：兩端都是成員才保持亮色
            state.cy.edges().forEach(edge => {
                const srcId = edge.source().data('entity_id') || edge.source().data('id');
                const tgtId = edge.target().data('entity_id') || edge.target().data('id');
                if (!memberSet.has(srcId) || !memberSet.has(tgtId)) {
                    edge.addClass('cluster-dimmed');
                }
            });
        });

        // 自動聚焦到這些節點
        const markedNodes = state.cy.nodes('.marked');
        if (markedNodes.length > 0) {
            state.cy.animate({
                fit: { eles: markedNodes, padding: 60 },
                duration: 500,
            });
        }
        Toast.show(`${clusterLabel || '集群'}：${matched} 個成員已凸顯`, 'info');

        // 同時在報表側邊欄顯示成員清單
        showClusterMemberPanel(memberTaxIds, clusterLabel || '集群成員');
    }
    window.highlightCluster = highlightCluster;

    // 清除集群遮罩
    function clearClusterHighlight() {
        if (!state.cy) return;
        state.cy.batch(() => {
            state.cy.nodes().removeClass('marked cluster-dimmed');
            state.cy.edges().removeClass('cluster-dimmed');
        });
        // 隱藏成員面板
        const panel = document.getElementById('cluster-member-panel');
        if (panel) panel.style.display = 'none';
    }
    window.clearClusterHighlight = clearClusterHighlight;

    // 顯示集群成員清單面板
    function showClusterMemberPanel(memberTaxIds, title) {
        if (!state.cy) return;
        const memberSet = new Set(memberTaxIds);
        const members = [];
        state.cy.nodes().forEach(node => {
            const entityId = node.data('entity_id') || node.data('id');
            if (memberSet.has(entityId)) {
                members.push({
                    id: node.data('id'),
                    label: node.data('label') || entityId,
                    type: node.data('type'),
                    entity_id: entityId,
                    address: node.data('address') || '',
                    risk_level: node.data('risk_level') || 'NONE'
                });
            }
        });

        // 找到或建立面板
        let panel = document.getElementById('cluster-member-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'cluster-member-panel';
            panel.className = 'cluster-member-panel';
            const cyContainer = document.getElementById('cy');
            if (cyContainer && cyContainer.parentElement) {
                cyContainer.parentElement.appendChild(panel);
            } else {
                document.body.appendChild(panel);
            }
        }
        panel.style.display = 'block';

        const riskColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#3498DB', NONE: '#95A5A6' };
        const riskLabels = { CRITICAL: '高風險', WARNING: '中風險', INFO: '資訊', NONE: '正常' };

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #e0e0e0; background:#f5f7fa;">
                <span style="font-size:13px; font-weight:600;">${esc(title)}（${members.length}）</span>
                <button onclick="clearClusterHighlight()" style="background:none; border:none; cursor:pointer; font-size:16px; color:#999;" title="關閉">&times;</button>
            </div>
            <div style="overflow-y:auto; max-height:300px;">
                ${members.map((m, i) => `
                    <div style="padding:8px 14px; border-bottom:1px solid #f0f0f0; background:${i % 2 === 0 ? '#fff' : '#fafbfc'}; cursor:pointer; font-size:13px;" onclick="reportClickNode('${esc(m.id)}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:500;">${esc(m.label)}</span>
                            <span style="padding:1px 6px; border-radius:8px; font-size:10px; color:#fff; background:${riskColors[m.risk_level] || '#95A5A6'};">${riskLabels[m.risk_level] || '正常'}</span>
                        </div>
                        ${m.address ? `<div style="font-size:11px; color:#888; margin-top:2px;">${esc(m.address)}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }
    window.showClusterMemberPanel = showClusterMemberPanel;

    /** 點擊紅旗 → 高亮主體 + 相關公司（UBO 等） */
    function highlightRedFlagTarget(targetId, targetType, evidence) {
        if (!state.cy || !targetId) return;

        // 清除之前高亮
        state.cy.nodes().removeClass('marked');

        // 收集所有相關 ID
        const highlightIds = new Set();
        highlightIds.add(targetId);

        // person:xxx 格式
        const personName = targetId.startsWith('person:') ? targetId.slice(7) : null;
        if (personName) highlightIds.add(personName);

        // 從 evidence 中提取相關公司
        if (evidence) {
            if (evidence.all_controlled) {
                evidence.all_controlled.forEach(c => {
                    if (c.tax_id) highlightIds.add(c.tax_id);
                    if (c.name) highlightIds.add(c.name);
                });
            }
            if (evidence.direct_companies) {
                evidence.direct_companies.forEach(tid => highlightIds.add(tid));
            }
            if (evidence.rep_companies) {
                evidence.rep_companies.forEach(tid => highlightIds.add(tid));
            }
            if (evidence.direct_companies_list) {
                evidence.direct_companies_list.forEach(tid => highlightIds.add(tid));
            }
            // ADDRESS_CLUSTER, STAR_STRUCTURE 等：member_tax_ids
            if (evidence.member_tax_ids) {
                evidence.member_tax_ids.forEach(tid => highlightIds.add(tid));
            }
            if (evidence.tax_ids) {
                evidence.tax_ids.forEach(tid => highlightIds.add(tid));
            }
        }

        // 在圖上找到並高亮
        let matched = state.cy.collection();
        state.cy.nodes().forEach(node => {
            const d = node.data();
            const eid = d.entity_id || d.id;
            const label = d.label || '';
            if (highlightIds.has(eid) || highlightIds.has(label)) {
                node.addClass('marked');
                node.style('display', 'element');
                node.style('opacity', 1);
                matched = matched.union(node);
            }
        });

        // 讓連接高亮節點的邊也可見
        if (matched.length > 1) {
            matched.edgesWith(matched).style('display', 'element');
            matched.edgesWith(matched).style('opacity', 1);
        }

        if (matched.length > 0) {
            state.cy.animate({
                fit: { eles: matched, padding: 60 },
                duration: 500,
            });

            const names = matched.map(n => n.data('label') || n.data('entity_id')).slice(0, 6);
            Toast.show(`已標記 ${matched.length} 個相關節點：${names.join('、')}${matched.length > 6 ? '…' : ''}`, 'info', 3000);

            // 顯示右側詳情
            if (personName) {
                const pNode = matched.filter(n => n.data('label') === personName);
                if (pNode.length > 0) showNodeDetail(pNode[0].data());
            } else if (matched.length === 1) {
                showNodeDetail(matched[0].data());
            }
        } else {
            Toast.warning(`「${targetId}」不在目前的圖上`);
        }
    }
    window.highlightRedFlagTarget = highlightRedFlagTarget;

    // ==================== 分群上色模式 ====================
    // 12 色盤（區分度高、色盲友善）
    const CLUSTER_PALETTE = [
        '#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4',
        '#42D4F4', '#F032E6', '#BFEF45', '#FABED4', '#469990',
        '#DCBEFF', '#9A6324',
    ];

    function extractCity(address) {
        if (!address) return '未知';
        // 台灣地址格式：XX市 or XX縣
        const m = address.match(/^([\u4e00-\u9fff]{2,3}[市縣])/);
        return m ? m[1].replace('臺', '台') : '其他';
    }

    function extractShortAddress(address) {
        if (!address) return '未知';
        // 取到「路/街/段」為止
        const m = address.match(/^([\u4e00-\u9fff\d]+[路街段])/);
        return m ? m[1] : address.substring(0, 12);
    }

    function applyClusterColorMode(mode) {
        if (!state.cy) return;

        if (mode === 'none') {
            // 恢復預設配色 — 清除 cluster overlay
            state.cy.nodes().forEach(n => {
                n.removeStyle('background-color');
                n.removeStyle('border-color');
            });
            // 隱藏 cluster legend
            const cLeg = document.getElementById('cluster-legend');
            if (cLeg) cLeg.style.display = 'none';
            // 恢復原本排版
            autoResizeAndRelayout();
            Toast.show('已恢復預設配色與排版', 'info', 1500);
            return;
        }

        // 根據 mode 分組（只處理可見節點）
        const groups = {};
        const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
        visible.forEach(n => {
            const d = n.data();
            let key;
            if (mode === 'city') {
                key = extractCity(d.address);
            } else if (mode === 'address') {
                key = extractShortAddress(d.address);
            } else if (mode === 'cluster') {
                key = state._nodeClusterMap ? (state._nodeClusterMap[d.entity_id || d.id] || '未分群') : '未分群';
            }
            if (!groups[key]) groups[key] = [];
            groups[key].push(n);
        });

        // 排序 group by size desc，分配顏色
        const sortedKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
        const colorMap = {};
        sortedKeys.forEach((k, i) => {
            colorMap[k] = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length];
        });

        // 套用顏色
        sortedKeys.forEach(k => {
            const color = colorMap[k];
            groups[k].forEach(n => {
                n.style('background-color', color);
                n.style('border-color', color);
            });
        });

        // 更新 cluster legend
        renderClusterLegend(sortedKeys, colorMap, groups);

        // ── 空間分群排版：將同組節點聚在一起 ──
        applyGroupedLayout(sortedKeys, groups);

        const modeLabels = { city: '縣市', address: '地址', cluster: '集群' };
        Toast.show(`已按${modeLabels[mode] || mode}分群排列，共 ${sortedKeys.length} 組`, 'info', 2000);
    }

    // ── 分群空間排版：各組節點聚攏成一區 ──
    function applyGroupedLayout(sortedKeys, groups) {
        if (!state.cy) return;

        const container = state.cy.container();
        const W = container.clientWidth || 1200;
        const H = container.clientHeight || 800;
        const groupCount = sortedKeys.length;

        if (groupCount === 0) return;

        // 計算群組中心點：排成網格
        const cols = Math.ceil(Math.sqrt(groupCount));
        const rows = Math.ceil(groupCount / cols);
        const cellW = W / cols;
        const cellH = H / rows;
        const padding = 40;

        // 先 batch 所有位置再一次套用（避免觸發多次 render）
        state.cy.startBatch();

        sortedKeys.forEach((key, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const cx = padding + col * cellW + cellW / 2;
            const cy_pos = padding + row * cellH + cellH / 2;
            const members = groups[key];
            const n = members.length;

            if (n === 1) {
                members[0].position({ x: cx, y: cy_pos });
            } else {
                // 同組節點繞中心排成圓形/小集群
                const radius = Math.min(cellW, cellH) * 0.35 * Math.min(1, Math.sqrt(n) / 5);
                members.forEach((node, i) => {
                    const angle = (2 * Math.PI * i) / n;
                    node.position({
                        x: cx + radius * Math.cos(angle),
                        y: cy_pos + radius * Math.sin(angle),
                    });
                });
            }
        });

        state.cy.endBatch();

        // fit 到可見範圍
        setTimeout(() => {
            const visible = state.cy.nodes().filter(n => n.style('display') !== 'none');
            if (visible.length > 0) state.cy.fit(visible, 30);
        }, 100);
    }
    window.applyClusterColorMode = applyClusterColorMode;

    function renderClusterLegend(keys, colorMap, groups) {
        let cLeg = document.getElementById('cluster-legend');
        if (!cLeg) {
            // 在 graph-legend 旁邊建立
            const parent = document.querySelector('.ws-canvas-area > div:last-child');
            if (!parent) return;
            cLeg = document.createElement('div');
            cLeg.id = 'cluster-legend';
            cLeg.className = 'graph-legend cluster-legend';
            parent.appendChild(cLeg);
        }
        cLeg.style.display = '';
        const maxShow = 10;
        const items = keys.slice(0, maxShow).map(k => `
            <div class="graph-legend-item" style="cursor:pointer;" onclick="highlightClusterByColor('${k.replace(/'/g, "\\'")}')">
                <div class="graph-legend-dot" style="background:${colorMap[k]};"></div>
                <span style="font-size:10px;">${k} (${groups[k].length})</span>
            </div>
        `).join('');
        const more = keys.length > maxShow ? `<div style="font-size:9px; color:#999;">…及其他 ${keys.length - maxShow} 組</div>` : '';
        cLeg.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:11px; font-weight:600; color:#666;">分群圖例</span>
                <button onclick="document.getElementById('cluster-legend').style.display='none'" style="background:none; border:none; cursor:pointer; color:#999; font-size:14px; padding:2px 4px;" title="關閉">×</button>
            </div>
            ${items}${more}
        `;
    }

    function highlightClusterByColor(key) {
        if (!state.cy) return;
        // 找到這組節點並聚焦
        const mode = document.getElementById('cluster-color-mode')?.value || 'city';
        const matched = state.cy.nodes().filter(n => {
            const d = n.data();
            if (mode === 'city') return extractCity(d.address) === key;
            if (mode === 'address') return extractShortAddress(d.address) === key;
            if (mode === 'cluster') return (state._nodeClusterMap?.[d.entity_id || d.id] || '未分群') === key;
            return false;
        });
        if (matched.length > 0) {
            state.cy.animate({ fit: { eles: matched, padding: 60 }, duration: 500 });
            Toast.show(`聚焦 "${key}" — ${matched.length} 個節點`, 'info', 1500);
        }
    }
    window.highlightClusterByColor = highlightClusterByColor;

    // ==================== 節點類型篩選 ====================
    function toggleFilterPanel() {
        const panel = document.getElementById('graph-filter-panel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }
    window.toggleFilterPanel = toggleFilterPanel;

    function applyNodeTypeFilter() {
        if (!state.cy) return;

        const showCompany = document.getElementById('filter-company')?.checked ?? true;
        const showPerson = document.getElementById('filter-person')?.checked ?? true;
        const showCritical = document.getElementById('filter-risk-critical')?.checked ?? true;
        const showWarning = document.getElementById('filter-risk-warning')?.checked ?? true;
        const showPersonCritical = document.getElementById('filter-person-critical')?.checked ?? true;

        state.cy.startBatch();

        state.cy.nodes().forEach(node => {
            const d = node.data();
            const type = d.type;           // 'company' | 'person'
            const risk = d.risk_level;     // 'CRITICAL' | 'WARNING' | undefined

            // 判斷是否為高風險人物
            const isPersonCritical = type === 'person' && risk === 'CRITICAL';
            const isCritical = risk === 'CRITICAL' && !isPersonCritical;
            const isWarning = risk === 'WARNING';

            let shouldShow = true;
            if (isPersonCritical && !showPersonCritical) shouldShow = false;
            else if (isCritical && !showCritical) shouldShow = false;
            else if (isWarning && !showWarning) shouldShow = false;
            else if (type === 'company' && !risk && !showCompany) shouldShow = false;
            else if (type === 'person' && !risk && !showPerson) shouldShow = false;

            // 關鍵節點（seed 或橋接節點）不完全隱藏，改用半透明
            const isCriticalNode = d.is_seed || d.is_bridge || (node.connectedEdges().length >= 5);

            if (!shouldShow && isCriticalNode) {
                // 關鍵節點：半透明但保留，讓使用者知道「系統有遮掉」
                node.style('display', 'element');
                node.style('opacity', 0.15);
                node.style('text-opacity', 0.2);
            } else if (!shouldShow) {
                node.style('display', 'none');
                node.style('opacity', 1);
                node.style('text-opacity', 1);
            } else {
                node.style('display', 'element');
                node.style('opacity', 1);
                node.style('text-opacity', 1);
            }
        });

        // 邊：兩端都可見（含半透明）才顯示
        state.cy.edges().forEach(edge => {
            const srcVisible = edge.source().style('display') !== 'none';
            const tgtVisible = edge.target().style('display') !== 'none';
            if (srcVisible && tgtVisible) {
                // 如果任一端是半透明，邊也半透明
                const srcDim = parseFloat(edge.source().style('opacity')) < 0.5;
                const tgtDim = parseFloat(edge.target().style('opacity')) < 0.5;
                edge.style('display', 'element');
                edge.style('opacity', (srcDim || tgtDim) ? 0.1 : 1);
            } else {
                edge.style('display', 'none');
            }
        });

        state.cy.endBatch();

        // 重新排版
        autoResizeAndRelayout();
        // 連動側邊欄
        filterSidebarByVisibleNodes();
    }
    window.applyNodeTypeFilter = applyNodeTypeFilter;

    function resetNodeTypeFilter() {
        ['filter-company', 'filter-person', 'filter-risk-critical', 'filter-risk-warning', 'filter-person-critical'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = true;
        });
        applyNodeTypeFilter();
        Toast.show('已恢復顯示全部節點', 'info', 1500);
    }
    window.resetNodeTypeFilter = resetNodeTypeFilter;

    // ==================== 查詢主體聚焦 ====================
    // 升級 focusSeedNode：聚焦到中心 + 放大到適合閱讀的大小
    function focusSeedNodeEnhanced(seedValue) {
        if (!state.cy) return;
        const node = state.cy.nodes().filter(n => {
            const d = n.data();
            return d.entity_id === seedValue || d.label === seedValue || d.id === seedValue;
        });
        if (node.length === 0) return;

        const target = node[0];
        // 顯示該節點所有鄰居（確保可見）
        target.neighborhood('node').style('display', 'element');
        target.neighborhood('node').style('opacity', 1);
        target.connectedEdges().style('display', 'element');
        target.connectedEdges().style('opacity', 1);

        // 聚焦到 seed 和其鄰居
        const eles = target.union(target.neighborhood());
        state.cy.animate({
            fit: { eles: eles, padding: 60 },
            duration: 500,
        });

        // 選中並顯示詳情
        target.select();
        showNodeDetail(target.data());
        Toast.show(`已聚焦到「${target.data('label') || seedValue}」`, 'info', 1500);
    }
    window.focusSeedNodeEnhanced = focusSeedNodeEnhanced;

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

    // ==================== 使用指南 (Onboarding) ====================
    const ONBOARDING_PAGES = [
        {
            icon: 'fa-shield-alt',
            title: '歡迎使用 BEDROCK 磐石',
            content: `
                <p style="color:#555; line-height:1.8; margin-bottom:16px;">
                    BEDROCK 是一套<b>企業盡職調查 (Enhanced Due Diligence)</b> 平台，
                    幫助您快速追蹤企業關聯網路、偵測洗錢風險與識別實質受益人。
                </p>
                <div style="background:#f0f7ff; border-radius:8px; padding:14px 16px; margin-bottom:12px;">
                    <div style="font-weight:600; color:#3A7CA5; margin-bottom:6px;">本指南將帶您了解：</div>
                    <div style="color:#555; font-size:13px; line-height:1.8;">
                        1. 如何建立調查案件<br>
                        2. 如何搜尋企業關聯網路<br>
                        3. 如何執行風險分析<br>
                        4. 如何閱讀結果與匯出報告<br>
                        5. 圖形介面的操作方式
                    </div>
                </div>
            `,
        },
        {
            icon: 'fa-plus-circle',
            title: '步驟一：建立調查案件',
            content: `
                <div style="display:flex; gap:12px; margin-bottom:16px;">
                    <div style="min-width:36px; height:36px; background:#3A7CA5; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;">1</div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">在儀表板點擊「新增調查」</div>
                        <div style="color:#666; font-size:13px;">輸入案件名稱和查詢目標（統一編號、公司名稱或自然人姓名）。</div>
                    </div>
                </div>
                <div style="display:flex; gap:12px; margin-bottom:16px;">
                    <div style="min-width:36px; height:36px; background:#3A7CA5; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;">2</div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">進入工作台</div>
                        <div style="color:#666; font-size:13px;">建立後自動進入調查工作台，左側面板可繼續新增更多查詢目標。</div>
                    </div>
                </div>
                <div style="background:#fef9e7; border-left:4px solid #F1C40F; padding:10px 14px; border-radius:4px; font-size:12px; color:#7D6608;">
                    <b>提示：</b>可同時輸入多個統一編號或公司名，系統會自動展開關聯網路。
                </div>
            `,
        },
        {
            icon: 'fa-search',
            title: '步驟二：搜尋企業網路',
            content: `
                <div style="display:flex; gap:12px; margin-bottom:16px;">
                    <div style="min-width:36px; height:36px; background:#27AE60; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;"><i class="fas fa-play" style="font-size:14px;"></i></div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">點擊「開始」按鈕</div>
                        <div style="color:#666; font-size:13px;">系統會自動從查詢目標出發，追蹤董監事、法人代表和股東關係。</div>
                    </div>
                </div>
                <div style="display:flex; gap:16px; margin-bottom:16px;">
                    <div style="flex:1; background:#f5f7fa; border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:20px; margin-bottom:4px;"><i class="fas fa-layer-group" style="color:#3A7CA5;"></i></div>
                        <div style="font-size:11px; color:#555;"><b>搜尋深度</b><br>預設自動找到所有 UBO</div>
                    </div>
                    <div style="flex:1; background:#f5f7fa; border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:20px; margin-bottom:4px;"><i class="fas fa-history" style="color:#E67E22;"></i></div>
                        <div style="font-size:11px; color:#555;"><b>歷史關聯</b><br>可切換顯示/隱藏離任人員</div>
                    </div>
                    <div style="flex:1; background:#f5f7fa; border-radius:8px; padding:12px; text-align:center;">
                        <div style="font-size:20px; margin-bottom:4px;"><i class="fas fa-eye" style="color:#9B59B6;"></i></div>
                        <div style="font-size:11px; color:#555;"><b>檢視深度</b><br>用滑桿控制顯示到第幾層</div>
                    </div>
                </div>
            `,
        },
        {
            icon: 'fa-microscope',
            title: '步驟三：風險分析',
            content: `
                <p style="color:#555; line-height:1.8; margin-bottom:14px;">
                    搜尋完成後，點擊左側面板的<b>「分析」</b>按鈕，系統將自動偵測 15+ 種可疑模式：
                </p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px;">
                    <div style="background:#fdeaea; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#C0392B; font-weight:600;">循環持股</span> — A→B→C→A</div>
                    <div style="background:#fdeaea; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#C0392B; font-weight:600;">殼公司</span> — 資本極低無營運</div>
                    <div style="background:#fef4ea; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#E67E22; font-weight:600;">星形結構</span> — 一人控多家公司</div>
                    <div style="background:#fef4ea; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#E67E22; font-weight:600;">地址聚集</span> — 同地址大量公司</div>
                    <div style="background:#eaf7f0; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#27AE60; font-weight:600;">UBO 路徑</span> — 多層持股控制鏈</div>
                    <div style="background:#eaf7f0; border-radius:6px; padding:8px 10px; font-size:11px;"><span style="color:#27AE60; font-weight:600;">休眠復甦</span> — 長期無變更後恢復</div>
                </div>
                <div style="background:#f0f7ff; padding:10px 14px; border-radius:6px; font-size:12px; color:#2C3E50;">
                    分析完成後，紅旗會顯示在左側面板，也可以打開<b>「儀表板」</b>查看彙總。
                </div>
            `,
        },
        {
            icon: 'fa-chart-bar',
            title: '步驟四：閱讀結果與匯出',
            content: `
                <div style="display:flex; gap:12px; margin-bottom:14px;">
                    <div style="min-width:36px; height:36px; background:#E67E22; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center;"><i class="fas fa-chart-bar" style="font-size:14px;"></i></div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">儀表板</div>
                        <div style="color:#666; font-size:13px;">點擊「儀表板」按鈕，檢視風險摘要、關鍵實體和分類紅旗。</div>
                    </div>
                </div>
                <div style="display:flex; gap:12px; margin-bottom:14px;">
                    <div style="min-width:36px; height:36px; background:#9B59B6; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center;"><i class="fas fa-table" style="font-size:14px;"></i></div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">報表檢視</div>
                        <div style="color:#666; font-size:13px;">工具列的「報表」按鈕可切換為表格模式，方便閱讀和複製。</div>
                    </div>
                </div>
                <div style="display:flex; gap:12px; margin-bottom:14px;">
                    <div style="min-width:36px; height:36px; background:#3A7CA5; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center;"><i class="fas fa-file-export" style="font-size:14px;"></i></div>
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">匯出報告</div>
                        <div style="color:#666; font-size:13px;">右上角的匯出按鈕可產出完整的調查報告。</div>
                    </div>
                </div>
            `,
        },
        {
            icon: 'fa-mouse-pointer',
            title: '圖形介面操作指南',
            content: `
                <div style="font-size:13px; color:#555; line-height:2;">
                    <table style="width:100%; border-collapse:collapse;">
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600; white-space:nowrap; width:40%;"><i class="fas fa-search-plus" style="color:#3A7CA5; width:20px;"></i> 放大/縮小</td>
                            <td style="padding:6px 8px; color:#666;">滑鼠滾輪或工具列按鈕</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-hand-paper" style="color:#3A7CA5; width:20px;"></i> 平移畫布</td>
                            <td style="padding:6px 8px; color:#666;">按住滑鼠左鍵拖動空白處</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-mouse-pointer" style="color:#3A7CA5; width:20px;"></i> 查看節點</td>
                            <td style="padding:6px 8px; color:#666;">點擊節點 → 右側顯示詳情面板</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-arrows-alt" style="color:#3A7CA5; width:20px;"></i> 移動節點</td>
                            <td style="padding:6px 8px; color:#666;">按住節點拖動可手動調整位置</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-project-diagram" style="color:#3A7CA5; width:20px;"></i> 重新排版</td>
                            <td style="padding:6px 8px; color:#666;">工具列的排版按鈕（力導向/網格）</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-filter" style="color:#3A7CA5; width:20px;"></i> 篩選節點</td>
                            <td style="padding:6px 8px; color:#666;">「篩選」按鈕可隱藏特定類型節點</td>
                        </tr>
                        <tr>
                            <td style="padding:6px 8px; font-weight:600;"><i class="fas fa-palette" style="color:#3A7CA5; width:20px;"></i> 分群上色</td>
                            <td style="padding:6px 8px; color:#666;">下拉選單可按縣市/地址/集群上色</td>
                        </tr>
                    </table>
                </div>
            `,
        },
    ];

    let _onboardingPage = 0;

    function showOnboarding() {
        _onboardingPage = 0;
        const overlay = document.getElementById('onboarding-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            renderOnboardingPage();
        }
    }
    window.showOnboarding = showOnboarding;

    function closeOnboarding() {
        const overlay = document.getElementById('onboarding-overlay');
        if (overlay) overlay.style.display = 'none';
        // 記住已看過
        try { localStorage.setItem('bedrock_onboarding_seen', '1'); } catch(e) {}
    }
    window.closeOnboarding = closeOnboarding;

    function renderOnboardingPage() {
        const page = ONBOARDING_PAGES[_onboardingPage];
        if (!page) return;

        const body = document.getElementById('onboarding-body');
        const dots = document.getElementById('onboarding-dots');
        const prevBtn = document.getElementById('onboarding-prev');
        const nextBtn = document.getElementById('onboarding-next');
        const header = document.getElementById('onboarding-header');

        if (body) {
            body.innerHTML = `
                <div style="text-align:center; margin-bottom:16px;">
                    <i class="fas ${page.icon}" style="font-size:32px; color:#3A7CA5;"></i>
                    <h3 style="margin:10px 0 4px; font-size:18px; color:#2C3E50;">${page.title}</h3>
                </div>
                ${page.content}
            `;
        }

        // Dots
        if (dots) {
            dots.innerHTML = ONBOARDING_PAGES.map((_, i) =>
                `<div style="width:8px; height:8px; border-radius:50%; background:${i === _onboardingPage ? '#3A7CA5' : '#ddd'}; transition:background 0.2s;"></div>`
            ).join('');
        }

        // Buttons
        if (prevBtn) prevBtn.style.display = _onboardingPage === 0 ? 'none' : 'inline-block';
        if (nextBtn) {
            if (_onboardingPage === ONBOARDING_PAGES.length - 1) {
                nextBtn.textContent = '開始使用';
                nextBtn.style.background = '#27AE60';
            } else {
                nextBtn.textContent = '下一步';
                nextBtn.style.background = '#3A7CA5';
            }
        }
    }

    function onboardingNext() {
        if (_onboardingPage < ONBOARDING_PAGES.length - 1) {
            _onboardingPage++;
            renderOnboardingPage();
        } else {
            closeOnboarding();
        }
    }
    window.onboardingNext = onboardingNext;

    function onboardingPrev() {
        if (_onboardingPage > 0) {
            _onboardingPage--;
            renderOnboardingPage();
        }
    }
    window.onboardingPrev = onboardingPrev;

    // 首次登入時自動顯示
    function checkShowOnboarding() {
        try {
            if (!localStorage.getItem('bedrock_onboarding_seen')) {
                setTimeout(showOnboarding, 600);
            }
        } catch(e) {
            // localStorage 不可用時不顯示
        }
    }

    // ==================== 報表檢視 ====================
    let _reportViewActive = false;

    function toggleReportView() {
        _reportViewActive = !_reportViewActive;
        const cy = document.getElementById('cy');
        const reportView = document.getElementById('report-view');
        const btn = document.getElementById('btn-toggle-report-view');
        if (!cy || !reportView) return;

        if (_reportViewActive) {
            cy.style.display = 'none';
            reportView.style.display = 'block';
            if (btn) { btn.classList.add('active'); btn.innerHTML = '<i class="fas fa-project-diagram" aria-hidden="true"></i><span>圖形</span>'; }
            buildReportView();
        } else {
            cy.style.display = 'block';
            reportView.style.display = 'none';
            if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="fas fa-table" aria-hidden="true"></i><span>報表</span>'; }
            if (state.cy) state.cy.resize();
        }
    }
    window.toggleReportView = toggleReportView;

    function buildReportView() {
        const container = document.getElementById('report-view-content');
        if (!container) return;
        if (!state.cy || state.cy.nodes().length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#999; padding:60px 20px;"><i class="fas fa-table" style="font-size:48px; margin-bottom:16px;"></i><div style="font-size:16px; font-weight:600;">報表檢視</div><div style="font-size:13px; margin-top:8px;">請先執行搜尋，報表將顯示所有節點的結構化資料。</div></div>';
            return;
        }

        // 如果正在查看詳情，直接顯示詳情而不是列表
        if (_currentReportDetail && _currentReportDetail.nodeId) {
            renderReportDetail(_currentReportDetail.nodeId, _currentReportDetail.nodeData);
            return;
        }

        // ★ 只取可見節點（配合深度/篩選）
        const nodes = state.cy.nodes().filter(n => n.style('display') !== 'none');
        const edges = state.cy.edges().filter(e => e.style('display') !== 'none');

        // Separate companies and persons
        const companies = [];
        const persons = [];
        nodes.forEach(n => {
            const d = n.data();
            if (d.type === 'company') companies.push(d);
            else if (d.type === 'person') persons.push(d);
        });

        // Sort: high risk first, then by flag_count
        const riskOrder = { CRITICAL: 0, WARNING: 1, INFO: 2, NONE: 3 };
        companies.sort((a, b) => (riskOrder[a.risk_level] || 3) - (riskOrder[b.risk_level] || 3) || (b.flag_count || 0) - (a.flag_count || 0));
        persons.sort((a, b) => (riskOrder[a.risk_level] || 3) - (riskOrder[b.risk_level] || 3) || (b.flag_count || 0) - (a.flag_count || 0));

        // Build edges lookup
        const edgeMap = {};
        edges.forEach(e => {
            const d = e.data();
            const key = d.source + '→' + d.target;
            edgeMap[key] = d;
        });

        // Count connections per person
        const personConnections = {};
        edges.forEach(e => {
            const d = e.data();
            if (d.source) {
                personConnections[d.source] = (personConnections[d.source] || 0) + 1;
            }
            if (d.target) {
                personConnections[d.target] = (personConnections[d.target] || 0) + 1;
            }
        });

        // Risk badge helper
        function riskBadge(level) {
            const colors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#3498DB', NONE: '#95A5A6' };
            const labels = { CRITICAL: '高風險', WARNING: '中風險', INFO: '資訊', NONE: '正常' };
            return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; color:#fff; background:' + (colors[level] || colors.NONE) + ';">' + (labels[level] || '正常') + '</span>';
        }

        // Seed badge
        function seedBadge(isSeed) {
            return isSeed ? ' <span style="display:inline-block; padding:1px 6px; border-radius:8px; font-size:9px; font-weight:600; color:#1ABC9C; border:1px solid #1ABC9C;">主體</span>' : '';
        }

        // Build person detail: list their connected companies
        function personCompanyList(personId) {
            const connected = [];
            edges.forEach(e => {
                const d = e.data();
                if (d.source === personId || d.target === personId) {
                    const otherId = d.source === personId ? d.target : d.source;
                    const otherNode = state.cy.getElementById(otherId);
                    if (otherNode.length && otherNode.data('type') === 'company') {
                        connected.push({
                            name: otherNode.data('label') || otherId,
                            role: d.label || d.relationship || '關聯',
                            risk: otherNode.data('risk_level') || 'NONE',
                            entity_id: otherNode.data('entity_id') || ''
                        });
                    }
                }
            });
            return connected;
        }

        let html = '';

        // Summary bar
        html += '<div style="display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap;">';
        html += '<div style="background:#f0f7ff; border-radius:8px; padding:12px 20px; flex:1; min-width:120px; text-align:center;"><div style="font-size:24px; font-weight:700; color:#3A7CA5;">' + companies.length + '</div><div style="font-size:11px; color:#888;">公司</div></div>';
        html += '<div style="background:#fdf6ec; border-radius:8px; padding:12px 20px; flex:1; min-width:120px; text-align:center;"><div style="font-size:24px; font-weight:700; color:#B8860B;">' + persons.length + '</div><div style="font-size:11px; color:#888;">自然人</div></div>';
        html += '<div style="background:#fdeaea; border-radius:8px; padding:12px 20px; flex:1; min-width:120px; text-align:center;"><div style="font-size:24px; font-weight:700; color:#C0392B;">' + companies.filter(c => c.risk_level === 'CRITICAL').length + '</div><div style="font-size:11px; color:#888;">高風險公司</div></div>';
        html += '<div style="background:#fef4ea; border-radius:8px; padding:12px 20px; flex:1; min-width:120px; text-align:center;"><div style="font-size:24px; font-weight:700; color:#E67E22;">' + companies.filter(c => c.risk_level === 'WARNING').length + '</div><div style="font-size:11px; color:#888;">中風險公司</div></div>';
        html += '<div style="background:#eaf7f0; border-radius:8px; padding:12px 20px; flex:1; min-width:120px; text-align:center;"><div style="font-size:24px; font-weight:700; color:#27AE60;">' + edges.length + '</div><div style="font-size:11px; color:#888;">關聯數</div></div>';
        html += '</div>';

        // Tab bar
        html += '<div id="report-tabs" style="display:flex; gap:0; border-bottom:2px solid #e0e0e0; margin-bottom:16px;">';
        html += '<button class="report-tab report-tab-active" onclick="switchReportTab(\'companies\')" data-tab="companies" style="padding:8px 20px; border:none; background:none; font-size:13px; font-weight:600; color:#3A7CA5; border-bottom:2px solid #3A7CA5; margin-bottom:-2px; cursor:pointer;">公司列表</button>';
        html += '<button class="report-tab" onclick="switchReportTab(\'persons\')" data-tab="persons" style="padding:8px 20px; border:none; background:none; font-size:13px; font-weight:500; color:#888; cursor:pointer;">人物列表</button>';
        html += '<button class="report-tab" onclick="switchReportTab(\'edges\')" data-tab="edges" style="padding:8px 20px; border:none; background:none; font-size:13px; font-weight:500; color:#888; cursor:pointer;">關聯列表</button>';
        html += '<button class="report-tab" onclick="switchReportTab(\'flags\')" data-tab="flags" style="padding:8px 20px; border:none; background:none; font-size:13px; font-weight:500; color:#888; cursor:pointer;">紅旗警示</button>';
        html += '</div>';

        // ===== Companies table =====
        html += '<div id="report-panel-companies" class="report-panel">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:14px;">';
        html += '<thead><tr style="background:#f5f7fa; text-align:left;">';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">公司名稱</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">統一編號</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">風險等級</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">紅旗數</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">資本額</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">代表人</th>';
        html += '<th style="padding:10px 14px; border-bottom:2px solid #ddd; font-weight:600;">地址</th>';
        html += '</tr></thead><tbody>';
        companies.forEach((c, i) => {
            const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
            const name = c.label || c.id || '';
            const entityId = c.entity_id || '';
            const flagCount = c.flag_count || 0;
            const addr = c.address || '';
            const cap = c.capital ? (c.capital >= 10000 ? Math.round(c.capital / 10000).toLocaleString() + ' 萬' : c.capital.toLocaleString()) : '-';
            const rep = c.representative || '-';
            html += '<tr style="background:' + bg + '; cursor:pointer;" onclick="reportClickNode(\'' + c.id + '\')">';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; font-weight:500;">' + name + seedBadge(c.is_seed) + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; font-family:monospace;">' + entityId + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee;">' + riskBadge(c.risk_level) + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; text-align:center;">' + (flagCount > 0 ? '<span style="color:#C0392B; font-weight:600;">' + flagCount + '</span>' : '0') + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; font-size:13px;">' + cap + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; font-size:13px;">' + rep + '</td>';
            html += '<td style="padding:10px 14px; border-bottom:1px solid #eee; font-size:12px; color:#666; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + addr + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        // ===== Persons table =====
        html += '<div id="report-panel-persons" class="report-panel" style="display:none;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
        html += '<thead><tr style="background:#f5f7fa; text-align:left;">';
        html += '<th style="padding:8px 12px; border-bottom:2px solid #ddd; font-weight:600;">姓名</th>';
        html += '<th style="padding:8px 12px; border-bottom:2px solid #ddd; font-weight:600;">風險等級</th>';
        html += '<th style="padding:8px 12px; border-bottom:2px solid #ddd; font-weight:600;">關聯公司數</th>';
        html += '<th style="padding:8px 12px; border-bottom:2px solid #ddd; font-weight:600;">關聯公司</th>';
        html += '</tr></thead><tbody>';
        persons.forEach((p, i) => {
            const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
            const name = p.label || p.id || '';
            const connectedCompanies = personCompanyList(p.id);
            const companyNames = connectedCompanies.map(c => c.name + '(' + c.role + ')').join('、');
            html += '<tr style="background:' + bg + '; cursor:pointer;" onclick="reportClickNode(\'' + p.id + '\')">';
            html += '<td style="padding:8px 12px; border-bottom:1px solid #eee;">' + name + '</td>';
            html += '<td style="padding:8px 12px; border-bottom:1px solid #eee;">' + riskBadge(p.risk_level) + '</td>';
            html += '<td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:center;">' + connectedCompanies.length + '</td>';
            html += '<td style="padding:8px 12px; border-bottom:1px solid #eee; font-size:11px; color:#666; max-width:350px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + companyNames + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';

        // ===== Edges table (改善 #8 #9：以人為單位分組，現任放上方，歷史在下方) =====
        html += '<div id="report-panel-edges" class="report-panel" style="display:none;">';

        // 重新整理 edges，以人為單位分組
        const personEdgeGroups = {};
        const personCurrent = {};  // 追蹤現任角色
        const personHistorical = {}; // 追蹤歷史角色

        edges.forEach((e) => {
            const d = e.data();
            const srcNode = state.cy.getElementById(d.source);
            const tgtNode = state.cy.getElementById(d.target);

            // 如果來源是人，記錄該人與目標的關聯
            if (srcNode.length && srcNode.data('type') === 'person') {
                const personId = d.source;
                const personLabel = srcNode.data('label') || personId;
                if (!personEdgeGroups[personId]) {
                    personEdgeGroups[personId] = { label: personLabel, current: [], historical: [] };
                }
                const edgeInfo = {
                    tgtId: d.target,
                    tgtLabel: tgtNode.length ? (tgtNode.data('label') || d.target) : d.target,
                    relationship: d.label || d.relationship || '關聯',
                    shares: d.shares_percentage ? d.shares_percentage + '%' : '',
                    isHistorical: d.status === 'historical' || d.is_historical === true,
                };
                if (edgeInfo.isHistorical) {
                    personHistorical[personId] = (personHistorical[personId] || 0) + 1;
                    personEdgeGroups[personId].historical.push(edgeInfo);
                } else {
                    personCurrent[personId] = (personCurrent[personId] || 0) + 1;
                    personEdgeGroups[personId].current.push(edgeInfo);
                }
            }
        });

        // 依人分組顯示，現任優先
        const personIds = Object.keys(personEdgeGroups).sort();

        if (personIds.length === 0) {
            html += '<div style="text-align:center; color:#999; padding:40px;">尚無人員關聯</div>';
        } else {
            personIds.forEach((personId) => {
                const group = personEdgeGroups[personId];
                html += '<div style="margin-bottom:24px; border:1px solid #e0e0e0; border-radius:4px; overflow:hidden;">';
                html += '<div style="background:#f5f7fa; padding:12px 16px; border-bottom:1px solid #e0e0e0; cursor:pointer;" onclick="reportClickNode(\'' + personId + '\')">';
                html += '<h4 style="margin:0; font-size:13px; font-weight:600; color:#333;">' + group.label + '</h4>';
                html += '<div style="font-size:11px; color:#888; margin-top:4px;">' + (personCurrent[personId] || 0) + ' 個現任 / ' + (personHistorical[personId] || 0) + ' 個歷史</div>';
                html += '</div>';

                // 現任角色
                if (group.current.length > 0) {
                    html += '<div style="padding:12px 16px; background:#fafbfc; border-bottom:1px solid #eee;">';
                    html += '<div style="font-size:11px; font-weight:600; color:#666; margin-bottom:8px;">現任角色</div>';
                    group.current.forEach((edge) => {
                        html += '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #eee; font-size:12px;">';
                        html += '<div>';
                        html += '<span style="cursor:pointer; color:#3A7CA5; text-decoration:underline;" onclick="reportClickNode(\'' + edge.tgtId + '\')">' + edge.tgtLabel + '</span>';
                        html += ' <span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; background:#e8f5e9; color:#2e7d32; margin-left:8px;">' + edge.relationship + '</span>';
                        html += '</div>';
                        if (edge.shares) html += '<span style="color:#999; font-family:monospace;">' + edge.shares + '</span>';
                        html += '</div>';
                    });
                    html += '</div>';
                }

                // 歷史角色
                if (group.historical.length > 0) {
                    html += '<div style="padding:12px 16px; background:#fff;">';
                    html += '<div style="font-size:11px; font-weight:600; color:#999; margin-bottom:8px;">歷史角色</div>';
                    group.historical.forEach((edge) => {
                        html += '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f0f0f0; font-size:12px; opacity:0.7;">';
                        html += '<div>';
                        html += '<span style="cursor:pointer; color:#3A7CA5; text-decoration:underline;" onclick="reportClickNode(\'' + edge.tgtId + '\')">' + edge.tgtLabel + '</span>';
                        html += ' <span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; background:#f5f5f5; color:#888;">' + edge.relationship + '</span>';
                        html += '</div>';
                        if (edge.shares) html += '<span style="color:#ccc; font-family:monospace;">' + edge.shares + '</span>';
                        html += '</div>';
                    });
                    html += '</div>';
                }

                html += '</div>';
            });
        }
        html += '</div>';

        // ===== Red flags table =====
        html += '<div id="report-panel-flags" class="report-panel" style="display:none;">';
        const allFlags = [];
        nodes.forEach(n => {
            const d = n.data();
            if (d.flags && d.flags.length) {
                d.flags.forEach(f => {
                    allFlags.push({ entity: d.label || d.id, entity_id: d.entity_id || '', nodeId: d.id, ...f });
                });
            }
        });
        if (allFlags.length === 0) {
            html += '<div style="text-align:center; color:#999; padding:40px;">尚無紅旗警示</div>';
        } else {
            html += '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
            html += '<thead><tr style="background:#f5f7fa; text-align:left;">';
            html += '<th style="padding:10px 12px; border-bottom:2px solid #ddd; font-weight:600;">對象</th>';
            html += '<th style="padding:10px 12px; border-bottom:2px solid #ddd; font-weight:600;">類型</th>';
            html += '<th style="padding:10px 12px; border-bottom:2px solid #ddd; font-weight:600;">嚴重度</th>';
            html += '<th style="padding:10px 12px; border-bottom:2px solid #ddd; font-weight:600;">說明</th>';
            html += '<th style="padding:10px 12px; border-bottom:2px solid #ddd; font-weight:600;">佐證</th>';
            html += '</tr></thead><tbody>';
            allFlags.forEach((f, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
                const sevColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#3498DB' };
                const sevLabels = { CRITICAL: '嚴重', WARNING: '警告', INFO: '資訊' };
                // 解析 description：可能是字串，也可能是物件
                const descRaw = f.description || f.message || '';
                let descText = '';
                if (typeof descRaw === 'object') {
                    descText = descRaw.description || descRaw.message || JSON.stringify(descRaw);
                } else {
                    descText = String(descRaw);
                }
                // 如果 description 包含 {'evidence': 格式，嘗試提取純文字描述
                if (descText.includes("'evidence'") || descText.includes('"evidence"')) {
                    try {
                        const parsed = JSON.parse(descText.replace(/'/g, '"'));
                        if (parsed.description) descText = parsed.description;
                    } catch(e) {
                        // 嘗試正則提取
                        const m = descText.match(/'description':\s*'([^']+)'/);
                        if (m) descText = m[1];
                    }
                }
                // 解析 evidence 為人類可讀
                const evidence = f.evidence || {};
                let evidenceHtml = '';
                if (evidence && typeof evidence === 'object' && Object.keys(evidence).length > 0) {
                    evidenceHtml = _formatEvidenceReadable(evidence);
                }
                const ruleNames = { 'SHELL_COMPANY':'殼公司','RAPID_DISSOLVE':'快速註銷','PHOENIX_COMPANY':'鳳凰公司','CIRCULAR_OWNERSHIP':'循環持股','NOMINEE_DIRECTOR':'代理董事','CAPITAL_ANOMALY':'資本異常','ADDRESS_CLUSTER':'地址聚集','FREQUENT_CHANGE':'頻繁變更','DORMANT_REVIVAL':'休眠復甦','CROSS_HOLDING':'交叉持股','AGE_ANOMALY':'年齡異常','MASS_DIRECTOR':'大量董事','REGISTRATION_BURST':'註冊激增','STAR_STRUCTURE':'星形結構','BRIDGE_NODE':'橋接節點','UBO_DEEP_PATH':'UBO 深層路徑','CAPITAL_VOLATILITY':'資本劇烈跳動','BATCH_REGISTRATION':'批量登記','DIRECTOR_MUSICAL_CHAIRS':'董事走馬燈','UBO_CONCENTRATION':'UBO 資本集中','HIDDEN_UBO':'隱藏實質受益人','SUSPICIOUS_INDUSTRY_MIX':'異常產業組合','CROSS_INVESTIGATION':'跨調查關聯' };
                const ruleDisplay = ruleNames[f.rule_id] || f.rule_id || f.rule || f.type || '';
                html += '<tr style="background:' + bg + '; cursor:pointer;" onclick="reportClickNode(\'' + f.nodeId + '\')">';
                html += '<td style="padding:10px 12px; border-bottom:1px solid #eee;"><span style="color:#3A7CA5; text-decoration:underline;">' + esc(f.entity) + '</span></td>';
                html += '<td style="padding:10px 12px; border-bottom:1px solid #eee;">' + esc(ruleDisplay) + '</td>';
                html += '<td style="padding:10px 12px; border-bottom:1px solid #eee;"><span style="color:' + (sevColors[f.severity] || '#888') + '; font-weight:600;">' + (sevLabels[f.severity] || f.severity || '') + '</span></td>';
                html += '<td style="padding:10px 12px; border-bottom:1px solid #eee; color:#555;">' + esc(descText) + '</td>';
                html += '<td style="padding:10px 12px; border-bottom:1px solid #eee; font-size:12px; color:#888;">' + evidenceHtml + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        container.innerHTML = html;
    }

    function switchReportTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('#report-tabs .report-tab').forEach(btn => {
            const isActive = btn.getAttribute('data-tab') === tabName;
            btn.style.color = isActive ? '#3A7CA5' : '#888';
            btn.style.fontWeight = isActive ? '600' : '500';
            btn.style.borderBottom = isActive ? '2px solid #3A7CA5' : 'none';
            btn.classList.toggle('report-tab-active', isActive);
        });
        // Show/hide panels
        document.querySelectorAll('.report-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById('report-panel-' + tabName);
        if (panel) panel.style.display = 'block';
    }
    window.switchReportTab = switchReportTab;

    function reportClickNode(nodeId) {
        // 規則書 4-A：報表模式中點擊節點，必須留在報表模式，不可跳回圖形
        // 同時在報表顯示對應節點的詳情和麵包屑導覽
        if (!state.cy) return;
        const node = state.cy.getElementById(nodeId);
        if (node.length === 0) return;

        const nodeData = node.data();
        const container = document.getElementById('report-view-content');
        if (!container) return;

        // 在報表檢視中，一律更新報表內容展示該節點的詳情（不跳回圖形）
        if (_reportViewActive) {
            if (!_currentReportDetail) {
                _currentReportDetail = {};
            }
            _currentReportDetail.nodeId = nodeId;
            _currentReportDetail.nodeData = nodeData;
            renderReportDetail(nodeId, nodeData);
        } else {
            // 如果不在報表模式，也更新右欄詳情面板（不切換模式）
            showNodeDetail(nodeData);
        }
    }
    window.reportClickNode = reportClickNode;

    let _currentReportDetail = null;

    // 取得所有報表中的節點清單（供上一筆/下一筆用）
    function _getReportNodeList() {
        if (!state.cy) return [];
        const nodes = [];
        state.cy.nodes().forEach(n => {
            const d = n.data();
            nodes.push({ id: d.id, type: d.type, label: d.label });
        });
        // 公司排前，人物排後
        const riskOrder = { CRITICAL: 0, WARNING: 1, INFO: 2, NONE: 3 };
        nodes.sort((a, b) => {
            if (a.type === 'company' && b.type !== 'company') return -1;
            if (a.type !== 'company' && b.type === 'company') return 1;
            return 0;
        });
        return nodes;
    }

    function renderReportDetail(nodeId, nodeData) {
        const container = document.getElementById('report-view-content');
        if (!container) return;

        // 上一筆/下一筆邏輯
        const nodeList = _getReportNodeList();
        const currentIdx = nodeList.findIndex(n => n.id === nodeId);
        const prevNode = currentIdx > 0 ? nodeList[currentIdx - 1] : null;
        const nextNode = currentIdx < nodeList.length - 1 ? nodeList[currentIdx + 1] : null;

        // 導覽列：返回 + 上一筆/下一筆
        let navHtml = `<div style="padding:14px 20px; background:#f5f7fa; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:10;">
            <div style="display:flex; align-items:center; gap:10px;">
                <button onclick="clearReportDetail()" style="background:none; border:1px solid #ccc; border-radius:6px; color:#3A7CA5; cursor:pointer; font-size:14px; font-weight:500; padding:6px 14px;"><i class="fas fa-arrow-left" style="margin-right:6px;"></i>返回列表</button>
                <span style="color:#ccc;">|</span>
                <span style="font-size:15px; font-weight:600; color:#333;">${esc(nodeData.label || nodeId)}</span>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <button onclick="${prevNode ? "reportClickNode('" + prevNode.id + "')" : ''}" style="padding:6px 14px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:${prevNode ? 'pointer' : 'not-allowed'}; opacity:${prevNode ? 1 : 0.4}; font-size:13px;" ${prevNode ? '' : 'disabled'}>
                    <i class="fas fa-chevron-left"></i> 上一筆
                </button>
                <span style="font-size:13px; color:#666; min-width:60px; text-align:center;">${currentIdx + 1} / ${nodeList.length}</span>
                <button onclick="${nextNode ? "reportClickNode('" + nextNode.id + "')" : ''}" style="padding:6px 14px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:${nextNode ? 'pointer' : 'not-allowed'}; opacity:${nextNode ? 1 : 0.4}; font-size:13px;" ${nextNode ? '' : 'disabled'}>
                    下一筆 <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>`;

        let detailHtml = '<div style="padding:28px; max-width:900px;">';

        // 標題
        const typeLabel = nodeData.type === 'company' ? '公司' : '自然人';
        const typeIcon = nodeData.type === 'company' ? 'fa-building' : 'fa-user';
        detailHtml += `<div style="display:flex; align-items:center; gap:14px; margin-bottom:24px;">
            <div style="width:52px; height:52px; border-radius:50%; background:${nodeData.type === 'company' ? '#e8f4f8' : '#f0e8f8'}; display:flex; align-items:center; justify-content:center;">
                <i class="fas ${typeIcon}" style="font-size:22px; color:${nodeData.type === 'company' ? '#3A7CA5' : '#7B5EA7'};"></i>
            </div>
            <div>
                <h3 style="margin:0; font-size:24px; font-weight:700;">${esc(nodeData.label || nodeId)}</h3>
                <span style="font-size:15px; color:#888;">${typeLabel}</span>
            </div>
        </div>`;

        const riskColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#3498DB', NONE: '#95A5A6' };
        const riskLabels = { CRITICAL: '高風險', WARNING: '中風險', INFO: '資訊', NONE: '正常' };
        const rl = nodeData.risk_level || 'NONE';

        if (nodeData.type === 'company') {
            // 狀態判定
            const rawStatus = nodeData.status || '';
            const isActive = !rawStatus || rawStatus === '核准設立' || rawStatus === '營運中';
            const statusColor = isActive ? '#27AE60' : (rawStatus.includes('解散') || rawStatus.includes('廢止') || rawStatus.includes('撤銷') ? '#C0392B' : '#E67E22');
            const statusText = rawStatus || '核准設立';

            // 風險標籤
            detailHtml += `<div style="display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap;">
                <span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#fff; background:${riskColors[rl] || '#95A5A6'};">${riskLabels[rl] || '正常'}</span>
                ${nodeData.flag_count ? `<span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#C0392B; background:#fdeaea;">${nodeData.flag_count} 個紅旗</span>` : ''}
                ${nodeData.is_seed ? `<span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#1ABC9C; border:1px solid #1ABC9C;">調查主體</span>` : ''}
                <span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:${statusColor}; border:1px solid ${statusColor};">${esc(statusText)}</span>
                ${nodeData.obu_warning ? `<span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#fff; background:#E74C3C;">⚠ UBO 不明</span>` : `<span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#27AE60; border:1px solid #27AE60;">UBO 正常</span>`}
            </div>`;

            // ── 基本資料 ──
            const capStr = nodeData.capital ? `NT$ ${Number(nodeData.capital).toLocaleString()}` : '';
            detailHtml += `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;">
                <h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:#333;"><i class="fas fa-info-circle" style="margin-right:6px; color:#3A7CA5;"></i>基本資料</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:15px; line-height:1.7;">
                    <div><span style="color:#888; font-size:13px;">統一編號</span><br><strong style="font-family:monospace; font-size:17px; letter-spacing:1px;">${esc(nodeData.entity_id || 'N/A')}</strong></div>
                    <div><span style="color:#888; font-size:13px;">公司狀態</span><br><strong style="color:${statusColor};">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${statusColor}; margin-right:4px;"></span>${esc(statusText)}
                    </strong></div>
                    ${nodeData.company_type ? `<div><span style="color:#888; font-size:13px;">組織類型</span><br><strong>${esc(nodeData.company_type)}</strong></div>` : ''}
                    ${nodeData.registration_authority ? `<div><span style="color:#888; font-size:13px;">登記機關</span><br><strong>${esc(nodeData.registration_authority)}</strong></div>` : ''}
                    ${capStr ? `<div><span style="color:#888; font-size:13px;">資本總額</span><br><strong>${capStr}</strong></div>` : ''}
                    ${nodeData.paid_in_capital ? `<div><span style="color:#888; font-size:13px;">實收資本額</span><br><strong>NT$ ${Number(String(nodeData.paid_in_capital).replace(/,/g, '')).toLocaleString()}</strong></div>` : ''}
                    ${nodeData.issued_shares ? `<div><span style="color:#888; font-size:13px;">已發行股份</span><br><strong>${parseInt(nodeData.issued_shares).toLocaleString()} 股</strong></div>` : ''}
                    ${nodeData.share_amount ? `<div><span style="color:#888; font-size:13px;">每股金額</span><br><strong>NT$ ${parseInt(nodeData.share_amount).toLocaleString()}</strong></div>` : ''}
                    ${nodeData.representative ? `<div><span style="color:#888; font-size:13px;">代表人/負責人</span><br><strong>${esc(nodeData.representative)}</strong></div>` : ''}
                    ${nodeData.established_date ? `<div><span style="color:#888; font-size:13px;">核准設立日期</span><br><strong>${esc(nodeData.established_date)}</strong></div>` : ''}
                    ${nodeData.last_change_date ? `<div><span style="color:#888; font-size:13px;">最後核准變更日期</span><br><strong>${esc(nodeData.last_change_date)}</strong></div>` : ''}
                    ${nodeData.dissolved_date ? `<div><span style="color:#888; font-size:13px;">解散/廢止日期</span><br><strong style="color:#C0392B;">${esc(nodeData.dissolved_date)}</strong></div>` : ''}
                    ${nodeData.address ? `<div style="grid-column:1/3;"><span style="color:#888; font-size:13px;">公司所在地</span><br><strong>${esc(nodeData.address)}</strong></div>` : ''}
                </div>
            </div>`;

            // ── 所營事業資料 ──
            const bizItems = nodeData.business_items || [];
            if (bizItems.length > 0) {
                detailHtml += `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;">
                    <h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:#333;"><i class="fas fa-briefcase" style="margin-right:6px; color:#8E44AD;"></i>所營事業資料（${bizItems.length}）</h4>
                    <div style="display:grid; gap:6px;">
                        ${bizItems.map(item => {
                            const code = typeof item === 'string' ? '' : (item.code || (Array.isArray(item) ? item[0] : ''));
                            const name = typeof item === 'string' ? item : (item.name || (Array.isArray(item) ? item[1] : String(item)));
                            return `<div style="display:flex; gap:8px; align-items:baseline; font-size:14px; padding:4px 0; border-bottom:1px solid rgba(0,0,0,0.04);">
                                ${code ? `<span style="font-family:monospace; color:#3A7CA5; font-weight:600; min-width:80px;">${esc(code)}</span>` : ''}
                                <span>${esc(name)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            }

            // ── 董監事名單（含持股比例） ──
            const dirs = nodeData.directors_data || [];
            if (dirs.length > 0) {
                const totalCap = nodeData.capital || 0;
                const issuedShares = nodeData.issued_shares || 0;
                const denominator = totalCap || issuedShares;

                detailHtml += `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;">
                    <h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:#333;"><i class="fas fa-users" style="margin-right:6px; color:#2980B9;"></i>董監事名單（${dirs.length}）</h4>
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        <thead>
                            <tr style="background:#eef2f5; border-bottom:2px solid #ddd;">
                                <th style="text-align:left; padding:10px 12px; font-weight:600;">姓名</th>
                                <th style="text-align:left; padding:10px 12px; font-weight:600;">職稱</th>
                                <th style="text-align:left; padding:10px 12px; font-weight:600;">代表法人</th>
                                <th style="text-align:right; padding:10px 12px; font-weight:600;">出資額/持股</th>
                                <th style="text-align:right; padding:10px 12px; font-weight:600; min-width:80px;">占比</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dirs.map((d, i) => {
                                const name = d['姓名'] || d.name || '';
                                const title = d['職稱'] || d.title || '';
                                const repOf = d['所代表法人'] || d.representative_of || '';
                                const repName = Array.isArray(repOf) ? repOf.join(', ') : String(repOf || '');
                                const shares = d['出資額'] || d['持有股份數'] || d.shares || 0;
                                const sharesNum = parseInt(String(shares).replace(/,/g, ''), 10) || 0;
                                let pct = 0;
                                if (sharesNum > 0 && denominator > 0) pct = (sharesNum / denominator * 100);
                                const pctStr = pct > 0 ? pct.toFixed(2) + '%' : '-';
                                const barWidth = Math.min(pct, 100);
                                const titleColors = { '董事長': '#C0392B', '董事': '#2980B9', '監察人': '#8E44AD', '獨立董事': '#16A085', '負責人': '#D35400' };
                                const tc = titleColors[title] || '#7F8C8D';
                                const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
                                return `<tr style="background:${bg}; border-bottom:1px solid #f0f0f0;">
                                    <td style="padding:10px 12px; font-weight:500;">${esc(name)}</td>
                                    <td style="padding:10px 12px;"><span style="padding:2px 8px; border-radius:10px; font-size:12px; background:${tc}15; color:${tc}; font-weight:600;">${esc(title)}</span></td>
                                    <td style="padding:10px 12px; font-size:13px; color:#666;">${repName ? esc(repName) : '-'}</td>
                                    <td style="padding:10px 12px; text-align:right; font-family:monospace;">${sharesNum > 0 ? 'NT$ ' + sharesNum.toLocaleString() : '-'}</td>
                                    <td style="padding:10px 12px; text-align:right;">
                                        ${pct > 0 ? `<div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                                            <div style="width:60px; height:6px; background:#eee; border-radius:3px; overflow:hidden;">
                                                <div style="width:${barWidth}%; height:100%; background:linear-gradient(90deg, #E67E22, #F39C12); border-radius:3px;"></div>
                                            </div>
                                            <span style="font-weight:700; color:#E67E22; min-width:50px;">${pctStr}</span>
                                        </div>` : '<span style="color:#ccc;">-</span>'}
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
            }
        } else if (nodeData.type === 'person') {
            // 風險標籤
            detailHtml += `<div style="display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap;">
                <span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#fff; background:${riskColors[rl] || '#95A5A6'};">${riskLabels[rl] || '正常'}</span>
                ${nodeData.flag_count ? `<span style="padding:6px 16px; border-radius:20px; font-size:14px; font-weight:600; color:#C0392B; background:#fdeaea;">${nodeData.flag_count} 個紅旗</span>` : ''}
            </div>`;

            detailHtml += `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;">
                <h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:#333;"><i class="fas fa-user" style="margin-right:6px; color:#7B5EA7;"></i>基本資料</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:15px; line-height:1.7;">
                    <div><span style="color:#888; font-size:13px;">姓名</span><br><strong style="font-size:17px;">${esc(nodeData.label || 'N/A')}</strong></div>
                    <div><span style="color:#888; font-size:13px;">類型</span><br><strong>自然人</strong></div>
                    ${nodeData.nationality ? `<div><span style="color:#888; font-size:13px;">國籍</span><br><strong>${esc(nodeData.nationality)}</strong></div>` : ''}
                </div>
            </div>`;
        }

        // ── 紅旗警示 ──
        const flags = nodeData.flags || [];
        if (flags.length > 0) {
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
            const sevColors = { CRITICAL: '#C0392B', WARNING: '#E67E22', INFO: '#2980B9' };
            const sevLabels = { CRITICAL: '嚴重', WARNING: '警告', INFO: '資訊' };
            detailHtml += `<div style="background:#fff5f5; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #f5d5d5;">
                <h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:#C0392B;"><i class="fas fa-flag" style="margin-right:6px;"></i>紅旗警示（${flags.length}）</h4>
                ${flags.map(f => {
                    const c = sevColors[f.severity] || '#999';
                    const sl = sevLabels[f.severity] || f.severity;
                    const rn = ruleNames[f.rule_id] || f.rule_id;
                    // 解析 description
                    let descText = '';
                    const descRaw = f.description || '';
                    if (typeof descRaw === 'object') {
                        descText = descRaw.description || descRaw.message || '';
                    } else {
                        descText = String(descRaw);
                    }
                    if (descText.includes("'evidence'") || descText.includes('"evidence"')) {
                        try {
                            const parsed = JSON.parse(descText.replace(/'/g, '"'));
                            if (parsed.description) descText = parsed.description;
                        } catch(e) {
                            const m = descText.match(/'description':\s*'([^']+)'/);
                            if (m) descText = m[1];
                        }
                    }
                    // 解析 evidence 為人類可讀
                    const evidence = f.evidence || {};
                    const evidenceHtml = _formatEvidenceReadable(evidence);
                    return `<div style="padding:14px 16px; border-left:4px solid ${c}; margin-bottom:10px; background:#fff; border-radius:0 8px 8px 0; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <span style="padding:3px 10px; border-radius:12px; font-size:12px; font-weight:600; color:#fff; background:${c};">${sl}</span>
                            <span style="font-weight:700; font-size:15px; color:#333;">${esc(rn)}</span>
                        </div>
                        ${descText ? `<div style="font-size:14px; color:#555; margin-bottom:6px; line-height:1.6;">${esc(descText)}</div>` : ''}
                        ${evidenceHtml ? `<div style="background:#f9f5f5; padding:10px 12px; border-radius:6px; font-size:13px; color:#777; margin-top:6px;">
                            <div style="font-size:11px; color:#999; margin-bottom:4px; font-weight:600;">佐證資料</div>
                            ${evidenceHtml}
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>`;
        }

        // ── 關聯列表 ──
        const node = state.cy.getElementById(nodeId);
        if (node.length > 0) {
            const connEdges = node.connectedEdges();
            if (connEdges.length > 0) {
                const currentRels = [];
                const histRels = [];
                connEdges.forEach(e => {
                    const d = e.data();
                    const otherId = d.source === nodeId ? d.target : d.source;
                    const otherNode = state.cy.getElementById(otherId);
                    const otherData = otherNode.length ? otherNode.data() : {};
                    const entry = {
                        otherId,
                        otherLabel: otherData.label || otherId,
                        otherType: otherData.type || '',
                        rel: d.label || d.relationship || '關聯',
                        isHist: d.type === 'historical' || d.status === 'historical' || d.is_historical,
                        date: d.date || d.change_date || d.end_date || '',
                        shares: d.shares || d.shareholding || 0,
                        otherEntityId: otherData.entity_id || '',
                    };
                    if (entry.isHist) histRels.push(entry);
                    else currentRels.push(entry);
                });

                function renderRelSection(title, rels, dimmed) {
                    let h = `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;${dimmed ? ' opacity:0.7;' : ''}">`;
                    h += `<h4 style="margin:0 0 16px 0; font-size:17px; font-weight:700; color:${dimmed ? '#999' : '#333'};"><i class="fas ${dimmed ? 'fa-history' : 'fa-link'}" style="margin-right:6px; color:${dimmed ? '#bbb' : '#27AE60'};"></i>${title}（${rels.length}）</h4>`;
                    h += '<table style="width:100%; border-collapse:collapse; font-size:14px;"><thead><tr style="background:#eef2f5; border-bottom:2px solid #ddd;">';
                    h += '<th style="text-align:left; padding:10px 12px; font-weight:600;">對象</th>';
                    h += '<th style="text-align:left; padding:10px 12px; font-weight:600;">關係</th>';
                    h += '<th style="text-align:left; padding:10px 12px; font-weight:600;">統編/ID</th>';
                    if (dimmed) h += '<th style="text-align:left; padding:10px 12px; font-weight:600;">日期</th>';
                    h += '</tr></thead><tbody>';
                    rels.forEach((r, i) => {
                        const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
                        const icon = r.otherType === 'company' ? 'fa-building' : 'fa-user';
                        const iconColor = r.otherType === 'company' ? '#3A7CA5' : '#7B5EA7';
                        h += `<tr style="background:${bg}; border-bottom:1px solid #f0f0f0; cursor:pointer;" onclick="reportClickNode('${r.otherId}')">
                            <td style="padding:10px 12px;">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <i class="fas ${icon}" style="color:${iconColor};"></i>
                                    <span style="color:#3A7CA5; font-weight:500;">${esc(r.otherLabel)}</span>
                                </div>
                            </td>
                            <td style="padding:10px 12px;"><span style="padding:3px 10px; border-radius:12px; font-size:12px; font-weight:500; background:${r.isHist ? '#f5f5f5; color:#888;' : '#e8f5e9; color:#2e7d32;'}">${esc(r.rel)}</span></td>
                            <td style="padding:10px 12px; font-family:monospace; font-size:13px; color:#888;">${esc(r.otherEntityId)}</td>
                            ${dimmed ? `<td style="padding:10px 12px; font-size:13px; color:#bbb;">${esc(r.date)}</td>` : ''}
                        </tr>`;
                    });
                    h += '</tbody></table></div>';
                    return h;
                }

                if (currentRels.length > 0) detailHtml += renderRelSection('現任關聯', currentRels, false);
                if (histRels.length > 0) detailHtml += renderRelSection('歷史關聯', histRels, true);
            }
        }

        // ── 歷史變動紀錄（載入區塊） ──
        if (nodeData.type === 'company') {
            detailHtml += `<div style="background:#f9fafb; padding:20px; border-radius:10px; margin-bottom:24px; border:1px solid #e8e8e8;">
                <h4 style="margin:0 0 12px 0; font-size:17px; font-weight:700; color:#333; cursor:pointer;" onclick="window.__bedrockLoadReportTimeline('${esc(nodeData.entity_id)}', this)">
                    <i class="fas fa-history" style="margin-right:6px; color:#E67E22;"></i>歷史變動紀錄
                    <i class="fas fa-chevron-down" style="font-size:12px; margin-left:6px; color:#aaa;"></i>
                </h4>
                <div id="report-timeline-${esc(nodeData.entity_id)}" style="display:none;">
                    <div style="text-align:center; padding:20px; color:#999;"><i class="fas fa-spinner fa-spin"></i> 載入中...</div>
                </div>
            </div>`;
        }

        detailHtml += '</div>';
        container.innerHTML = navHtml + detailHtml;

        // 自動載入歷史變動
        if (nodeData.type === 'company' && nodeData.entity_id) {
            _loadReportTimelineData(nodeData.entity_id);
        }
    }
    window.renderReportDetail = renderReportDetail;

    // 載入歷史變動到報表內
    async function _loadReportTimelineData(entityId) {
        const container = document.getElementById('report-timeline-' + entityId);
        if (!container) return;
        try {
            const data = await api.get(`/investigations/${state.currentInvId}/nodes/${encodeURIComponent(entityId)}/changelog`);
            const changes = data.changes || data || [];
            if (changes.length === 0) {
                container.innerHTML = '<div style="color:#999; font-size:14px; padding:8px 0;">暫無變動記錄</div>';
                return;
            }
            let html = '<div style="border-left:3px solid #E67E22; padding-left:16px;">';
            changes.forEach((c, i) => {
                const dt = c.change_date || c.changed_at || c.date || c.updated_at || '';
                const field = c.change_type || c.field || c.column_name || '';
                const oldVal = c.before_value || c.old_value || '';
                const newVal = c.after_value || c.new_value || '';
                html += `<div style="padding:10px 0; border-bottom:1px solid rgba(0,0,0,0.05); font-size:14px;">
                    <div style="font-weight:600; color:#E67E22;">${esc(dt)}</div>
                    <div style="margin-top:4px;"><span style="color:#888;">${esc(field)}</span></div>
                    ${oldVal ? `<div style="margin-top:2px; color:#C0392B; font-size:13px;">- ${esc(String(oldVal).substring(0, 200))}</div>` : ''}
                    ${newVal ? `<div style="margin-top:2px; color:#27AE60; font-size:13px;">+ ${esc(String(newVal).substring(0, 200))}</div>` : ''}
                </div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<div style="color:#999; font-size:14px; padding:8px 0;">載入失敗: ${esc(e.message)}</div>`;
        }
    }
    window.__bedrockLoadReportTimeline = function(entityId, headerEl) {
        const container = document.getElementById('report-timeline-' + entityId);
        if (!container) return;
        const isOpen = container.style.display !== 'none';
        container.style.display = isOpen ? 'none' : 'block';
        const chevron = headerEl.querySelector('.fa-chevron-down, .fa-chevron-up');
        if (chevron) {
            chevron.className = chevron.className.replace(isOpen ? 'fa-chevron-up' : 'fa-chevron-down', isOpen ? 'fa-chevron-down' : 'fa-chevron-up');
        }
    };

    function clearReportDetail() {
        // 清除詳情檢視，回到報表列表
        _currentReportDetail = null;
        buildReportView();
    }
    window.clearReportDetail = clearReportDetail;

    // ================================================================
    // 資料庫監控功能
    // ================================================================
    const healthColors = { healthy: '#2A7F3B', warning: '#e67e22', critical: '#B22D20', missing: '#999' };
    const healthLabels = { healthy: '正常', warning: '需維護', critical: '異常', missing: '未建立' };

    async function dbRefreshOverview() {
        const container = document.getElementById('db-tables-container');
        const btn = document.getElementById('btn-db-refresh');
        if (!container) return;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 載入中…'; }

        try {
            const data = await api.get('/admin/db/overview');

            // 更新全域卡片
            const el = (id) => document.getElementById(id);
            if (el('db-total-size')) el('db-total-size').textContent = data.database_size_display || '-';
            if (el('db-connections')) el('db-connections').textContent = data.active_connections || 0;
            if (el('db-pool-status')) el('db-pool-status').textContent = `${data.active_connections || 0} / ${data.pool_size + data.max_overflow}`;

            // 計算表數量
            let tableCount = 0;
            const groups = data.groups || {};
            Object.values(groups).forEach(g => { tableCount += (g.tables || []).length; });
            if (el('db-table-count')) el('db-table-count').textContent = tableCount;

            // 渲染分組
            let html = '';
            for (const [groupKey, group] of Object.entries(groups)) {
                const tables = group.tables || [];
                const healthCounts = { healthy: 0, warning: 0, critical: 0, missing: 0 };
                tables.forEach(t => { healthCounts[t.health || 'missing']++; });

                html += `
                    <div style="margin-bottom: 20px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                        <div style="background: #f5f5f3; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? '' : 'none'">
                            <div>
                                <strong>${esc(group.label)}</strong>
                                <span style="color: #666; font-size: 0.85rem; margin-left: 8px;">${tables.length} 表 · ${_fmtSize(group.total_size || 0)} · ${(group.total_rows || 0).toLocaleString()} 筆</span>
                            </div>
                            <div style="display: flex; gap: 6px;">
                                ${healthCounts.critical > 0 ? `<span style="background:#B22D20; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.75rem;">${healthCounts.critical} 異常</span>` : ''}
                                ${healthCounts.warning > 0 ? `<span style="background:#e67e22; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.75rem;">${healthCounts.warning} 待維護</span>` : ''}
                                ${healthCounts.missing > 0 ? `<span style="background:#999; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.75rem;">${healthCounts.missing} 未建立</span>` : ''}
                                <i class="fas fa-chevron-down" style="color:#666;"></i>
                            </div>
                        </div>
                        <div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #fafafa; font-size: 0.8rem; color: #666;">
                                        <th style="padding: 8px 12px; text-align: left;">表名</th>
                                        <th style="padding: 8px 12px; text-align: right;">筆數</th>
                                        <th style="padding: 8px 12px; text-align: right;">大小</th>
                                        <th style="padding: 8px 12px; text-align: right;">索引</th>
                                        <th style="padding: 8px 12px; text-align: right;">死元組 %</th>
                                        <th style="padding: 8px 12px; text-align: center;">狀態</th>
                                        <th style="padding: 8px 12px; text-align: center;">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tables.map(t => `
                                        <tr style="border-top: 1px solid #eee;">
                                            <td style="padding: 8px 12px;">
                                                <a href="#" onclick="event.preventDefault(); dbShowTableDetail('${esc(t.name)}')" style="color: #3A7CA5; text-decoration: none; font-family: monospace; font-size: 0.85rem;">${esc(t.name)}</a>
                                            </td>
                                            <td style="padding: 8px 12px; text-align: right; font-family: monospace;">${t.row_count >= 0 ? t.row_count.toLocaleString() : '<span style="color:#999">N/A</span>'}</td>
                                            <td style="padding: 8px 12px; text-align: right; font-family: monospace; font-size: 0.85rem;">${t.size_display || '-'}</td>
                                            <td style="padding: 8px 12px; text-align: right;">${t.index_count != null ? t.index_count : '-'}</td>
                                            <td style="padding: 8px 12px; text-align: right;">
                                                <span style="color: ${t.dead_ratio > 20 ? '#e67e22' : t.dead_ratio > 50 ? '#B22D20' : '#666'};">${t.dead_ratio != null ? t.dead_ratio + '%' : '-'}</span>
                                            </td>
                                            <td style="padding: 8px 12px; text-align: center;">
                                                <span style="background: ${healthColors[t.health] || '#999'}; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem;">${healthLabels[t.health] || t.health}</span>
                                            </td>
                                            <td style="padding: 8px 12px; text-align: center;">
                                                <div style="display: flex; gap: 4px; justify-content: center;">
                                                    <button onclick="dbVacuumTable('${esc(t.name)}')" class="btn" style="font-size: 0.7rem; padding: 2px 6px;" title="VACUUM ANALYZE">
                                                        <i class="fas fa-broom"></i>
                                                    </button>
                                                    <button onclick="dbReindexTable('${esc(t.name)}')" class="btn" style="font-size: 0.7rem; padding: 2px 6px;" title="重建索引">
                                                        <i class="fas fa-sort-amount-up"></i>
                                                    </button>
                                                    <button onclick="dbShowTableDetail('${esc(t.name)}')" class="btn" style="font-size: 0.7rem; padding: 2px 6px;" title="查看詳情">
                                                        <i class="fas fa-search"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>`;
            }

            container.innerHTML = html;

        } catch (e) {
            container.innerHTML = `<p style="text-align:center; color:#B22D20; padding:20px;">載入失敗: ${esc(e.message)}</p>`;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> 重新整理'; }
        }
    }
    window.dbRefreshOverview = dbRefreshOverview;

    async function dbShowTableDetail(tableName) {
        const modal = document.getElementById('db-table-detail-modal');
        const title = document.getElementById('db-detail-title');
        const content = document.getElementById('db-detail-content');
        if (!modal) return;
        modal.style.display = '';
        if (title) title.textContent = tableName;
        if (content) content.innerHTML = '<p style="text-align:center; padding:20px;">載入中…</p>';

        try {
            const data = await api.get(`/admin/db/table/${tableName}`);

            let html = `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
                    <div style="background:#f8f9fa; padding:12px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.8rem; color:#666;">筆數</div>
                        <div style="font-size:1.2rem; font-weight:bold;">${(data.row_count || 0).toLocaleString()}</div>
                    </div>
                    <div style="background:#f8f9fa; padding:12px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.8rem; color:#666;">磁碟用量</div>
                        <div style="font-size:1.2rem; font-weight:bold;">${data.size_display || '-'}</div>
                    </div>
                    <div style="background:#f8f9fa; padding:12px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.8rem; color:#666;">索引數</div>
                        <div style="font-size:1.2rem; font-weight:bold;">${(data.indexes || []).length}</div>
                    </div>
                </div>`;

            // 欄位結構
            html += `<h4 style="margin: 16px 0 8px;">欄位結構 (${(data.columns || []).length})</h4>
                <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                    <thead><tr style="background:#f0f0f0;">
                        <th style="padding:6px 10px; text-align:left;">欄位名</th>
                        <th style="padding:6px 10px; text-align:left;">型別</th>
                        <th style="padding:6px 10px; text-align:center;">Null</th>
                        <th style="padding:6px 10px; text-align:left;">預設</th>
                    </tr></thead>
                    <tbody>${(data.columns || []).map(c => `
                        <tr style="border-top:1px solid #eee;">
                            <td style="padding:4px 10px; font-family:monospace;">${esc(c.name)}</td>
                            <td style="padding:4px 10px; font-family:monospace; color:#3A7CA5;">${esc(c.type)}</td>
                            <td style="padding:4px 10px; text-align:center;">${c.nullable ? '✓' : '✗'}</td>
                            <td style="padding:4px 10px; font-size:0.8rem; color:#666;">${esc(c.default || '-')}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>`;

            // 外鍵
            if (data.foreign_keys && data.foreign_keys.length > 0) {
                html += `<h4 style="margin: 16px 0 8px;">外鍵關係</h4><ul style="font-size:0.85rem;">`;
                data.foreign_keys.forEach(fk => {
                    html += `<li><code>${esc(fk.column)}</code> → <code>${esc(fk.references_table)}.${esc(fk.references_column)}</code></li>`;
                });
                html += '</ul>';
            }

            // 索引
            if (data.indexes && data.indexes.length > 0) {
                html += `<h4 style="margin: 16px 0 8px;">索引 (${data.indexes.length})</h4>
                    <div style="font-size:0.8rem; font-family:monospace; background:#f5f5f3; padding:10px; border-radius:6px; max-height:200px; overflow-y:auto;">`;
                data.indexes.forEach(idx => {
                    html += `<div style="margin-bottom:4px;"><strong>${esc(idx.name)}</strong><br/><span style="color:#666;">${esc(idx.definition)}</span></div>`;
                });
                html += '</div>';
            }

            // 統計
            if (data.stats && Object.keys(data.stats).length > 0) {
                html += `<h4 style="margin: 16px 0 8px;">數值統計</h4>
                    <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                        <thead><tr style="background:#f0f0f0;">
                            <th style="padding:6px 10px;">欄位</th><th style="padding:6px 10px;">最小</th><th style="padding:6px 10px;">最大</th><th style="padding:6px 10px;">平均</th><th style="padding:6px 10px;">非 NULL</th>
                        </tr></thead><tbody>`;
                for (const [col, s] of Object.entries(data.stats)) {
                    html += `<tr style="border-top:1px solid #eee;">
                        <td style="padding:4px 10px; font-family:monospace;">${esc(col)}</td>
                        <td style="padding:4px 10px; text-align:right;">${s.min != null ? s.min : '-'}</td>
                        <td style="padding:4px 10px; text-align:right;">${s.max != null ? s.max : '-'}</td>
                        <td style="padding:4px 10px; text-align:right;">${s.avg != null ? s.avg : '-'}</td>
                        <td style="padding:4px 10px; text-align:right;">${s.non_null || 0}</td>
                    </tr>`;
                }
                html += '</tbody></table>';
            }

            // Preview
            if (data.preview && data.preview.length > 0) {
                const cols = Object.keys(data.preview[0]);
                html += `<h4 style="margin: 16px 0 8px;">最近 ${data.preview.length} 筆資料</h4>
                    <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                        <thead><tr style="background:#f0f0f0;">
                            ${cols.map(c => `<th style="padding:4px 8px; text-align:left; white-space:nowrap;">${esc(c)}</th>`).join('')}
                        </tr></thead><tbody>`;
                data.preview.forEach(row => {
                    html += '<tr style="border-top:1px solid #eee;">';
                    cols.forEach(c => {
                        let val = row[c];
                        if (val && typeof val === 'object') val = JSON.stringify(val).substring(0, 80);
                        if (val && String(val).length > 60) val = String(val).substring(0, 60) + '…';
                        html += `<td style="padding:4px 8px; white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${esc(String(val || ''))}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
            }

            // 操作按鈕
            html += `<div style="display:flex; gap:8px; margin-top:20px; padding-top:16px; border-top:1px solid #eee;">
                <button class="btn btn-primary" onclick="dbVacuumTable('${esc(tableName)}')"><i class="fas fa-broom"></i> VACUUM</button>
                <button class="btn" onclick="dbVacuumTable('${esc(tableName)}', true)" style="background:#e67e22; color:#fff;"><i class="fas fa-compress-arrows-alt"></i> VACUUM FULL</button>
                <button class="btn" onclick="dbReindexTable('${esc(tableName)}')"><i class="fas fa-sort-amount-up"></i> 重建索引</button>
            </div>`;

            content.innerHTML = html;

        } catch (e) {
            content.innerHTML = `<p style="color:#B22D20;">載入失敗: ${esc(e.message)}</p>`;
        }
    }
    window.dbShowTableDetail = dbShowTableDetail;

    async function dbVacuumTable(tableName, full) {
        if (!confirm(`確定要對 ${tableName} 執行 VACUUM${full ? ' FULL' : ''} ？`)) return;
        try {
            const result = await api.post(`/admin/db/vacuum/${tableName}`, { full: !!full, analyze: true });
            Toast.success(result.message || `${tableName} VACUUM 完成`);
            dbRefreshOverview();
        } catch (e) {
            Toast.error('VACUUM 失敗: ' + e.message);
        }
    }
    window.dbVacuumTable = dbVacuumTable;

    async function dbReindexTable(tableName) {
        if (!confirm(`確定要重建 ${tableName} 的索引？`)) return;
        try {
            const result = await api.post(`/admin/db/reindex/${tableName}`, {});
            Toast.success(result.message || `${tableName} 索引重建完成`);
            dbRefreshOverview();
        } catch (e) {
            Toast.error('索引重建失敗: ' + e.message);
        }
    }
    window.dbReindexTable = dbReindexTable;

    async function dbRepairAll() {
        if (!confirm('確定要執行全域修復？將對所有表進行 VACUUM ANALYZE。')) return;
        const btn = document.getElementById('btn-db-repair');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 修復中…'; }
        try {
            const result = await api.post('/admin/db/repair', {});
            Toast.success(result.message || '全域修復完成');
            dbRefreshOverview();
        } catch (e) {
            Toast.error('修復失敗: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wrench"></i> 全域修復'; }
        }
    }
    window.dbRepairAll = dbRepairAll;

    async function dbRunMigration() {
        if (!confirm('確定要執行 Schema 遷移？將建立缺失的表並補齊欄位。')) return;
        const btn = document.getElementById('btn-db-migrate');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 遷移中…'; }
        try {
            const result = await api.post('/admin/db/migrate', {});
            Toast.success(result.message || 'Schema 遷移完成');
            dbRefreshOverview();
        } catch (e) {
            Toast.error('遷移失敗: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-database"></i> Schema 遷移'; }
        }
    }
    window.dbRunMigration = dbRunMigration;

    async function dbShowConnections() {
        const modal = document.getElementById('db-connections-modal');
        const content = document.getElementById('db-connections-content');
        if (!modal) return;
        modal.style.display = '';
        content.innerHTML = '<p style="text-align:center; padding:20px;">載入中…</p>';

        try {
            const data = await api.get('/admin/db/connections');
            const pool = data.pool || {};
            let html = `
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
                    <div style="background:#f8f9fa; padding:10px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.75rem; color:#666;">Pool 大小</div>
                        <div style="font-size:1.1rem; font-weight:bold;">${pool.pool_size || 0}</div>
                    </div>
                    <div style="background:#f8f9fa; padding:10px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.75rem; color:#666;">使用中</div>
                        <div style="font-size:1.1rem; font-weight:bold; color:#e67e22;">${pool.checked_out || 0}</div>
                    </div>
                    <div style="background:#f8f9fa; padding:10px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.75rem; color:#666;">閒置</div>
                        <div style="font-size:1.1rem; font-weight:bold; color:#2A7F3B;">${pool.checked_in || 0}</div>
                    </div>
                    <div style="background:#f8f9fa; padding:10px; border-radius:6px; text-align:center;">
                        <div style="font-size:0.75rem; color:#666;">Overflow</div>
                        <div style="font-size:1.1rem; font-weight:bold;">${pool.overflow || 0} / ${pool.max_overflow || 0}</div>
                    </div>
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                    <thead><tr style="background:#f0f0f0;">
                        <th style="padding:6px 8px;">PID</th>
                        <th style="padding:6px 8px;">使用者</th>
                        <th style="padding:6px 8px;">來源</th>
                        <th style="padding:6px 8px;">狀態</th>
                        <th style="padding:6px 8px;">查詢</th>
                        <th style="padding:6px 8px;">操作</th>
                    </tr></thead>
                    <tbody>`;

            (data.active_connections || []).forEach(c => {
                const stateColor = c.state === 'active' ? '#2A7F3B' : c.state === 'idle' ? '#666' : '#e67e22';
                html += `<tr style="border-top:1px solid #eee;">
                    <td style="padding:4px 8px; font-family:monospace;">${c.pid}</td>
                    <td style="padding:4px 8px;">${esc(c.user || '-')}</td>
                    <td style="padding:4px 8px; font-size:0.75rem;">${esc(c.client_addr || '-')}</td>
                    <td style="padding:4px 8px;"><span style="color:${stateColor};">${esc(c.state || '-')}</span></td>
                    <td style="padding:4px 8px; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.75rem;" title="${esc(c.query || '')}">${esc((c.query || '').substring(0, 80))}</td>
                    <td style="padding:4px 8px;"><button onclick="dbKillConnection(${c.pid})" class="btn" style="font-size:0.65rem; padding:1px 4px; color:#B22D20;" title="終止">✕</button></td>
                </tr>`;
            });
            html += '</tbody></table>';
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = `<p style="color:#B22D20;">載入失敗: ${esc(e.message)}</p>`;
        }
    }
    window.dbShowConnections = dbShowConnections;

    async function dbKillConnection(pid) {
        if (!confirm(`確定要終止連線 PID ${pid}？`)) return;
        try {
            const result = await api.post(`/admin/db/kill-connection/${pid}`, {});
            Toast.success(result.message || `連線 ${pid} 已終止`);
            dbShowConnections();
        } catch (e) {
            Toast.error('終止失敗: ' + e.message);
        }
    }
    window.dbKillConnection = dbKillConnection;

    async function dbShowSlowQueries() {
        try {
            const data = await api.get('/admin/db/slow-queries');
            const queries = data.slow_queries || [];
            if (queries.length === 0) {
                Toast.success('目前沒有慢查詢');
                return;
            }
            let msg = `發現 ${queries.length} 個活躍慢查詢:\n`;
            queries.forEach(q => { msg += `\nPID ${q.pid} (${q.duration}): ${(q.query || '').substring(0, 100)}`; });
            alert(msg);
        } catch (e) {
            Toast.error('查詢失敗: ' + e.message);
        }
    }
    window.dbShowSlowQueries = dbShowSlowQueries;

    function _fmtSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
