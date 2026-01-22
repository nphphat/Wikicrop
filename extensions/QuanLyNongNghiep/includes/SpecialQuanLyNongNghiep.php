<?php

class SpecialQuanLyNongNghiep extends SpecialPage {
    public function __construct() {
        parent::__construct( 'QuanLyNongNghiep', 'editer' );
    }

    public function execute( $par ) {
        $this->checkPermissions(); 
        $request = $this->getRequest();
        $output = $this->getOutput();
        $this->setHeaders();
        $output->addModules( 'ext.quanlynongnghiep' );  

        $action = $request->getVal( 'action' );
        if ( $request->wasPosted() ) {
            if ( !$this->getUser()->isAllowed( 'editer' ) ) {  
                $output->addHTML( '<p>Bạn không có quyền chỉnh sửa.</p>' );
                return;
            }

            if ( !$this->getUser()->matchEditToken( $request->getVal( 'wpEditToken' ) ) ) {
                $output->addHTML( '<div class="errorbox">Lỗi xác thực phiên làm việc (Token mismatch). Hãy tải lại trang.</div>' );
                return;
            }

            $dbw = \MediaWiki\MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_PRIMARY );

            $redirectParams = [];

            if ( $action === 'add' || $action === 'edit' ) {
                $name = $request->getVal( 'name' );
                $url = $request->getVal( 'url' );
                $summary = $request->getVal( 'summary' );
                $category = $request->getVal( 'category');
                $id = $request->getInt( 'id', 0 );

                if ( empty( $name ) || empty( $url ) ) {
                    $output->addHTML( '<p>Dữ liệu không hợp lệ.</p>' );
                    return;
                }

                $data = [
                    'nn_name' => $name,
                    'nn_url' => $url,
                    'nn_summary' => $summary,
                    'nn_category' => $category,
                    'nn_added_by' => $this->getUser()->getId(),
                    'nn_timestamp' => $dbw->timestamp()
                ];

                if ( $action === 'add' ) {
                    $dbw->insert( 'nongnghiep40_resources', $data );
                    $redirectParams['msg'] = 'added';
                } elseif ( $action === 'edit' && $id > 0 ) {
                    unset($data['nn_added_by']);
                    $dbw->update( 'nongnghiep40_resources', $data, [ 'nn_id' => $id ] );
                    $redirectParams['msg'] = 'updated';
                }
            } elseif ( $action === 'delete' ) {
                $id = $request->getInt( 'id' );
                if ( $id > 0 ) {
                    $dbw->delete( 'nongnghiep40_resources', [ 'nn_id' => $id ] );
                    $redirectParams['msg'] = 'deleted';
                }
            }

            // Redirect to avoid form resubmission (PRG Pattern)
            if ( !empty( $redirectParams ) ) {
                $output->redirect( $this->getPageTitle()->getLocalURL( $redirectParams ) );
                return;
            }
        }

        // Display messages based on URL parameter
        $msg = $request->getVal( 'msg' );
        if ( $msg === 'added' ) {
             $output->addHTML( '<div class="successbox">Đã thêm mới thành công!</div>' );
        } elseif ( $msg === 'updated' ) {
             $output->addHTML( '<div class="successbox">Cập nhật thành công!</div>' );
        } elseif ( $msg === 'deleted' ) {
             $output->addHTML( '<div class="successbox">Đã xóa dữ liệu.</div>' );
        }

        $existingCategories = $this->getExistingCategories();
        // Pass categories to JS via config
        $output->addJsConfigVars( 'nnCategories', $existingCategories );
        
        $output->addHTML( $this->getAddForm() );

