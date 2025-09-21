// Test function to validate the fast webhook architecture
// This simulates an email webhook and measures execution time

exports.handler = async (event, context) => {
  console.log('🧪 [WEBHOOK TEST] Starting fast webhook architecture test');
  
  const startTime = Date.now();
  
  try {
    // Simulate webhook with test email data
    const testEmailData = {
      sender: 'test@example.com',
      subject: 'Test Email Response',
      body: 'Hello, I would like to schedule a meeting for next week to discuss our project.',
      timestamp: new Date().toISOString(),
      messageId: `<test-${Date.now()}@mailgun.test>`
    };
    
    // Generate a test tracking ID
    const testTrackingId = `user123_${Date.now()}_test`;
    
    console.log('🧪 [WEBHOOK TEST] Test data prepared, starting webhook simulation...');
    
    // Call the main webhook function with test data
    const webhookUrl = `${process.env.URL}/.netlify/functions/mailgun-webhook`;
    
    // Create form data like Mailgun would send
    const formData = new URLSearchParams();
    formData.append('sender', testEmailData.sender);
    formData.append('subject', testEmailData.subject);
    formData.append('stripped-text', testEmailData.body);
    formData.append('timestamp', Math.floor(Date.now() / 1000).toString());
    formData.append('Message-Id', testEmailData.messageId);
    formData.append('In-Reply-To', `<${testTrackingId}@examark.ai>`);
    
    const webhookStartTime = Date.now();
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });
    
    const webhookEndTime = Date.now();
    const webhookDuration = webhookEndTime - webhookStartTime;
    
    const result = await response.json();
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    console.log('🧪 [WEBHOOK TEST] Test completed');
    console.log('🧪 [WEBHOOK TEST] Webhook duration:', webhookDuration, 'ms');
    console.log('🧪 [WEBHOOK TEST] Total test duration:', totalDuration, 'ms');
    
    // Check if webhook completed successfully and within time limit
    const success = response.ok && webhookDuration < 25000; // 25 seconds (under Netlify's 26s limit)
    const timeoutRisk = webhookDuration > 20000; // Warn if over 20 seconds
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success,
        testResults: {
          webhookStatus: response.status,
          webhookSuccess: response.ok,
          webhookDuration: `${webhookDuration}ms`,
          totalTestDuration: `${totalDuration}ms`,
          withinTimeLimit: webhookDuration < 25000,
          timeoutRisk,
          timestamp: new Date().toISOString()
        },
        webhookResponse: result,
        performance: {
          fast: webhookDuration < 10000,
          acceptable: webhookDuration < 20000,
          atRisk: webhookDuration > 20000,
          timeout: webhookDuration > 25000
        },
        recommendations: {
          ...(webhookDuration < 10000 && { status: '✅ Excellent performance - webhook is very fast' }),
          ...(webhookDuration >= 10000 && webhookDuration < 20000 && { status: '✅ Good performance - webhook is acceptably fast' }),
          ...(webhookDuration >= 20000 && webhookDuration < 25000 && { status: '⚠️ Warning - webhook is approaching timeout limit' }),
          ...(webhookDuration >= 25000 && { status: '❌ Critical - webhook exceeded safe time limit' })
        }
      })
    };
    
  } catch (error) {
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    console.error('❌ [WEBHOOK TEST] Test failed:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        testResults: {
          totalTestDuration: `${totalDuration}ms`,
          timestamp: new Date().toISOString()
        }
      })
    };
  }
};
