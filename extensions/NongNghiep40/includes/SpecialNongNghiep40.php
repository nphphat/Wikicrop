<?php

class SpecialNongNghiep40 extends SpecialPage
{
	public function __construct()
	{
		parent::__construct('NongNghiep40');
	}

	public function execute($par)
	{
		$this->setHeaders();
		// $this->outputHeader(); // Removed to prevent displaying nongnghiep40-summary collision
		$out = $this->getOutput();
		$out->addModules('ext.nongnghiep40');
		$out->setPageTitle($this->msg('nongnghieptube-title')->text());

		// Filter parameters
		$category = $this->getRequest()->getText('category');

		// Pagination parameters
		$limit = 12;
		$page = $this->getRequest()->getInt('page', 1);
		if ($page < 1) {
			$page = 1;
		}
		$offset = ($page - 1) * $limit;

		// Get total count for pagination
		$totalVideos = $this->getTotalVideoCount($category);
		$totalPages = ceil($totalVideos / $limit);

		// Fetch videos
		$videos = $this->getVideos($limit, $offset, $category);

		// Build Category Filter
		$categories = $this->getAllCategories();
		$html = $this->buildCategoryFilter($categories, $category);

		if (empty($videos) && $page == 1) {
			$out->addWikiMsg('nongnghieptube-no-videos');
			$out->addHTML($html); // Show filter even if no videos found
			return;
		}

		$html .= '<div class="nongnghieptube-container">';
		foreach ($videos as $video) {
			$html .= $this->buildVideoCard($video);
		}
		$html .= '</div>';

		// Pagination Controls
		if ($totalPages > 1) {
			$html .= $this->buildPagination($page, $totalPages, $category);
		}

		// Append Modal HTML
		$html .= $this->buildModalParams();

		$out->addHTML($html);
	}

	private function buildCategoryFilter($categories, $currentCategory)
	{
		$url = $this->getPageTitle()->getLocalURL();
		$html = '<div class="nongnghieptube-filter">';
		$html .= '<label for="nongnghieptube-category-select">' . $this->msg('nongnghieptube-filter-category')->text() . ':</label>';
		$html .= '<select id="nongnghieptube-category-select" onchange="window.location.href=\'' . htmlspecialchars($url) . '?category=\' + this.value;">';
		
		$selected = ($currentCategory === '') ? 'selected' : '';
		$html .= '<option value="" ' . $selected . '>' . $this->msg('nongnghieptube-all-categories')->text() . '</option>';

		foreach ($categories as $cat) {
			$selected = ($currentCategory === $cat) ? 'selected' : '';
			$html .= '<option value="' . htmlspecialchars($cat) . '" ' . $selected . '>' . htmlspecialchars($cat) . '</option>';
		}

		$html .= '</select>';
		$html .= '</div>';
		return $html;
	}

	private function buildModalParams()
	{
		return <<<HTML
		<div id="nongnghieptube-modal" class="nongnghieptube-modal">
			<div class="nongnghieptube-modal-content">
				<span class="nongnghieptube-close">&times;</span>
				<div class="nongnghieptube-modal-video-container">
					<iframe id="nongnghieptube-modal-iframe" src="" allowfullscreen></iframe>
				</div>
				<h2 id="nongnghieptube-modal-title"></h2>
				<p id="nongnghieptube-modal-desc"></p>
			</div>
		</div>
HTML;
	}

