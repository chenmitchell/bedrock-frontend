/**
 * BEDROCK 磐石 — Canvas 網路圖背景
 * 登入頁與歡迎頁的動態粒子網路背景
 * 滑鼠懸停時產生「手電筒」照亮效果
 *
 * 設計參數：
 *   節點：3-5px 圓點，白色 15% 透明度
 *   連線：0.5px，白色 6% 透明度
 *   手電筒半徑：150px，照亮至 40%
 *   漸入 0.3s，漸出 0.8s（拖尾效果）
 */

(function () {
    'use strict';

    // ===== 配置 =====
    const CONFIG = {
        // 節點
        nodeCount: 80,          // 粒子數量
        nodeMinSize: 1.5,       // 最小半徑
        nodeMaxSize: 2.5,       // 最大半徑
        nodeBaseAlpha: 0.15,    // 基礎透明度
        nodeGlowAlpha: 0.45,   // 照亮透明度
        nodeColor: '255,255,255',

        // 連線
        linkDistance: 140,      // 最大連線距離
        linkBaseAlpha: 0.06,    // 基礎透明度
        linkGlowAlpha: 0.2,    // 照亮透明度
        linkWidth: 0.5,

        // 手電筒
        flashlightRadius: 150,
        fadeInSpeed: 0.08,      // 每幀漸入量（~0.3s @ 60fps → 1/18 ≈ 0.055，用 0.08 稍快）
        fadeOutSpeed: 0.02,     // 每幀漸出量（~0.8s → 1/48 ≈ 0.02）

        // 移動
        speed: 0.3,             // 最大漂移速度
        mouseRepel: false,      // 是否滑鼠排斥
    };

    // 歡迎頁特有配置覆蓋
    const WELCOME_CONFIG = {
        nodeCount: 50,
        nodeBaseAlpha: 0.08,
        nodeGlowAlpha: 0.25,
        linkBaseAlpha: 0.03,
        linkGlowAlpha: 0.1,
        nodeColor: '60,60,58',  // 暗棕色調（配合暖色主題）
        flashlightRadius: 120,
    };

    // ===== 工具 =====
    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    // ===== NetworkCanvas 類別 =====
    class NetworkCanvas {
        constructor(canvasId, overrides) {
            this.canvas = document.getElementById(canvasId);
            if (!this.canvas) return;

            this.ctx = this.canvas.getContext('2d');
            this.cfg = Object.assign({}, CONFIG, overrides || {});
            this.nodes = [];
            this.mouse = { x: -9999, y: -9999 };
            this.animId = null;
            this.active = false;

            this._resize = this.resize.bind(this);
            this._mouseMove = this.onMouseMove.bind(this);
            this._mouseLeave = this.onMouseLeave.bind(this);
        }

        init() {
            if (!this.canvas) return;

            this.resize();
            this.createNodes();
            this.bindEvents();
            this.active = true;
            this.loop();
        }

        destroy() {
            this.active = false;
            if (this.animId) cancelAnimationFrame(this.animId);
            window.removeEventListener('resize', this._resize);
            this.canvas.removeEventListener('mousemove', this._mouseMove);
            this.canvas.removeEventListener('mouseleave', this._mouseLeave);
        }

        resize() {
            if (!this.canvas || !this.canvas.parentElement) return;
            const rect = this.canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.w = rect.width;
            this.h = rect.height;
            this.canvas.width = this.w * dpr;
            this.canvas.height = this.h * dpr;
            this.canvas.style.width = this.w + 'px';
            this.canvas.style.height = this.h + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        createNodes() {
            this.nodes = [];
            for (let i = 0; i < this.cfg.nodeCount; i++) {
                this.nodes.push({
                    x: rand(0, this.w),
                    y: rand(0, this.h),
                    vx: rand(-this.cfg.speed, this.cfg.speed),
                    vy: rand(-this.cfg.speed, this.cfg.speed),
                    r: rand(this.cfg.nodeMinSize, this.cfg.nodeMaxSize),
                    glow: 0,  // 0 = dim, 1 = full glow
                });
            }
        }

        bindEvents() {
            window.addEventListener('resize', this._resize);
            this.canvas.addEventListener('mousemove', this._mouseMove);
            this.canvas.addEventListener('mouseleave', this._mouseLeave);
        }

        onMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        }

        onMouseLeave() {
            this.mouse.x = -9999;
            this.mouse.y = -9999;
        }

        update() {
            const { w, h, cfg, nodes, mouse } = this;
            const r2 = cfg.flashlightRadius * cfg.flashlightRadius;

            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];

                // 移動
                n.x += n.vx;
                n.y += n.vy;

                // 邊界反彈
                if (n.x < 0 || n.x > w) n.vx *= -1;
                if (n.y < 0 || n.y > h) n.vy *= -1;
                n.x = Math.max(0, Math.min(w, n.x));
                n.y = Math.max(0, Math.min(h, n.y));

                // 手電筒亮度
                const dx = n.x - mouse.x;
                const dy = n.y - mouse.y;
                const dist2 = dx * dx + dy * dy;
                const inLight = dist2 < r2;

                if (inLight) {
                    const factor = 1 - Math.sqrt(dist2) / cfg.flashlightRadius;
                    const target = factor;
                    n.glow += (target - n.glow) * cfg.fadeInSpeed * 4;
                    if (n.glow > target) n.glow = target;
                } else {
                    n.glow -= cfg.fadeOutSpeed;
                    if (n.glow < 0) n.glow = 0;
                }
            }
        }

        draw() {
            const { ctx, w, h, cfg, nodes } = this;
            ctx.clearRect(0, 0, w, h);

            // 連線
            ctx.lineWidth = cfg.linkWidth;
            const linkDist2 = cfg.linkDistance * cfg.linkDistance;

            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i];
                    const b = nodes[j];
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const dist2 = dx * dx + dy * dy;

                    if (dist2 < linkDist2) {
                        const proximity = 1 - Math.sqrt(dist2) / cfg.linkDistance;
                        const glow = Math.max(a.glow, b.glow);
                        const alpha = cfg.linkBaseAlpha + (cfg.linkGlowAlpha - cfg.linkBaseAlpha) * glow;

                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.strokeStyle = `rgba(${cfg.nodeColor},${alpha * proximity})`;
                        ctx.stroke();
                    }
                }
            }

            // 節點
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const alpha = cfg.nodeBaseAlpha + (cfg.nodeGlowAlpha - cfg.nodeBaseAlpha) * n.glow;

                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${cfg.nodeColor},${alpha})`;
                ctx.fill();
            }
        }

        loop() {
            if (!this.active) return;
            this.update();
            this.draw();
            this.animId = requestAnimationFrame(() => this.loop());
        }
    }

    // ===== 全域暴露 =====
    window.NetworkCanvas = NetworkCanvas;

    // ===== 自動初始化登入頁 canvas =====
    function initLoginCanvas() {
        const loginCanvas = new NetworkCanvas('network-canvas');
        loginCanvas.init();
        window._bedrockLoginCanvas = loginCanvas;
    }

    function initWelcomeCanvas() {
        const welcomeCanvas = new NetworkCanvas('welcome-network-canvas', WELCOME_CONFIG);
        welcomeCanvas.init();
        window._bedrockWelcomeCanvas = welcomeCanvas;
    }

    // DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initLoginCanvas();
            initWelcomeCanvas();
        });
    } else {
        initLoginCanvas();
        initWelcomeCanvas();
    }
})();
