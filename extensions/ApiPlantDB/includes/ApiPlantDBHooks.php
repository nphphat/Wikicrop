<?php

namespace MediaWiki\Extension\ApiPlantDB;

use DatabaseUpdater;
use OutputPage;
use ParserOutput;
use MediaWiki\MediaWikiServices;

class ApiPlantDBHooks {

    /**
     * Hook: LoadExtensionSchemaUpdates
     * Đã sửa tên hàm thành onSchemaUpdate (không có s) cho khớp với JSON
     */
    public static function onSchemaUpdate( DatabaseUpdater $updater ) {
        // Lưu ý: Đảm bảo đường dẫn file SQL đúng
        $updater->addExtensionTable( 'plantdb_map', __DIR__ . '/../sql/create_plantdb_map.sql' );
    }

    /**
     * Hook: OutputPageParserOutput
     */
    public static function onOutputPageParserOutput( OutputPage $out, ParserOutput $parserOutput ) {
        $title = $out->getTitle();
        $pageId = $title->getArticleID();

        $plantId = self::getPlantIdFromDb($pageId);

        if ( $plantId ) {
            $data = self::fetchFromApi($plantId);
            if ($data) {
                $html = self::renderPlantInfo($data);
                $out->addHTML($html);
            }
        }
    }

    private static function getPlantIdFromDb( $pageId ) {
        $dbr = MediaWikiServices::getInstance()->getDBLoadBalancer()->getConnection( DB_REPLICA );
        
        $row = $dbr->selectRow(
            'plantdb_map',
            ['pm_plantdb_id'], // Tên cột bạn đã đặt trong SQL
            ['pm_page_id' => $pageId],
            __METHOD__
        );

        return $row ? $row->pm_plantdb_id : null;
    }

    private static function fetchFromApi( $plantId ) {
        $apiUrl = "https://plantdb.lab.io.vn/api/species/" . $plantId; 
        // $apiUrl = "http://localhost/wikicrop/mock_plant.json";

        $opts = [
            "http" => [
                "method" => "GET",
                "header" => "User-Agent: MediaWiki-ApiPlantDB/1.0\r\n"
            ]
        ];
        $context = stream_context_create($opts);

        $response = @file_get_contents($apiUrl, false, $context);

        if ($response === FALSE) {
            return null;
        }

        return json_decode($response, true);
    }

    private static function renderPlantInfo( $data ) {
        $name = 'Không rõ';
        if (!empty($data['SpeciesNames'])) {
            foreach ($data['SpeciesNames'] as $sName) {
                if (isset($sName['is_primary']) && $sName['is_primary'] == 1) {
                    $name = $sName['name'];
                    break;
                }
            }
            if ($name === 'Không rõ' && isset($data['SpeciesNames'][0]['name'])) {
                $name = $data['SpeciesNames'][0]['name'];
            }
        }

        $imageUrl = '';
        if (!empty($data['Images'])) {
            foreach ($data['Images'] as $img) {
                if (isset($img['is_representative']) && $img['is_representative'] == 1) {
                    $imageUrl = $img['url'];
                    break;
                }
            }
            if (!$imageUrl && isset($data['Images'][0]['url'])) {
                $imageUrl = $data['Images'][0]['url'];
            }
        }

        $html = '<div class="plantdb-infobox" style="float: right; width: 300px; border: 1px solid #a2a9b1; background-color: #f8f9fa; padding: 5px; margin: 0 0 1em 1em; font-size: 90%; clear: right;">';
        $html .= '<div style="background-color: #cedff2; text-align: center; font-weight: bold; padding: 5px; font-size: 120%; margin-bottom: 5px;">' . htmlspecialchars($name) . '</div>';

        if ($imageUrl) {
            $html .= '<div style="text-align: center; margin-bottom: 10px;">';
            $html .= '<img src="' . htmlspecialchars($imageUrl) . '" style="max-width: 100%; height: auto; border: 1px solid #ccc;" />';
            $html .= '</div>';
        }

        $html .= '<table style="width: 100%; border-collapse: collapse;">';

        if (!empty($data['PropertiesValues'])) {
            foreach ($data['PropertiesValues'] as $propData) {
                $propName = $propData['Property']['name'] ?? '';
                $value = '';
                $type = $propData['Property']['value_type'] ?? '';

                if ($type === 'enum' && isset($propData['EnumProperty']['enum_value'])) {
                    $value = $propData['EnumProperty']['enum_value'];
                } elseif ($type === 'num' && isset($propData['number_value'])) {
                    $value = $propData['number_value'];
                }

                if ($propName && $value !== '') {
                    $html .= '<tr style="border-bottom: 1px solid #eaecf0;">';
                    $html .= '<th style="text-align: left; padding: 5px; font-weight: bold; color: #54595d; vertical-align: top;">' . htmlspecialchars($propName) . '</th>';
                    $html .= '<td style="padding: 5px; vertical-align: top;">' . htmlspecialchars($value) . '</td>';
                    $html .= '</tr>';
                }
            }
        } else {
            $html .= '<tr><td colspan="2" style="padding:5px;">Đang cập nhật dữ liệu...</td></tr>';
        }

        $html .= '</table>';
        $html .= '<div style="text-align: right; font-size: 80%; margin-top: 5px; color: #72777d;">Nguồn: PlantDB</div>';
        $html .= '</div>';

        return $html;
    }
}