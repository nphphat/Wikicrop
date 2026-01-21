<?php
namespace MediaWiki\Extension\Approve;

use MediaWiki\MediaWikiServices;
use MediaWiki\Api\ApiBase;

class ApiApproveList extends ApiBase {

    public function execute() {
        $params = $this->extractRequestParams();
        $limit = $params['limit'];
        $offset = $params['offset'];
        
        // 1. Nhận tham số Sort và Search
        $sort = strtoupper($params['sort']); // 'ASC' hoặc 'DESC'
        $search = $params['search'];

        $dbr = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );

        // Các bảng cần query (Mặc định chỉ có approve_queue)
        $tables = [ 'approve_queue' ];
        $join_conds = [];
        $conds = [ 'aq_status' => 'pending' ];
        $options = [
            'LIMIT' => $limit, 
            'OFFSET' => $offset, 
            'ORDER BY' => "aq_id $sort" // <-- Sắp xếp động theo tham số
        ];

        // 2. Xử lý logic Search (Nếu có từ khóa)
        if ( !empty( $search ) ) {
            // Để tìm theo tên bài, phải JOIN với bảng 'page'
            $tables[] = 'page';
            $join_conds['page'] = [ 'INNER JOIN', 'aq_page_id = page_id' ];

            // Chuẩn hóa từ khóa (MediaWiki lưu title bằng dấu gạch dưới thay vì khoảng trắng)
            $searchTitle = str_replace( ' ', '_', $search );
            
            // Tạo điều kiện LIKE %keyword% an toàn
            $like = $dbr->buildLike( $dbr->anyString(), $searchTitle, $dbr->anyString() );
            
            // Tìm kiếm trong cột page_title
            $conds[] = "page_title $like";
        }

        // 3. Đếm tổng số (Cần truyền cả tables và join_conds để đếm đúng khi search)
        $total = $dbr->selectField(
            $tables,
            'COUNT(*)',
            $conds,
            __METHOD__,
            [],
            $join_conds
        );

        // 4. Lấy danh sách ID (Kết hợp tables, conds, options và join_conds)
        $res = $dbr->select(
            $tables,
            [ 'approve_queue.*' ], // Lấy tất cả cột của bảng queue
            $conds,
            __METHOD__,
            $options,
            $join_conds
        );

        $pages = [];
        $revisionStore = MediaWikiServices::getInstance()->getRevisionStore();
        $titleFactory = MediaWikiServices::getInstance()->getTitleFactory();
        $lang = MediaWikiServices::getInstance()->getContentLanguage();

        foreach ( $res as $row ) {
            $rev = $revisionStore->getRevisionById( $row->aq_revision_id );
            
            if ( !$rev ) {
                continue; 
            }

            $title = $titleFactory->newFromID( $row->aq_page_id );
            if ( !$title ) {
                continue;
            }

            $user = $rev->getUser(); 
            $username = $user ? $user->getName() : 'Khách';

            $timestamp = $rev->getTimestamp();
            $timeStr = $lang->userTimeAndDate( $timestamp, $this->getUser() );

            $pages[] = [
                'id' => (int)$row->aq_id,
                'page_id' => (int)$row->aq_page_id,
                'revision' => (int)$row->aq_revision_id,
                'title' => $title->getPrefixedText(),
                'creator' => $username,
                'created' => $timeStr
            ];
        }

        $this->getResult()->addValue( null, $this->getModuleName(), [
            'total' => (int)$total,
            'pages' => $pages
        ]);
    }

    public function getAllowedParams() {
        return [
            'limit' => [
                ApiBase::PARAM_TYPE => 'integer',
                ApiBase::PARAM_DFLT => 20,
                ApiBase::PARAM_MIN => 1,
                ApiBase::PARAM_MAX => 500,
            ],
            'offset' => [
                ApiBase::PARAM_TYPE => 'integer',
                ApiBase::PARAM_DFLT => 0,
            ],
            // Thêm tham số Search
            'search' => [
                ApiBase::PARAM_TYPE => 'string',
                ApiBase::PARAM_DFLT => '',
            ],
            // Thêm tham số Sort
            'sort' => [
                ApiBase::PARAM_TYPE => ['asc', 'desc'],
                ApiBase::PARAM_DFLT => 'desc',
            ],
        ];
    }

    public function needsToken() {
        return false;
    }
}