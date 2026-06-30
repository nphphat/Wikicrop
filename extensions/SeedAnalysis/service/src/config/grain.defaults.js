import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath( import.meta.url );
const __dirname = path.dirname( __filename );
const settingsPath = path.resolve( __dirname, '..', '..', 'config', 'grain.settings.json' );

export const grainSettings = Object.freeze(
    JSON.parse( fs.readFileSync( settingsPath, 'utf8' ) )
);

export const grainParamDefinitions = Object.freeze( grainSettings.params || {} );

const baseGrainDefaults = Object.fromEntries(
    Object.entries( grainParamDefinitions ).map( ( [ key, definition ] ) => [
        key,
        definition.env ? ( process.env[ definition.env ] || definition.default ) : definition.default
    ] )
);

const parseEnvDefaults = () => {
    const raw = process.env.GRAIN_DEFAULT_PARAMS_JSON;
    if ( !raw ) {
        return {};
    }

    try {
        const parsed = JSON.parse( raw );
        if ( parsed && typeof parsed === 'object' && !Array.isArray( parsed ) ) {
            return parsed;
        }
    } catch ( error ) {
        console.warn( `Invalid GRAIN_DEFAULT_PARAMS_JSON: ${ error.message }` );
    }
    return {};
};

export const grainDefaultParams = Object.freeze( {
    ...baseGrainDefaults,
    ...parseEnvDefaults()
} );

export const grainParamFields = Object.freeze( {
    numeric: Object.freeze( new Set(
        Object.entries( grainParamDefinitions )
            .filter( ( [ , definition ] ) => definition.type === 'number' )
            .map( ( [ key ] ) => key )
    ) ),
    boolean: Object.freeze( new Set(
        Object.entries( grainParamDefinitions )
            .filter( ( [ , definition ] ) => definition.type === 'boolean' )
            .map( ( [ key ] ) => key )
    ) ),
    string: Object.freeze( new Set(
        Object.entries( grainParamDefinitions )
            .filter( ( [ , definition ] ) => definition.type === 'string' )
            .map( ( [ key ] ) => key )
    ) )
} );
