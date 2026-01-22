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

		// Pagination parameters
		$limit = 12;
		$page = $this->getRequest()->getInt('page', 1);
		if ($page < 1) {
			$page = 1;
		}
		$offset = ($page - 1) * $limit;

		// Get total count for pagination
		$totalVideos = $this->getTotalVideoCount();
		$totalPages = ceil($totalVideos / $limit);

		// Fetch videos
		$videos = $this->getVideos($limit, $offset);

		if (empty($videos) && $page == 1) {
			$out->addWikiMsg('nongnghieptube-no-videos');
			return;
		}

		$html = '<div class="nongnghieptube-container">';
		foreach ($videos as $video) {
			$html .= $this->buildVideoCard($video);
		}
		$html .= '</div>';

		// Pagination Controls
		if ($totalPages > 1) {
			$html .= $this->buildPagination($page, $totalPages);
		}

		// Append Modal HTML
		$html .= $this->buildModalParams();

		$out->addHTML($html);
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

	private function buildPagination($currentPage, $totalPages)
	{
		$html = '<div class="nongnghieptube-pagination">';

		// Previous Button
		if ($currentPage > 1) {
			$prevUrl = $this->getPageTitle()->getLocalURL(['page' => $currentPage - 1]);
			$html .= '<a href="' . htmlspecialchars($prevUrl) . '" class="nongnghieptube-page-btn">&laquo;</a>';
		}

		// Page Numbers
		$start = max(1, $currentPage - 2);
		$end = min($totalPages, $currentPage + 2);

		// Always show first page if logic allows gap
		if ($start > 1) {
			$url = $this->getPageTitle()->getLocalURL(['page' => 1]);
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn">1</a>';
			if ($start > 2) {
				$html .= '<span class="nongnghieptube-page-dots">...</span>';
			}
		}

		for ($i = $start; $i <= $end; $i++) {
			$url = $this->getPageTitle()->getLocalURL(['page' => $i]);
			$activeClass = ($i == $currentPage) ? ' active' : '';
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn' . $activeClass . '">' . $i . '</a>';
		}

		// Always show last page if logic allows gap
		if ($end < $totalPages) {
			if ($end < $totalPages - 1) {
				$html .= '<span class="nongnghieptube-page-dots">...</span>';
			}
			$url = $this->getPageTitle()->getLocalURL(['page' => $totalPages]);
			$html .= '<a href="' . htmlspecialchars($url) . '" class="nongnghieptube-page-btn">' . $totalPages . '</a>';
		}

		// Next Button
		if ($currentPage < $totalPages) {
			$nextUrl = $this->getPageTitle()->getLocalURL(['page' => $currentPage + 1]);
			$html .= '<a href="' . htmlspecialchars($nextUrl) . '" class="nongnghieptube-page-btn">&raquo;</a>';
		}

		$html .= '</div>';
		return $html;
	}

	private function getTotalVideoCount()
	{
		$dbr = \MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		return $dbr->selectField(
			'nongnghiep40_resources',
			'COUNT(*)',
			[],
			__METHOD__
		);
	}

	private function getVideos($limit, $offset)
	{
		$dbr = \MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase();
		$res = $dbr->select(
			'nongnghiep40_resources',
			['nn_name', 'nn_url', 'nn_summary'],
			[],
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
					'videoId' => $videoId
				];
			}
		}

		return $videos;
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
			</div>
		</div>
HTML;
	}
}
