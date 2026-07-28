var currentSeed = 10;
function setSeed(seed) { currentSeed = seed; }
function seededRandom() { currentSeed = (currentSeed * 9301 + 49297) % 233280; return currentSeed / 233280; }

var isDataNormalized = false; 

class LcgRandom {
    constructor(seed) {
        seed = seed || 10;
        this.MULT = BigInt("25214903917");
        this.MASK = (BigInt(1) << BigInt(48)) - BigInt(1);
        this.ADD = BigInt(11);
        this._seed = (BigInt(Math.floor(seed)) ^ this.MULT) & this.MASK;
    }
    _next(bits) {
        this._seed = (this._seed * this.MULT + this.ADD) & this.MASK;
        return Number(this._seed >> BigInt(48 - bits));
    }
    nextInt(bound) {
        bound = Math.floor(bound);
        if (bound <= 0) return 0;
        const b = BigInt(bound);
        if ((b & -b) === b) { 
            return Number((b * BigInt(this._next(31))) >> BigInt(31)); 
        }
        let bits, val;
        do {
            bits = this._next(31);
            val  = bits % bound;
        } while (bits - val + (bound - 1) < 0);
        return val;
    }

    nextDouble() {
        return (
            (this._next(26) * Math.pow(2, 27))
            + this._next(27)
        ) / Math.pow(2, 53);
    }
}


function isColumnNumeric(data, attr) {
    if (!data || data.length === 0) return false;
    let hasNumericValue = false;
    for (let i = 0; i < data.length; i++) {
        const val = data[i][attr];
        if (val === undefined || val === null || val === '') continue;
        const num = Number(val);
        if (isNaN(num)) return false;
        hasNumericValue = true;
    }
    return hasNumericValue;
}

let currentClusteringState = {
    type: 'clustering', 
    algorithm: 'kmeans',
    dataset: '',
    resultData: null
};


function showAppMessage(title, text, type = 'info') {
    $('#app-custom-modal').remove();
    const icon = type === 'error' ? '⚠️' : 'ℹ️';
    const color = type === 'error' ? '#ef4444' : '#3b82f6';
    
    const modalHtml = `
        <div id="app-custom-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(4px);">
            <div style="background:#ffffff; width:90%; max-width:480px; padding:30px; border-radius:12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); border-top: 4px solid ${color};">
                <div style="display:flex; gap:16px; align-items:flex-start;">
                    <span style="font-size:32px;">${icon}</span>
                    <div style="flex:1;">
                        <h3 style="margin:0 0 8px 0; font-size:18px; font-weight:700; color:#1e293b;">${title}</h3>
                        <p style="margin:0; font-size:14px; color:#64748b; line-height:1.6;">${text}</p>
                    </div>
                </div>
                <div style="margin-top:24px; display:flex; justify-content:flex-end;">
                    <button id="btn-close-app-modal" style="background:#4f46e5; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; transition:all 0.2s; box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);">Đóng</button>
                </div>
            </div>
        </div>
    `;
    $('body').append(modalHtml);
    $('#btn-close-app-modal').on('click', function() {
        $('#app-custom-modal').fadeOut(150, function() { $(this).remove(); });
    });
}


function buildResultWikitext() {
    var state = currentClusteringState;
    var now = new Date();
    var ts = now.toLocaleString('vi-VN');
    var algoNames = {
        kmeans: 'K-Means', hierarchical: 'Hierarchical Clustering',
        em: 'Expectation-Maximization (EM)', clara: 'CLARA',
        knn: 'KNN (K-Nearest Neighbors)', decision_tree: 'J48 (C4.5 Decision Tree)',
        naive_bayes: 'Naive Bayes', linear: 'Linear Regression', logistic: 'Logistic Regression'
    };
    var algoLabel = algoNames[state.algorithm] || state.algorithm;
    var wikitext = "\n\n== Kết quả phân tích ML Task(Wikicrop)==\n";
    wikitext += "''Tự động cập nhật lúc " + ts + " — Tệp dữ liệu: " + (state.dataset || 'N/A') + "''\n\n";

    if (state.type === 'classification') {
        var r = state.resultData || {};
        wikitext += "=== Phân lớp (Classification): " + algoLabel + " ===\n";
        wikitext += "Nhãn mục tiêu (Target): '''" + (r.targetLabel || '--') + "'''\n\n";
        wikitext += '{| class="wikitable"\n|-\n! Chỉ số !! Giá trị\n';
        wikitext += "|-\n| Accuracy || " + r.accuracy + " %\n";
        wikitext += "|-\n| Precision || " + r.precision + " %\n";
        wikitext += "|-\n| Recall || " + r.recall + " %\n";
        wikitext += "|-\n| F-Measure || " + r.f1 + " %\n";
        wikitext += "|-\n| Số mẫu kiểm thử || " + r.instances + "\n";
        wikitext += "|}\n\n";

        if (r.uniqueClasses && r.confusionMatrix) {
            wikitext += "'''Ma trận nhầm lẫn (Confusion Matrix):'''\n";
            wikitext += '{| class="wikitable"\n|-\n! Thực tế \\ Dự đoán';
            r.uniqueClasses.forEach(function (c) { wikitext += ' !! ' + c; });
            wikitext += '\n';
            r.uniqueClasses.forEach(function (actC, i) {
                wikitext += '|-\n| ' + actC;
                r.uniqueClasses.forEach(function (predC, j) {
                    var cell = (r.confusionMatrix[i] && r.confusionMatrix[i][j] !== undefined) ? r.confusionMatrix[i][j] : 0;
                    wikitext += ' || ' + cell;
                });
                wikitext += '\n';
            });
            wikitext += '|}\n';
        }
        

    } else if (state.type === 'regression') {
        var rReg = state.resultData || {};
        wikitext += "=== Hồi quy (Regression): " + algoLabel + " ===\n";
        wikitext += "Thuộc tính mục tiêu (Target): '''" + (rReg.targetAttr || '--') + "'''\n\n";
        wikitext += '{| class="wikitable"\n|-\n! Chỉ số !! Giá trị\n';
        if (rReg.mae !== undefined) wikitext += "|-\n| MAE || " + rReg.mae + "\n";
        if (rReg.rmse !== undefined) wikitext += "|-\n| RMSE || " + rReg.rmse + "\n";
        if (rReg.r2 !== undefined) wikitext += "|-\n| R² || " + rReg.r2 + "\n";
        if (rReg.rae !== undefined) wikitext += "|-\n| RAE || " + rReg.rae + " %\n";
        if (rReg.rrse !== undefined) wikitext += "|-\n| RRSE || " + rReg.rrse + " %\n";
        wikitext += "|-\n| Số mẫu kiểm thử || " + (rReg.instances || '--') + "\n";
        wikitext += "|}\n";
    } else if (state.algorithm === 'hierarchical') {
        var r3 = state.resultData || {};
        var linkageNames = { SINGLE: 'Single Link', COMPLETE: 'Complete Link', AVERAGE: 'Average Link' };
        var linkageLabel = linkageNames[r3.linkage] || r3.linkage || '--';
        var rootHeight = (r3.tree && typeof r3.tree.height === 'number') ? r3.tree.height.toFixed(4) : '--';
        wikitext += "=== Gom cụm phân cấp (Hierarchical Clustering) ===\n";
        wikitext += '{| class="wikitable"\n|-\n! Chỉ số !! Giá trị\n';
        wikitext += "|-\n| Phương pháp liên kết (Linkage) || " + linkageLabel + "\n";
        wikitext += "|-\n| Số mẫu (Instances) || " + (r3.instances !== undefined ? r3.instances : '--') + "\n";
        wikitext += "|-\n| Khoảng cách gộp gốc (Root Merge Height) || " + rootHeight + "\n";
        wikitext += "|}\n";
        

    } else {
        var r2 = state.resultData || {};
        wikitext += "=== Gom cụm (Clustering): " + algoLabel + " ===\n";
        wikitext += '{| class="wikitable"\n|-\n! Chỉ số !! Giá trị\n';
        wikitext += "|-\n| Số cụm (Clusters) || " + (r2.evalK !== undefined ? r2.evalK : '--') + "\n";
        wikitext += "|-\n| Số mẫu (Instances) || " + (r2.evalInstances !== undefined ? r2.evalInstances : '--') + "\n";
        wikitext += "|-\n| SSE || " + (r2.evalSSE !== undefined ? r2.evalSSE : '--') + "\n";
        wikitext += "|}\n";
    }
    return wikitext;
}


// /* Giao diện hiển thị danh sách bài viết Wikicrop dạng cha con thụt lề */
function showWikiCropPageSelector(onConfirm) {
    var api = new mw.Api();
    showAppMessage('⏳ Đang tải...', 'Hệ thống đang đồng bộ kết nối và lấy danh sách các bài viết từ Wikicrop...', 'info');
    
    api.get({
        action: 'query',
        list: 'allpages',
        apnamespace: 0,
        apfilterredir: 'nonredirects',
        aplimit: 'max',
        format: 'json'
    }).done(function (data) {
        $('#app-custom-modal').remove(); 
        var rawPages = (data.query && data.query.allpages) ? data.query.allpages : [];
        if (rawPages.length === 0) {
            showAppMessage('Thông báo', 'Không tìm thấy trang bài viết nào tồn tại trên hệ thống Wikicrop.', 'info');
            return;
        }
        
        // Sắp xếp danh sách bài viết theo thứ tự bảng chữ cái tiếng Việt
        rawPages.sort((a, b) => a.title.localeCompare(b.title, 'vi'));

        var allTitles = rawPages.map(p => p.title.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''));

        // Tính độ sâu cấp bậc (depth) dựa trên tên bài cha
        var pagesWithDepth = rawPages.map(p => {
            var rawTitle = p.title.trim();
            // Bóc tách sạch dấu ngoặc kép/đơn/cong
            var cleanTitle = rawTitle.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
            var depth = 0;

            // Xóa dấu gạch chéo '/' nếu có trong tiêu đề
            if (cleanTitle.includes('/')) {
                depth = cleanTitle.split('/').length - 1;
                cleanTitle = cleanTitle.replace(/\//g, ' ');
            } else {
                // Phân cấp theo bài viết cha (Ví dụ: "Lúa" -> "Lúa GL25", "Lúa HD16")
                for (var i = 0; i < allTitles.length; i++) {
                    var parentTitle = allTitles[i];
                    if (parentTitle !== cleanTitle && cleanTitle.startsWith(parentTitle + ' ')) {
                        depth++;
                        break;
                    }
                }
            }

            return {
                originalTitle: p.title,
                cleanTitle: cleanTitle,
                depth: depth
            };
        });

        // Render HTML: Chỉ dùng padding-left để thụt lề (mỗi cấp thụt 20px)
        var pagesHtml = pagesWithDepth.map((p, idx) => {
            var indentPx = 12 + (p.depth * 20); // Thụt lề tự động theo độ sâu
            var isParentStyle = p.depth === 0 ? 'font-weight: 700; color: #1e293b;' : 'font-weight: 400; color: #475569;';

            return `
                <label class="wikicrop-page-item" style="display:flex; align-items:center; padding:8px 10px; padding-left:${indentPx}px; cursor:pointer; border-bottom:1px solid #f1f5f9; gap:8px; margin:0; transition: background 0.15s;">
                    <input type="radio"
                        name="wikicrop-page"
                        value="${p.originalTitle}"
                        ${idx === 0 ? 'checked' : ''} style="cursor:pointer; flex-shrink:0;">
                    <span class="wikicrop-page-title" style="font-size:13px; ${isParentStyle} word-break:break-word;">
                        ${p.cleanTitle}
                    </span>
                </label>
            `;
        }).join('');

        var modalHtml = `
            <div id="app-custom-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(4px);">
                <div style="background:#ffffff; width:90%; max-width:540px; padding:26px; border-radius:12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); border-top: 4px solid #4f46e5;">
                    <h3 style="margin:0 0 10px 0; font-size:18px; font-weight:700; color:#1e293b;">Đồng bộ kết quả lên hệ thống</h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#64748b; line-height:1.5;">Phát hiện thấy <b>${rawPages.length}</b> bài viết trên hệ thống. Chọn bài viết nông học mục tiêu để liên kết cập nhật dữ liệu:</p>
                    
                    <div style="margin-bottom:20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <label style="font-size:13px; font-weight:600; color:#475569;">
                                Danh sách bài viết:
                            </label>
                            <span id="wikicrop-page-count" style="font-size:12px; color:#64748b; font-weight:500;">(Hiển thị ${rawPages.length}/${rawPages.length})</span>
                        </div>

                        <!-- Ô nhập tìm kiếm -->
                        <div style="margin-bottom: 10px;">
                            <input type="text" id="input-search-wikicrop" placeholder="🔍 Nhập tên bài viết để tìm nhanh..." style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; outline: none; box-sizing: border-box; transition: all 0.2s;" />
                        </div>

                        <!-- Danh sách thụt lề sạch -->
                        <div id="wikicrop-page-list"
                            style="
                                max-height:240px;
                                overflow-y:auto;
                                border:1px solid #cbd5e1;
                                border-radius:6px;
                                background:#ffffff;">
                            ${pagesHtml}
                        </div>
                    </div>

                    <div class="wikicrop-action-bar" style="display:flex; justify-content:center; gap:12px; margin-top:20px;">
                        <button id="btn-edit-wikicrop" class="wikicrop-btn">Chỉnh sửa</button>
                        <button id="btn-confirm-wikicrop-modal" class="wikicrop-btn" style="background:#4f46e5; color:#fff;">Đồng bộ</button>
                        <button id="btn-cancel-wikicrop-modal" class="wikicrop-btn">Đóng</button>
                    </div>         
                </div>
            </div>
        `;
        $('body').append(modalHtml);

        $('#input-search-wikicrop').focus();

        // Xử lý Lọc dữ liệu thời gian thực
        $('#input-search-wikicrop').on('input', function() {
            var keyword = $(this).val().toLowerCase().trim();
            var visibleCount = 0;

            $('.wikicrop-page-item').each(function() {
                var titleText = $(this).find('.wikicrop-page-title').text().toLowerCase();
                var rawValue = $(this).find('input').val().toLowerCase();

                if (titleText.indexOf(keyword) !== -1 || rawValue.indexOf(keyword) !== -1) {
                    $(this).css('display', 'flex');
                    visibleCount++;
                } else {
                    $(this).hide();
                }
            });

            $('#wikicrop-page-count').text(`(Hiển thị ${visibleCount}/${rawPages.length})`);
        });

        // Lấy bài đang chọn
        function getSelectedWikiPage() {
            return $('input[name="wikicrop-page"]:visible:checked').val() || $('input[name="wikicrop-page"]:checked').val();
        }

    
        // Chỉnh sửa
        $('#btn-edit-wikicrop').on('click', function() {
            var title = getSelectedWikiPage();
            if (!title) { mw.notify('Vui lòng chọn bài viết'); return; }
            window.open(mw.util.getUrl(title, { action: 'edit' }), '_blank');
        });

        $(document).on('click', '#btn-cancel-wikicrop-modal', function () {
            $('#app-custom-modal').remove();
        });

        $('#btn-confirm-wikicrop-modal').on('click', function() {
            var selectedPage = getSelectedWikiPage();
            if (!selectedPage) {
                mw.notify('Vui lòng chọn bài viết trước khi đồng bộ!');
                return;
            }
            $('#app-custom-modal').remove();
            if (typeof onConfirm === 'function') {
                onConfirm(selectedPage);
            }
        });

    }).fail(function (error) {
        console.error("Lỗi khi kết nối lấy danh sách bài viết từ Wikicrop API:", error);
        mw.notify('Không thể tải danh sách bài viết từ hệ thống!', { type: 'error' });
    });
}


/* XỬ LÝ TỆP WIKICROP VÀO ĐÂY  */

function loadDatasetFromUrl(fileName, fileUrl) {
    showAppMessage('⏳ Đang tải tệp...', 'Đang nạp dữ liệu từ kho tập tin Wikicrop: ' + fileName, 'info');
    const extension = fileName.split('.').pop().toLowerCase();
    
    $('#fileName').text(fileName);
    $('#fileBadge').css('display', 'flex');

    if (extension === 'xlsx' || extension === 'xls') {
        fetch(fileUrl)
            .then(res => {
                if (!res.ok) throw new Error('Mã lỗi HTTP ' + res.status + ' khi tải tệp');
                return res.arrayBuffer();
            })
            .then(buffer => {
                const data = new Uint8Array(buffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                $('#app-custom-modal').remove();
                processLoadedData(json);
            })
            .catch(err => {
                $('#app-custom-modal').remove();
                showAppMessage('Lỗi nạp tệp', 'Không thể đọc tệp Excel từ kho Wikicrop! Chi tiết: ' + err.message, 'error');
            });
    } else {
        fetch(fileUrl)
            .then(res => {
                if (!res.ok) throw new Error('Mã lỗi HTTP ' + res.status + ' khi tải tệp');
                return res.text();
            })
            .then(text => {
                let parsed = [];
                if (extension === 'arff') {
                    parsed = parseARFF(text);
                } else if (extension === 'txt') {
                    parsed = parseTXT(text); 
                } else {
                    parsed = parseCSV(text); 
                }

                if (!parsed || parsed.length === 0) {
                    throw new Error('Dữ liệu tệp bị rỗng hoặc không đúng định dạng!');
                }

                $('#app-custom-modal').remove();
                processLoadedData(parsed);
            })
            .catch(err => {
                $('#app-custom-modal').remove();
                showAppMessage('Lỗi nạp tệp', 'Không thể đọc nội dung tệp từ kho Wikicrop! Chi tiết: ' + err.message, 'error');
            });
    }
}
function showWikiCropFileSelector() {
    var api = new mw.Api();
    showAppMessage('⏳ Đang tải...', 'Đang quét kho tệp tin dữ liệu trên Wikicrop...', 'info');

    api.get({
        action: 'query',
        list: 'allimages',
        ailimit: 'max',
        aiprop: 'url|size|mime',
        format: 'json'
    }).done(function (data) {
        $('#app-custom-modal').remove();
        var allFiles = (data.query && data.query.allimages) ? data.query.allimages : [];
        
        var validExtensions = ['csv', 'arff', 'xlsx', 'xls', 'txt'];
        var datasetFiles = allFiles.filter(function (f) {
            var ext = f.name.split('.').pop().toLowerCase();
            return validExtensions.includes(ext);
        });

        if (datasetFiles.length === 0) {
            showAppMessage('Thông báo', 'Không tìm thấy tệp dữ liệu nào (.csv, .arff, .xlsx) trong kho tập tin Wikicrop. Bạn có thể dùng tính năng "Tải lên tập tin" của hệ thống trước.', 'info');
            return;
        }

        var filesHtml = datasetFiles.map(function (f, idx) {
            var cleanName = f.name.replace(/^File:/i, '').replace(/_/g, ' ');
            var sizeKb = (f.size / 1024).toFixed(1) + ' KB';
            return `
                <label class="wikicrop-file-item" style="display:flex; align-items:center; padding:10px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; gap:10px; margin:0;">
                    <input type="radio" name="wikicrop-file" value="${f.url}" data-filename="${cleanName}" ${idx === 0 ? 'checked' : ''} style="cursor:pointer; flex-shrink:0;">
                    <div style="flex:1; overflow:hidden;">
                        <div class="wikicrop-file-name" style="font-size:13px; font-weight:600; color:#1e293b; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">📄 ${cleanName}</div>
                        <div style="font-size:11px; color:#94a3b8;">Dung lượng: ${sizeKb}</div>
                    </div>
                </label>
            `;
        }).join('');

        var modalHtml = `
            <div id="app-custom-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(4px);">
                <<div style="background:#ffffff; width:95%; max-width:750px; padding:28px; border-radius:12px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); border-top: 4px solid #4f46e5;">
                    <h3 style="margin:0 0 10px 0; font-size:18px; font-weight:700; color:#1e293b;">Kho tập tin dữ liệu Wikicrop</h3>
                    <p style="margin:0 0 16px 0; font-size:13px; color:#64748b;">Tìm thấy <b>${datasetFiles.length}</b> tệp dữ liệu đã được tải lên hệ thống. Chọn tệp để nạp vào:</p>
                    
                    <div style="margin-bottom:20px;">
                        <div style="margin-bottom:10px;">
                            <input type="text" id="input-search-wikicrop-file" placeholder="🔍 Tìm tên tệp dữ liệu..." style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none; box-sizing:border-box;" />
                        </div>
                        <div id="wikicrop-file-list" style="max-height:450px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff;">
                            ${filesHtml}
                        </div>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:8px;">
                        <button id="btn-confirm-load-wikicrop-file" class="wikicrop-btn" style="background:#4f46e5; color:#fff;">Nạp dữ liệu</button>
                        <button id="btn-cancel-app-modal" class="wikicrop-btn wikicrop-btn-secondary">Đóng</button>
                    </div>
                </div>
            </div>
        `;
        $('body').append(modalHtml);

        $('#input-search-wikicrop-file').focus();

        $('#input-search-wikicrop-file').on('input', function () {
            var kw = $(this).val().toLowerCase().trim();
            $('.wikicrop-file-item').each(function () {
                var txt = $(this).find('.wikicrop-file-name').text().toLowerCase();
                $(this).toggle(txt.indexOf(kw) !== -1);
            });
        });

        $(document).off('click', '#btn-cancel-app-modal').on('click', '#btn-cancel-app-modal', function () {
            $('#app-custom-modal').remove();
        });

        $('#btn-confirm-load-wikicrop-file').on('click', function () {
            var $selected = $('input[name="wikicrop-file"]:checked');
            if (!$selected.length) {
                mw.notify('Vui lòng chọn một tệp dữ liệu!');
                return;
            }
            var fileUrl = $selected.val();
            var fileName = $selected.data('filename');
            loadDatasetFromUrl(fileName, fileUrl);
        });

    }).fail(function () {
        showAppMessage('Lỗi kết nối', 'Không thể kết nối lấy danh sách tệp từ Wikicrop API!', 'error');
    });
}


var nominalDomains = {};

function getIqrPercentile(sorted, fraction) {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = fraction * (sorted.length - 1);
    const l = Math.floor(idx);
    const h = idx - l;
    if (l >= sorted.length - 1) return sorted[sorted.length - 1];
    return sorted[l] + h * (sorted[l + 1] - sorted[l]);
}

function getIqrThresholds(data, key) {
    const values = data.map(d => parseFloat(d[key])).filter(v => !isNaN(v));
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = getIqrPercentile(sorted, 0.25);
    const q3 = getIqrPercentile(sorted, 0.75);
    const iqr = q3 - q1;
    const OF = 1.5;  
    return { upperOutlier: q3 + OF * iqr, lowerOutlier: q1 - OF * iqr };
}

function getOutlierData(data, numKeys) {
    const outlierIndices = new Set();
    let totalOutlierValues = 0;
    if (!data || data.length === 0) return { count: 0, indices: outlierIndices };

    const thresholds = {};
    const cleanNumKeys = numKeys.filter(k => k !== 'species_id' && k !== 'id' && k !== 'class' && k !== 'species');
    cleanNumKeys.forEach(k => { thresholds[k] = getIqrThresholds(data, k); });

    data.forEach((row, idx) => {
        let isRowOutlier = false;
        for (const k of cleanNumKeys) {
            const t = thresholds[k];
            if (!t) continue;
            const value = parseFloat(row[k]);
            if (!isNaN(value)) {
                if (value > t.upperOutlier || value < t.lowerOutlier) {
                    totalOutlierValues++; 
                    isRowOutlier = true;  
                }
            }
        }
        if (isRowOutlier) outlierIndices.add(idx);
    });
    return { count: totalOutlierValues, indices: outlierIndices };
}

function buildDomains(data, keys) {
    nominalDomains = {};
    if (!data || data.length === 0) return;
    keys.forEach(k => {
        if (!isColumnNumeric(data, k)) {
            const uniqueVals = [];
            data.forEach(row => {
                if (row[k] !== undefined && row[k] !== '' && uniqueVals.indexOf(row[k]) === -1) {
                    uniqueVals.push(row[k]);
                }
            });
            nominalDomains[k] = uniqueVals; 
        }
    });
}

function getNormalizationParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => parseFloat(d[k])).filter(v => !isNaN(v));
        if (vals.length === 0) return;
        const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        params[k] = { min: min, max: max, range: (max - min) || 1 };
    });
    return params;
}

function getZScoreParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => parseFloat(d[k])).filter(v => !isNaN(v));
        if (vals.length === 0) return;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
        params[k] = { mean: mean, std: std };
    });
    return params;
}

function getRobustParams(data, keys) {
    const params = {};
    keys.forEach(k => {
        const vals = data.map(d => parseFloat(d[k])).filter(v => !isNaN(v));
        if (vals.length === 0) return;
        const sorted = [...vals].sort((a, b) => a - b);
        const median = getIqrPercentile(sorted, 0.5);
        const q1 = getIqrPercentile(sorted, 0.25);
        const q3 = getIqrPercentile(sorted, 0.75);
        const iqr = (q3 - q1) || 1; 
        params[k] = { median: median, iqr: iqr };
    });
    return params;
}

function normalizeData(data, params) {
    return data.map(row => {
        const newRow = { ...row };
        Object.keys(params).forEach(k => {
            const val = parseFloat(newRow[k]);
            if (!isNaN(val)) newRow[k] = (val - params[k].min) / params[k].range;
        });
        if (row._originalId !== undefined) newRow._originalId = row._originalId;
        return newRow;
    });
}

function calculateClusteringDistance(a, b, features, ranges) {
    const metric = $('#distanceMetric').val() || 'EUCLIDEAN';
    let sum = 0;
    let maxDiff = -Infinity;
    const pVal = 3; 
    
    const keys = features || Object.keys(a).filter(key => 
        key !== '_originalId' && key !== '_cluster'
    );

    keys.forEach(key => {
        let valA = a[key];
        let valB = b[key];
        let isMissing = (valA === undefined || valA === null || valA === '' || (typeof valA === 'number' && isNaN(valA))) ||
                        (valB === undefined || valB === null || valB === '' || (typeof valB === 'number' && isNaN(valB)));

        let diff = 0;
        if (isMissing) {
            diff = 1.0; 
        } else {
            const numA = parseFloat(valA);
            const numB = parseFloat(valB);
            if (!isNaN(numA) && !isNaN(numB)) {
                let normA = numA;
                let normB = numB;
                if (ranges && ranges[key]) {
                    const r = ranges[key];
                    normA = (numA - r.min) / r.range;
                    normB = (numB - r.min) / r.range;
                }
                diff = Math.abs(normA - normB);
            } else {
                diff = (valA === valB) ? 0.0 : 1.0;
            }
        }

        if (metric === 'EUCLIDEAN') {
            sum += diff * diff;
        } else if (metric === 'MANHATTAN') {
            sum += diff;
        } else if (metric === 'CHEBYSHEV') {
            if (diff > maxDiff) maxDiff = diff;
        } else if (metric === 'MINKOWSKI') {
            sum += Math.pow(diff, pVal);
        }
    });
    
    if (metric === 'EUCLIDEAN') {
        return Math.sqrt(sum); 
    } else if (metric === 'MANHATTAN') {
        return sum;
    } else if (metric === 'CHEBYSHEV') {
        return maxDiff === -Infinity ? 0 : maxDiff;
    } else if (metric === 'MINKOWSKI') {
        return Math.pow(sum, 1 / pVal);
    }
    return Math.sqrt(sum);
}

function calculateRegressionMetrics(actuals, predictions) {
    const n = actuals.length;
    if (n === 0) return { mae: 0, rmse: 0, r2: 0, rae: 0, rrse: 0, instances: 0 };

    let sumActual = 0, sumPred = 0, absErrSum = 0, sqErrSum = 0;
    for (let i = 0; i < n; i++) {
        const act = parseFloat(actuals[i]) || 0;
        const pred = parseFloat(predictions[i]) || 0;
        sumActual += act;
        sumPred += pred;
        const err = pred - act;
        absErrSum += Math.abs(err);
        sqErrSum += err * err;
    }

    const meanActual = sumActual / n;
    let totalSqDiff = 0, totalAbsDiff = 0;
    for (let i = 0; i < n; i++) {
        const act = parseFloat(actuals[i]) || 0;
        totalSqDiff += Math.pow(act - meanActual, 2);
        totalAbsDiff += Math.abs(act - meanActual);
    }

    const mae = absErrSum / n;
    const rmse = Math.sqrt(sqErrSum / n);
    const r2 = totalSqDiff > 0 ? 1 - (sqErrSum / totalSqDiff) : 1;
    const rae = totalAbsDiff > 0 ? (absErrSum / totalAbsDiff) * 100 : 0;
    const rrse = totalSqDiff > 0 ? (Math.sqrt(sqErrSum) / Math.sqrt(totalSqDiff)) * 100 : 0;

    return {
        mae: parseFloat(mae.toFixed(4)),
        rmse: parseFloat(rmse.toFixed(4)),
        r2: parseFloat(r2.toFixed(4)),
        rae: parseFloat(rae.toFixed(2)),
        rrse: parseFloat(rrse.toFixed(2)),
        instances: n
    };
}


class JavaRandom {
    constructor(seed) {
        this.seed =
            (BigInt(seed) ^ BigInt("0x5DEECE66D")) &
            ((BigInt(1) << BigInt(48)) - BigInt(1));
    }

    next(bits) {
        this.seed =
            (this.seed * BigInt("0x5DEECE66D") + BigInt("0xB")) &
            ((BigInt(1) << BigInt(48)) - BigInt(1));

        return Number(
            this.seed >> BigInt(48 - bits)
        );
    }

    nextInt(bound) {
        if ((bound & -bound) === bound) {
            return Math.floor(
                (bound * this.next(31)) /
                2147483648
            );
        }

        let bits;
        let val;

        do {
            bits = this.next(31);
            val = bits % bound;
        } while (
            bits - val + (bound - 1) < 0
        );

        return val;
    }

    nextDouble() {
        return (
            ((this.next(26) * (1 << 27))
            + this.next(27))
            / Math.pow(2, 53)
        );
    }
}

/* Ước lượng phân phối mật độ hạt KernelEstimator tránh ReferenceError */
// Hàm CDF chuẩn tắc Φ(z) dùng chung (xấp xỉ Abramowitz & Stegun qua erf), dùng cho KernelEstimator
// tương ứng Statistics.normalProbability(z) trong file gốc KernelEstimator.java của Weka.
function standardNormalCDF(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
          a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

class KernelEstimator {
    constructor(precision) {
        // "precision cannot be zero" -> tương đương Utils.SMALL trong file gốc
        this.precision = (precision && precision > 1e-6) ? precision : 1e-6;
        this.values = [];   // Mảng giá trị ĐÃ SẮP XẾP, duy nhất sau khi làm tròn theo precision (giống m_Values)
        this.weights = [];  // Trọng số tương ứng từng giá trị (giống m_Weights)
        this.sumOfWeights = 0;
        // FIX: Khởi tạo ĐÚNG công thức gốc: m_StandardDev = m_Precision / (2 * 3) = precision/6
        this.standardDev = this.precision / 6;
    }

    // round(data) = Math.rint(data / m_Precision) * m_Precision trong file gốc
    _round(data) {
        return Math.round(data / this.precision) * this.precision;
    }

    // findNearestValue(key): tìm kiếm nhị phân vị trí chèn/trùng khớp, y hệt bản gốc
    _findNearestValue(key) {
        let low = 0, high = this.values.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            const current = this.values[mid];
            if (current === key) return mid;
            if (current > key) high = mid; else low = mid + 1;
        }
        return low;
    }

    addValue(data, weight) {
        if (weight === 0) return;
        data = this._round(data); // FIX: làm tròn dữ liệu theo precision TRƯỚC khi lưu, giống bản gốc

        const insertIndex = this._findNearestValue(data);
        if (insertIndex >= this.values.length || this.values[insertIndex] !== data) {
            // Giá trị (đã làm tròn) chưa tồn tại -> chèn mới, giữ mảng luôn ở trạng thái đã sắp xếp
            this.values.splice(insertIndex, 0, data);
            this.weights.splice(insertIndex, 0, weight);
        } else {
            // Giá trị đã tồn tại -> cộng dồn trọng số vào đúng vị trí (giống m_Weights[insertIndex] += weight)
            this.weights[insertIndex] += weight;
        }
        this.sumOfWeights += weight;

        // FIX: Công thức bandwidth CHÍNH XÁC của Weka - dùng RANGE (giá trị lớn nhất - nhỏ nhất đã quan sát)
        // chia cho căn bậc hai tổng trọng số, sàn tối thiểu precision/6. Bản trước đây suy đoán sai
        // (dùng độ lệch chuẩn thống kê kiểu Silverman), không khớp thực tế.
        const range = this.values[this.values.length - 1] - this.values[0];
        if (range > 0) {
            this.standardDev = Math.max(range / Math.sqrt(this.sumOfWeights), this.precision / 6);
        }
    }

    getProbability(data) {
        data = this._round(data); 

        if (this.values.length === 0) {
            // Trường hợp chưa có dữ liệu nào: dùng đúng nhánh đặc biệt của bản gốc
            const zLower = (data - this.precision / 2) / this.standardDev;
            const zUpper = (data + this.precision / 2) / this.standardDev;
            return standardNormalCDF(zUpper) - standardNormalCDF(zLower);
        }

        let sum = 0;
        for (let i = 0; i < this.values.length; i++) {
            const delta = this.values[i] - data;
            const zLower = (delta - this.precision / 2) / this.standardDev;
            const zUpper = (delta + this.precision / 2) / this.standardDev;
            const currentProb = standardNormalCDF(zUpper) - standardNormalCDF(zLower);
            sum += currentProb * this.weights[i];
        }

        return sum / (this.sumOfWeights * this.precision);
    }
}

// 1. CÁC LỚP THUẬT TOÁN PHÂN CỤM (CLUSTERING)
class KMeans {
    constructor(k, data, initMethod = 'RANDOM', replaceMissing = true, attributes = null) {
        this.k = k; 
        this.rawTrainData = data;
        this.data = data; 
        this.initMethod = initMethod;
        this.replaceMissing = replaceMissing;
        this.centroids = []; 
        this.clusters = [];
        this.squaredError = 0;
        this.assignments = new Array(data.length).fill(-1);
        this.attributes = attributes || Object.keys(data[0]).filter(k => k !== '_originalId' && k !== '_cluster');
        this.isNumeric = {};
        this.attributes.forEach(attr => { this.isNumeric[attr] = isColumnNumeric(data, attr); });
    }
    distance(a, b) { return calculateClusteringDistance(a, b, this.attributes); }
    
    replaceMissingValues() {
        const processedData = JSON.parse(JSON.stringify(this.data));
        this.attributes.forEach(attr => {
            if (this.isNumeric[attr]) {
                const vals = this.data.map(row => parseFloat(row[attr])).filter(v => !isNaN(v));
                const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                processedData.forEach(row => {
                    if (row[attr] === undefined || row[attr] === null || row[attr] === '' || isNaN(parseFloat(row[attr]))) {
                        row[attr] = mean;
                    }
                });
            } else {
                const counts = {};
                this.data.forEach(row => {
                    const val = row[attr];
                    if (val !== undefined && val !== null && val !== '') {
                        counts[val] = (counts[val] || 0) + 1;
                    }
                });
                let mode = null;
                let maxCount = -1;
                Object.keys(counts).sort().forEach(val => {
                    if (counts[val] > maxCount) {
                        maxCount = counts[val];
                        mode = val;
                    }
                });
                processedData.forEach(row => {
                    if (row[attr] === undefined || row[attr] === null || row[attr] === '') {
                        row[attr] = mode;
                    }
                });
            }
        });
        this.data = processedData;
    }

    initCentroids() {
        if (this.initMethod === 'KMEANS_PLUS_PLUS') {
            this.initCentroidsKMeansPlusPlus();
        } else if (this.initMethod === 'FARTHEST_FIRST') {
            this.initCentroidsFarthestFirst();
        } else if (this.initMethod === 'CANOPY') {
            this.initCentroidsCanopy();
        } else {
            this.initCentroidsRandom();
        }
    }

    initCentroidsRandom() {
        const arr = [...this.data]; this.centroids = []; const seen = new Set();
        const jRand = new LcgRandom(currentSeed);
        for (let j = arr.length - 1; j >= 0; j--) {
            const instIndex = jRand.nextInt(j + 1);
            const candidate = arr[instIndex];
            const candidateForHash = {}; this.attributes.forEach(attr => { candidateForHash[attr] = candidate[attr]; });
            const hash = JSON.stringify(candidateForHash);
            if (!seen.has(hash)) { this.centroids.push({ ...candidate }); seen.add(hash); }
            const temp = arr[j]; arr[j] = arr[instIndex]; arr[instIndex] = temp;
            if (this.centroids.length === this.k) break;
        }
        this.k = this.centroids.length;
    }

    
    initCentroidsKMeansPlusPlus() {
        const centroids = [];
        const jRand = new LcgRandom(currentSeed);
        const firstIdx = jRand.nextInt(this.data.length);
        centroids.push({ ...this.data[firstIdx] });
        const selectedIndices = new Set([firstIdx]);

        while (centroids.length < this.k) {
            const dSq = new Array(this.data.length).fill(0);
            let sumDSq = 0;

            for (let i = 0; i < this.data.length; i++) {
                if (selectedIndices.has(i)) {
                    dSq[i] = 0;
                    continue;
                }
                
                let isDuplicate = false;
                for (let c of centroids) {
                    if (this.distance(this.data[i], c) === 0) {
                        isDuplicate = true;
                        break;
                    }
                }
                if (isDuplicate) {
                    dSq[i] = 0;
                    continue;
                }

                let minDist = Infinity;
                for (let j = 0; j < centroids.length; j++) {
                    const dist = this.distance(this.data[i], centroids[j]);
                    if (dist < minDist) minDist = dist;
                }
                dSq[i] = minDist * minDist;
                sumDSq += dSq[i];
            }

            if (sumDSq === 0) {
                for (let i = 0; i < this.data.length; i++) {
                    if (!selectedIndices.has(i)) {
                        centroids.push({ ...this.data[i] });
                        selectedIndices.add(i);
                        break;
                    }
                }
                if (centroids.length === this.k) break;
                continue;
            }

            const rVal = jRand.nextDouble() * sumDSq;
            let runningSum = 0;
            let selectedIdx = -1;
            for (let i = 0; i < this.data.length; i++) {
                runningSum += dSq[i];
                if (runningSum >= rVal) {
                    selectedIdx = i;
                    break;
                }
            }
            if (selectedIdx === -1) {
                selectedIdx = this.data.findIndex((_, idx) => !selectedIndices.has(idx));
            }
            centroids.push({ ...this.data[selectedIdx] });
            selectedIndices.add(selectedIdx);
        }
        this.centroids = centroids;
    }

    initCentroidsFarthestFirst() {
        const centroids = [];
        const jRand = new LcgRandom(currentSeed);
        const firstIdx = jRand.nextInt(this.data.length);
        centroids.push({ ...this.data[firstIdx] });
        const selectedIndices = new Set([firstIdx]);

        while (centroids.length < this.k) {
            let maxMinDist = -Infinity;
            let selectedIdx = -1;

            for (let i = 0; i < this.data.length; i++) {
                if (selectedIndices.has(i)) continue;
                
                let isDuplicate = false;
                for (let c of centroids) {
                    if (this.distance(this.data[i], c) === 0) {
                        isDuplicate = true;
                        break;
                    }
                }
                if (isDuplicate) continue;

                let minDist = Infinity;
                for (let j = 0; j < centroids.length; j++) {
                    const dist = this.distance(this.data[i], centroids[j]);
                    if (dist < minDist) minDist = dist;
                }
                if (minDist > maxMinDist) {
                    maxMinDist = minDist;
                    selectedIdx = i;
                }
            }
            if (selectedIdx === -1) {
                selectedIdx = this.data.findIndex((_, idx) => !selectedIndices.has(idx));
            }
            centroids.push({ ...this.data[selectedIdx] });
            selectedIndices.add(selectedIdx);
        }
        this.centroids = centroids;
    }


    initCentroidsCanopy() {
        const arr = [...this.data];
        this.centroids = [];
        const jRand = new LcgRandom(currentSeed);
        
        for (let j = arr.length - 1; j > 0; j--) {
            const instIndex = jRand.nextInt(j + 1);
            const temp = arr[j]; arr[j] = arr[instIndex]; arr[instIndex] = temp;
        }

        let totalD = 0;
        let samplePairs = 0;
        for (let i = 0; i < Math.min(50, arr.length - 1); i++) {
            totalD += this.distance(arr[i], arr[i+1]);
            samplePairs++;
        }
        let t2 = samplePairs > 0 ? (totalD / samplePairs) * 0.75 : 0.5;

        const seen = new Set();
        const centroids = [];

        for (let i = 0; i < arr.length; i++) {
            const candidate = arr[i];
            if (seen.has(candidate._originalId)) continue;
            
            centroids.push({ ...candidate });
            seen.add(candidate._originalId);
            
            for (let j = i + 1; j < arr.length; j++) {
                if (!seen.has(arr[j]._originalId)) {
                    if (this.distance(candidate, arr[j]) < t2) {
                        seen.add(arr[j]._originalId);
                    }
                }
            }
            if (centroids.length === this.k) break;
        }
        
        if (centroids.length < this.k) {
            for (let i = 0; i < arr.length; i++) {
                const candidate = arr[i];
                if (!seen.has(candidate._originalId)) {
                    centroids.push({ ...candidate });
                    seen.add(candidate._originalId);
                    if (centroids.length === this.k) break;
                }
            }
        }
        
        this.centroids = centroids.slice(0, this.k);
        this.k = this.centroids.length;
    }
    
    assignClusters() {
        let converged = true; const newClusters = Array.from({ length: this.k }, () => []); this.squaredError = 0;
        this.data.forEach((point, i) => {
            let minDist = Infinity; let bestCluster = 0;
            this.centroids.forEach((c, cIdx) => { const d = this.distance(point, c); if (d < minDist) { minDist = d; bestCluster = cIdx; } });
            if (this.assignments[i] !== bestCluster) converged = false;
            this.assignments[i] = bestCluster; this.squaredError += minDist * minDist;
            newClusters[bestCluster].push(point);
        });
        this.clusters = newClusters; return converged;
    }
    
    updateCentroids() {
        let emptyClusters = []; const newCentroids = [];
        this.clusters.forEach((cluster, i) => {
            if (cluster.length === 0) { 
                emptyClusters.push(i); 
                newCentroids.push(null); 
                return; 
            }
            const centroid = {};
            this.attributes.forEach(attr => {
                if (this.isNumeric[attr]) { 
                    let sum = 0;
                    let count = 0;
                    cluster.forEach(p => { 
                        const val = parseFloat(p[attr]);
                        if (!isNaN(val)) {
                            sum += val; 
                            count++;
                        }
                    }); 
                    centroid[attr] = count > 0 ? sum / count : 0; 
                } else {
                    const counts = {}; 
                    cluster.forEach(p => { 
                        const val = p[attr]; 
                        if (val !== undefined && val !== null && val !== '') {
                            counts[val] = (counts[val] || 0) + 1; 
                        }
                    });
                    let bestVal = null; let maxCount = -1;
                    (nominalDomains[attr] || Object.keys(counts)).sort().forEach(val => {
                        if ((counts[val] || 0) > maxCount) { maxCount = counts[val] || 0; bestVal = val; }
                    });
                    centroid[attr] = bestVal;
                }
            });
            newCentroids.push(centroid);
        });

        if (emptyClusters.length > 0) {
            emptyClusters.forEach(emptyIdx => {
                let maxError = -Infinity; 
                let bestPointIdx = -1;

                this.data.forEach((point, pIdx) => {
                    const assignedClusterIdx = this.assignments[pIdx];
                    if (assignedClusterIdx !== -1 && assignedClusterIdx !== emptyIdx) {
                        const currentCentroid = newCentroids[assignedClusterIdx];
                        if (currentCentroid) {
                            const d = this.distance(point, currentCentroid);
                            const err = d * d;

                            if (err > maxError) {
                                maxError = err;
                                bestPointIdx = pIdx;
                            }
                        }
                    }
                });

                if (bestPointIdx !== -1) {
                    const pointToSteal = this.data[bestPointIdx];
                    newCentroids[emptyIdx] = { ...pointToSteal };
                    this.assignments[bestPointIdx] = emptyIdx;
                } else {
                    const jRand = new LcgRandom(currentSeed);
                    const randIdx = jRand.nextInt(this.data.length);
                    newCentroids[emptyIdx] = { ...this.data[randIdx] };
                    this.assignments[randIdx] = emptyIdx;
                }
            });
        }

        this.centroids = newCentroids.filter(c => c !== null);
        this.k = this.centroids.length;
    }
    
    run(maxIter = 500) { 
        if (this.replaceMissing) {
            this.replaceMissingValues();
        }
        this.initCentroids();
        let iterations = 0;
        for (let i = 0; i < maxIter; i++) { iterations++; const converged = this.assignClusters(); this.updateCentroids(); if (converged) break; }
        this.assignClusters(); 
        const finalClusters = this.clusters.filter(c => c.length > 0);
        finalClusters.model = { squaredError: this.squaredError, iterations: iterations }; 
        return finalClusters;
    }
}


class HierarchicalClustering {
    constructor(k, data, linkage = 'SINGLE') { 
        this.data = data; this.linkage = linkage.toUpperCase(); this.tree = null;
        this.attributes = Object.keys(data[0]).filter(k => k !== '_originalId' && k !== '_cluster');
    }
    distance(a, b) { return calculateClusteringDistance(a, b, this.attributes); }
    clusterDistance(c1, c2) {
        if (this.linkage === 'SINGLE') { 
            let minD = Infinity; c1.points.forEach(p1 => c2.points.forEach(p2 => { let d = this.distance(p1, p2); if (d < minD) minD = d; })); return minD; 
        } else if (this.linkage === 'COMPLETE') { 
            let maxD = -Infinity; c1.points.forEach(p1 => c2.points.forEach(p2 => { let d = this.distance(p1, p2); if (d > maxD) maxD = d; })); return maxD; 
        } else { 
            let sum = 0; c1.points.forEach(p1 => c2.points.forEach(p2 => { sum += this.distance(p1, p2); })); return sum / (c1.points.length * c2.points.length);
        }
    }
    run() {
        let fullTreeNodes = this.data.map((p, i) => ({ id: i, points: [p], children: null, height: 0, name: p.name || `Item ${i}` }));
        let clusterCounter = this.data.length;
        while (fullTreeNodes.length > 1) {
            let minDist = Infinity, mergeIdx1 = -1, mergeIdx2 = -1;
            for (let i = 0; i < fullTreeNodes.length; i++) {
                for (let j = i + 1; j < fullTreeNodes.length; j++) { 
                    const d = this.clusterDistance(fullTreeNodes[i], fullTreeNodes[j]); 
                    if (d < minDist) { minDist = d; mergeIdx1 = i; mergeIdx2 = j; } 
                }
            }
            if (mergeIdx1 === -1) break;
            const newNode = {
                id: clusterCounter++,
                points: [...fullTreeNodes[mergeIdx1].points, ...fullTreeNodes[mergeIdx2].points],
                children: [fullTreeNodes[mergeIdx1], fullTreeNodes[mergeIdx2]],
                height: minDist, name: `Merge_${clusterCounter}`
            };
            fullTreeNodes.splice(mergeIdx2, 1); fullTreeNodes.splice(mergeIdx1, 1); fullTreeNodes.push(newNode);
        }
        this.tree = fullTreeNodes[0]; return this.tree;
    }
}


