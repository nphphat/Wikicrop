<?php
/**
 * Hooks for DonateButton extension
 *
 * @file
 * @ingroup Extensions
 */

use MediaWiki\Hook\BeforePageDisplayHook;
use MediaWiki\Skins\Hook\SkinAfterPortletHook;
use MediaWiki\Hook\SkinBuildSidebarHook;
use MediaWiki\MediaWikiServices;

/**
 * @phpcs:disable MediaWiki.NamingConventions.LowerCamelFunctionsName.FunctionName
 */
class DonateButtonHooks implements
	BeforePageDisplayHook,
	SkinAfterPortletHook,
	SkinBuildSidebarHook
{

	private static $instance;

	private bool $button_active = true;
	private bool $paypal_active = false;
	private string $lang = 'en';
	private string $url_site;

	/**
	 * @param GlobalVarConfig $config
	 */
	public function __construct() {
		$config = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'donatebutton' );
		$ctx    = RequestContext::getMain();

		$this->button_active = ( $config->get( 'DonateButton' ) === true );
		$this->paypal_active = ( $config->get( 'DonateButtonEnabledPaypal' ) === true );
		$this->url_site = $config->get( 'DonateButtonURL' );

		if ( !empty( $config->get( 'DonateButtonLangs' ) ) ) {
			$lang_code= $ctx->getLanguage()->getCode();
			switch ( $lang_code ) {
				case 'de-at' :
				case 'de-ch' :
				case 'de-formal' :
					$lang_code = 'de';
				break;
				case 'es-formal' :
					$lang_code = 'es';
				break;
				case 'nl-informal' :
					$lang_code = 'nl';
				break;
				case 'en-ca' :
				case 'en-gb' :
					$lang_code = 'en';
				break;
			}

			$langs = explode( ', ', $config->get( 'DonateButtonLangs' ) );
			$lang_array = [];
			foreach ( $langs as $lang ) {
				$lang_array[] = $lang;
			}
			if ( in_array( $lang_code, $lang_array ) ) {
				$this->lang = $lang_code;
			}
		}
	}

	private function __clone() { }

	/**
	 * @return self
	 */
	public static function getInstance() {
		if ( self::$instance === null ) {
			// Erstelle eine neue Instanz, falls noch keine vorhanden ist.
			self::$instance = new self();
		}

		// Liefere immer die selbe Instanz.
		return self::$instance;
	}

	/**
	 * https://www.mediawiki.org/wiki/Manual:Hooks/BeforePageDisplay
	 *
	 * @param OutputPage $out
	 * @param Skin $skin
	 * @return void This hook must not abort, it must return no value
	 */
	public function onBeforePageDisplay( $out, $skin ) : void {

		if ( !self::isActive() )  return;

		$skinname = $skin->getSkinName();
		switch ( $skinname ) {
			case 'citizen' :
			case 'cologneblue' :
			case 'modern' :
			case 'monaco' :
			case 'monobook' :
			case 'timeless' :
				$out->addModuleStyles( 'ext.donatebutton.common' );
				$out->addModuleStyles( 'ext.donatebutton.' . $skinname );
			break;
			case 'vector' :
			case 'vector-2022' :
				$out->addModuleStyles( 'ext.donatebutton.common' );
				$out->addModuleStyles( 'ext.donatebutton.vector' );
			break;
			case 'minerva' :
			case 'fallback' :
			break;
			default :
				wfLogWarning( 'Skin ' . $skinname . ' not supported by DonateButton.' . "\n" );
			break;
		}
	}

	/**
	 * This hook is called when generating portlets.
	 * It allows injecting custom HTML after the portlet.
	 *
	 * @param Skin $skin
	 * @param string $portletName
	 * @param string &$html
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onSkinAfterPortlet( $skin, $portletName, &$html ) {

		if ( !self::isActive() )  return;

		// 1. get tool tip message
		$title_text = $skin->msg( 'donatebutton-msg' )->text();

		// 2. get lang_code
		$url_lang = $this->lang;

		// 3. get URL of image
		$config = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'main' );
		$url_file = $config->get( 'ExtensionAssetsPath' ) . '/DonateButton/resources/images/' . $url_lang . '/Donate_Button.gif';

		// 4. get URL of donation page
		$url_site = $this->paypal_active ? self::getPaypalUrl( $url_lang ) : self::getYourUrl( $url_lang );

		// 5. get HTML-Snippet
		$img_element['donatebutton'] = self::getHtmlSnippet( $skin, $title_text, $url_site, $url_file );

		switch ( $skin->getSkinName() ) {
			case 'citizen' :
			case 'cologneblue' :
			case 'modern' :
			case 'monaco' :
			case 'monobook' :
			case 'timeless' :
			case 'vector' :
			case 'vector-2022' :
				if ( array_key_exists( $portletName, $img_element ) ) {
					$element = $img_element[$portletName];
					if ( !empty( $element ) ) {
						$html = $element;
						return true;
					}
				}
			break;
		}
	}

	/**
	 * https://www.mediawiki.org/wiki/Manual:Hooks/SkinBuildSidebar
	 *
	 * @param Skin $skin
	 * @param array &$bar Sidebar contents. Modify $bar to add or modify sidebar portlets.
	 * @return bool|void True or no return value to continue or false to abort
	 */
	public function onSkinBuildSidebar( $skin, &$bar ) {

		if ( !self::isActive() )  return;

		// 1. get tool tip message
		$title_text = $skin->msg( 'donatebutton-msg' )->text();

		// 2. get lang_code
		$url_lang = $this->lang;

		// 3. get URL of donation page
		$url_site = $this->paypal_active ? self::getPaypalUrl( $url_lang ) : self::getYourUrl( $url_lang );

		// 4. get TEXT-Snippet
		$txt_item = [
			'text'   => $skin->msg( 'sitesupport' )->text(),
			'href'   => $url_site,
			'id'     => 'n-donatebutton',
			'active' => true
		];
		$empty_item = [
			'text'   => '',
			'id'     => 'n-donatebutton',
			'active' => true
		];

		$sidebar_element = [];

		switch ( $skin->getSkinName() ) {
			case 'citizen' :
			case 'cologneblue' :
			case 'modern' :
			case 'monaco' :
			case 'monobook' :
			case 'vector' :
			case 'vector-2022' :
			break;
			case 'timeless' :
				// Dirty hack for skin Timeless
				$sidebar_element = [ $empty_item ];
			break;
			default :
				$sidebar_element = [ $txt_item ];
			break;
		}

		$bar['donatebutton'] = $sidebar_element;

	}

	/*
	 * https://www.mediawiki.org/wiki/Skin:Minerva_Neue/Hooks/MobileMenu
	 */
	public function onMobileMenu( $name, \MediaWiki\Minerva\Menu\Group &$group ) {

		if ( !self::isActive() )  return;

		// 1. get link text
		$link_txt = $template->msg( 'donatebutton-donation' )->text();

		// 2. get lang_code
		$url_lang = $this->lang;

		// 3. get URL of donation page
		$link_url = $this->paypal_active ? self::getPaypalUrl( $url_lang ) : self::getYourUrl( $url_lang );

		if ( $name === 'discovery' ) {
				$group->insert( 'donation' )
				->addComponent(
						'donatebutton-donation',
						$link_url
				);
		}
	}

	/**
	 * Load donate box for Monaco skin.
	 *
	 * @return bool
	 */
	public function onMonacoStaticboxEnd( $skin, &$html ) {

		if ( !self::isActive() )  return;

		$skin = RequestContext::getMain()->getSkin();

		// 1. get tool tip message
		$title_text = wfMessage( 'donatebutton-msg' )->text();
		$title_key = wfMessage( 'donatebutton' )->text();

		// 2. get lang_code
		$url_lang = $this->lang;

		// 3. get URL of image
		$config = MediaWikiServices::getInstance()->getConfigFactory()->makeConfig( 'main' );
		$url_file = $config->get( 'ExtensionAssetsPath' ) . '/DonateButton/resources/images/' . $url_lang . '/Donate_Button.gif';

		// 4. get URL of donation page
		$url_site = self::getInstance()->paypal_active ? self::getPaypalUrl( $url_lang ) : self::getYourUrl( $url_lang );

		// 5. get HTML-Snippet
		$img_element = self::getHtmlSnippet( $skin, $title_text, $url_site, $url_file );

		$html .= "<p style='margin-top:0.5em;'>$title_key</p>";
		$html .= "<div style='text-align:center;'>$img_element</div>";

		return true;
	}

	/**
	 * Returns Paypal's url sensitive to $lang
	 */
	private static function getPaypalUrl( $lang ) {

		if ( strcmp( $lang, 'en' ) === 0 ) {
			return 'https://www.paypalobjects.com/en_GB/i/btn/btn_donate_LG.gif';
		}
		return 'https://www.paypalobjects.com/' . $lang . '_' . strtoupper( $lang ) . '/i/btn/btn_donate_LG.gif';
	}

	/**
	 * Returns your url sensitive to $lang
	 */
	private static function getYourUrl( $lang ) {

		$url = self::getInstance()->url_site;

		// If the passed URL ends with a '=', append the language abbreviation to make the donation page language sensitive.
		// i.e. your URL is "https://yourdomain.org/donationpage.php?lang="
		// Wenn die übergebene URL mit einem '=' endet, das Sprachenkürzel anhängen, um die Spendenseite sprachsensitiv zu behandeln.
		if ( substr( $url, ( strlen( $url ) - 1 ), 1 ) === '=' ) {
			$url .= $lang;
		}
		return $url;
	}

	/**
	 * Returns HTML-Snippet
	 */
	private static function getHtmlSnippet( $skin, $title, $url_site, $url_image ) {
		$html_pattern = '<a href="%1$s"><img alt="%2$s" title="%3$s" src="%4$s" /></a>';
		$html_code = sprintf( $html_pattern,
						$url_site,
						'Donate-Button',
						$title,
						$url_image
					);

		switch ( $skin->getSkinName() ) {
			case 'cologneblue' :
				$html_code = Html::rawElement( 'div', [ 'class' => 'body' ], $html_code );
			break;
			default :
			break;
		}
		return $html_code;
	}

	/**
	 * Returns true if extension is set to active
	 */
	private static function isActive() {

		return self::getInstance()->button_active;
	}
}
