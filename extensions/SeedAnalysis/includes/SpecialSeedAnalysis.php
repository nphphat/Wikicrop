<?php

class SpecialSeedAnalysis extends SpecialPage {
    public function __construct() {
        parent::__construct( 'SeedAnalysis' );
    }

    public function execute( $par ) {
        $request = $this->getRequest();
        if ( $request->getVal( 'seedanalysis_action' ) === 'analyze' ) {
            $this->handleAnalyzeProxy();
            return;
        }

        $this->setHeaders();

        $output = $this->getOutput();
        $output->setPageTitle( $this->msg( 'seedanalysis-title' )->text() );
        $output->addModules( [ 'mediawiki.special', 'ext.seedAnalysis' ] );

        $config = MediaWiki\MediaWikiServices::getInstance()->getMainConfig();
        $apiUrl = rtrim( $config->get( 'SeedAnalysisApiUrl' ), '/' );
        $playStoreUrl = $config->get( 'SeedAnalysisPlayStoreUrl' );

        $output->addJsConfigVars( 'SeedAnalysisConfig', [
            'apiUrl' => $apiUrl,
            'serviceHealthUrl' => $apiUrl . '/grain/health',
            'analyzeUrl' => $this->getPageTitle()->getLocalURL( [
                'seedanalysis_action' => 'analyze',
            ] ),
            'playStoreUrl' => $playStoreUrl,
        ] );

        $output->addHTML( $this->renderShell() );
    }

    private function renderShell() {
        $html = '<div id="seedanalysis-root" class="seedanalysis">';
        $html .= '<div class="seedanalysis-toolbar">';
        $html .= '<div>';
        $html .= '<h2>' . htmlspecialchars( $this->msg( 'seedanalysis-heading' )->text() ) . '</h2>';
        $html .= '<p>' . htmlspecialchars( $this->msg( 'seedanalysis-subtitle' )->text() ) . '</p>';
        $html .= '</div>';
        $config = MediaWiki\MediaWikiServices::getInstance()->getMainConfig();
        $playStoreUrl = trim( (string)$config->get( 'SeedAnalysisPlayStoreUrl' ) );
        if ( $playStoreUrl !== '' && filter_var( $playStoreUrl, FILTER_VALIDATE_URL ) ) {
            $html .= '<a class="seedanalysis-app-link" href="' . htmlspecialchars( $playStoreUrl, ENT_QUOTES ) . '" target="_blank" rel="noopener">' . htmlspecialchars( $this->msg( 'seedanalysis-open-app' )->text() ) . '</a>';
        }
        $html .= '</div>';

        $html .= '<form id="seedanalysis-form" class="seedanalysis-form" novalidate>';
        $html .= '<div class="seedanalysis-form-main">';
        $html .= '<div class="seedanalysis-upload-panel">';
        $html .= '<label class="seedanalysis-file">';
        $html .= '<span>' . htmlspecialchars( $this->msg( 'seedanalysis-select-image' )->text() ) . '</span>';
        $html .= '<input id="seedanalysis-image" name="image" type="file" accept="image/jpeg,image/png" required>';
        $html .= '</label>';

        $html .= '<div class="seedanalysis-calibration">';
        $html .= '<label><span>' . htmlspecialchars( $this->msg( 'seedanalysis-reference-pixels' )->text() ) . '</span><input name="referencePixels" type="number" min="0" step="0.01" placeholder="0"></label>';
        $html .= '<label><span>' . htmlspecialchars( $this->msg( 'seedanalysis-reference-mm' )->text() ) . '</span><input name="referenceMm" type="number" min="0" step="0.01" placeholder="0"></label>';
        $html .= '</div>';
        $html .= '</div>';

        $html .= '<div id="seedanalysis-input-preview" class="seedanalysis-input-preview" hidden>';
        $html .= '<div class="seedanalysis-input-preview-head">';
        $html .= '<strong>' . htmlspecialchars( $this->msg( 'seedanalysis-reference-preview-title' )->text() ) . '</strong>';
        $html .= '<span>' . htmlspecialchars( $this->msg( 'seedanalysis-reference-preview-help' )->text() ) . '</span>';
        $html .= '</div>';
        $html .= '<div id="seedanalysis-calibration-stage" class="seedanalysis-calibration-stage">';
        $html .= '<span class="seedanalysis-calibration-frame">';
        $html .= '<img id="seedanalysis-calibration-image" alt="' . htmlspecialchars( $this->msg( 'seedanalysis-reference-preview-title' )->text() ) . '" draggable="false">';
        $html .= '<svg id="seedanalysis-calibration-overlay" class="seedanalysis-calibration-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
        $html .= '<line id="seedanalysis-reference-line" x1="0" y1="0" x2="0" y2="0"></line>';
        $html .= '<circle id="seedanalysis-reference-start" cx="0" cy="0" r="1.8"></circle>';
        $html .= '<circle id="seedanalysis-reference-end" cx="0" cy="0" r="1.8"></circle>';
        $html .= '</svg>';
        $html .= '</span>';
        $html .= '</div>';
        $html .= '<div class="seedanalysis-reference-tools">';
        $html .= '<span id="seedanalysis-reference-status">' . htmlspecialchars( $this->msg( 'seedanalysis-reference-empty' )->text() ) . '</span>';
        $html .= '<button id="seedanalysis-clear-reference" class="seedanalysis-secondary" type="button">' . htmlspecialchars( $this->msg( 'seedanalysis-clear-reference' )->text() ) . '</button>';
        $html .= '</div>';
        $html .= '</div>';
        $html .= '</div>';
        $html .= '<input name="referencePixelSpace" type="hidden" value="">';
        $html .= '<input name="referenceX1" type="hidden" value="">';
        $html .= '<input name="referenceY1" type="hidden" value="">';
        $html .= '<input name="referenceX2" type="hidden" value="">';
        $html .= '<input name="referenceY2" type="hidden" value="">';

        $html .= '<div class="seedanalysis-runbar">';
        $html .= '<div id="seedanalysis-status" class="seedanalysis-status" aria-live="polite"></div>';
        $html .= '<button id="seedanalysis-submit" class="seedanalysis-primary" type="submit">' . htmlspecialchars( $this->msg( 'seedanalysis-analyze' )->text() ) . '</button>';
        $html .= '</div>';
        $html .= '</form>';

        $html .= '<div id="seedanalysis-result" class="seedanalysis-result" hidden></div>';
        $html .= '</div>';

        return $html;
    }

