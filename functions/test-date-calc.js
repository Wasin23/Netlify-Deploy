// Test endpoint to check date calculations with user timezone settings
export const handler = async (event, context) => {
  try {
    // Actually pull from Zilliz instead of using mock data
    const testUserId = "76e84c79"; // Your 8-character user ID
    
    let userSettings = null;
    
    try {
      // Test Zilliz connection and get real settings
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      
      const milvusClient = new MilvusClient({
        address: process.env.ZILLIZ_ENDPOINT,
        token: process.env.ZILLIZ_TOKEN,
        ssl: true
      });
      
      console.log('[TEST] Testing Zilliz connection...');
      await milvusClient.loadCollection({ collection_name: 'agent_settings' });
      
      // Query for actual user settings
      const result = await milvusClient.query({
        collection_name: 'agent_settings',
        expr: `setting_key == "email_response_settings" && user_id == "${testUserId}"`,
        output_fields: ['setting_value', 'updated_at'],
        limit: 1,
        consistency_level: 'Strong'
      });
      
      const rows = result.data || result || [];
      console.log('[TEST] Zilliz query result:', rows);
      
      if (rows.length > 0) {
        userSettings = JSON.parse(rows[0].setting_value);
        console.log('[TEST] Found real user settings:', userSettings);
      } else {
        console.log('[TEST] No settings found in Zilliz for user:', testUserId);
        return {
          statusCode: 404,
          body: JSON.stringify({
            error: "No user settings found in Zilliz",
            user_id: testUserId,
            message: "This proves the webhook might also be failing to get settings"
          })
        };
      }
      
    } catch (zillizError) {
      console.error('[TEST] Zilliz connection failed:', zillizError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to connect to Zilliz",
          details: zillizError.message,
          message: "This could be why the webhook isn't getting settings"
        })
      };
    }

    const userTimezone = userSettings.timezone;
    const now = new Date();
    
    // Calculate dates in user's timezone (PST)
    const today = now.toLocaleDateString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      timeZone: userTimezone 
    }).replace(/\//g, '-');
    
    const tomorrow = new Date(now.getTime() + 24*60*60*1000).toLocaleDateString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      timeZone: userTimezone 
    }).replace(/\//g, '-');

    const todayLong = now.toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: userTimezone 
    });

    const userCurrentTime = now.toLocaleString('en-US', { 
      timeZone: userTimezone,
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    // Test calendar event scenarios  
    const testScenarios = {
      "tomorrow_5pm_pst": `${tomorrow}T17:00:00-08:00`,
      "tomorrow_4pm_pst": `${tomorrow}T16:00:00-08:00`, 
      "today_2pm_pst": `${today}T14:00:00-08:00`
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userSettings: userSettings,
        timezone_info: {
          user_timezone: userTimezone,
          user_current_time: userCurrentTime,
          utc_time: now.toISOString()
        },
        date_calculations: {
          today: today,
          tomorrow: tomorrow, 
          today_long: todayLong
        },
        calendar_examples: testScenarios,
        expected_behavior: {
          "if_user_says": "tomorrow at 5pm",
          "ai_should_assume": "PST (user's timezone)",
          "should_schedule_for": testScenarios.tomorrow_5pm_pst,
          "calendar_date": tomorrow
        },
        ai_prompt_preview: `Today is: ${todayLong} (in ${userTimezone})\nTomorrow: ${tomorrow}\nAI Name: ${userSettings.ai_assistant_name}\nCompany: ${userSettings.company_name}`
      }, null, 2)
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