class CLARA {
    constructor(k, data, numSamples = 5, sampleSize = 40 + 2 * k) { 
        this.k = k; this.data = data; this.numSamples = numSamples; 
        this.sampleSize = Math.min(sampleSize, data.length); 
        this.centroids = []; 
        this.attributes = Object.keys(data[0]).filter(k => k !== '_originalId' && k !== '_cluster');
    }
    distance(a, b) { return calculateClusteringDistance(a, b, this.attributes); }
    calculateCost(dataset, medoids) { let cost = 0; dataset.forEach(point => { let minDist = Infinity; medoids.forEach(m => { const d = this.distance(point, m); if (d < minDist) minDist = d; }); cost += minDist; }); return cost; }
    run() {
        let bestMedoids = []; let minTotalCost = Infinity; const jRand = new LcgRandom(currentSeed);
        for (let s = 0; s < this.numSamples; s++) {
            let tempArr = [...this.data];
            for (let i = tempArr.length - 1; i > 0; i--) { const j = jRand.nextInt(i + 1); const temp = tempArr[i]; tempArr[i] = tempArr[j]; tempArr[j] = temp; }
            const sample = tempArr.slice(0, this.sampleSize);
            let medoids = sample.slice(0, this.k); let bestSampleMedoids = [...medoids]; let minSampleCost = this.calculateCost(sample, medoids);
            let improved = true;
            while (improved) {
                improved = false;
                for (let i = 0; i < this.k; i++) {
                    for (let j = 0; j < sample.length; j++) {
                        let isMedoid = false;
                        for(let m=0; m<medoids.length; m++) { if (medoids[m]._originalId === sample[j]._originalId) isMedoid = true; }
                        if (isMedoid) continue;
                        const newMedoids = [...medoids]; newMedoids[i] = sample[j];
                        const cost = this.calculateCost(sample, newMedoids);
                        if (cost < minSampleCost) { minSampleCost = cost; bestSampleMedoids = [...newMedoids]; improved = true; }
                    }
                }
                medoids = [...bestSampleMedoids];
            }
            const entireCost = this.calculateCost(this.data, medoids);
            if (entireCost < minTotalCost) { minTotalCost = entireCost; bestMedoids = [...medoids]; }
        }
        this.centroids = bestMedoids; 
        const clusters = Array.from({ length: this.k }, () => []);
        this.data.forEach(point => { let minDist = Infinity, bestIdx = 0; this.centroids.forEach((m, idx) => { const d = this.distance(point, m); if (d < minDist) { minDist = d; bestIdx = idx; } }); clusters[bestIdx].push(point); });
        const finalClusters = clusters.filter(c => c.length > 0); finalClusters.model = this; return finalClusters;
    }
}

class ExpectationMaximization {
    constructor(k, data, covType = 'diag') {
        this.k = k; this.data = data; this.covType = covType; this.n = data.length; this.keys = Object.keys(data[0]).filter(k => k !== '_originalId');
        this.isNumeric = {}; this.nominalCounts = {}; 
        this.keys.forEach(k => { this.isNumeric[k] = isColumnNumeric(data, k); if (!this.isNumeric[k]) { const s = new Set(); data.forEach(d => s.add(d[k])); this.nominalCounts[k] = s.size; } });
        this.keys = this.keys.filter(k => k !== 'name' && k !== 'species_id' && k !== 'id' && k !== 'class' && k !== 'species');
        this.priors = new Array(k).fill(0); this.modelNormal = Array.from({length: k}, () => ({})); this.modelNominal = Array.from({length: k}, () => ({})); this.weights = Array.from({length: this.n}, () => new Array(k).fill(0)); this.minStdDev = 1e-6; 
    }
    _vec(point) { return this.keys.map(k => point[k] || 0); }
    _estimateParameters() {
        let totalPrior = 0;
        for (let c = 0; c < this.k; c++) { let sumWeights = 0; for (let i = 0; i < this.n; i++) sumWeights += this.weights[i][c]; this.priors[c] = sumWeights + 1.0; totalPrior += this.priors[c]; }
        for (let c = 0; c < this.k; c++) this.priors[c] /= totalPrior;
        for (let c = 0; c < this.k; c++) {
            let sumWeights = 0; for (let i = 0; i < this.n; i++) sumWeights += this.weights[i][c];
            this.keys.forEach(key => {
                if (this.isNumeric[key]) {
                    if (sumWeights <= 0) { this.modelNormal[c][key] = { mean: 0, variance: Number.MAX_VALUE }; } 
                    else {
                        let mean = 0; for (let i = 0; i < this.n; i++) mean += this.weights[i][c] * (this.data[i][key] || 0); mean /= sumWeights;
                        let variance = 0; for (let i = 0; i < this.n; i++) { const diff = (this.data[i][key] || 0) - mean; variance += this.weights[i][c] * diff * diff; }
                        variance /= sumWeights; if (variance < this.minStdDev) variance = this.minStdDev; this.modelNormal[c][key] = { mean, variance };
                    }
                } else {
                    const counts = {}; for (let i = 0; i < this.n; i++) { const val = this.data[i][key]; counts[val] = (counts[val] || 0) + this.weights[i][c]; }
                    const numCat = this.nominalCounts[key]; this.modelNominal[c][key] = {};
                    for (let val in counts) { this.modelNominal[c][key][val] = (counts[val] + 1.0) / (sumWeights + numCat); }
                    this.modelNominal[c][key]['_default'] = 1.0 / (sumWeights + numCat);
                }
            });
        }
    }
    _eStep() {
        let logLikelihood = 0;
        for (let i = 0; i < this.n; i++) {
            const logProbs = new Array(this.k).fill(0);
            for (let c = 0; c < this.k; c++) {
                let logProb = Math.log(this.priors[c]);
                this.keys.forEach(key => {
                    const val = this.data[i][key]; // FIX: Đã sửa đồng bộ thiếu ngữ cảnh gọi mảng data
                    if (this.isNumeric[key]) { const mean = this.modelNormal[c][key].mean; const variance = this.modelNormal[c][key].variance; logProb += -0.5 * Math.log(2 * Math.PI * variance) - 0.5 * Math.pow((val || 0) - mean, 2) / variance; } 
                    else { const prob = this.modelNominal[c][key][val] || this.modelNominal[c][key]['_default']; logProb += Math.log(prob); }
                });
                logProbs[c] = logProb;
            }
            const maxLog = Math.max.apply(null, logProbs); let sumExp = 0; for (let c = 0; c < this.k; c++) sumExp += Math.exp(logProbs[c] - maxLog);
            logLikelihood += maxLog + Math.log(sumExp); for (let c = 0; c < this.k; c++) this.weights[i][c] = Math.exp(logProbs[c] - maxLog) / sumExp;
        }
        return logLikelihood;
    }
    
    assignPoint(point) {
        const logProbs = new Array(this.k).fill(0);
        for (let c = 0; c < this.k; c++) {
            let logProb = Math.log(this.priors[c]);
            this.keys.forEach(key => {
                const val = point[key];
                if (this.isNumeric[key]) {
                    const mean = this.modelNormal[c][key].mean;
                    const variance = this.modelNormal[c][key].variance;
                    logProb += -0.5 * Math.log(2 * Math.PI * variance) - 0.5 * Math.pow((val || 0) - mean, 2) / variance;
                } else {
                    const prob = this.modelNominal[c][key][val] || this.modelNominal[c][key]['_default'];
                    logProb += Math.log(prob);
                }
            });
            logProbs[c] = logProb;
        }
        return logProbs.indexOf(Math.max.apply(null, logProbs));
    }

    run(maxIter = 100) { 
        const km = new KMeans(this.k, this.data); km.run(100); 
        for(let i=0; i<this.n; i++) { let assigned = km.assignments[i]; if (assigned < 0) assigned = 0; this.weights[i][assigned] = 1.0; }
        this._estimateParameters(); let prevLL = -Infinity;
        for (let iter = 0; iter < maxIter; iter++) { const currentLL = this._eStep(); this._estimateParameters(); if (Math.abs(currentLL - prevLL) < 1e-6) break; prevLL = currentLL; }
        const clusters = Array.from({ length: this.k }, () => []);
        for (let i = 0; i < this.n; i++) { const w = this.weights[i]; const bestK = w.indexOf(Math.max.apply(null, w)); clusters[bestK].push(this.data[i]); }
        const finalClusters = clusters.filter(c => c.length > 0); finalClusters.model = this; return finalClusters;
    }
}

function calculateSSE(clusters, evalKeys) {
    let totalSSE = 0;
    if (!Array.isArray(clusters)) return 0;
 
    clusters.forEach(cluster => {
        if (!Array.isArray(cluster) || cluster.length === 0) return;
 
        const centroid = {};
        evalKeys.forEach(key => {
            const isNumeric = isColumnNumeric(cluster, key);
 
            if (isNumeric) {
                centroid[key] = cluster.reduce(
                    (sum, p) => sum + (parseFloat(p[key]) || 0), 0
                ) / cluster.length;
            } else {
                const counts = {};
                cluster.forEach(p => {
                    const val = p[key];
                    if (val !== undefined && val !== null && val !== '') {
                        counts[val] = (counts[val] || 0) + 1;
                    }
                });
                let bestVal = null, maxCount = -1;
                (nominalDomains[key] || Object.keys(counts)).sort().forEach(val => {
                    if ((counts[val] || 0) > maxCount) {
                        maxCount = counts[val] || 0;
                        bestVal = val;
                    }
                });
                centroid[key] = bestVal;
            }
        });
 
        cluster.forEach(point => {
            const dist = calculateClusteringDistance(point, centroid, evalKeys);
            totalSSE += dist * dist;
        });
    });
 
    return totalSSE;
}

function assignTestData(modelInstance, testData, algo) {
    const testClusters = Array.from({ length: modelInstance.k || modelInstance.centroids.length }, () => []);
    testData.forEach(point => {
        let bestClusterIdx = 0;
        if (algo === 'kmeans' || algo === 'clara') {
            let minDist = Infinity;
            modelInstance.centroids.forEach((c, cIdx) => {
                const d = calculateClusteringDistance(point, c, modelInstance.attributes);
                if (d < minDist) { minDist = d; bestClusterIdx = cIdx; }
            });
        } else if (algo === 'em') {
            bestClusterIdx = modelInstance.assignPoint(point);
        }
        testClusters[bestClusterIdx].push(point);
    });
    return testClusters;
}

// 2. CÁC THUẬT TOÁN PHÂN LỚP 
class KNN {
    constructor(k = 1, weighting = 'NONE', metric = 'EUCLIDEAN', crossValidate = false) {
        this.k = k; 
        this.kUpper = k; 
        this.weighting = weighting; 
        this.metric = metric;
        this.crossValidate = crossValidate;
        this.trainData = []; 
        this.features = []; 
        this.target = '';
        this.ranges = {}; 
    }
    train(data, features, target) {
        this.trainData = data; this.features = features; this.target = target;
        this.ranges = {};
        features.forEach(f => {
            const vals = data.map(d => parseFloat(d[f])).filter(v => !isNaN(v));
            if (vals.length > 0) {
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                this.ranges[f] = { min: min, max: max, range: (max - min) || 1e-9 };
            }
        });

        if (this.crossValidate && this.kUpper > 1) {
            this.selectBestK();
        }
    }

    selectBestK() {
        try {
            const KUpper = this.kUpper;
            const performanceStats = new Array(KUpper).fill(0);
            
            this.trainData.forEach((inst, i) => {
                const tempTrain = this.trainData.filter((_, idx) => idx !== i);
                const subKnn = new KNN(KUpper, this.weighting, this.metric);
                subKnn.train(tempTrain, this.features, this.target);
                
                const distances = tempTrain.map((tInst, idx) => {
                    return { index: idx, dist: subKnn.distance(inst, tInst), label: tInst[this.target] };
                });
                distances.sort((a, b) => a.dist - b.dist);

                for (let kVal = KUpper; kVal >= 1; kVal--) {
                    const kNeighbors = distances.slice(0, kVal);
                    const votes = {};
                    kNeighbors.forEach(n => {
                        const normalizedDist = n.dist / Math.sqrt(this.features.length);
                        let w = 1.0;
                        if (this.weighting === 'INVERSE') w = 1.0 / (normalizedDist + 0.001);
                        else if (this.weighting === 'SIMILARITY') w = Math.max(0, 1.0 - normalizedDist);
                        votes[n.label] = (votes[n.label] || 0) + w;
                    });
                    
                    let maxW = -1, pred = null;
                    Object.keys(votes).sort().forEach(l => {
                        if (votes[l] > maxW) { maxW = votes[l]; pred = l; }
                    });
                    if (pred !== inst[this.target]) {
                        performanceStats[kVal - 1]++;
                    }
                }
            });

            let bestK = 1, minErr = Infinity;
            for (let i = 0; i < KUpper; i++) {
                if (performanceStats[i] < minErr) { minErr = performanceStats[i]; bestK = i + 1; }
            }
            this.k = bestK;
        } catch (e) {
            this.k = 1;
        }
    }

    predict(point) {
        let distances = this.trainData.map((inst, idx) => {
            let dist = this.distance(point, inst);
            return { index: idx, dist: dist, label: inst[this.target] };
        });
        distances.sort((a, b) => a.dist - b.dist);
        let kNeighbors = distances.slice(0, this.k);
        let votes = {};
        
        let numAttributesUsed = this.features.length;

        kNeighbors.forEach(n => {
            let normalizedDist = n.dist / Math.sqrt(numAttributesUsed);
            let weight = 1.0;
            if (this.weighting === 'INVERSE') {
                weight = 1.0 / (normalizedDist + 0.001); 
            } else if (this.weighting === 'SIMILARITY') {
                weight = 1.0 - normalizedDist;
                if (weight < 0) weight = 0;
            }
            votes[n.label] = (votes[n.label] || 0) + weight;
        });
        
        let maxWeight = -1, bestLabel = null;
        let classLabels = [...new Set(this.trainData.map(d => d[this.target]))].sort(); // FIX: Sửa d[target] thành d[this.target] triệt tiêu lỗi kết quả trả về bằng 0
        classLabels.forEach(l => {
            let w = votes[l] || 0;
            if (w > maxWeight) {
                maxWeight = w;
                bestLabel = l;
            }
        });
        return bestLabel;
    }
    distance(a, b) {
        return calculateClusteringDistance(a, b, this.features, this.ranges);
    }
}

class DecisionTree {
    constructor(confidenceFactor = 0.25, minNum = 2, unpruned = false) {
        this.confidenceFactor = confidenceFactor;
        this.minNum = minNum;
        this.unpruned = unpruned;
        this.root = null;
        this.features = [];
        this.target = '';
        this.classes = [];
    }

    train(data, features, target) {
        this.features = features;
        this.target = target;
        this.classes = [...new Set(data.map(d => d[target]))].sort();

        // Dựng cây
        this.root = this.buildTree(data, features);

        if (!this.unpruned) {
            // Thu gọn cây 
            this.collapseTree(this.root);
            // Tỉa cành (Prune)
            this.pessimisticPruning(this.root);
        }
    }

    entropy(data) {
        if (!data || data.length === 0) return 0;
        let counts = {};
        data.forEach(d => { counts[d[this.target]] = (counts[d[this.target]] || 0) + 1; });
        let ent = 0, n = data.length;
        for (let k in counts) {
            let p = counts[k] / n;
            if (p > 0) ent -= p * Math.log2(p);
        }
        return ent;
    }

    
    buildTree(data, activeFeatures) {
        if (!data || data.length === 0) {
            return { isLeaf: true, label: 'Unknown', size: 0, errors: 0, counts: {} };
        }

        let counts = {};
        data.forEach(d => { counts[d[this.target]] = (counts[d[this.target]] || 0) + 1; });

        let maxCount = -1, majorityClass = null;
        let uniqueClassesInData = Object.keys(counts).sort();

        uniqueClassesInData.forEach(k => {
            if (counts[k] > maxCount) {
                maxCount = counts[k];
                majorityClass = k;
            }
        });

        if (uniqueClassesInData.length === 1 || data.length < 2 * this.minNum || activeFeatures.length === 0) {
            return {
                isLeaf: true,
                label: majorityClass,
                size: data.length,
                errors: data.length - maxCount,
                localData: data,
                counts: counts
            };
        }

        let candidateSplits = [];
        let totalGain = 0;

        activeFeatures.forEach(f => {
            let isNumeric = isColumnNumeric(data, f);
            if (isNumeric) {
                let nonMissing = data.filter(d => typeof parseFloat(d[f]) === 'number' && !isNaN(parseFloat(d[f])) && d[f] !== undefined && d[f] !== null && d[f] !== '');
                let missingRows = data.filter(d => !(d[f] !== undefined && d[f] !== null && d[f] !== '' && !isNaN(parseFloat(d[f]))));
                let missingRatio = data.length > 0 ? nonMissing.length / data.length : 1;

                let minSplit = this.minNum;
                if (nonMissing.length < 2 * minSplit) return;

                let sorted = [...nonMissing].sort((a, b) => parseFloat(a[f]) - parseFloat(b[f]));
                let baseEntNonMissing = this.entropy(nonMissing);

                //  Đếm TẤT CẢ các điểm cắt ranh giới v1 < v2 thỏa mãn minNum
                let numCutPoints = 0;
                let totalDataLen = nonMissing.length;
                for (let i = 0; i < totalDataLen - 1; i++) {
                    let v1 = parseFloat(sorted[i][f]);
                    let v2 = parseFloat(sorted[i + 1][f]);
                    if (v1 < v2) {
                        let leftLen = i + 1;
                        let rightLen = totalDataLen - leftLen;
                        if (leftLen >= minSplit && rightLen >= minSplit) {
                            numCutPoints++;
                        }
                    }
                }

                if (numCutPoints === 0) return;
                let mdlPenalty = Math.log2(numCutPoints) / data.length;

                let bestGain = -Infinity;
                let bestThreshold = null; // Ngưỡng hiển thị chuẩn Weka (v1)
                let bestMidpoint = null;  // Ngưỡng chia nhánh thực tế (v1 + v2) / 2
                let bestSplitInfo = 0;
                let bestSplitsObj = null;

                let leftCounts = {}, rightCounts = {};
                nonMissing.forEach(d => { rightCounts[d[this.target]] = (rightCounts[d[this.target]] || 0) + 1; });

                let leftSize = 0, rightSize = nonMissing.length;

                for (let i = 0; i < totalDataLen - 1; i++) {
                    let currentClass = sorted[i][this.target];
                    leftCounts[currentClass] = (leftCounts[currentClass] || 0) + 1;
                    rightCounts[currentClass] = (rightCounts[currentClass] || 0) - 1;
                    leftSize++;
                    rightSize--;

                    let v1 = parseFloat(sorted[i][f]);
                    let v2 = parseFloat(sorted[i + 1][f]);

                    if (v1 >= v2 || Math.abs(v2 - v1) < 1e-9) continue;
                    if (leftSize < minSplit || rightSize < minSplit) continue;

                    let thresholdMid = (v1 + v2) / 2;

                    let leftEnt = 0;
                    for (let c in leftCounts) {
                        let p = leftCounts[c] / leftSize;
                        if (p > 0) leftEnt -= p * Math.log2(p);
                    }

                    let rightEnt = 0;
                    for (let c in rightCounts) {
                        let p = rightCounts[c] / rightSize;
                        if (p > 0) rightEnt -= p * Math.log2(p);
                    }

                    let subsetEnt = (leftSize / nonMissing.length) * leftEnt + (rightSize / nonMissing.length) * rightEnt;
                    let gain = (baseEntNonMissing - subsetEnt) * missingRatio - mdlPenalty;

                    if (gain > bestGain) {
                        bestGain = gain;
                        bestThreshold = v1; // 🟢 CHUẨN WEKA: Lấy giá trị thực tế lớn nhất bên trái (0.6, 1.7, 4.9, 1.5)
                        bestMidpoint = thresholdMid;
                        let pL = leftSize / nonMissing.length;
                        let pR = rightSize / nonMissing.length;
                        bestSplitInfo = - pL * Math.log2(pL) - pR * Math.log2(pR);

                        let leftFinal = nonMissing.filter(d => parseFloat(d[f]) <= thresholdMid);
                        let rightFinal = nonMissing.filter(d => parseFloat(d[f]) > thresholdMid);
                        if (missingRows.length > 0) {
                            if (leftFinal.length >= rightFinal.length) leftFinal = leftFinal.concat(missingRows);
                            else rightFinal = rightFinal.concat(missingRows);
                        }
                        bestSplitsObj = { left: leftFinal, right: rightFinal };
                    }
                }

                if (bestGain > 1e-3) {
                    let bestGainRatio = bestSplitInfo > 0 ? bestGain / bestSplitInfo : 0;
                    candidateSplits.push({ feature: f, gain: bestGain, gainRatio: bestGainRatio, threshold: bestThreshold, midpoint: bestMidpoint, splits: bestSplitsObj });
                    totalGain += bestGain;
                }
            } else {
                let nonMissing = data.filter(d => d[f] !== undefined && d[f] !== null && d[f] !== '');
                let missingRows = data.filter(d => !(d[f] !== undefined && d[f] !== null && d[f] !== ''));
                let missingRatio = data.length > 0 ? nonMissing.length / data.length : 1;

                let values = [...new Set(nonMissing.map(d => d[f]))];
                if (values.length < 2) return;
                let splits = values.map(v => nonMissing.filter(d => d[f] === v));
                let validBranches = splits.filter(s => s.length >= this.minNum).length;
                if (validBranches < 2) return;

                let subsetEnt = splits.reduce((sum, s) => sum + (s.length / nonMissing.length) * this.entropy(s), 0);
                let gain = (this.entropy(nonMissing) - subsetEnt) * missingRatio;
                let splitInfo = splits.reduce((sum, s) => sum - (s.length / nonMissing.length) * Math.log2(s.length / nonMissing.length), 0);
                let gainRatio = splitInfo > 0 ? gain / splitInfo : 0;
                if (gainRatio > 0) {
                    if (missingRows.length > 0) {
                        let maxIdx = 0, maxSize = -1;
                        splits.forEach((s, idx) => { if (s.length > maxSize) { maxSize = s.length; maxIdx = idx; } });
                        splits[maxIdx] = splits[maxIdx].concat(missingRows);
                    }
                    let splitsObj = {};
                    values.forEach((v, idx) => { splitsObj[v] = splits[idx]; });
                    candidateSplits.push({ feature: f, gain: gain, gainRatio: gainRatio, threshold: null, midpoint: null, splits: splitsObj });
                    totalGain += gain;
                }
            }
        });

        if (candidateSplits.length === 0) {
            return { isLeaf: true, label: majorityClass, size: data.length, errors: data.length - maxCount, localData: data, counts: counts };
        }

        let avgGain = totalGain / activeFeatures.length;
        let filteredSplits = candidateSplits.filter(s => s.gain >= avgGain - 1e-3);
        if (filteredSplits.length === 0) filteredSplits = candidateSplits;

        let bestSplit = filteredSplits[0];
        for (let i = 1; i < filteredSplits.length; i++) {
            if (filteredSplits[i].gainRatio > bestSplit.gainRatio) {
                bestSplit = filteredSplits[i];
            }
        }

        let finalThreshold = bestSplit.threshold;
        let finalMidpoint = bestSplit.midpoint;

        let node = {
            isLeaf: false,
            feature: bestSplit.feature,
            threshold: finalThreshold,
            majorityClass: majorityClass,
            size: data.length,
            errors: data.length - maxCount,
            children: {},
            localData: data,
            counts: counts
        };

        let nextFeatures = activeFeatures.filter(f => f !== bestSplit.feature);
        if (bestSplit.threshold !== null) {
            let leftData = data.filter(d => parseFloat(d[bestSplit.feature]) <= finalMidpoint);
            let rightData = data.filter(d => parseFloat(d[bestSplit.feature]) > finalMidpoint);
            node.children['left'] = this.buildTree(leftData, activeFeatures);
            node.children['right'] = this.buildTree(rightData, activeFeatures);
        } else {
            for (let v in bestSplit.splits) {
                node.children[v] = this.buildTree(bestSplit.splits[v], nextFeatures);
            }
        }
        return node;
    }

