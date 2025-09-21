// Import required modules - same as webhook
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
const { CalendarIntegrationManager } = require('./calendarIntegrationManager');

// Simulate the AI intent classification
async function classifyIntentWithAI(emailContent) {
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
            content: `Classify the intent of this email reply. Return ONE of these exact values:
- "meeting_time_preference" - if they specify a specific time/date for a meeting
- "meeting_request_positive" - if they agree to or confirm a meeting
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

// Simulate meeting time detection
async function detectConfirmedMeetingTime(emailBody, userEmail) {
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
            content: `Extract meeting time information from this email. If a specific date/time is mentioned for a meeting, return a JSON object with the parsed details.

Return format:
{
  "hasMeetingTime": true/false,
  "timeString": "extracted time phrase",
  "startTime": "ISO date string",
  "endTime": "ISO date string (1 hour later)",
  "timeZone": "America/Los_Angeles"
}

If no specific meeting time is found, return: {"hasMeetingTime": false}

Current date reference: September 21, 2025`
          },
          {
            role: "user",
            content: emailBody
          }
        ],
        max_tokens: 200,
        temperature: 0
      })
    });

    const data = await response.json();
    const result = data.choices[0].message.content.trim();
    
    try {
      return JSON.parse(result);
    } catch {
      return { hasMeetingTime: false };
    }
  } catch (error) {
    console.error('Error detecting meeting time:', error);
    return { hasMeetingTime: false };
  }
}

// Calendar ID lookup - same as webhook
async function getCalendarIdFromSettings(userId = 'default') {
  try {
    if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
      const client = new MilvusClient({
        address: process.env.ZILLIZ_ENDPOINT,
        token: process.env.ZILLIZ_TOKEN
      });

      const searchResult = await client.search({
        collection_name: 'agent_settings',
        vector: [0.1, 0.2],
        limit: 10,
        filter: `user_id == "${userId}" && setting_key == "calendar_id"`
      });

      if (searchResult.results && searchResult.results.length > 0) {
        for (const result of searchResult.results) {
          if (result.user_id === userId && result.setting_key === 'calendar_id') {
            return result.setting_value;
          }
        }
      }
    }
    
    if (userId === 'default') {
      return 'colton.fidd@gmail.com';
    }
    
    return process.env.GOOGLE_CALENDAR_ID;
  } catch (error) {
    console.error('Error fetching calendar ID:', error);
    return process.env.GOOGLE_CALENDAR_ID;
  }
}

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-EMAIL-WEBHOOK] Starting simulated email webhook with meeting time');
  
  try {
    // Simulate incoming email data
    const emailData = {
      from: 'prospect@example.com',
      to: 'replies@mg.examarkchat.com', 
      subject: 'Re: Let\'s discuss your services',
      body: 'Hi there! Yes, I\'d love to meet. How about tomorrow at 3 PM PST to discuss your AI solutions? Looking forward to it!'
    };
    
    console.log('📧 [STEP 1] Simulated email received:', {
      from: emailData.from,
      subject: emailData.subject,
      bodyPreview: emailData.body.substring(0, 100) + '...'
    });
    
    // Step 1: Classify intent (like webhook does)
    console.log('🤖 [STEP 2] Classifying email intent...');
    const intent = await classifyIntentWithAI(emailData.body);
    console.log('🤖 [STEP 2] Intent classified as:', intent);
    
    // Step 2: Check if intent triggers calendar creation
    const shouldCreateCalendar = (intent === 'meeting_time_preference' || intent === 'meeting_request_positive');
    console.log('📅 [STEP 3] Should create calendar event?', shouldCreateCalendar);
    
    if (!shouldCreateCalendar) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Email processed but no calendar event needed',
          intent: intent,
          calendarEventCreated: false,
          reason: 'Intent does not require calendar creation'
        })
      };
    }
    
    // Step 3: Detect meeting time (like webhook does)
    console.log('⏰ [STEP 4] Detecting meeting time...');
    const meetingTimeDetected = await detectConfirmedMeetingTime(emailData.body, emailData.from);
    console.log('⏰ [STEP 4] Meeting time detection result:', meetingTimeDetected);
    
    if (!meetingTimeDetected.hasMeetingTime) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Intent suggests calendar creation but no specific time found',
          intent: intent,
          calendarEventCreated: false,
          reason: 'No specific meeting time detected'
        })
      };
    }
    
    // Step 4: Get calendar ID (like webhook does)
    console.log('📅 [STEP 5] Getting calendar ID...');
    const userCalendarId = await getCalendarIdFromSettings('default');
    console.log('📅 [STEP 5] Calendar ID:', userCalendarId);
    
    // Step 5: Create calendar event (like webhook does)
    console.log('📅 [STEP 6] Creating calendar event...');
    const calendarManager = new CalendarIntegrationManager();
    
    if (!calendarManager.initialized) {
      await calendarManager.initialize();
    }
    
    const eventDetails = {
      title: `Meeting with Prospect - ${emailData.from}`,
      description: `Meeting scheduled via AI email responder\n\nProspect: ${emailData.from}\nOriginal message: ${emailData.body}\n\nMeeting time confirmed: ${meetingTimeDetected.timeString}`,
      startTime: meetingTimeDetected.startTime,
      endTime: meetingTimeDetected.endTime,
      timeZone: meetingTimeDetected.timeZone || 'America/Los_Angeles',
      attendees: [
        { email: emailData.from, displayName: 'Prospect' }
      ]
    };
    
    const result = await calendarManager.createGoogleCalendarEvent(eventDetails, userCalendarId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Simulated email webhook completed',
        emailData: emailData,
        intent: intent,
        meetingTimeDetected: meetingTimeDetected,
        calendarEventCreated: result.success,
        calendarResult: result,
        eventLink: result.event_link,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-EMAIL-WEBHOOK] Error:', error);
    
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
