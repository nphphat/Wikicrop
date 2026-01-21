<?php

namespace MediaWiki\Extension\MicrosoftClarity;

use OutputPage;
use Skin;
use MediaWiki\MediaWikiServices;

class Hooks {
    public static function onBeforePageDisplay( OutputPage $out, Skin $skin ) {
        $config = MediaWikiServices::getInstance()->getMainConfig();
        
        $clarityId = $config->get( 'MicrosoftClarityID' );

        if ( !$clarityId ) {
            return;
        }

        $script = <<<SCRIPT
        <script type="text/javascript">
            (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "{$clarityId}");
        </script>
        <script src="https://t.contentsquare.net/uxa/a9ff8608e4f82.js"></script>
        SCRIPT;

        $out->addHeadItem( 'microsoft-clarity-script', $script );
    }
}