    collapseTree(node) {
        if (node.isLeaf) return;
        for (let k in node.children) {
            this.collapseTree(node.children[k]);
        }
        let subtreeTrainingErrors = this.getActualSubtreeTrainingErrors(node);
        let leafTrainingErrors = node.errors;
        if (subtreeTrainingErrors >= leafTrainingErrors - 1e-3) {
            node.isLeaf = true;
            node.label = node.majorityClass;
            node.children = null;
        }
    }

    getActualSubtreeTrainingErrors(node) {
        if (node.isLeaf) return node.errors;
        let sum = 0;
        for (let k in node.children) {
            sum += this.getActualSubtreeTrainingErrors(node.children[k]);
        }
        return sum;
    }

    //Tái tính toán phân phối đếm số lượng mẫu khi nâng nhánh
    resetDistribution(node, data) {
        if (!data) return;
        node.localData = data;
        node.size = data.length;

        let counts = {};
        data.forEach(d => { counts[d[this.target]] = (counts[d[this.target]] || 0) + 1; });
        node.counts = counts;

        let maxCount = -1, majorityClass = null;
        let uniqueClassesInData = Object.keys(counts).sort();
        uniqueClassesInData.forEach(k => {
            if (counts[k] > maxCount) {
                maxCount = counts[k];
                majorityClass = k;
            }
        });

        node.majorityClass = majorityClass || (this.root ? this.root.majorityClass : 'Unknown');
        node.errors = data.length - maxCount;

        if (node.isLeaf) {
            node.label = node.majorityClass;
        } else {
            if (node.threshold !== null) {
                let leftData = data.filter(d => parseFloat(d[node.feature]) <= node.threshold);
                let rightData = data.filter(d => parseFloat(d[node.feature]) > node.threshold);
                if (node.children['left']) this.resetDistribution(node.children['left'], leftData);
                if (node.children['right']) this.resetDistribution(node.children['right'], rightData);
            } else {
                for (let k in node.children) {
                    let childData = data.filter(d => String(d[node.feature]) === String(k));
                    this.resetDistribution(node.children[k], childData);
                }
            }
        }
    }

   
    pessimisticPruning(node) {
        if (node.isLeaf) return;

        for (let k in node.children) {
            this.pessimisticPruning(node.children[k]);
        }

        let largestChildKey = null;
        let maxChildSize = -1;
        for (let k in node.children) {
            if (node.children[k].size > maxChildSize) {
                maxChildSize = node.children[k].size;
                largestChildKey = k;
            }
        }

        let errorsLargestBranch = Infinity;
        let largestChild = null;

        if (largestChildKey !== null) {
            largestChild = node.children[largestChildKey];
            errorsLargestBranch = this.getBranchEstimatedErrors(largestChild, node.localData);
        }

        let errorsLeaf = this.getEstimatedErrors(node.size, node.errors);
        let errorsTree = this.getSubtreeEstimatedErrors(node);

        // 🟢 4. CHUẨN WEKA: Dùng dung sai + 1e-3 (không dùng + 0.1)
        if (errorsLeaf <= errorsTree + 1e-3 && errorsLeaf <= errorsLargestBranch + 1e-3) {
            node.isLeaf = true;
            node.label = node.majorityClass;
            node.children = null;
            return;
        }

        if (errorsLargestBranch <= errorsTree + 1e-3 && largestChild) {
            node.isLeaf = largestChild.isLeaf;
            node.feature = largestChild.feature;
            node.threshold = largestChild.threshold;
            node.majorityClass = largestChild.majorityClass;
            node.children = largestChild.children;
            node.label = largestChild.label;

            this.resetDistribution(node, node.localData);
            this.pessimisticPruning(node);
        }
    }

    normalInverse(p) {
        if (p <= 0) return -Infinity;
        if (p >= 1) return Infinity;
        const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
        const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
        const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
        const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
        let q, r;
        if (p < 0.02425) {
            q = Math.sqrt(-2 * Math.log(p));
            return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                   ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        } else if (p <= 1 - 0.02425) {
            q = p - 0.5; r = q * q;
            return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
                   (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
        } else {
            q = Math.sqrt(-2 * Math.log(1 - p));
            return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
                     ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
        }
    }

    addErrs(N, e, CF) {
        if (CF > 0.5) return 0;
        if (e < 1) {
            let base = N * (1 - Math.pow(CF, 1 / N));
            if (e === 0) return base;
            return base + e * (this.addErrs(N, 1, CF) - base);
        }
        if (e + 0.5 >= N) {
            return Math.max(N - e, 0);
        }
        let z = this.normalInverse(1 - CF);
        let f = (e + 0.5) / N;
        let r = (f + (z * z) / (2 * N) + z * Math.sqrt((f / N) - (f * f / N) + (z * z / (4 * N * N)))) / (1 + (z * z) / N);
        return (r * N) - e;
    }

    getEstimatedErrors(n, e) {
        if (n === 0) return 0;
        return e + this.addErrs(n, e, this.confidenceFactor);
    }

    getSubtreeEstimatedErrors(node) {
        if (node.isLeaf) return this.getEstimatedErrors(node.size, node.errors);
        let sum = 0;
        for (let k in node.children) { sum += this.getSubtreeEstimatedErrors(node.children[k]); }
        return sum;
    }

    getBranchEstimatedErrors(treeNode, dataset) {
        if (!dataset || dataset.length === 0) return 0;

        if (treeNode.isLeaf) {
            let incorrect = 0;
            dataset.forEach(point => {
                if (point[this.target] !== treeNode.label) {
                    incorrect++;
                }
            });
            return incorrect + this.addErrs(dataset.length, incorrect, this.confidenceFactor);
        }

        let f = treeNode.feature;
        if (treeNode.threshold !== null) {
            let leftData = [], rightData = [];
            dataset.forEach(point => {
                let val = parseFloat(point[f]);
                if (!isNaN(val) && val <= treeNode.threshold) {
                    leftData.push(point);
                } else {
                    rightData.push(point);
                }
            });
            return this.getBranchEstimatedErrors(treeNode.children['left'], leftData) +
                   this.getBranchEstimatedErrors(treeNode.children['right'], rightData);
        } else {
            let sum = 0;
            for (let k in treeNode.children) {
                let childData = dataset.filter(point => String(point[f]) === String(k));
                sum += this.getBranchEstimatedErrors(treeNode.children[k], childData);
            }
            return sum;
        }
    }

    getDistribution(node, point) {
        if (node.isLeaf) {
            let dist = {};
            let totalSize = node.size || 1;
            let nodeCounts = node.counts || {};
            let currentClasses = (this.classes && this.classes.length > 0) ? this.classes : Object.keys(nodeCounts).sort();

            currentClasses.forEach(c => {
                dist[c] = (nodeCounts[c] || 0) / totalSize;
            });
            return dist;
        }

        let f = node.feature;
        let val = point[f];

        let isMissing = (val === undefined || val === null || val === '');
        if (!isMissing && node.threshold !== null) {
            if (isNaN(parseFloat(val))) {
                isMissing = true;
            }
        }

        if (isMissing) {
            let dist = {};
            let totalSize = node.size || 1;
            for (let k in node.children) {
                let child = node.children[k];
                let weight = child.size / totalSize;
                let childDist = this.getDistribution(child, point);
                for (let c in childDist) {
                    dist[c] = (dist[c] || 0) + (childDist[c] || 0) * weight;
                }
            }
            return dist;
        }

        if (node.threshold !== null) {
            let nextNode = (parseFloat(val) <= node.threshold) ? node.children['left'] : node.children['right'];
            return this.getDistribution(nextNode, point);
        } else {
            if (node.children[val]) {
                return this.getDistribution(node.children[val], point);
            } else {
                let dist = {};
                let totalSize = node.size || 1;
                for (let k in node.children) {
                    let child = node.children[k];
                    let weight = child.size / totalSize;
                    let childDist = this.getDistribution(child, point);
                    for (let c in childDist) {
                        dist[c] = (dist[c] || 0) + (childDist[c] || 0) * weight;
                    }
                }
                return dist;
            }
        }
    }

    predict(point) {
        let dist = this.getDistribution(this.root, point);
        let maxProb = -1;
        let bestClass = null;

        let sortedClasses = Object.keys(dist).sort();
        for (let i = 0; i < sortedClasses.length; i++) {
            let c = sortedClasses[i];
            if (dist[c] > maxProb) {
                maxProb = dist[c];
                bestClass = c;
            }
        }
        return bestClass || (this.root ? this.root.majorityClass : 'Unknown');
    }
}


function buildDecisionTreeHTML(node) {

    if (!node) return '';

    if (node.isLeaf) {

        return `
            <li>
                <span class="dt-leaf">
                    ${node.label}
                </span>
            </li>
        `;
    }

    let html = `
        <li>
            <span class="dt-node">
                ${node.feature}
                ${node.threshold !== null
                    ? ' ≤ ' + Number(node.threshold).toFixed(3)
                    : ''}
            </span>

            <ul>
    `;

    Object.keys(node.children).forEach(key => {

        html += `
            <li>

                <span class="dt-branch">

                    ${
                        key === 'left'
                        ? '≤ ' + Number(node.threshold).toFixed(3)
                        : key === 'right'
                        ? '> ' + Number(node.threshold).toFixed(3)
                        : key
                    }

                </span>

                <ul>
                    ${buildDecisionTreeHTML(
                        node.children[key]
                    )}
                </ul>

            </li>
        `;
    });

    html += `
            </ul>
        </li>
    `;

    return html;
}

class NaiveBayes {
    constructor(useKernel = false, useDiscretization = false) {
        this.useKernel = useKernel;
        this.useDiscretization = useDiscretization;
        this.classes = [];
        this.classPriors = {};
        this.normalParams = {};
        this.nominalProbs = {};
        this.target = '';
        this.features = [];
        this.rawTrainData = [];
        this.splitPoints = {}; 
        this.precisions = {};
    }

    erf(x) {
        const a1 =  0.254829592;
        const a2 = -0.284496736;
        const a3 =  1.421413741;
        const a4 = -1.453152027;
        const a5 =  1.061405429;
        const p  =  0.3275911;
        const sign = (x < 0) ? -1 : 1;
        const t = 1.0 / (1.0 + p * Math.abs(x));
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
    }

    normalCDF(x, mean, std) {
        return 0.5 * (1.0 + this.erf((x - mean) / (std * Math.sqrt(2))));
    }

    findOptimalSplitPoints(data, feature, target) {
        const values = data.map(d => ({ val: d[feature], label: d[target] }))
                           .filter(d => typeof d.val === 'number' && !isNaN(d.val))
                           .sort((a, b) => a.val - b.val);
        if (values.length < 2) return [];

        const splits = [];
        
        const calculateEntropy = (subset) => {
            const counts = {};
            subset.forEach(item => { counts[item.label] = (counts[item.label] || 0) + 1; });
            let ent = 0, n = subset.length;
            for (let k in counts) {
                const p = counts[k] / n;
                ent -= p * Math.log2(p);
            }
            return ent;
        };

        const recursiveSplit = (subset) => {
            if (subset.length < 4) return;
            let bestGain = -1, bestIdx = -1;
            let baseEnt = calculateEntropy(subset);
            const N = subset.length;

            const distinctClassCount = (arr) => new Set(arr.map(x => x.label)).size;
            const numClassesS = distinctClassCount(subset);

            for (let i = 1; i < subset.length - 1; i++) {
                if (subset[i].val === subset[i + 1].val) continue;

                const left = subset.slice(0, i + 1);
                const right = subset.slice(i + 1);

                const leftEnt = calculateEntropy(left);
                const rightEnt = calculateEntropy(right);
                const infoGain = baseEnt - ((left.length / N) * leftEnt + (right.length / N) * rightEnt);

                if (infoGain > bestGain) {
                    bestGain = infoGain;
                    bestIdx = i;
                }
            }

            if (bestIdx === -1) return;

            const left = subset.slice(0, bestIdx + 1);
            const right = subset.slice(bestIdx + 1);
            const numClasses1 = distinctClassCount(left);
            const numClasses2 = distinctClassCount(right);
            const entropy1 = calculateEntropy(left);
            const entropy2 = calculateEntropy(right);

            const delta = Math.log2(Math.pow(3, numClassesS) - 2) -
                          (numClassesS * baseEnt - numClasses1 * entropy1 - numClasses2 * entropy2);
            const mdlThreshold = (Math.log2(N - 1) + delta) / N;

            if (bestGain > mdlThreshold) {
                const splitVal = (subset[bestIdx].val + subset[bestIdx + 1].val) / 2;
                splits.push(splitVal);
                recursiveSplit(left);
                recursiveSplit(right);
            }
        };

        recursiveSplit(values);
        splits.sort((a, b) => a - b);
        return splits;
    }

    getDiscretizedInterval(val, splits) {
        if (splits.length === 0) return "all";
        for (let i = 0; i < splits.length; i++) {
            if (val <= splits[i]) {
                if (i === 0) return `<= ${splits[i].toFixed(4)}`;
                return `(${splits[i-1].toFixed(4)}, ${splits[i].toFixed(4)}]`;
            }
        }
        return `> ${splits[splits.length - 1].toFixed(4)}`;
    }

    train(data, features, target) {
        this.rawTrainData = data; this.features = features; this.target = target;
        this.classes = [...new Set(data.map(d => d[target]))];
        const n = data.length;

        this.precisions = {};
        features.forEach(f => {
            if (isColumnNumeric(data, f)) {
                const vals = data.map(d => d[f]).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
                let precision = 0.01; 
                if (vals.length > 0) {
                    let lastVal = vals[0];
                    let deltaSum = 0;
                    let distinct = 0;
                    for (let i = 1; i < vals.length; i++) {
                        let currentVal = vals[i];
                        if (currentVal !== lastVal) {
                            deltaSum += currentVal - lastVal;
                            lastVal = currentVal;
                            distinct++;
                        }
                    }
                    if (distinct > 0) {
                        precision = deltaSum / distinct;
                    }
                }
                this.precisions[f] = precision;
            }
        });

        if (this.useDiscretization) {
            this.splitPoints = {};
            features.forEach(f => {
                if (isColumnNumeric(data, f)) {
                    this.splitPoints[f] = this.findOptimalSplitPoints(data, f, target);
                }
            });
        }

        this.classes.forEach(c => {
            const classSubset = data.filter(d => d[target] === c);
            this.classPriors[c] = (classSubset.length + 1) / (n + this.classes.length);
            this.normalParams[c] = {};
            this.nominalProbs[c] = {};

            features.forEach(f => {
                const isNumeric = isColumnNumeric(data, f);
                if (isNumeric && !this.useDiscretization) {
                    const precision = this.precisions[f] || 0.01;
            
                    const roundToPrecision = v => Math.round(v / precision) * precision;
                    const vals = classSubset.map(d => parseFloat(d[f])).filter(v => !isNaN(v)).map(roundToPrecision);

                    if (this.useKernel) {
                        const kernel = new KernelEstimator(precision);
                        vals.forEach(v => kernel.addValue(v, 1.0));
                        this.normalParams[c][f] = { useKernel: true, kernel: kernel };
                    } else {
                        const mean = vals.reduce((sum, v) => sum + v, 0) / (vals.length || 1);
                        let variance = vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (vals.length || 1);
                        const minStdDev = precision / 6;
                        const minVariance = minStdDev * minStdDev;
                        if (variance < minVariance) variance = minVariance;
                        this.normalParams[c][f] = { useKernel: false, mean: mean, variance: variance };
                    }
                } else {
                    const counts = {};
                    classSubset.forEach(d => {
                        let val = d[f];
                        if (isNumeric && this.useDiscretization) {
                            val = this.getDiscretizedInterval(val, this.splitPoints[f]);
                        }
                        counts[val] = (counts[val] || 0) + 1;
                    });

                    let domain;
                    if (isNumeric && this.useDiscretization) {
                        const splits = this.splitPoints[f];
                        domain = [];
                        if (splits.length === 0) {
                            domain.push("all");
                        } else {
                            domain.push(`<= ${splits[0].toFixed(4)}`);
                            for (let i = 1; i < splits.length; i++) {
                                domain.push(`(${splits[i-1].toFixed(4)}, ${splits[i].toFixed(4)}]`);
                            }
                            domain.push(`> ${splits[splits.length - 1].toFixed(4)}`);
                        }
                    } else {
                        domain = [...new Set(data.map(d => d[f]))];
                    }

                    this.nominalProbs[c][f] = {};
                    domain.forEach(val => {
                        this.nominalProbs[c][f][val] = ((counts[val] || 0) + 1) / (classSubset.length + domain.length);
                    });
                    this.nominalProbs[c][f]['_default'] = 1.0 / (classSubset.length + domain.length);
                }
            });
        });
    }

    predict(point) {
        let bestClass = null, bestLogProb = -Infinity;
        this.classes.forEach(c => {
            let logProb = Math.log(this.classPriors[c]);
            this.features.forEach(f => {
                const val = point[f];
                if (val === undefined || val === null || val === '') return; 
                
                const isNumeric = isColumnNumeric(this.rawTrainData, f);
                if (isNumeric && !this.useDiscretization) {
                    let prob = 1e-75;
                    const params = this.normalParams[c][f];
                    if (this.useKernel && params.useKernel) {
                        prob = params.kernel.getProbability(val);
                    } else {
                        const mean = params.mean;
                        const v = params.variance;
                        const std = Math.sqrt(v);
                        const precision = this.precisions[f] || 0.01;
                        const upper = this.normalCDF(val + precision / 2.0, mean, std);
                        const lower = this.normalCDF(val - precision / 2.0, mean, std);
                        prob = upper - lower;
                    }
                    logProb += Math.log(Math.max(1e-75, prob));
                } else {
                    let discVal = val;
                    if (isNumeric && this.useDiscretization) {
                        discVal = this.getDiscretizedInterval(val, this.splitPoints[f]);
                    }
                    const prob = this.nominalProbs[c][f][discVal] || this.nominalProbs[c][f]['_default'] || 1e-5;
                    logProb += Math.log(prob);
                }
            });
            if (logProb > bestLogProb) { bestLogProb = logProb; bestClass = c; }
        });
        return bestClass;
    }
}


class RegressionModel {
    constructor(type = 'linear', degree = 1) {
        this.type = type; // 'linear' | 'polynomial'
        this.degree = degree;
        this.coefficients = [];
    }

    train(data, xKey, yKey) {
        const x = data.map(d => parseFloat(d[xKey]));
        const y = data.map(d => parseFloat(d[yKey]));
        const n = data.length;

        if (this.type === 'linear') {
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for(let i=0; i<n; i++) {
                sumX += x[i]; sumY += y[i];
                sumXY += (x[i] * y[i]); sumXX += (x[i] * x[i]);
            }
            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            const intercept = (sumY - slope * sumX) / n;
            this.coefficients = [intercept, slope];
        }
    }

    predict(val) {
        if (this.type === 'linear') {
            return this.coefficients[0] + this.coefficients[1] * val;
        }
        return 0;
    }
}


class LinearRegression {
    constructor(ridge = 1e-8) {
        this.ridge = ridge;
        this.coefficients = [];
        this.intercept = 0;
        this.features = [];
        this.target = '';
        this.means = {};
    }

    train(data, features, target) {
        this.features = features;
        this.target = target;
        const N = data.length;
        const P = features.length;

        if (N === 0 || P === 0) return;

        // Tính trung bình các cột để thay thế dữ liệu khuyết thiếu (Imputation)
        features.forEach(f => {
            const vals = data.map(d => parseFloat(d[f])).filter(v => !isNaN(v));
            this.means[f] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        });

        const X = [];
        const Y = [];

        data.forEach(row => {
            const xRow = [];
            features.forEach(f => {
                let val = parseFloat(row[f]);
                if (isNaN(val)) val = this.means[f];
                xRow.push(val);
            });
            X.push(xRow);
            Y.push(parseFloat(row[target]) || 0);
        });

        // Xây dựng ma trận 
        const X_aug = X.map(row => [1, ...row]);
        const cols = P + 1;
        const XtX = Array.from({ length: cols }, () => new Array(cols).fill(0));
        const XtY = new Array(cols).fill(0);

        for (let i = 0; i < N; i++) {
            for (let r = 0; r < cols; r++) {
                XtY[r] += X_aug[i][r] * Y[i];
                for (let c = 0; c < cols; c++) {
                    XtX[r][c] += X_aug[i][r] * X_aug[i][c];
                }
            }
        }

        for (let r = 1; r < cols; r++) {
            XtX[r][r] += this.ridge;
        }

        const beta = this._solveLinearSystem(XtX, XtY);

        this.intercept = beta[0];
        this.coefficients = beta.slice(1);
    }

    predict(point) {
        let pred = this.intercept;
        for (let j = 0; j < this.features.length; j++) {
            const f = this.features[j];
            let val = parseFloat(point[f]);
            if (isNaN(val)) val = this.means[f] || 0;
            pred += this.coefficients[j] * val;
        }
        return pred;
    }

    _solveLinearSystem(A, B) {
        const n = B.length;
        const M = A.map((row, i) => [...row, B[i]]);

        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
            }
            const temp = M[i]; M[i] = M[maxRow]; M[maxRow] = temp;

            if (Math.abs(M[i][i]) < 1e-12) continue;

            for (let k = i + 1; k < n; k++) {
                const c = -M[k][i] / M[i][i];
                for (let j = i; j <= n; j++) {
                    if (i === j) M[k][j] = 0;
                    else M[k][j] += c * M[i][j];
                }
            }
        }

        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            x[i] = M[i][n] / (M[i][i] || 1e-12);
            for (let k = i - 1; k >= 0; k--) {
                M[k][n] -= M[k][i] * x[i];
            }
        }
        return x;
    }
}


class LogisticRegression {
    constructor(lr = 0.1, epochs = 500) {
        this.lr = lr;
        this.epochs = epochs;
        this.weights = [];
        this.bias = 0;
        this.features = [];
        this.target = '';
        this.means = {};
        this.stds = {};
        this.classes = [];   
        this._posClass = null; 
    }

