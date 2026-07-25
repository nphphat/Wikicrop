<?php
namespace Clustering;

use SpecialPage;
use MediaWiki\MediaWikiServices;
use Title;
use User;
use ContentHandler;
use CommentStoreComment;
use MediaWiki\Revision\SlotRecord;

class SpecialClustering extends SpecialPage {

    /* Tên tài khoản Bot hệ thống dùng để ghi kết quả ML và tải ảnh lên bài viết */
    const BOT_USERNAME = 'WikiCropBot';

    public function __construct() {
        // ✅ Gọi constructor lớp cha để đăng ký tên SpecialPage
        parent::__construct( 'Clustering' );
    }

    /**
     * Lấy (hoặc tạo mới nếu chưa có) tài khoản Bot hệ thống nội bộ
     */
    private function getOrCreateBotUser() {
        $bot = User::newFromName( self::BOT_USERNAME );
        if ( !$bot ) {
            throw new \Exception( 'Tên tài khoản Bot không hợp lệ.' );
        }
        if ( $bot->getId() === 0 ) {
            // Tạo mới tài khoản dưới dạng System User nếu chưa tồn tại
            $bot = User::newSystemUser( self::BOT_USERNAME, [ 'steal' => true ] );
            if ( !$bot ) {
                throw new \Exception( 'Không thể khởi tạo tài khoản Bot hệ thống.' );
            }
            
            $userGroupManager = MediaWikiServices::getInstance()->getUserGroupManager();
            $userGroupManager->addUserToGroup( $bot, 'sysop' );
            $bot->saveSettings();
        }
        return $bot;
    }

   
    // private function uploadCanvasImage( $base64Data, $fileName, $botUser ) {
    //     if ( !$base64Data || strpos( $base64Data, 'data:image' ) === false ) {
    //         return null;
    //     }

    //     $parts = explode( ',', $base64Data );
    //     $decodedData = base64_decode( end( $parts ) );
    //     if ( !$decodedData ) {
    //         return null;
    //     }

    //     $tmpPath = sys_get_temp_dir() . '/' . $fileName;
    //     file_put_contents( $tmpPath, $decodedData );

    //     $services = MediaWikiServices::getInstance();
    //     $repoGroup = $services->getRepoGroup();

    //     $title = Title::makeTitleSafe( NS_FILE, $fileName );
    //     if ( !$title ) {
    //         @unlink( $tmpPath );
    //         return null;
    //     }

    //     $file = $repoGroup->findFile( $title );
    //     if ( !$file ) {
    //         $file = $repoGroup->getLocalRepo()->newFile( $title );
    //     }

    //     // Tải file tạm vào thư mục lưu trữ local
    //     $archive = $file->publish( $tmpPath );
    //     if ( $archive->isOK() ) {
    //         // 🟢 CHUẨN HÓA 6 THAM SỐ CỦA recordUpload2:
    //         // 1: archive name, 2: comment, 3: page text, 4: props, 5: timestamp (false), 6: user ($botUser)
    //         $file->recordUpload2(
    //             $archive->value,
    //             'Tải lên tự động sơ đồ cây từ WikiCrop AI',
    //             'Sơ đồ đồ họa mô hình ML',
    //             false,
    //             false,   // 👈 Tham số thứ 5: $timestamp (đặt false để lấy thời gian hiện tại)
    //             $botUser // 👈 Tham số thứ 6: $user (truyền botUser chuẩn vị trí)
    //         );
    //         @unlink( $tmpPath );
    //         return $title->getDBkey();
    //     }

    //     @unlink( $tmpPath );
    //     return null;
    // }


    /**
     * Tải ảnh Base64 từ Canvas vào CSDL & Kho tệp tin của MediaWiki (Đã sửa lỗi publish)
     */
    private function uploadCanvasImage( $base64Data, $fileName, $botUser ) {
        if ( !$base64Data || strpos( $base64Data, 'data:image' ) === false ) {
            return null;
        }

        $parts = explode( ',', $base64Data );
        $decodedData = base64_decode( end( $parts ) );
        if ( !$decodedData ) {
            return null;
        }

        $tmpPath = sys_get_temp_dir() . '/' . $fileName;
        file_put_contents( $tmpPath, $decodedData );

        $title = Title::makeTitleSafe( NS_FILE, $fileName );
        if ( !$title ) {
            @unlink( $tmpPath );
            return null;
        }

        $services = MediaWikiServices::getInstance();
        $repoGroup = $services->getRepoGroup();
        $localRepo = $repoGroup->getLocalRepo();

        // 1. Khởi tạo đối tượng File
        $file = $localRepo->newFile( $title );

        // // 2. Xác định đường dẫn lưu file chuẩn trong kho MediaWiki
        // $dstRel = $localRepo->getHashPath( $title->getDBkey() ) . $title->getDBkey();
        // $dstPath = $localRepo->getZonePath( 'public' ) . '/' . $dstRel;

        // // 3. Dùng LocalRepo để publish file tạm vào kho chứa
        // $status = $localRepo->publish( $tmpPath, $dstPath );

        // if ( $status->isOK() ) {
        //     // 4. Ghi nhận file vào cơ sở dữ liệu (bảng image) của MediaWiki
        //     $file->recordUpload2(
        //         '', // archive name (rỗng cho tệp mới)
        //         'Tải lên tự động sơ đồ cây từ WikiCrop AI',
        //         'Sơ đồ đồ họa mô hình ML',
        //         false,
        //         false,
        //         $botUser
        //     );
        //     @unlink( $tmpPath );
        //     return $title->getDBkey();
        // }

        // @unlink( $tmpPath );
        // return null;

        // 🟢 NATIVE API: $file->upload tự động di chuyển tệp, phân thư mục hash và đăng ký CSDL Cực kỳ chuẩn xác
        $status = $file->upload(
            $tmpPath,
            'Tải lên tự động sơ đồ cây từ WikiCrop AI',
            'Sơ đồ đồ họa mô hình ML',
            0,
            false,
            false,
            $botUser
        );

        @unlink( $tmpPath );

        if ( $status->isOK() ) {
            return $title->getDBkey();
        }

        return null;
    }

