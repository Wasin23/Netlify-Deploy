const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Get user code from user ID (first 8 characters)
function getUserCode(userId) {
  if (!userId || typeof userId !== 'string') {
    return '76e84c79';
  }
  return userId.substring(0, 8);
}

// Test calendar ID lookup specifically
async function testCalendarIdLookup() {
  try {
    console.log('🗓️ Testing Calendar ID Lookup with User Code System');
    
    // Get user code from users.json user ID
    const fullUserId = '76e84c79-9b13-4c55-be86-d0bd9baa9411';
    const userCode = getUserCode(fullUserId);
    
    console.log('📋 User Information:');
    console.log(`- Full User ID: ${fullUserId}`);
    console.log(`- User Code (first 8): ${userCode}`);
    console.log(`- Looking for setting: calendar_id_user_${userCode}`);
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      throw new Error('Zilliz credentials missing');
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    const collectionName = 'agent_settings';
    
    // Load collection
    await client.loadCollection({ collection_name: collectionName });
    console.log('✅ Collection loaded successfully');

    // Query for calendar_id setting using the working query method
    const queryResult = await client.query({
      collection_name: collectionName,
      filter: 'id >= 0',
      output_fields: ['setting_key', 'setting_value', 'setting_type', 'user_id'],
      limit: 100
    });

    console.log('📊 Query Results:');
    console.log(`- Total results found: ${queryResult.data ? queryResult.data.length : 0}`);
    
    if (queryResult.data && queryResult.data.length > 0) {
      // Look for calendar_id with user signature
      const calendarSetting = queryResult.data.find(setting => 
        setting.setting_key === `calendar_id_user_${userCode}`
      );
      
      if (calendarSetting) {
        console.log('🎉 SUCCESS: Calendar ID found!');
        console.log(`- Setting Key: ${calendarSetting.setting_key}`);
        console.log(`- Calendar ID: ${calendarSetting.setting_value}`);
        console.log(`- Setting Type: ${calendarSetting.setting_type}`);
        console.log(`- User ID: ${calendarSetting.user_id}`);
        
        return {
          success: true,
          found: true,
          userCode: userCode,
          calendarId: calendarSetting.setting_value,
          settingKey: calendarSetting.setting_key
        };
      } else {
        console.log('❌ Calendar ID not found with user signature');
        
        // Check if there are any calendar_id settings at all
        const anyCalendarSettings = queryResult.data.filter(setting => 
          setting.setting_key.includes('calendar_id')
        );
        
        console.log(`📋 Found ${anyCalendarSettings.length} calendar_id related settings:`);
        anyCalendarSettings.forEach(setting => {
          console.log(`  - ${setting.setting_key}: ${setting.setting_value}`);
        });
        
        return {
          success: true,
          found: false,
          userCode: userCode,
          message: 'Calendar ID not found with user signature',
          availableCalendarSettings: anyCalendarSettings.map(s => ({
            key: s.setting_key,
            value: s.setting_value
          }))
        };
      }
    } else {
      console.log('❌ No settings found in database at all');
      return {
        success: true,
        found: false,
        userCode: userCode,
        message: 'No settings found in database'
      };
    }

  } catch (error) {
    console.error('❌ Calendar ID lookup test failed:', error);
    return {
      success: false,
      error: error.message,
      userCode: userCode || 'unknown'
    };
  }
}

exports.handler = async (event, context) => {
  const result = await testCalendarIdLookup();
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result, null, 2)
  };
};
