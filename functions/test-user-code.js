exports.handler = async (event, context) => {
  try {
    // Test the 8-character user code system
    
    // Load user data to get the full user ID
    const knownUsers = {
      'colton.fidelman': '76e84c79-9b13-4c55-be86-d0bd9baa9411'
    };
    
    const fullUserId = knownUsers['colton.fidelman'];
    const userCode = fullUserId.substring(0, 8); // First 8 characters
    
    // Simulate new tracking ID generation
    const timestamp = Date.now();
    const hash = Math.random().toString(36).substring(2, 10);
    const newTrackingId = `tracking-${userCode}_${timestamp}_${hash}`;
    
    // Test extraction
    function extractUserCode(trackingId) {
      if (trackingId.startsWith('tracking-')) {
        const withoutPrefix = trackingId.substring('tracking-'.length);
        const parts = withoutPrefix.split('_');
        if (parts.length >= 3) {
          return parts[0];
        }
      }
      return 'default8';
    }
    
    const extractedCode = extractUserCode(newTrackingId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        originalUserId: fullUserId,
        userCode: userCode,
        newTrackingId: newTrackingId,
        extractedCode: extractedCode,
        matches: userCode === extractedCode,
        example: {
          oldFormat: 'tracking-default_1758497208325_a86bb55d',
          newFormat: newTrackingId,
          explanation: 'Now uses first 8 chars of user ID instead of "default"'
        }
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