    _sigmoid(z) {
        return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, z))));
    }

    train(data, features, target) {
        this.features = features;
        this.target = target;
        const N = data.length;
        const P = features.length;
        if (N === 0 || P === 0) return;

    
        const classSet = [...new Set(data.map(row => String(row[target])))];
        this.classes = classSet;
        
        const sorted = [...classSet].sort();
        this._posClass = sorted[sorted.length - 1];
        const posLabel = this._posClass;

        features.forEach(f => {
            const vals = data.map(d => parseFloat(d[f])).filter(v => !isNaN(v));
            const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            const variance = vals.length > 0 ? vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length : 0;
            this.means[f] = mean;
            this.stds[f] = Math.sqrt(variance) || 1;
        });

        const X = data.map(row =>
            features.map(f => {
                let val = parseFloat(row[f]);
                if (isNaN(val)) val = this.means[f];
                return (val - this.means[f]) / this.stds[f];
            })
        );

        // Chuyển nhãn mục tiêu về dạng 0 hoặc 1
        const Y = data.map(row => {
            return String(row[target]) === String(posLabel) ? 1 : 0;
        });

        this.weights = new Array(P).fill(0);
        this.bias = 0;

        
        for (let epoch = 0; epoch < this.epochs; epoch++) {
            let dBias = 0;
            const dWeights = new Array(P).fill(0);

            for (let i = 0; i < N; i++) {
                let z = this.bias;
                for (let j = 0; j < P; j++) {
                    z += this.weights[j] * X[i][j];
                }
                const pred = this._sigmoid(z);
                const err = pred - Y[i];

                dBias += err;
                for (let j = 0; j < P; j++) {
                    dWeights[j] += err * X[i][j];
                }
            }

            this.bias -= (this.lr / N) * dBias;
            for (let j = 0; j < P; j++) {
                this.weights[j] -= (this.lr / N) * dWeights[j];
            }
        }
    }

    predictProb(point) {
        let z = this.bias;
        for (let j = 0; j < this.features.length; j++) {
            const f = this.features[j];
            let val = parseFloat(point[f]);
            if (isNaN(val)) val = this.means[f] || 0;
            const normVal = (val - (this.means[f] || 0)) / (this.stds[f] || 1);
            z += this.weights[j] * normVal;
        }
        return this._sigmoid(z);
    }

    predict(point) {
        
        const prob = this.predictProb(point);
        return prob >= 0.5 ? this._posClass : (this.classes.find(c => c !== this._posClass) || this._posClass);
    }
}

// ĐỌc FILE
function parseARFF(text) {
    const lines = text.split('\n');
    const attributes = [];
    const data = [];
    let inData = false;
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('%')) continue;
        if (line.toLowerCase().startsWith('@relation')) continue;
        if (line.toLowerCase().startsWith('@attribute')) {
            const parts = line.split(/\s+/);
            const name = parts[1].trim();
            const type = parts.slice(2).join(' ').trim();
            attributes.push({ name, type });
            continue;
        }
        if (line.toLowerCase().startsWith('@data')) {
            inData = true;
            continue;
        }
        if (inData) {
            const values = line.split(',').map(v => v.trim());
            if (values.length < attributes.length) continue;
            const row = {};
            attributes.forEach((attr, idx) => {
                const val = values[idx];
                const isNumeric = attr.type.toLowerCase().includes('real') || attr.type.toLowerCase().includes('numeric') || attr.type.toLowerCase().includes('integer');
                
                // Nếu không phải số, tự động bóc tách sạch các dấu ngoặc bao quanh
                let cleanVal = isNumeric ? parseFloat(val) : String(val).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
                row[attr.name] = cleanVal;
            });
            data.push(row);
        }
    }
    return data;
}

function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};

        headers.forEach((h, i) => {
            // Làm sạch chuỗi trước khi parse
            let rawVal = values[i] !== undefined ? String(values[i]).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') : '';
            const val = parseFloat(rawVal);
            obj[h] = isNaN(val) ? rawVal : val;
        });
        return obj;
    }).filter(row => Object.keys(row).length === headers.length);
}


/* xử lý các dạng tệp .txt */
function parseTXT(text) {
    if (!text || !text.trim()) return [];
    
    // Tách dòng hỗ trợ \r\n (Windows), \n (Linux) và \r (Mac)
    const lines = text.trim().split(/\r?\n|\r/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const candidates = ['\t', ',', ';', '|'];
    const sampleLines = lines.slice(0, Math.min(5, lines.length));
    
    let bestDelimiter = null;
    let maxAvgCols = 0;

    for (const delim of candidates) {
        let counts = sampleLines.map(line => line.split(delim).length);
        let avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        if (avg > 1 && avg > maxAvgCols) {
            maxAvgCols = avg;
            bestDelimiter = delim;
        }
    }

    function splitLine(line, delim) {
        let rawTokens = [];
        if (delim) {
            rawTokens = line.split(delim);
        } else {
            rawTokens = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || line.trim().split(/\s+/);
        }
        return rawTokens.map(v => String(v).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''));
    }

    const headers = splitLine(lines[0], bestDelimiter);
    if (headers.length === 0) return [];

    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const values = splitLine(lines[i], bestDelimiter);
        if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

        const obj = {};
        headers.forEach((h, colIdx) => {
            let rawVal = values[colIdx] !== undefined ? values[colIdx] : '';
            if (rawVal !== '' && !isNaN(Number(rawVal))) {
                obj[h] = Number(rawVal);
            } else {
                obj[h] = rawVal;
            }
        });
        result.push(obj);
    }
    return result;
}
// kết quả sơ đồ
var COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#6366f1', '#ef4444', '#14b8a6', '#f43f5e', '#84cc16', '#06b6d4', '#d946ef'];
var parsedData = []; 
var numericFeatures = []; 
var displayResults = [];

var classificationExportData = null;

function drawClassDistribution(canvas, data, allKeys, numKeys) {
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const targetKey = allKeys[allKeys.length - 1]; const isNumeric = numKeys.indexOf(targetKey) !== -1;
    let labels = [], counts = [];
    if (isNumeric) {
        const vals = data.map(d => parseFloat(d[targetKey])).filter(v => !isNaN(v)); const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        const binCount = 6; const binSize = (max - min) / binCount || 1; counts = new Array(binCount).fill(0);
        vals.forEach(v => { let idx = Math.floor((v - min) / binSize); if (idx >= binCount) idx = binCount - 1; counts[idx]++; });
        for (let i = 0; i < binCount; i++) labels.push(`${(min + i * binSize).toFixed(1)}-${(min + (i + 1) * binSize).toFixed(1)}`);
    } else {
        const freqs = {}; data.forEach(d => { const val = d[targetKey] || 'Unknown'; freqs[val] = (freqs[val] || 0) + 1; });
        const sorted = Object.keys(freqs).map(k => [k, freqs[k]]).sort((a, b) => b[1] - a[1]);
        labels = sorted.slice(0, 12).map(x => x[0]); counts = sorted.slice(0, 12).map(x => x[1]);
    }
    const maxCount = Math.max.apply(null, counts) || 1; const w = canvas.width; const h = canvas.height;
    const paddingBottom = 45; const paddingTop = 20; const chartH = h - paddingBottom - paddingTop;
    const spacing = w / counts.length; const barW = spacing * 0.6; const totalInstances = data.length;
    counts.forEach((count, i) => {
        const barH = (count / maxCount) * chartH; const x = i * spacing + (spacing - barW) / 2; const y = h - paddingBottom - barH;
        ctx.fillStyle = COLORS[i % COLORS.length]; ctx.beginPath(); 
        if(ctx.roundRect) { ctx.roundRect(x, y, barW, barH, [6, 6, 0, 0]); } else { ctx.rect(x, y, barW, barH); }
        ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = '#475569'; ctx.font = 'bold 11px sans-serif';
        ctx.fillText((labels[i].length > 10 ? labels[i].substring(0, 8) + '...' : labels[i]).toUpperCase(), x + barW / 2, h - 28);
        if (!isNumeric) {
            ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.fillText(count, x + barW / 2, h - 14);
            ctx.fillStyle = '#94a3b8'; ctx.fillText(((count / totalInstances) * 100).toFixed(1) + '%', x + barW / 2, h - 2);
        }
    });
}

function drawMiniHistogram(canvas, vals, min, max) {
    if (!canvas) return; const ctx = canvas.getContext('2d'); const bins = new Array(10).fill(0);
    vals.forEach(v => { let idx = Math.floor((v - min) / (max - min || 1) * 10); if (idx === 10) idx = 9; bins[idx]++; });
    const maxFreq = Math.max.apply(null, bins) || 1; const w = canvas.width; const h = canvas.height; const barW = w / 10;
    ctx.fillStyle = '#5b5de5';
    bins.forEach((freq, i) => { const barH = (freq / maxFreq) * h * 0.9; ctx.beginPath(); if(ctx.roundRect) { ctx.roundRect(i * barW + 2, h - barH, barW - 4, barH, [4, 4, 0, 0]); } else { ctx.rect(i * barW + 2, h - barH, barW - 4, barH); } ctx.fill(); });
}

let _lastDendrogramCanvas = null;
let _lastDendrogramTree = null;

function drawDendrogram(canvas, rootNode) {
    _lastDendrogramCanvas = canvas;
    _lastDendrogramTree = rootNode;

    const FIXED_SCALE = 1.5; 
    const dpr = Math.max(window.devicePixelRatio || 1, 1) * FIXED_SCALE;

    const rectW = canvas.clientWidth || 800;
    function totalLeaves(node) { if (!node.children) return 1; return totalLeaves(node.children[0]) + totalLeaves(node.children[1]); }
    const totalL = totalLeaves(rootNode);
    const leafSpacing = 42; const padding = 35; const rectH = Math.max(500, totalL * leafSpacing + padding * 2); 
    
    canvas.style.width = '100%';
    canvas.style.height = rectH + 'px';
    canvas.width = Math.round(rectW * dpr);
    canvas.height = Math.round(rectH * dpr);
    const ctx = canvas.getContext('2d'); 
    ctx.scale(dpr, dpr); 
    ctx.clearRect(0, 0, rectW, rectH);

    // 🟢 BỔ SUNG 2 DÒNG NÀY: Tô màu nền trắng rõ ràng cho Canvas trước khi vẽ cây
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rectW, rectH);

    ctx.textRendering = 'optimizeLegibility';
    
    const margin = 190; const drawWidth = rectW - margin - 35; const drawHeight = rectH - padding * 2;
    let leafCount = 0;
    function assignLayout(node) {
        if (!node.children) { node.y = padding + (leafCount++) * (drawHeight / Math.max(1, totalL - 1)); return; }
        assignLayout(node.children[0]); assignLayout(node.children[1]);
        node.y = (node.children[0].y + node.children[1].y) / 2;
    }
    assignLayout(rootNode);
    const maxH = rootNode.height || 1;

    function render(node, x, y) {
        if (!node.children) {
            ctx.fillStyle = '#1e293b'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.font = '700 14px Helvetica, Arial, sans-serif'; 
            const originalRow = parsedData.find(x => x._originalId === node.points[0]._originalId);
            let label = (originalRow && originalRow.name) ? originalRow.name : `Item ${node.id}`;

            // tách dấu ngoặc trước khi vẽ chữ lên Canvas
            if (typeof label === 'string') {
                label = label.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
            }

            ctx.fillText(label, margin - 15, y); 
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(margin - 8, y); ctx.stroke();
            return;
        }
        const xChild = (node.height / maxH) * drawWidth + margin; const yLeft = node.children[0].y; const yRight = node.children[1].y;
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xChild, y); ctx.moveTo(xChild, yLeft); ctx.lineTo(xChild, yRight); ctx.stroke();
        render(node.children[0], xChild, yLeft); render(node.children[1], xChild, yRight);
    }
    render(rootNode, drawWidth + margin, rootNode.y);
}

let _dendrogramResizeTimer = null;
function _scheduleDendrogramRedraw() {
    if (!_lastDendrogramCanvas || !_lastDendrogramTree) return;
    if (!document.body.contains(_lastDendrogramCanvas)) return;
    clearTimeout(_dendrogramResizeTimer);
    _dendrogramResizeTimer = setTimeout(function () {
        drawDendrogram(_lastDendrogramCanvas, _lastDendrogramTree);
    }, 200);
}
window.addEventListener('resize', _scheduleDendrogramRedraw);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _scheduleDendrogramRedraw);
}

function processLoadedData(data) {
    parsedData = data.map(row => {
        const cleanRow = {};
        Object.keys(row).forEach(key => {
            let rawVal = row[key];
            
            if (typeof rawVal === 'string') {
                rawVal = rawVal.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
            }
            const val = parseFloat(rawVal);
            cleanRow[key] = isNaN(val) ? (rawVal !== undefined ? String(rawVal).trim() : '') : val;
        });
        return cleanRow;
    });

    if (parsedData.length === 0) return;
    let duplicateCount = 0; const seenRows = new Set();
    parsedData.forEach((row, i) => {
        row._originalId = i;
        const rowForCompare = { ...row }; delete rowForCompare._originalId;
        const rowString = JSON.stringify(rowForCompare);
        if (seenRows.has(rowString)) { duplicateCount++; } else { seenRows.add(rowString); }
    });
    
    isDataNormalized = false;

    const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
    const numKeys = allKeys.filter((k, idx) => {
        const isNumType = isColumnNumeric(parsedData, k);
        const isLastClassCol = (idx === allKeys.length - 1);
        return isNumType && !isLastClassCol; 
    });
    const outlierData = getOutlierData(parsedData, numKeys);

    let missingCount = 0;
    parsedData.forEach(row => {
        Object.keys(row).forEach(k => {
            if (k !== '_originalId') {
                const val = row[k];
                if (val === '' || val === null || val === undefined || (typeof val === 'number' && isNaN(val))) {
                    missingCount++;
                }
            }
        });
    });

    renderDataLoader(parsedData); 
    $('#st-duplicates').text(duplicateCount.toLocaleString()); 
    $('#st-outliers').text(outlierData.count.toLocaleString());
    $('#st-missing').text(missingCount.toLocaleString());
    
    $('#empty-dataloader-wrapper').hide(); $('#dataloader-content').fadeIn(); $('#empty-results').css('display', 'flex'); $('#resultSection').hide();
    const $alertContainer = $('#alert-container').empty(); const totalRows = parsedData.length;
    
    if (outlierData.count > 0) { 
        $alertContainer.append(`<div class="custom-alert alert-danger"><div class="alert-icon">⚠️</div><div class="alert-content"><div class="alert-title">Outliers detected: ${outlierData.count.toLocaleString()} outlier values identified</div><div class="alert-desc">Recommendation: Use "Winsorize Outliers" to preserve your dataset or "Remove Outliers" to delete them. Additionally, consider using the robust "Robust Scale" normalization.</div></div><button class="btn-alert-action btn-open-preprocess">Open Preprocessing</button></div>`); 
    }
    if (duplicateCount > 0) { 
        const dupPercent = ((duplicateCount / totalRows) * 100).toFixed(1); 
        $alertContainer.append(`<div class="custom-alert alert-warning"><div class="alert-icon">⚠️</div><div class="alert-content"><div class="alert-title">Duplicate data detected: ${duplicateCount.toLocaleString()} rows (${dupPercent}%) are duplicates</div><div class="alert-desc">Recommendation: Use "Remove Duplicates" or related filters in preprocessing</div></div><button class="btn-alert-action btn-open-preprocess">Open Preprocessing</button></div>`); 
    }
}

function renderDataLoader(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => k !== '_originalId');
    numericFeatures = keys.filter(k => isColumnNumeric(data, k));
    $('#st-rows').text(data.length.toLocaleString()); $('#st-cols').text(keys.length);
    $('#st-num').text(numericFeatures.length); $('#st-cat').text(keys.length - numericFeatures.length);
    const $statsList = $('#stats-summary-list').empty();
    
    numericFeatures.forEach(key => {
        const vals = data.map(d => parseFloat(d[key])).filter(v => !isNaN(v));
        const min = Math.min.apply(null, vals).toFixed(2); const max = Math.max.apply(null, vals).toFixed(2);
        const mean = (vals.reduce((sum, v) => sum + v, 0) / vals.length).toFixed(2);
        const std = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length).toFixed(2);
        const thresholds = getIqrThresholds(data, key);
        let outlierCountForAttr = 0;
        if (thresholds) {
            data.forEach(row => {
                const val = parseFloat(row[key]);
                if (!isNaN(val)) { if (val > thresholds.upperOutlier || val < thresholds.lowerOutlier) outlierCountForAttr++; }
            });
        }
        const outlierHtml = thresholds ? `<div style="display:flex;justify-content:space-between;color:#ef4444;font-weight:600;margin-top:8px;font-size:12px;"><span>  Outliers:</span><span>${outlierCountForAttr} values</span></div>` : '';
        $statsList.append(`<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);"><div style="font-weight:600;font-size:13px;color:var(--text-dark);margin-bottom:8px;">${key}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-muted);"><div style="display:flex;justify-content:space-between;"><span>Min:</span><span style="color:var(--text-dark);font-weight:500;">${min}</span></div><div style="display:flex;justify-content:space-between;"><span>Max:</span><span style="color:var(--text-dark);font-weight:500;">${max}</span></div><div style="display:flex;justify-content:space-between;"><span>Mean:</span><span style="color:var(--text-dark);font-weight:500;">${mean}</span></div><div style="display:flex;justify-content:space-between;"><span>StdDev:</span><span style="color:var(--text-dark);font-weight:500;">${std}</span></div></div>${outlierHtml}</div>`);
    });

    drawClassDistribution(document.getElementById('classDistChart'), data, keys, numericFeatures);
    const $thead = $('#preview-table thead').empty().append('<tr><th>ROW</th></tr>');
    keys.forEach(k => $thead.find('tr').append($('<th>').text(k)));
    const $tbody = $('#preview-table tbody').empty();
    data.slice(0, 10).forEach((row, idx) => { const $tr = $('<tr>').append($('<td>').text(idx + 1)); keys.forEach(k => $tr.append($('<td>').text(row[k]))); $tbody.append($tr); });
    
    const $targetSelect = $('#targetLabelSelect').empty();
    if (keys.length > 0) {
        keys.forEach(k => {
            const isNumeric = isColumnNumeric(data, k);
            const typePrefix = isNumeric ? ' (Numeric)' : ' (Nominal)';
            $targetSelect.append(`<option value="${k}">${typePrefix} ${k}</option>`);
        });
    } else {
        $targetSelect.append('<option value="">-- Không có thuộc tính --</option>');
    }

    const $classList = $('#classFeaturesList').empty();
    keys.forEach(key => {
        const isNumeric = isColumnNumeric(data, key);
        const typePrefix = isNumeric ? ' (Numeric)' : ' (Nominal)';
        const checkedAttribute = 'checked';
        $classList.append(`<label style="display:block;margin-bottom:4px;font-size:13px;" id="lbl-class-feat-${key}"><input type="checkbox" class="class-feat-checkbox" value="${key}" ${checkedAttribute}> <span style="color: var(--text-muted); font-size: 11px; font-weight: 600;">${typePrefix}</span> ${key}</label>`);
    });

    function updateClassFeaturesDisabling() {
    const selectedTarget = $('#targetLabelSelect').val();
    $('.class-feat-checkbox').each(function() {
        const val = $(this).val();
        $(this).prop('disabled', false);
        
        // Dùng getElementById thuần của JS để nhận diện tên cột có khoảng trắng và ngoặc (cm)
        const elem = document.getElementById('lbl-class-feat-' + val);
        if (elem) {
            elem.style.display = 'block';
        }
    });
}

    updateClassFeaturesDisabling();
    $('#targetLabelSelect').off('change').on('change', function() {
        updateClassFeaturesDisabling();
    });

   
    const $regTarget = $('#regTargetSelect').empty();
    keys.forEach(k => {
        if (isColumnNumeric(data, k)) {
            $regTarget.append(`<option value="${k}">${k}</option>`);
        }
    });
    if ($regTarget.find('option').length === 0) {
        $regTarget.append('<option value="">-- No numeric columns --</option>');
    }


    function updateRegFeaturesList() {
        const targetAttr = $('#regTargetSelect').val();
        const attrIndexStr = $('#regAttrIndex').val() || '-1';
        const allCols = keys.filter(k => k !== '_originalId');
        const selectedFeatures = parseAttrIndex(attrIndexStr, allCols);
        const $list = $('#regFeaturesList').empty();

        allCols.forEach(key => {
            const isSelected = selectedFeatures.includes(key);
            const isTarget = key === targetAttr;
            $list.append(`<label style="display:block;margin-bottom:4px;font-size:13px;${isTarget ? 'opacity:0.4;pointer-events:none;' : ''}">
                <input type="checkbox" class="reg-feat-checkbox" value="${key}" ${isSelected && !isTarget ? 'checked' : ''} ${isTarget ? 'disabled' : ''}>
                ${key}${isTarget ? ' (target)' : ''}
            </label>`);
        });

        // cập nhật số lượng thuộc tính đang được chọn
        function refreshRegSummary() {
            const checkedCount = $('#regFeaturesList .reg-feat-checkbox:checked').length;
            const summaryText = (attrIndexStr === '-1')
                ? `Đã chọn: ${checkedCount} thuộc tính (Auto-select all)`
                : `Đã chọn: ${checkedCount} thuộc tính từ index "${attrIndexStr}"`;
            $('#regAttrIndexSummary').text(summaryText);
        }

        refreshRegSummary();

        $('#regFeaturesList').off('change', '.reg-feat-checkbox').on('change', '.reg-feat-checkbox', refreshRegSummary);
    }


    function parseAttrIndex(indexStr, allCols) {
        if (!indexStr || !allCols.length) return [];
        const s = indexStr.trim().toLowerCase();

        if (s === '-1' || s === '') {
            return [...allCols];
        }

        const result = [];
        const parts = s.split(',').map(p => p.trim()).filter(p => p);

        for (const part of parts) {
            if (part === 'first-last') {
                result.push(...allCols);
            } else if (part === 'first') {
                if (allCols.length > 0) result.push(allCols[0]);
            } else if (part === 'last') {
                if (allCols.length > 0) result.push(allCols[allCols.length - 1]);
            } else if (part.includes('-') && !part.startsWith('-')) { // Sửa: Chỉ xử lý dạng dải (VD: 1-3), bỏ qua số âm như -1
                const [start, end] = part.split('-').map(p => p.trim());
                let si = parseInt(start) - 1;
                let ei = end === 'last' ? allCols.length - 1 : parseInt(end) - 1;
                if (!isNaN(si) && !isNaN(ei)) {
                    si = Math.max(0, si);
                    ei = Math.min(allCols.length - 1, ei);
                    for (let i = si; i <= ei; i++) result.push(allCols[i]);
                }
            } else {
                const idx = parseInt(part) - 1;
                if (!isNaN(idx) && idx >= 0 && idx < allCols.length) {
                    result.push(allCols[idx]);
                }
            }
        }

        return [...new Set(result)];
    }

    updateRegFeaturesList();


    $('#regTargetSelect').off('change').on('change', updateRegFeaturesList);
    $('#regAttrIndex').off('input').on('input', updateRegFeaturesList);

    const $visContainer = $('#vis-container').empty();
    numericFeatures.forEach(key => {
        const vals = data.map(d => parseFloat(d[key])).filter(v => !isNaN(v)); const min = Math.min.apply(null, vals); const max = Math.max.apply(null, vals);
        const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length; const std = Math.sqrt(vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length);
        $visContainer.append(`<div class="vis-card"><div class="vis-header"><div><div class="vis-title">${key}</div><div class="badge-numeric">Numeric</div></div></div><div class="vis-stats"><div>Mean: ${mean.toFixed(2)}<br>Min: ${min.toFixed(2)}</div><div style="text-align:right;">Std: ${std.toFixed(2)}<br>Max: ${max.toFixed(2)}</div></div><div class="vis-canvas-wrap"><canvas id="hist-${key}" width="200" height="100" style="width:100%;height:100%;"></canvas></div></div>`);
        drawMiniHistogram(document.getElementById(`hist-${key}`), vals, min, max);
    });

    const $list = $('#featuresList').empty();
    keys.forEach(key => { 
        const isNumeric = isColumnNumeric(data, key);
        const typePrefix = isNumeric ? ' (Numeric)' : ' (Nominal)';
        $list.append(`<label style="display:block;margin-bottom:4px;font-size:13px;"><input type="checkbox" value="${key}" checked> <span style="color: var(--text-muted); font-size: 11px; font-weight: 600;">${typePrefix}</span> ${key}</label>`); 
    });
}

