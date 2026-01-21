<?php
namespace MediaWiki\Extension\Approve;

// Thêm dòng này để import class SpecialPage gốc
use SpecialPage; 

class SpecialApprove extends SpecialPage {
    public function __construct() {
        // Đăng ký tên trang là "Approve" và yêu cầu quyền "approverevisions"
        parent::__construct( 'Approve', 'approverevisions' );
    }

    public function execute( $par ) {
        $this->setHeaders();
        $this->checkPermissions(); // Kiểm tra quyền

        $out = $this->getOutput();
        $out->setPageTitle( 'Quản lý duyệt bài cho ChatBot' );
        
        // Nạp module JS/CSS
        $out->addModules( 'ext.approve' );

        // Tạo khung HTML
        $out->addHTML( '<div id="approve-dashboard">Đang tải danh sách bài chờ duyệt...</div>' );
    }
}