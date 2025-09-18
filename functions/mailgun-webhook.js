import crypto from 'crypto';

// Enhanced Netlify serverless function for Mailgun webhooks with AI response generation
export async function handler(event, context) {
  console.log('[NETLIFY WEBHOOK] Received webhook:', {
    method: event.httpMethod,
    headers: event.headers,
    bodyLength: event.body?.length || 0,
    envVars: {
      hasZillizEndpoint: !!process.env.ZILLIZ_ENDPOINT,
      hasZillizToken: !!process.env.ZILLIZ_TOKEN,
      hasOpenAI: !!process.env.OPENAI_API_KEY
    }
  });

  // Handle GET requests for querying stored replies
  if (event.httpMethod === 'GET') {
    try {
      const trackingId = event.queryStringParameters?.tracking_id;
      if (trackingId) {
        const replies = await getRepliesForTrackingId(trackingId);
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            trackingId: trackingId,
            replies: replies,
            count: replies.length
          })
        };
      } else {
        // Return recent replies
        const recentReplies = await getRecentReplies(10);
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            recentReplies: recentReplies,
            count: recentReplies.length
          })
        };
      }
    } catch (error) {
      console.error('[NETLIFY WEBHOOK] Query error:', error);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.message })
      };
    }
  }

  // Only handle POST requests for webhooks
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the form data from Mailgun
    const body = new URLSearchParams(event.body);
    const formData = Object.fromEntries(body);
    
    console.log('[NETLIFY WEBHOOK] Raw event body:', event.body);
    console.log('[NETLIFY WEBHOOK] Parsed form data:', formData);
    console.log('[NETLIFY WEBHOOK] Form data keys:', Object.keys(formData));
    console.log('[NETLIFY WEBHOOK] From:', formData.From || formData.from || formData.sender);
    console.log('[NETLIFY WEBHOOK] Subject:', formData.Subject || formData.subject);
    
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
    
    let zillizResult = null;
    let aiResponse = null;
    
    if (trackingId) {
      console.log('[NETLIFY WEBHOOK] Found tracking ID:', trackingId);
      emailData.originalTrackingId = trackingId;
      
      // Generate AI response suggestion first
      try {
        aiResponse = await generateAIResponse(emailData);
        console.log('🤖 [NETLIFY WEBHOOK] AI response generated');
        
        // Automatically send the AI response back to the customer
        if (aiResponse && aiResponse.success && aiResponse.response) {
          try {
            const emailSent = await sendAutoResponse(emailData, aiResponse.response, trackingId);
            aiResponse.emailSent = emailSent;
            console.log('📧 [NETLIFY WEBHOOK] Auto-response sent:', emailSent.success);
          } catch (emailError) {
            console.error('❌ [NETLIFY WEBHOOK] Failed to send auto-response:', emailError);
            aiResponse.emailSent = { success: false, error: emailError.message };
          }
        }
      } catch (error) {
        console.error('❌ [NETLIFY WEBHOOK] Failed to generate AI response:', error);
        aiResponse = { error: error.message };
      }

      // Store reply in Zilliz with AI response chain
      try {
        zillizResult = await storeReplyInZilliz(emailData, trackingId, aiResponse);
        console.log('💬 [NETLIFY WEBHOOK] Zilliz result with AI response:', zillizResult);
      } catch (error) {
        console.error('❌ [NETLIFY WEBHOOK] Failed to store reply in Zilliz:', error);
        zillizResult = { error: error.message, success: false };
      }
    } else {
      console.log('[NETLIFY WEBHOOK] No tracking ID found in reply');
    }

    // Return comprehensive response
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
        timestamp: emailData.timestamp,
        analysis: {
          sentiment: analyzeSentiment(emailData.body),
          intent: classifyIntent(emailData.body)
        },
        zillizStorage: zillizResult,
        aiResponse: aiResponse,
        autoEmailSent: aiResponse?.emailSent || null,
        debugInfo: {
          hasZillizCreds: !!(process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN),
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          hasMailgun: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
          bodyLength: emailData.body?.length || 0
        }
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
        message: error.message,
        debugInfo: {
          hasZillizCreds: !!(process.env.ZILLIZ_ENDPOINT && process.env.ZILLIZ_TOKEN),
          hasOpenAI: !!process.env.OPENAI_API_KEY,
          hasMailgun: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)
        }
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