    /**
     * Ghi nối nội dung wikitext vào CUỐI bài viết đích bằng tài khoản Bot
     */
    // private function appendToWikiPage( $pageTitle, $appendText, $summary ) {
    //     $titleObj = Title::newFromText( $pageTitle );
    //     if ( !$titleObj || !$titleObj->exists() ) {
    //         throw new \Exception( 'Trang bài viết không tồn tại: ' . $pageTitle );
    //     }

    //     $services = MediaWikiServices::getInstance();
    //     $wikiPage = $services->getWikiPageFactory()->newFromTitle( $titleObj );

    //     $currentContent = $wikiPage->getContent();
    //     $currentText = $currentContent ? $currentContent->getText() : '';
    //     $newText = $currentText . $appendText;
    //     $newContent = ContentHandler::makeContent( $newText, $titleObj );

    //     $botUser = $this->getOrCreateBotUser();

    //     $updater = $wikiPage->newPageUpdater( $botUser );
    //     $updater->setContent( SlotRecord::MAIN, $newContent );
    //     $comment = CommentStoreComment::newUnsavedComment( $summary );
    //     $updater->saveRevision( $comment, EDIT_UPDATE );

    //     if ( !$updater->wasSuccessful() ) {
    //         throw new \Exception( 'Ghi bài viết thất bại: ' . $updater->getStatus()->getWikiText() );
    //     }
    // }


    private function appendToWikiPage( $pageTitle, $appendText, $summary ) {
        $titleObj = Title::newFromText( $pageTitle );
        if ( !$titleObj || !$titleObj->exists() ) {
            throw new \Exception( 'Trang bài viết không tồn tại: ' . $pageTitle );
        }

        $services = MediaWikiServices::getInstance();
        $wikiPage = $services->getWikiPageFactory()->newFromTitle( $titleObj );

        $currentContent = $wikiPage->getContent();
        $currentText = $currentContent ? $currentContent->getText() : '';
        $newText = $currentText . $appendText;
        $newContent = ContentHandler::makeContent( $newText, $titleObj );

        $botUser = $this->getOrCreateBotUser();

        $updater = $wikiPage->newPageUpdater( $botUser );
        $updater->setContent( SlotRecord::MAIN, $newContent );
        $comment = CommentStoreComment::newUnsavedComment( $summary );
        $updater->saveRevision( $comment, EDIT_UPDATE );

        if ( !$updater->wasSuccessful() ) {
            throw new \Exception( 'Ghi bài viết thất bại: ' . $updater->getStatus()->getWikiText() );
        }
    }
    
    // public function execute( $subPage ) {
    //     $out = $this->getOutput();
    //     $request = $this->getRequest();

    //     if ( $request->getVal( 'clustering_action' ) === 'save_latest' && $request->wasPosted() ) {
    //         $out->disable(); 
    //         if ( ob_get_length() ) { ob_clean(); }
    //         $request->response()->header( 'Content-Type: application/json' );

    //         try {
    //             $algorithm = $request->getVal( 'algorithm' );
    //             $dataset = $request->getVal( 'dataset' );
    //             $resultData = $request->getVal( 'result_data' );
    //             $targetPage = $request->getVal( 'target_page' ); 
    //             $appendWikitext = $request->getVal( 'append_wikitext' ); 
    //             $imageBase64 = $request->getVal( 'image_base64' ); 

    //             if ( $algorithm === null || $dataset === null || $resultData === null ) {
    //                 throw new \Exception( 'Thiếu tham số bắt buộc.' );
    //             }

    //             $botUser = $this->getOrCreateBotUser();

    //             // Tải ảnh sơ đồ vào hệ thống nếu có
    //             if ( $imageBase64 ) {
    //                 $cleanAlgo = preg_replace( '/[^a-zA-Z0-9_]/', '', $algorithm );
    //                 $imageFileName = 'So_Do_Cay_' . $cleanAlgo . '_' . date( 'Ymd_His' ) . '.png';
                    
    //                 try {
    //                     $uploadedFileName = $this->uploadCanvasImage( $imageBase64, $imageFileName, $botUser );
    //                     if ( $uploadedFileName ) {
    //                         $appendWikitext .= "\n\n=== Sơ đồ đồ họa mô hình (" . strtoupper($algorithm) . ") ===\n[[File:" . $uploadedFileName . "|center|thumb|800px|Sơ đồ trực quan phân nhánh cây kết quả]]\n";
    //                     }
    //                 } catch ( \Throwable $imgErr ) {
    //                     // Bỏ qua lỗi ảnh nếu upload thất bại để vẫn lưu được nội dung bảng
    //                 }
    //             }

    //             if ( $targetPage && $appendWikitext ) {
    //                 $this->appendToWikiPage(
    //                     $targetPage,
    //                     $appendWikitext,
    //                     'WikiCrop AI: cập nhật kết quả ' . ( $algorithm ? $algorithm : '' ) . ' (tự động qua Bot)'
    //                 );
    //             }

    //             echo json_encode( [ 'status' => 'success', 'message' => 'Đã đồng bộ kết quả thành công!' ] );
    //         } catch ( \Throwable $e ) { 
    //             http_response_code( 200 ); 
    //             echo json_encode( [ 'status' => 'error', 'message' => $e->getMessage() ] );
    //         }
    //         return;
    //     }

    //     $this->setHeaders();
    //     $out->setHTMLTitle( 'Gom cụm và Phân lớp dữ liệu nông học - WikiCrop' );
    //     $out->addModules( 'ext.clustering' );

    //     $out->addHTML( $this->buildForm( 'null' ) );
    // }


