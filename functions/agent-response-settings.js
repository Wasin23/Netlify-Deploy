// Function to save agent response settings to Zilliz (single column)
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const milvusClient = new MilvusClient({
  address: process.env.ZILLIZ_ENDPOINT?.trim(),
  token: process.env.ZILLIZ_TOKEN?.trim(),
});

export const handler = async (event, context) => {
  try {
    const method = event.httpMethod;
    
    if (method === 'POST') {
      // Save user agent response settings
      const body = JSON.parse(event.body);
      const { userId, settings } = body;
      
      if (!userId || !settings) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'userId and settings required' })
        };
      }
      
      return await saveAgentSettings(userId, settings);
      
    } else if (method === 'GET') {
      // Get user agent response settings
      const userId = event.queryStringParameters?.userId || '76e84c79';
      return await getAgentSettings(userId);
    }
    
  } catch (error) {
    console.error('[AGENT-SETTINGS] Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function ensureAgentSettingsCollection() {
  try {
    const collections = await milvusClient.listCollections();
    const hasCollection = collections.data.some(col => col.name === 'agent_response_settings');
    
    if (!hasCollection) {
      console.log('[AGENT-SETTINGS] Creating agent_response_settings collection...');
      
      await milvusClient.createCollection({
        collection_name: 'agent_response_settings',
        fields: [
          {
            name: 'id',
            description: 'Auto-generated ID',
            data_type: 'Int64',
            is_primary_key: true,
            autoID: true,
          },
          {
            name: 'user_code',
            description: '8-character user code',
            data_type: 'VarChar',
            max_length: 50,
          },
          {
            name: 'settings_json',
            description: 'All agent response settings as JSON',
            data_type: 'VarChar',
            max_length: 8000,
          },
          {
            name: 'updated_at',
            description: 'Last update timestamp',
            data_type: 'VarChar',
            max_length: 50,
          }
        ]
      });
      
      console.log('[AGENT-SETTINGS] Collection created');
    }
    
    await milvusClient.loadCollection({ collection_name: 'agent_response_settings' });
  } catch (error) {
    console.error('[AGENT-SETTINGS] Error ensuring collection:', error);
    throw error;
  }
}

async function saveAgentSettings(userId, settings) {
  try {
    await ensureAgentSettingsCollection();
    
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(settings);
    
    // Delete existing record for this user
    try {
      await milvusClient.delete({
        collection_name: 'agent_response_settings',
        expr: `user_code == "${userId.replace(/["\\]/g, '\\$&')}"`
      });
    } catch (e) {
      // Ignore if no existing record
    }
    
    // Insert new record
    const insertResult = await milvusClient.insert({
      collection_name: 'agent_response_settings',
      data: [{
        user_code: userId,
        settings_json: settingsJson,
        updated_at: now
      }]
    });
    
    console.log('[AGENT-SETTINGS] Settings saved for user:', userId);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        userId: userId,
        settings: settings,
        updated_at: now
      })
    };
    
  } catch (error) {
    console.error('[AGENT-SETTINGS] Error saving settings:', error);
    throw error;
  }
}

async function getAgentSettings(userId) {
  try {
    await ensureAgentSettingsCollection();
    
    const result = await milvusClient.query({
      collection_name: 'agent_response_settings',
      expr: `user_code == "${userId.replace(/["\\]/g, '\\$&')}"`,
      output_fields: ['user_code', 'settings_json', 'updated_at'],
      limit: 1,
      consistency_level: 'Strong'
    });
    
    const rows = result.data || result || [];
    
    if (rows.length === 0) {
      // Return default settings
      const defaultSettings = {
        calendar_id: 'colton.fidd@gmail.com',
        company_name: 'Exabits',
        timezone: 'America/Los_Angeles',
        response_tone: 'professional_friendly'
      };
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          userId: userId,
          settings: defaultSettings,
          isDefault: true
        })
      };
    }
    
    const settings = JSON.parse(rows[0].settings_json);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        userId: userId,
        settings: settings,
        updated_at: rows[0].updated_at,
        isDefault: false
      })
    };
    
  } catch (error) {
    console.error('[AGENT-SETTINGS] Error getting settings:', error);
    throw error;
  }
}
