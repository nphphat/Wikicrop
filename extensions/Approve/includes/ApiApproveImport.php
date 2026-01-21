<?php
// includes/ApiApproveImport.php
namespace MediaWiki\Extension\Approve;

use MediaWiki\MediaWikiServices;
use MediaWiki\Api\ApiBase;

class ApiApproveImport extends ApiBase {

    public function execute() {
        // 1. Kiểm tra quyền Admin
        if ( !$this->getUser()->isAllowed( 'approverevisions' ) ) {
            $this->dieWithError( [ 'apierror-permissiondenied' ] );
        }

        $dbw = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_PRIMARY );

        $tblApprove = $dbw->tableName( 'approve_queue' );
        $tblPage = $dbw->tableName( 'page' );
        $tblRevision = $dbw->tableName( 'revision' );
        $tblActor = $dbw->tableName( 'actor' );
        
        $statusPending = $dbw->addQuotes( 'pending' );

        $revDate = "STR_TO_DATE(r.rev_timestamp, '%Y%m%d%H%i%s')";

        $sql = <<<SQL
            INSERT INTO $tblApprove 
            (aq_page_id, aq_revision_id, aq_page_title, 
             aq_status, aq_is_latest, aq_creator, aq_created_at)

            SELECT 
                p.page_id,
                p.page_latest,
                p.page_title,
                $statusPending,
                1,
                a.actor_name,
                $revDate

            FROM $tblPage AS p
            INNER JOIN $tblRevision AS r ON p.page_latest = r.rev_id
            INNER JOIN $tblActor AS a ON r.rev_actor = a.actor_id

            WHERE p.page_namespace = 0
              AND NOT EXISTS (
                SELECT 1 FROM $tblApprove AS q WHERE q.aq_page_id = p.page_id
            );

SQL;

        try {
            $dbw->query( $sql, __METHOD__ );
            $affectedRows = $dbw->affectedRows();

            $this->getResult()->addValue( null, $this->getModuleName(), [ 
                'success' => true, 
                'imported_count' => $affectedRows 
            ]);

        } catch ( Exception $e ) {
            $this->dieWithError( 'Lỗi SQL: ' . $e->getMessage(), 'sqlerror' );
        }
    }

    public function needsToken() { return 'csrf'; }
    public function mustBePosted() { return true; }
    public function getAllowedParams() { return []; }
}