function renderPreprocessTable(data) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]).filter(k => k !== '_originalId');
    const $thead = $('#preprocess-table thead').empty().append('<tr><th>ROW</th></tr>');
    keys.forEach(k => $thead.find('tr').append($('<th>').text(k)));
    const $tbody = $('#preprocess-table tbody').empty();
    data.forEach((row, idx) => {
        const $tr = $('<tr>').append($('<td>').text(idx + 1));
        keys.forEach(k => {
            let cellValue = row[k];
            $tr.append(`<td>${cellValue !== null && cellValue !== '' ? cellValue : 'NaN'}</td>`);
        });
        $tbody.append($tr);
    });
}

function renderChart(clusters) {
    const canvas = document.getElementById('scatterChart'); 
    const dpr = window.devicePixelRatio || 1;
    const rectW = canvas.clientWidth || 800; 
    const rectH = canvas.clientHeight || 350;
    canvas.width = rectW * dpr; 
    canvas.height = rectH * dpr;
    const ctx = canvas.getContext('2d'); 
    ctx.scale(dpr, dpr); 
    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, rectW, rectH);
    if (!clusters || clusters.length === 0) return;
    
    const k = clusters.length;
    const pad = 100;
    const w = rectW - pad * 2;
    const h = rectH - pad * 2;
    
    clusters.forEach((c, idx) => {
        const centerX = pad + (w / (k > 1 ? k - 1 : 1)) * idx;
        const centerY = rectH / 2;
        
        ctx.fillStyle = COLORS[idx % COLORS.length] + '15';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 65, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS[idx % COLORS.length] + '40';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = COLORS[idx % COLORS.length];
        ctx.font = 'bold 13px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(`Cụm ${idx + 1} (${c.length} dòng)`, centerX, centerY - 80);
        
        c.forEach((p, pIdx) => {
            const angle = pIdx * (137.5 * Math.PI / 180);
            const radius = Math.min(50, 10 + Math.sqrt(pIdx) * 14);
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            
            ctx.fillStyle = COLORS[idx % COLORS.length];
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            ctx.fillStyle = '#1e293b';
            ctx.font = '10px sans-serif';
            ctx.fillText(p.name || p.class || `Dòng ${p._originalId || pIdx}`, x, y - 11);
        });
    });
}

