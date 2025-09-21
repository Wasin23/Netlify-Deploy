const { classifyEmailIntent, detectConfirmedMeetingTime } = require('./mailgun-webhook');

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-INTENT] Starting intent classification and calendar flow test');
  
  try {
    // Test emails with meeting time preferences
    const testEmails = [
      {
        name: "Specific Time Preference",
        email: "Hi, I'd like to schedule a meeting for next Tuesday at 2 PM PST to discuss your AI GPU compute solutions.",
        from: "prospect@example.com"
      },
      {
        name: "Meeting Confirmation",
        email: "Yes, let's meet tomorrow at 3:30 PM. I'm interested in learning more about the 30% cost reduction you mentioned.",
        from: "client@company.com"
      },
      {
        name: "General Inquiry (No Meeting)",
        email: "Can you tell me more about your pricing model and how it compares to AWS?",
        from: "info@business.com"
      },
      {
        name: "Meeting Request",
        email: "I'd love to schedule a call to discuss how your infrastructure could help our AI training workloads.",
        from: "cto@startup.com"
      }
    ];
    
    const results = [];
    
    for (const testEmail of testEmails) {
      console.log(`\n📧 [TEST-INTENT] Testing: ${testEmail.name}`);
      console.log(`📧 [TEST-INTENT] Email: ${testEmail.email}`);
      
      try {
        // Test intent classification
        const intent = await classifyEmailIntent(testEmail.email);
        console.log(`🤖 [TEST-INTENT] Classified intent: ${intent}`);
        
        // Test meeting time detection
        const meetingTime = await detectConfirmedMeetingTime(testEmail.email, testEmail.from);
        console.log(`📅 [TEST-INTENT] Meeting time detected:`, meetingTime);
        
        // Check if this would trigger calendar creation
        const wouldTriggerCalendar = (intent === 'meeting_request_positive' || intent === 'meeting_time_preference');
        console.log(`⚡ [TEST-INTENT] Would trigger calendar: ${wouldTriggerCalendar}`);
        
        results.push({
          testName: testEmail.name,
          email: testEmail.email,
          intent: intent,
          meetingTime: meetingTime,
          wouldTriggerCalendar: wouldTriggerCalendar
        });
        
      } catch (error) {
        console.error(`❌ [TEST-INTENT] Error testing ${testEmail.name}:`, error);
        results.push({
          testName: testEmail.name,
          email: testEmail.email,
          error: error.message
        });
      }
    }
    
    console.log('\n📊 [TEST-INTENT] Complete test results:', results);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Intent classification and calendar flow test completed',
        testResults: results,
        summary: {
          totalTests: testEmails.length,
          calendarTriggers: results.filter(r => r.wouldTriggerCalendar).length,
          errors: results.filter(r => r.error).length
        },
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-INTENT] Error during intent test:', error);
    
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
