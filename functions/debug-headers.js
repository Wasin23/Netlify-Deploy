exports.handler = async (event, context) => {
  console.log('🐛 [DEBUG-HEADERS] Webhook debug started');
  
  try {
    const body = event.body;
    const headers = event.headers;
    
    // Parse form data
    const formData = new URLSearchParams(body);
    const formObj = {};
    for (const [key, value] of formData.entries()) {
      formObj[key] = value;
    }
    
    // Extract key email headers
    const emailHeaders = {
      'Message-ID': formObj['Message-Id'] || formObj['message-id'],
      'In-Reply-To': formObj['In-Reply-To'] || formObj['in-reply-to'],
      'References': formObj['References'] || formObj['references'],
      'Subject': formObj['subject'],
      'From': formObj['from'],
      'To': formObj['to']
    };
    
    // Look for all possible header variations
    const allHeaders = {};
    for (const [key, value] of formData.entries()) {
      if (key.toLowerCase().includes('message') || 
          key.toLowerCase().includes('reply') || 
          key.toLowerCase().includes('reference')) {
        allHeaders[key] = value;
      }
    }
    
    console.log('📧 [DEBUG-HEADERS] Email headers:', emailHeaders);
    console.log('🔍 [DEBUG-HEADERS] All message-related headers:', allHeaders);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Webhook headers debug completed',
        emailHeaders: emailHeaders,
        allMessageHeaders: allHeaders,
        totalFormFields: Object.keys(formObj).length,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [DEBUG-HEADERS] Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
};
