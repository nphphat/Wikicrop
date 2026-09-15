<?php

// Copy these lines into the real LocalSettings.php when you want to enable
// the SeedAnalysis module locally.
wfLoadExtension( 'SeedAnalysis' );

// Local service started from extensions/SeedAnalysis/service:
//   npm install
//   $env:PORT='3001'
//   $env:GRAIN_PYTHON_BIN='.venv\Scripts\python.exe'
//   npm start
$wgSeedAnalysisApiUrl = getenv( 'SEED_ANALYSIS_API_URL' ) ?: 'http://127.0.0.1:3001/api';

// Optional public mobile listing URL shown in Special:SeedAnalysis.
$wgSeedAnalysisPlayStoreUrl = '';