        $this->displayList( $output );
    }

    private function getExistingCategories() {
        $dbr = \MediaWiki\MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );
        $res = $dbr->select(
            'nongnghiep40_resources',
            'DISTINCT nn_category',
            [],
            __METHOD__,
            [ 'ORDER BY' => 'nn_category ASC']
        );

        $categories = [];
        foreach ( $res as $row ) {
            if ( !empty($row->nn_category)) {
                $categories[] = $row->nn_category;
            }
        }
        return $categories;
    }

    private function getAddForm() {
        // Lấy token bảo mật
        $token = $this->getUser()->getEditToken();

        $html = '<form method="post" id="nongnghiep-entry-form">
            <input type="hidden" name="action" value="add" id="nn-form-action">
            <input type="hidden" name="id" value="" id="nn-form-id">
            <input type="hidden" name="wpEditToken" value="' . htmlspecialchars( $token ) . '"> <div class="nongnghiep-form-group">
                <label>' . $this->msg('nongnghiep40-name')->text() . ':</label>
                <input type="text" name="name" id="nn-form-name" required class="nongnghiep-input">
            </div>

            <div class="nongnghiep-form-group">
                <label>' . $this->msg('nongnghiep40-url')->text() . ':</label>
                <input type="url" name="url" id="nn-form-url" required class="nongnghiep-input">
            </div>

            <div class="nongnghiep-form-group">
                <label>' . $this->msg('nongnghiep40-summary')->text() . ':</label>
                <textarea name="summary" id="nn-form-summary" rows="3" class="nongnghiep-input"></textarea>
            </div>

            <div class="nongnghiep-form-group" style="position: relative;">
                <label>' . $this->msg('nongnghiep40-category')->text() . ':</label>
                <input type="text" name="category" id="nn-form-category" class="nongnghiep-input" placeholder="Chọn hoặc nhập mới..." autocomplete="off">
                <div id="nn-category-suggestions" class="nongnghiep-suggestions"></div>
            </div>

            <div class="nongnghiep-form-group">
                <button type="submit" id="nn-btn-submit" class="nongnghiep-btn primary">' . $this->msg('nongnghiep40-save')->text() . '</button>
                <button type="button" id="nn-btn-cancel" class="nongnghiep-btn secondary" style="display:none;">Hủy</button>
            </div>
        </form>';
        return $html;
    }

    private function displayList( $output ) {
        $request = $this->getRequest();
        $page = $request->getInt( 'page', 1 );
        $limit = 10;
        $offset = ( $page - 1 ) * $limit;

        $dbr = \MediaWiki\MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );
        
        $total = $dbr->selectField( 'nongnghiep40_resources', 'COUNT(*)', '', __METHOD__ );
        $totalPages = ceil( $total / $limit );

        if ( $page < 1 ) $page = 1;
        if ( $page > $totalPages && $totalPages > 0 ) $page = $totalPages;
        
        $res = $dbr->select( 
            'nongnghiep40_resources', 
            '*', 
            '', 
            __METHOD__, 
            [ 
                'ORDER BY' => 'nn_timestamp DESC', 
                'LIMIT' => $limit, 
                'OFFSET' => $offset 
            ] 
        );

        // Lấy token cho nút xóa
        $token = $this->getUser()->getEditToken();

        $html = '<table class="nongnghiep-table">
            <thead>
                <tr>
                    <th>' . $this->msg('nongnghiep40-name')->text() . '</th>
                    <th>' . $this->msg('nongnghiep40-url')->text() . '</th>
                    <th>' . $this->msg('nongnghiep40-summary')->text() . '</th>
                    <th>' . $this->msg('nongnghiep40-category')->text() . '</th>
                    <th style="width: 150px;">Hành động</th>
                </tr>
            </thead>
            <tbody>';
        
        foreach ( $res as $row ) {
            // Form xóa cũng cần Token
            $deleteForm = '<form method="post" class="delete-form" style="display:inline;">
                <input type="hidden" name="action" value="delete">
                <input type="hidden" name="id" value="' . $row->nn_id . '">
                <input type="hidden" name="wpEditToken" value="' . htmlspecialchars( $token ) . '">
                <button type="submit" class="nongnghiep-btn danger">' . $this->msg('nongnghiep40-delete')->text() . '</button>
            </form>';

            $editBtn = '<button type="button" class="nongnghiep-btn edit-btn" 
                data-id="' . $row->nn_id . '"
                data-name="' . htmlspecialchars( $row->nn_name ) . '"
                data-url="' . htmlspecialchars( $row->nn_url ) . '"
                data-summary="' . htmlspecialchars( $row->nn_summary ) . '"
                data-category="' . htmlspecialchars( $row->nn_category ) . '"
                >' . $this->msg('nongnghiep40-edit')->text() . '</button>';

            $html .= '<tr>
                        <td>' . htmlspecialchars( $row->nn_name ) . '</td>
                        <td><a href="' . htmlspecialchars( $row->nn_url ) . '" target="_blank">' . htmlspecialchars( $row->nn_url ) . '</a></td>
                        <td>' . nl2br( htmlspecialchars( $row->nn_summary ) ) . '</td>
                        <td>' . htmlspecialchars( $row->nn_category ) . '</td>
                        <td>' . $editBtn . ' ' . $deleteForm . '</td>
                      </tr>';
        }
        $html .= '</tbody></table>';

        // Pagination controls
        if ( $totalPages > 1 ) {
            $html .= '<div class="nongnghiep-pagination" style="margin-top: 20px; text-align: center;">';
            
            // Previous Button
            if ( $page > 1 ) {
                $prevUrl = $this->getPageTitle()->getLocalURL( [ 'page' => $page - 1 ] );
                $html .= '<a href="' . htmlspecialchars( $prevUrl ) . '" class="nongnghiep-btn secondary" style="margin-right: 5px;">&laquo;</a>';
            }

            // Page Numbers
            for ( $i = 1; $i <= $totalPages; $i++ ) {
                $activeStyle = ( $i == $page ) ? 'background-color: #36c; color: white; border-color: #36c;' : '';
                $pageUrl = $this->getPageTitle()->getLocalURL( [ 'page' => $i ] );
                $html .= '<a href="' . htmlspecialchars( $pageUrl ) . '" class="nongnghiep-btn secondary" style="margin-right: 5px; ' . $activeStyle . '">' . $i . '</a>';
            }

            // Next Button
            if ( $page < $totalPages ) {
                $nextUrl = $this->getPageTitle()->getLocalURL( [ 'page' => $page + 1 ] );
                $html .= '<a href="' . htmlspecialchars( $nextUrl ) . '" class="nongnghiep-btn secondary">&raquo;</a>';
            }

            $html .= '</div>';
        }

        $output->addHTML( $html );
    }

    protected function getGroupName() {
        return 'other';  
    }
}