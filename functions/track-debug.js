// Debug version of track-pixel that returns JSON instead of image
export async function handler(event, context) {
  try {
    console.log('[DEBUG TRACK] Event:', event);
    console.log('[DEBUG TRACK] Query params:', event.queryStringParameters);
    
    const emailId = event.queryStringParameters?.email_id || 'unknown';
    
    // Check environment variables
    const envCheck = {
      hasZillizEndpoint: !!process.env.ZILLIZ_ENDPOINT,
      hasZillizToken: !!process.env.ZILLIZ_TOKEN
    };
    
    console.log('[DEBUG TRACK] Environment check:', envCheck);
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: false,
          error: 'Missing Zilliz credentials',
          emailId: emailId,
          environment: envCheck,
          timestamp: new Date().toISOString()
        })
      };
    }

    // Try to connect to Zilliz
    try {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      
      const client = new MilvusClient({
        address: process.env.ZILLIZ_ENDPOINT,
        token: process.env.ZILLIZ_TOKEN,
      });

      // Test connection by checking collections
      const collections = await client.listCollections();
      console.log('[DEBUG TRACK] Zilliz collections:', collections);
      
      // Try to store a test tracking event
      const trackingData = {
        id: `debug-${Date.now()}`,
        email_id: emailId,
        event_type: 'debug_test',
        timestamp: new Date().toISOString(),
        ip_address: event.headers['x-forwarded-for'] || 'unknown',
        user_agent: event.headers['user-agent'] || 'unknown',
        vector: new Array(128).fill(0.1) // Simple test vector
      };

      // Check if email_tracking collection exists
      let collectionExists = false;
      try {
        await client.describeCollection({ collection_name: 'email_tracking' });
        collectionExists = true;
      } catch (error) {
        console.log('[DEBUG TRACK] Collection does not exist:', error.message);
      }

      let insertResult = null;
      if (collectionExists) {
        try {
          insertResult = await client.insert({
            collection_name: 'email_tracking',
            data: [trackingData]
          });
          console.log('[DEBUG TRACK] Insert result:', insertResult);
        } catch (insertError) {
          console.error('[DEBUG TRACK] Insert failed:', insertError);
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          emailId: emailId,
          environment: envCheck,
          zillizConnection: 'success',
          collections: collections,
          collectionExists: collectionExists,
          insertResult: insertResult,
          trackingData: trackingData,
          timestamp: new Date().toISOString()
        })
      };

    } catch (zillizError) {
      console.error('[DEBUG TRACK] Zilliz error:', zillizError);
      
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: false,
          error: 'Zilliz connection failed',
          details: zillizError.message,
          emailId: emailId,
          environment: envCheck,
          timestamp: new Date().toISOString()
        })
      };
    }

  } catch (error) {
    console.error('[DEBUG TRACK] General error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Function error',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}
