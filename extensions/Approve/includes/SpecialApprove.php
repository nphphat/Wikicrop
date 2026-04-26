<?php
namespace MediaWiki\Extension\Approve;

use SpecialPage; 

class SpecialApprove extends SpecialPage {
    public function __construct() {
        parent::__construct( 'Approve', 'editer' );
    }

    public function execute( $par ) {
        $this->setHeaders();
        $this->checkPermissions(); 

        $out = $this->getOutput();
        $out->setPageTitle( 'Quản lý duyệt bài cho ChatBot' );
        
        $out->addModules( 'ext.approve' );

        $out->addHTML( '<div id="approve-dashboard">Đang tải danh sách bài chờ duyệt...</div>' );
    }
}