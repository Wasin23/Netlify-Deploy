const { calendarManager } = require('./calendarIntegrationManager');

// Test function to debug calendar creation logic
exports.handler = async function(event, context) {
  console.log('[TEST CALENDAR] Starting calendar creation test...');
  
  try {
    // Simulate email data for "Yeah, what about a meeting tomorrow at 4pm PST?"
    const mockEmailData = {
      from: 'test@example.com',
      to: 'replies@mg.examarkchat.com',
      subject: 'Re: Pricing Inquiry',
      body: 'Yeah, what about a meeting tomorrow at 4pm PST?',
      messageId: '<test-message-id@example.com>',
      timestamp: new Date().toISOString()
    };

    // Simulate AI response with meeting intent
    const mockAIResponse = {
      success: true,
      response: 'Great! Tomorrow at 4pm PST works perfectly. I\'ll send you a calendar invite.',
      intent: 'meeting_time_preference',
      provider: 'Test AI',
      analysis: { intent: 'meeting_time_preference', sentiment: 'positive' }
    };

    const trackingId = 'test-tracking-id-' + Date.now();
    const userId = 'default';

    console.log('[TEST CALENDAR] Mock data created:', {
      emailBody: mockEmailData.body,
      intent: mockAIResponse.intent,
      trackingId,
      userId
    });

    // Test the calendar creation logic directly
    console.log('[TEST CALENDAR] Testing calendar manager initialization...');
    
    if (!calendarManager.initialized) {
      console.log('[TEST CALENDAR] Initializing calendar manager...');
      await calendarManager.initialize();
      console.log('[TEST CALENDAR] Calendar manager initialized successfully');
    } else {
      console.log('[TEST CALENDAR] Calendar manager already initialized');
    }

    // Test meeting time parsing
    console.log('[TEST CALENDAR] Testing meeting time parsing...');
    const calendarManagerResult = calendarManager.parseMeetingTime(
      mockEmailData.body, 
      mockEmailData.body, 
      'America/Los_Angeles'
    );
    
    console.log('[TEST CALENDAR] Calendar manager parsing result:', calendarManagerResult);

    // Test intent classification
    console.log('[TEST CALENDAR] Testing intent classification...');
    const hasTimeKeywords = ['tomorrow at', 'today at', 'pm', 'am'].some(keyword => 
      mockEmailData.body.toLowerCase().includes(keyword)
    );
    console.log('[TEST CALENDAR] Has time keywords:', hasTimeKeywords);
    console.log('[TEST CALENDAR] Intent matches meeting_time_preference:', mockAIResponse.intent === 'meeting_time_preference');

    // Test OpenAI meeting time detection (if available)
    let openAIResult = null;
    if (process.env.OPENAI_API_KEY) {
      console.log('[TEST CALENDAR] Testing OpenAI meeting time detection...');
      
      const prompt = `
Current date and time: ${new Date().toISOString()} (it's currently ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })})

Analyze this email to extract any confirmed meeting times:

Email: "${mockEmailData.body}"

Return JSON in this format:
{
  "found": true/false,
  "dateTime": "2024-01-15T14:00:00.000Z",
  "timeZone": "America/Los_Angeles", 
  "duration": 30,
  "confidence": "high",
  "originalText": "tomorrow at 4pm PST",
  "timeZoneSpecified": true,
  "suggestTimeZoneConfirmation": false
}`;

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.1
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices[0].message.content.trim();
          console.log('[TEST CALENDAR] OpenAI raw response:', content);
          
          try {
            openAIResult = JSON.parse(content);
            console.log('[TEST CALENDAR] OpenAI parsed result:', openAIResult);
          } catch (parseError) {
            console.error('[TEST CALENDAR] Failed to parse OpenAI response:', parseError);
          }
        } else {
          console.error('[TEST CALENDAR] OpenAI API error:', response.status, response.statusText);
        }
      } catch (aiError) {
        console.error('[TEST CALENDAR] OpenAI request failed:', aiError);
      }
    } else {
      console.log('[TEST CALENDAR] No OpenAI API key available');
    }

    // Test calendar event creation (if parsing succeeded)
    let calendarEventResult = null;
    if (openAIResult && openAIResult.found) {
      console.log('[TEST CALENDAR] Attempting to create calendar event...');
      
      const eventDetails = {
        title: 'Test Sales Discussion - Test User',
        description: 'Test meeting scheduled via calendar test function',
        startTime: openAIResult.dateTime,
        endTime: new Date(new Date(openAIResult.dateTime).getTime() + (openAIResult.duration || 30) * 60000).toISOString(),
        timeZone: openAIResult.timeZone,
        attendees: [{ email: mockEmailData.from, displayName: 'Test User' }]
      };

      console.log('[TEST CALENDAR] Event details:', eventDetails);

      try {
        const result = await calendarManager.createGoogleCalendarEvent(eventDetails, 'primary');
        console.log('[TEST CALENDAR] Calendar event creation result:', result);
        calendarEventResult = result;
      } catch (calendarError) {
        console.error('[TEST CALENDAR] Calendar event creation failed:', calendarError);
        calendarEventResult = { success: false, error: calendarError.message };
      }
    } else {
      console.log('[TEST CALENDAR] Skipping calendar event creation - no valid meeting time found');
    }

    // Return comprehensive test results
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        test: 'calendar-creation-logic',
        timestamp: new Date().toISOString(),
        results: {
          calendarManagerInitialized: calendarManager.initialized,
          calendarManagerParsingResult: calendarManagerResult,
          hasTimeKeywords,
          intentMatches: mockAIResponse.intent === 'meeting_time_preference',
          openAIResult,
          calendarEventResult,
          environment: {
            hasZillizEndpoint: !!process.env.ZILLIZ_ENDPOINT,
            hasZillizToken: !!process.env.ZILLIZ_TOKEN,
            hasOpenAI: !!process.env.OPENAI_API_KEY,
            hasGoogleServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            hasGooglePrivateKey: !!process.env.GOOGLE_PRIVATE_KEY
          }
        },
        mockData: {
          emailData: mockEmailData,
          aiResponse: mockAIResponse,
          trackingId,
          userId
        }
      }, null, 2)
    };

  } catch (error) {
    console.error('[TEST CALENDAR] Test failed:', error);
    
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
        test: 'calendar-creation-logic',
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }
};
