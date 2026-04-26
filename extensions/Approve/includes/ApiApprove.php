<?php
namespace MediaWiki\Extension\Approve;

use MediaWiki\MediaWikiServices;
use MediaWiki\Api\ApiBase;
use MediaWiki\Extension\Approve\ApproveHooks;

class ApiApprove extends ApiBase {

    public function execute() {
        $user = $this->getUser();
        if ( !$user->isAllowed( 'approverevisions' ) ) {
            $this->dieWithError( 'apierror-permissiondenied', 'permissiondenied' );
        }

        $params = $this->extractRequestParams();
        $mode = $params['mode'];
        $limit = $params['limit']; 
        $id = $params['id'];

        $dbw = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_PRIMARY );

        $count = 0;

        if ( $mode === 'approveall' ) {
            
            if ( function_exists( 'set_time_limit' ) ) {
                set_time_limit( 0 );
            }
            ignore_user_abort( true );

            $options = [];
            if ( $limit > 0 ) {
                $options['LIMIT'] = $limit;
            }

            $res = $dbw->select(
                'approve_queue',
                [ 'aq_id', 'aq_revision_id', 'aq_page_title' ],
                [ 'aq_status' => 'pending' ],
                __METHOD__,
                $options 
            );

            foreach ( $res as $row ) {
                $dbw->update(
                    'approve_queue',
                    [
                        'aq_status' => 'approved',
                        'aq_approver' => $user->getName(),
                        'aq_approved_at' => $dbw->timestamp( wfTimestampNow() )
                    ],
                    [ 'aq_id' => $row->aq_id ],
                    __METHOD__
                );

                // Gửi sang chatbot
                ApproveHooks::sendToChatbot( $row->aq_revision_id, $row->aq_page_title );
                $count++;
            }

            $result = [ 'count' => $count, 'status' => 'success' ];
            $this->getResult()->addValue( null, $this->getModuleName(), $result );

        } elseif ( $mode === 'approve' ) {
            if ( !$id ) $this->dieWithError( 'apierror-missingparam', 'missingparam' );

            // Lấy thông tin bài viết
            $row = $dbw->selectRow(
                'approve_queue',
                [ 'aq_revision_id', 'aq_page_title' ],
                [ 'aq_id' => $id, 'aq_status' => 'pending' ],
                __METHOD__
            );

            if ( !$row ) {
                $this->dieWithError( 'apierror-not-found-or-processed', 'notfound' );
            }

            $dbw->update(
                'approve_queue',
                [
                    'aq_status' => 'approved',
                    'aq_approver' => $user->getName(),
                    'aq_approved_at' => $dbw->timestamp( wfTimestampNow() )
                ],
                [ 'aq_id' => $id ],
                __METHOD__
            );

            ApproveHooks::sendToChatbot( $row->aq_revision_id, $row->aq_page_title );
            
            $this->getResult()->addValue( null, $this->getModuleName(), [ 'count' => 1, 'status' => 'approved' ] );

        } elseif ( $mode === 'reject' ) {
            if ( !$id ) $this->dieWithError( 'apierror-missingparam', 'missingparam' );

            $dbw->update(
                'approve_queue',
                [
                    'aq_status' => 'rejected',
                    'aq_approver' => $user->getName(),
                    'aq_approved_at' => $dbw->timestamp( wfTimestampNow() )
                ],
                [ 'aq_id' => $id ],
                __METHOD__
            );

            $this->getResult()->addValue( null, $this->getModuleName(), [ 'count' => 1, 'status' => 'rejected' ] );
        } else {
            $this->dieWithError( 'apierror-unknown-mode', 'unknownmode' );
        }
    }

    public function getAllowedParams() {
        return [
            'mode' => [
                ApiBase::PARAM_TYPE => [ 'approve', 'reject', 'approveall' ],
                ApiBase::PARAM_REQUIRED => true,
            ],
            'id' => [
                ApiBase::PARAM_TYPE => 'integer',
                ApiBase::PARAM_DFLT => 0,
            ],
            'limit' => [
                ApiBase::PARAM_TYPE => 'integer',
                ApiBase::PARAM_DFLT => 0, // 0 = All
                ApiBase::PARAM_MAX => 500,
            ],
        ];
    }

    public function needsToken() {
        return 'csrf';
    }
}
