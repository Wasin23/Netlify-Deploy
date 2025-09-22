const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Get user code from user ID (first 8 characters)
function getUserCode(userId) {
  if (!userId || typeof userId !== 'string') {
    return 'default';
  }
  return userId.substring(0, 8);
}

// Test settings lookup with new user code system
async function testSettingsLookup() {
  try {
    console.log('🔍 Testing Settings Lookup with User Code System');
    
    // Get user code from users.json user ID
    const fullUserId = '76e84c79-9b13-4c55-be86-d0bd9baa9411';
    const userCode = getUserCode(fullUserId);
    
    console.log('📋 User Information:');
    console.log(`- Full User ID: ${fullUserId}`);
    console.log(`- User Code (first 8): ${userCode}`);
    
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

    // Search for settings with user_code filter
    console.log(`🔍 Searching for settings with user_code: "${userCode}"`);
    
    // Search for settings with user_code filter using query method
    console.log(`🔍 Searching for settings with user_code: "${userCode}"`);
    
    const queryResult = await client.query({
      collection_name: collectionName,
      filter: 'id >= 0',
      output_fields: ['setting_key', 'setting_value', 'setting_type', 'user_id'],
      limit: 100
    });

    console.log('📊 Query Results:');
    console.log(`- Results found: ${queryResult.data ? queryResult.data.length : 0}`);
    
    if (queryResult.data && queryResult.data.length > 0) {
      // Filter for user-specific settings
      const userSettings = queryResult.data.filter(setting => 
        setting.setting_key.includes(`_user_${userCode}`)
      );
      
      console.log(`✅ Settings with your signature: ${userSettings.length}`);
      for (const result of userSettings) {
        const originalKey = result.setting_key.replace(`_user_${userCode}`, '');
        console.log(`  - ${originalKey}: ${result.setting_value?.substring(0, 50)}...`);
      }
      
      // Check specifically for calendar_id
      const calendarSetting = userSettings.find(r => r.setting_key.includes('calendar_id'));
      if (calendarSetting) {
        console.log(`🗓️ Calendar ID found: ${calendarSetting.setting_value}`);
      } else {
        console.log('❌ No calendar_id setting found');
      }
      
      return {
        success: true,
        userCode: userCode,
        resultsFound: userSettings.length,
        settings: userSettings.map(s => ({
          key: s.setting_key.replace(`_user_${userCode}`, ''),
          value: s.setting_value
        }))
      };
    } else {
      console.log('❌ No settings found in database');
      return {
        success: true,
        userCode: userCode,
        resultsFound: 0,
        settings: [],
        message: 'No settings found in database'
      };
    }

  } catch (error) {
    console.error('❌ Settings lookup test failed:', error);
    return {
      success: false,
      error: error.message,
      userCode: userCode || 'unknown'
    };
  }
}

exports.handler = async (event, context) => {
  const result = await testSettingsLookup();
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(result, null, 2)
  };
};
