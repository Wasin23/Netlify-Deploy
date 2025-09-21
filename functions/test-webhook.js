exports.handler = async (event, context) => {
  console.log('[TEST] Function called at:', new Date().toISOString());
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse form data
    const params = new URLSearchParams(event.body);
    const subject = params.get('Subject') || '';
    
    console.log('[TEST] Subject:', subject);
    
    // Test tracking ID extraction
    const subjectNewMatch = subject?.match(/\[([a-zA-Z0-9_-]+)\]|\(ID:\s*([a-zA-Z0-9_-]+)\)/);
    if (subjectNewMatch) {
      const trackingId = subjectNewMatch[1] || subjectNewMatch[2];
      console.log('[TEST] Found tracking ID:', trackingId);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true, 
          trackingId: trackingId,
          message: 'Tracking ID extracted successfully'
        })
      };
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        message: 'No tracking ID found',
        subject: subject
      })
    };
    
  } catch (error) {
    console.error('[TEST] Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