	private function buildPagination($currentPage, $totalPages, $category)
	{
		$html = '<div class="nongnghieptube-pagination">';
		$queryParams = [];
		if ($category !== '') {
			$queryParams['category'] = $category;
		}

		// Previous Button
		if ($currentPage > 1) {
			$queryParams['page'] = $currentPage - 1;
			$prevUrl = $this->getPageTitle()->getLocalURL($queryParams);
			$html .= '<a href="' . htmlspecialchars($prevUrl) . '" class="nongnghieptube-page-btn">&laquo;</a>';
		}

		// Page Numbers
		$start = max(1, $currentPage - 2);
		$end = min($totalPages, $currentPage + 2);

		// Always show first page if logic allows gap
		if ($start > 1) {
			$queryParams['page'] = 1;
			$url = $this->getPageTitle()->getLocalURL($queryParams);
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn">1</a>';
			if ($start > 2) {
				$html .= '<span class="nongnghieptube-page-dots">...</span>';
			}
		}

		for ($i = $start; $i <= $end; $i++) {
			$queryParams['page'] = $i;
			$url = $this->getPageTitle()->getLocalURL($queryParams);
			$activeClass = ($i == $currentPage) ? ' active' : '';
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn' . $activeClass . '">' . $i . '</a>';
		}

		// Always show last page if logic allows gap
		if ($end < $totalPages) {
			if ($end < $totalPages - 1) {
				$html .= '<span class="nongnghieptube-page-dots">...</span>';
			}
			$queryParams['page'] = $totalPages;
			$url = $this->getPageTitle()->getLocalURL($queryParams);
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn">' . $totalPages . '</a>';
		}

		// Next Button
		if ($currentPage < $totalPages) {
			$queryParams['page'] = $currentPage + 1;
			$nextUrl = $this->getPageTitle()->getLocalURL($queryParams);
			$html .= '<a href="' . htmlspecialchars($nextUrl) . '" class="nongnghieptube-page-btn">&raquo;</a>';
		}

		$html .= '</div>';
		return $html;
	}

	private function getTotalVideoCount($category = '')
	{
		$dbr = \MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		$conds = [];
		if ($category !== '') {
			$conds['nn_category'] = $category;
		}
		return $dbr->selectField(
			'nongnghiep40_resources',
			'COUNT(*)',
			$conds,
			__METHOD__
		);
	}

	private function getVideos($limit, $offset, $category = '')
	{
		$dbr = \MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		$conds = [];
		if ($category !== '') {
			$conds['nn_category'] = $category;
		}
		$res = $dbr->select(
			'nongnghiep40_resources',
			['nn_name', 'nn_url', 'nn_summary', 'nn_category'],
			$conds,
			__METHOD__,
			['ORDER BY' => 'nn_timestamp DESC', 'LIMIT' => $limit, 'OFFSET' => $offset]
		);

		$videos = [];
		foreach ($res as $row) {
			$videoId = $this->getYouTubeId($row->nn_url);
			if ($videoId) {
				$videos[] = [
					'title' => $row->nn_name,
					'url' => $row->nn_url,
					'summary' => $row->nn_summary,
					'category' => $row->nn_category,
					'videoId' => $videoId
				];
			}
		}

		return $videos;
	}

	private function getAllCategories()
	{
		$dbr = \MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		$res = $dbr->select(
			'nongnghiep40_resources',
			'DISTINCT nn_category',
			[],
			__METHOD__,
			['ORDER BY' => 'nn_category ASC']
		);

		$categories = [];
		foreach ($res as $row) {
			if (!empty($row->nn_category)) {
				$categories[] = $row->nn_category;
			}
		}
		return $categories;
	}

	private function getYouTubeId($url)
	{
		$pattern = '/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i';
		if (preg_match($pattern, $url, $match)) {
			return $match[1];
		}
		return null;
	}

	private function buildVideoCard($video)
	{
		$embedUrl = htmlspecialchars("https://www.youtube.com/embed/" . $video['videoId']);
		$imageUrl = htmlspecialchars("https://img.youtube.com/vi/" . $video['videoId'] . "/hqdefault.jpg");
		$title = htmlspecialchars($video['title']);
		$summary = htmlspecialchars($video['summary']);
		$category = htmlspecialchars($video['category']);
		$videoId = htmlspecialchars($video['videoId']);

		return <<<HTML
		<div class="nongnghieptube-video-card" data-video-id="$videoId" data-title="$title" data-summary="$summary">
			<div class="nongnghieptube-thumbnail">
				<img src="$imageUrl" alt="$title" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0;">
				<div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:68px; height:48px; background:rgba(33,33,33,0.8); border-radius:12px; display:flex; align-items:center; justify-content:center;">
					<div style="width: 0; height: 0; border-top: 10px solid transparent; border-bottom: 10px solid transparent; border-left: 15px solid white;"></div>
				</div>
			</div>
			<div class="nongnghieptube-info">
				<div class="nongnghieptube-title">$title</div>
				<div class="nongnghieptube-desc">$summary</div>
				<div class="nongnghieptube-category">Danh mục: $category</div>
			</div>
		</div>
HTML;
	}
}