    public function execute( $subPage ) {
        $out = $this->getOutput();
        $request = $this->getRequest();

        if ( $request->getVal( 'clustering_action' ) === 'save_latest' && $request->wasPosted() ) {
            $out->disable(); 
            if ( ob_get_length() ) { ob_clean(); }
            $request->response()->header( 'Content-Type: application/json' );

            try {
                $algorithm = $request->getVal( 'algorithm' );
                $dataset = $request->getVal( 'dataset' );
                $resultData = $request->getVal( 'result_data' );
                $targetPage = $request->getVal( 'target_page' ); 
                $appendWikitext = $request->getVal( 'append_wikitext' ); 
                $imageBase64 = $request->getVal( 'image_base64' ); 

                if ( $algorithm === null || $dataset === null || $resultData === null ) {
                    throw new \Exception( 'Thiếu tham số bắt buộc.' );
                }

                $botUser = $this->getOrCreateBotUser();

                // Tải ảnh sơ đồ cây vào CSDL nếu có
                if ( $imageBase64 ) {
                    $cleanAlgo = preg_replace( '/[^a-zA-Z0-9_]/', '', $algorithm );
                    $imageFileName = 'So_Do_Cay_' . $cleanAlgo . '_' . date( 'Ymd_His' ) . '.png';
                    
                    try {
                        $uploadedFileName = $this->uploadCanvasImage( $imageBase64, $imageFileName, $botUser );
                        if ( $uploadedFileName ) {
                            $appendWikitext .= "\n\n=== Sơ đồ trực quan (" . strtoupper($algorithm) . ") ===\n[[Tập tin:" . $uploadedFileName . "|center|thumb|800px|Sơ đồ trực quan phân nhánh kết quả]]\n";
                        }
                    } catch ( \Throwable $imgErr ) {
                        // Bỏ qua lỗi ảnh để vẫn ghi được bảng dữ liệu
                    }
                }

                if ( $targetPage && $appendWikitext ) {
                    $this->appendToWikiPage(
                        $targetPage,
                        $appendWikitext,
                        'WikiCrop AI: cập nhật kết quả ' . ( $algorithm ? $algorithm : '' ) . ' (tự động qua Bot)'
                    );
                }

                echo json_encode( [ 'status' => 'success', 'message' => 'Đã đồng bộ kết quả thành công!' ] );
            } catch ( \Throwable $e ) { 
                http_response_code( 200 ); 
                echo json_encode( [ 'status' => 'error', 'message' => $e->getMessage() ] );
            }
            return;
        }

        $this->setHeaders();
        $out->setHTMLTitle( 'Gom cụm và Phân lớp dữ liệu nông học - WikiCrop' );
        $out->addModules( 'ext.clustering' );

        $out->addHTML( $this->buildForm( 'null' ) );
    }

    private function buildForm( $preloadedJson ) {
        return <<<HTML
        <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        
        <style>
            #firstHeading, .firstHeading, .mw-first-heading, #siteSub, #contentSub, #contentSub2 {
                display: none !important;
            }

            .clustering-sidebar .menu-label {
                font-size: 13px !important;
                font-weight: 700 !important;
                color: #94a3b8 !important;
                margin-top: 26px !important;
                margin-bottom: 14px !important;
                letter-spacing: 0.06em !important;
                text-transform: uppercase !important;
            }
            .clustering-sidebar .clustering-menu .menu-item {
                font-size: 15px !important;
                font-weight: 600 !important;
                padding: 13px 18px !important; 
                margin-bottom: 8px !important; 
                border-radius: 8px !important;
                transition: all 0.2s ease-in-out !important;
                display: flex !important;
                align-items: center !important;
                min-height: 48px !important;
            }
            .clustering-sidebar .clustering-menu .menu-item .step-circle {
                width: 26px !important; 
                height: 26px !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                margin-right: 12px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 50% !important;
            }
            .clustering-sidebar .clustering-menu .submenu {
                padding: 0 !important;
                margin: 0 !important;
                list-style: none !important;
            }
            .clustering-sidebar .clustering-menu .submenu li {
                font-size: 14px !important;
                font-weight: 500 !important;
                padding: 11px 18px 11px 56px !important; 
                margin-top: 4px !important;
                border-radius: 6px !important;
                transition: all 0.2s ease-in-out !important;
                list-style: none !important;
                cursor: pointer;
            }
            .clustering-sidebar .btn-new-session {
                padding: 13px 20px !important; 
                font-size: 15px !important;
                font-weight: 600 !important;
                border-radius: 8px !important;
                margin-bottom: 20px !important;
            }

