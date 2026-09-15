import cors from 'cors';
import express from 'express';
import multer from 'multer';

import {
    analyzeGrainImageBuffer,
    getGrainWorkerInfo,
    normalizeGrainParams
} from './services/grainProcessing.service.js';
import { sendError, sendSuccess } from './utils/response.js';

const app = express();
const port = parseInt( process.env.PORT || '3001', 10 );

const upload = multer( {
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024
    },
    fileFilter: ( _req, file, cb ) => {
        if ( [ 'image/jpeg', 'image/png' ].includes( file.mimetype ) ) {
            cb( null, true );
            return;
        }
        const error = new Error( 'Chỉ hỗ trợ ảnh JPG hoặc PNG' );
        error.statusCode = 400;
        cb( error );
    }
} );

const corsOrigins = String( process.env.SEED_ANALYSIS_ALLOWED_ORIGINS || '*' )
    .split( ',' )
    .map( ( item ) => item.trim() )
    .filter( Boolean );

app.use( corsOrigins.includes( '*' ) ? cors() : cors( { origin: corsOrigins } ) );
app.use( express.json( { limit: '1mb' } ) );
app.use( express.urlencoded( { extended: true } ) );

app.get( '/', ( _req, res ) => {
    res.type( 'html' ).send( `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SeedAnalysis service test</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f6f8f4; color: #202122; }
    main { max-width: 1000px; margin: 0 auto; }
    .panel { background: #fff; border: 1px solid #c8ccd1; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    button { background: #36c; color: #fff; border: 0; border-radius: 4px; padding: 9px 14px; font-weight: 700; cursor: pointer; }
    button:disabled { background: #a2a9b1; cursor: wait; }
    img { display: block; max-width: 100%; height: auto; border: 1px solid #c8ccd1; border-radius: 6px; background: #fff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .metric { background: #f8f9fa; border: 1px solid #eaecf0; border-radius: 6px; padding: 10px; }
    .metric strong { display: block; font-size: 20px; margin-top: 4px; }
    .status { min-height: 22px; margin-top: 10px; }
    .error { color: #b32424; }
    .ok { color: #14866d; }
  </style>
</head>
<body>
<main>
  <h1>SeedAnalysis service test</h1>
  <p>Trang này chỉ dùng để test service khi web WikiCrop/Apache chưa chạy. Module MediaWiki thật nằm ở <code>Special:SeedAnalysis</code>.</p>
  <section class="panel">
    <input id="image" type="file" accept="image/jpeg,image/png">
    <button id="submit" type="button">Analyze</button>
    <div id="status" class="status"></div>
  </section>
  <section id="result" class="panel" hidden></section>
</main>
<script>
const imageInput = document.getElementById('image');
const submit = document.getElementById('submit');
const statusEl = document.getElementById('status');
const result = document.getElementById('result');

function fmt(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';
}

submit.addEventListener('click', async () => {
  if (!imageInput.files[0]) {
    statusEl.className = 'status error';
    statusEl.textContent = 'Choose a JPG or PNG image first.';
    return;
  }
  const form = new FormData();
  form.append('image', imageInput.files[0]);
  submit.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = 'Analyzing...';
  result.hidden = true;
  result.innerHTML = '';
  try {
    const response = await fetch('/api/grain/analyze-public', { method: 'POST', body: form });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(payload.message || 'Analyze failed');
    const data = payload.data || {};
    const summary = data.summary || {};
    const qc = summary.qc || {};
    result.innerHTML = \`
      <div class="grid">
        <div class="metric">Count<strong>\${fmt(summary.count, 0)}</strong></div>
        <div class="metric">Length<strong>\${fmt(summary.mean_length_px, 1)} px</strong></div>
        <div class="metric">Width<strong>\${fmt(summary.mean_width_px, 1)} px</strong></div>
        <div class="metric">QC<strong>\${qc.status || '-'}</strong></div>
      </div>
      <h2>Overlay</h2>
      <img alt="Overlay" src="data:image/png;base64,\${data.overlay_png_base64 || ''}">
    \`;
    result.hidden = false;
    statusEl.className = 'status ok';
    statusEl.textContent = payload.message || 'Done';
  } catch (err) {
    statusEl.className = 'status error';
    statusEl.textContent = err.message || String(err);
  } finally {
    submit.disabled = false;
  }
});
</script>
</body>
</html>` );
} );

app.get( '/health', ( _req, res ) => {
    sendSuccess( res, { status: 'ok', service: 'wikicrop-seed-analysis' } );
} );

app.get( '/api/grain/health', ( _req, res ) => {
    sendSuccess( res, getGrainWorkerInfo(), 'Grain analysis worker configured' );
} );

const analyzePublic = async ( req, res ) => {
    try {
        if ( !req.file ) {
            return sendError( res, 'Image upload is required with field name image', 400 );
        }

        const params = normalizeGrainParams( req.body );
        const result = await analyzeGrainImageBuffer( {
            buffer: req.file.buffer,
            originalName: req.file.originalname,
            params
        } );

        return sendSuccess( res, {
            ...compactAnalyzeResponse( result ),
            run: {
                id: `local-${ Date.now() }`,
                sourceFileName: req.file.originalname || 'image.png',
                params,
                image: result.image || {},
                summary: result.summary || {},
                segmentation: result.segmentation || {},
                calibration: result.calibration || {},
                features: result.features || {},
                localOnly: true,
                createdAt: new Date().toISOString()
            }
        }, 'Analysis completed without server storage' );
    } catch ( err ) {
        return sendError( res, err.message || 'Image analysis failed', err.statusCode || 500 );
    }
};

app.post( '/api/grain/analyze-public', upload.single( 'image' ), analyzePublic );
app.post( '/api/grain/analyze', upload.single( 'image' ), analyzePublic );

app.use( ( _req, res ) => {
    sendError( res, 'Not found', 404 );
} );

app.use( ( err, _req, res, _next ) => {
    sendError( res, err.message || 'Unexpected server error', err.statusCode || 500 );
} );

app.listen( port, () => {
    console.log( `SeedAnalysis service listening on http://localhost:${ port }` );
} );

const compactAnalyzeResponse = ( result ) => ( {
    image: result.image || {},
    features: result.features || {},
    segmentation: result.segmentation || {},
    calibration: result.calibration || {},
    summary: result.summary || {},
    measurements: result.measurements || [],
    csv: result.csv || '',
    original_png_base64: result.original_png_base64 || '',
    overlay_png_base64: result.overlay_png_base64 || '',
    sam_mask_png_base64: result.sam_mask_png_base64 || '',
    preprocessed_png_base64: result.preprocessed_png_base64 || '',
    mask_png_base64: result.mask_png_base64 || '',
    labels_png_base64: result.labels_png_base64 || '',
    label_map_png_base64: result.label_map_png_base64 || ''
} );
