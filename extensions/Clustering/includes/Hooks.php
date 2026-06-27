<?php

namespace MediaWiki\Extension\Clustering;

use Skin;
use SpecialPage;

class Hooks {
    /**
     * Tự động thêm mục menu vào Sidebar/Main Menu
     */
    public static function onSidebarBeforeOutput( Skin $skin, array &$sidebar ) {
        $clusteringUrl = SpecialPage::getTitleFor( 'Clustering' )->getLocalURL();

        // Chèn tự động vào mục 'navigation' (Menu chính của Vector-2022)
        $sidebar['navigation']['clustering-tool'] = [
            'text' => 'Gom cụm dữ liệu',
            'href' => $clusteringUrl,
            'id'   => 'n-clustering',
            'class' => 'mw-list-item'
        ];

        return true;
    }
}