// Enhanced function to store reply in Zilliz with better error handling
async function storeReplyInZilliz(emailData, trackingId, aiResponse = null) {
  try {
    console.log('[ZILLIZ] Attempting to store reply...');
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('[ZILLIZ] Missing environment variables');
      return { success: false, error: 'Missing Zilliz credentials', stored: false };
    }

    // Import Zilliz client
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    console.log('[ZILLIZ] Client created successfully');

    // AI analysis
    const sentiment = analyzeSentiment(emailData.body);
    const intent = classifyIntent(emailData.body);
    
    // Prepare reply data for storage with AI response chain
    const replyData = {
      id: emailData.id,
      tracking_id: trackingId,
      from_email: emailData.from,
      subject: emailData.subject,
      content: emailData.body || 'No content',
      timestamp: emailData.timestamp,
      sentiment: sentiment,
      intent: intent,
      message_id: emailData.messageId || '',
      // Store AI response chain
      ai_response: aiResponse?.response || null,
      ai_response_sent: aiResponse?.emailSent?.success || false,
      ai_response_timestamp: aiResponse?.emailSent?.timestamp || null,
      ai_response_message_id: aiResponse?.emailSent?.messageId || null,
      // Vector embedding (simplified - in production you'd use actual embeddings)
      vector: generateSimpleVector(emailData.body || '')
    };

    console.log('[ZILLIZ] Prepared reply data with AI response:', { 
      id: replyData.id, 
      sentiment, 
      intent,
      hasAiResponse: !!aiResponse?.response,
      aiResponseSent: replyData.ai_response_sent
    });

    // Check if replies collection exists, create if not
    try {
      await client.describeCollection({ collection_name: 'email_replies' });
      console.log('[ZILLIZ] Collection exists');
    } catch (error) {
      console.log('[ZILLIZ] Creating new collection...');
      await createRepliesCollection(client);
    }

    // Insert reply data
    const insertResult = await client.insert({
      collection_name: 'email_replies',
      data: [replyData]
    });

    console.log(`💬 [ZILLIZ] Reply stored successfully: ${sentiment} sentiment, ${intent} intent`);
    
    return {
      success: true,
      stored: true,
      sentiment: sentiment,
      intent: intent,
      insertResult: insertResult
    };
    
  } catch (error) {
    console.error('❌ [ZILLIZ] Failed to store reply:', error);
    return {
      success: false,
      error: error.message,
      stored: false
    };
  }
}

