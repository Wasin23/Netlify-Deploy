// Import the functions we need to test
const { loadAgentSettings } = require('./mailgun-webhook');

// Test function to check calendar ID settings
async function getCalendarIdFromSettings(userId = 'default') {
  try {
    console.log('[SETTINGS] Fetching calendar ID from lead agent settings for user:', userId);
    
    // Try to load settings from the same source as agent settings
    let agentSettings = {};
    try {
      agentSettings = await loadAgentSettings(userId);
      console.log('[SETTINGS] Agent settings loaded successfully, keys:', Object.keys(agentSettings));
      console.log('[SETTINGS] Looking for calendar_id field...');
      console.log('[SETTINGS] calendar_id value:', agentSettings.calendar_id);
      
      if (agentSettings.calendar_id) {
        console.log('[SETTINGS] Found calendar ID in agent settings:', agentSettings.calendar_id);
        return agentSettings.calendar_id;
      } else {
        console.log('[SETTINGS] No calendar_id field found in settings');
        console.log('[SETTINGS] Available settings fields:', Object.keys(agentSettings));
      }
    } catch (error) {
      console.log('[SETTINGS] Could not load agent settings for calendar ID:', error);
    }
    
    // Fallback to environment variable
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    console.log('[SETTINGS] Using fallback calendar ID from environment:', calendarId);
    console.log('[SETTINGS] Environment variable GOOGLE_CALENDAR_ID exists:', !!process.env.GOOGLE_CALENDAR_ID);
    return calendarId;
  } catch (error) {
    console.error('[SETTINGS] Error fetching calendar ID:', error);
    return process.env.GOOGLE_CALENDAR_ID; // Fallback to environment variable
  }
}

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-CALENDAR-ID] Starting calendar ID lookup test');
  
  try {
    const userId = 'default';
    console.log('👤 [TEST-CALENDAR-ID] Testing calendar ID lookup for user:', userId);
    
    const calendarId = await getCalendarIdFromSettings(userId);
    
    console.log('📅 [TEST-CALENDAR-ID] Final result:', calendarId);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Calendar ID lookup test completed',
        userId: userId,
        calendarId: calendarId,
        calendarIdFound: !!calendarId,
        hasEnvironmentVariable: !!process.env.GOOGLE_CALENDAR_ID,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-CALENDAR-ID] Error:', error);
    
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
