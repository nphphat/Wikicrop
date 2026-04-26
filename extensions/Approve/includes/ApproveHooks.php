<?php
namespace MediaWiki\Extension\Approve;

use MediaWiki\MediaWikiServices;
use MediaWiki\Html\Html;
use MediaWiki\Revision\RevisionRecord;
use MediaWiki\Revision\SlotRecord;
use MediaWiki\User\User;

class ApproveHooks {

    /**
     * Tạo bảng khi cài extension
     */
    public static function onSchemaUpdate( $updater ) {
        $dir = __DIR__ . '/../sql';
        $updater->addExtensionTable(
            'approve_queue',
            "$dir/create_approve_queue.sql" 
        );
        return true;
    }

    /**
     * Hook khi lưu bài (RevisionRecordInserted)
     */
    public static function onRevisionRecordInserted( RevisionRecord $revisionRecord ) {

        $pageId = $revisionRecord->getPageId();
        $revId  = $revisionRecord->getId();

        $user = $revisionRecord->getUser();
        
        $creatorName = $user ? $user->getName() : 'Unknown';
        
        $userFactory = MediaWikiServices::getInstance()->getUserFactory();
        $userObj = $userFactory->newFromUserIdentity( $user );

        $dbw = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_PRIMARY );

        if ( $userObj && $userObj->isAllowed('approverevisions') ) {
            // Admin sửa bài -> Tự động Approved
            $status = 'approved';
            $approver = $userObj->getName();
            $approvedAt = $dbw->timestamp( wfTimestampNow() );
        } else {
            // User thường -> Pending
            $status = 'pending';
            $approver = null;
            $approvedAt = null;
        }

        $titleObj = $revisionRecord->getPageAsLinkTarget();
        $titleText = $titleObj->getText(); 

        $dbw->update(
            'approve_queue',
            [ 'aq_is_latest' => 0 ],
            [ 'aq_page_id' => $pageId ],
            __METHOD__
        );

        // Thêm bản ghi mới vào hàng đợi
        $dbw->insert(
            'approve_queue',
            [
                'aq_page_id'     => $pageId,
                'aq_revision_id' => $revId,
                'aq_page_title'  => $titleText,
                'aq_creator'     => $creatorName,
                'aq_status'      => $status,
                'aq_approver'    => $approver,
                'aq_approved_at' => $approvedAt,
                'aq_is_latest'   => 1,
                'aq_created_at'  => $dbw->timestamp( wfTimestampNow() )
            ],
            __METHOD__
        );

        // Nếu đã Approved -> Gửi luôn sang Chatbot
        if ( $status === 'approved' ) {
            self::sendToChatbot( $revId, $titleText );
        }

        return true;
    }

    /**
     * Hiển thị thông báo "Đã duyệt" trên đầu bài viết
     */
    public static function onBeforePageDisplay( $out, $skin ) {
        $user = $out->getUser();

        if ( $user && $user->isAllowed('approverevisions') ) {
            $out->addModules('ext.approve');
        }
        $title = $out->getTitle();
        $pageId = $title->getArticleID();
        
        if ( !$pageId ) return true; 

        $dbr = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );

        $row = $dbr->selectRow(
            'approve_queue',
            ['aq_status', 'aq_approver', 'aq_approved_at'],
            [
                'aq_page_id' => $pageId,
                'aq_is_latest' => 1
            ],
            __METHOD__
        );

        if ( $row ) {
            if ( $row->aq_status === 'approved' ) {
                $approver = htmlspecialchars($row->aq_approver);
                $time = $row->aq_approved_at;
                
                $html = "<div style='padding:10px; background:#e6ffea; border:1px solid #2ecc71; margin-bottom:15px; color:#155724; border-radius: 4px;'>
                            ✔ Phiên bản hiện tại đã được duyệt bởi <b>{$approver}</b>.
                         </div>";
                $out->prependHTML( $html );
            } elseif ( $row->aq_status === 'pending' ) {
                $html = "<div style='padding:10px; background:#fff3cd; border:1px solid #ffeeba; margin-bottom:15px; color:#856404; border-radius: 4px;'>
                            ⏳ Phiên bản này đang chờ ban quản trị duyệt.
                         </div>";
                $out->prependHTML( $html );
            } elseif ( $row->aq_status === 'rejected' ) {
                 $html = "<div style='padding:10px; background:#f8d7da; border:1px solid #f5c6cb; margin-bottom:15px; color:#721c24; border-radius: 4px;'>
                            ✖ Phiên bản này đã bị từ chối duyệt.
                          </div>";
                 $out->prependHTML( $html );
            }
        }

        return true;
    }

    /**
     * Helper gửi bài viết sang Chatbot
     */
    public static function sendToChatbot( $revId, $title ) {
        try {
            $revisionStore = MediaWikiServices::getInstance()->getRevisionStore();
            $rev = $revisionStore->getRevisionById( $revId );

            if ( $rev ) {
                $content = $rev->getContent( SlotRecord::MAIN );
                $text = '';
                if ( $content ) {
                     if ( $content instanceof \TextContent ) {
                         $text = $content->getText();
                     } else {
                         $model = $content->getModel();
                         try {
                             $handler = MediaWikiServices::getInstance()->getContentHandlerFactory()->getContentHandler( $model );
                             $text = $handler->serializeContent( $content );
                         } catch ( \Exception $ex ) {
                             $text = ''; 
                         }
                     }
                }

                if ( $text ) {
                    $cleanTitle = mb_convert_encoding($title, 'UTF-8', 'UTF-8');
                    $cleanText = mb_convert_encoding($text, 'UTF-8', 'UTF-8');

                    $data = [
                        'title' => $cleanTitle,
                        'content' => $cleanText,
                        'url' => "wiki://" . str_replace(' ', '_', $cleanTitle)
                    ];

                    $payload = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_IGNORE);
                    if ($payload === false) return;

                    $config = MediaWikiServices::getInstance()->getMainConfig();
                    $ingestUrl = $config->get('ApproveChatbotIngestUrl');

                    $httpRequest = MediaWikiServices::getInstance()->getHttpRequestFactory()->create(
                        $ingestUrl,
                        [
                            'method' => 'POST',
                            'postData' => $payload,
                            'headers' => [ 'Content-Type' => 'application/json' ]
                        ],
                        __METHOD__
                    );

                    $httpRequest->execute();
                }
            }
        } catch ( \Exception $e ) {
        }
    }
}