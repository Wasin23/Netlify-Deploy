import crypto from 'crypto';

// Netlify serverless function to handle Mailgun webhooks for email replies
export async function handler(event, context) {
  console.log('[NETLIFY WEBHOOK] Received webhook:', {
    method: event.httpMethod,
    headers: event.headers,
    bodyLength: event.body?.length || 0
  });

  // Only handle POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the form data from Mailgun
    const body = new URLSearchParams(event.body);
    const formData = Object.fromEntries(body);
    
    console.log('[NETLIFY WEBHOOK] Parsed form data keys:', Object.keys(formData));
    console.log('[NETLIFY WEBHOOK] From:', formData.From || formData.from);
    console.log('[NETLIFY WEBHOOK] Subject:', formData.Subject || formData.subject);
    
    // Verify webhook signature if signing key is available
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (signingKey) {
      const signature = formData.signature;
      const token = formData.token;
      const timestamp = formData.timestamp;
      
      if (!verifyWebhookSignature(token, timestamp, signature, signingKey)) {
        console.log('[NETLIFY WEBHOOK] Invalid signature');
        return {
          statusCode: 401,
          headers: {
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ error: 'Unauthorized' })
        };
      }
    }

    // Extract email data
    const emailData = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      from: formData.From || formData.from,
      to: formData.To || formData.to,
      subject: formData.Subject || formData.subject,
      body: formData['body-plain'] || formData['stripped-text'] || '',
      bodyHtml: formData['body-html'] || formData['stripped-html'] || '',
      messageId: formData['Message-Id'] || formData['message-id'],
      references: formData.References || formData.references,
      inReplyTo: formData['In-Reply-To'] || formData['in-reply-to']
    };

    console.log('[NETLIFY WEBHOOK] Reply received from:', emailData.from);
    console.log('[NETLIFY WEBHOOK] Body preview:', emailData.body?.substring(0, 100));

    // Try to extract tracking ID to link this reply to original email
    const trackingId = extractTrackingId(formData, emailData.subject, emailData.body);
    
    if (trackingId) {
      console.log('[NETLIFY WEBHOOK] Found tracking ID:', trackingId);
      emailData.originalTrackingId = trackingId;
      
      // Store reply in Zilliz with AI analysis
      try {
        await storeReplyInZilliz(emailData, trackingId);
        console.log('💬 [NETLIFY WEBHOOK] Reply stored in Zilliz with AI analysis');
      } catch (error) {
        console.error('❌ [NETLIFY WEBHOOK] Failed to store reply in Zilliz:', error);
      }
    } else {
      console.log('[NETLIFY WEBHOOK] No tracking ID found in reply');
    }

    // Return success response
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Reply processed successfully',
        replyId: emailData.id,
        trackingId: trackingId || null,
        timestamp: emailData.timestamp
      })
    };

  } catch (error) {
    console.error('[NETLIFY WEBHOOK] Error processing webhook:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message
      })
    };
  }
}

// Function to verify Mailgun webhook signature
function verifyWebhookSignature(token, timestamp, signature, signingKey) {
  const value = timestamp + token;
  const hash = crypto
    .createHmac('sha256', signingKey)
    .update(value)
    .digest('hex');
  return hash === signature;
}

// Function to extract tracking ID from various sources
function extractTrackingId(formData, subject, body) {
  // Method 1: Look for tracking ID in subject line
  const subjectMatch = subject?.match(/\[(\w+)\]/);
  if (subjectMatch) {
    return subjectMatch[1];
  }
  
  // Method 2: Look for tracking ID in body text
  const bodyMatch = body?.match(/tracking[_\s]*id[:\s]*(\w+)/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }
  
  // Method 3: Look in In-Reply-To header for message ID patterns
  const inReplyTo = formData['In-Reply-To'] || formData['in-reply-to'];
  if (inReplyTo) {
    const headerMatch = inReplyTo.match(/(\w{8,})/);
    if (headerMatch) {
      return headerMatch[1];
    }
  }
  
  // Method 4: Look in References header
  const references = formData.References || formData.references;
  if (references) {
    const refMatch = references.match(/(\w{8,})/);
    if (refMatch) {
      return refMatch[1];
    }
  }
  
  return null;
}

