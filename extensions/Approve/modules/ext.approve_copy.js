/* extensions/Approve/modules/ext.approve.js */
/* globals mw, $ */

(function () {
  function escapeHtml(text) {
    if (!text) return "";
    return $("<div>").text(text).html();
  }

  mw.loader.using(
    ["mediawiki.api", "mediawiki.util", "mediawiki.user"],
    function () {
      // CẤU HÌNH PHÂN TRANG
      var currentPage = 1;
      var itemsPerPage = 20; // Số bài trên 1 trang
      var totalItems = 0;
      var currentSearch = "";
      var sortOrder = "desc";

      function renderDashboard(container) {
        if (!container) return;

        container.innerHTML = `
                <div class="approve-dashboard-wrapper" style="font-family: sans-serif;">
                    <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button id="btn-reload-list" class="mw-ui-button">Tải lại</button>
                            <button id="btn-approve-all" class="mw-ui-button mw-ui-constructive">Duyệt tất cả</button>
                            <button id="btn-import-data" class="mw-ui-button mw-ui-progressive">Tải bài cũ</button>
                            
                            <!-- Ô tìm kiếm -->
                            <input type="text" id="approve-search-input" placeholder="Tìm kiếm..." style="padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1em;">
                            <button id="approve-search-btn">Tìm</button>

                            <!-- Nút sort -->
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
                        <tbody id="approve-list-body">
                            <tr><td colspan="4" style="padding: 30px; text-align: center; color: #72777d;">⏳ Đang tải dữ liệu...</td></tr>
                        </tbody>
                    </table>

                    <div id="pagination-controls" style="display: flex; gap: 5px; align-items: center;">
                        <button id="btn-prev" class="mw-ui-button" disabled>Trước</button>
                        <span id="page-info" style="font-weight: bold; margin: 0 10px;">Trang 1</span>
                        <button id="btn-next" class="mw-ui-button" disabled>Sau</button>
                    </div>
                </div>
            `;

        $("#btn-reload-list").on("click", function () {
          currentPage = 1;
          loadList();
        });

        // --- XỬ LÝ NÚT DUYỆT TẤT CẢ ---
        $("#btn-approve-all").on("click", function () {
            if (!confirm("CẢNH BÁO: Bạn có chắc chắn muốn DUYỆT TẤT CẢ các bài đang chờ không?\nHành động này không thể hoàn tác và có thể mất vài phút.")) {
                return;
            }

            var $btn = $(this);
            $btn.prop("disabled", true).text("Đang xử lý...");
            $("#approve-list-body").html('<tr><td colspan="4" style="text-align: center; padding: 30px; color: #72777d;">Đang duyệt tất cả bài viết... Vui lòng không tắt trang.</td></tr>');

            var api = new mw.Api();
            var totalApproved = 0;
            var batchSize = 10; // Duyệt mỗi lần 10 bài (Giảm xuống để tránh timeout)

            function processBatch() {
                api.postWithToken("csrf", {
                    action: "approve",
                    mode: "approveall",
                    limit: batchSize,
                    format: "json",
                })
                .done(function (data) {
                    if (data.error) {
                        alert("Lỗi: " + data.error.info);
                        $btn.prop("disabled", false).text("Duyệt tất cả");
                        loadList();
                        return;
                    }

                    var count = 0;
                    if (data.approve && data.approve.count) {
                        count = data.approve.count;
                    }

                    if (count > 0) {
                        totalApproved += count;
                        $("#approve-list-body").html('<tr><td colspan="4" style="text-align: center; padding: 30px; color: #14866d;">Đang duyệt... Đã xong ' + totalApproved + ' bài (Vui lòng chờ)...</td></tr>');
                        // Tiếp tục batch tiếp theo
                        setTimeout(processBatch, 300);
                    } else {
                        // Không còn bài nào pending
                        alert("Đã duyệt hoàn tất! Tổng cộng: " + totalApproved + " bài viết.");
                        $btn.prop("disabled", false).text("Duyệt tất cả");
                        currentPage = 1;
                        loadList();
                    }
                })
                .fail(function (code, result) {
                    alert("Lỗi kết nối hoặc timeout (Đã duyệt được " + totalApproved + "): " + code);
                    console.log(result);
                    $btn.prop("disabled", false).text("Duyệt tất cả");
                    loadList();
                });
            }

            // Bắt đầu quy trình
            processBatch();
        });

        $("#btn-import-data").on("click", runImport);

        // Sự kiện nút phân trang
        $("#btn-prev").on("click", function () {
          if (currentPage > 1) {
            currentPage--;
            loadList();
          }
        });

        $("#btn-next").on("click", function () {
          var maxPage = Math.ceil(totalItems / itemsPerPage);
          if (currentPage < maxPage) {
            currentPage++;
            loadList();
          }
        });

        $(document).on("click", "#approve-search-btn", function () {
          currentPage = 1;
          currentSearch = $("#approve-search-input").val().trim();
          // console.log("Giá trị sau khi delegation:", currentSearch);
          loadList();
        });

        $("#btn-sort").on("click", function () {
          sortOrder = sortOrder === "desc" ? "asc" : "desc";
          $("#btn-sort").text("Sắp xếp " + (sortOrder === "desc" ? "↓" : "↑"));
          loadList();
        });
      }

      function runImport() {
        if (
          !confirm(
            "Hành động này sẽ quét toàn bộ bài viết cũ chưa có trong danh sách và thêm vào hàng chờ duyệt.\n\nTiếp tục?"
          )
        )
          return;

        var api = new mw.Api();
        var $status = $("#import-status");
        var $btn = $("#btn-import-data");

        $btn.prop("disabled", true).text("Đang xử lý...");
        $status.text("Đang quét...");

        api
          .postWithToken("csrf", { action: "approveimport", format: "json" })
          .done(function (data) {
            var count = data.approveimport
              ? data.approveimport.imported_count
              : 0;
            alert(
              count > 0
                ? "Đã thêm " + count + " bài."
                : "Hệ thống đã đồng bộ."
            );
            $status.text("");
            currentPage = 1; // Reset về trang 1 sau khi import
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

      function loadList() {
        var api = new mw.Api();
        var $tbody = $("#approve-list-body");

        // Tính toán offset
        var offset = (currentPage - 1) * itemsPerPage;

        $tbody.html(
          '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #72777d;">Đang tải trang ' +
            currentPage +
            "...</td></tr>"
        );

        api
          .get({
            action: "approvelist",
            format: "json",
            limit: itemsPerPage,
            offset: offset,
            search: currentSearch,
            sort: sortOrder,
          })
          .done(function (data) {
            var pages =
              data && data.approvelist && data.approvelist.pages
                ? data.approvelist.pages
                : [];
            totalItems = data && data.approvelist ? data.approvelist.total : 0;

            updatePaginationUI(); // Cập nhật nút bấm

            $tbody.empty();

            if (pages.length === 0) {
              $tbody.html(
                '<tr><td colspan="4" style="text-align: center; padding: 30px; font-weight: bold; color: #14866d;">Không có bài nào cần duyệt.</td></tr>'
              );
              return;
            }

            pages.forEach(function (p) {
              var viewUrl = mw.util.getUrl(p.title, { oldid: p.revision });
              var diffUrl = mw.util.getUrl(p.title, {
                diff: p.revision,
                oldid: "prev",
              });

              var displayTitle = p.title.replace(/_/g, " ");

              var rowHtml = `
                        <tr style="border-bottom: 1px solid #eaecf0; transition: background 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
                            <td style="padding: 12px;">
                                <a href="${viewUrl}" target="_blank" style="font-weight: bold; font-size: 1.1em; text-decoration: none; color: #36c;">
                                    ${escapeHtml(displayTitle)}
                                </a>
                                <div style="font-size: 0.85em; color: #72777d; margin-top: 4px;">
                                   Rev ID: <b>${p.revision}</b> &bull; 
                                   <a href="${diffUrl}" target="_blank" style="color: #d33;">Lịch sử sửa đổi</a>
                                </div>
                            </td>
                            <td style="padding: 12px;">
                                <a href="${mw.util.getUrl(
                                  "User:" + p.creator
                                )}" target="_blank">${escapeHtml(p.creator)}</a>
                            </td>
                            <td style="padding: 12px; color: #54595d;">${escapeHtml(
                              p.created
                            )}</td>
                            <td style="padding: 12px;">
                                <button class="btn-approve mw-ui-button mw-ui-progressive" 
                                        data-id="${
                                          p.id
                                        }" data-title="${escapeHtml(p.title)}"
                                        style="min-height: 32px; font-size: 0.9em; margin-right: 5px;">Duyệt</button>
                                <button class="btn-reject mw-ui-button mw-ui-destructive" 
                                        data-id="${
                                          p.id
                                        }" data-title="${escapeHtml(p.title)}"
                                        style="min-height: 32px; font-size: 0.9em;">Từ chối</button>
                            </td>
                        </tr>
                    `;
              $tbody.append(rowHtml);
            });

            $(".btn-approve").on("click", function () {
              doAction($(this).data("id"), "approve", $(this).data("title"));
            });
            $(".btn-reject").on("click", function () {
              doAction($(this).data("id"), "reject", $(this).data("title"));
            });
          })
          .fail(function () {
            $tbody.html(
              '<tr><td colspan="4" style="text-align: center; color: #d33; padding: 20px;">Lỗi kết nối API.</td></tr>'
            );
          });
      }

      // Hàm cập nhật trạng thái nút phân trang
      function updatePaginationUI() {
        var maxPage = Math.ceil(totalItems / itemsPerPage);
        if (maxPage === 0) maxPage = 1;

        $("#page-info").text(
          "Trang " +
            currentPage +
            " / " +
            maxPage +
            " (Tổng: " +
            totalItems +
            ")"
        );

        $("#btn-prev").prop("disabled", currentPage <= 1);
        $("#btn-next").prop("disabled", currentPage >= maxPage);
      }

      function doAction(id, mode, title) {
        var actionText = mode === "approve" ? "DUYỆT" : "TỪ CHỐI";
        if (
          !confirm(
            "Bạn có chắc chắn muốn " +
              actionText +
              ' bài viết: "' +
              title +
              '" không?'
          )
        )
          return;

        var api = new mw.Api();
        api
          .postWithToken("csrf", {
            action: "approve",
            id: id,
            mode: mode,
            format: "json",
          })
          .done(function (data) {
            if (data.error) {
              alert("Lỗi: " + data.error.info);
            } else {
              loadList(); // Tải lại trang hiện tại sau khi duyệt
            }
          })
          .fail(function (code, result) {
            // Sửa ở đây để xem lỗi chính xác là gì
            if (code === "http") {
              alert(
                "Lỗi kết nối mạng: " + (result ? result.textStatus : "Unknown")
              );
            } else {
              var info =
                result && result.error && result.error.info
                  ? result.error.info
                  : "";
              alert("Lỗi API (" + code + "): " + info);
              console.error("API Error Debug:", code, result);
            }
          });
      }

      $(document).ready(function () {
        var container = document.getElementById("approve-dashboard");
        if (container) {
          renderDashboard(container);
          loadList();
        }
      });
    }
  );
})();