            #view-preprocess.active {
                display: flex !important;
                flex-direction: column !important;
                min-height: calc(100vh - 140px) !important; 
            }
            #view-preprocess .ml-layout {
                display: flex !important;
                align-items: stretch !important; 
                flex: 1 !important;
                gap: 20px !important;
            }
            #view-preprocess .ml-config-panel {
                width: 380px !important; 
                display: flex !important;
                flex-direction: column !important;
            }
            #view-preprocess .ml-config-content {
                padding: 28px 24px !important; 
                flex: 1 !important;
            }
            #view-preprocess .form-group {
                margin-bottom: 30px !important; 
            }
            #view-preprocess .form-group label {
                display: block !important;
                margin-bottom: 12px !important; 
                font-size: 14px !important;
                font-weight: 600 !important;
                color: #475569 !important;
            }
            #view-preprocess .form-control {
                height: 46px !important; 
                padding: 10px 14px !important;
                font-size: 14px !important;
                border-radius: 6px !important;
            }
            #view-preprocess #btnApplyFilter {
                margin-top: 15px !important; 
                padding: 13px 24px !important; 
                font-size: 15px !important;
                font-weight: 600 !important;
                border-radius: 8px !important;
            }
            .ml-results-panel {
                display: flex !important;
                flex-direction: column !important;
                flex: 1 !important;
            }
            #view-preprocess .result-card {
                display: flex !important;
                flex-direction: column !important;
                flex: 1 !important; 
                margin-top: 0 !important;
                padding: 24px !important;
            }
            #view-preprocess .preprocess-table-container {
                flex: 1 !important; 
                overflow-y: auto !important; 
                overflow-x: auto !important; 
                border: 1px solid #e2e8f0 !important;
                border-radius: 8px !important;
                background: #ffffff !important;
                margin-top: 12px !important;
            }
        </style>
        
        <div id="clustering-app" data-preloaded="{$preloadedJson}">
            
            <aside class="clustering-sidebar">
                <div class="clustering-logo">
                    <span style="font-size: 24px;">🌱</span> WikiCrop 
                </div>
                
                <button class="btn-new-session"> New Session </button>
                
                <div class="menu-label">ML WORKFLOW</div>
                <ul class="clustering-menu">
                    <li><div class="menu-item active" data-nav="dataloader"><div class="step-circle">1</div><span> Data Loader</span></div></li>
                    <li><div class="menu-item" data-nav="preprocess"><div class="step-circle">2</div><span> Preprocess</span></div></li>
                    <li>
                        <div class="menu-item"><div class="step-circle">3</div><span> ML Task</span><span class="menu-arrow">▼</span></div>
                        <ul class="submenu">
                            <li data-nav="clustering">Clustering (Gom cụm)</li>
                            <li data-nav="classification">Classification (Phân lớp)</li>
                            <li data-nav="regression">Regression (Hồi quy)</li>
                        </ul>
                    </li>
                </ul>
            </aside>

            <main class="clustering-main">
                
                <header class="clustering-topbar">
                    <div class="topbar-left">
                        <span id="btn-toggle-sidebar" style="cursor:pointer; padding-right: 8px; font-weight: bold; font-size: 16px;">❮</span> 
                        <span id="current-step-title"> Data Loader</span>
                    </div>
                    <div class="topbar-right">
                        <input type="file" id="fileInput" accept=".csv, .xlsx, .xls, .arff" style="display:none">
                        <div id="fileBadge" style="display: none; background: #e0e7ff; color: #4338ca; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid #c7d2fe; align-items: center; gap: 6px;">
                            🗄️ <span id="fileName"></span>
                        </div>
                    </div>
                </header>

                <div class="clustering-content">
                    
                    <div id="view-dataloader" class="view-section active">
                        <style>
                            #empty-dataloader { transition: all 0.2s ease-in-out; }
                            #empty-dataloader:hover { border-color: #6366f1 !important; background-color: #f8fafc !important; }
                        </style>
                        <div id="empty-dataloader-wrapper" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; min-height: 70vh;">
                            <div id="empty-dataloader" style="width: 100%; max-width: 650px; padding: 60px 20px; display: flex; flex-direction: column; align-items: center; border: 2px dashed #cbd5e1; background: #ffffff; border-radius: 12px; cursor: pointer;">
                                <div style="color: #6366f1; margin-bottom: 24px;"><svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></div>
                                <h3 style="color: #1e293b; margin-bottom: 8px; font-size: 26px; font-weight: 700;">Upload Your Dataset</h3>
                                <p style="color: #64748b; font-size: 13px; font-weight: 500; margin-bottom: 24px; text-align: center;">Hỗ trợ các định dạng tệp tin Excel (.xlsx, .xls), CSV (.csv) và ARFF (.arff)</p>
                                <button id="btnUploadCenter" style="background: #6366f1; color: white; border: none; padding: 14px 40px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;">Choose File</button>
                            </div>
                        </div>

                        <div id="dataloader-content" style="display: none;">
                            <div id="alert-container"></div>
                            <div class="clustering-tabs">
                                <div class="clustering-tab active" data-tab="tab-overview"> Overview </div>
                                <div class="clustering-tab" data-tab="tab-preview"> Data Preview </div>
                                <div class="clustering-tab" data-tab="tab-visualization"> Visualization </div>
                            </div>
                            <div id="tab-overview" class="tab-pane" style="display: block;">
                                <div class="overview-grid">
                                    <div class="stat-card"><div class="stat-icon">🗄️</div><div><div class="stat-val" id="st-rows">0</div><div class="stat-label">Instances</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#3b82f6; background:#eff6ff;">🪟</div><div><div class="stat-val" id="st-cols">0</div><div class="stat-label">Attributes</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#059669; background:#ecfdf5;">🔢</div><div><div class="stat-val" id="st-num">0</div><div class="stat-label">Numeric</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#c026d3; background:#fdf4ff;">🪟</div><div><div class="stat-val" id="st-cat">0</div><div class="stat-label">Categorical</div></div></div>
                                </div>
                                <div class="overview-grid" style="grid-template-columns: repeat(3, 1fr);">
                                    <div class="stat-card"><div class="stat-icon" style="color:#d97706; background:#fffbeb;">⚠️</div><div><div class="stat-val" id="st-missing">0</div><div class="stat-label">Missing Values</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#ef4444; background:#fef2f2;">⚠️</div><div><div class="stat-val" id="st-outliers">0</div><div class="stat-label">Outliers Detected</div></div></div>
                                    <div class="stat-card"><div class="stat-icon" style="color:#059669; background:#ecfdf5;">ℹ️</div><div><div class="stat-val" id="st-duplicates">0</div><div class="stat-label">Duplicate Rows</div></div></div>
                                </div>
                                <div style="display: grid; grid-template-columns: 6fr 4fr; gap: 24px; margin-top: 24px;">
                                    <div class="preview-card" style="padding: 24px;">
                                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 24px; color: var(--text-dark);"><span style="color: #3b82f6;">📊</span> Class Distribution</div>
                                        <div style="width: 100%; height: 260px;"><canvas id="classDistChart" width="600" height="260" style="width: 100%; height: 100%;"></canvas></div>
                                    </div>
                                    <div class="preview-card" style="padding: 24px; display: flex; text-align: left; flex-direction: column; max-height: 360px;">
                                        <div style="font-weight: 600; font-size: 16px; margin-bottom: 16px; color: var(--text-dark);"><span style="color: var(--success);">🗄️</span> Statistics Summary</div>
                                        <div id="stats-summary-list" style="flex: 1; overflow-y: auto; padding-right: 8px;"></div>
                                    </div>
                                </div>
                            </div>
                            <div id="tab-preview" class="tab-pane" style="display: none;">
                                <div class="preview-card"><div style="overflow-x: auto;"><table class="clustering-table" id="preview-table"><thead><tr><th>ROW</th></tr></thead><tbody></tbody></table></div></div>
                            </div>
                            <div id="tab-visualization" class="tab-pane" style="display: none;">
                                <div class="vis-grid" id="vis-container"></div>
                            </div>
                        </div> 
                    </div> 
                    
                    <div id="view-preprocess" class="view-section">
                        <div class="ml-task-header"><strong>Filter:</strong> Chọn bộ lọc để làm sạch và biến đổi dữ liệu trước khi chạy ML Task</div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 350px; margin-top: 0; display: flex; flex-direction: column;">
                                <div class="ml-config-content" style="flex: 1; text-align: left;">
                                    <h3>Choose Filter</h3>
                                    <div class="form-group">
                                        <label>Hành động (Filter Type)</label>
                                        <select id="filter-type" class="form-control">
                                            <option value="remove-missing">Remove Missing Values</option>
                                            <option value="replace-mean">Replace Missing with Mean</option>
                                            <option value="drop-col">Remove Attribute</option>
                                            <option value="remove-duplicates">Remove Duplicates</option>
                                            <option value="remove-outliers">Remove Outliers (IQR) - Xóa dòng</option>
                                            <option value="winsorize-outliers">Winsorize Outliers (IQR Capping) - Giữ dòng</option>
                                            <option value="normalize-minmax">Normalize (Min-Max)</option>
                                            <option value="standardize-zscore">Standardize (Z-score)</option>
                                            <option value="normalize-robust">Robust Scale (Median/IQR) - Chuẩn hóa bền vững</option>
                                        </select>
                                    </div>
                                    <div class="form-group" id="filter-col-group" style="display:none;">
                                        <select id="filter-col-select" class="form-control"></select>
                                    </div>
                                    <button class="ml-btn" id="btnApplyFilter"> Apply Filter</button>
                                </div>
                            </div>
                            <div class="ml-results-panel">
                                <div class="result-card">
                                    <div class="result-header">
                                        <h3 style="color:var(--primary);">Cleaned Data Preview</h3>
                                        <span id="preprocess-status" style="font-size:13px; color:var(--success); font-weight:bold;">Chưa có thay đổi nào.</span>
                                    </div>
                                    <div class="preprocess-table-container"><table class="clustering-table" id="preprocess-table"><thead><tr><th>Đang tải...</th></tr></thead><tbody></tbody></table></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="view-clustering" class="view-section">
                        <div class="ml-task-header">
                            <span id="btn-toggle-config" style="cursor:pointer; padding-right: 12px; font-weight: bold; font-size: 16px; color: #4f46e5;">❮</span>
                            <strong>Clustering Task:</strong> <span id="lbl-algo-header">K-Means</span> &nbsp;|&nbsp; <strong>Evaluation:</strong> <span id="lbl-cluster-eval-header">Full training set</span>
                        </div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 380px;">
                                <div class="ml-config-tabs">
                                    <div class="ml-config-tab active" data-panel="panel-algo">Algorithm</div>
                                    <div class="ml-config-tab" data-panel="panel-eval">Evaluation</div>
                                </div>
                                
                                <div class="ml-config-content active" id="panel-algo" style="text-align: left;">
                                    <h3>Clustering Configuration</h3>
                                    
                                    <div class="form-group">
                                        <label>Algorithm</label>
                                        <select id="algorithm" class="form-control">
                                            <option value="kmeans" selected>K-Means</option>
                                            <option value="hierarchical">Hierarchical</option>
                                            <option value="em">Expectation Maximization</option>
                                            <option value="clara">CLARA</option>
                                        </select>
                                        <div id="algo-desc" class="algo-desc-box">Cluster data using the k means algorithm.</div>
                                    </div>
                                    
                                    <h4 style="margin: 24px 0 12px 0; font-size: 14px; color:var(--text-dark);">Hyperparameters</h4>
                                    
                                    <div class="hyperparams-grid" id="mainParamGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                        
                                        <div class="form-group" id="kValueContainer" style="margin:0;">
                                            <label id="kValueLabel">Number of Clusters</label>
                                            <input type="number" id="kValue" class="form-control" value="3">
                                        </div>

                                        <div class="form-group" id="seedContainer" style="margin:0;">
                                            <label>Random Seed</label>
                                            <input type="number" id="randomSeed" class="form-control" value="10" min="1">
                                        </div>

                                        <div class="form-group" id="distanceContainer" style="margin:0; grid-column: span 2;">
                                            <label>Distance Metric</label>
                                            <select id="distanceMetric" class="form-control">
                                                <option value="EUCLIDEAN" selected>Euclidean Distance</option>
                                                <option value="MANHATTAN">Manhattan Distance</option>
                                                <option value="CHEBYSHEV">Chebyshev Distance</option>
                                                <option value="MINKOWSKI">Minkowski Distance (p=3)</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="hcLinkageContainer" style="display:none; margin:0; grid-column: span 2;">
                                            <label>Link Type</label>
                                            <select id="hcLinkageType" class="form-control">
                                                <option value="AVERAGE" selected>Average Link</option>
                                                <option value="SINGLE">Single Link</option>
                                                <option value="COMPLETE">Complete Link</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="gmmMaxIterGroup" style="display:none; margin:0; grid-column: span 2;">
                                            <label>Max Iterations</label>
                                            <input type="number" id="gmmMaxIter" class="form-control" value="100" min="1">
                                        </div>

                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <label>Attributes Selector</label>
                                        <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; max-height: 120px; overflow-y: auto;" id="featuresList">
                                            <span style="color:#94a3b8; font-size:12px;">Vui lòng Load Data trước...</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="ml-config-content" id="panel-eval" style="display: none; text-align: left;">
                                    <h3>Test Options</h3>
                                    <div class="form-group" style="margin-top: 16px;">
                                        <div style="background:#f8fafc; padding:16px; border-radius:8px; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:12px;">
                                            
                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="testopt" value="training" checked style="margin:0; cursor:pointer;">
                                                <span>Full training set</span>
                                            </label>

                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="testopt" value="split" style="margin:0; cursor:pointer;">
                                                <span>Percentage split:</span>
                                                <input type="number" id="clusterSplitPercent" class="form-control" value="80" min="1" max="99" style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px;">
                                                <span>% train,</span>
                                                <input type="number" id="clusterTestPercent" class="form-control" value="20" disabled style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px; background:#f1f5f9; color:#64748b; border-color:#cbd5e1;">
                                                <span>% test</span>
                                            </label>

                                        </div>
                                    </div>
                                </div>
                                <button class="ml-btn" id="btnRun"> Run Clustering </button>
                            </div>
                            
                            <div class="ml-results-panel">
                                <div id="empty-results" class="empty-state"><div class="empty-icon">📊</div><h3>No Results Yet</h3></div>
                                <div id="resultSection" style="display:none;">
                                    
                                    <div class="result-card" id="metricsCard" style="padding-bottom: 12px;">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Performance Metrics</h3>
                                            <div style="display:flex; gap:8px;">
                                                <button id="btnExport" style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;"> Excel</button>
                                            </div>
                                        </div>
                                        <div class="overview-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom:12px;">
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">Clusters</div><div class="stat-val" id="evalK">--</div></div></div>
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">Instances</div><div class="stat-val" id="evalInstances">--</div></div></div>
                                            <div class="stat-card" style="padding:12px;"><div style="width:100%"><div class="stat-label">SSE</div><div class="stat-val" id="evalSSE">--</div></div></div>
                                        </div>
                                    </div>

                                    <div class="result-card" id="visCard">
                                        <div class="result-header"><h3 id="visCardTitle" style="color:var(--primary);">Cluster Visualization</h3></div>
                                        <canvas id="scatterChart" width="800" height="350" style="width:100%; border:1px solid #e2e8f0; border-radius:6px;"></canvas>
                                    </div>

                                    <div class="result-card" id="tableCard" style="padding:0;">
                                        <div style="padding:20px; border-bottom:1px solid var(--border);"><div id="clusterTabs" style="display:flex; gap:8px; flex-wrap:wrap;"></div></div>
                                        <div id="clusterContent" style="overflow-x:auto; padding:0 20px 20px 20px;"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="view-classification" class="view-section">
                        <div class="ml-task-header">
                            <span id="btn-toggle-class-config" style="cursor:pointer; padding-right: 12px; font-weight: bold; font-size: 16px; color: #4f46e5;">❮</span>
                            <strong>Classification Task:</strong> <span id="lbl-class-algo-header"> KNN </span> &nbsp;|&nbsp; <strong>Evaluation:</strong> <span id="lbl-class-eval-header">Full training set</span>
                        </div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 380px;">
                                <div class="ml-config-tabs">
                                    <div class="ml-config-tab active" data-panel="panel-class-algo">Algorithm</div>
                                    <div class="ml-config-tab" data-panel="panel-class-eval">Evaluation</div>
                                </div>
                                
                                <div class="ml-config-content active" id="panel-class-algo" style="text-align: left;">
                                    <h3>Classifier Configuration</h3>
                                    
                                    <div class="form-group">
                                        <label>Algorithm</label>
                                        <select id="classAlgorithm" class="form-control">
                                            <option value="knn" selected>KNN (K-Nearest Neighbors)</option>
                                            <option value="decision_tree">J48 (C4.5 Decision Tree)</option>
                                            <option value="naive_bayes">Naive Bayes</option>
                                        </select>
                                        <div id="class-algo-desc" class="algo-desc-box">KNN (K-Nearest Neighbors classifier).</div>
                                    </div>
                                    
                                    <h4 style="margin: 24px 0 12px 0; font-size: 14px; color:var(--text-dark);">Hyperparameters</h4>
                                    
                                    <div class="hyperparams-grid" id="classParamGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                        
                                        <div class="form-group" id="knnNeighborsContainer" style="margin:0;">
                                            <label>KNN (K)</label>
                                            <input type="number" id="knnNeighbors" class="form-control" value="1" min="1">
                                        </div>

                                        <div class="form-group" id="knnDistanceContainer" style="margin:0;">
                                            <label>Distance Metric</label>
                                            <select id="knnDistanceMetric" class="form-control">
                                                <option value="EUCLIDEAN" selected>Euclidean</option>
                                                <option value="MANHATTAN">Manhattan</option>
                                                <option value="CHEBYSHEV">Chebyshev</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="knnWeightingContainer" style="margin:0; grid-column: span 2;">
                                            <label>Distance Weighting</label>
                                            <select id="knnDistanceWeighting" class="form-control">
                                                <option value="NONE" selected>No distance weighting</option>
                                                <option value="INVERSE">Weight by 1/distance</option>
                                                <option value="SIMILARITY">Weight by 1-distance</option>
                                            </select>
                                        </div>

                                        <div class="form-group" id="treeConfidenceFactorContainer" style="display:none; margin:0;">
                                            <label>Confidence Factor</label>
                                            <input type="number" id="treeConfidenceFactor" class="form-control" value="0.25" min="0.001" max="0.5" step="0.01">
                                        </div>

                                        <div class="form-group" id="treeMinNumContainer" style="display:none; margin:0;">
                                            <label>Min Instances per Leaf</label>
                                            <input type="number" id="treeMinNum" class="form-control" value="2" min="1">
                                        </div>

                                        <div class="form-group" id="treeUnprunedContainer" style="display:none; margin:0; grid-column: span 2; display: flex; align-items: center; gap: 8px;">
                                            <input type="checkbox" id="treeUnpruned" style="width: 16px; height: 16px;">
                                            <label for="treeUnpruned" style="margin:0; cursor:pointer;">Unpruned Tree</label>
                                        </div>

                                        <div class="form-group" id="nbKernelEstimatorContainer" style="display:none; margin:0; grid-column: span 2; display: flex; align-items: center; gap: 8px;">
                                            <input type="checkbox" id="nbKernelEstimator" style="width: 16px; height: 16px;">
                                            <label for="nbKernelEstimator" style="margin:0; cursor:pointer;">Use Kernel Estimator</label>
                                        </div>

                                        <div class="form-group" id="nbSupervisedDiscretizationContainer" style="display:none; margin:0; grid-column: span 2; display: flex; align-items: center; gap: 8px;">
                                            <input type="checkbox" id="nbSupervisedDiscretization" style="width: 16px; height: 16px;">
                                            <label for="nbSupervisedDiscretization" style="margin:0; cursor:pointer;">Use Supervised Discretization</label>
                                        </div>

                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <label>Target Attribute (Class Label)</label>
                                        <select id="targetLabelSelect" class="form-control">
                                            <option value="">-- Hãy nạp dữ liệu trước --</option>
                                        </select>
                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <label>Predictor Features</label>
                                        <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; max-height: 120px; overflow-y: auto;" id="classFeaturesList">
                                            <span style="color:#94a3b8; font-size:12px;">Vui lòng Load Data trước...</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="ml-config-content" id="panel-class-eval" style="display: none; text-align: left;">
                                    <h3>Test Options</h3>
                                    <div class="form-group" style="margin-top: 16px;">
                                        <div style="background:#f8fafc; padding:16px; border-radius:8px; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:12px;">
                                            
                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="classTestopt" value="training" checked style="margin:0; cursor:pointer;">
                                                <span>Full training set</span>
                                            </label>

                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="classTestopt" value="split" style="margin:0; cursor:pointer;">
                                                <span>Percentage split:</span>
                                                <input type="number" id="classSplitPercent" class="form-control" value="80" min="1" max="99" style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px;">
                                                <span>% train,</span>
                                                <input type="number" id="classTestPercent" class="form-control" value="20" disabled style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px; background:#f1f5f9; color:#64748b; border-color:#cbd5e1;">
                                                <span>% test</span>
                                            </label>

                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="classTestopt" value="cv" style="margin:0; cursor:pointer;">
                                                <span>Cross-validation</span>
                                                <input type="number" id="classCvFolds" class="form-control" value="10" min="2" max="20" style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px;">
                                                <span>Folds</span>
                                            </label>

                                        </div>
                                    </div>
                                </div>

                                <button class="ml-btn" id="btnRunClassification"> Run Classification </button>
                            </div>
                            
                            <div class="ml-results-panel">
                                <div id="class-empty-results" class="empty-state"><div class="empty-icon">📊</div><h3>No Results Yet</h3></div>
                                <div id="classResultSection" style="display:none;">
                                    
                                    <div class="result-card" style="margin-bottom:20px;">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Performance Metrics</h3>
                                            <div style="display:flex; gap:8px;">
                                                <button id="btnExportClass" style="background:#16a34a; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;"> Excel</button>
                                            </div>
                                        </div>
                                        <table class="class-metrics-table">
                                            <thead>
                                                <tr>
                                                    <th>Accuracy</th>
                                                    <th>Precision</th>
                                                    <th>Recall</th>
                                                    <th>F-Measure</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td id="classAcc">0%</td>
                                                    <td id="classPre">0%</td>
                                                    <td id="classRec">0%</td>
                                                    <td id="classF1">0%</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    
                                    <div class="result-card">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Classifier Errors</h3>
                                        </div>
                                        <canvas id="classScatterChart" width="800" height="350" style="width:100%; border:1px solid #e2e8f0; border-radius:6px;"></canvas>
                                    </div>

                                    <div class="result-card" id="decisionTreeCard" style="display:none;">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Cấu trúc Cây quyết định (Decision Tree)</h3>
                                            <div style="display:flex; gap:8px; align-items:center;">
                                                <span style="font-size:12px; color:#64748b;">Thu phóng:</span>
                                                <button id="dtZoomOut" style="width:28px; height:28px; border:1px solid #e2e8f0; background:#fff; border-radius:6px; cursor:pointer;">－</button>
                                                <span id="dtZoomLabel" style="font-size:12px; color:#475569; min-width:40px; text-align:center;">100%</span>
                                                <button id="dtZoomIn" style="width:28px; height:28px; border:1px solid #e2e8f0; background:#fff; border-radius:6px; cursor:pointer;">＋</button>
                                                <button id="dtDownload" style="margin-left:8px; background:#4f46e5; color:#fff; border:none; padding:6px 14px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">⬇️ Tải PNG</button>
                                            </div>
                                        </div>
                                        <div style="font-size:12px; color:#64748b; padding:0 20px 10px;">
                                            <span style="display:inline-flex; align-items:center; gap:4px; margin-right:16px;"><span style="width:12px;height:12px;background:#eef2ff;border:1.5px solid #6366f1;border-radius:3px;display:inline-block;"></span> Node điều kiện chia</span>
                                            <span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:12px;height:12px;background:#ecfdf5;border:1.5px solid #10b981;border-radius:3px;display:inline-block;"></span> Node lá (kết quả phân lớp)</span>
                                        </div>
                                        <div id="decisionTreeScrollWrap" style="width:100%; overflow:auto; border:1px solid #e2e8f0; border-radius:6px; background:#fafafa; max-height:600px;">
                                            <canvas id="decisionTreeCanvas" style="display:block;"></canvas>
                                        </div>
                                    </div>

                                    <div class="result-card" style="padding:0;">
                                        <div style="padding:20px; border-bottom:1px solid var(--border);">
                                            <h3 style="color:var(--primary); font-size:16px;">Confusion Matrix</h3>
                                        </div>
                                        <div id="confusionMatrixWrap" style="overflow-x:auto; padding:20px; display:flex; justify-content:center;"></div>
                                    </div>

                                    <div class="result-card" style="padding:0;">
                                        <div style="padding:20px; border-bottom:1px solid var(--border); font-weight:700; color:var(--text-dark);">Actual vs Predicted Instances Table</div>
                                        <div id="classPredictionTableWrap" style="overflow-x:auto; padding:20px; max-height:400px; overflow-y:auto;"></div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="view-regression" class="view-section">
                        <div class="ml-task-header">
                            <strong>Regression Task:</strong> <span id="lbl-reg-algo-header">Linear Regression</span> &nbsp;|&nbsp; <strong>Evaluation:</strong> <span id="lbl-reg-eval-header">Full training set</span>
                        </div>
                        <div class="ml-layout">
                            <div class="ml-config-panel" style="width: 380px;">
                                <div class="ml-config-tabs">
                                    <div class="ml-config-tab active" data-panel="panel-reg-algo">Algorithm</div>
                                    <div class="ml-config-tab" data-panel="panel-reg-eval">Evaluation</div>
                                </div>
                                <div class="ml-config-content active" id="panel-reg-algo" style="text-align: left;">
                                    <h3>Regression Configuration</h3>
                                    <div class="form-group">
                                        <label>Algorithm</label>
                                        <select id="regAlgorithm" class="form-control">
                                            <option value="linear" selected>Linear Regression</option>
                                            <option value="logistic">Logistic Regression</option>
                                        </select>
                                        <div id="reg-algo-desc" class="algo-desc-box">Linear Regression predicts a continuous numeric value.</div>
                                    </div>

                                    <h4 style="margin: 24px 0 12px 0; font-size: 14px; color:var(--text-dark);">Hyperparameters</h4>

                                    <div id="lrRegParamsContainer" style="display:none;">
                                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:8px;">
                                            <div class="form-group" style="margin:0;">
                                                <label>Learning Rate</label>
                                                <input type="number" id="regLrRate" class="form-control" value="0.1" min="0.001" max="1" step="0.01">
                                            </div>
                                            <div class="form-group" style="margin:0;">
                                                <label>Epochs</label>
                                                <input type="number" id="regLrEpochs" class="form-control" value="500" min="10" max="10000" step="10">
                                            </div>
                                        </div>
                                    </div>
                                    <div class="form-group" style="margin-top:8px;">
                                        <label>Target Attribute</label>
                                        <select id="regTargetSelect" class="form-control"></select>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label style="font-weight: 600; color: #1e293b; margin-bottom: 6px; display: block;">Attribute Index</label>
                                        <input type="number" id="regAttrIndex" class="form-control" value="-1" style="border-radius: 8px;">
                                        <span class="hint" style="font-size: 12px; color: #64748b; margin-top: 6px; display: block;">
                                            Attribute index to use (-1 for auto-select best)
                                        </span>
                                    </div>
                                    <div class="form-group" style="margin-top:8px;">
                                        <label>Predictor Features (auto from index)</label>
                                        <div style="border:1px solid #e2e8f0; border-radius:6px; padding:10px; max-height:120px; overflow-y:auto; background:#f8fafc;" id="regFeaturesList">
                                            <span style="color:#94a3b8; font-size:12px;">Vui lòng Load Data trước...</span>
                                        </div>
                                        <div id="regAttrIndexSummary" style="font-size:11px; color:#64748b; margin-top:4px;"></div>
                                    </div>
                                </div>
                                
                                <div class="ml-config-content" id="panel-reg-eval" style="display: none; text-align: left;">
                                    <h3>Test Options</h3>
                                    <div class="form-group" style="margin-top: 16px;">
                                        <div style="background:#f8fafc; padding:16px; border-radius:8px; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:12px;">
                                            
                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="regTestopt" value="training" checked style="margin:0; cursor:pointer;">
                                                <span>Full training set</span>
                                            </label>

                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="regTestopt" value="split" style="margin:0; cursor:pointer;">
                                                <span>Percentage split:</span>
                                                <input type="number" id="regSplitPercent" class="form-control" value="80" min="1" max="99" style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px;">
                                                <span>% train,</span>
                                                <input type="number" id="regTestPercent" class="form-control" value="20" disabled style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px; background:#f1f5f9; color:#64748b; border-color:#cbd5e1;">
                                                <span>% test</span>
                                            </label>

                                            <label style="font-size:12px; display:flex; align-items:center; gap:4px; cursor:pointer; margin:0; color:#1e293b;">
                                                <input type="radio" name="regTestopt" value="cv" style="margin:0; cursor:pointer;">
                                                <span>Cross-validation</span>
                                                <input type="number" id="regCvFolds" class="form-control" value="10" min="2" max="20" style="width:38px; padding:2px; height:26px !important; text-align:center; font-size:12px;">
                                                <span>Folds</span>
                                            </label>

                                        </div>
                                    </div>
                                </div>
                                <button class="ml-btn" id="btnRunRegression">Run Regression</button>
                            </div>
                            <div class="ml-results-panel">
                                <div id="reg-empty-results" class="empty-state"><div class="empty-icon">📈</div><h3>No Results Yet</h3></div>
                                <div id="regResultSection" style="display:none;">
                                    <div class="result-card" style="margin-bottom:20px;">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Performance Metrics</h3>
                                        </div>
                                        <div id="regMetrics"></div>
                                    </div>
                                    <div class="result-card">
                                        <div class="result-header">
                                            <h3 style="color:var(--primary);">Actual vs Predicted Plot</h3>
                                        </div>
                                        <canvas id="regScatterChart" width="800" height="350" style="width:100%; border:1px solid #e2e8f0; border-radius:6px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </main>
        </div>
HTML;
    }

    protected function getGroupName() { return 'wiki'; }
}