<?php

namespace MediaWiki\Extension\ApiPlantDB;

use SpecialPage;
use MediaWiki\MediaWikiServices;
use MediaWiki\Extension\ApiPlantDB\PlantDBData;

class SpecialPlantDB extends SpecialPage {

    public function __construct() {
        parent::__construct( 'PlantDB', 'editer' ); // Yêu cầu quyền edit để truy cập
    }

    public function execute( $par ) {
        $this->checkPermissions();
        $output = $this->getOutput();
        $this->setHeaders();
        $output->addModules( [ 'mediawiki.special', 'ext.apiplantdb' ] );

        $request = $this->getRequest();

        if ( $request->wasPosted() && $this->getUser()->matchEditToken( $request->getVal( 'wpEditToken' ) ) ) {
            $this->handleSubmission();
        }

        $this->displayForm();
        $this->displayList();
    }

    private function handleSubmission() {
        $request = $this->getRequest();
        $output = $this->getOutput();
        $action = $request->getVal( 'action' );

        $dbw = \MediaWiki\MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_PRIMARY );

        if ( $action === 'add' ) {
            $wikiUrl = $request->getVal( 'wiki_url' );
            $plantDbUrl = $request->getVal( 'plantdb_url' );

            // 1. Lấy Wiki Page ID từ URL hoặc Title text
            $title = \Title::newFromText( $wikiUrl );
            if ( !$title || !$title->exists() ) {
                $output->addHTML( '<div class="apiplantdb-alert apiplantdb-alert-error">' . $this->msg( 'plantdb-error-wiki-not-found', htmlspecialchars( $wikiUrl ) )->text() . '</div>' );
                return;
            }
            $articleId = $title->getArticleID();

            // 2. Lấy PlantDB ID từ URL
            $plantDbId = '';
            if ( preg_match( '/\/plant\/(\d+)/', $plantDbUrl, $matches ) ) {
                $plantDbId = $matches[1];
            } elseif ( preg_match( '/\/species\/(\d+)/', $plantDbUrl, $matches ) ) {
                $plantDbId = $matches[1];
            } elseif ( preg_match( '/id=(\d+)/', $plantDbUrl, $matches ) ) {
                $plantDbId = $matches[1];
            } else {
                if ( is_numeric( $plantDbUrl ) ) {
                    $plantDbId = $plantDbUrl;
                }
            }

            if ( empty( $plantDbId ) ) {
                $output->addHTML( '<div class="apiplantdb-alert apiplantdb-alert-error">' . $this->msg( 'plantdb-error-plantdb-id' )->text() . '</div>' );
                return;
            }

            // 3. Lưu vào DB
            try {
                $dbw->replace(
                    'plantdb_map',
                    [ ['pm_page_id'] ],
                    [
                        'pm_page_id' => $articleId,
                        'pm_plantdb_id' => $plantDbId
                    ],
                    __METHOD__
                );

                $output->addHTML( '<div class="apiplantdb-alert apiplantdb-alert-success">' . $this->msg( 'plantdb-success-saved' )->text() . '</div>' );
            } catch ( \Exception $e ) {
                $output->addHTML( '<div class="apiplantdb-alert apiplantdb-alert-error">' . $this->msg( 'plantdb-error-db', $e->getMessage() )->text() . '</div>' );
            }

        } elseif ( $action === 'delete' ) {
            $pageId = $request->getInt( 'id' );
            if ( $pageId ) {
                $dbw->delete( 'plantdb_map', [ 'pm_page_id' => $pageId ], __METHOD__ );
                $output->addHTML( '<div class="apiplantdb-alert apiplantdb-alert-success">' . $this->msg( 'plantdb-success-deleted' )->text() . '</div>' );
            }
        }
    }

    private function displayForm() {
        $output = $this->getOutput();
        $token = $this->getUser()->getEditToken();

        $html = '
        <form method="post" action="" id="apiplantdb-entry-form" class="apiplantdb-form-wrapper">
            <input type="hidden" name="wpEditToken" value="' . htmlspecialchars( $token ) . '">
            <input type="hidden" name="action" value="add">
            
            <div class="apiplantdb-input-group">
                <label>' . $this->msg( 'plantdb-wiki-label' )->text() . ':</label>
                <input type="text" name="wiki_url" required class="mw-ui-input">
            </div>
            
            <div class="apiplantdb-input-group">
                <label>' . $this->msg( 'plantdb-plantdb-label' )->text() . ':</label>
                <input type="text" name="plantdb_url" required class="mw-ui-input">
            </div>

            <div class="apiplantdb-input-group">
                <button type="submit" class="apiplantdb-btn apiplantdb-btn-primary">' . $this->msg( 'plantdb-submit' )->text() . '</button>
            </div>
        </form>';
        
        $output->addHTML( $html );
    }

    private function displayList() {
        $output = $this->getOutput();
        $dbr = \MediaWiki\MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );

        $res = $dbr->select(
            'plantdb_map',
            [ 'pm_page_id', 'pm_plantdb_id' ],
            [],
            __METHOD__
        );

        $html = '<table class="apiplantdb-table">
            <thead>
                <tr>
                    <th>' . $this->msg( 'plantdb-list-wiki-id' )->text() . '</th>
                    <th>' . $this->msg( 'plantdb-list-wiki-name' )->text() . '</th>
                    <th>' . $this->msg( 'plantdb-list-plantdb-id' )->text() . '</th>
                    <th>' . $this->msg( 'plantdb-list-action' )->text() . '</th>
                </tr>
            </thead>
            <tbody>';

        foreach ( $res as $row ) {
            $title = \Title::newFromID( $row->pm_page_id );
            $pageName = $title ? $title->getFullText() : '';
            $displayPageName = $pageName ?: '<em>(' . $this->msg('plantdb-error-wiki-not-found', $row->pm_page_id)->text() . ')</em>';
            $pageLink = $title ? '<a href="' . $title->getFullURL() . '" target="_blank">' . htmlspecialchars( $pageName ) . '</a>' : $displayPageName;
            
             $deleteForm = '
                <form method="post" style="display:inline;" onsubmit="return confirm(\'' . $this->msg( 'plantdb-delete-confirm' )->text() . '\');">
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="id" value="' . $row->pm_page_id . '">
                     <input type="hidden" name="wpEditToken" value="' . $this->getUser()->getEditToken() . '">
                    <button type="submit" class="apiplantdb-btn apiplantdb-btn-danger">' . $this->msg( 'plantdb-delete' )->text() . '</button>
                </form>
            ';

            $editBtn = '
                <button type="button" class="apiplantdb-btn apiplantdb-btn-edit plantdb-btn-edit" 
                    data-wiki-name="' . htmlspecialchars( $pageName ) . '" 
                    data-plantdb-id="' . htmlspecialchars( $row->pm_plantdb_id ) . '">
                    ' . $this->msg( 'plantdb-edit' )->text() . '
                </button>
            ';

            $html .= '<tr>
                <td>' . $row->pm_page_id . '</td>
                <td>' . $pageLink . '</td>
                <td>' . htmlspecialchars( $row->pm_plantdb_id ) . '</td>
                <td>
                    ' . $editBtn . '
                    ' . $deleteForm . '
                </td>
            </tr>';
        }

        $html .= '</tbody></table>';

        if ( $res->numRows() == 0 ) {
            $html .= '<p>' . $this->msg( 'plantdb-no-data' )->text() . '</p>';
        }

        $output->addHTML( $html );
    }
}