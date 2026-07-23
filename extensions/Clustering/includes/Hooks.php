<?php
namespace Clustering;

use OutputPage;
use Title;
use MediaWiki\MediaWikiServices;

/**
 * Lớp Hooks quản lý các sự kiện xen ngang của MediaWiki
 */
class Hooks {

    /**
     * Chèn Banner thông báo kết quả phân cụm mới nhất lên đầu nội dung Trang chính
     * Dùng hook OutputPageBeforeHTML để có thể PREPEND vào $text (BeforePageDisplay không hỗ trợ việc này)
     */
    public static function onOutputPageBeforeHTML( OutputPage $out, &$text ) {
        $title = $out->getTitle();

        if ( !$title || !$title->isMainPage() ) {
            return true;
        }

        $cache = MediaWikiServices::getInstance()->getMainObjectCache();
        $latest = $cache->get( 'wikicrop-clustering-latest' );

        if ( !$latest ) {
            return true;
        }

        $algoName = htmlspecialchars( strtoupper( $latest['algorithm'] ) );
        $datasetName = htmlspecialchars( $latest['dataset'] );
        $timeStr = date( 'd/m/Y H:i', $latest['timestamp'] );

        $specialPageTitle = Title::newFromText( 'Special:Clustering' );
        $url = $specialPageTitle ? $specialPageTitle->getLocalURL( [ 'load_latest' => 1 ] ) : '#';

        $html = "
        <div class='wikicrop-clustering-alert' style='
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-left: 5px solid #4f46e5;
            padding: 16px 20px;
            border-radius: 12px;
            margin-bottom: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border: 1px solid #e2e8f0;
            border-left-width: 5px;
        '>
            <div style='display: flex; align-items: center; gap: 14px;'>
                <div style='
                    background: #4f46e5; color: white; width: 40px; height: 40px;
                    border-radius: 10px; display: flex; align-items: center;
                    justify-content: center; font-size: 20px;
                    box-shadow: 0 4px 8px rgba(79, 70, 229, 0.2);
                '>📊</div>
                <div>
                    <h4 style='margin: 0; font-size: 16px; color: #1e293b; font-weight: 700;'>WikiCrop AI: Đã có cập nhật Gom Cụm Mới</h4>
                    <p style='margin: 3px 0 0 0; font-size: 13px; color: #64748b;'>
                        Thuật toán: <span style='color: #0f172a; font-weight: 600;'>{$algoName}</span>
                        <span style='margin: 0 4px; color: #cbd5e1;'>|</span>
                        Tập dữ liệu: <span style='color: #0f172a; font-weight: 600;'>{$datasetName}</span>
                        <span style='color: #cbd5e1; margin: 0 6px;'>•</span>
                        <span style='font-style: italic; font-size: 12px;'>Cập nhật lúc: {$timeStr}</span>
                    </p>
                </div>
            </div>
            <a href='{$url}' style='
                background: #0f172a; color: white; padding: 10px 18px;
                border-radius: 8px; font-weight: 600; font-size: 13px;
                text-decoration: none; box-shadow: 0 4px 6px rgba(15, 23, 42, 0.15);
                display: inline-flex; align-items: center; gap: 6px;
            '>🔍 Xem kết quả gom cụm</a>
        </div>
        ";

        // Nối vào ĐẦU $text — đây là chuỗi HTML thực sự sẽ render, prepend hợp lệ ở đây
        $text = $html . $text;

        return true;
    }
}