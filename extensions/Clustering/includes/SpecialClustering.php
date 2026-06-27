<?php
class SpecialClustering extends SpecialPage {

    public function __construct() {
        parent::__construct( 'Clustering' );
    }

    public function execute( $subPage ) {
        $out = $this->getOutput();
        $out->setPageTitle( '' ); 
        $out->addModules( 'ext.clustering' );
        $out->addHTML( $this->buildForm() );
    }

    private function buildForm() {
        return <<<HTML
        <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <style>
            .clustering-sidebar .menu-label {
                font-size: 13px !important;
                font-weight: 700 !important;
                color: #94a3b8 !important;
                margin-top: 26px !important;
                margin-bottom: 14px !important;
                letter-spacing: 0.06em !important;
                text-transform: uppercase !important;
            }
            .clustering-sidebar .clustering-menu .menu-item {
                font-size: 15px !important;
                font-weight: 600 !important;
                padding: 13px 18px !important; 
                margin-bottom: 8px !important; 
                border-radius: 8px !important;
                transition: all 0.2s ease-in-out !important;
                display: flex !important;
                align-items: center !important;
                min-height: 48px !important;
            }
            .clustering-sidebar .clustering-menu .menu-item .step-circle {
                width: 26px !important; 
                height: 26px !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                margin-right: 12px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 50% !important;
            }
            .clustering-sidebar .clustering-menu .submenu {
                padding: 0 !important;
                margin: 0 !important;
                list-style: none !important;
            }
            .clustering-sidebar .clustering-menu .submenu li {
                font-size: 14px !important;
                font-weight: 500 !important;
                padding: 11px 18px 11px 56px !important; 
                margin-top: 4px !important;
                border-radius: 6px !important;
                list-style: none !important;
            }
            .clustering-sidebar .btn-new-session {
                padding: 13px 20px !important; 
                font-size: 15px !important;
                font-weight: 600 !important;
                border-radius: 8px !important;
                margin-bottom: 20px !important;
            }

            #view-preprocess.active {
                display: flex !important;
                flex-direction: column !important;
                min-height: calc(100vh - 140px) !important; 
            }
            #view-preprocess .ml-layout {
                display: flex !important;
                align-items: stretch !important; 
                flex: 1 !important;
                gap: 20px !important;
            }
            #view-preprocess .ml-config-panel {
                width: 380px !important; 
                display: flex !important;
                flex-direction: column !important;
            }
            #view-preprocess .ml-config-content {
                padding: 28px 24px !important; 
                flex: 1 !important;
            }
            #view-preprocess .form-group {
                margin-bottom: 30px !important; 
            }
            #view-preprocess .form-group label {
                display: block !important;
                margin-bottom: 12px !important; 
                font-size: 14px !important;
                font-weight: 600 !important;
                color: #475569 !important;
            }
            #view-preprocess .form-control {
                height: 46px !important; 
                padding: 10px 14px !important;
                font-size: 14px !important;
                border-radius: 6px !important;
            }
            #view-preprocess #btnApplyFilter {
                margin-top: 15px !important; 
                padding: 13px 24px !important; 
                font-size: 15px !important;
                font-weight: 600 !important;
                border-radius: 8px !important;
            }
            #view-preprocess .ml-results-panel {
                display: flex !important;
                flex-direction: column !important;
                flex: 1 !important;
            }
            #view-preprocess .result-card {
                display: flex !important;
                flex-direction: column !important;
                flex: 1 !important; 
                margin-top: 0 !important;
                padding: 24px !important;
            }
            #view-preprocess .preprocess-table-container {
                flex: 1 !important; 
                overflow-y: auto !important; 
                overflow-x: auto !important; 
                border: 1px solid #e2e8f0 !important;
                border-radius: 8px !important;
                background: #ffffff !important;
                margin-top: 12px !important;
            }
        </style>
        
        <div id="clustering-app">
            
            <aside class="clustering-sidebar">
                <div class="clustering-logo">
                    <span style="font-size: 24px;"></span> Clustering 
                </div>
                
                <button class="btn-new-session">+ New Session</button>
                
                <div class="menu-label">ML WORKFLOW</div>
                <ul class="clustering-menu">
                    <li><div class="menu-item active" data-nav="dataloader"><div class="step-circle">1</div><span> Data Loader</span></div></li>
                    <li><div class="menu-item" data-nav="preprocess"><div class="step-circle"> 2 </div><span> Preprocess</span></div></li>
                    <li>
                        <div class="menu-item"><div class="step-circle">3</div><span> ML Task</span><span class="menu-arrow">▼</span></div>
                        <ul class="submenu"><li data-nav="clustering">Clustering (Gom cụm)</li></ul>
                    </li>
                </ul>
            </aside>

            <main class="clustering-main">
                
                <header class="clustering-topbar">
                    <div class="topbar-left">
                        <span id="btn-toggle-sidebar" style="cursor:pointer; padding-right: 8px; font-weight: bold; font-size: 16px;">❮</span> 
                        <span id="current-step-title"> Data Loader</span>
                    </div>
                    <div class="topbar-right">
                        <input type="file" id="fileInput" accept=".csv, .xlsx, .xls" style="display:none">
                        <div id="fileBadge" style="display: none; background: #e0e7ff; color: #4338ca; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid #c7d2fe; align-items: center; gap: 6px;">
                            🗄️ <span id="fileName"></span>
                        </div>
                    </div>
                </header>

                <div class="clustering-content">
                    
                    <div id="view-dataloader" class="view-section active">
                        <style>
                            #empty-dataloader { transition: all 0.2s ease-in-out; }
                            #empty-dataloader:hover { border-color: #6366f1 !important; background-color: #f8fafc !important; }
                        </style>
                        <div id="empty-dataloader-wrapper" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; min-height: 70vh;">
                            <div id="empty-dataloader" style="width: 100%; max-width: 650px; padding: 60px 20px; display: flex; flex-direction: column; align-items: center; border: 2px dashed #cbd5e1; background: #ffffff; border-radius: 12px; cursor: pointer;">
                                <div style="color: #6366f1; margin-bottom: 24px;"><svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></div>
                                <h3 style="color: #1e293b; margin-bottom: 8px; font-size: 26px; font-weight: 700;">Upload Your Dataset</h3>
                                <p style="color: #64748b; font-size: 13px; font-weight: 500; margin-bottom: 24px; text-align: center;">Hỗ trợ các định dạng tệp tin Excel (.xlsx, .xls) và CSV (.csv)</p>
                                <button id="btnUploadCenter" style="background: #6366f1; color: white; border: none; padding: 14px 40px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;">Choose File</button>
                            </div>
                        </div>

                        <div id="dataloader-content" style="display: none;">
                            <div id="alert-container"></div>
                            <div class="clustering-tabs">
                                <div class="clustering-tab active" data-tab="tab-overview"> Overview </div>
                                <div class="clustering-tab" data-tab="tab-preview"> Data Preview </div>
                                <div class="clustering-tab" data-tab="tab-visualization"> Visualization </div>
                            </div>
                            <div id="tab-overview" class="tab-pane" style="display: block;">
                                <div class="overview-grid">
                                    <div class="stat-card"><div class="stat-icon">🗄️</div><div><div class="stat-val" id="st-rows">0</div><div class="stat-label">Instances</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#3b82f6; background:#eff6ff;">🪟</div><div><div class="stat-val" id="st-cols">0</div><div class="stat-label">Attributes</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#059669; background:#ecfdf5;">🔢</div><div><div class="stat-val" id="st-num">0</div><div class="stat-label">Numeric</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#c026d3; background:#fdf4ff;">🔤</div><div><div class="stat-val" id="st-cat">0</div><div class="stat-label">Categorical</div></div></div>
                                </div>
                                <div class="overview-grid" style="grid-template-columns: repeat(3, 1fr);">
                                    <div class="stat-card"><div class="stat-icon" style="color:#d97706; background:#fffbeb;">⚠️</div><div><div class="stat-val" id="st-missing">0</div><div class="stat-label">Missing Values</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#ef4444; background:#fef2f2;">⚠️</div><div><div class="stat-val" id="st-outliers">0</div><div class="stat-label">Outliers Detected</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#059669; background:#ecfdf5;">ℹ️</div><div><div class="stat-val" id="st-duplicates">0</div><div class="stat-label">Duplicate Rows</div></div></div>
                                </div>
                                <div style="display: grid; grid-template-columns: 6fr 4fr; gap: 24px; margin-top: 24px;">
                                    <div class="preview-card" style="padding: 24px;">
                                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 24px; color: var(--text-dark);"><span style="color: #3b82f6;">📊</span> Class Distribution</div>
                                        <div style="width: 100%; height: 260px;"><canvas id="classDistChart" width="600" height="260" style="width: 100%; height: 100%;"></canvas></div>
                                    </div>
                                    <div class="preview-card" style="padding: 24px; display: flex; text-align: left; flex-direction: column; max-height: 360px;">
                                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 16px; color: var(--text-dark);"><span style="color: var(--success);">🗄️</span> Statistics Summary</div>
                                        <div id="stats-summary-list" style="flex: 1; overflow-y: auto; padding-right: 8px;"></div>
                                    </div>
                                </div>
                            </div>
                            <div id="tab-preview" class="tab-pane" style="display: none;">
                                <div class="preview-card"><div style="overflow-x: auto;"><table class="clustering-table" id="preview-table"><thead><tr><th>Đang tải...</th></tr></thead><tbody></tbody></table></div></div>
                            </div>
                            <div id="tab-visualization" class="tab-pane" style="display: none;">
                                <div class="vis-grid" id="vis-container"></div>
                            </div>
                        </div> 
                    </div> 
                    
                    <div id="view-preprocess" class="view-section">
                        <div class="ml-task-header"><strong>Filter:</strong> Chọn bộ lọc để làm sạch và biến đổi dữ liệu trước khi chạy ML</div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 350px; margin-top: 0; display: flex; flex-direction: column;">
                                <div class="ml-config-content" style="flex: 1; text-align: left;">
                                    <h3>Choose Filter</h3>
                                    <div class="form-group">
                                        <label>Hành động (Filter Type)</label>
                                        <select id="filter-type" class="form-control">
                                            <option value="remove-missing">Remove Missing Values</option>
                                            <option value="replace-mean">Replace Missing with Mean</option>
                                            <option value="drop-col">Remove Attribute</option>
                                            <option value="remove-duplicates">Remove Duplicates</option>
                                            <option value="remove-outliers">Remove Outliers (IQR) - Xóa dòng</option>
                                            <option value="winsorize-outliers">Winsorize Outliers (IQR Capping) - Giữ dòng</option>
                                            <option value="normalize-minmax">Normalize (Min-Max)</option>
                                            <option value="standardize-zscore">Standardize (Z-score)</option>
                                            <option value="normalize-robust">Robust Scale (Median/IQR) - Chuẩn hóa bền vững</option>
                                        </select>
                                    </div>
                                    <div class="form-group" id="filter-col-group" style="display:none;">
                                        <select id="filter-col-select" class="form-control"></select>
                                    </div>
                                    <button class="btn-run-green" id="btnApplyFilter">⚡ Apply Filter</button>
                                </div>
                            </div>
                            <div class="ml-results-panel">
                                <div class="result-card">
                                    <div class="result-header">
                                        <h3 style="color:var(--primary);">Cleaned Data Preview</h3>
                                        <span id="preprocess-status" style="font-size:13px; color:var(--success); font-weight:bold;">Chưa có thay đổi nào.</span>
                                    </div>
                                    <div class="preprocess-table-container"><table class="clustering-table" id="preprocess-table"><thead><tr><th>Đang tải...</th></tr></thead><tbody></tbody></table></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="view-clustering" class="view-section">
                        <div class="ml-task-header">
                            <span id="btn-toggle-config" style="cursor:pointer; padding-right: 12px; font-weight: bold; font-size: 16px; color: #4f46e5;">❮</span>
                            <strong>Algorithm:</strong> <span id="lbl-algo-header">K-Means</span> &nbsp;|&nbsp; <strong>Evaluation:</strong> Full training set
                        </div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 380px;">
                                <div class="ml-config-tabs">
                                    <div class="ml-config-tab active" data-panel="panel-algo">Algorithm</div>
                                    <div class="ml-config-tab" data-panel="panel-eval">Evaluation</div>
                                </div>
                                
                                <div class="ml-config-content active" id="panel-algo" style="text-align: left;">
                                    <h3>Algorithm Configuration</h3>
                                    
                                    <div class="form-group">
                                        <label>Algorithm</label>
                                        <select id="algorithm" class="form-control">
                                            <option value="kmeans" selected>K-Means</option>
                                            <option value="hierarchical">Hierarchical</option>
                                            <option value="gmm">Expectation Maximization</option>
                                            <option value="clara">CLARA</option>
                                        </select>
                                        <div id="algo-desc" class="algo-desc-box">Cluster data using the k means algorithm.</div>
                                    </div>
                                    
                                    <h4 style="margin: 24px 0 12px 0; font-size: 14px; color:var(--text-dark);">Hyperparameters</h4>
                                    
                                    <div class="hyperparams-grid" id="mainParamGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                        
                                        <div class="form-group" id="kValueContainer" style="margin:0;">
                                            <label id="kValueLabel">Number of Clusters</label>
                                            <input type="number" id="kValue" class="form-control" value="3">
                                        </div>

                                        <div class="form-group" id="seedContainer" style="margin:0;">
                                            <label>Random Seed</label>
                                            <input type="number" id="randomSeed" class="form-control" value="10" min="1">
                                        </div>

                                        <div class="form-group" id="distanceContainer" style="margin:0; grid-column: span 2;">
                                            <label>Distance function</label>
                                            <select id="distancefunction" class="form-control">
                                                <option value="EUCLIDEAN" selected>Euclidean Distance</option>
                                                <option value="MANHATTAN">Manhattan Distance</option>
                                                <option value="CHEBYSHEV">Chebyshev Distance</option>
                                                <option value="MINKOWSKI">Minkowski Distance (p=3)</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="hcLinkageContainer" style="display:none; margin:0; grid-column: span 2;">
                                            <label>Link Type</label>
                                            <select id="hcLinkageType" class="form-control">
                                                <option value="AVERAGE" selected> Average Link </option>
                                                <option value="SINGLE">Single Link</option>
                                                <option value="COMPLETE">Complete Link</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="gmmMaxIterGroup" style="display:none; margin:0; grid-column: span 2;">
                                            <label>Max Iterations</label>
                                            <input type="number" id="gmmMaxIter" class="form-control" value="100" min="1">
                                        </div>

                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <label>Attributes Selector</label>
                                        <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; max-height: 120px; overflow-y: auto;" id="featuresList">
                                            <span style="color:#94a3b8; font-size:12px;">Vui lòng Load Data trước...</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="ml-config-content" id="panel-eval" style="display: none; text-align: left;">
                                    <h3>Evaluation Configuration</h3>
                                    <div class="form-group" style="margin-top: 16px;">
                                        <label>Test Options </label>
                                        <div style="margin-top: 12px;"><label style="font-size:13px; display:block; margin-bottom:12px;"><input type="radio" name="testopt" value="training" checked> Use training set</label></div>
                                        <div><label style="font-size:13px; display:block;"><input type="radio" name="testopt" value="split"> Percentage split (80%)</label></div>
                                    </div>
                                </div>

                                <button class="btn-run-green" id="btnRun">🚀 Run Clustering</button>
                            </div>
                            
                            <div class="ml-results-panel">
                                <div id="empty-results" class="empty-state"><div class="empty-icon">📊</div><h3>No Results Yet</h3></div>
                                <div id="resultSection" style="display:none;">
                                    
                                    <!-- CẢI TIẾN TRẢI NGHIỆM: Đưa biểu đồ trực quan hóa (Canvas) lên trên cùng kết quả -->
                                    <div class="result-card" id="visCard">
                                        <div class="result-header"><h3 id="visCardTitle" style="color:var(--primary);">Cluster Visualization</h3></div>
                                        <canvas id="scatterChart" width="800" height="350" style="width:100%; border:1px solid #e2e8f0; border-radius:6px;"></canvas>
                                    </div>

                                    <!-- Thống kê thông số học máy xếp ở giữa -->
                                    <div class="result-card" id="metricsCard" style="padding-bottom: 12px;">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Performance Metrics</h3>
                                            <div style="display:flex; gap:8px;">
                                                <button id="btnExportCSV" style="background:#0891b2; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;"> CSV</button>
                                                <button id="btnExportARFF" style="background:#7c3aed; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;"> ARFF</button>
                                            </div>
                                        </div>
                                        <div class="overview-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom:12px;">
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">Clusters</div><div class="stat-val" id="evalK">--</div></div></div>
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">Instances</div><div class="stat-val" id="evalInstances">--</div></div></div>
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">SSE</div><div class="stat-val" id="evalSSE">--</div></div></div>
                                        </div>
                                    </div>

                                    <!-- Danh sách bảng phân nhóm xếp ở dưới cùng -->
                                    <div class="result-card" id="tableCard" style="padding:0;">
                                        <div style="padding:20px; border-bottom:1px solid var(--border);"><div id="clusterTabs" style="display:flex; gap:8px; flex-wrap:wrap;"></div></div>
                                        <div id="clusterContent" style="overflow-x:auto; padding:0 20px 20px 20px;"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </main>
            </div>
    HTML;
    }
    protected function getGroupName() { return 'wiki'; }
}