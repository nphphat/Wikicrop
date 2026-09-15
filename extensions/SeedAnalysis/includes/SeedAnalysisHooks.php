<?php

class SeedAnalysisHooks {
    /**
     * Add the SeedVision analysis module to the wiki navigation when enabled.
     *
     * @param Skin $skin
     * @param array &$bar
     */
    public function onSkinBuildSidebar( $skin, &$bar ) {
        $title = SpecialPage::getTitleFor( 'SeedAnalysis' );
        $currentTitle = $skin->getTitle();
        $item = [
            'text' => $skin->msg( 'seedanalysis-nav-text' )->text(),
            'href' => $title->getLocalURL(),
            'id' => 'n-seedanalysis',
            'active' => $currentTitle && $currentTitle->isSpecial( 'SeedAnalysis' ),
        ];

        if ( !isset( $bar['navigation'] ) || !is_array( $bar['navigation'] ) ) {
            $bar['navigation'] = [];
        }

        foreach ( $bar['navigation'] as $existingItem ) {
            if ( isset( $existingItem['id'] ) && $existingItem['id'] === 'n-seedanalysis' ) {
                return;
            }
        }

        $bar['navigation'][] = $item;
    }
}
