<?php

namespace MediaWiki\Extension\PlantMorphology;

use MediaWiki\Hook\ParserFirstCallInitHook;
use Parser;

class Hook implements ParserFirstCallInitHook {

    /**
     * @param Parser $parser
     * @return bool
     */
    public function onParserFirstCallInit( $parser ) {
        // Đăng ký parser function {{#morphology:id}}
        $parser->setFunctionHook( 'morphology', [ $this, 'renderMorphologyFunction' ] );
        return true;
    }

    /**
     * @param Parser $parser
     * @param string $id
     * @return array|string
     */
    public function renderMorphologyFunction( Parser $parser, $id = '' ) {
        // $parser->getOutput()->updateCacheExpiry( 0 );

        $id = trim( $id );
        if ( $id === '' ) {
            return '';
        }

        $data = $this->fetchApiData( $id );
        if ( !$data ) {
            return '';
        }

        $wikiText = $this->generateWikitext( $data );

        // Trả về kèm cờ noparse=false để MediaWiki phân giải mục lục (TOC)
        return [ $wikiText, 'noparse' => false, 'isHTML' => false ];
    }

    /**
     * @param string $id
     * @return array|null
     */
    private function fetchApiData( $id ) {
        $url = "https://efloravn.vercel.app/api/v1/taxa/" . urlencode( $id );
        
        $options = [
            "http" => [
                "method" => "GET",
                "header" => "User-Agent: MediaWiki-PlantMorphology/1.0\r\n",
                "timeout" => 5 // Tự động ngắt kết nối sau 5 giây nếu API bị treo
            ]
        ];
        $context = stream_context_create( $options );
        $response = @file_get_contents( $url, false, $context );

        if ( $response === false ) {
            return null;
        }

        // Kiểm tra cấu trúc JSON hợp lệ từ eFloraVN
        $json = json_decode( $response, true );
        if ( isset( $json['success'] ) && $json['success'] === true && isset( $json['data'] ) ) {
            return $json['data'];
        }

        return null;
    }

    /**
     * @param array $data
     * @return string
     */
    private function generateWikitext( array $data ) {
        $habit = trim( $data['habit'] ?? '' );
        $leaf = trim( $data['leaf'] ?? '' );
        $reproduction = trim( $data['reproduction'] ?? '' );

        // Bỏ qua nếu không có dữ liệu nào
        if ( $habit === '' && $leaf === '' && $reproduction === '' ) {
            return '';
        }

        $wikiText = "== Đặc điểm hình thái (theo bộ sách ''Cây cỏ Việt Nam'' - Phạm Hoàng Hộ) ==\n\n";

        $sections = [
            'Dạng sống, thân, rễ' => $habit,
            'Hoa, quả, hạt' => $reproduction,
            'Lá' => $leaf
        ];

        foreach ( $sections as $title => $content ) {
            if ( $content !== '' ) {
                // Tách câu thành các đoạn văn riêng biệt
                $formattedContent = str_replace( '. ', ".\n\n", $content );
                
                $wikiText .= "=== {$title} ===\n\n";
                $wikiText .= trim( $formattedContent ) . "\n\n";
            }
        }

        return trim( $wikiText );
    }
}

