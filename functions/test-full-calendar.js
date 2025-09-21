// Import required modules
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
const { CalendarIntegrationManager } = require('./calendarIntegrationManager');

// Exact same function as in webhook
async function getCalendarIdFromSettings(userId = 'default') {
  try {
    console.log('[SETTINGS] Fetching calendar ID from lead agent settings for user:', userId);
    
    // Try direct Zilliz query for calendar_id setting
    if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
      try {
        const client = new MilvusClient({
          address: process.env.ZILLIZ_ENDPOINT,
          token: process.env.ZILLIZ_TOKEN
        });

        // Query for calendar_id setting specifically
        const searchResult = await client.search({
          collection_name: 'agent_settings',
          vector: [0.1, 0.2], // Dummy vector since we're using filter
          limit: 10,
          filter: `user_id == "${userId}" && setting_key == "calendar_id"`
        });

        console.log('[SETTINGS] Zilliz search result found:', searchResult.results?.length || 0, 'records');
        
        if (searchResult.results && searchResult.results.length > 0) {
          for (const result of searchResult.results) {
            if (result.user_id === userId && result.setting_key === 'calendar_id') {
              console.log('[SETTINGS] Found calendar ID in Zilliz:', result.setting_value);
              return result.setting_value;
            }
          }
        }
        
        console.log('[SETTINGS] No calendar_id setting found in Zilliz for user:', userId);
      } catch (zillizError) {
        console.log('[SETTINGS] Zilliz query failed:', zillizError.message);
      }
    }
    
    // Fallback to environment variable or hardcoded value for specific users
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    console.log('[SETTINGS] Using fallback calendar ID from environment:', calendarId);
    
    // Hardcoded fallback for default user 
    if (!calendarId && userId === 'default') {
      console.log('[SETTINGS] Using hardcoded calendar ID for default user');
      return 'colton.fidd@gmail.com';
    }
    
    return calendarId;
  } catch (error) {
    console.error('[SETTINGS] Error fetching calendar ID:', error);
    return process.env.GOOGLE_CALENDAR_ID;
  }
}

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-FULL-CALENDAR] Starting full calendar creation test simulating webhook flow');
  
  try {
    const userId = 'default';
    
    // Step 1: Get calendar ID exactly like webhook does
    console.log('📅 [STEP 1] Getting calendar ID from settings...');
    const userCalendarId = await getCalendarIdFromSettings(userId);
    console.log('📅 [STEP 1] Calendar ID result:', userCalendarId);
    
    if (!userCalendarId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'No calendar ID found',
          step: 'calendar_id_lookup'
        })
      };
    }
    
    // Step 2: Initialize calendar manager exactly like webhook does
    console.log('📅 [STEP 2] Initializing calendar manager...');
    const calendarManager = new CalendarIntegrationManager();
    
    if (!calendarManager.initialized) {
      await calendarManager.initialize();
    }
    console.log('📅 [STEP 2] Calendar manager initialized:', calendarManager.initialized);
    
    // Step 3: Create test event exactly like webhook would
    console.log('📅 [STEP 3] Creating calendar event...');
    const eventDetails = {
      title: 'Test Meeting - Webhook Simulation',
      description: 'This is a test meeting created to verify the webhook calendar integration is working properly.\n\nLead: Test User\nEmail: test@example.com\nTime Zone: America/Los_Angeles',
      startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      endTime: new Date(Date.now() + 90 * 60 * 1000).toISOString(), // 1.5 hours from now
      timeZone: 'America/Los_Angeles',
      attendees: [
        { email: 'test@example.com', displayName: 'Test User' }
      ]
    };
    
    console.log('📅 [STEP 3] Event details:', eventDetails);
    
    // Step 4: Create the event with the exact same call as webhook
    console.log('📅 [STEP 4] Calling createGoogleCalendarEvent with userCalendarId:', userCalendarId);
    const result = await calendarManager.createGoogleCalendarEvent(eventDetails, userCalendarId);
    
    console.log('📅 [STEP 4] Calendar creation result:', result);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Full calendar test completed - simulating webhook flow',
        steps: {
          step1_calendar_id: userCalendarId,
          step2_manager_initialized: calendarManager.initialized,
          step3_event_details: eventDetails,
          step4_creation_result: result
        },
        event_created: result.success,
        event_link: result.event_link,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-FULL-CALENDAR] Error:', error);
    
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
