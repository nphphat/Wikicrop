( function ( $, mw ) {
    'use strict';

    $( function () {
        console.log( 'NongNghiep40 JS loaded' );

        var $form = $( '#nongnghiep-entry-form' );
        var $action = $( '#nn-form-action' );
        var $idInput = $( '#nn-form-id' );
        var $nameInput = $( '#nn-form-name' );
        var $urlInput = $( '#nn-form-url' );
        var $summaryInput = $( '#nn-form-summary' );
        var $submitBtn = $( '#nn-btn-submit' );
        var $cancelBtn = $( '#nn-btn-cancel' );

        $( document ).on( 'click', '.edit-btn', function ( e ) {
            e.preventDefault(); 
            console.log( 'Edit button clicked' );

            var $btn = $( this );
            var id = $btn.data( 'id' );
            var name = $btn.data( 'name' );
            var url = $btn.data( 'url' );
            var summary = $btn.data( 'summary' );

            $action.val( 'edit' );
            $idInput.val( id );
            $nameInput.val( name );
            $urlInput.val( url );
            $summaryInput.val( summary );

            $submitBtn.text( 'Cập nhật' );
            $cancelBtn.show();

            if ( $form.length ) {
                $( 'html, body' ).animate( { scrollTop: $form.offset().top - 100 }, 500 );
            } else {
                console.error('Form #nongnghiep-entry-form not found');
            }
        } );

        $cancelBtn.on( 'click', function ( e ) {
            e.preventDefault();
            console.log( 'Cancel button clicked' );

            $form[0].reset();
            $action.val( 'add' );
            $idInput.val( '' );

            $submitBtn.text( 'Lưu dữ liệu' );
            $cancelBtn.hide();
        } );

        $( document ).on( 'click', '.delete-form button', function () {
            return confirm( 'Bạn có chắc chắn muốn xóa không?' );
        } );

    } );
}( jQuery, mediaWiki ) );