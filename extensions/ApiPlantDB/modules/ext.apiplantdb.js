/* ext.apiplantdb.js */
(function ($, mw) {
    'use strict';
    
    $(function () {
        
        // Handle Edit button click (using delegation for robustness)
        $(document).on('click', '.plantdb-btn-edit', function(e) {
            e.preventDefault();
            
            var $btn = $(this);
            var wikiName = $btn.data('wiki-name'); // jQuery automatically decodes types
            var plantDbId = $btn.data('plantdb-id');
            
            console.log('Edit clicked:', wikiName, plantDbId); // Debugging

            // Populate form
            var $wikiInput = $('input[name="wiki_url"]');
            var $plantInput = $('input[name="plantdb_url"]');
            
            $wikiInput.val(wikiName);
            $plantInput.val(plantDbId);
            
            // Focus on Wiki URL field
            $wikiInput.trigger('focus');
            
            // Scroll to form if needed
            var $formWrapper = $('.apiplantdb-form-wrapper');
            if ($formWrapper.length) {
                $('html, body').animate({
                    scrollTop: $formWrapper.offset().top - 100
                }, 500);
            }
        });

    });

}(jQuery, mediaWiki));