// Function to store reply in Zilliz with AI analysis
async function storeReplyInZilliz(emailData, trackingId) {
  try {
    // Import Zilliz client
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    // Simple AI sentiment analysis
    const sentiment = analyzeSentiment(emailData.body);
    const intent = classifyIntent(emailData.body);
    
    // Prepare reply data for storage
    const replyData = {
      id: emailData.id,
      tracking_id: trackingId,
      from_email: emailData.from,
      subject: emailData.subject,
      content: emailData.body,
      timestamp: emailData.timestamp,
      sentiment: sentiment,
      intent: intent,
      message_id: emailData.messageId,
      // Vector embedding (simplified - in production you'd use actual embeddings)
      vector: generateSimpleVector(emailData.body)
    };

    // Check if replies collection exists, create if not
    try {
      await client.describeCollection({ collection_name: 'email_replies' });
    } catch (error) {
      // Collection doesn't exist, create it
      await createRepliesCollection(client);
    }

    // Insert reply data
    await client.insert({
      collection_name: 'email_replies',
      data: [replyData]
    });

    console.log(`💬 [ZILLIZ] Reply stored: ${sentiment} sentiment, ${intent} intent`);
    
  } catch (error) {
    console.error('❌ [ZILLIZ] Failed to store reply:', error);
    throw error;
  }
}

// Simple sentiment analysis
function analyzeSentiment(text) {
  const lowerText = text.toLowerCase();
  
  const positiveWords = ['great', 'awesome', 'excellent', 'love', 'perfect', 'amazing', 'wonderful', 'fantastic', 'yes', 'interested', 'thank you', 'thanks'];
  const negativeWords = ['terrible', 'awful', 'hate', 'horrible', 'bad', 'worst', 'no', 'not interested', 'unsubscribe', 'stop', 'remove'];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  positiveWords.forEach(word => {
    if (lowerText.includes(word)) positiveCount++;
  });
  
  negativeWords.forEach(word => {
    if (lowerText.includes(word)) negativeCount++;
  });
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

// Simple intent classification
function classifyIntent(text) {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('unsubscribe') || lowerText.includes('remove') || lowerText.includes('stop')) {
    return 'unsubscribe';
  }
  
  if (lowerText.includes('meeting') || lowerText.includes('call') || lowerText.includes('schedule')) {
    return 'meeting_request';
  }
  
  if (lowerText.includes('interested') || lowerText.includes('tell me more') || lowerText.includes('learn more')) {
    return 'interested';
  }
  
  if (lowerText.includes('not interested') || lowerText.includes('no thank') || lowerText.includes('not now')) {
    return 'not_interested';
  }
  
  if (lowerText.includes('question') || lowerText.includes('how') || lowerText.includes('what') || lowerText.includes('?')) {
    return 'question';
  }
  
  return 'general_response';
}

// Generate simple vector for text (in production, use proper embeddings)
function generateSimpleVector(text) {
  const vector = new Array(128).fill(0);
  for (let i = 0; i < text.length && i < 128; i++) {
    vector[i] = text.charCodeAt(i) / 255;
  }
  return vector;
}

// Create replies collection in Zilliz
async function createRepliesCollection(client) {
  const schema = {
    collection_name: 'email_replies',
    description: 'Email reply tracking with AI analysis',
    fields: [
      {
        name: 'id',
        data_type: 'VarChar',
        max_length: 100,
        is_primary_key: true,
      },
      {
        name: 'tracking_id',
        data_type: 'VarChar',
        max_length: 100,
      },
      {
        name: 'from_email',
        data_type: 'VarChar',
        max_length: 255,
      },
      {
        name: 'subject',
        data_type: 'VarChar',
        max_length: 500,
      },
      {
        name: 'content',
        data_type: 'VarChar',
        max_length: 5000,
      },
      {
        name: 'timestamp',
        data_type: 'VarChar',
        max_length: 50,
      },
      {
        name: 'sentiment',
        data_type: 'VarChar',
        max_length: 20,
      },
      {
        name: 'intent',
        data_type: 'VarChar',
        max_length: 50,
      },
      {
        name: 'message_id',
        data_type: 'VarChar',
        max_length: 255,
      },
      {
        name: 'vector',
        data_type: 'FloatVector',
        dim: 128,
      },
    ],
  };

  await client.createCollection(schema);
  
  // Create index for vector search
  await client.createIndex({
    collection_name: 'email_replies',
    field_name: 'vector',
    index_type: 'IVF_FLAT',
    metric_type: 'L2',
    params: { nlist: 1024 }
  });

  console.log('📦 [ZILLIZ] Email replies collection created');
}
