(function ($, mw) {
    'use strict';
    
    $(function () {
        
        $(document).on('click', '.plantdb-btn-edit', function(e) {
            e.preventDefault();
            
            var $btn = $(this);
            var wikiName = $btn.data('wiki-name');
            var plantDbId = $btn.data('plantdb-id');
            
            console.log('Edit clicked:', wikiName, plantDbId);

            var $wikiInput = $('input[name="wiki_url"]');
            var $plantInput = $('input[name="plantdb_url"]');
            
            $wikiInput.val(wikiName);
            $plantInput.val(plantDbId);
            
            $wikiInput.trigger('focus');
            
            var $formWrapper = $('.apiplantdb-form-wrapper');
            if ($formWrapper.length) {
                $('html, body').animate({
                    scrollTop: $formWrapper.offset().top - 100
                }, 500);
            }
        });

    });

}(jQuery, mediaWiki));
