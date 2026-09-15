export const sendSuccess = ( res, data, message = 'Success', statusCode = 200 ) => {
    res.status( statusCode ).json( { success: true, data, message } );
};

export const sendError = ( res, message, statusCode = 500, error ) => {
    res.status( statusCode ).json( {
        success: false,
        message,
        ...( error ? { error } : {} )
    } );
};
