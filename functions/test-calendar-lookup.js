// Import Zilliz client
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Test the actual calendar ID lookup with direct Zilliz query
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

        console.log('[SETTINGS] Zilliz search result:', searchResult);
        
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
    console.log('[SETTINGS] Environment variable GOOGLE_CALENDAR_ID exists:', !!process.env.GOOGLE_CALENDAR_ID);
    
    // Hardcoded fallback for default user while we fix Zilliz settings
    if (!calendarId && userId === 'default') {
      console.log('[SETTINGS] Using hardcoded calendar ID for default user');
      return 'colton.fidd@gmail.com';
    }
    
    return calendarId;
  } catch (error) {
    console.error('[SETTINGS] Error fetching calendar ID:', error);
    return process.env.GOOGLE_CALENDAR_ID; // Fallback to environment variable
  }
}

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-CALENDAR-LOOKUP] Starting calendar ID lookup test with new Zilliz query');
  
  const logs = [];
  
  // Capture console logs
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };
  
  try {
    const userId = 'default';
    console.log('👤 [TEST-CALENDAR-LOOKUP] Testing calendar ID lookup for user:', userId);
    
    const calendarId = await getCalendarIdFromSettings(userId);
    
    console.log('📅 [TEST-CALENDAR-LOOKUP] Final result:', calendarId);
    
    // Test if this would work with calendar manager
    const wouldWork = !!calendarId && calendarId !== 'undefined';
    console.log('✅ [TEST-CALENDAR-LOOKUP] Would calendar creation work?', wouldWork);
    
    // Restore console.log
    console.log = originalLog;
    
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
        wouldWork: wouldWork,
        hasEnvironmentVariable: !!process.env.GOOGLE_CALENDAR_ID,
        hasZillizCredentials: !!(process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN),
        logs: logs,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-CALENDAR-LOOKUP] Error:', error);
    
    // Restore console.log
    console.log = originalLog;
    
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
        logs: logs,
        timestamp: new Date().toISOString()
      })
    };
  }
};
