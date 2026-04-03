/**
 * BEDROCK 磐石 — Cytoscape.js 設定
 * 圖表視覺化和布局配置
 */

const CYTOSCAPE_CONFIG = {
    // 計算節點大小基於資本額（log scale）
    calculateNodeSize: function(capital) {
        if (!capital || capital <= 0) return 60; // 預設大小
        // 以資本額的 log scale 計算，範圍 40-150px
        const minSize = 40;
        const maxSize = 150;
        const minCapital = 1;        // 最小資本額為 1
        const maxCapital = 1000000000; // 最大資本額為 10 億
        const logCapital = Math.log(Math.max(capital, minCapital));
        const logMin = Math.log(minCapital);
        const logMax = Math.log(maxCapital);
        const normalizedLog = (logCapital - logMin) / (logMax - logMin);
        return minSize + normalizedLog * (maxSize - minSize);
    },

    // 節點顏色主題
    colors: {
        company: '#3b82f6',        // 公司 - 藍色
        person: '#8b5cf6',          // 人員 - 紫色
        address: '#f59e0b',         // 地址 - 黃色
        dissolved: '#6b7280',       // 已解散 - 灰色
        redFlag: '#ef4444',         // 紅旗 - 紅色
        adverseMedia: '#f97316',    // 負面新聞 - 橙色
    },

    // 邊線樣式主題（色盲友善）
    edgeStyles: {
        director: {
            color: '#1B4965',       // 深藍
            lineStyle: 'solid',
            linePattern: null,
            label: '董事'
        },
        chairman: {
            color: '#C41E3A',       // 深紅
            lineStyle: 'solid',
            linePattern: null,
            label: '主席'
        },
        supervisor: {
            color: '#F08030',       // 橙色
            lineStyle: 'dashed',
            linePattern: [5, 4],
            label: '監察人'
        },
        shareholder: {
            color: '#6B8E23',       // 橄欖綠
            lineStyle: 'dotted',
            linePattern: [2, 3],
            label: '股東'
        },
        representative: {
            color: '#800080',       // 紫色
            lineStyle: 'solid',
            linePattern: null,
            label: '法人代表'
        },
        sameAddress: {
            color: '#888888',       // 灰色
            lineStyle: 'dotted',
            linePattern: [2, 3],
            label: '同地址'
        },
    },

    // 節點樣式
    nodeStyle: [
        {
            selector: 'node',
            style: {
                'width': 'data(size)',
                'height': 'data(size)',
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': '11px',
                'min-zoomed-font-size': 8,
                'color': '#f8fafc',
                'font-weight': 'bold',
                'border-width': 2,
                'border-color': '#334155',
                'background-color': '#3b82f6',
                'text-wrap': 'wrap',
                'text-max-width': '80%',
                'padding': '10px',
            }
        },
        // 公司節點
        {
            selector: 'node[type="company"]',
            style: {
                'shape': 'round-rectangle',
                'background-color': CYTOSCAPE_CONFIG.colors.company,
            }
        },
        // 人員節點
        {
            selector: 'node[type="person"]',
            style: {
                'shape': 'circle',
                'background-color': CYTOSCAPE_CONFIG.colors.person,
            }
        },
        // 地址節點
        {
            selector: 'node[type="address"]',
            style: {
                'shape': 'hexagon',
                'background-color': CYTOSCAPE_CONFIG.colors.address,
            }
        },
        // 已解散節點
        {
            selector: 'node[status="dissolved"]',
            style: {
                'background-color': CYTOSCAPE_CONFIG.colors.dissolved,
                'opacity': 0.6,
            }
        },
        // 紅旗節點
        {
            selector: 'node[redFlag=true]',
            style: {
                'border-color': CYTOSCAPE_CONFIG.colors.redFlag,
                'border-width': 3,
                'box-shadow': `0 0 0 2px ${CYTOSCAPE_CONFIG.colors.redFlag}`,
                'box-shadow-blur': 8,
                'box-shadow-spread': 2,
            }
        },
        // 負面新聞節點
        {
            selector: 'node[adverseMedia=true]',
            style: {
                'border-color': CYTOSCAPE_CONFIG.colors.adverseMedia,
                'border-width': 3,
                'box-shadow': `0 0 0 2px ${CYTOSCAPE_CONFIG.colors.adverseMedia}`,
                'box-shadow-blur': 8,
                'box-shadow-spread': 2,
            }
        },
        // 選中節點
        {
            selector: 'node:selected',
            style: {
                'border-width': 3,
                'border-color': '#fbbf24',
                'box-shadow': '0 0 0 2px #fbbf24',
                'box-shadow-blur': 12,
                'box-shadow-spread': 4,
            }
        },
        // 複合節點（集群）
        {
            selector: 'node[isCluster=true]',
            style: {
                'shape': 'rectangle',
                'background-opacity': 0.1,
                'border-width': 2,
                'border-style': 'dashed',
                'border-color': '#3b82f6',
                'text-opacity': 0.8,
            }
        },
    ],

    // 邊線樣式（色盲友善）
    edgeStyle: [
        {
            selector: 'edge',
            style: {
                'width': 2,
                'line-color': '#94a3b8',
                'target-arrow-color': '#94a3b8',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'label': 'data(relationshipType)',
                'font-size': '10px',
                'color': '#94a3b8',
                'text-background-color': '#1e293b',
                'text-background-opacity': 0.8,
                'text-background-padding': '2px',
                'text-margin-y': -12,
            }
        },
        // 董事關係
        {
            selector: 'edge[relationshipType="director"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.director.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.director.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.director.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.director.lineStyle,
            }
        },
        // 主席關係
        {
            selector: 'edge[relationshipType="chairman"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.chairman.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.chairman.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.chairman.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.chairman.lineStyle,
                'width': 3,
            }
        },
        // 監察人關係
        {
            selector: 'edge[relationshipType="supervisor"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.supervisor.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.supervisor.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.supervisor.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.supervisor.lineStyle,
            }
        },
        // 股東關係
        {
            selector: 'edge[relationshipType="shareholder"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.shareholder.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.shareholder.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.shareholder.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.shareholder.lineStyle,
            }
        },
        // 法人代表關係
        {
            selector: 'edge[relationshipType="representative"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.representative.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.representative.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.representative.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.representative.lineStyle,
            }
        },
        // 同地址關係
        {
            selector: 'edge[relationshipType="sameAddress"]',
            style: {
                'line-color': CYTOSCAPE_CONFIG.edgeStyles.sameAddress.color,
                'target-arrow-color': CYTOSCAPE_CONFIG.edgeStyles.sameAddress.color,
                'color': CYTOSCAPE_CONFIG.edgeStyles.sameAddress.color,
                'line-style': CYTOSCAPE_CONFIG.edgeStyles.sameAddress.lineStyle,
                'width': 1.5,
            }
        },
        // 選中邊線
        {
            selector: 'edge:selected',
            style: {
                'line-color': '#fbbf24',
                'target-arrow-color': '#fbbf24',
                'color': '#fbbf24',
                'width': 3,
            }
        },
    ],

    // 布局配置（改善 #3：fit: false，nodeSpacing: 30，min-zoomed-font-size: 8）
    layouts: {
        cola: {
            name: 'cola',
            directed: true,
            animate: true,
            animationDuration: 500,
            randomize: false,
            maxSimulationTime: 4000,
            ungrabifyWhileSimulating: false,
            fit: false,
            padding: 20,
            nodeSpacing: 30,
            flowDirection: 'down',
            alignment: 'vertical',
        },

        cose: {
            name: 'cose',
            directed: true,
            animate: true,
            animationDuration: 500,
            avoidOverlap: true,
            avoidOverlapPadding: 20,
            nodeSpacing: 30,
            fit: false,
            padding: 20,
            randomize: false,
        },

        grid: {
            name: 'grid',
            directed: true,
            animate: true,
            animationDuration: 500,
            fit: false,
            padding: 20,
            rows: undefined,
            cols: undefined,
        },
    },

    // 初始化 Cytoscape 實例
    init: function(containerId, elements = []) {
        try {
            // 註冊 Cola 布局
            cytoscape.use(cola);

            const cy = cytoscape({
                container: document.getElementById(containerId),
                style: this.nodeStyle.concat(this.edgeStyle),
                elements: elements,
                wheelSensitivity: 0.1,
                pixelRatio: 'auto',
                motionBlur: false,
                selectionType: 'single',
                touchTapThreshold: 8,
                desktopTapThreshold: 4,
                autolock: false,
                autoungrabify: false,
                autounselectify: false,
                styleEnabled: true,
                hideEdgesOnViewport: false,
                hideLabelsOnViewport: false,
                textureOnViewport: false,
                boxSelectionEnabled: false,
                panningEnabled: true,
                userPanningEnabled: true,
                zoomingEnabled: true,
                userZoomingEnabled: true,
                minZoom: 0.1,
                maxZoom: 5,
            });

            return cy;
        } catch (error) {
            console.error('[CYTOSCAPE] 初始化失敗:', error);
            return null;
        }
    },

    // 應用布局
    applyLayout: function(cy, layoutName = 'cola') {
        if (!cy || !this.layouts[layoutName]) {
            console.warn('[CYTOSCAPE] 無效的布局名稱:', layoutName);
            return;
        }

        const layout = cy.layout(this.layouts[layoutName]);
        layout.run();
    },

    // 高亮節點
    highlightNode: function(cy, nodeId) {
        cy.elements().removeClass('highlighted');
        const node = cy.getElementById(nodeId);
        if (node.nonempty()) {
            node.addClass('highlighted');
            cy.animate({
                fit: {
                    eles: node,
                    padding: 50,
                }
            }, { duration: 300 });
        }
    },

    // 縮放到適配視圖
    fitView: function(cy) {
        cy.fit(undefined, 50);
    },

    // 放大
    zoomIn: function(cy) {
        cy.zoom(cy.zoom() * 1.2);
    },

    // 縮小
    zoomOut: function(cy) {
        cy.zoom(cy.zoom() / 1.2);
    },

    // 匯出圖片
    exportImage: function(cy, filename = 'bedrock-graph.png') {
        try {
            const png = cy.png({ full: true, scale: 2 });
            const link = document.createElement('a');
            link.href = png;
            link.download = filename;
            link.click();
        } catch (error) {
            console.error('[CYTOSCAPE] 匯出圖片失敗:', error);
        }
    },

    // 獲取節點的隣接節點
    getNeighbors: function(cy, nodeId) {
        const node = cy.getElementById(nodeId);
        return node.neighbors().union(node);
    },

    // 隱藏元素
    hideElements: function(cy, selector) {
        cy.elements(selector).hide();
    },

    // 顯示元素
    showElements: function(cy, selector) {
        cy.elements(selector).show();
    },

    // 獲取選中節點
    getSelectedNode: function(cy) {
        const selected = cy.$(':selected');
        return selected.length > 0 ? selected[0] : null;
    },

    // 清除選擇
    clearSelection: function(cy) {
        cy.elements().unselect();
    },

    // 從 JSON 生成元素
    generateElements: function(nodesData, edgesData) {
        const elements = [];

        // 添加節點
        if (nodesData && Array.isArray(nodesData)) {
            nodesData.forEach(node => {
                // 計算節點大小（基於資本額）
                const capital = node.capital || 0;
                const size = this.calculateNodeSize(capital);
                const capitalDisplay = capital > 0
                    ? (capital >= 1000000
                        ? (capital / 1000000).toFixed(1) + '百萬'
                        : capital.toLocaleString())
                    : '未知';

                elements.push({
                    data: {
                        id: node.id,
                        label: node.label || node.id,
                        type: node.type,
                        status: node.status,
                        redFlag: node.redFlag || false,
                        adverseMedia: node.adverseMedia || false,
                        size: size,
                        capital: capital,
                        capitalDisplay: capitalDisplay,
                        ...node.data,
                    }
                });
            });
        }

        // 添加邊線
        if (edgesData && Array.isArray(edgesData)) {
            edgesData.forEach(edge => {
                elements.push({
                    data: {
                        id: edge.id || `${edge.source}-${edge.target}`,
                        source: edge.source,
                        target: edge.target,
                        relationshipType: edge.relationshipType || 'related',
                        ...edge.data,
                    }
                });
            });
        }

        return elements;
    },
};
