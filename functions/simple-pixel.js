exports.handler = async (event, context) => {
  // Simple pixel without dependencies
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-cache'
    },
    body: pixel.toString('base64'),
    isBase64Encoded: true
  };
};
