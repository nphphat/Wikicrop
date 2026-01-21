<?php
### Nguyen Huu Dat, TTTT HK3 2024-2025

namespace MediaWiki\Extension\ApiData;

use MediaWiki\Hook\ParserFirstCallInitHook;
use MediaWiki\Parser\Parser;


// implement hook
class Hook implements ParserFirstCallInitHook {
  public function fetchApiData( $url ) {
    $options = [
        'http' => [
            'method' => "GET",
        ]
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);

    if ($response === false) {
        return false;
    }

    $json = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return false;
    }

    return $json;
  }

  // set hook
  public function onParserFirstCallInit( $parser ) {
    $parser->setHook( 'sample', [ $this, 'renderTagSample' ] );
  }


  // Ham render response thanh html table (chua dung)
  public function render( $data ) {
    $html = '<div class="apidata"><ul>';

    foreach ($data as $key => $value) {
        if (is_array($value)) {
            $html .= "<li><strong>$key</strong>: <pre>" . htmlspecialchars(json_encode($value, JSON_PRETTY_PRINT)) . "</pre></li>";
        } else {
            $html .= "<li><strong>$key</strong>: " . htmlspecialchars((string)$value) . "</li>";
        }
    }

    $html .= '</ul></div>';
    return $html;
  }


  // Ham chinh
  public function renderTagSample($input, array $args, Parser $parser) {
    // error_log("onParserFirstCallInit run" . rand(1, 100)); // check if called

    $parser->getOutput()->updateCacheExpiry(0);

    $url = $args['url'] ?? null;

    if ( !$url || !filter_var( $url, FILTER_VALIDATE_URL ) ) {
            return "<strong>Error:</strong> Invalid or missing API URL.";
    }

    $data = self::fetchApiData($url);
    if ( $data === false ) {
      return "<strong>Error:</strong> Failed to fetch data from API.";
    }

    return json_encode($data); // render respose vao trang duoi dang json

  }

}

