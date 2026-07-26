import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { grainDefaultParams, grainParamFields } from '../config/grain.defaults.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = path.dirname( __filename );
const serviceRoot = path.resolve( __dirname, '..', '..' );
const workerScript = path.join( serviceRoot, 'python', 'analyze_grains.py' );

const PYTHON_TIMEOUT_MS = parseInt( process.env.GRAIN_PROCESS_TIMEOUT_MS || '300000', 10 );

const requestOverrideFields = new Set( [
    ...Object.keys( grainDefaultParams ),
    ...grainParamFields.numeric,
    ...grainParamFields.boolean,
    ...grainParamFields.string
] );

export const analyzeGrainImageBuffer = async ( { buffer, originalName, params } ) => {
    if ( !buffer?.length ) {
        const error = new Error( 'Không có dữ liệu ảnh đầu vào' );
        error.statusCode = 400;
        throw error;
    }

    const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'wikicrop-seed-' ) );
    const imagePath = path.join( tempDir, `input${ safeExtension( originalName ) }` );

    try {
        await fs.promises.writeFile( imagePath, buffer );
        const normalized = normalizeGrainParams( params );
        const payload = await runPythonWorker( imagePath, normalized );

        if ( !payload.ok ) {
            const error = new Error( payload.error || 'Phân tích ảnh thất bại' );
            error.statusCode = 422;
            throw error;
        }

        return payload.data;
    } finally {
        fs.promises.rm( tempDir, { recursive: true, force: true } ).catch( () => {} );
    }
};

export const getGrainWorkerInfo = () => ( {
    python: resolvePythonExecutable(),
    workerScript,
    timeoutMs: PYTHON_TIMEOUT_MS,
    defaultParams: grainDefaultParams
} );

export const normalizeGrainParams = ( params = {} ) => {
    const normalized = { ...grainDefaultParams };

    for ( const [ key, value ] of Object.entries( params ) ) {
        if ( value === undefined || value === null || value === '' ) {
            continue;
        }
        if ( !requestOverrideFields.has( key ) ) {
            continue;
        }

        if ( grainParamFields.numeric.has( key ) ) {
            const parsed = Number( value );
            if ( Number.isFinite( parsed ) ) {
                normalized[ key ] = parsed;
            }
            continue;
        }

        if ( grainParamFields.boolean.has( key ) ) {
            normalized[ key ] = value === true || value === 'true' || value === '1' || value === 1;
            continue;
        }

        if ( grainParamFields.string.has( key ) ) {
            normalized[ key ] = String( value ).trim();
        }
    }

    return normalized;
};

const runPythonWorker = ( imagePath, params ) => new Promise( ( resolve, reject ) => {
    const python = resolvePythonExecutable();
    const child = spawn( python, [
        workerScript,
        '--image',
        imagePath,
        '--params-json',
        JSON.stringify( params )
    ], {
        cwd: serviceRoot,
        windowsHide: true
    } );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout( () => {
        settled = true;
        child.kill( 'SIGKILL' );
        const error = new Error( 'Xử lý ảnh quá thời gian cho phép' );
        error.statusCode = 504;
        reject( error );
    }, PYTHON_TIMEOUT_MS );

    child.stdout.on( 'data', ( chunk ) => {
        stdout += chunk.toString( 'utf8' );
    } );

    child.stderr.on( 'data', ( chunk ) => {
        stderr += chunk.toString( 'utf8' );
    } );

    child.on( 'error', ( err ) => {
        if ( settled ) {
            return;
        }
        settled = true;
        clearTimeout( timer );
        const error = new Error( `Không chạy được Python worker: ${ err.message }` );
        error.statusCode = 500;
        reject( error );
    } );

    child.on( 'close', ( code ) => {
        if ( settled ) {
            return;
        }
        settled = true;
        clearTimeout( timer );

        try {
            const jsonStart = stdout.indexOf( '{"ok"' );
            const jsonText = jsonStart >= 0 ? stdout.slice( jsonStart ) : stdout;
            const parsed = JSON.parse( jsonText || '{}' );
            if ( code !== 0 && parsed?.error ) {
                const error = new Error( `${ parsed.error }${ stderr ? ` (${ stderr.trim() })` : '' }` );
                error.statusCode = 422;
                reject( error );
                return;
            }
            resolve( parsed );
        } catch {
            const error = new Error(
                `Python worker trả dữ liệu không hợp lệ${ stderr ? `: ${ stderr.trim() }` : '' }`
            );
            error.statusCode = 500;
            reject( error );
        }
    } );
} );

const safeExtension = ( name = '' ) => {
    const ext = path.extname( name ).toLowerCase();
    if ( [ '.jpg', '.jpeg', '.png' ].includes( ext ) ) {
        return ext;
    }
    return '.png';
};

const resolvePythonExecutable = () => {
    if ( process.env.GRAIN_PYTHON_BIN ) {
        return process.env.GRAIN_PYTHON_BIN;
    }

    const winVenv = path.join( serviceRoot, '.venv', 'Scripts', 'python.exe' );
    const posixVenv = path.join( serviceRoot, '.venv', 'bin', 'python' );
    if ( isUsablePython( winVenv ) ) {
        return winVenv;
    }
    if ( isUsablePython( posixVenv ) ) {
        return posixVenv;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
};

const isUsablePython = ( candidate ) => {
    if ( !fs.existsSync( candidate ) ) {
        return false;
    }
    const result = spawnSync( candidate, [ '--version' ], {
        windowsHide: true,
        timeout: 3000,
        stdio: 'ignore'
    } );
    return result.status === 0;
};
