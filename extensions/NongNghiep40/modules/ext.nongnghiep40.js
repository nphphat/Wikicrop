
( function () {
	$( function () {
		var $modal = $( '#nongnghieptube-modal' );
		var $iframe = $( '#nongnghieptube-modal-iframe' );
		var $title = $( '#nongnghieptube-modal-title' );
		var $desc = $( '#nongnghieptube-modal-desc' );
		var $closeBtn = $( '.nongnghieptube-close' );

		// Open modal when clicking on title or thumbnail (delegated)
		$( document ).on( 'click', '.nongnghieptube-video-card', function ( e ) {
			e.preventDefault();
			var videoId = $( this ).data( 'video-id' );
			var title = $( this ).data( 'title' );
			var summary = $( this ).data( 'summary' );

			if ( videoId ) {
				$iframe.attr( 'src', 'https://www.youtube.com/embed/' + videoId + '?autoplay=1' );
				$title.text( title );
				$desc.text( summary );
				$modal.addClass( 'show' );
				$modal.show();
			}
		} );

		// Close modal
		function closeModal() {
			$modal.hide();
			$modal.removeClass( 'show' );
			$iframe.attr( 'src', '' ); // Stop video
		}

		$closeBtn.on( 'click', closeModal );

		// Close when clicking outside content
		$modal.on( 'click', function ( e ) {
			if ( $( e.target ).is( $modal ) ) {
				closeModal();
			}
		} );

		// Close with Escape key
		$( document ).on( 'keydown', function ( e ) {
			if ( e.key === 'Escape' && $modal.is( ':visible' ) ) {
				closeModal();
			}
		} );
	} );
}() );
