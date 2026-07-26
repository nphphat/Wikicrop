( function ( $, mw ) {
    'use strict';

    var config = mw.config.get( 'SeedAnalysisConfig' ) || {};
    var currentResult = null;
    var currentPreview = 'overlay';
    var currentChartMetric = 'length';
    var editRenderSequence = 0;
    var inputPreviewRequest = 0;
    var calibration = {
        start: null,
        end: null
    };
    var drawingCalibration = false;
    var draggingHandle = null;
    var metricDefinitions = {
        length: {
            title: 'distribution-length',
            pxKey: 'length_px',
            mmKey: 'length_mm',
            pxUnit: 'px',
            mmUnit: 'mm',
            pxDigits: 1,
            mmDigits: 2,
            color: '#2f6b4f'
        },
        width: {
            title: 'distribution-width',
            pxKey: 'width_px',
            mmKey: 'width_mm',
            pxUnit: 'px',
            mmUnit: 'mm',
            pxDigits: 1,
            mmDigits: 2,
            color: '#36c'
        },
        area: {
            title: 'distribution-area',
            pxKey: 'area_px',
            mmKey: 'area_mm2',
            pxUnit: 'px2',
            mmUnit: 'mm2',
            pxDigits: 0,
            mmDigits: 3,
            color: '#d97706'
        }
    };

    function msg( key ) {
        return mw.msg( 'seedanalysis-' + key );
    }

    function imageSrc( value ) {
        if ( !value ) {
            return '';
        }
        return String( value ).indexOf( 'data:' ) === 0 ?
            value :
            'data:image/png;base64,' + value;
    }

    function formatNumber( value, digits ) {
        var numeric = Number( value );
        if ( !Number.isFinite( numeric ) ) {
            return '-';
        }
        return numeric.toLocaleString( undefined, {
            maximumFractionDigits: digits,
            minimumFractionDigits: numeric === 0 ? 0 : Math.min( 1, digits )
        } );
    }

    function finiteNumber( value ) {
        var numeric = Number( value );
        return Number.isFinite( numeric ) ? numeric : null;
    }

    function clamp( value, min, max ) {
        return Math.max( min, Math.min( max, value ) );
    }

    function percentile( sortedValues, ratio ) {
        var index;
        var lower;
        var upper;
        var weight;

        if ( !sortedValues.length ) {
            return null;
        }

        index = ( sortedValues.length - 1 ) * clamp( ratio, 0, 1 );
        lower = Math.floor( index );
        upper = Math.ceil( index );
        if ( lower === upper ) {
            return sortedValues[ lower ];
        }
        weight = index - lower;
        return sortedValues[ lower ] * ( 1 - weight ) + sortedValues[ upper ] * weight;
    }

    function reportedStat( summary, rawKey, robustKey ) {
        var qc = summary.qc || {};
        if ( qc.robust_used_for_reporting !== false && summary[ robustKey ] !== undefined ) {
            return summary[ robustKey ];
        }
        return summary[ rawKey ];
    }

    function measurementText( mmValue, pxValue, mmUnitKey, mmDigits, pxDigits ) {
        var mmNumber = finiteNumber( mmValue );
        var pxNumber = finiteNumber( pxValue );
        if ( mmNumber !== null && mmNumber > 0 ) {
            return formatNumber( mmNumber, mmDigits ) + ' ' + msg( mmUnitKey );
        }
        if ( pxNumber !== null ) {
            return formatNumber( pxNumber, pxDigits ) + ' ' + msg( 'px' );
        }
        return '-';
    }

    function formNumberValue( name ) {
        var form = document.getElementById( 'seedanalysis-form' );
        var value = form ? $( form ).find( '[name="' + name + '"]' ).val() : '';
        var numeric = Number( value );
        return Number.isFinite( numeric ) ? numeric : 0;
    }

    function suggestedReferencePoint( suggestion, xKey, yKey ) {
        var x = finiteNumber( suggestion && suggestion[ xKey ] );
        var y = finiteNumber( suggestion && suggestion[ yKey ] );
        if ( x === null || y === null ) {
            return null;
        }
        return {
            x: x,
            y: y
        };
    }

    function setSuggestedReferenceNotice( visible ) {
        $( '#seedanalysis-reference-suggestion' )
            .prop( 'hidden', !visible )
            .toggleClass( 'is-visible', !!visible );
    }

    function pickMetric( result, definition ) {
        var measurements = result.measurements || [];
        var calibrationEnabled = result.calibration && result.calibration.enabled === true;
        var metricReadyCount = 0;

        if ( calibrationEnabled ) {
            measurements.forEach( function ( measurement ) {
                var value = finiteNumber( measurement[ definition.mmKey ] );
                if ( value !== null && value > 0 ) {
                    metricReadyCount++;
                }
            } );
        }

        if ( calibrationEnabled && metricReadyCount >= Math.max( 3, measurements.length * 0.6 ) ) {
            return {
                key: definition.mmKey,
                unit: msg( definition.mmUnit ),
                digits: definition.mmDigits
            };
        }

        return {
            key: definition.pxKey,
            unit: msg( definition.pxUnit ),
            digits: definition.pxDigits
        };
    }

    function buildDistribution( result, metricKey ) {
        var definition = metricDefinitions[ metricKey ];
        var metric = pickMetric( result, definition );
        var values = ( result.measurements || [] )
            .filter( function ( measurement ) {
                return measurement.qc_outlier !== true;
            } )
            .map( function ( measurement ) {
                return finiteNumber( measurement[ metric.key ] );
            } )
            .filter( function ( value ) {
                return value !== null && value > 0;
            } )
            .sort( function ( a, b ) {
                return a - b;
            } );
        var mean;
        var variance;
        var min;
        var max;
        var binCount;
        var bins;
        var width;

        if ( !values.length ) {
            return null;
        }

        mean = values.reduce( function ( sum, value ) {
            return sum + value;
        }, 0 ) / values.length;
        variance = values.reduce( function ( sum, value ) {
            return sum + Math.pow( value - mean, 2 );
        }, 0 ) / values.length;
        min = values[ 0 ];
        max = values[ values.length - 1 ];
        binCount = values.length < 4 ? Math.max( 1, values.length ) :
            clamp( Math.round( Math.sqrt( values.length ) ), 4, 8 );
        bins = [];

        if ( min === max || binCount === 1 ) {
            bins.push( {
                start: min,
                end: max,
                count: values.length
            } );
        } else {
            width = ( max - min ) / binCount;
            for ( var index = 0; index < binCount; index++ ) {
                bins.push( {
                    start: min + width * index,
                    end: index === binCount - 1 ? max : min + width * ( index + 1 ),
                    count: 0
                } );
            }
            values.forEach( function ( value ) {
                var binIndex = clamp(
                    Math.floor( ( value - min ) / Math.max( width, Number.EPSILON ) ),
                    0,
                    bins.length - 1
                );
                bins[ binIndex ].count++;
            } );
        }

        return {
            key: metricKey,
            title: msg( definition.title ),
            color: definition.color,
            unit: metric.unit,
            digits: metric.digits,
            values: values,
            sampleCount: values.length,
            midpoint: percentile( values, 0.5 ),
            low: percentile( values, 0.1 ),
            high: percentile( values, 0.9 ),
            cvPct: mean > 0 ? Math.sqrt( variance ) * 100 / mean : 0,
            bins: bins
        };
    }

    function setFormValue( form, name, value ) {
        $( form ).find( '[name="' + name + '"]' ).val( value );
    }

    function calibrationPixels() {
        if ( !calibration.start || !calibration.end ) {
            return 0;
        }
        return Math.hypot(
            calibration.end.x - calibration.start.x,
            calibration.end.y - calibration.start.y
        );
    }

    function getCalibrationPoint( event ) {
        var image = document.getElementById( 'seedanalysis-calibration-image' );
        var rect;
        var x;
        var y;

        if ( !image || !image.naturalWidth || !image.naturalHeight ) {
            return null;
        }

        rect = image.getBoundingClientRect();
        if ( rect.width <= 0 || rect.height <= 0 ) {
            return null;
        }

        x = Math.max( 0, Math.min( rect.width, event.clientX - rect.left ) );
        y = Math.max( 0, Math.min( rect.height, event.clientY - rect.top ) );

        return {
            x: ( x / rect.width ) * image.naturalWidth,
            y: ( y / rect.height ) * image.naturalHeight
        };
    }

    function getNearestCalibrationHandle( point ) {
        var image = document.getElementById( 'seedanalysis-calibration-image' );
        var rect;
        var threshold;
        var startDistance;
        var endDistance;

        if ( !point || !image || !image.naturalWidth || !calibration.start || !calibration.end ) {
            return null;
        }

        rect = image.getBoundingClientRect();
        threshold = ( 16 / Math.max( 1, rect.width ) ) * image.naturalWidth;
        startDistance = Math.hypot( point.x - calibration.start.x, point.y - calibration.start.y );
        endDistance = Math.hypot( point.x - calibration.end.x, point.y - calibration.end.y );

        if ( Math.min( startDistance, endDistance ) > threshold ) {
            return null;
        }

        return startDistance <= endDistance ? 'start' : 'end';
    }

    function updateCalibrationOverlay() {
        var form = document.getElementById( 'seedanalysis-form' );
        var image = document.getElementById( 'seedanalysis-calibration-image' );
        var pixels = calibrationPixels();
        var hasLine = pixels > 1 && calibration.start && calibration.end &&
            image && image.naturalWidth && image.naturalHeight;
        var start;
        var end;

        if ( !form ) {
            return;
        }

        if ( hasLine ) {
            start = {
                x: ( calibration.start.x / image.naturalWidth ) * 100,
                y: ( calibration.start.y / image.naturalHeight ) * 100
            };
            end = {
                x: ( calibration.end.x / image.naturalWidth ) * 100,
                y: ( calibration.end.y / image.naturalHeight ) * 100
            };

            setFormValue( form, 'referencePixels', pixels.toFixed( 2 ) );
            setFormValue( form, 'referencePixelSpace', 'original' );
            setFormValue( form, 'referenceX1', calibration.start.x.toFixed( 2 ) );
            setFormValue( form, 'referenceY1', calibration.start.y.toFixed( 2 ) );
            setFormValue( form, 'referenceX2', calibration.end.x.toFixed( 2 ) );
            setFormValue( form, 'referenceY2', calibration.end.y.toFixed( 2 ) );

            $( '#seedanalysis-calibration-overlay' ).addClass( 'is-visible' );
            $( '#seedanalysis-reference-line' ).attr( {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y
            } );
            $( '#seedanalysis-reference-start' ).attr( {
                cx: start.x,
                cy: start.y
            } );
            $( '#seedanalysis-reference-end' ).attr( {
                cx: end.x,
                cy: end.y
            } );
            $( '#seedanalysis-reference-status' ).text(
                mw.msg( 'seedanalysis-reference-pixels-ready', formatNumber( pixels, 1 ) )
            );
        } else {
            setFormValue( form, 'referencePixelSpace', '' );
            setFormValue( form, 'referenceX1', '' );
            setFormValue( form, 'referenceY1', '' );
            setFormValue( form, 'referenceX2', '' );
            setFormValue( form, 'referenceY2', '' );
            $( '#seedanalysis-calibration-overlay' ).removeClass( 'is-visible' );
            $( '#seedanalysis-reference-status' ).text( msg( 'reference-empty' ) );
        }
    }

    function resetCalibration() {
        var form = document.getElementById( 'seedanalysis-form' );

        calibration = {
            start: null,
            end: null
        };
        drawingCalibration = false;
        draggingHandle = null;

        if ( form ) {
            setFormValue( form, 'referencePixels', '' );
        }
        setSuggestedReferenceNotice( false );
        updateCalibrationOverlay();
    }

    function applySuggestedReference( result ) {
        var suggestion = result && result.calibration && result.calibration.suggested_reference;
        var start;
        var end;

        if (
            !suggestion ||
            suggestion.available !== true ||
            ( result.calibration && result.calibration.enabled === true ) ||
            calibrationPixels() > 1
        ) {
            setSuggestedReferenceNotice( false );
            return false;
        }

        start = suggestedReferencePoint( suggestion, 'x1', 'y1' );
        end = suggestedReferencePoint( suggestion, 'x2', 'y2' );
        if ( !start || !end ) {
            setSuggestedReferenceNotice( false );
            return false;
        }

        calibration = {
            start: start,
            end: end
        };
        updateCalibrationOverlay();
        setSuggestedReferenceNotice( true );
        return true;
    }

    function setInputPreview( file ) {
        var requestId = ++inputPreviewRequest;
        var reader;

        resetCalibration();
        editRenderSequence++;
        currentResult = null;
        currentPreview = 'overlay';
        currentChartMetric = 'length';
        $( '#seedanalysis-result' ).empty().prop( 'hidden', true );
        setStatus( '', '' );
        setSuggestedReferenceNotice( false );
        $( '#seedanalysis-form' ).removeClass( 'seedanalysis-has-preview' );
        $( '#seedanalysis-input-preview' ).prop( 'hidden', true );
        $( '#seedanalysis-calibration-image' ).removeAttr( 'src' );

        if ( !file ) {
            return;
        }

        reader = new FileReader();
        reader.onload = function () {
            if ( requestId !== inputPreviewRequest || !reader.result ) {
                return;
            }
            $( '#seedanalysis-calibration-image' ).attr( 'src', reader.result );
            $( '#seedanalysis-input-preview' ).prop( 'hidden', false ).removeAttr( 'hidden' );
            $( '#seedanalysis-form' ).addClass( 'seedanalysis-has-preview' );
        };
        reader.onerror = function () {
            if ( requestId === inputPreviewRequest ) {
                setStatus( msg( 'error-preview' ), 'error' );
            }
        };
        reader.readAsDataURL( file );
    }

    function setStatus( text, type ) {
        var $status = $( '#seedanalysis-status' );
        $status
            .removeClass( 'is-error is-success is-loading' )
            .toggleClass( 'is-error', type === 'error' )
            .toggleClass( 'is-success', type === 'success' )
            .toggleClass( 'is-loading', type === 'loading' )
            .text( text || '' );
    }

    function previewField( mode ) {
        if ( mode === 'mask' ) {
            return 'mask_png_base64';
        }
        if ( mode === 'labels' ) {
            return 'labels_png_base64';
        }
        return 'overlay_png_base64';
    }

    function previewLabel( mode ) {
        if ( mode === 'mask' ) {
            return msg( 'preview-mask' );
        }
        if ( mode === 'labels' ) {
            return msg( 'preview-labels' );
        }
        return msg( 'preview-overlay' );
    }

    function renderCards( result ) {
        var summary = result.summary || {};
        var qc = summary.qc || {};
        var measurements = result.measurements || [];
        var detectedCount = finiteNumber(
            result.segmentation && result.segmentation.segment_count
        );
        var totalCount = finiteNumber( summary.count );
        var suspectCount = finiteNumber( qc.suspect_count );
        var validCount = finiteNumber( qc.inlier_count );

        if ( detectedCount === null ) {
            detectedCount = totalCount === null ? measurements.length : totalCount;
        }
        if ( totalCount === null ) {
            totalCount = measurements.length;
        }
        if ( suspectCount === null ) {
            suspectCount = measurements.filter( function ( measurement ) {
                return measurement.qc_outlier === true;
            } ).length;
        }
        if ( validCount === null ) {
            validCount = Math.max( 0, totalCount - suspectCount );
        }

        var cards = [
            [ msg( 'detected-count' ), formatNumber( detectedCount, 0 ) ],
            [ msg( 'valid-count' ), formatNumber( validCount, 0 ) ],
            [ msg( 'suspects' ), formatNumber( suspectCount, 0 ) ],
            [
                msg( 'length' ),
                measurementText(
                    summary.mean_length_mm,
                    summary.mean_length_px,
                    'mm',
                    2,
                    1
                )
            ],
            [
                msg( 'width' ),
                measurementText(
                    summary.mean_width_mm,
                    summary.mean_width_px,
                    'mm',
                    2,
                    1
                )
            ],
            [
                msg( 'area' ),
                measurementText(
                    summary.mean_area_mm2,
                    summary.mean_area_px,
                    'mm2',
                    3,
                    1
                )
            ],
            [
                msg( 'std-length' ),
                measurementText(
                    reportedStat( summary, 'std_length_mm', 'robust_std_length_mm' ),
                    reportedStat( summary, 'std_length_px', 'robust_std_length_px' ),
                    'mm',
                    2,
                    1
                )
            ],
            [
                msg( 'std-width' ),
                measurementText(
                    reportedStat( summary, 'std_width_mm', 'robust_std_width_mm' ),
                    reportedStat( summary, 'std_width_px', 'robust_std_width_px' ),
                    'mm',
                    2,
                    1
                )
            ],
            [
                msg( 'std-area' ),
                measurementText(
                    reportedStat( summary, 'std_area_mm2', 'robust_std_area_mm2' ),
                    reportedStat( summary, 'std_area_px', 'robust_std_area_px' ),
                    'mm2',
                    3,
                    1
                )
            ]
        ];

        return $( '<section>' )
            .addClass( 'seedanalysis-overview' )
            .append( $( '<h3>' ).text( msg( 'results-heading' ) ) )
            .append( $( '<p>' ).addClass( 'seedanalysis-section-help' ).text( msg( 'results-help' ) ) )
            .append( $( '<div>' )
            .addClass( 'seedanalysis-cards' )
            .append( cards.map( function ( card ) {
                return $( '<div>' )
                    .addClass( 'seedanalysis-card' )
                    .append(
                        $( '<span>' ).text( card[ 0 ] ),
                        $( '<strong>' ).text( card[ 1 ] )
                    );
            } ) ) );
    }

    function renderQcSummary( result ) {
        var summary = result.summary || {};
        var qc = summary.qc || {};
        var suspectCount = finiteNumber( qc.suspect_count ) || 0;
        var suspectIds = ( qc.suspect_ids || [] )
            .map( Number )
            .filter( Number.isFinite )
            .sort( function ( a, b ) {
                return a - b;
            } );
        var text;
        var type = 'is-ok';
        var suspectIdText;
        var $summary;

        if ( qc.robust_used_for_reporting === false ) {
            text = msg( 'qc-raw-warning' );
            type = 'is-warning';
        } else if ( suspectCount > 0 ) {
            text = mw.msg(
                'seedanalysis-qc-robust-note',
                formatNumber( suspectCount, 0 ),
                formatNumber( qc.inlier_count, 0 )
            );
            type = 'is-warning';
        } else {
            text = msg( 'qc-ok' );
        }

        $summary = $( '<div>' )
            .addClass( 'seedanalysis-qc-summary ' + type )
            .text( text );

        if ( suspectIds.length ) {
            suspectIdText = suspectIds.slice( 0, 8 ).map( function ( id ) {
                return '#' + id;
            } ).join( ', ' );
            if ( suspectIds.length > 8 ) {
                suspectIdText += ', ...';
            }

            $summary.append(
                ' ',
                $( '<span>' )
                    .addClass( 'seedanalysis-qc-suspect-ids' )
                    .text( mw.msg( 'seedanalysis-suspect-id-list', suspectIdText ) )
            );
        }

        return $summary;
    }

    function roundValue( value, digits ) {
        var factor = Math.pow( 10, digits );
        return Math.round( value * factor ) / factor;
    }

    function qualitySummary( measurements ) {
        var problemFlags = {
            loose_mask: true,
            touches_image_edge: true,
            extreme_aspect: true,
            partial_tile_mask: true
        };
        var flagCounts = {};
        var problemCount = 0;
        var labelConfusionCount;

        measurements.forEach( function ( measurement ) {
            String( measurement.quality_flags || '' )
                .split( ',' )
                .map( function ( flag ) {
                    return flag.trim();
                } )
                .filter( Boolean )
                .forEach( function ( flag ) {
                    flagCounts[ flag ] = ( flagCounts[ flag ] || 0 ) + 1;
                    if ( problemFlags[ flag ] ) {
                        problemCount++;
                    }
                } );
        } );

        labelConfusionCount = flagCounts.model_label_ref_as_seed || 0;
        return {
            flag_counts: flagCounts,
            problem_count: problemCount,
            problem_ratio: measurements.length ? roundValue( problemCount / measurements.length, 6 ) : 0,
            label_confusion_count: labelConfusionCount,
            label_confusion_ratio: measurements.length ?
                roundValue( labelConfusionCount / measurements.length, 6 ) : 0,
            review_required: problemCount > 0,
            status: problemCount > 0 ? 'review_required' : 'ok'
        };
    }

    function recomputeSummaryFromMeasurements( previousSummary, measurements ) {
        var summary = previousSummary || {};
        var previousQc = summary.qc || {};
        var inliers;
        var robustMeasurements;
        var suspectIds;
        var suspectRatio;
        var robustUsedForReporting;
        var calibrated;

        if ( !measurements.length ) {
            return $.extend( {}, summary, {
                count: 0,
                total_area_px: 0,
                mean_area_px: 0,
                mean_length_px: 0,
                mean_width_px: 0,
                mean_area_mm2: null,
                mean_length_mm: null,
                mean_width_mm: null,
                std_area_px: 0,
                std_length_px: 0,
                std_width_px: 0,
                std_area_mm2: null,
                std_length_mm: null,
                std_width_mm: null,
                robust_mean_area_px: 0,
                robust_mean_length_px: 0,
                robust_mean_width_px: 0,
                robust_mean_area_mm2: null,
                robust_mean_length_mm: null,
                robust_mean_width_mm: null,
                robust_std_area_px: 0,
                robust_std_length_px: 0,
                robust_std_width_px: 0,
                robust_std_area_mm2: null,
                robust_std_length_mm: null,
                robust_std_width_mm: null,
                cv_length_pct: 0,
                cv_width_pct: 0,
                qc: $.extend( {}, previousQc, {
                    suspect_count: 0,
                    inlier_count: 0,
                    suspect_ids: [],
                    review_required: false,
                    suspect_ratio: 0,
                    robust_used_for_reporting: true,
                    manual_override: true,
                    status: 'ok'
                } ),
                quality: qualitySummary( [] )
            } );
        }

        inliers = measurements.filter( function ( measurement ) {
            return measurement.qc_outlier !== true;
        } );
        robustMeasurements = inliers.length ? inliers : measurements;
        suspectIds = measurements
            .filter( function ( measurement ) {
                return measurement.qc_outlier === true;
            } )
            .map( function ( measurement ) {
                return Number( measurement.id );
            } )
            .filter( Number.isFinite )
            .sort( function ( a, b ) {
                return a - b;
            } );
        suspectRatio = suspectIds.length / measurements.length;
        robustUsedForReporting = suspectRatio <= 0.05;
        calibrated = measurements.some( function ( measurement ) {
            var value = finiteNumber( measurement.length_mm );
            return value !== null && value > 0;
        } );

        function values( items, key ) {
            return items.map( function ( item ) {
                return finiteNumber( item[ key ] ) || 0;
            } );
        }

        function mean( items, key ) {
            var data = values( items, key );
            return roundValue( data.reduce( function ( sum, value ) {
                return sum + value;
            }, 0 ) / Math.max( 1, data.length ), 6 );
        }

        function standardDeviation( items, key ) {
            var data = values( items, key );
            var average;
            var variance;
            if ( data.length <= 1 ) {
                return 0;
            }
            average = data.reduce( function ( sum, value ) {
                return sum + value;
            }, 0 ) / data.length;
            variance = data.reduce( function ( sum, value ) {
                return sum + Math.pow( value - average, 2 );
            }, 0 ) / ( data.length - 1 );
            return roundValue( Math.sqrt( variance ), 6 );
        }

        function coefficientOfVariation( items, key ) {
            var average = mean( items, key );
            return average > 0 ?
                roundValue( standardDeviation( items, key ) * 100 / average, 3 ) : 0;
        }

        function metricMm( statistic, items, key ) {
            return calibrated ? statistic( items, key ) : null;
        }

        return $.extend( {}, summary, {
            count: measurements.length,
            total_area_px: measurements.reduce( function ( sum, measurement ) {
                return sum + ( finiteNumber( measurement.area_px ) || 0 );
            }, 0 ),
            mean_area_px: mean( measurements, 'area_px' ),
            mean_length_px: mean( measurements, 'length_px' ),
            mean_width_px: mean( measurements, 'width_px' ),
            mean_area_mm2: metricMm( mean, measurements, 'area_mm2' ),
            mean_length_mm: metricMm( mean, measurements, 'length_mm' ),
            mean_width_mm: metricMm( mean, measurements, 'width_mm' ),
            std_area_px: standardDeviation( measurements, 'area_px' ),
            std_length_px: standardDeviation( measurements, 'length_px' ),
            std_width_px: standardDeviation( measurements, 'width_px' ),
            std_area_mm2: metricMm( standardDeviation, measurements, 'area_mm2' ),
            std_length_mm: metricMm( standardDeviation, measurements, 'length_mm' ),
            std_width_mm: metricMm( standardDeviation, measurements, 'width_mm' ),
            robust_mean_area_px: mean( robustMeasurements, 'area_px' ),
            robust_mean_length_px: mean( robustMeasurements, 'length_px' ),
            robust_mean_width_px: mean( robustMeasurements, 'width_px' ),
            robust_mean_area_mm2: metricMm( mean, robustMeasurements, 'area_mm2' ),
            robust_mean_length_mm: metricMm( mean, robustMeasurements, 'length_mm' ),
            robust_mean_width_mm: metricMm( mean, robustMeasurements, 'width_mm' ),
            robust_std_area_px: standardDeviation( robustMeasurements, 'area_px' ),
            robust_std_length_px: standardDeviation( robustMeasurements, 'length_px' ),
            robust_std_width_px: standardDeviation( robustMeasurements, 'width_px' ),
            robust_std_area_mm2: metricMm( standardDeviation, robustMeasurements, 'area_mm2' ),
            robust_std_length_mm: metricMm( standardDeviation, robustMeasurements, 'length_mm' ),
            robust_std_width_mm: metricMm( standardDeviation, robustMeasurements, 'width_mm' ),
            cv_length_pct: coefficientOfVariation( robustMeasurements, 'length_px' ),
            cv_width_pct: coefficientOfVariation( robustMeasurements, 'width_px' ),
            qc: $.extend( {}, previousQc, {
                suspect_count: suspectIds.length,
                inlier_count: inliers.length,
                suspect_ids: suspectIds,
                review_required: suspectIds.length > 0,
                suspect_ratio: roundValue( suspectRatio, 6 ),
                robust_used_for_reporting: robustUsedForReporting,
                manual_override: true,
                status: !robustUsedForReporting ?
                    'review_required' : ( suspectIds.length ? 'suspects_flagged' : 'ok' )
            } ),
            quality: qualitySummary( measurements )
        } );
    }

    function csvEscape( value ) {
        var text;
        if ( value === null || value === undefined ) {
            return '';
        }
        text = String( value );
        return /[",\n\r]/.test( text ) ? '"' + text.replace( /"/g, '""' ) + '"' : text;
    }

    function measurementsToCsv( measurements, existingCsv ) {
        var firstLine = String( existingCsv || '' ).split( /\r?\n/, 1 )[ 0 ];
        var columns = firstLine ? firstLine.split( ',' ) : [
            'id', 'area_px', 'length_px', 'width_px', 'area_mm2', 'length_mm',
            'width_mm', 'centroid_x', 'centroid_y', 'bbox_x', 'bbox_y', 'bbox_w',
            'bbox_h', 'angle_deg', 'solidity', 'extent', 'aspect_ratio', 'confidence',
            'class_id', 'class_name', 'detected_class_id', 'detected_class_name',
            'quality_flags', 'qc_outlier', 'qc_reason'
        ];

        [ 'qc_manual_override', 'qc_manual_decision' ].forEach( function ( column ) {
            if ( columns.indexOf( column ) === -1 ) {
                columns.push( column );
            }
        } );

        return [ columns.join( ',' ) ].concat( measurements.map( function ( measurement ) {
            return columns.map( function ( column ) {
                return csvEscape( measurement[ column ] );
            } ).join( ',' );
        } ) ).join( '\n' );
    }

    function confirmSuspectMeasurement( result, measurementId ) {
        var measurements = ( result.measurements || [] ).map( function ( measurement ) {
            if ( Number( measurement.id ) !== Number( measurementId ) ) {
                return $.extend( {}, measurement );
            }
            return $.extend( {}, measurement, {
                qc_outlier: false,
                qc_reason: '',
                qc_manual_override: true,
                qc_manual_decision: 'confirmed_grain'
            } );
        } );

        return $.extend( {}, result, {
            measurements: measurements,
            summary: recomputeSummaryFromMeasurements( result.summary, measurements ),
            csv: measurementsToCsv( measurements, result.csv )
        } );
    }

    function deleteMeasurement( result, measurementId ) {
        var deletedId = Number( measurementId );
        var segmentation = result.segmentation || {};
        var deletedIds = ( segmentation.manual_deleted_ids || [] )
            .map( Number )
            .filter( Number.isFinite );
        var measurements = ( result.measurements || [] )
            .filter( function ( measurement ) {
                return Number( measurement.id ) !== deletedId;
            } )
            .map( function ( measurement ) {
                return $.extend( {}, measurement );
            } );

        if ( deletedIds.indexOf( deletedId ) === -1 ) {
            deletedIds.push( deletedId );
        }

        return $.extend( {}, result, {
            measurements: measurements,
            summary: recomputeSummaryFromMeasurements( result.summary, measurements ),
            segmentation: $.extend( {}, segmentation, {
                segment_count: measurements.length,
                marker_count: measurements.length,
                manual_deleted_ids: deletedIds
            } ),
            csv: measurementsToCsv( measurements, result.csv )
        } );
    }

    function loadImageData( base64 ) {
        return new Promise( function ( resolve ) {
            var image = new Image();
            image.onload = function () {
                var canvas = document.createElement( 'canvas' );
                var context;
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                context = canvas.getContext( '2d', { willReadFrequently: true } );
                context.drawImage( image, 0, 0 );
                resolve( context.getImageData( 0, 0, canvas.width, canvas.height ) );
            };
            image.onerror = function () {
                resolve( null );
            };
            image.src = imageSrc( base64 );
        } );
    }

    function imageDataToBase64( imageData ) {
        var canvas = document.createElement( 'canvas' );
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        canvas.getContext( '2d' ).putImageData( imageData, 0, 0 );
        return canvas.toDataURL( 'image/png' ).split( ',' )[ 1 ] || '';
    }

    function renderLabelsPreview( baseImage, measurements ) {
        var canvas = document.createElement( 'canvas' );
        var context;
        canvas.width = baseImage.width;
        canvas.height = baseImage.height;
        context = canvas.getContext( '2d' );
        context.putImageData( baseImage, 0, 0 );
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        measurements.forEach( function ( measurement ) {
            var id = Number( measurement.id );
            var x = finiteNumber( measurement.centroid_x );
            var y = finiteNumber( measurement.centroid_y );
            var radius;
            if ( x === null ) {
                x = ( Number( measurement.bbox_x ) || 0 ) + ( Number( measurement.bbox_w ) || 0 ) / 2;
            }
            if ( y === null ) {
                y = ( Number( measurement.bbox_y ) || 0 ) + ( Number( measurement.bbox_h ) || 0 ) / 2;
            }
            if ( !Number.isFinite( id ) || !Number.isFinite( x ) || !Number.isFinite( y ) ) {
                return;
            }
            radius = Math.max( 13, Math.min( 26, ( Number( measurement.width_px ) || 20 ) * 0.45 ) );
            context.fillStyle = measurement.qc_outlier === true ? '#dc2626' : '#2563eb';
            context.beginPath();
            context.arc( x, y, radius, 0, Math.PI * 2 );
            context.fill();
            context.lineWidth = Math.max( 2, radius * 0.16 );
            context.strokeStyle = '#fff';
            context.stroke();
            context.fillStyle = '#fff';
            context.font = '700 ' + Math.max( 11, radius * 0.9 ) + 'px Arial, sans-serif';
            context.fillText( String( id ), x, y + 0.5 );
        } );

        return canvas.toDataURL( 'image/png' ).split( ',' )[ 1 ] || '';
    }

    function renderQcPreviewsFromLabelMap( result ) {
        var base64 = result.preprocessed_png_base64 || result.original_png_base64;
        if ( !result.label_map_png_base64 || !base64 ) {
            return Promise.resolve( result );
        }

        return Promise.all( [
            loadImageData( base64 ),
            loadImageData( result.label_map_png_base64 )
        ] ).then( function ( images ) {
            var baseImage = images[ 0 ];
            var labelMapImage = images[ 1 ];
            var outlierIds;
            var activeIds;
            var width;
            var height;
            var canvas;
            var context;
            var overlay;
            var mask;

            if ( !baseImage || !labelMapImage ||
                baseImage.width !== labelMapImage.width ||
                baseImage.height !== labelMapImage.height ) {
                return result;
            }

            outlierIds = new Set( result.measurements
                .filter( function ( measurement ) {
                    return measurement.qc_outlier === true;
                } )
                .map( function ( measurement ) {
                    return Number( measurement.id );
                } )
                .filter( Number.isFinite ) );
            activeIds = new Set( result.measurements
                .map( function ( measurement ) {
                    return Number( measurement.id );
                } )
                .filter( Number.isFinite ) );
            width = baseImage.width;
            height = baseImage.height;
            canvas = document.createElement( 'canvas' );
            canvas.width = width;
            canvas.height = height;
            context = canvas.getContext( '2d' );
            overlay = context.createImageData( width, height );
            overlay.data.set( baseImage.data );
            mask = context.createImageData( width, height );

            function labelAt( x, y ) {
                var offset = ( y * width + x ) * 4;
                return labelMapImage.data[ offset ] +
                    ( labelMapImage.data[ offset + 1 ] << 8 ) +
                    ( labelMapImage.data[ offset + 2 ] << 16 );
            }

            function isEdge( x, y, label ) {
                return x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
                    labelAt( x - 1, y ) !== label || labelAt( x + 1, y ) !== label ||
                    labelAt( x, y - 1 ) !== label || labelAt( x, y + 1 ) !== label;
            }

            for ( var y = 0; y < height; y++ ) {
                for ( var x = 0; x < width; x++ ) {
                    var label = labelAt( x, y );
                    var offset = ( y * width + x ) * 4;
                    var outlier;
                    var color;
                    var edge;
                    var alpha;
                    var maskColor;

                    if ( !label || !activeIds.has( label ) ) {
                        mask.data[ offset + 3 ] = 0;
                        if ( label && !activeIds.has( label ) ) {
                            labelMapImage.data[ offset ] = 0;
                            labelMapImage.data[ offset + 1 ] = 0;
                            labelMapImage.data[ offset + 2 ] = 0;
                            labelMapImage.data[ offset + 3 ] = 255;
                        }
                        continue;
                    }

                    outlier = outlierIds.has( label );
                    color = outlier ? [ 220, 38, 38 ] : [ 37, 99, 235 ];
                    edge = isEdge( x, y, label );
                    alpha = edge ? 0.56 : 0.34;
                    overlay.data[ offset ] = Math.round( overlay.data[ offset ] * ( 1 - alpha ) + color[ 0 ] * alpha );
                    overlay.data[ offset + 1 ] = Math.round( overlay.data[ offset + 1 ] * ( 1 - alpha ) + color[ 1 ] * alpha );
                    overlay.data[ offset + 2 ] = Math.round( overlay.data[ offset + 2 ] * ( 1 - alpha ) + color[ 2 ] * alpha );
                    overlay.data[ offset + 3 ] = 255;

                    maskColor = edge ?
                        ( outlier ? [ 185, 28, 28, 255 ] : [ 30, 64, 175, 255 ] ) :
                        ( outlier ? [ 239, 68, 68, 170 ] : [ 59, 130, 246, 145 ] );
                    mask.data[ offset ] = maskColor[ 0 ];
                    mask.data[ offset + 1 ] = maskColor[ 1 ];
                    mask.data[ offset + 2 ] = maskColor[ 2 ];
                    mask.data[ offset + 3 ] = maskColor[ 3 ];
                }
            }

            return $.extend( {}, result, {
                overlay_png_base64: imageDataToBase64( overlay ),
                mask_png_base64: imageDataToBase64( mask ),
                sam_mask_png_base64: '',
                labels_png_base64: renderLabelsPreview( baseImage, result.measurements ),
                label_map_png_base64: imageDataToBase64( labelMapImage )
            } );
        } );
    }

    function applyEditedResult( nextResult, successMessage ) {
        var renderSequence = ++editRenderSequence;
        currentResult = nextResult;
        currentPreview = 'overlay';
        renderResult( currentResult );
        setStatus( msg( 'edit-updating' ), 'loading' );

        renderQcPreviewsFromLabelMap( nextResult )
            .then( function ( renderedResult ) {
                if ( renderSequence !== editRenderSequence ) {
                    return;
                }
                currentResult = renderedResult;
                renderResult( currentResult );
                setStatus( successMessage, 'success' );
            } )
            .catch( function () {
                if ( renderSequence === editRenderSequence ) {
                    setStatus( msg( 'edit-preview-warning' ), 'error' );
                }
            } );
    }

    function renderSuspectEditor( result ) {
        var suspects = ( result.measurements || [] ).filter( function ( measurement ) {
            return measurement.qc_outlier === true;
        } );
        var $editor;
        var $list;

        if ( !suspects.length ) {
            return $();
        }

        $editor = $( '<section>' ).addClass( 'seedanalysis-suspect-editor' );
        $list = $( '<div>' ).addClass( 'seedanalysis-suspect-list' );

        suspects.forEach( function ( measurement ) {
            var useMm = finiteNumber( measurement.length_mm ) > 0;
            var length = useMm ? measurement.length_mm : measurement.length_px;
            var width = useMm ? measurement.width_mm : measurement.width_px;
            var unit = useMm ? msg( 'mm' ) : msg( 'px' );
            var $actions = $( '<div>' ).addClass( 'seedanalysis-suspect-actions' );

            $( '<button>' )
                .attr( {
                    type: 'button',
                    title: msg( 'confirm-grain' )
                } )
                .addClass( 'seedanalysis-confirm' )
                .text( msg( 'confirm' ) )
                .on( 'click', function () {
                    applyEditedResult(
                        confirmSuspectMeasurement( currentResult, measurement.id ),
                        msg( 'confirm-success' )
                    );
                } )
                .appendTo( $actions );

            $( '<button>' )
                .attr( {
                    type: 'button',
                    title: msg( 'delete-detection' )
                } )
                .addClass( 'seedanalysis-delete' )
                .text( msg( 'delete' ) )
                .on( 'click', function () {
                    applyEditedResult(
                        deleteMeasurement( currentResult, measurement.id ),
                        msg( 'delete-success' )
                    );
                } )
                .appendTo( $actions );

            $( '<div>' )
                .addClass( 'seedanalysis-suspect-row' )
                .append(
                    $( '<strong>' ).text( '#' + measurement.id ),
                    $( '<span>' ).text(
                        formatNumber( length, useMm ? 2 : 1 ) + ' × ' +
                        formatNumber( width, useMm ? 2 : 1 ) + ' ' + unit
                    ),
                    $actions
                )
                .appendTo( $list );
        } );

        return $editor.append(
            $( '<h3>' ).text( msg( 'edit-suspects' ) ),
            $( '<p>' ).addClass( 'seedanalysis-section-help' ).text( msg( 'edit-suspects-help' ) ),
            $list
        );
    }

    function renderPreview( result ) {
        var $preview = $( '<div>' ).addClass( 'seedanalysis-preview' );
        var modes = [ 'overlay', 'mask', 'labels' ];
        var $tabs = $( '<div>' ).addClass( 'seedanalysis-tabs' );
        var $imageWrap = $( '<div>' ).addClass( 'seedanalysis-image-wrap' );
        var src = imageSrc( result[ previewField( currentPreview ) ] );

        modes.forEach( function ( mode ) {
            $( '<button>' )
                .attr( 'type', 'button' )
                .toggleClass( 'is-active', currentPreview === mode )
                .text( previewLabel( mode ) )
                .on( 'click', function () {
                    currentPreview = mode;
                    renderResult( currentResult );
                } )
                .appendTo( $tabs );
        } );

        if ( src ) {
            $imageWrap.append(
                $( '<img>' )
                    .attr( 'src', src )
                    .attr( 'alt', previewLabel( currentPreview ) )
            );
        } else {
            $imageWrap.append( $( '<p>' ).text( msg( 'no-preview' ) ) );
        }

        return $preview.append( $tabs, $imageWrap );
    }

    function buildSizeGroups( distribution ) {
        var counts = {
            small: 0,
            typical: 0,
            large: 0
        };

        distribution.values.forEach( function ( value ) {
            var ratio = value / distribution.midpoint;
            if ( ratio < 0.9 ) {
                counts.small++;
            } else if ( ratio <= 1.1 ) {
                counts.typical++;
            } else {
                counts.large++;
            }
        } );

        return [
            { key: 'small', label: msg( 'size-small' ), color: '#60a5fa' },
            { key: 'typical', label: msg( 'size-typical' ), color: '#2f6b4f' },
            { key: 'large', label: msg( 'size-large' ), color: '#f59e0b' }
        ].map( function ( group ) {
            group.count = counts[ group.key ];
            group.pct = distribution.sampleCount ? group.count * 100 / distribution.sampleCount : 0;
            return group;
        } );
    }

    function renderSizeGroups( distribution ) {
        var groups = buildSizeGroups( distribution );
        var $root = $( '<div>' ).addClass( 'seedanalysis-size-groups' );
        var $bar = $( '<div>' ).addClass( 'seedanalysis-segment-bar' );
        var $rows = $( '<div>' ).addClass( 'seedanalysis-size-group-rows' );

        groups.forEach( function ( group ) {
            $( '<span>' )
                .css( {
                    width: group.pct + '%',
                    backgroundColor: group.color
                } )
                .appendTo( $bar );

            $( '<div>' )
                .addClass( 'seedanalysis-size-group-row' )
                .append(
                    $( '<i>' ).css( 'background-color', group.color ),
                    $( '<span>' ).text( group.label ),
                    $( '<strong>' ).text(
                        group.count + ' ' + msg( 'grains' ) +
                        ' (' + formatNumber( group.pct, 1 ) + '%)'
                    )
                )
                .appendTo( $rows );
        } );

        return $root.append(
            $( '<h5>' ).text( msg( 'size-groups' ) ),
            $bar,
            $rows
        );
    }

    function renderHistogram( distribution ) {
        var maxCount = Math.max.apply( null, distribution.bins.map( function ( bin ) {
            return bin.count;
        } ).concat( [ 1 ] ) );
        var $chart = $( '<div>' )
            .addClass( 'seedanalysis-histogram' )
            .css( 'grid-template-columns', 'repeat(' + distribution.bins.length + ', minmax(0, 1fr))' );

        distribution.bins.forEach( function ( bin ) {
            var range = bin.start === bin.end ?
                formatNumber( bin.start, distribution.digits ) :
                formatNumber( bin.start, distribution.digits ) + '-' +
                    formatNumber( bin.end, distribution.digits );
            var height = Math.max( 6, bin.count * 118 / maxCount );

            $( '<div>' )
                .addClass( 'seedanalysis-histogram-bin' )
                .attr( 'title', range + ' ' + distribution.unit + ': ' + bin.count + ' ' + msg( 'grains' ) )
                .append(
                    $( '<strong>' ).text( bin.count ),
                    $( '<span>' )
                        .addClass( 'seedanalysis-histogram-bar' )
                        .css( {
                            height: height + 'px',
                            backgroundColor: distribution.color
                        } ),
                    $( '<small>' ).text( formatNumber( bin.start, distribution.digits ) + '+' )
                )
                .appendTo( $chart );
        } );

        return $chart;
    }

    function statisticTile( label, value, helper ) {
        var $tile = $( '<div>' )
            .addClass( 'seedanalysis-stat-tile' )
            .append(
                $( '<span>' ).text( label ),
                $( '<strong>' ).text( value )
            );
        if ( helper ) {
            $tile.append( $( '<small>' ).text( helper ) );
        }
        return $tile;
    }

    function renderMetricPanel( result, metricKey ) {
        var distribution = buildDistribution( result, metricKey );
        var $panel = $( '<article>' ).addClass( 'seedanalysis-metric-panel' );

        if ( !distribution ) {
            return $panel.append( $( '<p>' ).text( msg( 'no-chart-data' ) ) );
        }

        return $panel.append(
            $( '<div>' )
                .addClass( 'seedanalysis-metric-heading' )
                .append(
                    $( '<h4>' ).text( distribution.title ),
                    $( '<span>' ).text(
                        distribution.sampleCount + ' ' + msg( 'valid-sample' )
                    )
                ),
            $( '<div>' )
                .addClass( 'seedanalysis-stat-tiles' )
                .append(
                    statisticTile(
                        msg( 'typical-size' ),
                        formatNumber( distribution.midpoint, distribution.digits ) + ' ' + distribution.unit,
                        msg( 'median-help' )
                    ),
                    statisticTile(
                        msg( 'common-range' ),
                        formatNumber( distribution.low, distribution.digits ) + '-' +
                            formatNumber( distribution.high, distribution.digits ) + ' ' + distribution.unit,
                        msg( 'common-range-help' )
                    ),
                    statisticTile(
                        msg( 'variation' ),
                        formatNumber( distribution.cvPct, 1 ) + '%',
                        msg( 'variation-help' )
                    )
                ),
            renderSizeGroups( distribution ),
            $( '<div>' )
                .addClass( 'seedanalysis-chart-block' )
                .append(
                    $( '<h5>' ).text( msg( 'distribution-chart' ) ),
                    $( '<p>' ).text( msg( 'distribution-chart-help' ) ),
                    renderHistogram( distribution )
                )
        );
    }

    function renderStatistics( result ) {
        var metricKeys = currentChartMetric === 'all' ?
            [ 'length', 'width', 'area' ] : [ currentChartMetric ];
        var $section = $( '<section>' ).addClass( 'seedanalysis-statistics' );
        var $controls = $( '<div>' ).addClass( 'seedanalysis-chart-controls' );
        var $panels = $( '<div>' ).addClass( 'seedanalysis-chart-panels' );

        [ 'length', 'width', 'area', 'all' ].forEach( function ( metricKey ) {
            $( '<button>' )
                .attr( 'type', 'button' )
                .toggleClass( 'is-active', currentChartMetric === metricKey )
                .text( msg( 'metric-' + metricKey ) )
                .on( 'click', function () {
                    currentChartMetric = metricKey;
                    renderResult( currentResult );
                } )
                .appendTo( $controls );
        } );

        metricKeys.forEach( function ( metricKey ) {
            $panels.append( renderMetricPanel( result, metricKey ) );
        } );

        return $section.append(
            $( '<h3>' ).text( msg( 'statistics-heading' ) ),
            $( '<p>' ).addClass( 'seedanalysis-section-help' ).text( msg( 'statistics-help' ) ),
            $controls,
            $panels
        );
    }

    function downloadCsv( csv ) {
        var blob = new Blob( [ csv ], { type: 'text/csv;charset=utf-8' } );
        var url = URL.createObjectURL( blob );
        var link = document.createElement( 'a' );
        link.href = url;
        link.download = 'seed-analysis.csv';
        document.body.appendChild( link );
        link.click();
        link.remove();
        URL.revokeObjectURL( url );
    }

    function downloadBase64Png( base64, filename ) {
        var link = document.createElement( 'a' );
        link.href = imageSrc( base64 );
        link.download = filename;
        document.body.appendChild( link );
        link.click();
        link.remove();
    }

    function referenceRow( label, value ) {
        return $( '<div>' )
            .addClass( 'seedanalysis-reference-row' )
            .append(
                $( '<span>' ).text( label ),
                $( '<strong>' ).text( value )
            );
    }

    function renderReferenceSummary( result ) {
        var pixels = calibrationPixels();
        var millimeters = formNumberValue( 'referenceMm' );
        var calibrationReady = pixels > 1 && millimeters > 0;
        var segmentCount = finiteNumber( result.segmentation && result.segmentation.segment_count );
        var summaryCount = finiteNumber( result.summary && result.summary.count );
        var totalMeasured = segmentCount !== null ? segmentCount : summaryCount;
        var runId = result.run && result.run.id ?
            String( result.run.id ).slice( -8 ).toUpperCase() :
            '-';

        return $( '<section>' )
            .addClass( 'seedanalysis-reference-summary' )
            .append(
                $( '<div>' )
                    .addClass( 'seedanalysis-reference-group' )
                    .append(
                        $( '<h3>' ).text( msg( 'reference-settings' ) ),
                        $( '<div>' )
                            .addClass( 'seedanalysis-reference-rows' )
                            .append(
                                referenceRow(
                                    msg( 'measurement-unit' ),
                                    calibrationReady ? msg( 'millimeter-unit' ) : msg( 'pixel-unit' )
                                ),
                                referenceRow(
                                    msg( 'scale-ratio' ),
                                    calibrationReady ?
                                        formatNumber( pixels, 1 ) + ' ' + msg( 'px' ) + ' = ' +
                                            formatNumber( millimeters, 2 ) + ' ' + msg( 'mm' ) :
                                        msg( 'not-set' )
                                )
                            )
                    ),
                $( '<div>' )
                    .addClass( 'seedanalysis-reference-group' )
                    .append(
                        $( '<h3>' ).text( msg( 'analysis-result' ) ),
                        $( '<div>' )
                            .addClass( 'seedanalysis-reference-rows' )
                            .append(
                                referenceRow( msg( 'run-id' ), runId ),
                                referenceRow(
                                    msg( 'total-measured-grains' ),
                                    totalMeasured !== null ? formatNumber( totalMeasured, 0 ) : '-'
                                )
                            )
                    )
            );
    }

    function renderResult( result ) {
        if ( !result ) {
            return;
        }

        var $result = $( '#seedanalysis-result' ).empty().prop( 'hidden', false );
        var $actions = $( '<div>' ).addClass( 'seedanalysis-actions' );
        var $summary = $( '<div>' ).addClass( 'seedanalysis-result-summary' );
        var $media = $( '<div>' ).addClass( 'seedanalysis-result-media' );

        if ( result.csv ) {
            $( '<button>' )
                .attr( 'type', 'button' )
                .addClass( 'seedanalysis-secondary' )
                .text( msg( 'download-csv' ) )
                .on( 'click', function () {
                    downloadCsv( result.csv );
                } )
                .appendTo( $actions );
        }

        if ( result.overlay_png_base64 ) {
            $( '<button>' )
                .attr( 'type', 'button' )
                .addClass( 'seedanalysis-secondary' )
                .text( msg( 'download-result-image' ) )
                .on( 'click', function () {
                    downloadBase64Png( result.overlay_png_base64, 'seed-analysis-result.png' );
                } )
                .appendTo( $actions );
        }

        $summary.append(
            renderReferenceSummary( result ),
            renderCards( result ),
            renderQcSummary( result ),
            renderSuspectEditor( result ),
            $actions
        );
        $media.append( renderPreview( result ) );

        $result.append(
            $( '<div>' )
                .addClass( 'seedanalysis-result-grid' )
                .append( $media, $summary ),
            renderStatistics( result )
        );
    }

    function appendOptionalNumber( formData, form, name ) {
        var value = $( form ).find( '[name="' + name + '"]' ).val();
        if ( value !== '' && Number( value ) > 0 ) {
            formData.append( name, value );
        }
    }

    function appendCalibration( formData, form ) {
        var pixels = calibrationPixels();

        if ( pixels > 1 && calibration.start && calibration.end ) {
            formData.append( 'referencePixels', String( pixels ) );
            formData.append( 'referencePixelSpace', 'original' );
            formData.append( 'referenceX1', String( calibration.start.x ) );
            formData.append( 'referenceY1', String( calibration.start.y ) );
            formData.append( 'referenceX2', String( calibration.end.x ) );
            formData.append( 'referenceY2', String( calibration.end.y ) );
        } else {
            appendOptionalNumber( formData, form, 'referencePixels' );
        }

        appendOptionalNumber( formData, form, 'referenceMm' );
    }

    function analyze( form ) {
        var input = document.getElementById( 'seedanalysis-image' );
        if ( !input || !input.files || !input.files[ 0 ] ) {
            setStatus( msg( 'error-no-image' ), 'error' );
            if ( input ) {
                input.focus();
            }
            return;
        }

        var formData = new FormData();
        formData.append( 'image', input.files[ 0 ] );
        appendCalibration( formData, form );

        setStatus( msg( 'analyzing' ), 'loading' );
        $( '#seedanalysis-submit' ).prop( 'disabled', true ).text( msg( 'analyzing' ) );

        fetch( config.analyzeUrl, {
            method: 'POST',
            body: formData
        } )
            .then( function ( response ) {
                return response.json().then( function ( payload ) {
                    if ( !response.ok || payload.success === false ) {
                        throw new Error( payload.message || msg( 'error-service' ) );
                    }
                    return payload;
                } );
            } )
            .then( function ( payload ) {
                currentResult = payload.data || {};
                currentPreview = currentResult.overlay_png_base64 ? 'overlay' : 'mask';
                applySuggestedReference( currentResult );
                renderResult( currentResult );
                setStatus( payload.message || '', 'success' );
            } )
            .catch( function ( error ) {
                setStatus( error.message || msg( 'error-service' ), 'error' );
            } )
            .finally( function () {
                $( '#seedanalysis-submit' ).prop( 'disabled', false ).text( msg( 'analyze' ) );
            } );
    }

    function init() {
        if ( !document.getElementById( 'seedanalysis-root' ) ) {
            return;
        }

        if ( config.playStoreUrl ) {
            $( '.seedanalysis-app-link' ).attr( 'href', config.playStoreUrl );
        }

        $( document )
            .off( 'change.seedAnalysis', '#seedanalysis-image' )
            .on( 'change.seedAnalysis', '#seedanalysis-image', function () {
                setInputPreview( this.files && this.files[ 0 ] );
            } );

        var imageInput = document.getElementById( 'seedanalysis-image' );
        if ( imageInput && imageInput.files && imageInput.files[ 0 ] ) {
            setInputPreview( imageInput.files[ 0 ] );
        }

        $( '#seedanalysis-calibration-image' ).on( 'load', function () {
            updateCalibrationOverlay();
        } );

        $( '#seedanalysis-calibration-stage' )
            .on( 'pointerdown', function ( event ) {
                var nativeEvent = event.originalEvent || event;
                var point;
                var handle;

                if ( nativeEvent.button !== undefined && nativeEvent.button !== 0 ) {
                    return;
                }

                point = getCalibrationPoint( nativeEvent );
                if ( !point ) {
                    return;
                }

                event.preventDefault();
                setSuggestedReferenceNotice( false );
                if ( this.setPointerCapture && nativeEvent.pointerId !== undefined ) {
                    this.setPointerCapture( nativeEvent.pointerId );
                }

                handle = getNearestCalibrationHandle( point );
                if ( handle ) {
                    draggingHandle = handle;
                    return;
                }

                drawingCalibration = true;
                draggingHandle = null;
                calibration = {
                    start: point,
                    end: point
                };
                updateCalibrationOverlay();
            } )
            .on( 'pointermove', function ( event ) {
                var nativeEvent = event.originalEvent || event;
                var point;

                if ( !drawingCalibration && !draggingHandle ) {
                    return;
                }

                point = getCalibrationPoint( nativeEvent );
                if ( !point ) {
                    return;
                }

                event.preventDefault();
                if ( draggingHandle ) {
                    calibration[ draggingHandle ] = point;
                } else {
                    calibration.end = point;
                }
                updateCalibrationOverlay();
            } )
            .on( 'pointerup pointercancel', function ( event ) {
                var nativeEvent = event.originalEvent || event;

                drawingCalibration = false;
                draggingHandle = null;
                if (
                    this.releasePointerCapture &&
                    nativeEvent.pointerId !== undefined &&
                    this.hasPointerCapture &&
                    this.hasPointerCapture( nativeEvent.pointerId )
                ) {
                    this.releasePointerCapture( nativeEvent.pointerId );
                }
                updateCalibrationOverlay();
            } );

        $( '#seedanalysis-clear-reference' ).on( 'click', function () {
            resetCalibration();
        } );

        $( '#seedanalysis-form' ).on( 'submit', function ( event ) {
            event.preventDefault();
            analyze( this );
        } );
    }

    $( init );
}( jQuery, mediaWiki ) );
