// Test the webhook locally with real environment variables
require('dotenv').config({ path: '../.env' }); // Load env from parent directory

const { handler } = require('./functions/mailgun-webhook');

// Test the webhook with a simulated email reply
async function testWebhook() {
  console.log('🧪 Testing webhook locally with environment variables...\n');
  
  console.log('🔑 [TEST] Environment check:', {
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasZilliz: !!process.env.ZILLIZ_ENDPOINT,
    hasMailgun: !!process.env.MAILGUN_API_KEY,
    hasGoogleCalendar: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  });
  console.log('');
  
  // Simulate a Mailgun webhook POST request with the "6pm tomorrow" email
  const testEvent = {
    httpMethod: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'From': 'cole@gmail.com',
      'To': 'replies@examarkchat.com',
      'Subject': 'Re: Pricing Inquiry',
      'body-plain': 'hmmm, I guess i could set up a meeting. how about 6pm tomorrow?',
      'Message-Id': '<test-message-id@gmail.com>',
      'References': '<testuser_1726935600000_a1b2c3d4@examarkchat.com>',
      'In-Reply-To': '<testuser_1726935600000_a1b2c3d4@examarkchat.com>'
    }).toString()
  };

  console.log('📧 Simulating email:', {
    from: 'cole@gmail.com',
    subject: 'Re: Pricing Inquiry',
    body: 'hmmm, I guess i could set up a meeting. how about 6pm tomorrow?'
  });
  console.log('');

  try {
    const result = await handler(testEvent, {});
    
    console.log('📊 Response Status:', result.statusCode);
    console.log('📄 Response Headers:', result.headers);
    
    if (result.body) {
      const responseData = JSON.parse(result.body);
      console.log('');
      console.log('🤖 AI Response Analysis:');
      console.log('✅ Success:', responseData.success);
      console.log('🆔 Reply ID:', responseData.replyId);
      console.log('🔗 Tracking ID:', responseData.trackingId);
      console.log('📅 Timestamp:', responseData.timestamp);
      
      if (responseData.analysis) {
        console.log('');
        console.log('🎯 Intent Analysis:');
        console.log('   Intent:', responseData.analysis.intent);
        console.log('   Sentiment:', responseData.analysis.sentiment);
      }
      
      if (responseData.aiResponse) {
        console.log('');
        console.log('🤖 AI Response Generated:');
        console.log('   Success:', responseData.aiResponse.success);
        console.log('   Intent Detected:', responseData.aiResponse.intent);
        console.log('   Provider:', responseData.aiResponse.provider);
        console.log('   Settings Used:', responseData.aiResponse.settings_used);
        
        if (responseData.aiResponse.response) {
          console.log('');
          console.log('📝 Generated Response:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(responseData.aiResponse.response);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
        
        if (responseData.aiResponse.emailSent) {
          console.log('');
          console.log('📧 Auto Email Status:');
          console.log('   Sent:', responseData.aiResponse.emailSent.success);
          if (responseData.aiResponse.emailSent.error) {
            console.log('   Error:', responseData.aiResponse.emailSent.error);
          }
        }
        
        if (responseData.aiResponse.calendarEvent) {
          console.log('');
          console.log('📅 Calendar Event Status:');
          console.log('   Created:', responseData.aiResponse.calendarEvent.eventCreated || false);
          if (responseData.aiResponse.calendarEvent.reason) {
            console.log('   Reason:', responseData.aiResponse.calendarEvent.reason);
          }
          if (responseData.aiResponse.calendarEvent.eventDetails) {
            console.log('   Event Details:', responseData.aiResponse.calendarEvent.eventDetails);
          }
        }
      }
      
      if (responseData.zillizStorage) {
        console.log('');
        console.log('💾 Zilliz Storage:');
        console.log('   Success:', responseData.zillizStorage.success);
        if (responseData.zillizStorage.error) {
          console.log('   Error:', responseData.zillizStorage.error);
        }
      }
      
    } else {
      console.log('❌ No response body received');
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Test with environment check
async function runTest() {
  console.log('🔧 Environment Check:');
  console.log('   ZILLIZ_ENDPOINT:', !!process.env.ZILLIZ_ENDPOINT);
  console.log('   ZILLIZ_TOKEN:', !!process.env.ZILLIZ_TOKEN);
  console.log('   OPENAI_API_KEY:', !!process.env.OPENAI_API_KEY);
  console.log('   MAILGUN_API_KEY:', !!process.env.MAILGUN_API_KEY);
  console.log('   MAILGUN_DOMAIN:', !!process.env.MAILGUN_DOMAIN);
  console.log('');
  
  await testWebhook();
}

runTest();
