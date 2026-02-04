( function ( $, mw ) {
    'use strict';

    // 1. Khai báo biến ở phạm vi ngoài để dùng chung cho các hàm
    var $form, $action, $idInput, $nameInput, $urlInput, $summaryInput, $categoryInput, $submitBtn, $cancelBtn, $summarizeBtn, $urlFeedback;

    // 2. Hàm xử lý khi bấm nút Edit
    function handleEdit( e ) {
        e.preventDefault(); 
        console.log( 'Edit button clicked' );

        var $btn = $( this );
        // Lấy dữ liệu từ data attributes
        var id = $btn.data( 'id' );
        var name = $btn.data( 'name' );
        var url = $btn.data( 'url' );
        var summary = $btn.data( 'summary' );
        var category = $btn.data( 'category' );

        // Gán dữ liệu vào form
        $action.val( 'edit' );
        $idInput.val( id );
        $nameInput.val( name );
        $urlInput.val( url );
        $summaryInput.val( summary );
        $categoryInput.val( category );
        
        // Cập nhật giao diện nút bấm
        $submitBtn.text( 'Cập nhật' );
        $cancelBtn.show();

        // Scroll tới form
        if ( $form.length ) {
            $( 'html, body' ).animate( { scrollTop: $form.offset().top - 100 }, 500 );
        } else {
            console.error( 'Form #nongnghiep-entry-form not found' );
        }
    }

    // 3. Hàm xử lý khi bấm nút Cancel
    function handleCancel( e ) {
        e.preventDefault();
        console.log( 'Cancel button clicked' );

        $form[0].reset();
        $action.val( 'add' );
        $idInput.val( '' );

        $submitBtn.text( 'Lưu dữ liệu' );
        $cancelBtn.hide();
        
        $submitBtn.text(mw.msg('nongnghiep40-save'));
        $urlFeedback.hide();
    }

    // 4. Hàm xử lý xác nhận xóa
    function handleDelete() {
        return confirm( 'Bạn có chắc chắn muốn xóa không?' );
    }

    // Handle fetching video info
    function handleUrlChange() {
        var url = $urlInput.val().trim();
        if (!url) return;

        // Basic check for youtube url
        if (url.indexOf('youtube.com') === -1 && url.indexOf('youtu.be') === -1) {
            return;
        }

        $urlFeedback.text('Đang lấy thông tin video...').show();
        
        $.ajax({
            url: window.location.href, // Post to current page
            data: {
                action: 'ajax_process',
                sub_action: 'info',
                url: url
            },
            dataType: 'json',
            success: function(response) {
                if (response.success) {
                    $nameInput.val(response.data.title);
                    $urlFeedback.text('Đã lấy tên video thành công.').css('color', 'green');
                    setTimeout(function() { $urlFeedback.fadeOut(); }, 3000);
                } else {
                    $urlFeedback.text('Lỗi: ' + response.error).css('color', 'red');
                }
            },
            error: function() {
                $urlFeedback.text('Lỗi kết nối máy chủ.').css('color', 'red');
            }
        });
    }

    // Handle summarization
    function handleSummarize() {
        var url = $urlInput.val().trim();
        if (!url) {
            alert('Vui lòng nhập URL YouTube trước.');
            return;
        }

        var originalText = $summarizeBtn.text();
        $summarizeBtn.text('Đang xử lý...').prop('disabled', true);
        $summaryInput.attr('placeholder', 'Đang tóm tắt nội dung video, vui lòng chờ...');

        $.ajax({
            url: window.location.href,
            data: {
                action: 'ajax_process',
                sub_action: 'summarize',
                url: url
            },
            dataType: 'json',
            success: function(response) {
                if (response.success) {
                    $summaryInput.val(response.data.summary);
                } else {
                    alert('Lỗi: ' + response.error);
                }
            },
            error: function() {
                alert('Lỗi kết nối máy chủ hoặc quá thời gian chờ.');
            },
            complete: function() {
                $summarizeBtn.text(originalText).prop('disabled', false);
                $summaryInput.attr('placeholder', '');
            }
        });
    }

    // 6. Hàm khởi tạo (Init) - Chạy khi DOM Ready
    function init() {
        console.log( 'NongNghiep40 JS loaded' );

        // Cache các selector jQuery
        $form = $( '#nongnghiep-entry-form' );
        $action = $( '#nn-form-action' );
        $idInput = $( '#nn-form-id' );
        $nameInput = $( '#nn-form-name' );
        $urlInput = $( '#nn-form-url' );
        $summaryInput = $( '#nn-form-summary' );
        $categoryInput = $( '#nn-form-category' );
        $submitBtn = $( '#nn-btn-submit' );
        $cancelBtn = $( '#nn-btn-cancel' );
        $summarizeBtn = $( '#nn-btn-summarize' );
        $urlFeedback = $( '#nn-url-feedback' );

        // Setup Autocomplete
        setupAutocomplete();

        // Đăng ký sự kiện (Binding Events)
        $( document ).on( 'click', '.edit-btn', handleEdit );
        $cancelBtn.on( 'click', handleCancel );
        $( document ).on( 'click', '.delete-form button', handleDelete );
        
        $urlInput.on('blur', handleUrlChange);
        $summarizeBtn.on('click', handleSummarize);
    }

    function setupAutocomplete() {
        var $suggestions = $( '#nn-category-suggestions' );
        var categories = mw.config.get( 'nnCategories' ) || [];

        // Show suggestions function
        function showSuggestions( value ) {
            $suggestions.empty();
            var filtered = categories.filter( function ( cat ) {
                return cat.toLowerCase().indexOf( value.toLowerCase() ) !== -1;
            } );

            if ( filtered.length > 0 ) {
                filtered.forEach( function ( cat ) {
                    var $item = $( '<div>' )
                        .addClass( 'nongnghiep-suggestion-item' )
                        .text( cat );
                    
                    $item.on( 'click', function () {
                        $categoryInput.val( cat );
                        $suggestions.hide();
                    } );

                    $suggestions.append( $item );
                } );
                $suggestions.show();
            } else {
                $suggestions.hide();
            }
        }

        // Input focus/input/click event
        $categoryInput.on( 'focus input click', function () {
            showSuggestions( $( this ).val() );
        } );

        // Hide when clicking outside
        $( document ).on( 'click', function ( e ) {
            if ( !$( e.target ).closest( '.nongnghiep-form-group' ).length ) {
                $suggestions.hide();
            }
        } );
    }

    // Gọi hàm init khi trang tải xong
    $( init );

}( jQuery, mediaWiki ) );