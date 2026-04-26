<?php

class QuanLyNongNghiep40Hooks {
    public static function onLoadExtensionSchemaUpdates( $updater ) {
        $dir = __DIR__ . '/../sql';
        $updater->addExtensionTable( 'nongnghiep40_resources', "$dir/table.sql" );
        return true;
    }
}