// Function to automatically send AI response via Mailgun
async function sendAutoResponse(originalEmailData, aiResponseText, trackingId) {
  try {
    console.log('[AUTO RESPONSE] Preparing to send response...');
    
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      console.log('[AUTO RESPONSE] Missing Mailgun credentials');
      return { 
        success: false, 
        error: 'Missing Mailgun API credentials',
        sent: false 
      };
    }

    const fromEmail = `ExaMark Support <noreply@${process.env.MAILGUN_DOMAIN}>`;
    const toEmail = originalEmailData.from;
    const subject = generateReplySubject(originalEmailData.subject, trackingId);
    
    console.log('[AUTO RESPONSE] Email details:', { 
      fromEmail, 
      toEmail, 
      subject,
      hasAiResponse: !!aiResponseText,
      responseLength: aiResponseText?.length 
    });
    
    // Simple text content - no HTML for now to avoid encoding issues
    const textContent = `${aiResponseText}

---
This is an automated response powered by AI. If you need immediate assistance, please don't hesitate to reach out directly.

Best regards,
The ExaMark Team

Message ID: ${trackingId} | Powered by ExaMark AI`;

    // Send email via Mailgun API - simplified version
    const params = new URLSearchParams();
    params.append('from', fromEmail);
    params.append('to', toEmail);
    params.append('subject', subject);
    params.append('text', textContent);
    
    console.log('[AUTO RESPONSE] Sending email...', { 
      from: fromEmail, 
      to: toEmail, 
      subject,
      textLength: textContent.length 
    });

    const response = await fetch(`https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${process.env.MAILGUN_API_KEY}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    let result;
    try {
      const responseText = await response.text();
      console.log('[AUTO RESPONSE] Raw response:', responseText);
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[AUTO RESPONSE] Failed to parse response as JSON:', parseError);
      const responseText = await response.text();
      return {
        success: false,
        sent: false,
        error: `Invalid response format: ${responseText.substring(0, 100)}`,
        statusCode: response.status
      };
    }
    
    if (response.ok) {
      console.log('✅ [AUTO RESPONSE] Email sent successfully:', result.id);
      return {
        success: true,
        sent: true,
        messageId: result.id,
        from: fromEmail,
        to: toEmail,
        subject: subject,
        timestamp: new Date().toISOString()
      };
    } else {
      console.error('❌ [AUTO RESPONSE] Failed to send email:', result);
      return {
        success: false,
        sent: false,
        error: result.message || 'Failed to send email',
        details: result
      };
    }
    
  } catch (error) {
    console.error('❌ [AUTO RESPONSE] Error sending email:', error);
    return {
      success: false,
      sent: false,
      error: error.message
    };
  }
}

// Function to generate appropriate reply subject
function generateReplySubject(originalSubject, trackingId) {
  // Remove existing Re: prefixes
  let cleanSubject = originalSubject?.replace(/^(Re:\s*)+/i, '') || 'Your message';
  
  // Add our reply prefix
  return `Re: ${cleanSubject}`;
}

// Function to generate AI response suggestions
async function generateAIResponse(emailData) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return generateRuleBasedResponse(emailData);
    }

    // Use OpenAI API to generate smart responses
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a professional business email assistant. Generate appropriate, helpful responses to customer emails. Keep responses professional, concise, and actionable. Always be positive and helpful.'
          },
          {
            role: 'user',
            content: `Generate a professional response to this customer email:

From: ${emailData.from}
Subject: ${emailData.subject}
Message: ${emailData.body}

Please suggest an appropriate response that addresses their needs.`
          }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    const aiResult = await response.json();
    
    if (aiResult.choices && aiResult.choices[0]) {
      return {
        success: true,
        response: aiResult.choices[0].message.content.trim(),
        provider: 'OpenAI GPT-3.5'
      };
    } else {
      throw new Error('No AI response generated');
    }

  } catch (error) {
    console.error('[AI RESPONSE] Error:', error);
    return generateRuleBasedResponse(emailData);
  }
}

// Fallback rule-based response generation
function generateRuleBasedResponse(emailData) {
  const body = emailData.body?.toLowerCase() || '';
  const sentiment = analyzeSentiment(emailData.body);
  const intent = classifyIntent(emailData.body);

  let response = '';

  if (intent === 'unsubscribe') {
    response = `Thank you for your message. I understand you'd like to unsubscribe. I'll make sure you're removed from our mailing list right away. Is there anything specific that prompted this decision that we could improve on?`;
  } else if (intent === 'meeting_request') {
    response = `Thank you for your interest! I'd be happy to schedule a meeting with you. I have availability this week on Tuesday, Wednesday, or Friday afternoons. What time works best for you? Please let me know your preferred time zone as well.`;
  } else if (intent === 'interested') {
    response = `That's wonderful to hear! I'm excited that you're interested in learning more. I'd love to provide you with additional information and answer any questions you might have. Would you prefer a quick call this week or should I send you some detailed materials to review first?`;
  } else if (intent === 'not_interested') {
    response = `Thank you for taking the time to let me know. I completely understand that timing isn't always right. I'll make a note in our system. If your situation changes in the future, please don't hesitate to reach out. Wishing you all the best!`;
  } else if (intent === 'question') {
    response = `Thank you for your question! I want to make sure I give you the most accurate and helpful information. Let me look into this for you and get back to you with a detailed answer within 24 hours. In the meantime, if you have any other questions, please don't hesitate to ask.`;
  } else if (sentiment === 'positive') {
    response = `Thank you so much for your positive feedback! It really means a lot to our team. I'd love to continue our conversation and see how we can help you achieve your goals. Would you like to schedule a brief call to discuss next steps?`;
  } else if (sentiment === 'negative') {
    response = `Thank you for sharing your concerns with me. Your feedback is valuable and I want to make sure we address any issues you're experiencing. Could we schedule a quick call to discuss this further? I'm committed to finding a solution that works for you.`;
  } else {
    response = `Thank you for your email! I appreciate you taking the time to reach out. I want to make sure I address your message properly - could you let me know the best way to help you? I'm here to answer any questions or provide additional information you might need.`;
  }

  return {
    success: true,
    response: response,
    provider: 'Rule-based AI',
    analysis: { sentiment, intent }
  };
}

// Function to get replies for a specific tracking ID
async function getRepliesForTrackingId(trackingId) {
  try {
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      return [];
    }

    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    const searchResult = await client.search({
      collection_name: 'email_replies',
      vector: [],
      filter: `tracking_id == "${trackingId}"`,
      limit: 100,
      output_fields: ['id', 'tracking_id', 'from_email', 'subject', 'content', 'timestamp', 'sentiment', 'intent', 'ai_response', 'ai_response_sent', 'ai_response_timestamp', 'ai_response_message_id']
    });

    return searchResult.results || [];
  } catch (error) {
    console.error('[QUERY] Error getting replies:', error);
    return [];
  }
}

// Function to get recent replies
async function getRecentReplies(limit = 10) {
  try {
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      return [];
    }

    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    const searchResult = await client.search({
      collection_name: 'email_replies',
      vector: [],
      limit: limit,
      output_fields: ['id', 'tracking_id', 'from_email', 'subject', 'content', 'timestamp', 'sentiment', 'intent', 'ai_response', 'ai_response_sent', 'ai_response_timestamp', 'ai_response_message_id']
    });

    return searchResult.results || [];
  } catch (error) {
    console.error('[QUERY] Error getting recent replies:', error);
    return [];
  }
}

// Simple sentiment analysis
function analyzeSentiment(text) {
  const lowerText = (text || '').toLowerCase();
  
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
  const lowerText = (text || '').toLowerCase();
  
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

// Generate simple vector for text
function generateSimpleVector(text) {
  const vector = new Array(128).fill(0);
  const cleanText = (text || '').substring(0, 128);
  for (let i = 0; i < cleanText.length; i++) {
    vector[i] = cleanText.charCodeAt(i) / 255;
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
