// Simple test endpoint to test the get_user_settings tool directly
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const milvusClient = new MilvusClient({
  address: process.env.ZILLIZ_ENDPOINT?.trim(),
  token: process.env.ZILLIZ_TOKEN?.trim(),
});

export default async function handler(event, context) {
  try {
    console.log('[TEST] Testing get_user_settings tool...');
    
    // Extract user ID from tracking ID (simulating the real flow)
    const trackingId = "tracking-76e84c79_1758579516141_3b71eee1";
    
    function extractUserIdFromTrackingId(trackingId) {
      if (!trackingId) return null;
      const match = trackingId.match(/tracking-([a-f0-9]{8})/);
      return match ? match[1] : null;
    }
    
    const userId = extractUserIdFromTrackingId(trackingId);
    console.log('[TEST] Extracted userId:', userId);
    
    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Could not extract user ID from tracking ID' })
      };
    }

    // Helper function to escape strings for Zilliz queries (ChatGPT's fix)
    function esc(s) { return String(s).replace(/(["\\])/g, '\\$1'); }
    
    // Helper to get a specific setting by exact field name (ChatGPT's fix)
    async function getSetting(key) {
      console.log('[TEST] Querying for key:', key);
      const res = await milvusClient.query({
        collection_name: 'agent_settings',
        expr: `field_name == "${esc(key)}"`,
        output_fields: ['field_name', 'field_value', 'field_type'],
        limit: 1,
        consistency_level: 'Strong'
      });
      const rows = res.data || res || [];
      console.log('[TEST] Query result for', key, ':', JSON.stringify(rows, null, 2));
      return rows.length ? rows[0].field_value : undefined;
    }
    
    // Default settings
    const settings = {
      calendar_id: 'primary',
      company_name: 'Exabits', 
      timezone: 'America/Los_Angeles',
      response_tone: 'professional_friendly'
    };
    
    // Test each setting lookup
    console.log('[TEST] Testing calendar_id lookup...');
    const calendarId = await getSetting(`calendar_id_user_${userId}`);
    if (calendarId) {
      settings.calendar_id = String(calendarId).trim();
      console.log(`[TEST] Found calendar_id: ${settings.calendar_id}`);
    } else {
      console.log('[TEST] No calendar_id found, using default');
    }
    
    console.log('[TEST] Testing timezone lookup...');
    const timezone = await getSetting(`timezone_user_${userId}`);
    if (timezone) {
      settings.timezone = String(timezone).trim();
    }
    
    console.log('[TEST] Testing company_info lookup...');
    const companyInfo = await getSetting(`company_info_user_${userId}`);
    if (companyInfo) {
      try {
        const obj = JSON.parse(companyInfo);
        settings.company_name = obj.name || obj.company_name || settings.company_name;
      } catch {
        settings.company_name = String(companyInfo).trim();
      }
    }
    
    console.log('[TEST] Testing response_tone lookup...');
    const responseTone = await getSetting(`response_tone_user_${userId}`);
    if (responseTone) {
      settings.response_tone = String(responseTone).trim();
    }
    
    console.log(`[TEST] Final settings:`, settings);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        userId: userId,
        trackingId: trackingId,
        settings: settings,
        debug: {
          calendar_id_raw: calendarId,
          timezone_raw: timezone,
          company_info_raw: companyInfo,
          response_tone_raw: responseTone
        }
      }, null, 2)
    };
    
  } catch (error) {
    console.error('[TEST] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      })
    };
  }
}
