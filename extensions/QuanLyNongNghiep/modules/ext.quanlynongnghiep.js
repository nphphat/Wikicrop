// ( function ( $, mw ) {
//     'use strict';

//     $( function () {
//         console.log( 'NongNghiep40 JS loaded' );

//         var $form = $( '#nongnghiep-entry-form' );
//         var $action = $( '#nn-form-action' );
//         var $idInput = $( '#nn-form-id' );
//         var $nameInput = $( '#nn-form-name' );
//         var $urlInput = $( '#nn-form-url' );
//         var $summaryInput = $( '#nn-form-summary' );
//         var $categoryInput = $( '#nn-form-category' );
//         var $submitBtn = $( '#nn-btn-submit' );
//         var $cancelBtn = $( '#nn-btn-cancel' );

//         $( document ).on( 'click', '.edit-btn', function ( e ) {
//             e.preventDefault(); 
//             console.log( 'Edit button clicked' );

//             var $btn = $( this );
//             var id = $btn.data( 'id' );
//             var name = $btn.data( 'name' );
//             var url = $btn.data( 'url' );
//             var summary = $btn.data( 'summary' );
//             var category = $btn.data('category');

//             $action.val( 'edit' );
//             $idInput.val( id );
//             $nameInput.val( name );
//             $urlInput.val( url );
//             $summaryInput.val( summary );
//             $categoryInput.val( category );

//             $submitBtn.text( 'Cập nhật' );
//             $cancelBtn.show();

//             if ( $form.length ) {
//                 $( 'html, body' ).animate( { scrollTop: $form.offset().top - 100 }, 500 );
//             } else {
//                 console.error('Form #nongnghiep-entry-form not found');
//             }
//         } );

//         $cancelBtn.on( 'click', function ( e ) {
//             e.preventDefault();
//             console.log( 'Cancel button clicked' );

//             $form[0].reset();
//             $action.val( 'add' );
//             $idInput.val( '' );

//             $submitBtn.text( 'Lưu dữ liệu' );
//             $cancelBtn.hide();
//         } );

//         $( document ).on( 'click', '.delete-form button', function () {
//             return confirm( 'Bạn có chắc chắn muốn xóa không?' );
//         } );

//     } );
// }( jQuery, mediaWiki ) );

( function ( $, mw ) {
    'use strict';

    // 1. Khai báo biến ở phạm vi ngoài để dùng chung cho các hàm
    var $form, $action, $idInput, $nameInput, $urlInput, $summaryInput, $categoryInput, $submitBtn, $cancelBtn;

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
    }

    // 4. Hàm xử lý xác nhận xóa
    function handleDelete() {
        return confirm( 'Bạn có chắc chắn muốn xóa không?' );
    }

    // 5. Hàm khởi tạo (Init) - Chạy khi DOM Ready
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

        // Đăng ký sự kiện (Binding Events)
        $( document ).on( 'click', '.edit-btn', handleEdit );
        $cancelBtn.on( 'click', handleCancel );
        $( document ).on( 'click', '.delete-form button', handleDelete );
    }

    // Gọi hàm init khi trang tải xong
    $( init );

}( jQuery, mediaWiki ) );