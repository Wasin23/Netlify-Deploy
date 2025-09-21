// Simple test function without external dependencies

// Simple intent classification function using fetch
async function classifyEmailIntent(emailContent) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `Classify the intent of this email. Return ONE of these exact values:
- "meeting_request_positive" - if they agree to or confirm a meeting
- "meeting_time_preference" - if they specify a specific time/date for a meeting
- "meeting_request" - if they ask for a meeting but no specific time
- "question" - if they ask questions about the product/service
- "objection" - if they express concerns or objections
- "neutral" - for other responses

Only respond with the classification, nothing else.`
          },
          {
            role: "user",
            content: emailContent
          }
        ],
        max_tokens: 20,
        temperature: 0
      })
    });

    const data = await response.json();
    return data.choices[0].message.content.trim().toLowerCase();
  } catch (error) {
    console.error('Error classifying intent:', error);
    return 'neutral';
  }
}

// Simple meeting time detection
async function detectMeetingTime(emailContent) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `Extract meeting time information from this email. If a specific date/time is mentioned, return a JSON object with the details. If no specific time is mentioned, return null.

Format: {"hasTime": true/false, "timeString": "extracted time", "details": "summary"}

Only respond with valid JSON or null.`
          },
          {
            role: "user",
            content: emailContent
          }
        ],
        max_tokens: 150,
        temperature: 0
      })
    });

    const data = await response.json();
    const result = data.choices[0].message.content.trim();
    if (result === 'null') return null;
    
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  } catch (error) {
    console.error('Error detecting meeting time:', error);
    return null;
  }
}

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
        const meetingTime = await detectMeetingTime(testEmail.email);
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
