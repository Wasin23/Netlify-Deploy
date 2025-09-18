exports.handler = async (event, context) => {
  try {
    // Get tracking ID from path parameter or query parameter
    let trackingId = event.queryStringParameters?.email_id;
    
    if (!trackingId) {
      // Extract from path (e.g., /track/pixel/abc123 or /.netlify/functions/track-pixel/abc123)
      const pathParts = event.path.split('/');
      trackingId = pathParts[pathParts.length - 1];
      
      // Remove .png extension if present
      if (trackingId && trackingId.endsWith('.png')) {
        trackingId = trackingId.slice(0, -4);
      }
    }
    
    console.log('Tracking pixel hit:', { trackingId, path: event.path, query: event.queryStringParameters });
    
    if (trackingId) {
      // Store to Zilliz with deduplication
      try {
        const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
        
        if (process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN) {
          const client = new MilvusClient({
            address: process.env.ZILLIZ_ENDPOINT,
            token: process.env.ZILLIZ_TOKEN
          });

          const userAgent = event.headers['user-agent'] || 'Unknown';
          const ipAddress = event.headers['x-forwarded-for'] || 'Unknown';
          
          // Filter out known bots/proxies that cause duplicates
          const isBot = userAgent.includes('bot') || 
                       userAgent.includes('crawler') || 
                       userAgent.includes('spider') ||
                       userAgent.includes('facebookexternalhit');
          
          // Check if this email has EVER been opened before (single open tracking)
          let alreadyOpened = false;
          try {
            const existingEvents = await client.search({
              collection_name: 'email_tracking_events',
              vectors: [[0.0, 0.0]], // Dummy vector for search
              search_params: { nprobe: 1 },
              output_fields: ['tracking_id', 'event_type'],
              limit: 100
            });
            
            for (const result of existingEvents.results) {
              if (result.tracking_id === trackingId && result.event_type === 'email_open') {
                alreadyOpened = true;
                console.log(`Email ${trackingId} already marked as opened`);
                break;
              }
            }
          } catch (searchError) {
            console.log('Search error (proceeding with insert):', searchError);
          }
          
          // Only insert if not a bot and not already opened
          if (!isBot && !alreadyOpened) {
            const data = [{
              tracking_id: trackingId,
              event_type: 'email_open',
              timestamp: new Date().toISOString(),
              user_agent: userAgent,
              ip_address: ipAddress,
              email_address: 'Unknown',
              recipient: 'Unknown',
              processed: false,
              dummy_vector: [0.0, 0.0]
            }];

            await client.insert({
              collection_name: 'email_tracking_events',
              data: data
            });
            
            console.log(`Email ${trackingId} marked as opened for first time`);
          } else {
            console.log(`Tracking event filtered out for ${trackingId} (bot: ${isBot}, already opened: ${alreadyOpened})`);
          }
        }
      } catch (e) {
        console.log('Zilliz error:', e);
      }
    }

    // Return 1x1 transparent PNG (more Gmail-friendly than GIF)
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': pixel.length.toString()
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
