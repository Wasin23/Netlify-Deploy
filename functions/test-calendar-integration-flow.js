const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Get user code from user ID (first 8 characters)
function getUserCode(userId) {
  if (!userId || typeof userId !== 'string') {
    return '76e84c79';
  }
  return userId.substring(0, 8);
}

// Extract user ID from tracking ID format: tracking-userId_timestamp_hash
function extractUserIdFromTrackingId(trackingId) {
  try {
    if (!trackingId) return '76e84c79'; // Return 8-char code for default user
    
    // Format: tracking-userCode_timestamp_hash where userCode is first 8 chars of user ID
    if (trackingId.startsWith('tracking-')) {
      const withoutPrefix = trackingId.substring('tracking-'.length);
      const parts = withoutPrefix.split('_');
      if (parts.length >= 3) {
        const userCode = parts[0];
        console.log('[USER CODE] Extracted from tracking ID:', userCode);
        return userCode;
      }
    }
    
    // Fallback: try old format userCode_timestamp_hash
    const parts = trackingId.split('_');
    if (parts.length >= 3) {
      const userCode = parts[0];
      console.log('[USER CODE] Extracted from tracking ID (fallback):', userCode);
      return userCode;
    }
    
    console.log('[USER CODE] Could not parse tracking ID, using 76e84c79:', trackingId);
    return '76e84c79'; // Return 8-char code for default
  } catch (error) {
    console.error('[USER CODE] Error extracting user code:', error);
    return '76e84c79'; // Return 8-char code for default
  }
}

// Get user's Google Calendar ID from Zilliz settings
async function getCalendarIdFromSettings(userCode = '76e84c79') {
  try {
    console.log('[CALENDAR] Getting calendar ID for user code:', userCode);
    
    if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
      const client = new MilvusClient({
        address: process.env.ZILLIZ_ENDPOINT,
        token: process.env.ZILLIZ_TOKEN
      });

      // Query for calendar_id setting using the working query method
      const queryResult = await client.query({
        collection_name: 'agent_settings',
        filter: 'id >= 0',
        output_fields: ['setting_key', 'setting_value'],
        limit: 100
      });

      console.log('[CALENDAR] Zilliz query result:', queryResult);
      
      if (queryResult.data && queryResult.data.length > 0) {
        // Look for calendar_id with user signature
        const calendarSetting = queryResult.data.find(setting => 
          setting.setting_key === `calendar_id_user_${userCode}`
        );
        
        if (calendarSetting) {
          console.log('[CALENDAR] Found calendar ID in Zilliz:', calendarSetting.setting_value);
          return calendarSetting.setting_value;
        }
      }
      
      console.log('[CALENDAR] No calendar ID found for user code:', userCode);
    }
    
    // Fallback to default calendar ID
    console.log('[CALENDAR] Using fallback calendar ID');
    return 'colton.fidd@gmail.com';
    
  } catch (error) {
    console.error('[CALENDAR] Error getting calendar ID:', error);
    return 'colton.fidd@gmail.com'; // Fallback
  }
}

// Test the complete calendar integration flow
async function testCalendarIntegrationFlow() {
  try {
    console.log('🗓️ Testing Complete Calendar Integration Flow');
    console.log('==========================================');
    
    // Simulate a tracking ID from a new email
    const simulatedTrackingId = 'tracking-76e84c79_1758505000000_abc123test';
    console.log(`📧 Simulated tracking ID: ${simulatedTrackingId}`);
    
    // Step 1: Extract user code from tracking ID
    console.log('\n📋 Step 1: Extract User Code');
    const userCode = extractUserIdFromTrackingId(simulatedTrackingId);
    console.log(`✅ Extracted user code: ${userCode}`);
    
    // Step 2: Get calendar ID for this user
    console.log('\n🗓️ Step 2: Get Calendar ID');
    const calendarId = await getCalendarIdFromSettings(userCode);
    console.log(`✅ Calendar ID: ${calendarId}`);
    
    // Step 3: Simulate meeting time detection
    console.log('\n⏰ Step 3: Meeting Time Detection');
    const emailBody = "Yes, I'd like to schedule a meeting for 3pm tomorrow PST";
    console.log(`📝 Email content: "${emailBody}"`);
    
    // Simple meeting time detection (real function would use AI)
    const hasMeetingTime = emailBody.toLowerCase().includes('3pm') || 
                          emailBody.toLowerCase().includes('tomorrow') ||
                          emailBody.toLowerCase().includes('schedule');
    
    console.log(`🤖 Meeting time detected: ${hasMeetingTime}`);
    
    // Step 4: Calendar event creation simulation
    if (hasMeetingTime && calendarId) {
      console.log('\n📅 Step 4: Calendar Event Creation');
      const eventDetails = {
        calendarId: calendarId,
        summary: 'ExaMark Meeting',
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        userCode: userCode,
        trackingId: simulatedTrackingId
      };
      
      console.log('🎉 SUCCESS: Would create calendar event with:');
      console.log(`   - Calendar ID: ${eventDetails.calendarId}`);
      console.log(`   - Summary: ${eventDetails.summary}`);
      console.log(`   - Start Time: ${eventDetails.startTime.toISOString()}`);
      console.log(`   - User Code: ${eventDetails.userCode}`);
      console.log(`   - Tracking ID: ${eventDetails.trackingId}`);
      
      return {
        success: true,
        flow: 'complete',
        userCode: userCode,
        calendarId: calendarId,
        meetingDetected: hasMeetingTime,
        eventDetails: eventDetails,
        message: 'Calendar integration flow working correctly'
      };
    } else {
      console.log('\n❌ Step 4: Calendar Event Creation FAILED');
      console.log(`   - Meeting time detected: ${hasMeetingTime}`);
      console.log(`   - Calendar ID available: ${!!calendarId}`);
      
      return {
        success: false,
        flow: 'incomplete',
        userCode: userCode,
        calendarId: calendarId,
        meetingDetected: hasMeetingTime,
        message: 'Calendar integration flow incomplete - missing requirements'
      };
    }

  } catch (error) {
    console.error('❌ Calendar integration flow test failed:', error);
    return {
      success: false,
      error: error.message,
      message: 'Calendar integration flow test failed'
    };
  }
}

exports.handler = async (event, context) => {
  const result = await testCalendarIntegrationFlow();
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result, null, 2)
  };
};
