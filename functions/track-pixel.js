exports.handler = async (event, context) => {
  try {
    // Get tracking ID from path
    const trackingId = event.path.split('/').pop().replace('.png', '');
    
    if (trackingId) {
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
            event_type: 'email_open',
            timestamp: new Date().toISOString(),
            user_agent: event.headers['user-agent'] || 'Unknown',
            ip_address: event.headers['x-forwarded-for'] || 'Unknown',
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
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      },
      body: pixel.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/gif' },
      body: ''
    };
  }
};