function renderClusterTables(clusters) {
    const $tabs = $('#clusterTabs').empty(); const $content = $('#clusterContent').empty();
    if (!clusters || clusters.length === 0) return;
    let keys = []; for (let i = 0; i < clusters.length; i++) { if (clusters[i].length > 0) { keys = Object.keys(clusters[i][0]).filter(k => k !== '_originalId'); break; } }
    clusters.forEach((cluster, idx) => {
        const isActive = idx === 0 ? 'active' : ''; const tabColor = COLORS[idx % COLORS.length];
        $tabs.append(`<button class="cluster-tab-btn ${isActive}" data-idx="${idx}" style="border:1px solid ${tabColor};color:${tabColor};background:${isActive ? tabColor + '20' : 'transparent'};padding:6px 16px;border-radius:20px;font-weight:bold;cursor:pointer;transition:all 0.2s;">Nhóm ${idx + 1} (${cluster.length.toLocaleString()})</button>`);
        let tableHtml = `<div class="cluster-table-wrap" id="c-table-${idx}" style="display:${isActive ? 'block' : 'none'};"><table class="clustering-table" style="min-width:800px;"><thead><tr><th>#</th>`;
        keys.forEach(k => tableHtml += `<th>${k}</th>`); tableHtml += `</tr></thead><tbody>`;
        cluster.slice(0, 100).forEach((row, rIdx) => {
            tableHtml += `<tr><td>${rIdx + 1}</td>`;
            keys.forEach(k => { let val = row[k]; if (typeof val === 'number' && !Number.isInteger(val)) val = val.toFixed(4); tableHtml += `<td>${val}</td>`; }); tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table></div>`; $content.append(tableHtml);
    });

    // Cập nhật cho gom cụm
    $('#btnUpdateWikiCrop').remove();
    $content.append(`
        <div style="margin-top: 20px; display: flex; justify-content: center;">
            <button id="btnUpdateWikiCrop" style="background:#10b981; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(16,185,129,0.2);">
                ✨ Cập nhật WikiCrop
            </button>
        </div>
    `);

    $('.cluster-tab-btn').on('click', function () {
        $('.cluster-tab-btn').each(function () { $(this).css('background', 'transparent').removeClass('active'); });
        const color = $(this).css('color'); $(this).css('background', color.replace(')', ', 0.12)').replace('rgb', 'rgba')).addClass('active');
        const targetIdx = $(this).data('idx'); $('.cluster-table-wrap').hide(); $(`#c-table-${targetIdx}`).show();
    });
}

$(function () {
    $('.menu-item').on('click', function () {
        const $submenu = $(this).next('.submenu');
        if ($submenu.length > 0) { $(this).toggleClass('expanded'); $submenu.slideToggle(200); return; }
        if ($(this).data('nav')) {
            $('.menu-item, .submenu li').removeClass('active'); $(this).addClass('active');
            const targetView = $(this).data('nav');
            $('.view-section').removeClass('active'); $('#view-' + targetView).addClass('active');
            $('#current-step-title').text($(this).text().replace(/▼|▲/g, '').replace(/[\n\r]+/g, ' ').trim().replace(/^\d+\s*/, ''));
            if (targetView === 'preprocess' && parsedData.length > 0) {
                const keys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
                const $sel = $('#filter-col-select').empty();
                keys.forEach(k => $sel.append($('<option>').val(k).text(k)));
                renderPreprocessTable(parsedData);
            }
        }
    });

    $('#algorithm').on('change', function () {
        const val = $(this).val();
        $('#lbl-algo-header').text($(this).find('option:selected').text());
        $('#kValueContainer').hide(); $('#seedContainer').hide(); $('#hcLinkageContainer').hide();
        $('#emMaxIterGroup').hide();

        let descText = "";
        if (val === 'kmeans' || val === 'clara') {
            $('#kValueContainer').show(); $('#seedContainer').show();
            if (val === 'kmeans') descText = "K-means clustering algorithm.";
            if (val === 'clara') descText = "Clustering Large Applications (CLARA) algorithm.";
        } else if (val === 'hierarchical') {
            $('#kValueContainer').hide(); $('#hcLinkageContainer').show();
            descText = "Hierarchical clustering algorithm .";
        } else if (val === 'em') {
            $('#kValueContainer').show(); $('#emMaxIterGroup').show();
            descText = "EM (expectation maximisation) class.";
        } else {
            showAppMessage('Tính năng tinh giản', 'Hệ thống tự động chuyển về giải thuật K-Means.', 'info');
            $('#algorithm').val('kmeans').trigger('change');
            return;
        }
        $('#algo-desc').text(descText);
    });

    $('#classAlgorithm').on('change', function() {
        const val = $(this).val();
        $('#lbl-class-algo-header').text($(this).find('option:selected').text());
        
        $('#knnNeighborsContainer, #knnDistanceContainer, #knnWeightingContainer, #knnAutoSelectContainer').hide();
        $('#treeConfidenceFactorContainer, #treeMinNumContainer, #treeUnprunedContainer').hide();
        $('#nbKernelEstimatorContainer, #nbSupervisedDiscretizationContainer').hide();

        let descText = "";
        if (val === 'knn') {
            $('#knnNeighborsContainer, #knnDistanceContainer, #knnWeightingContainer, #knnAutoSelectContainer').show();
            descText = "KNN (K-Nearest Neighbors classifier).";
        } else if (val === 'decision_tree') {
            $('#treeConfidenceFactorContainer, #treeMinNumContainer, #treeUnprunedContainer').show();
            descText = "J48 (C4.5 decision tree implementation).";
        } else if (val === 'naive_bayes') {
            $('#nbKernelEstimatorContainer, #nbSupervisedDiscretizationContainer').show();
            descText = "Naive Bayes class for classification.";
        } else if (val === 'logistic_regression') {
            $('#lrLearningRateContainer, #lrEpochsContainer').show();
            descText = "Logistic Regression classifier using gradient descent optimization.";
        }
        $('#class-algo-desc').text(descText);
    });


    // Tự động tính toán và hiển thị số % Test còn lại khi người dùng thay đổi số % Train
    $(document).on('input change', '#clusterSplitPercent, #classSplitPercent, #regSplitPercent', function () {
        let val = parseInt($(this).val()) || 80;
        val = Math.max(1, Math.min(99, val));
        let testVal = 100 - val;

        if ($(this).attr('id') === 'clusterSplitPercent') {
            $('#clusterTestPercent').val(testVal);
        } else if ($(this).attr('id') === 'classSplitPercent') {
            $('#classTestPercent').val(testVal);
        } else if ($(this).attr('id') === 'regSplitPercent') {
            $('#regTestPercent').val(testVal);
        }
    });


    $(document).on('change input', 'input[name="testopt"], #clusterSplitPercent', function () {
        const evalMethod = $('input[name="testopt"]:checked').val();
        if ($('#lbl-cluster-eval-header').length) {
            if (evalMethod === 'training') {
                $('#lbl-cluster-eval-header').text('Full training set');
            } else if (evalMethod === 'split') {
                const pct = Math.max(1, Math.min(99, parseInt($('#clusterSplitPercent').val()) || 80));
                $('#lbl-cluster-eval-header').text(`Percentage split (${pct}% Train, ${100 - pct}% Test)`);
            }
        }
    });

    $(document).on('change input', 'input[name="classTestopt"], #classCvFolds, #classSplitPercent', function () {
        const evalMethod = $('input[name="classTestopt"]:checked').val();
        if (evalMethod === 'training') {
            $('#lbl-class-eval-header').text('Full training set');
        } else if (evalMethod === 'split') {
            const pct = Math.max(1, Math.min(99, parseInt($('#classSplitPercent').val()) || 80));
            $('#lbl-class-eval-header').text(`Percentage split (${pct}% Train, ${100 - pct}% Test)`);
        } else if (evalMethod === 'cv') {
            const numFolds = Math.max(2, parseInt($('#classCvFolds').val()) || 10);
            $('#lbl-class-eval-header').text(numFolds + '-fold cross-validation');
        }
    });

    $(document).on('change input', 'input[name="regTestopt"], #regCvFolds, #regSplitPercent', function () {
        const evalMethod = $('input[name="regTestopt"]:checked').val();
        if (evalMethod === 'training') {
            $('#lbl-reg-eval-header').text('Full training set');
        } else if (evalMethod === 'split') {
            const pct = Math.max(1, Math.min(99, parseInt($('#regSplitPercent').val()) || 80));
            $('#lbl-reg-eval-header').text(`Percentage split (${pct}% Train, ${100 - pct}% Test)`);
        } else if (evalMethod === 'cv') {
            const numFolds = Math.max(2, parseInt($('#regCvFolds').val()) || 10);
            $('#lbl-reg-eval-header').text(numFolds + '-fold cross-validation');
        }
    });

    $(document).on('click', '#btn-toggle-sidebar', function () { $('#clustering-app').toggleClass('sidebar-hidden'); $(this).text($('#clustering-app').hasClass('sidebar-hidden') ? '❯' : '❮'); });
    $(document).on('click', '#btn-toggle-config', function () { $(this).closest('.view-section').find('.ml-layout').toggleClass('config-hidden'); $(this).text($(this).closest('.view-section').find('.ml-layout').hasClass('config-hidden') ? '❯' : '❮'); });
    $(document).on('click', '#btn-toggle-class-config', function() { $(this).closest('.view-section').find('.ml-layout').toggleClass('config-hidden'); $(this).text($(this).closest('.view-section').find('.ml-layout').hasClass('config-hidden') ? '❯' : '❮'); });

    $('.submenu li').on('click', function () {
        if ($(this).data('nav')) {
            $('.menu-item, .submenu li').removeClass('active'); $(this).addClass('active'); $(this).parent().prev('.menu-item').addClass('active');
            const targetView = $(this).data('nav');
            $('.view-section').removeClass('active'); $('#view-' + targetView).addClass('active');
            $('#current-step-title').text('ML Task - ' + $(this).text().trim());
            if (targetView === 'clustering') $('#algorithm').val('kmeans').trigger('change');
            if (targetView === 'classification') $('#classAlgorithm').val('knn').trigger('change');
        }
    });
    
    $('[data-tab]').on('click', function () { $('.clustering-tab').removeClass('active'); $(this).addClass('active'); $('.tab-pane').hide(); $('#' + $(this).data('tab')).show(); });
    $('.ml-config-tab').on('click', function () {
        const $p = $(this).closest('.ml-config-panel');
        $p.find('.ml-config-tab').removeClass('active'); $(this).addClass('active');
        $p.find('.ml-config-content').hide(); $('#' + $(this).data('panel')).fadeIn(200);
    });

    $('.btn-new-session').on('click', function() { location.reload(); });
    // $('#btnUploadCenter').on('click', function (e) { e.stopPropagation(); $('#fileInput').trigger('click'); });


    // // 🟢 CHÈN DÒNG NÀY NGAY BÊN DƯỚI #btnUploadCenter
    // $(document).on('click', '#btnSelectWikiFile', function (e) {
    //     e.stopPropagation();
    //     showWikiCropFileSelector();
    // });

    // $('#empty-dataloader').on('click', function () { $('#fileInput').trigger('click'); });

    // 🟢 1. Nút "Tải từ máy tính" -> Mở chọn tệp từ máy
    $(document).off('click', '#btnUploadCenter').on('click', '#btnUploadCenter', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $('#fileInput').trigger('click');
    });

    // 🟢 2. Nút "Chọn từ kho Wikicrop" -> CHỈ mở Modal Wikicrop
    $(document).off('click', '#btnSelectWikiFile').on('click', '#btnSelectWikiFile', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showWikiCropFileSelector();
    });

    // 🟢 3. Khung viền nét đứt -> Kiểm tra xem điểm bấm có thuộc về 2 nút bấm hay không
    $(document).off('click', '#empty-dataloader').on('click', '#empty-dataloader', function (e) {
        // Nếu nhấp trúng hoặc nằm trong 2 nút bấm "Chọn từ kho Wikicrop" / "Tải từ máy tính", HUỶ SỰ KIỆN KHUNG CHA NGAY LẬP TỨC
        if ($(e.target).closest('#btnSelectWikiFile, #btnUploadCenter').length > 0) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
        
        // Chỉ khi nhấp vào khoảng trống xung quanh trong khung mới mở chọn file máy tính
        $('#fileInput').trigger('click');
    });

    $('#fileInput').on('change', function (e) {
        const file = e.target.files[0]; if (!file) return;
        $('#fileName').text(file.name); $('#fileBadge').css('display', 'flex');
        const reader = new FileReader();
        const extension = file.name.split('.').pop().toLowerCase();

        if (extension === 'xlsx' || extension === 'xls') {
            reader.onload = function (evt) {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                processLoadedData(json);
            };
            reader.readAsArrayBuffer(file);
        } else if (extension === 'arff') {
            reader.onload = function (evt) {
                const parsed = parseARFF(evt.target.result);
                processLoadedData(parsed);
            };
            reader.readAsText(file, 'UTF-8');
        } else if (extension === 'txt') {
            reader.onload = function (evt) {
                const parsed = parseTXT(evt.target.result); 
                processLoadedData(parsed);
            };
            reader.readAsText(file, 'UTF-8');
        } else {
            reader.onload = function (evt) {
                const parsed = parseCSV(evt.target.result); 
                processLoadedData(parsed);
            };
            reader.readAsText(file, 'UTF-8');
        }
    });
    
    $(document).on('click', '.btn-open-preprocess', function () { $('.menu-item[data-nav="preprocess"]').trigger('click'); });
    $('#filter-type').on('change', function () { $(this).val() === 'drop-col' ? $('#filter-col-group').show() : $('#filter-col-group').hide(); });

    $('#btnApplyFilter').on('click', function () {
        if (!parsedData || parsedData.length === 0) { showAppMessage('Lỗi tiền xử lý', 'Vui lòng nạp tệp dữ liệu trước khi áp dụng bộ lọc!', 'error'); return; }
        const type = $('#filter-type').val(); let newData = [...parsedData];

        if (type === 'remove-missing') {
            newData = parsedData.filter(row => { let ok = true; Object.keys(row).forEach(k => { if (k !== '_originalId' && (row[k] === '' || row[k] === null || (typeof row[k] === 'number' && isNaN(row[k])))) ok = false; }); return ok; });
            const r = parsedData.length - newData.length; $('#preprocess-status').text(r === 0 ? '✨ Dữ liệu sạch!' : `✅ Đã xóa ${r} dòng thiếu dữ liệu.`);
        } else if (type === 'replace-mean') {
            newData = JSON.parse(JSON.stringify(parsedData));
            const nk = Object.keys(newData[0]).filter(k => isColumnNumeric(parsedData, k)); let replaced = 0;
            nk.forEach(k => { const vals = parsedData.map(r => parseFloat(r[k])).filter(v => !isNaN(v)); const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; newData.forEach(row => { if (row[k] === '' || row[k] === null || isNaN(parseFloat(row[k]))) { row[k] = parseFloat(mean.toFixed(4)); replaced++; } }); });
            $('#preprocess-status').text(replaced === 0 ? '✨ Dữ liệu đầy đủ!' : `✅ Đã điền trung bình cho ${replaced} ô trống.`);
        } else if (type === 'drop-col') {
            const col = $('#filter-col-select').val(); newData = parsedData.map(row => { const r = { ...row }; delete r[col]; return r; });
            $('#preprocess-status').text(`✅ Đã xóa thuộc tính: ${col}`);
        } else if (type === 'remove-duplicates') {
            const seen = new Set(); newData = parsedData.filter(row => { const r = { ...row }; delete r._originalId; const s = JSON.stringify(r); if (seen.has(s)) return false; seen.add(s); return true; });
            const r = parsedData.length - newData.length; $('#preprocess-status').text(r === 0 ? '✨ Không có dòng trùng lặp.' : `✅ Đã xóa ${r} dòng trùng lặp.`);
        } else if (type === 'remove-outliers') {
            const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
            const numKeys = allKeys.filter((k, idx) => { return isColumnNumeric(parsedData, k) && (idx !== allKeys.length - 1) && k !== 'species_id' && k !== 'id' && k !== 'class' && k !== 'species'; });
            const outlierData = getOutlierData(parsedData, numKeys); 
            newData = parsedData.filter((row, idx) => !outlierData.indices.has(idx));
            const r = parsedData.length - newData.length; 
            $('#preprocess-status').text(r === 0 ? '✨ Không tìm thấy ngoại lai để xóa.' : `✅ Đã xóa hoàn toàn ${r} dòng chứa giá trị ngoại lai.`);
        } else if (type === 'winsorize-outliers') {
            const allKeys = Object.keys(parsedData[0]).filter(k => k !== '_originalId');
            const numKeys = allKeys.filter((k, idx) => { return isColumnNumeric(parsedData, k) && (idx !== allKeys.length - 1) && k !== 'species_id' && k !== 'id' && k !== 'class' && k !== 'species'; });
            const thresholds = {};
            numKeys.forEach(k => { thresholds[k] = getIqrThresholds(parsedData, k); }); // Sửa lỗi viết cách tên hàm chuẩn hóa getIqrThresholds
            let modifiedCells = 0; let modifiedRows = new Set();
            newData = parsedData.map((row, idx) => {
                const newRow = { ...row };
                numKeys.forEach(k => {
                    const t = thresholds[k];
                    if (t && typeof newRow[k] === 'number' && !isNaN(newRow[k])) {
                        if (newRow[k] > t.upperOutlier) { newRow[k] = parseFloat(t.upperOutlier.toFixed(4)); modifiedCells++; modifiedRows.add(idx); } 
                        else if (newRow[k] < t.lowerOutlier) { newRow[k] = parseFloat(t.lowerOutlier.toFixed(4)); modifiedCells++; modifiedRows.add(idx); }
                    }
                });
                return newRow;
            });
            $('#preprocess-status').text(`✅ Đã chặn biên (Winsorization) làm mượt ${modifiedCells} giá trị trên ${modifiedRows.size} giống cây trồng.`);
        } else if (type === 'normalize-minmax') {
            newData = JSON.parse(JSON.stringify(parsedData)); const nk = Object.keys(newData[0]).filter(k => isColumnNumeric(parsedData, k) && k !== '_originalId');
            const params = getNormalizationParams(parsedData, nk); newData.forEach(row => { nk.forEach(k => { if (typeof row[k] === 'number') row[k] = parseFloat(((row[k] - params[k].min) / params[k].range).toFixed(4)); }); });
            $('#preprocess-status').text(`✅ Đã chuẩn hóa Min-Max [0,1] cho ${nk.length} thuộc tính số.`);
        } else if (type === 'standardize-zscore') {
            newData = JSON.parse(JSON.stringify(parsedData)); const nk = Object.keys(newData[0]).filter(k => isColumnNumeric(parsedData, k) && k !== '_originalId');
            const params = getZScoreParams(parsedData, nk); newData.forEach(row => { nk.forEach(k => { if (typeof row[k] === 'number') row[k] = parseFloat(((row[k] - params[k].mean) / params[k].std).toFixed(4)); }); });
            $('#preprocess-status').text(`✅ Đã chuẩn hóa Z-score (Mean=0, Std=1) cho ${nk.length} thuộc tính.`);
        } else if (type === 'normalize-robust') {
            newData = JSON.parse(JSON.stringify(parsedData)); 
            const nk = Object.keys(newData[0]).filter(k => isColumnNumeric(parsedData, k) && k !== '_originalId');
            const params = getRobustParams(parsedData, nk); 
            newData.forEach(row => { 
                nk.forEach(k => { 
                    if (typeof row[k] === 'number') { row[k] = parseFloat(((row[k] - params[k].median) / params[k].iqr).toFixed(4)); }
                }); 
            });
            isDataNormalized = true;
            $('#preprocess-status').text(`✅ Đã áp dụng Robust Scaling (Sử dụng Median & IQR) bền vững cho ${nk.length} thuộc tính số.`);
        }
        parsedData = newData; renderPreprocessTable(parsedData); renderDataLoader(parsedData); $('#alert-container').empty();
    });

 
    let dtZoomLevel = 1.0;
    let dtCurrentRoot = null;

  
    function computeTreeLayout(root) {
        let leafCounter = 0;
        let maxDepth = 0;
        const nodes = [];

        function walk(node, depth, edgeLabel) {
            maxDepth = Math.max(maxDepth, depth);
            if (node.isLeaf) {
                const entry = { node: node, x: leafCounter++, depth: depth, edgeLabel: edgeLabel, isLeaf: true, parent: null };
                nodes.push(entry);
                return entry;
            }
            const childEntries = [];
            const keys = Object.keys(node.children);
            keys.forEach(function (k) {
                let label;
                if (node.threshold !== null) {
                    label = (k === 'left') ? ('≤ ' + node.threshold.toFixed(2)) : ('> ' + node.threshold.toFixed(2));
                } else {
                    label = String(k);
                }
                const childEntry = walk(node.children[k], depth + 1, label);
                childEntries.push(childEntry);
            });
            const x = childEntries.reduce(function (s, c) { return s + c.x; }, 0) / childEntries.length;
            const entry = { node: node, x: x, depth: depth, edgeLabel: edgeLabel, isLeaf: false, parent: null, childEntries: childEntries };
            childEntries.forEach(function (c) { c.parent = entry; });
            nodes.push(entry);
            return entry;
        }

        const rootEntry = walk(root, 0, null);
        return { rootEntry: rootEntry, nodes: nodes, numLeaves: leafCounter, maxDepth: maxDepth };
    }

    function drawDecisionTree(rootNode) {
        dtCurrentRoot = rootNode;
        const layout = computeTreeLayout(rootNode);

        const nodeW = 156, nodeH = 58, xGap = 26, yGap = 92;
        const totalW = Math.max(400, layout.numLeaves * (nodeW + xGap) + xGap);
        const totalH = (layout.maxDepth + 1) * yGap + nodeH + 40;

        const canvas = document.getElementById('decisionTreeCanvas');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const zoom = dtZoomLevel;
        canvas.style.width = (totalW * zoom) + 'px';
        canvas.style.height = (totalH * zoom) + 'px';
        canvas.width = totalW * zoom * dpr;
        canvas.height = totalH * zoom * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr * zoom, dpr * zoom);
        ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, totalW, totalH);

        function xPos(xSlot) { return xGap + xSlot * (nodeW + xGap) + nodeW / 2; }
        function yPos(depth) { return 20 + depth * yGap + nodeH / 2; }

        // Vẽ đường nối
        layout.nodes.forEach(function (entry) {
            if (!entry.parent) return;
            const px = xPos(entry.parent.x), py = yPos(entry.parent.depth) + nodeH / 2;
            const cx = xPos(entry.x), cy = yPos(entry.depth) - nodeH / 2;
            const midY = py + (cy - py) / 2;

            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px, midY);
            ctx.lineTo(cx, midY);
            ctx.lineTo(cx, cy);
            ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
            ctx.stroke();

            const midX = (px + cx) / 2;
            ctx.font = '11px sans-serif';
            const label = entry.edgeLabel || '';
            const textW = ctx.measureText(label).width + 10;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(midX - textW / 2, midY - 9, textW, 16);
            ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
            ctx.strokeRect(midX - textW / 2, midY - 9, textW, 16);
            ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, midX, midY);
        });

        // Vẽ node
        layout.nodes.forEach(function (entry) {
            const cx = xPos(entry.x), cy = yPos(entry.depth);
            const x0 = cx - nodeW / 2, y0 = cy - nodeH / 2;

            ctx.beginPath();
            if (ctx.roundRect) { ctx.roundRect(x0, y0, nodeW, nodeH, 8); } else { ctx.rect(x0, y0, nodeW, nodeH); }
            if (entry.isLeaf) { ctx.fillStyle = '#ecfdf5'; ctx.strokeStyle = '#10b981'; }
            else { ctx.fillStyle = '#eef2ff'; ctx.strokeStyle = '#6366f1'; }
            ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();

            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            if (entry.isLeaf) {
                ctx.fillStyle = '#065f46'; ctx.font = 'bold 12px sans-serif';
                ctx.fillText(String(entry.node.label), cx, cy - 11);
                ctx.fillStyle = '#059669'; ctx.font = '10px sans-serif';
                const correct = entry.node.size - entry.node.errors;
                ctx.fillText('(' + correct + '/' + entry.node.size + ' đúng)', cx, cy + 9);
            } else {
                ctx.fillStyle = '#3730a3'; ctx.font = 'bold 12px sans-serif';
                let fLabel = entry.node.feature;
                if (fLabel.length > 18) fLabel = fLabel.substring(0, 16) + '…';
                ctx.fillText(fLabel, cx, cy - 11);
                ctx.fillStyle = '#4f46e5'; ctx.font = '10px sans-serif';
                ctx.fillText('n = ' + entry.node.size, cx, cy + 9);
            }
        });
    }


    function setupDecisionTreeVisualization(data, features, targetLabel) {
        const cf = parseFloat($('#treeConfidenceFactor').val()) || 0.25;
        const minNum = parseInt($('#treeMinNum').val()) || 2;
        const unpruned = $('#treeUnpruned').is(':checked');
        const fullTree = new DecisionTree(cf, minNum, unpruned);
        fullTree.train(data, features, targetLabel);


        // 🟢 BỔ SUNG DÒNG NÀY: Lưu cấu trúc cây vào currentClusteringState để đồng bộ Wikitext
        if (currentClusteringState && currentClusteringState.resultData) {
            currentClusteringState.resultData.treeStructure = fullTree.root;
        }

        $('#decisionTreeCard').show();
        dtZoomLevel = 1.0;
        $('#dtZoomLabel').text('100%');
        drawDecisionTree(fullTree.root);
    }

    $(document).off('click', '#dtZoomIn').on('click', '#dtZoomIn', function () {
        dtZoomLevel = Math.min(2.5, dtZoomLevel + 0.15);
        $('#dtZoomLabel').text(Math.round(dtZoomLevel * 100) + '%');
        if (dtCurrentRoot) drawDecisionTree(dtCurrentRoot);
    });
    $(document).off('click', '#dtZoomOut').on('click', '#dtZoomOut', function () {
        dtZoomLevel = Math.max(0.4, dtZoomLevel - 0.15);
        $('#dtZoomLabel').text(Math.round(dtZoomLevel * 100) + '%');
        if (dtCurrentRoot) drawDecisionTree(dtCurrentRoot);
    });
    $(document).off('click', '#dtDownload').on('click', '#dtDownload', function () {
        const canvas = document.getElementById('decisionTreeCanvas');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'decision_tree.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

 
    $(document).off('click', '#btnDownloadDendrogram').on('click', '#btnDownloadDendrogram', function () {
        const canvas = document.getElementById('scatterChart');
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = 'dendrogram_hierarchical.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    
    $('#btnRunClassification').on('click', function () {
        if (parsedData.length === 0) { 
            showAppMessage('Chưa nạp dữ liệu', 'Vui lòng tải tệp dữ liệu trong mục Data Loader trước.', 'error'); 
            return; 
        }
        const targetLabel = $('#targetLabelSelect').val(); 
        if (!targetLabel) { 
            showAppMessage('Tham số trống', 'Vui lòng chọn nhãn Target phân lớp trước.', 'error'); 
            return; 
        }

        let selectedFeatures = []; 
        $('#classFeaturesList input:checked').each(function () { 
            const val = $(this).val();
            if (val !== targetLabel && val.toLowerCase() !== 'name' && val.toLowerCase() !== 'id') { 
                selectedFeatures.push(val); 
            }
        });
        if (selectedFeatures.length < 1) { 
            showAppMessage('Tham số trống', 'Vui lòng chọn ít nhất 1 thuộc tính dự đoán (Predictor Feature).', 'error'); 
            return; 
        }

        const algo = $('#classAlgorithm').val();
        const evalMethod = $('input[name="classTestopt"]:checked').val();
        
        $('#lbl-class-algo-header').text($('#classAlgorithm option:selected').text());
        if (evalMethod === 'training') {
            $('#lbl-class-eval-header').text('Full training set');
        } else if (evalMethod === 'split') {
            const pct = Math.max(1, Math.min(99, parseInt($('#classSplitPercent').val()) || 80));
            $('#lbl-class-eval-header').text(`Percentage split (${pct}% Train, ${100 - pct}% Test)`);
        } else if (evalMethod === 'cv') {
            const numFolds = Math.max(2, parseInt($('#classCvFolds').val()) || 10);
            $('#lbl-class-eval-header').text(numFolds + '-fold cross-validation');
        }

        let actuals = [];
        let predicted = [];
        let testX = [];

        function createClassifier() {
            if (algo === 'knn') {
                const kVal = parseInt($('#knnNeighbors').val()) || 1;
                const weighting = $('#knnDistanceWeighting').val();
                const metric = $('#knnDistanceMetric').val();
                return new KNN(kVal, weighting, metric, false);
            } else if (algo === 'naive_bayes') {
                const useKernel = $('#nbKernelEstimator').is(':checked');
                const useDiscretization = $('#nbSupervisedDiscretization').is(':checked');
                return new NaiveBayes(useKernel, useDiscretization);
            }
            
            // Mặc định hoặc khi chọn decision_tree: Luôn đọc tham số thực tế từ giao diện
            const cf = parseFloat($('#treeConfidenceFactor').val()) || 0.25;
            const minNum = parseInt($('#treeMinNum').val()) || 2;
            const unpruned = $('#treeUnpruned').is(':checked');
            return new DecisionTree(cf, minNum, unpruned);
        }


        if (evalMethod === 'training') {
            const trainData = [...parsedData];
            const testData = [...parsedData];
            
            const classifier = createClassifier();
            classifier.train(trainData, selectedFeatures, targetLabel);

            testData.forEach(point => {
                const act = point[targetLabel];
                const pred = classifier.predict(point) || 'Unknown';
                actuals.push(act);
                predicted.push(pred);
            });
            testX = testData;

        } else if (evalMethod === 'split') {
            const pct = Math.max(1, Math.min(99, parseFloat($('#classSplitPercent').val()) || 80));
            const splitRatio = pct / 100.0;

            const internalRandom = new JavaRandom(1);
            const randomizedData = [...parsedData];
            for (let i = randomizedData.length - 1; i > 0; i--) {
                const j = internalRandom.nextInt(i + 1);
                const temp = randomizedData[i];
                randomizedData[i] = randomizedData[j];
                randomizedData[j] = temp;
            }

            const splitIdx = Math.floor(randomizedData.length * splitRatio);
            const trainData = randomizedData.slice(0, splitIdx);
            const testData = randomizedData.slice(splitIdx);

            const classifier = createClassifier();
            classifier.train(trainData, selectedFeatures, targetLabel);

            testData.forEach(point => {
                const act = point[targetLabel];
                const pred = classifier.predict(point) || 'Unknown';
                actuals.push(act);
                predicted.push(pred);
            });
            testX = testData;

        } else if (evalMethod === 'cv') {
            const K = Math.max(2, parseInt($('#classCvFolds').val()) || 10);
            if (K > parsedData.length) {
                showAppMessage('Lỗi tham số', 'Số Fold không được phép lớn hơn tổng số tiêu bản dữ liệu (' + parsedData.length + ')!', 'error');
                return;
            }

            const cleanFeatures = selectedFeatures.filter(f => f.toLowerCase() !== 'id' && f.toLowerCase() !== 'name');

            const internalRandom = new JavaRandom(1);
            const randomizedData = [...parsedData];
            for (let i = randomizedData.length; i > 1; i--) {
                const j = internalRandom.nextInt(i);
                const temp = randomizedData[i - 1];
                randomizedData[i - 1] = randomizedData[j];
                randomizedData[j] = temp;
            }

            const uniqueClassesList = [...new Set(randomizedData.map(d => d[targetLabel]))].sort();
            const classBuckets = {};
            uniqueClassesList.forEach(c => { classBuckets[c] = []; });
            randomizedData.forEach(row => { classBuckets[row[targetLabel]].push(row); });

            const stratifiedData = [];
            let added = true;
            while (added) {
                added = false;
                uniqueClassesList.forEach(c => {
                    if (classBuckets[c].length > 0) {
                        stratifiedData.push(classBuckets[c].shift());
                        added = true;
                    }
                });
            }

            actuals = new Array(parsedData.length);
            predicted = new Array(parsedData.length);

            const numInstances = stratifiedData.length;
            for (let f = 0; f < K; f++) {
                let numInstForFold = Math.floor(numInstances / K);
                let remainder = numInstances % K;
                let offset = f < remainder ? f : remainder;
                if (f < remainder) numInstForFold++;

                let first = f * Math.floor(numInstances / K) + offset;
                let testIndicesSet = new Set();
                for (let i = first; i < first + numInstForFold; i++) {
                    testIndicesSet.add(i);
                }

                const foldTrainData = stratifiedData.filter((_, idx) => !testIndicesSet.has(idx));
                const foldTestData = stratifiedData.filter((_, idx) => testIndicesSet.has(idx));

                const foldClassifier = createClassifier();
                foldClassifier.train(foldTrainData, cleanFeatures, targetLabel);

                foldTestData.forEach(point => {
                    const idx = point._originalId; 
                    actuals[idx] = point[targetLabel];
                    predicted[idx] = foldClassifier.predict(point) || 'Unknown';
                });
            }

            testX = parsedData;
        }


        let correct = 0;
        let testYCount = actuals.length;
        if (testYCount === 0) {
            showAppMessage('Lỗi dữ liệu', 'Không có dữ liệu kiểm thử!', 'error');
            return;
        }

        actuals.forEach((act, idx) => {
            if (act === predicted[idx]) correct++;
        });

        // Xác định danh sách Class chuẩn xác từ domain ARFF và tập Test
        var domainClasses = nominalDomains[targetLabel] ? [...nominalDomains[targetLabel]] : [];
        var testClassesSet = new Set();
        actuals.forEach(function(a) { if (a !== undefined && a !== null) testClassesSet.add(a); });
        predicted.forEach(function(p) { if (p !== undefined && p !== null) testClassesSet.add(p); });

        var uniqueClasses = [];
        if (domainClasses.length > 0) {
            uniqueClasses = domainClasses.filter(function(c) { return testClassesSet.has(c); });
            testClassesSet.forEach(function(c) {
                if (!uniqueClasses.includes(c)) uniqueClasses.push(c);
            });
        } else {
            uniqueClasses = Array.from(testClassesSet).sort();
        }

        // Tính toán chỉ số Metrics theo đúng số lượng thực tế tập Test (actuals)
        var classMetrics = {};
        uniqueClasses.forEach(function(c) {
            var tp = 0, fp = 0, fn = 0, tn = 0;
            var testCountForClass = 0;

            for (var i = 0; i < testYCount; i++) {
                if (actuals[i] === c) testCountForClass++;

                if (actuals[i] === c && predicted[i] === c) tp++;
                else if (actuals[i] !== c && predicted[i] === c) fp++;
                else if (actuals[i] === c && predicted[i] !== c) fn++;
                else tn++;
            }
            var prec = (tp + fp) > 0 ? tp / (tp + fp) : 0;
            var rec = (tp + fn) > 0 ? tp / (tp + fn) : 0;
            var f1 = (prec + rec) > 0 ? (2 * prec * rec) / (prec + rec) : 0;
            classMetrics[c] = { precision: prec, recall: rec, f1: f1, count: testCountForClass };
        });

        var weightedPrec = 0, weightedRec = 0, weightedF1 = 0;
        uniqueClasses.forEach(function(c) {
            var w = classMetrics[c].count / testYCount;
            weightedPrec += classMetrics[c].precision * w; 
            weightedRec += classMetrics[c].recall * w; 
            weightedF1 += classMetrics[c].f1 * w;
        });

        $('#classAcc').text(((correct / testYCount) * 100).toFixed(2) + ' %');
        $('#classPre').text((weightedPrec * 100).toFixed(2) + ' %');
        $('#classRec').text((weightedRec * 100).toFixed(2) + ' %');
        $('#classF1').text((weightedF1 * 100).toFixed(2) + ' %');

        currentClusteringState.type = 'classification';
        currentClusteringState.algorithm = algo;
        currentClusteringState.dataset = $('#fileName').text();
        currentClusteringState.resultData = {
            targetLabel: targetLabel,
            accuracy: ((correct / testYCount) * 100).toFixed(2),
            precision: (weightedPrec * 100).toFixed(2),
            recall: (weightedRec * 100).toFixed(2),
            f1: (weightedF1 * 100).toFixed(2),
            instances: testYCount,
            uniqueClasses: uniqueClasses,
            confusionMatrix: null
        };

        // Tối ưu tính Confusion Matrix về O(N)
        var classMap = {};
        uniqueClasses.forEach(function(c, idx) { classMap[c] = idx; });

        var cmCounts = uniqueClasses.map(function() { return uniqueClasses.map(function() { return 0; }); });
        var maxCellVal = 1;

        for (var i = 0; i < testYCount; i++) {
            var actIdx = classMap[actuals[i]];
            var predIdx = classMap[predicted[i]];
            if (actIdx !== undefined && predIdx !== undefined) {
                cmCounts[actIdx][predIdx]++;
                if (cmCounts[actIdx][predIdx] > maxCellVal) {
                    maxCellVal = cmCounts[actIdx][predIdx];
                }
            }
        }

        var cmHtml = '<table class="confusion-matrix-table"><thead><tr><th>Thực tế \\ Dự đoán</th>';
        uniqueClasses.forEach(function(c) { cmHtml += '<th>' + c + '</th>'; }); 
        cmHtml += '</tr></thead><tbody>';

        uniqueClasses.forEach(function(actClass, ai) {
            cmHtml += '<tr><td style="text-align:left; font-weight:bold; background:#f8fafc;">' + actClass + '</td>';
            uniqueClasses.forEach(function(predClass, pi) {
                var cellCount = cmCounts[ai][pi];
                var alpha = (cellCount / maxCellVal).toFixed(2);
                var cellStyle = "";
                
                if (actClass === predClass) {
                    cellStyle = "background: rgba(34, 197, 94, " + Math.max(0.08, alpha) + "); color: " + (alpha > 0.4 ? '#064e3b' : '#15803d') + "; font-weight: bold;";
                } else {
                    if (cellCount > 0) {
                        cellStyle = "background: rgba(239, 68, 68, " + Math.max(0.08, alpha) + "); color: #b91c1c; font-weight: bold;";
                    } else {
                        cellStyle = "color: #94a3b8;";
                    }
                }
                cmHtml += '<td style="' + cellStyle + ' text-align:center;">' + cellCount + '</td>';
            });
            cmHtml += '</tr>';
        });
        cmHtml += '</tbody></table>'; 
        
        $('#confusionMatrixWrap').html(cmHtml);
        currentClusteringState.resultData.confusionMatrix = cmCounts;

        let tableHtml = `<table class="clustering-table"><thead><tr><th>STT</th><th>Nhãn thực tế (Actual)</th><th>Nhãn dự đoán (Predicted)</th><th>Trạng thái</th></tr></thead><tbody>`;
        actuals.forEach((act, idx) => {
            const pred = predicted[idx];
            const isMatch = act === pred ? '✅ Khớp nhãn' : '❌ Lệch nhãn';
            const statusColor = act === pred ? 'color:var(--success); font-weight:bold;' : 'color:#ef4444; font-weight:bold;';
            tableHtml += `<tr><td>${idx+1}</td><td>${act}</td><td>${pred}</td><td style="${statusColor}">${isMatch}</td></tr>`;
        });
        tableHtml += `</tbody></table>`; 
        $('#classPredictionTableWrap').html(tableHtml);

        classificationExportData = {
            algorithm: algo,
            targetLabel: targetLabel,
            features: selectedFeatures,
            testX: testX,
            actuals: actuals,
            predicted: predicted,
            accuracy: $('#classAcc').text(),
            precision: $('#classPre').text(),
            recall: $('#classRec').text(),
            f1: $('#classF1').text()
        };

        if (algo === 'decision_tree') {
            setupDecisionTreeVisualization(parsedData, selectedFeatures, targetLabel);
        } else {
            $('#decisionTreeCard').hide();
        }

        const canvas = document.getElementById('classScatterChart'); 
        const dpr = window.devicePixelRatio || 1;
        const rectW = canvas.clientWidth || 800; 
        const rectH = canvas.clientHeight || 400; 
        canvas.width = rectW * dpr; 
        canvas.height = rectH * dpr;
        const ctx = canvas.getContext('2d'); 
        ctx.scale(dpr, dpr); 
        ctx.fillStyle = '#ffffff'; 
        ctx.fillRect(0, 0, rectW, rectH);

        const padLeft = 80, padRight = 50, padTop = 60, padBottom = 60;
        const plotW = rectW - padLeft - padRight;
        const plotH = rectH - padTop - padBottom;
        const xMin = -0.2, xMax = 2.2, yMin = -0.2, yMax = 2.2;

        function getXPixel(xVal) { return padLeft + ((xVal - xMin) / (xMax - xMin)) * plotW; }
        function getYPixel(yVal) { return (rectH - padBottom) - ((yVal - yMin) / (yMax - yMin)) * plotH; }

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Classifier Errors', padLeft + plotW / 2, padTop - 30);

        // Vẽ lưới dọc (X ticks)
        const xTicks = [0.0, 0.5, 1.0, 1.5, 2.0];
        xTicks.forEach(t => {
            const xPos = getXPixel(t);

            ctx.beginPath();
            ctx.strokeStyle = '#cbd5e1';
            ctx.moveTo(xPos, padTop);
            ctx.lineTo(xPos, rectH - padBottom);
            ctx.stroke();

            ctx.beginPath();
            ctx.strokeStyle = '#1e293b';
            ctx.moveTo(xPos, rectH - padBottom);
            ctx.lineTo(xPos, rectH - padBottom + 5);
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(t.toFixed(1), xPos, rectH - padBottom + 8);
        });

        // Vẽ lưới ngang (Y ticks)
        const yTicks = [0.0, 0.5, 1.0, 1.5, 2.0];
        yTicks.forEach(t => {
            const yPos = getYPixel(t);

            ctx.beginPath();
            ctx.strokeStyle = '#cbd5e1';
            ctx.moveTo(padLeft, yPos);
            ctx.lineTo(rectW - padRight, yPos);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(padLeft, yPos);
            ctx.lineTo(padLeft - 5, yPos);
            ctx.stroke();

            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(t.toFixed(1), padLeft - 8, yPos);
        });

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(padLeft, padTop, plotW, plotH);

        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('predicted', padLeft + plotW / 2, rectH - 15);

        ctx.save();
        ctx.translate(25, padTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('actual', 0, 0);
        ctx.restore();

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(getXPixel(-0.1), getYPixel(-0.1));
        ctx.lineTo(getXPixel(2.1), getYPixel(2.1));
        ctx.stroke();
        ctx.setLineDash([]);

    

        actuals.forEach((act, idx) => {
            const pred = predicted[idx];
            const actIdx = classMap[act] !== undefined ? classMap[act] : 0;
            const predIdx = classMap[pred] !== undefined ? classMap[pred] : 0;

            const jitterX = Math.sin(idx * 13.98) * 0.08;
            const jitterY = Math.cos(idx * 73.23) * 0.08;

            const cx = getXPixel(predIdx + jitterX);
            const cy = getYPixel(actIdx + jitterY);

            if (act === pred) {
                ctx.fillStyle = '#481567';
                ctx.beginPath();
                ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = '#fde725';
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        });

        $('#btnUpdateWikiCropClass').remove();
        $('#classPredictionTableWrap').after(`
            <div style="margin-top: 20px; display: flex; justify-content: center;">
                <button id="btnUpdateWikiCropClass" style="background:#10b981; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 4px 6px -1px rgba(16,185,129,0.25);">
                    ✨ Cập nhật WikiCrop
                </button>
            </div>
        `);

        $('#class-empty-results').hide(); 
        $('#classResultSection').show();
    });

    
    $(document).on('click', '#btnUpdateWikiCrop, #btnUpdateWikiCropClass, #btnUpdateWikiCropReg', function () {
        var btn = $(this);

        showWikiCropPageSelector(function (selectedPage) {
            btn.prop('disabled', true).text('⏳ Đang đồng bộ...');

            var wikitext = buildResultWikitext();

            // Chụp ảnh thẻ Canvas nhẹ nhàng
            var canvasImage = null;
            if (currentClusteringState.algorithm === 'hierarchical') {
                var cv = document.getElementById('scatterChart');
                if (cv) canvasImage = cv.toDataURL('image/png', 0.85);
            } else if (currentClusteringState.algorithm === 'decision_tree') {
                var cv = document.getElementById('decisionTreeCanvas');
                if (cv) canvasImage = cv.toDataURL('image/png', 0.85);
            }

            $.ajax({
                url: mw.config.get('wgScript') + '?title=Special:DataMining',
                type: 'POST',
                data: {
                    datamining_action: 'save_latest',
                    algorithm: currentClusteringState.algorithm,
                    dataset: currentClusteringState.dataset,
                    target_page: selectedPage,
                    append_wikitext: wikitext,
                    image_base64: canvasImage,
                    result_data: JSON.stringify(currentClusteringState.resultData),
                    format: 'json'
                },
                dataType: 'json',
                success: function (resp) {
                    if (resp && resp.status === 'success') {
                        btn.prop('disabled', false).text('✨ Đã đồng bộ!');
                        showAppMessage(
                            'Đồng bộ thành công',
                            'Đã ghi kết quả VÀ HÌNH ẢNH SƠ ĐỒ ĐỒ HỌA lên bài viết "' + selectedPage + '" thành công! Đang mở bài viết...',
                            'info'
                        );
                        setTimeout(function () {
                            window.open(mw.util.getUrl(selectedPage), '_blank');
                        }, 1200);
                    } else {
                        btn.prop('disabled', false).html('❌ Thất bại. Thử lại');
                        showAppMessage('Lỗi ghi bài viết', (resp && resp.message) ? resp.message : 'Không rõ nguyên nhân.', 'error');
                    }
                },
                error: function (xhr) {
                    btn.prop('disabled', false).html('❌ Thất bại. Thử lại');
                    showAppMessage('Lỗi kết nối', 'Không thể kết nối máy chủ.', 'error');
                }
            });
        });
    });


    $('#btnRun').on('click', function () {
        if (parsedData.length === 0) { showAppMessage('Chưa nạp dữ liệu', 'Vui lòng tải tệp dữ liệu trong mục Data Loader trước.', 'error'); return; }
        const k = parseInt($('#kValue').val()) || 3; const seedValue = parseInt($('#randomSeed').val()) || 10; setSeed(seedValue);
        
        let selectedFeatures = []; 
        $('#featuresList input:checked').each(function () { 
            selectedFeatures.push($(this).val()); 
        });
        if (selectedFeatures.length < 1) { showAppMessage('Tham số trống', 'Vui lòng chọn ít nhất 1 thuộc tính nông học để thực thi gom cụm.', 'error'); return; }
        
        let filteredData = parsedData.map(row => { 
            const obj = { _originalId: row._originalId }; 
            selectedFeatures.forEach(f => { obj[f] = row[f]; }); 
            if (row.name !== undefined) { obj.name = row.name; }
            return obj; 
        });
        
        const evalKeys = selectedFeatures.filter(k => k !== '_originalId');
        buildDomains(filteredData, evalKeys); 
        
        let workingData = isDataNormalized ? filteredData : normalizeData(filteredData, getNormalizationParams(filteredData, selectedFeatures.filter(f => isColumnNumeric(filteredData, f))));
        const algo = $('#algorithm').val() || 'kmeans'; 
        const evalMethod = $('input[name="testopt"]:checked').val() || 'training';
        
        let clusterResults = []; 
        let hcInstance = null;
        let modelInstance = null;
        let trainData = [...workingData];
        let testData = [];
        
        currentClusteringState.type = 'clustering';
        currentClusteringState.algorithm = algo;
        currentClusteringState.dataset = $('#fileName').text();

        
        if (evalMethod === 'split' && algo !== 'hierarchical') {
            const pct = Math.max(1, Math.min(99, parseFloat($('#clusterSplitPercent').val()) || 80));
            const splitRatio = pct / 100.0;

            const jRand = new LcgRandom(seedValue);
            const tempArr = [...workingData];
            for (let i = tempArr.length - 1; i > 0; i--) {
                const j = jRand.nextInt(i + 1);
                const temp = tempArr[i]; tempArr[i] = tempArr[j]; tempArr[j] = temp;
            }
            const splitIdx = Math.floor(tempArr.length * splitRatio);
            trainData = tempArr.slice(0, splitIdx);
            testData = tempArr.slice(splitIdx);
        }

        if (algo === 'kmeans') {
        
            modelInstance = new KMeans(k, trainData, 'RANDOM', false, evalKeys);
            clusterResults = modelInstance.run();
        } else if (algo === 'hierarchical') {
            hcInstance = new HierarchicalClustering(null, workingData, $('#hcLinkageType').val() || 'SINGLE');
            hcInstance.run();
        } else if (algo === 'em') {
            const maxIter = parseInt($('#emMaxIter').val()) || 100;
            modelInstance = new ExpectationMaximization(k, trainData);
            clusterResults = modelInstance.run(maxIter);
        } else if (algo === 'clara') {
            modelInstance = new CLARA(k, trainData);
            clusterResults = modelInstance.run();
        }
        
        if (algo === 'hierarchical') {
            currentClusteringState.resultData = { tree: hcInstance.tree, linkage: hcInstance.linkage, instances: workingData.length };
            $('#empty-results').hide(); $('#resultSection').show();
            $('#visCardTitle').text('Cluster Tree Visualizer');
            $('#visCard').show(); $('#metricsCard').hide(); $('#tableCard').hide();
            drawDendrogram(document.getElementById('scatterChart'), hcInstance.tree);

        
            $('#btnUpdateWikiCrop, #btnDownloadDendrogram').remove();
            $('#visCard').append(`
                <div style="margin-top: 20px; display: flex; justify-content: center; gap: 12px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                    <button id="btnDownloadDendrogram" style="background:#4f46e5; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);">
                        ⬇️ Tải PNG
                    </button>
                    <button id="btnUpdateWikiCrop" style="background:#10b981; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(16,185,129,0.2);">
                        ✨ Cập nhật WikiCrop
                    </button>
                </div>
            `);
        } else {
            let finalSSE = 0;
            let fullMappedClusters = [];
            
            if (evalMethod === 'split' && modelInstance) {
                const testClusters = assignTestData(modelInstance, testData, algo);
                finalSSE = calculateSSE(testClusters, evalKeys);
                fullMappedClusters = assignTestData(modelInstance, workingData, algo);
            } else {
                fullMappedClusters = clusterResults;
                if (algo === 'kmeans' && modelInstance) {
                    finalSSE = modelInstance.squaredError;
                } else {
                    finalSSE = calculateSSE(clusterResults, evalKeys);
                }
            }

            displayResults = fullMappedClusters.map(c => c.map(p => { 
                const orig = parsedData.find(x => x._originalId === p._originalId); 
                const cln = {}; selectedFeatures.forEach(f => { cln[f] = orig[f]; }); return cln; 
            }));

            currentClusteringState.resultData = {
                evalK: fullMappedClusters.length,
                evalInstances: workingData.length,
                evalSSE: finalSSE.toFixed(4),
                displayResults: displayResults
            };

            $('#evalK').text(currentClusteringState.resultData.evalK);
            $('#evalInstances').text(currentClusteringState.resultData.evalInstances);
            $('#evalSSE').text(currentClusteringState.resultData.evalSSE);

            $('#empty-results').hide(); $('#resultSection').show();
            $('#visCardTitle').text('Cluster Visualization');
            $('#visCard').show(); $('#metricsCard').show(); $('#tableCard').show();
            renderChart(displayResults); renderClusterTables(displayResults);
        }
    });

    const preloadData = $('#clustering-app').data('preloaded');
    if (preloadData && preloadData !== null && preloadData !== "null") {
        $('.menu-item[data-nav="clustering"]').trigger('click');
        $('.submenu li[data-nav="clustering"]').trigger('click');

        currentClusteringState.algorithm = preloadData.algorithm;
        currentClusteringState.dataset = preloadData.dataset;
        currentClusteringState.resultData = JSON.parse(preloadData.result_data);

        $('#fileName').text(preloadData.dataset); $('#fileBadge').css('display', 'flex');
        $('#empty-results').hide(); $('#resultSection').show();

        const res = currentClusteringState.resultData;
        if (res) {
            $('#evalK').text(res.evalK || '--'); $('#evalInstances').text(res.evalInstances || '--'); $('#evalSSE').text(res.evalSSE || '--');
            if (preloadData.algorithm === 'hierarchical') {
                $('#visCardTitle').text('Cluster Tree Visualizer'); $('#visCard').show(); $('#metricsCard').hide(); $('#tableCard').hide();
                if (res.tree) { drawDendrogram(document.getElementById('scatterChart'), res.tree); }

                // Tải PNG
                $('#btnUpdateWikiCrop, #btnDownloadDendrogram').remove();
                $('#visCard').append(`
                    <div style="margin-top: 20px; display: flex; justify-content: center; gap: 12px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                        <button id="btnDownloadDendrogram" style="background:#4f46e5; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(79,70,229,0.2);">
                            ⬇️ Tải PNG
                        </button>
                        <button id="btnUpdateWikiCrop" style="background:#10b981; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(16,185,129,0.2);">
                            ✨ Cập nhật WikiCrop
                        </button>
                    </div>
                `);
            } else {
                $('#visCardTitle').text('Cluster Visualization'); $('#visCard').show(); $('#metricsCard').show(); $('#tableCard').show();
                displayResults = res.displayResults; renderChart(displayResults); renderClusterTables(displayResults);
            }
        }
        showAppMessage('Khôi phục', 'Kết quả phân tích dữ liệu mới nhất đã được tải ngược thành công từ WikiCrop cache.', 'info');
    }

    
    $('#btnExport').on('click', function () {
        if ($('#algorithm').val() === 'hierarchical') {
            showAppMessage('Không thể xuất dữ liệu phân cụm', 'Giải thuật phân cấp không sinh nhãn nhóm rời rạc. Vui lòng chọn giải thuật khác.', 'error'); return;
        }
        if (!displayResults || displayResults.length === 0) { showAppMessage('Chưa có kết quả', 'Chưa tìm thấy dữ liệu kết quả gom cụm để xuất tệp!', 'error'); return; }
        let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>`;
        html += `<h2>Performance Metrics</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#e0e7ff;font-weight:bold;"><th>Clusters</th><th>Instances</th><th>SSE</th></tr>`;
        html += `<tr><td>${$('#evalK').text()}</td><td>${$('#evalInstances').text()}</td><td>${$('#evalSSE').text()}</td></tr></table><br>`;
        html += `<h2>Cluster Assignments</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#ecfdf5;font-weight:bold;"><th>Nhóm</th><th>STT</th>`;
        const keys = Object.keys(displayResults[0][0]).filter(k => k !== '_originalId');
        keys.forEach(k => html += `<th>${k}</th>`); html += `</tr>`;
        displayResults.forEach((cluster, cIdx) => { cluster.forEach((row, rIdx) => { html += `<tr><td style="font-weight:bold;color:#4f46e5">Nhóm ${cIdx + 1}</td><td>${rIdx + 1}</td>`; keys.forEach(k => { let v = row[k]; if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(4); html += `<td>${v}</td>`; }); html += `</tr>`; }); });
        html += `</table></body></html>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Ket_Qua_Gom_Cum_Nong_Nghiep.xls'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    // Xuất kết quả ra Excel
    $('#btnExportClass').on('click', function () {
        if (!classificationExportData) { showAppMessage('Chưa có kết quả', 'Vui lòng chạy Classification trước khi xuất Excel!', 'error'); return; }
        const d = classificationExportData;
        let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>`;
        html += `<h2>Performance Metrics</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#e0e7ff;font-weight:bold;"><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F-Measure</th></tr>`;
        html += `<tr><td>${d.accuracy}</td><td>${d.precision}</td><td>${d.recall}</td><td>${d.f1}</td></tr></table><br>`;
        html += `<h2>Actual vs Predicted</h2><table border="1" style="border-collapse:collapse;text-align:center;"><tr style="background:#ecfdf5;font-weight:bold;"><th>STT</th>`;
        d.features.forEach(f => html += `<th>${f}</th>`);
        html += `<th>${d.targetLabel} (Actual)</th><th>Predicted</th><th>Trạng thái</th></tr>`;
        d.testX.forEach((row, i) => {
            const isMatch = d.actuals[i] === d.predicted[i];
            html += `<tr><td>${i + 1}</td>`;
            d.features.forEach(f => { let v = row[f]; if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(4); html += `<td>${v}</td>`; });
            html += `<td>${d.actuals[i]}</td><td>${d.predicted[i]}</td><td style="color:${isMatch ? '#059669' : '#ef4444'};font-weight:bold;">${isMatch ? 'Khớp' : 'Lệch'}</td></tr>`;
        });
        html += `</table></body></html>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Ket_Qua_Phan_Lop_Nong_Nghiep.xls'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });


    $('#regAlgorithm').on('change', function() {
        const algo = $(this).val();
        const $container = $('#lrRegParamsContainer');
        if (algo === 'logistic') {
            $container.show();
            $('#reg-algo-desc').text('Logistic Regression predicts the probability of a binary outcome using the sigmoid function.');
        } else {
            $container.hide();
            $('#reg-algo-desc').text('Simple Linear Regression.');
        }
    });


    // VẼ BIỂU ĐỒ HỒI QUY (ACTUAL VS PREDICTED PLOT)
    function renderRegressionChart(chartData) {
        const canvas = document.getElementById('regScatterChart');
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rectW = canvas.clientWidth || 800;
        const rectH = canvas.clientHeight || 350;
        canvas.width = rectW * dpr;
        canvas.height = rectH * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, rectW, rectH);

        const testData = chartData.testData || [];
        const predictions = chartData.predictions || [];
        if (testData.length === 0) return;

        const actuals = testData.map(d => parseFloat(d[chartData.targetAttr]) || 0);
        const allVals = [...actuals, ...predictions];
        let minVal = Math.min(...allVals);
        let maxVal = Math.max(...allVals);
        if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
        const margin = (maxVal - minVal) * 0.1;
        minVal -= margin; maxVal += margin;

        const padLeft = 60, padRight = 30, padTop = 30, padBottom = 50;
        const plotW = rectW - padLeft - padRight;
        const plotH = rectH - padTop - padBottom;

        function getX(val) { return padLeft + ((val - minVal) / (maxVal - minVal)) * plotW; }
        function getY(val) { return (rectH - padBottom) - ((val - minVal) / (maxVal - minVal)) * plotH; }

        // Vẽ đường lý tưởng (Ideal Line Y = X)
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(getX(minVal), getY(minVal));
        ctx.lineTo(getX(maxVal), getY(maxVal));
        ctx.stroke();
        ctx.setLineDash([]);

        // Vẽ các điểm dữ liệu
        actuals.forEach((act, i) => {
            const pred = predictions[i];
            const cx = getX(act);
            const cy = getY(pred);

            ctx.fillStyle = '#6366f1';
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Nhãn trục
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Actual Values', padLeft + plotW / 2, rectH - 10);

        ctx.save();
        ctx.translate(15, padTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Predicted Values', 0, 0);
        ctx.restore();
    }

    
    $('#btnRunRegression').on('click', function() {
        if (parsedData.length === 0) {
            showAppMessage('Chưa nạp dữ liệu', 'Vui lòng tải tệp dữ liệu trong mục Data Loader trước.', 'error');
            return;
        }

        const targetAttr = $('#regTargetSelect').val();
        if (!targetAttr) {
            showAppMessage('Tham số trống', 'Vui lòng chọn thuộc tính Target.', 'error');
            return;
        }

        const selectedFeatures = [];
        $('#regFeaturesList input:checked').each(function() {
            const val = $(this).val();
            if (val !== targetAttr) selectedFeatures.push(val);
        });

        if (selectedFeatures.length === 0) {
            showAppMessage('Tham số trống', 'Vui lòng chọn ít nhất 1 thuộc tính Predictor từ danh sách.', 'error');
            return;
        }

        const algo = $('#regAlgorithm').val();
        const evalMethod = $('input[name="regTestopt"]:checked').val() || 'training';


        if (evalMethod === 'training') {
            $('#lbl-reg-eval-header').text('Full training set');
        } else if (evalMethod === 'split') {
            const pctVal = Math.max(1, Math.min(99, parseInt($('#regSplitPercent').val()) || 80));
            $('#lbl-reg-eval-header').text(`Percentage split (${pctVal}% Train, ${100 - pctVal}% Test)`);
        } else if (evalMethod === 'cv') {
            const numFolds = Math.max(2, parseInt($('#regCvFolds').val()) || 10);
            $('#lbl-reg-eval-header').text(numFolds + '-fold cross-validation');
        }
        $('#lbl-reg-algo-header').text(algo === 'linear' ? 'Linear Regression' : 'Logistic Regression');

        let trainData = [], testData = [];
        let actuals = [], predictions = [];

        if (evalMethod === 'cv') {
            const K = Math.max(2, parseInt($('#regCvFolds').val()) || 10);
            const numInstances = parsedData.length;

            const internalRandom = new JavaRandom(1);
            const randomizedData = [...parsedData];
            for (let i = randomizedData.length; i > 1; i--) {
                const j = internalRandom.nextInt(i);
                const temp = randomizedData[i - 1];
                randomizedData[i - 1] = randomizedData[j];
                randomizedData[j] = temp;
            }

            actuals = new Array(numInstances);
            predictions = new Array(numInstances);

            for (let f = 0; f < K; f++) {
                let numInstForFold = Math.floor(numInstances / K);
                let remainder = numInstances % K;
                let offset = f < remainder ? f : remainder;
                if (f < remainder) numInstForFold++;

                let first = f * Math.floor(numInstances / K) + offset;
                let testIndicesSet = new Set();
                for (let i = first; i < first + numInstForFold; i++) {
                    testIndicesSet.add(i);
                }

                const foldTrainData = randomizedData.filter((_, idx) => !testIndicesSet.has(idx));
                const foldTestData = randomizedData.filter((_, idx) => testIndicesSet.has(idx));

                if (algo === 'linear') {
                    const model = new LinearRegression(1e-8);
                    model.train(foldTrainData, selectedFeatures, targetAttr);
                    foldTestData.forEach(point => {
                        const idx = point._originalId;
                        actuals[idx] = parseFloat(point[targetAttr]) || 0;
                        predictions[idx] = model.predict(point) || 0;
                    });
                } else {
                    const lr = parseFloat($('#regLrRate').val()) || 0.1;
                    const epochs = parseInt($('#regLrEpochs').val()) || 500;
                    const model = new LogisticRegression(lr, epochs);
                    model.train(foldTrainData, selectedFeatures, targetAttr);
                    foldTestData.forEach(point => {
                        const idx = point._originalId;
                        actuals[idx] = parseFloat(point[targetAttr]) || 0;
                        predictions[idx] = model.predictProb(point) || 0;
                    });
                }
            }
            testData = parsedData;
        } else {
            if (evalMethod === 'split') {
                const pct = Math.max(1, Math.min(99, parseFloat($('#regSplitPercent').val()) || 80));
                const splitRatio = pct / 100.0;

                const internalRandom = new JavaRandom(1);
                const shuffled = [...parsedData];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = internalRandom.nextInt(i + 1);
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }

                const splitIdx = Math.floor(shuffled.length * splitRatio);
                trainData = shuffled.slice(0, splitIdx);
                testData = shuffled.slice(splitIdx);
            } else {
                trainData = [...parsedData];
                testData = [...parsedData];
            }

            if (algo === 'linear') {
                const model = new LinearRegression(1e-8);
                model.train(trainData, selectedFeatures, targetAttr);
                actuals = testData.map(d => parseFloat(d[targetAttr]) || 0);
                predictions = testData.map(d => model.predict(d) || 0);
            } else {
                const lr = parseFloat($('#regLrRate').val()) || 0.1;
                const epochs = parseInt($('#regLrEpochs').val()) || 500;
                const model = new LogisticRegression(lr, epochs);
                model.train(trainData, selectedFeatures, targetAttr);
                actuals = testData.map(d => parseFloat(d[targetAttr]) || 0);
                predictions = testData.map(d => model.predictProb(d) || 0);
            }
        }

        let metricsHtml = '';
        let resultObj = { targetAttr: targetAttr, instances: actuals.length };

        if (algo === 'linear') {
            const m = calculateRegressionMetrics(actuals, predictions);
            metricsHtml = `
                <div style="display:flex; gap:20px; margin-bottom:12px; font-size:13px; color:#475569; background:#f8fafc; padding:10px 14px; border-radius:6px; border:1px solid #e2e8f0;">
                    <div><strong>Instances:</strong> <span style="color:#1e293b; font-weight:700;">${m.instances}</span></div>
                    <div><strong>Predictors:</strong> <span style="color:#1e293b; font-weight:700;">${selectedFeatures.length}</span></div>
                </div>
                <table class="class-metrics-table">
                    <thead><tr><th>MAE</th><th>RMSE</th><th>R²</th><th>RAE (%)</th><th>RRSE (%)</th></tr></thead>
                    <tbody><tr>
                        <td>${m.mae}</td><td>${m.rmse}</td><td>${m.r2}</td>
                        <td>${m.rae}</td><td>${m.rrse}</td>
                    </tr></tbody>
                </table>
                <div style="margin-top:8px;font-size:12px;color:#64748b;">
                    <strong>Predictors List:</strong> ${selectedFeatures.join(', ')}
                </div>`;
            resultObj = { ...resultObj, ...m };
        } else {
            const mReg = calculateRegressionMetrics(actuals, predictions);
            const binaryPreds = predictions.map(p => p >= 0.5 ? 1 : 0);
            const tp = actuals.reduce((s, a, i) => s + (a === 1 && binaryPreds[i] === 1 ? 1 : 0), 0);
            const fp = actuals.reduce((s, a, i) => s + (a === 0 && binaryPreds[i] === 1 ? 1 : 0), 0);
            const tn = actuals.reduce((s, a, i) => s + (a === 0 && binaryPreds[i] === 0 ? 1 : 0), 0);
            const fn = actuals.reduce((s, a, i) => s + (a === 1 && binaryPreds[i] === 0 ? 1 : 0), 0);
            const accuracy = ((tp + tn) / actuals.length * 100).toFixed(2);
            const precision = (tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0).toFixed(2);
            const recall = (tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0).toFixed(2);
            const f1 = (tp + fp > 0 && tp + fn > 0 ? (2 * tp / (2 * tp + fp + fn)) * 100 : 0).toFixed(2);

            metricsHtml = `
                <div style="display:flex; gap:20px; margin-bottom:12px; font-size:13px; color:#475569; background:#f8fafc; padding:10px 14px; border-radius:6px; border:1px solid #e2e8f0;">
                    <div><strong>Instances:</strong> <span style="color:#1e293b; font-weight:700;">${mReg.instances}</span></div>
                    <div><strong>Predictors:</strong> <span style="color:#1e293b; font-weight:700;">${selectedFeatures.length}</span></div>
                </div>
                <table class="class-metrics-table" style="margin-bottom:12px;">
                    <thead><tr><th>MAE</th><th>RMSE</th><th>R²</th></tr></thead>
                    <tbody><tr>
                        <td>${mReg.mae}</td><td>${mReg.rmse}</td><td>${mReg.r2}</td>
                    </tr></tbody>
                </table>
                <table class="class-metrics-table">
                    <thead><tr><th>Accuracy (%)</th><th>Precision (%)</th><th>Recall (%)</th><th>F1 (%)</th></tr></thead>
                    <tbody><tr>
                        <td>${accuracy}</td><td>${precision}</td><td>${recall}</td><td>${f1}</td>
                    </tr></tbody>
                </table>
                <div style="margin-top:8px;font-size:12px;color:#64748b;">
                    <strong>Predictors List:</strong> ${selectedFeatures.join(', ')}
                </div>`;
            resultObj = { ...resultObj, ...mReg, accuracy, precision, recall, f1 };
        }

        currentClusteringState.type = 'regression';
        currentClusteringState.algorithm = algo;
        currentClusteringState.dataset = $('#fileName').text();
        currentClusteringState.resultData = resultObj;

        $('#reg-empty-results').hide();
        $('#regResultSection').show();
        $('#regMetrics').html(metricsHtml);
        renderRegressionChart({ testData, predictions, targetAttr });

        $('#btnUpdateWikiCropReg').remove();
        $('#regResultSection').append(`
            <div style="margin-top: 20px; margin-bottom: 10px; display: flex; justify-content: center;">
                <button id="btnUpdateWikiCropReg" style="background:#10b981; color:#ffffff; border:none; padding:10px 24px; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 4px 6px -1px rgba(16,185,129,0.25);">
                    ✨ Cập nhật WikiCrop
                </button>
            </div>
        `);
    });
});