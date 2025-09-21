// Simple test to check what calendar ID is configured
exports.handler = async function(event, context) {
  console.log('[CALENDAR ID TEST] Starting...');
  
  try {
    // Test getting calendar ID from settings
    const userId = 'default';
    
    // Load settings from Zilliz if available
    let calendarId = null;
    let settingsData = null;
    
    if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
      const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
      const client = new MilvusClient({
        address: process.env.ZILLIZ_ENDPOINT,
        token: process.env.ZILLIZ_TOKEN
      });

      try {
        console.log('[CALENDAR ID TEST] Querying agent_settings for calendar ID...');
        
        const searchResult = await client.search({
          collection_name: 'agent_settings',
          vector: [0.1, 0.2], // Dummy vector
          limit: 100,
          filter: `user_id == "${userId}"`,
          output_fields: ['setting_key', 'setting_value', 'user_id']
        });

        const settings = searchResult.results || searchResult.data || [];
        console.log('[CALENDAR ID TEST] Found settings:', settings.length);
        
        settingsData = settings;
        
        // Look for calendar_id setting
        const calendarIdSetting = settings.find(s => s.setting_key === 'calendar_id');
        if (calendarIdSetting) {
          calendarId = calendarIdSetting.setting_value;
          console.log('[CALENDAR ID TEST] Found calendar ID:', calendarId);
        } else {
          console.log('[CALENDAR ID TEST] No calendar_id setting found');
        }
        
      } catch (zillizError) {
        console.error('[CALENDAR ID TEST] Zilliz query failed:', zillizError);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        userId,
        calendarId,
        calendarIdFound: !!calendarId,
        settingsCount: settingsData ? settingsData.length : 0,
        allSettings: settingsData,
        environment: {
          hasZillizEndpoint: !!process.env.ZILLIZ_ENDPOINT,
          hasZillizToken: !!process.env.ZILLIZ_TOKEN,
          hasGoogleServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
        }
      }, null, 2)
    };

  } catch (error) {
    console.error('[CALENDAR ID TEST] Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }, null, 2)
    };
  }
};
