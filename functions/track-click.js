exports.handler = async (event, context) => {
  try {
    // Get tracking ID from path parameter or query parameter
    let trackingId = event.queryStringParameters?.email_id;
    
    if (!trackingId) {
      // Extract from path (e.g., /track/click/abc123)
      const pathParts = event.path.split('/');
      trackingId = pathParts[pathParts.length - 1];
    }
    
    const redirectUrl = event.queryStringParameters?.url;
    
    console.log('Click tracking:', { trackingId, redirectUrl, path: event.path, query: event.queryStringParameters });
    
    if (!trackingId || !redirectUrl) {
      return {
        statusCode: 400,
        body: 'Missing parameters'
      };
    }

    // Store to Zilliz
    try {
      const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
      
      if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
        const client = new MilvusClient({
          address: process.env.ZILLIZ_ENDPOINT,
          token: process.env.ZILLIZ_TOKEN
        });

        const data = [{
          tracking_id: trackingId,
          event_type: 'link_click',
          timestamp: new Date().toISOString(),
          user_agent: event.headers['user-agent'] || 'Unknown',
          ip_address: event.headers['x-forwarded-for'] || 'Unknown',
          clicked_url: redirectUrl,
          email_address: 'Unknown',
          recipient: 'Unknown',
          processed: false,
          dummy_vector: [0.0, 0.0]
        }];

        await client.insert({
          collection_name: 'email_tracking_events',
          data: data
        });
      }
    } catch (e) {
      console.log('Zilliz error:', e);
    }

    // Redirect
    return {
      statusCode: 302,
      headers: {
        'Location': redirectUrl,
        'Cache-Control': 'no-cache'
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: 'Error'
    };
  }
};
