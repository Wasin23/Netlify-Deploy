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
    
    const searchResult = await client.search({
      collection_name: collectionName,
      vectors: [[0.1, 0.2]],
      search_params: { nprobe: 10 },
      limit: 100,
      output_fields: ['setting_key', 'setting_value', 'setting_type', 'user_id', 'user_code'],
      filter: `user_code == "${userCode}"`
    });

    console.log('📊 Search Results:');
    console.log(`- Results found: ${searchResult.results ? searchResult.results.length : 0}`);
    
    if (searchResult.results && searchResult.results.length > 0) {
      console.log('✅ Settings found:');
      for (const result of searchResult.results) {
        console.log(`  - ${result.setting_key}: ${result.setting_value} (user_code: ${result.user_code})`);
      }
      
      // Check specifically for calendar_id
      const calendarSetting = searchResult.results.find(r => r.setting_key === 'calendar_id');
      if (calendarSetting) {
        console.log(`🗓️ Calendar ID found: ${calendarSetting.setting_value}`);
      } else {
        console.log('❌ No calendar_id setting found');
      }
    } else {
      console.log('❌ No settings found for this user_code');
      
      // Try searching without filter to see all data
      console.log('\n🔍 Searching all settings (no filter):');
      const allResults = await client.search({
        collection_name: collectionName,
        vectors: [[0.1, 0.2]],
        search_params: { nprobe: 10 },
        limit: 20,
        output_fields: ['setting_key', 'setting_value', 'user_id', 'user_code']
      });
      
      console.log(`- Total settings in DB: ${allResults.results ? allResults.results.length : 0}`);
      if (allResults.results && allResults.results.length > 0) {
        console.log('📋 Available settings:');
        for (const result of allResults.results) {
          console.log(`  - Key: ${result.setting_key}, User: ${result.user_id || 'N/A'}, Code: ${result.user_code || 'N/A'}`);
        }
      }
    }

    return {
      success: true,
      userCode: userCode,
      resultsFound: searchResult.results ? searchResult.results.length : 0,
      settings: searchResult.results || []
    };

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