    private function handleAnalyzeProxy() {
        $this->getOutput()->disable();
        header( 'Content-Type: application/json; charset=utf-8' );

        $request = $this->getRequest();
        if ( !$request->wasPosted() ) {
            $this->sendJsonError( 'Method not allowed', 405 );
            return;
        }

        $upload = $request->getUpload( 'image' );
        if ( !$upload->exists() || $upload->getError() !== UPLOAD_ERR_OK ) {
            $this->sendJsonError( 'Image upload is required with field name image', 400 );
            return;
        }

        if ( !function_exists( 'curl_init' ) || !class_exists( 'CURLFile' ) ) {
            $this->sendJsonError( 'PHP cURL extension is required for SeedAnalysis proxy', 500 );
            return;
        }

        $config = MediaWiki\MediaWikiServices::getInstance()->getMainConfig();
        $apiUrl = rtrim( $config->get( 'SeedAnalysisApiUrl' ), '/' ) . '/grain/analyze-public';
        $fields = [
            'image' => new CURLFile(
                $upload->getTempName(),
                $upload->getType() ?: 'application/octet-stream',
                $upload->getName() ?: 'image.png'
            ),
        ];

        foreach ( [
            'referencePixels',
            'referenceMm',
            'referencePixelSpace',
            'referenceX1',
            'referenceY1',
            'referenceX2',
            'referenceY2',
        ] as $name ) {
            $value = $request->getVal( $name );
            if ( $value !== null && $value !== '' ) {
                $fields[$name] = $value;
            }
        }

        $ch = curl_init( $apiUrl );
        curl_setopt_array( $ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $fields,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 320,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
            ],
        ] );

        $response = curl_exec( $ch );
        $statusCode = (int)curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
        $error = curl_error( $ch );
        curl_close( $ch );

        if ( $response === false || $response === '' ) {
            $this->sendJsonError( 'Seed analysis service did not respond' . ( $error ? ': ' . $error : '' ), 502 );
            return;
        }

        http_response_code( $statusCode >= 100 ? $statusCode : 200 );
        echo $response;
    }

    private function sendJsonError( $message, $statusCode = 500 ) {
        http_response_code( $statusCode );
        echo json_encode( [
            'success' => false,
            'message' => $message,
        ], JSON_UNESCAPED_UNICODE );
    }

    protected function getGroupName() {
        return 'other';
    }
}
