/* extensions/Approve/modules/ext.approve.js */
/* globals mw, $ */

(function ($, mw) {
    'use strict';

    // --- 1. TRẠNG THÁI & CẤU HÌNH (STATE) ---
    var currentPage = 1;
    var itemsPerPage = 20;
    var totalItems = 0;
    var currentSearch = "";
    var sortOrder = "desc";
    var $dashboardContainer;

    // --- 2. CÁC HÀM HỖ TRỢ (HELPERS) ---
    
    function escapeHtml(text) {
        if (!text) return "";
        return $("<div>").text(text).html();
    }

    function updatePaginationUI() {
        var maxPage = Math.ceil(totalItems / itemsPerPage);
        if (maxPage === 0) maxPage = 1;

        $("#page-info").text("Trang " + currentPage + " / " + maxPage + " (Tổng: " + totalItems + ")");
        $("#btn-prev").prop("disabled", currentPage <= 1);
        $("#btn-next").prop("disabled", currentPage >= maxPage);
    }

    // --- 3. CÁC HÀM XỬ LÝ API & LOGIC ---

    function loadList() {
        var api = new mw.Api();
        var $tbody = $("#approve-list-body");
        var offset = (currentPage - 1) * itemsPerPage;

        $tbody.html('<tr><td colspan="4" style="text-align: center; padding: 20px; color: #72777d;">Đang tải trang ' + currentPage + '...</td></tr>');

        api.get({
            action: "approvelist",
            format: "json",
            limit: itemsPerPage,
            offset: offset,
            search: currentSearch,
            sort: sortOrder,
        }).done(function (data) {
            var pages = (data && data.approvelist && data.approvelist.pages) ? data.approvelist.pages : [];
            totalItems = (data && data.approvelist) ? data.approvelist.total : 0;

            updatePaginationUI();
            $tbody.empty();

            if (pages.length === 0) {
                $tbody.html('<tr><td colspan="4" style="text-align: center; padding: 30px; font-weight: bold; color: #14866d;">Không có bài nào cần duyệt.</td></tr>');
                return;
            }

            renderTableRows(pages, $tbody);

        }).fail(function () {
            $tbody.html('<tr><td colspan="4" style="text-align: center; color: #d33; padding: 20px;">Lỗi kết nối API.</td></tr>');
        });
    }

    function renderTableRows(pages, $tbody) {
        pages.forEach(function (p) {
            var viewUrl = mw.util.getUrl(p.title, { oldid: p.revision });
            var diffUrl = mw.util.getUrl(p.title, { diff: p.revision, oldid: "prev" });
            var displayTitle = p.title.replace(/_/g, " ");

            var rowHtml = `
                <tr style="border-bottom: 1px solid #eaecf0; transition: background 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 12px;">
                        <a href="${viewUrl}" target="_blank" style="font-weight: bold; font-size: 1.1em; text-decoration: none; color: #36c;">${escapeHtml(displayTitle)}</a>
                        <div style="font-size: 0.85em; color: #72777d; margin-top: 4px;">
                            Rev ID: <b>${p.revision}</b> &bull; <a href="${diffUrl}" target="_blank" style="color: #d33;">Lịch sử sửa đổi</a>
                        </div>
                    </td>
                    <td style="padding: 12px;"><a href="${mw.util.getUrl("User:" + p.creator)}" target="_blank">${escapeHtml(p.creator)}</a></td>
                    <td style="padding: 12px; color: #54595d;">${escapeHtml(p.created)}</td>
                    <td style="padding: 12px;">
                        <button class="btn-approve mw-ui-button mw-ui-progressive" data-id="${p.id}" data-title="${escapeHtml(p.title)}" style="min-height: 32px; font-size: 0.9em; margin-right: 5px;">Duyệt</button>
                        <button class="btn-reject mw-ui-button mw-ui-destructive" data-id="${p.id}" data-title="${escapeHtml(p.title)}" style="min-height: 32px; font-size: 0.9em;">Từ chối</button>
                    </td>
                </tr>`;
            $tbody.append(rowHtml);
        });
    }

    function executeApproveAction(id, mode, title) {
        var actionText = mode === "approve" ? "DUYỆT" : "TỪ CHỐI";
        if (!confirm("Bạn có chắc chắn muốn " + actionText + ' bài viết: "' + title + '" không?')) return;

        var api = new mw.Api();
        api.postWithToken("csrf", {
            action: "approve",
            id: id,
            mode: mode,
            format: "json",
        }).done(function (data) {
            if (data.error) {
                alert("Lỗi: " + data.error.info);
            } else {
                loadList();
            }
        }).fail(function (code, result) {
            var info = (result && result.error && result.error.info) ? result.error.info : "";
            alert("Lỗi API (" + code + "): " + info);
        });
    }

    function runImportData() {
        if (!confirm("Hành động này sẽ quét toàn bộ bài viết cũ chưa có trong danh sách và thêm vào hàng chờ duyệt.\n\nTiếp tục?")) return;

        var api = new mw.Api();
        var $status = $("#import-status");
        var $btn = $("#btn-import-data");

        $btn.prop("disabled", true).text("Đang xử lý...");
        $status.text("Đang quét...");

        api.postWithToken("csrf", { action: "approveimport", format: "json" })
            .done(function (data) {
                var count = (data.approveimport) ? data.approveimport.imported_count : 0;
                alert(count > 0 ? "Đã thêm " + count + " bài." : "Hệ thống đã đồng bộ.");
                $status.text("");
                currentPage = 1;
                loadList();
            })
            .fail(function (code) {
                alert("Lỗi: " + code);
                $status.text("Lỗi!");
            })
            .always(function () {
                $btn.prop("disabled", false).text("Đã tải bài cũ");
            });
    }

    // --- 4. XỬ LÝ DUYỆT TẤT CẢ (Batch Processing) ---
    
    function runBatchApprove(api, $btn, totalApproved) {
        var batchSize = 10;
        
        api.postWithToken("csrf", {
            action: "approve",
            mode: "approveall",
            limit: batchSize,
            format: "json",
        }).done(function (data) {
            if (data.error) {
                alert("Lỗi: " + data.error.info);
                resetBatchState($btn);
                return;
            }

            var count = (data.approve && data.approve.count) ? data.approve.count : 0;

            if (count > 0) {
                totalApproved += count;
                $("#approve-list-body").html('<tr><td colspan="4" style="text-align: center; padding: 30px; color: #14866d;">Đang duyệt... Đã xong ' + totalApproved + ' bài (Vui lòng chờ)...</td></tr>');
                setTimeout(function() { runBatchApprove(api, $btn, totalApproved); }, 300);
            } else {
                alert("Đã duyệt hoàn tất! Tổng cộng: " + totalApproved + " bài viết.");
                resetBatchState($btn);
            }
        }).fail(function (code, result) {
            alert("Lỗi kết nối hoặc timeout (Đã duyệt được " + totalApproved + "): " + code);
            resetBatchState($btn);
        });
    }

    function resetBatchState($btn) {
        $btn.prop("disabled", false).text("Duyệt tất cả");
        currentPage = 1;
        loadList();
    }

    function handleApproveAllClick() {
        if (!confirm("CẢNH BÁO: Bạn có chắc chắn muốn DUYỆT TẤT CẢ các bài đang chờ không?\nHành động này không thể hoàn tác.")) return;

        var $btn = $(this);
        $btn.prop("disabled", true).text("Đang xử lý...");
        $("#approve-list-body").html('<tr><td colspan="4" style="text-align: center; padding: 30px; color: #72777d;">Đang duyệt tất cả bài viết... Vui lòng không tắt trang.</td></tr>');

        var api = new mw.Api();
        runBatchApprove(api, $btn, 0);
    }

    // --- 5. RENDER GIAO DIỆN CHÍNH ---

    function renderDashboardHTML(container) {
        container.innerHTML = `
            <div class="approve-dashboard-wrapper" style="font-family: sans-serif;">
                <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button id="btn-reload-list" class="mw-ui-button">Tải lại</button>
                        <button id="btn-approve-all" class="mw-ui-button mw-ui-constructive">Duyệt tất cả</button>
                        <button id="btn-import-data" class="mw-ui-button mw-ui-progressive">Tải bài cũ</button>
                        <input type="text" id="approve-search-input" placeholder="Tìm kiếm..." style="padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1em;">
                        <button id="approve-search-btn">Tìm</button>
                        <button id="btn-sort" class="mw-ui-button">Sắp xếp ↓</button>
                        <span id="import-status" style="font-style: italic; color: #666;"></span>
                    </div>
                </div>
                <table class="approve-table" style="width:100%; border-collapse: collapse; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                    <thead>
                        <tr style="background: #eaecf0; border-bottom: 2px solid #a2a9b1; text-align: left;">
                            <th style="padding: 12px;">Bài viết / Thay đổi</th>
                            <th style="padding: 12px;">Người sửa</th>
                            <th style="padding: 12px;">Thời gian</th>
                            <th style="padding: 12px; width: 180px;">Hành động</th>
                        </tr>
                    </thead>
                    <tbody id="approve-list-body"></tbody>
                </table>
                <div id="pagination-controls" style="display: flex; gap: 5px; align-items: center; margin-top: 15px;">
                    <button id="btn-prev" class="mw-ui-button" disabled>Trước</button>
                    <span id="page-info" style="font-weight: bold; margin: 0 10px;">Trang 1</span>
                    <button id="btn-next" class="mw-ui-button" disabled>Sau</button>
                </div>
            </div>`;
    }

    // --- 6. KHỞI TẠO & BIND EVENTS (MAIN) ---

    function bindEvents() {
        $("#btn-reload-list").on("click", function () { currentPage = 1; loadList(); });
        $("#btn-import-data").on("click", runImportData);
        $("#btn-approve-all").on("click", handleApproveAllClick);

        $("#btn-prev").on("click", function () {
            if (currentPage > 1) { currentPage--; loadList(); }
        });

        $("#btn-next").on("click", function () {
            var maxPage = Math.ceil(totalItems / itemsPerPage);
            if (currentPage < maxPage) { currentPage++; loadList(); }
        });

        $("#btn-sort").on("click", function () {
            sortOrder = sortOrder === "desc" ? "asc" : "desc";
            $(this).text("Sắp xếp " + (sortOrder === "desc" ? "↓" : "↑"));
            loadList();
        });

        // Event Delegation cho Search và các nút sinh ra động (Duyệt/Từ chối)
        $(document).on("click", "#approve-search-btn", function () {
            currentPage = 1;
            currentSearch = $("#approve-search-input").val().trim();
            loadList();
        });

        $(document).on("click", ".btn-approve", function () {
            executeApproveAction($(this).data("id"), "approve", $(this).data("title"));
        });

        $(document).on("click", ".btn-reject", function () {
            executeApproveAction($(this).data("id"), "reject", $(this).data("title"));
        });
    }

    function init() {
        var container = document.getElementById("approve-dashboard");
        if (!container) return;

        $dashboardContainer = $(container);
        renderDashboardHTML(container);
        bindEvents();
        loadList();
    }

    // --- 7. LOADER ---
    mw.loader.using(["mediawiki.api", "mediawiki.util", "mediawiki.user"], function () {
        $(document).ready(init);
    });

})(jQuery, mediaWiki);