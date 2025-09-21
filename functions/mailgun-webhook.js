const crypto = require('crypto');
// Use global fetch instead of node-fetch for Netlify compatibility

// TOP-LEVEL IMPORT to prevent Netlify bundler from tree-shaking it out
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Enhanced Netlify serverless function for Mailgun webhooks with AI response generation
exports.handler = async function(event, context) {
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
            
            // Check if we should automatically create a calendar event
            if (aiResponse.intent) {
              try {
                const calendarResult = await handleCalendarEventCreation(emailData, aiResponse, trackingId);
                if (calendarResult.eventCreated) {
                  console.log('📅 [NETLIFY WEBHOOK] Calendar event created successfully:', calendarResult.eventDetails);
                  aiResponse.calendarEvent = calendarResult;
                }
              } catch (calendarError) {
                console.error('❌ [NETLIFY WEBHOOK] Failed to create calendar event:', calendarError);
                aiResponse.calendarEvent = { success: false, error: calendarError.message };
              }
            }
          } catch (emailError) {
            console.error('❌ [NETLIFY WEBHOOK] Failed to send auto-response:', emailError);
            aiResponse.emailSent = { success: false, error: emailError.message };
          }
        }
      } catch (error) {
        console.error('❌ [NETLIFY WEBHOOK] Failed to generate AI response:', error);
        aiResponse = { error: error.message };
      }

      // Store lead message first, then AI response
      try {
        // Store the lead's original message
        const leadMessageResult = await storeLeadMessage(emailData, trackingId);
        console.log('💬 [NETLIFY WEBHOOK] Lead message stored:', leadMessageResult);
        
        // Store AI response
        zillizResult = await storeReplyInZilliz(emailData, trackingId, aiResponse);
        console.log('💬 [NETLIFY WEBHOOK] AI response stored:', zillizResult);
      } catch (error) {
        console.error('❌ [NETLIFY WEBHOOK] Failed to store conversation in Zilliz:', error);
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
  console.log('[EXTRACT] Starting tracking ID extraction...');
  console.log('[EXTRACT] Form data keys:', Object.keys(formData));
  console.log('[EXTRACT] Subject:', subject);
  
  // Method 1: Look for tracking ID in our AI response Message-ID headers
  const inReplyTo = formData['In-Reply-To'] || formData['in-reply-to'];
  if (inReplyTo) {
    console.log('[EXTRACT] Checking In-Reply-To for AI response Message-ID:', inReplyTo);
    // Look for our AI response pattern: <ai-response-TRACKINGID-timestamp@domain>
    const aiResponseMatch = inReplyTo.match(/<ai-response-([a-f0-9]{32})-\d+@/);
    if (aiResponseMatch) {
      console.log('[EXTRACT] Found tracking ID in AI response Message-ID:', aiResponseMatch[1]);
      return aiResponseMatch[1];
    }
    
    // Look for original tracking pattern: <tracking-TRACKINGID@domain>
    const trackingMatch = inReplyTo.match(/<tracking-([a-f0-9]{32})@/);
    if (trackingMatch) {
      console.log('[EXTRACT] Found tracking ID in original Message-ID:', trackingMatch[1]);
      return trackingMatch[1];
    }
  }

  // Method 2: Look for tracking ID in References header
  const references = formData.References || formData.references;
  if (references) {
    console.log('[EXTRACT] Checking References header:', references);
    // Look for our AI response pattern first
    const aiResponseMatch = references.match(/<ai-response-([a-f0-9]{32})-\d+@/);
    if (aiResponseMatch) {
      console.log('[EXTRACT] Found tracking ID in References AI response:', aiResponseMatch[1]);
      return aiResponseMatch[1];
    }
    
    // Look for original tracking pattern
    const trackingMatch = references.match(/<tracking-([a-f0-9]{32})@/);
    if (trackingMatch) {
      console.log('[EXTRACT] Found tracking ID in References original:', trackingMatch[1]);
      return trackingMatch[1];
    }
  }
  
  // Method 3: Look for tracking ID in subject line [TRACKINGID]
  const subjectMatch = subject?.match(/\[([a-f0-9]{32})\]/);
  if (subjectMatch) {
    console.log('[EXTRACT] Found tracking ID in subject:', subjectMatch[1]);
    return subjectMatch[1];
  }
  
  // Method 4: Look for tracking ID in recipient email address
  const recipient = formData.recipient || formData.To || formData.to;
  if (recipient) {
    console.log('[EXTRACT] Checking recipient:', recipient);
    const emailMatch = recipient.match(/tracking-([a-f0-9]{32})@/);
    if (emailMatch) {
      console.log('[EXTRACT] Found tracking ID in recipient:', emailMatch[1]);
      return emailMatch[1];
    }
  }
  
  // Method 5: Look for tracking ID in body text
  const bodyMatch = body?.match(/Message ID:\s*([a-f0-9]{32})/i);
  if (bodyMatch) {
    console.log('[EXTRACT] Found tracking ID in body Message ID:', bodyMatch[1]);
    return bodyMatch[1];
  }
  
  console.log('[EXTRACT] No tracking ID found in any location');
  return null;
}

// Function to create embeddings from text using OpenAI
async function createEmbedding(text) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('[EMBEDDING] No OpenAI API key, using dummy vector');
      return [0.0, 0.0]; // Fallback dummy vector
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-ada-002"
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('[EMBEDDING] Error creating embedding:', error.message);
    return [0.0, 0.0]; // Fallback dummy vector
  }
}

// Enhanced function to store reply in Zilliz with better error handling
async function storeReplyInZilliz(emailData, trackingId, aiResponse = null) {
  try {
    console.log('[ZILLIZ STORE] Attempting to store reply for tracking ID:', trackingId);
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('[ZILLIZ STORE] Missing environment variables');
      return { success: false, error: 'Missing Zilliz credentials', stored: false };
    }

    // Use TOP-LEVEL MilvusClient (no more conditional imports!)
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    // Use the SAME collection as tracking events
    const collectionName = 'email_tracking_events';
    console.log('[ZILLIZ STORE] Using collection:', collectionName);
    
    // Store reply using EXACT same schema as working track-pixel
    const replyData = {
      tracking_id: trackingId,        // Match exact field name
      event_type: 'ai_reply', 
      timestamp: new Date().toISOString(),
      user_agent: `AI_Response: ${aiResponse?.response || 'Generated'}`,  // Store full response
      ip_address: '127.0.0.1',
      email_address: emailData.from || 'Unknown',    // Match track-pixel schema
      recipient: emailData.to || 'Unknown',          // Match track-pixel schema  
      processed: false,                              // Match track-pixel schema
      dummy_vector: [0.0, 0.0]                      // Match exact field name and dimensions
    };

    console.log('[ZILLIZ STORE] Preparing to insert data:', {
      tracking_id: replyData.tracking_id,
      event_type: replyData.event_type,
      user_agent_length: replyData.user_agent.length
    });

    // Load collection first to ensure it's ready
    console.log('[ZILLIZ STORE] Loading collection...');
    try {
      const loadResult = await client.loadCollection({ collection_name: collectionName });
      console.log('[ZILLIZ STORE] Collection loaded:', loadResult);
    } catch (loadError) {
      console.error('[ZILLIZ STORE] Failed to load collection:', loadError);
    }

    console.log('[ZILLIZ STORE] Attempting insert...');
    const insertResult = await client.insert({
      collection_name: collectionName,
      data: [replyData]
    });

    console.log('[ZILLIZ STORE] Insert result:', insertResult);
    
    // Force a flush to ensure data is persisted
    console.log('[ZILLIZ STORE] Flushing data...');
    try {
      const flushResult = await client.flush({ collection_names: [collectionName] });
      console.log('[ZILLIZ STORE] Flush result:', flushResult);
    } catch (flushError) {
      console.error('[ZILLIZ STORE] Flush error (not critical):', flushError);
    }
    
    console.log('[ZILLIZ STORE] Reply stored successfully in same collection');
    
    return { 
      success: true, 
      stored: true,
      collection: collectionName,
      data: replyData
    };

  } catch (error) {
    console.error('[ZILLIZ STORE] Storage error:', error);
    console.error('[ZILLIZ STORE] Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.substring(0, 500)
    });
    return { 
      success: false, 
      error: error.message, 
      stored: false 
    };
  }
}

// Analyze conversation state to determine if conversation should continue
async function analyzeConversationState(originalEmailData, aiResponseText, trackingId) {
  try {
    console.log('[CONVERSATION STATE] Analyzing conversation state...');
    
    const emailBody = originalEmailData.body || '';
    const aiResponse = aiResponseText || '';
    
    // Get conversation history from Zilliz to count interactions
    const conversationHistory = await getConversationHistory(trackingId);
    const interactionCount = conversationHistory.length;
    
    console.log('[CONVERSATION STATE] Interaction count:', interactionCount);
    
    // Use AI to analyze conversation state if OpenAI is available
    if (process.env.OPENAI_API_KEY) {
      const aiAnalysis = await analyzeConversationStateWithAI(emailBody, aiResponse, interactionCount);
      console.log('[CONVERSATION STATE] AI Analysis:', aiAnalysis);
      return aiAnalysis;
    }
    
    // Fallback to keyword detection if no OpenAI
    return analyzeConversationStateWithKeywords(emailBody, aiResponse, interactionCount);
    
  } catch (error) {
    console.error('[CONVERSATION STATE] Error analyzing state:', error);
    // Default to safe behavior - continue conversation
    return {
      state: 'error',
      shouldKeepOpen: true,
      reason: 'Error in analysis, defaulting to continue'
    };
  }
}

// Smart AI-based conversation state analysis
async function analyzeConversationStateWithAI(emailBody, aiResponse, interactionCount) {
  const prompt = `Analyze this email conversation to determine the appropriate next action.

CUSTOMER'S EMAIL: "${emailBody}"

AI RESPONSE SENT: "${aiResponse}"

INTERACTION COUNT: ${interactionCount}

Determine the conversation state. Respond with ONLY one of these JSON objects:

For EXPLICIT REJECTION (customer clearly not interested):
{"state": "rejected", "shouldKeepOpen": false, "reason": "Customer declined or unsubscribed"}

For CONFIRMED MEETING (specific time/date set or booking confirmed):
{"state": "meeting_booked", "shouldKeepOpen": false, "reason": "Meeting successfully scheduled with specific time"}

For ACTIVE ENGAGEMENT (customer asking questions, showing interest):
{"state": "engaged", "shouldKeepOpen": true, "reason": "Customer actively engaging with questions"}

For AUTO-RESPONDER (out of office, vacation message):
{"state": "auto_responder", "shouldKeepOpen": false, "reason": "Automated out-of-office detected"}

For INTERACTION LIMIT (too many back-and-forth, ${interactionCount} >= 5):
{"state": "interaction_limit", "shouldKeepOpen": false, "reason": "Maximum interactions reached"}

For NATURAL END (polite closure, thanks without further questions):
{"state": "natural_end", "shouldKeepOpen": false, "reason": "Conversation naturally concluded"}

IMPORTANT: Only mark as "meeting_booked" if there's a SPECIFIC time/date mentioned or clear confirmation. Questions like "should we schedule?" are NOT bookings.

Respond with ONLY the JSON object, no other text.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100
      })
    });

    const data = await response.json();
    const analysis = JSON.parse(data.choices[0].message.content.trim());
    
    console.log('[CONVERSATION STATE] AI analysis result:', analysis);
    return analysis;

  } catch (error) {
    console.error('[CONVERSATION STATE] AI analysis failed:', error);
    // Fallback to keyword detection
    return analyzeConversationStateWithKeywords(emailBody, aiResponse, interactionCount);
  }
}

// Fallback keyword-based analysis (used when OpenAI unavailable)
async function analyzeConversationStateWithKeywords(emailBody, aiResponse, interactionCount) {
  const emailBodyLower = emailBody.toLowerCase();
    
    // EXPLICIT REJECTION/UNSUBSCRIBE - End conversation immediately
    const rejectionKeywords = [
      'unsubscribe', 'remove me', 'not interested', 'stop emailing',
      'no thanks', 'not a good fit', 'please remove', 'opt out',
      'don\'t contact', 'already have', 'satisfied with current'
    ];
    
    const hasRejection = rejectionKeywords.some(keyword => emailBodyLower.includes(keyword));
    if (hasRejection) {
      console.log('[CONVERSATION STATE] Rejection detected - ending conversation');
      return {
        state: 'rejected',
        shouldKeepOpen: false,
        reason: 'Customer explicitly declined or unsubscribed'
      };
    }
    
    // MEETING BOOKED - Only for CONFIRMED bookings with specific times
    const confirmedMeetingKeywords = [
      'meeting is set for', 'booked for', 'confirmed for', 'scheduled for',
      'see you at', 'meeting at', 'appointment at', 'call at',
      'monday at', 'tuesday at', 'wednesday at', 'thursday at', 'friday at',
      'pm on', 'am on', 'o\'clock'
    ];
    
    const hasMeetingBooked = confirmedMeetingKeywords.some(keyword => emailBodyLower.includes(keyword));
    
    if (hasMeetingBooked) {
      console.log('[CONVERSATION STATE] Confirmed meeting detected - ending conversation');
      return {
        state: 'meeting_booked',
        shouldKeepOpen: false,
        reason: 'Meeting successfully scheduled with specific time'
      };
    }
    
    // ACTIVE ENGAGEMENT - Continue conversation
    const engagementKeywords = [
      'tell me more', 'interested', 'question', 'when', 'how',
      'pricing', 'cost', 'demo', 'trial', 'can you', 'would like',
      'more information', 'learn more', 'sounds good', 'should we schedule'
    ];
    
    const hasEngagement = engagementKeywords.some(keyword => emailBodyLower.includes(keyword));
    
    // INTERACTION LIMIT - Prevent infinite loops (max 5 interactions)
    if (interactionCount >= 5) {
      console.log('[CONVERSATION STATE] Interaction limit reached - ending conversation');
      return {
        state: 'interaction_limit',
        shouldKeepOpen: false,
        reason: 'Maximum interaction count reached (5)'
      };
    }
    
    // AUTO-RESPONDER DETECTION - End if it looks like an auto-reply
    const autoResponderKeywords = [
      'out of office', 'automatic reply', 'auto-generated', 'vacation',
      'currently unavailable', 'away message'
    ];
    
    const isAutoResponder = autoResponderKeywords.some(keyword => emailBodyLower.includes(keyword));
    if (isAutoResponder) {
      console.log('[CONVERSATION STATE] Auto-responder detected - ending conversation');
      return {
        state: 'auto_responder',
        shouldKeepOpen: false,
        reason: 'Auto-responder detected'
      };
    }
    
    // CONTINUE CONVERSATION - Keep engaging
    if (hasEngagement && interactionCount < 3) {
      console.log('[CONVERSATION STATE] Active engagement - continuing conversation');
      return {
        state: 'engaged',
        shouldKeepOpen: true,
        reason: 'Customer showing interest, continuing conversation'
      };
    }
    
    // DEFAULT - End conversation after 2 interactions unless highly engaged
    if (interactionCount >= 2) {
      console.log('[CONVERSATION STATE] Default limit reached - ending conversation');
      return {
        state: 'natural_end',
        shouldKeepOpen: false,
        reason: 'Natural conversation conclusion'
      };
    }
    
    // FIRST INTERACTION - Always continue
    console.log('[CONVERSATION STATE] First interaction - continuing conversation');
    return {
      state: 'first_interaction',
      shouldKeepOpen: true,
      reason: 'First interaction, keeping conversation open'
    };
}

// Get conversation history for a tracking ID
async function getConversationHistory(trackingId) {
  try {
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('[CONVERSATION HISTORY] No Zilliz credentials');
      return [];
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    // Search for all interactions with this tracking ID
    const searchResult = await client.search({
      collection_name: 'email_tracking_events',
      vector: [0], // Dummy vector
      limit: 50,
      filter: `tracking_id == "${trackingId}"`
    });

    const interactions = [];
    if (searchResult.results && searchResult.results.length > 0) {
      for (const result of searchResult.results) {
        if (result.tracking_id === trackingId) {
          interactions.push({
            timestamp: result.timestamp,
            event_type: result.event_type,
            user_agent: result.user_agent // This contains AI responses
          });
        }
      }
    }

    // Sort by timestamp
    interactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    console.log('[CONVERSATION HISTORY] Found', interactions.length, 'interactions for', trackingId);
    return interactions;

  } catch (error) {
    console.error('[CONVERSATION HISTORY] Error fetching history:', error);
    return [];
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

    // Determine conversation state and appropriate reply-to address
    const conversationState = await analyzeConversationState(originalEmailData, aiResponseText, trackingId);
    const shouldKeepConversationOpen = conversationState.shouldKeepOpen;
    
    // Smart reply routing: use replies@ if conversation should continue, noreply@ if it should end
    const replyAddress = shouldKeepConversationOpen 
      ? `replies@${process.env.MAILGUN_DOMAIN}`
      : `noreply@${process.env.MAILGUN_DOMAIN}`;
    
    // Make the from address clearer to ensure replies go to the right place
    const fromEmail = shouldKeepConversationOpen
      ? `ExaMark <${replyAddress}>` // Simpler format for active conversations
      : `ExaMark AI Assistant <${replyAddress}>`;
    
    const toEmail = originalEmailData.from;
    const subject = generateReplySubject(originalEmailData.subject, trackingId);
    
    console.log('[AUTO RESPONSE] Email details:', { 
      fromEmail, 
      toEmail, 
      subject,
      hasAiResponse: !!aiResponseText,
      responseLength: aiResponseText?.length,
      conversationState: conversationState.state,
      keepOpen: shouldKeepConversationOpen
    });
    
    // Generate conversation-state-aware footer message
    let footerMessage = '';
    if (shouldKeepConversationOpen) {
      footerMessage = `---
This is an AI-powered response from ExaMark. Feel free to reply with any questions - I'm here to help!

Best regards,
ExaMark AI Assistant
Exabits Team`;
    } else {
      // Conversation ending - provide direct contact info
      const endingReason = conversationState.state === 'meeting_booked' 
        ? 'Thank you for your interest! We look forward to our upcoming conversation.'
        : 'If you need further assistance, please feel free to reach out to our team directly.';
      
      footerMessage = `---
${endingReason}

For immediate assistance, contact us directly at: support@exabits.ai

Best regards,
ExaMark AI Assistant
Exabits Team`;
    }
    
    const textContent = `${aiResponseText}

${footerMessage}

Message ID: ${trackingId} | Conversation State: ${conversationState.state}`;

    // Send email via Mailgun API with explicit Reply-To header
    const params = new URLSearchParams();
    params.append('from', fromEmail);
    params.append('to', toEmail);
    params.append('subject', subject);
    params.append('text', textContent);
    
    // CRITICAL: Add tracking-aware headers for conversation threading
    if (trackingId) {
      // Custom Message-ID that includes tracking ID
      const messageId = `<ai-response-${trackingId}-${Date.now()}@${process.env.MAILGUN_DOMAIN}>`;
      params.append('h:Message-ID', messageId);
      
      // Use the actual Message-ID from the incoming email for proper threading
      const incomingMessageId = originalEmailData.messageId;
      
      if (incomingMessageId) {
        // Reply to the actual incoming message
        params.append('h:In-Reply-To', incomingMessageId);
        
        // Build References chain: original thread + this message
        const existingReferences = originalEmailData.references || '';
        const referencesChain = existingReferences 
          ? `${existingReferences} ${incomingMessageId}`
          : incomingMessageId;
        params.append('h:References', referencesChain);
        
        console.log('[AUTO RESPONSE] Adding threading headers:', {
          messageId,
          inReplyTo: incomingMessageId,
          references: referencesChain
        });
      } else {
        // Fallback: try to reference the original tracking email
        const originalMessageId = `<tracking-${trackingId}@${process.env.MAILGUN_DOMAIN}>`;
        params.append('h:In-Reply-To', originalMessageId);
        params.append('h:References', originalMessageId);
        
        console.log('[AUTO RESPONSE] Using fallback tracking headers:', {
          messageId,
          inReplyTo: originalMessageId,
          references: originalMessageId
        });
      }
    }
    
    // CRITICAL: Add explicit Reply-To header to ensure replies go to correct address
    if (shouldKeepConversationOpen) {
      params.append('h:Reply-To', `ExaMark <${replyAddress}>`);
      console.log('[AUTO RESPONSE] Setting Reply-To:', `ExaMark <${replyAddress}>`);
    }
    
    console.log('[AUTO RESPONSE] Sending email...', { 
      from: fromEmail, 
      to: toEmail, 
      subject,
      textLength: textContent.length,
      replyTo: shouldKeepConversationOpen ? `ExaMark <${replyAddress}>` : 'none'
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
  
  // Include tracking ID in subject for preservation
  const hasTrackingInSubject = cleanSubject.includes(`[${trackingId}]`);
  if (!hasTrackingInSubject && trackingId) {
    cleanSubject = `${cleanSubject} [${trackingId}]`;
  }
  
  // Add our reply prefix
  return `Re: ${cleanSubject}`;
}

// Load agent settings from Zilliz
async function loadAgentSettings(userId = 'default') {
  try {
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('⚠️ [SETTINGS] No Zilliz credentials, using defaults');
      return getDefaultSettings();
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    // Query all settings for the user
    const searchResult = await client.search({
      collection_name: 'agent_settings',
      vector: [0], // Dummy vector since we're using filter
      limit: 100,
      filter: `user_id == "${userId}"`
    });

    const settings = {};
    if (searchResult.results && searchResult.results.length > 0) {
      for (const result of searchResult.results) {
        if (result.user_id === userId) {
          // Parse setting_value based on setting_type
          let value;
          try {
            if (result.setting_type === 'array' || result.setting_type === 'object') {
              value = JSON.parse(result.setting_value);
            } else if (result.setting_type === 'boolean') {
              value = result.setting_value === 'true';
            } else if (result.setting_type === 'number') {
              value = parseFloat(result.setting_value);
            } else {
              value = result.setting_value;
            }
          } catch (parseError) {
            console.error('❌ [SETTINGS] Parse error for', result.setting_key, parseError);
            value = result.setting_value; // Fallback to string
          }
          
          settings[result.setting_key] = value;
        }
      }
    }

    console.log('⚙️ [SETTINGS] Loaded settings from Zilliz:', Object.keys(settings));
    return Object.keys(settings).length > 0 ? settings : getDefaultSettings();

  } catch (error) {
    console.error('❌ [SETTINGS] Error loading from Zilliz:', error);
    return getDefaultSettings();
  }
}

// Get default settings when Zilliz is unavailable
function getDefaultSettings() {
  return {
    company_name: 'Our Company',
    product_name: 'Our Solution',
    value_propositions: ['Industry-leading performance', '24/7 expert support', 'Seamless integration'],
    calendar_link: '',
    response_tone: 'professional_friendly',
    meeting_pushiness: 'medium',
    technical_depth: 'medium',
    question_threshold: 2,
    positive_immediate_booking: false,
    complex_question_escalation: true
  };
}

// Extract lead information from email data
function extractLeadInfo(emailData) {
  const fromEmail = emailData.from || '';
  const body = emailData.body || '';
  
  // Extract name from email or signature
  let leadName = '';
  const emailNameMatch = fromEmail.match(/^([^<]+)</);
  if (emailNameMatch) {
    leadName = emailNameMatch[1].trim().replace(/['"]/g, '');
  } else {
    const emailUserMatch = fromEmail.match(/([^@]+)@/);
    if (emailUserMatch) {
      leadName = emailUserMatch[1].replace(/[._]/g, ' ');
    }
  }
  
  // Extract company from email domain
  let leadCompany = '';
  const domainMatch = fromEmail.match(/@([^.]+)/);
  if (domainMatch) {
    leadCompany = domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
  }
  
  return {
    lead_name: leadName || 'there',
    lead_company: leadCompany || '',
    lead_email: fromEmail
  };
}

// Function to generate AI response suggestions
// Enhanced AI Response Generation with Smart Intent Classification
async function generateAIResponse(emailData) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return generateRuleBasedResponse(emailData);
    }

    console.log('🤖 [SMART AI] Generating enhanced AI response...');
    
    // Step 1: Load agent settings from Zilliz
    let agentSettings = {};
    try {
      agentSettings = await loadAgentSettings();
      console.log('⚙️ [SMART AI] Loaded agent settings:', Object.keys(agentSettings));
    } catch (error) {
      console.error('⚠️ [SMART AI] Failed to load settings, using defaults:', error);
      agentSettings = getDefaultSettings();
    }
    
    // Step 2: Classify intent using OpenAI
    const intent = await classifyIntentWithAI(emailData.body);
    console.log('🎯 [SMART AI] Intent classified:', intent);
    
    // Step 3: Analyze sentiment
    const sentiment = await analyzeSentimentWithAI(emailData.body);
    console.log('💭 [SMART AI] Sentiment analyzed:', sentiment);
    
    // Step 4: Extract lead information for personalization
    const leadInfo = extractLeadInfo(emailData);
    console.log('👤 [SMART AI] Lead info extracted:', leadInfo);
    
    // Step 5: Generate context-aware response with template engine
    const response = await generateContextAwareResponseWithTemplate(emailData, intent, sentiment, agentSettings, leadInfo);
    
    return {
      success: true,
      response: response,
      provider: 'Enhanced Smart AI Responder v2.0',
      analysis: { intent, sentiment },
      settings_used: !!agentSettings.company_name,
      personalization: leadInfo
    };

  } catch (error) {
    console.error('❌ [SMART AI] Error:', error);
    return generateRuleBasedResponse(emailData);
  }
}

// Smart Intent Classification using OpenAI
async function classifyIntentWithAI(emailContent) {
  const prompt = `
Analyze this email reply and classify the sender's intent. Consider the context of a B2B sales conversation.

Email content: "${emailContent}"

Classify the intent as ONE of these categories:
- meeting_request_positive: Wants to schedule a meeting/call
- meeting_request_negative: Declines meeting but still engaged  
- meeting_time_preference: Specifying preferred times/dates
- calendar_booking_request: Asking for calendar link
- technical_question: Asking how product/service works
- pricing_question: Asking about costs, rates, pricing
- timeline_question: Asking about implementation timeline
- case_study_request: Wants examples, references, case studies
- integration_question: How it works with existing systems
- compliance_question: Security, SOC2, GDPR concerns
- comparison_question: Comparing to competitors
- question_about_product: General product questions
- unsubscribe_request: Wants to opt out
- general_positive: Shows interest but no specific action
- general_negative: Polite rejection or not interested

Respond with just the intent category, nothing else.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 50
      })
    });

    const data = await response.json();
    return data.choices[0].message.content.trim().toLowerCase();

  } catch (error) {
    console.error('❌ [INTENT] Classification failed:', error);
    return fallbackIntentClassification(emailContent);
  }
}

// Sentiment Analysis using OpenAI
async function analyzeSentimentWithAI(emailContent) {
  const prompt = `
Analyze the sentiment of this email reply in a B2B sales context:

"${emailContent}"

Classify as one of: positive, negative, neutral, frustrated, excited, interested, skeptical

Respond with just the sentiment word, nothing else.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 20
      })
    });

    const data = await response.json();
    return data.choices[0].message.content.trim().toLowerCase();

  } catch (error) {
    console.error('❌ [SENTIMENT] Analysis failed:', error);
    return 'neutral';
  }
}

// Enhanced Context-Aware Response Generation with Template Engine
async function generateContextAwareResponseWithTemplate(emailData, intent, sentiment, agentSettings, leadInfo) {
  try {
    // Get appropriate template based on intent
    const template = getResponseTemplate(intent, sentiment, agentSettings);
    
    // Apply template substitutions
    const personalizedResponse = applyTemplateSubstitutions(template, {
      ...agentSettings,
      ...leadInfo,
      intent,
      sentiment
    });

    // If we have OpenAI, enhance the template with AI
    if (process.env.OPENAI_API_KEY && agentSettings.response_tone !== 'template_only') {
      return await enhanceResponseWithAI(personalizedResponse, emailData, intent, sentiment, agentSettings);
    }

    return personalizedResponse;

  } catch (error) {
    console.error('❌ [TEMPLATE RESPONSE] Generation failed:', error);
    return generateFallbackResponse(intent, agentSettings);
  }
}

// Get response template based on intent and sentiment
function getResponseTemplate(intent, sentiment, settings) {
  const templates = {
    'meeting_request_positive': `Hi {{lead_name}},

Thank you for your interest in {{product_name}}! I'd be delighted to schedule a meeting to discuss how {{company_name}} can help {{lead_company}}.

{{#calendar_link}}Here's my calendar link to book a time that works for you: {{calendar_link}}{{/calendar_link}}
{{^calendar_link}}I'll send over some available times shortly.{{/calendar_link}}

Looking forward to our conversation!

Best regards,
{{company_name}} Team`,

    'pricing_question': `Hi {{lead_name}},

Great question about pricing! {{product_name}} is designed to provide excellent value through:

{{#value_propositions}}
• {{.}}
{{/value_propositions}}

I'd love to discuss pricing details and show you how we can deliver {{value_proposition_summary}} for {{lead_company}}.

{{#calendar_link}}Would you like to schedule a quick 15-minute call? {{calendar_link}}{{/calendar_link}}

Best regards,
{{company_name}} Team`,

    'technical_question': `Hi {{lead_name}},

Excellent technical question! {{product_name}} handles this through our {{technical_approach}}.

{{#technical_details}}
{{technical_details}}
{{/technical_details}}

{{#complex_question_escalation}}I'd be happy to arrange a technical deep-dive session with our engineering team to cover all the details.{{/complex_question_escalation}}

{{#calendar_link}}Here's my calendar if you'd like to discuss further: {{calendar_link}}{{/calendar_link}}

Best regards,
{{company_name}} Team`,

    'general_positive': `Hi {{lead_name}},

Thank you for your interest in {{product_name}}! I'm excited to help {{lead_company}} achieve {{value_proposition_summary}}.

{{#meeting_suggestion}}Would you be interested in a brief 15-minute call to discuss your specific needs?{{/meeting_suggestion}}

{{#calendar_link}}Feel free to book a time that works for you: {{calendar_link}}{{/calendar_link}}

Best regards,
{{company_name}} Team`
  };

  // Return specific template or fallback to general positive
  return templates[intent] || templates['general_positive'];
}

// Apply template variable substitutions
function applyTemplateSubstitutions(template, variables) {
  let result = template;

  // Simple variable substitution
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string' || typeof value === 'number') {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value || '');
    }
  }

  // Handle arrays (value propositions)
  if (variables.value_propositions && Array.isArray(variables.value_propositions)) {
    const listItems = variables.value_propositions.map(prop => `• ${prop}`).join('\n');
    result = result.replace(/{{#value_propositions}}[\s\S]*?{{\/value_propositions}}/g, listItems);
    
    // Create summary for single mention
    const summary = variables.value_propositions.slice(0, 2).join(' and ');
    result = result.replace(/{{value_proposition_summary}}/g, summary);
  }

  // Handle conditional blocks
  if (variables.calendar_link) {
    result = result.replace(/{{#calendar_link}}([\s\S]*?){{\/calendar_link}}/g, '$1');
    result = result.replace(/{{calendar_link}}/g, variables.calendar_link);
  } else {
    result = result.replace(/{{#calendar_link}}[\s\S]*?{{\/calendar_link}}/g, '');
  }
  
  // Remove calendar else blocks if we have calendar link
  if (variables.calendar_link) {
    result = result.replace(/{{\\^calendar_link}}[\s\S]*?{{\/calendar_link}}/g, '');
  } else {
    result = result.replace(/{{\\^calendar_link}}([\s\S]*?){{\/calendar_link}}/g, '$1');
  }

  // Handle meeting suggestion based on settings
  if (variables.question_threshold <= 1 || variables.positive_immediate_booking) {
    result = result.replace(/{{#meeting_suggestion}}([\s\S]*?){{\/meeting_suggestion}}/g, '$1');
  } else {
    result = result.replace(/{{#meeting_suggestion}}[\s\S]*?{{\/meeting_suggestion}}/g, '');
  }

  // Handle technical escalation
  if (variables.complex_question_escalation) {
    result = result.replace(/{{#complex_question_escalation}}([\s\S]*?){{\/complex_question_escalation}}/g, '$1');
  } else {
    result = result.replace(/{{#complex_question_escalation}}[\s\S]*?{{\/complex_question_escalation}}/g, '');
  }

  // Clean up any remaining template syntax
  result = result.replace(/{{[^}]+}}/g, '');
  
  // Clean up extra whitespace
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  return result;
}

// Enhance template response with AI for better personalization
async function enhanceResponseWithAI(templateResponse, emailData, intent, sentiment, settings) {
  const enhancementPrompt = `
Enhance this template response to be more personalized and natural while preserving all key information:

TEMPLATE RESPONSE:
"${templateResponse}"

ORIGINAL EMAIL CONTEXT:
- From: ${emailData.from}
- Their Message: "${emailData.body}"
- Intent: ${intent}
- Sentiment: ${sentiment}

GUIDELINES:
- Keep the same structure and key information
- Make it sound more natural and personalized
- Maintain ${settings.response_tone} tone
- Don't add new promises or information not in template
- Keep it concise and professional

Enhanced response:`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: enhancementPrompt }],
        temperature: 0.3,
        max_tokens: 400
      })
    });

    const data = await response.json();
    const enhancedResponse = data.choices[0].message.content.trim();
    
    console.log('✨ [AI ENHANCE] Template enhanced with AI');
    return enhancedResponse;

  } catch (error) {
    console.error('❌ [AI ENHANCE] Enhancement failed, using template:', error);
    return templateResponse;
  }
}

// Fallback response when all else fails
function generateFallbackResponse(intent, settings) {
  const companyName = settings.company_name || 'our company';
  const productName = settings.product_name || 'our solution';
  
  return `Thank you for your interest in ${productName}! I'd be happy to help you learn more about how ${companyName} can assist you. I'll follow up with more details shortly.

Best regards,
${companyName} Team`;
}

// Get response settings from Zilliz (with fallback to defaults)
async function getResponseSettings(userId = 'default') {
  try {
    console.log('⚙️ [SETTINGS] Loading configuration from Zilliz...');
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.warn('⚠️ [SETTINGS] Zilliz credentials missing, using defaults');
      return getDefaultResponseSettings();
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    const collectionName = 'agent_settings';
    
    // Load collection
    await client.loadCollection({ collection_name: collectionName });

    // Search for all settings for this user
    const searchResult = await client.search({
      collection_name: collectionName,
      vectors: [[0.1, 0.2]],
      search_params: { nprobe: 10 },
      limit: 100,
      output_fields: ['setting_key', 'setting_value', 'setting_type', 'user_id']
    });

    const settings = {};
    if (searchResult.results && searchResult.results.length > 0) {
      for (const result of searchResult.results) {
        if (result.user_id === userId) {
          try {
            settings[result.setting_key] = JSON.parse(result.setting_value);
          } catch (e) {
            settings[result.setting_key] = result.setting_value;
          }
        }
      }
    }

    // Merge with defaults for any missing settings
    const defaultSettings = getDefaultResponseSettings();
    const finalSettings = {
      company_info: settings.company_info || defaultSettings.company_info,
      response_style: settings.response_style || defaultSettings.response_style,
      knowledge_base: settings.knowledge_base || defaultSettings.knowledge_base,
      meeting_triggers: settings.meeting_triggers || defaultSettings.meeting_triggers
    };

    console.log('✅ [SETTINGS] Configuration loaded from Zilliz');
    return finalSettings;

  } catch (error) {
    console.error('❌ [SETTINGS] Failed to load from Zilliz, using defaults:', error);
    return getDefaultResponseSettings();
  }
}

// Default response settings (fallback)
function getDefaultResponseSettings() {
  return {
    company_info: {
      name: "Exabits",
      product_name: "AI GPU Compute Solutions",
      value_props: [
        "30% cost reduction compared to general cloud services",
        "40% faster model training with optimized infrastructure", 
        "Custom AI infrastructure tailored to your needs"
      ],
      calendar_link: "https://calendly.com/yourname/meeting"
    },
    response_style: {
      tone: "professional_friendly",
      meeting_pushiness: "soft",
      technical_depth: "medium"
    }
  };
}

// Response guidelines based on intent
function getResponseGuidelines(intent, settings) {
  const guidelines = {
    meeting_request_positive: "Express enthusiasm, offer specific times, include calendar link prominently",
    technical_question: "Provide helpful technical info, relate to their use case, soft meeting suggestion",
    pricing_question: "Address cost concerns professionally, emphasize value, offer detailed discussion",
    calendar_booking_request: "Immediately provide calendar link with enthusiasm",
    meeting_time_preference: "Accommodate their preference, confirm scheduling details",
    case_study_request: "Offer relevant examples, suggest detailed discussion to share more",
    unsubscribe_request: "Respect their wishes professionally, ask for feedback",
    general_positive: "Maintain momentum, offer next steps or resources",
    general_negative: "Respectful, leave door open for future, thank them for honesty"
  };
  
  return guidelines[intent] || "Provide helpful, professional response addressing their needs";
}

// Template-based response (fallback)
function generateTemplateResponse(intent, sentiment, settings) {
  const templates = {
    meeting_request_positive: `That's fantastic! I'm excited to discuss how ${settings.company_info.value_props[0]} could benefit your organization.\n\nWould you like to schedule a brief call to explore this further? ${settings.company_info.calendar_link}\n\nLooking forward to our conversation!`,
    
    technical_question: `Great question! Our ${settings.company_info.product_name} is designed to address exactly these kinds of technical challenges.\n\n${settings.company_info.value_props[1]} - this could be particularly relevant for your use case.\n\nWould you like to discuss the technical details in more depth? Happy to answer any specific questions you might have.`,
    
    pricing_question: `I appreciate your interest in understanding the investment. ${settings.company_info.value_props[0]} - most clients see significant ROI within the first few months.\n\nI'd be happy to discuss specific pricing based on your requirements. Would you like to schedule a brief call to go over the details? ${settings.company_info.calendar_link}`,
    
    calendar_booking_request: `Absolutely! I'd love to connect with you.\n\nHere's my calendar link: ${settings.company_info.calendar_link}\n\nFeel free to pick a time that works best for you. Looking forward to our conversation!`,
    
    general_positive: `Thank you for your interest! I'm glad this resonates with you.\n\n${settings.company_info.value_props[2]} - this could be a great fit for your organization.\n\nWould you like to explore this further? Happy to answer any questions or schedule a brief discussion.`
  };
  
  return templates[intent] || "Thank you for your message! I appreciate you taking the time to reach out. How can I best help you with your questions or next steps?";
}

// Fallback intent classification using keyword matching
function fallbackIntentClassification(emailContent) {
  const lowerText = emailContent.toLowerCase();
  
  // Meeting-related intents
  if (lowerText.match(/yes.*meeting|schedule.*call|let.*schedule|sounds good.*meeting|interested.*call/)) {
    return 'meeting_request_positive';
  }
  if (lowerText.match(/calendar.*link|booking.*link|schedule.*link|send.*calendar/)) {
    return 'calendar_booking_request';
  }
  if (lowerText.match(/tuesday|wednesday|thursday|friday|monday|morning|afternoon|time.*work/)) {
    return 'meeting_time_preference';
  }
  
  // Question types
  if (lowerText.match(/how.*work|technical|integration|api|system|architecture/)) {
    return 'technical_question';
  }
  if (lowerText.match(/price|cost|rate|budget|expensive|affordable|pricing/)) {
    return 'pricing_question';
  }
  if (lowerText.match(/how long|timeline|when.*ready|implementation.*time/)) {
    return 'timeline_question';
  }
  if (lowerText.match(/example|case study|reference|similar.*company|who.*using/)) {
    return 'case_study_request';
  }
  if (lowerText.match(/security|compliance|soc2|gdpr|data.*protection/)) {
    return 'compliance_question';
  }
  if (lowerText.match(/vs|versus|compared.*to|better.*than|competitor/)) {
    return 'comparison_question';
  }
  
  // Negative responses
  if (lowerText.match(/unsubscribe|remove.*list|stop.*email|opt.*out/)) {
    return 'unsubscribe_request';
  }
  if (lowerText.match(/not.*interested|no.*thank|pass.*this.*time|not.*right.*now/)) {
    return 'general_negative';
  }
  
  // Positive but general
  if (lowerText.match(/interesting|good.*know|thanks.*info|appreciate/)) {
    return 'general_positive';
  }
  
  // Default for questions
  if (lowerText.includes('?') || lowerText.match(/what|how|when|where|why|can.*you/)) {
    return 'question_about_product';
  }
  
  return 'general_positive';
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

    // Use TOP-LEVEL MilvusClient (no conditional imports!)
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    const collectionName = 'email_tracking_events';
    
    // ChatGPT debugging: Check if tracking_id is a declared schema field
    console.log('[DEBUG] Checking collection schema...');
    const info = await client.describeCollection({ collection_name: collectionName });
    const fields = info.schema?.fields || info.fields || [];
    console.log('[DEBUG] FIELDS:', fields.map(f => ({
      name: f.name,
      data_type: f.data_type,
      is_primary_key: f.is_primary_key,
      max_length: f.type_params?.max_length,
      dim: f.type_params?.dim,
    })));

    // ChatGPT fix 1: Load collection into memory before querying
    await client.loadCollection({ collection_name: collectionName });

    // Get both lead messages and AI replies for full conversation
    const expr = `event_type == "ai_reply" || event_type == "lead_message"`;

    // Query the SAME collection where we store conversation data
    const queryResult = await client.query({
      collection_name: collectionName,
      expr: expr,
      limit: 1000,  // Increased limit since we'll filter client-side
      consistency_level: 'Strong',
      output_fields: ['tracking_id', 'event_type', 'timestamp', 'user_agent', 'ip_address', 'email_address', 'recipient', 'processed']
    });

    // Client-side filter by tracking_id
    const allMessages = queryResult.data || queryResult || [];
    const filteredMessages = allMessages.filter(r => String(r.tracking_id).trim() === trackingId);
    
    console.log('[QUERY] Total conversation events:', allMessages.length);
    console.log('[QUERY] Filtered by tracking ID:', trackingId, 'Count:', filteredMessages.length);
    
    // Sort by timestamp to get chronological order
    filteredMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Process messages and combine lead + AI responses
    const conversation = [];
    let currentReply = null;
    
    filteredMessages.forEach(result => {
      if (result.event_type === 'lead_message') {
        // Lead message - start a new reply object
        const leadMessageText = result.user_agent || '';
        const leadMessage = leadMessageText.startsWith('Lead_Message: ') ? 
          leadMessageText.substring(14) : leadMessageText;
        
        currentReply = {
          tracking_id: result.tracking_id,
          timestamp: result.timestamp,
          event_type: 'conversation',
          lead_message: leadMessage,
          ai_response: null,
          sender: result.email_address,
          recipient: result.recipient,
          processed: result.processed
        };
        
      } else if (result.event_type === 'ai_reply' && currentReply) {
        // AI response - add to current reply
        const aiResponseText = result.user_agent || '';
        const aiResponse = aiResponseText.startsWith('AI_Response: ') ? 
          aiResponseText.substring(13) : aiResponseText;
        
        currentReply.ai_response = aiResponse;
        conversation.push(currentReply);
        currentReply = null;
        
      } else if (result.event_type === 'ai_reply' && !currentReply) {
        // AI response without lead message (backwards compatibility)
        const aiResponseText = result.user_agent || '';
        const aiResponse = aiResponseText.startsWith('AI_Response: ') ? 
          aiResponseText.substring(13) : aiResponseText;
        
        conversation.push({
          tracking_id: result.tracking_id,
          timestamp: result.timestamp,
          event_type: result.event_type,
          lead_message: null,
          ai_response: aiResponse,
          sender: result.email_address,
          recipient: result.recipient,
          processed: result.processed
        });
      }
    });
    
    // If there's an incomplete reply (lead message without AI response), add it
    if (currentReply) {
      conversation.push(currentReply);
    }
    
    console.log('[QUERY] Processed conversation entries:', conversation.length);
    
    return conversation;

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

    // Use TOP-LEVEL MilvusClient (no conditional imports!)
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN,
    });

    const collectionName = 'email_tracking_events';
    
    // ChatGPT fix: Load collection and use proper query syntax
    await client.loadCollection({ collection_name: collectionName });

    // Use query for filtering recent replies by event type
    const queryResult = await client.query({
      collection_name: collectionName,
      expr: `event_type == "ai_reply"`,  // Use expr instead of filter
      limit: limit,
      consistency_level: 'Strong',
      output_fields: ['tracking_id', 'event_type', 'timestamp', 'user_agent', 'ip_address', 'email_address', 'recipient', 'processed']
    });

    // Parse the results using the corrected field structure
    const replies = queryResult.data?.map(result => {
      return {
        tracking_id: result.tracking_id,
        timestamp: result.timestamp,
        event_type: result.event_type,
        user_agent: result.user_agent,
        sender: result.email_address,
        recipient: result.recipient,
        processed: result.processed,
        ai_response: result.user_agent?.startsWith('AI_Response:') ? result.user_agent.substring(12) : result.user_agent
      };
    }) || [];

    return replies;
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
  // Use raw data type numbers to avoid ES module import issues
  const schema = [
    {
      name: 'id',
      data_type: 5, // Int64
      is_primary_key: true,
      autoID: true
    },
    {
      name: 'tracking_id',
      data_type: 21, // VarChar
      max_length: 100
    },
    {
      name: 'from_email',
      data_type: 21, // VarChar
      max_length: 200
    },
    {
      name: 'subject',
      data_type: 21, // VarChar
      max_length: 500
    },
    {
      name: 'content',
      data_type: 21, // VarChar
      max_length: 5000
    },
    {
      name: 'timestamp',
      data_type: 21, // VarChar
      max_length: 50
    },
    {
      name: 'sentiment',
      data_type: 21, // VarChar
      max_length: 50
    },
    {
      name: 'intent',
      data_type: 21, // VarChar
      max_length: 100
    },
    {
      name: 'ai_response',
      data_type: 21, // VarChar
      max_length: 5000
    },
    {
      name: 'ai_response_sent',
      data_type: 1, // Bool
    },
    {
      name: 'ai_response_timestamp',
      data_type: 21, // VarChar
      max_length: 50
    },
    {
      name: 'ai_response_message_id',
      data_type: 21, // VarChar
      max_length: 200
    },
    {
      name: 'dummy_vector',
      data_type: 101, // FloatVector
      dim: 2
    }
  ];

  await client.createCollection({
    collection_name: 'email_replies_v2',
    fields: schema,
    description: 'Email replies with AI responses'
  });

  console.log('[ZILLIZ] Created email_replies_v2 collection with proper schema');
}

// Generate simple vector for storage (placeholder)
function generateSimpleVector(text) {
  // Simple hash-based vector generation for demo
  const hash = text.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & 0xffffffff, 0);
  return [hash % 100 / 100, (hash * 2) % 100 / 100];
}

// Store lead's original message in Zilliz
async function storeLeadMessage(emailData, trackingId) {
  try {
    console.log('[ZILLIZ STORE] Storing lead message for tracking ID:', trackingId);
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('[ZILLIZ STORE] Missing environment variables');
      return { success: false, error: 'Missing Zilliz credentials', stored: false };
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    const collectionName = 'email_tracking_events';
    console.log('[ZILLIZ STORE] Using collection:', collectionName);
    
    // Load collection first
    console.log('[ZILLIZ STORE] Loading collection for lead message...');
    try {
      const loadResult = await client.loadCollection({ collection_name: collectionName });
      console.log('[ZILLIZ STORE] Collection loaded:', loadResult);
    } catch (loadError) {
      console.error('[ZILLIZ STORE] Failed to load collection:', loadError);
    }

    // Store lead message using same schema as other events
    const leadData = {
      tracking_id: trackingId,
      event_type: 'lead_message',
      timestamp: new Date().toISOString(),
      user_agent: `Lead_Message: ${emailData.body || emailData.bodyHtml || 'No content'}`,
      ip_address: '127.0.0.1',
      email_address: emailData.from || 'Unknown',
      recipient: emailData.to || 'Unknown',
      processed: false,
      dummy_vector: [0.0, 0.0]
    };

    console.log('[ZILLIZ STORE] Preparing to insert lead message:', {
      tracking_id: leadData.tracking_id,
      event_type: leadData.event_type,
      user_agent_length: leadData.user_agent.length
    });

    const insertResult = await client.insert({
      collection_name: collectionName,
      data: [leadData]
    });

    console.log('[ZILLIZ STORE] Lead message insert result:', insertResult);
    
    // Force a flush to ensure data is persisted
    console.log('[ZILLIZ STORE] Flushing lead message data...');
    try {
      const flushResult = await client.flush({ collection_names: [collectionName] });
      console.log('[ZILLIZ STORE] Lead message flush result:', flushResult);
    } catch (flushError) {
      console.error('[ZILLIZ STORE] Lead message flush error (not critical):', flushError);
    }
    
    console.log('[ZILLIZ STORE] Lead message stored successfully');
    
    return { 
      success: true, 
      stored: true,
      collection: collectionName,
      data: leadData
    };

  } catch (error) {
    console.error('[ZILLIZ STORE] Lead message storage error:', error);
    console.error('[ZILLIZ STORE] Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack?.substring(0, 500)
    });
    return { 
      success: false, 
      error: error.message, 
      stored: false 
    };
  }
}

// Load agent settings from Zilliz
async function loadAgentSettings() {
  try {
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('[AGENT SETTINGS] Missing Zilliz credentials, using defaults');
      return getDefaultResponseSettings();
    }

    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });

    const collectionName = 'agent_settings';
    
    // Query all settings
    const results = await client.query({
      collection_name: collectionName,
      filter: 'setting_key != ""',
      output_fields: ['setting_key', 'setting_value'],
      limit: 100
    });

    if (!results.data || results.data.length === 0) {
      console.log('[AGENT SETTINGS] No settings found, using defaults');
      return getDefaultResponseSettings();
    }

    // Convert array of settings back to nested object
    const settings = getDefaultResponseSettings(); // Start with defaults
    
    results.data.forEach(item => {
      const key = item.setting_key;
      let value;
      
      try {
        value = JSON.parse(item.setting_value);
      } catch {
        value = item.setting_value; // Keep as string if not JSON
      }
      
      // Map settings back to nested structure
      if (key === 'company_name') settings.company_info.name = value;
      else if (key === 'product_name') settings.company_info.product_name = value;
      else if (key === 'value_props') settings.company_info.value_props = value;
      else if (key === 'calendar_link') settings.company_info.calendar_link = value;
      else if (key === 'response_tone') settings.response_style.tone = value;
      else if (key === 'meeting_pushiness') settings.response_style.meeting_pushiness = value;
      else if (key === 'technical_depth') settings.response_style.technical_depth = value;
      else if (key === 'followup_frequency') settings.response_style.followup_frequency = value;
    });

    console.log('[AGENT SETTINGS] Loaded settings from Zilliz');
    return settings;

  } catch (error) {
    console.error('[AGENT SETTINGS] Failed to load from Zilliz:', error);
    return getDefaultResponseSettings();
  }
}

// Smart Calendar Event Creation - Automatically creates calendar events when appropriate
async function handleCalendarEventCreation(emailData, aiResponse, trackingId) {
  try {
    console.log('📅 [CALENDAR] Analyzing email for automatic calendar event creation...');
    
    const emailBody = emailData.body || '';
    const intent = aiResponse.intent;
    
    // Only proceed if Google Calendar API is configured
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_CALENDAR_ID) {
      console.log('⚠️ [CALENDAR] Google Calendar Service Account not configured, skipping auto-event creation');
      return { eventCreated: false, reason: 'Google Calendar Service Account not configured' };
    }
    
    // Check if this email contains a confirmed meeting time
    const meetingTimeDetected = await detectConfirmedMeetingTime(emailBody, intent);
    
    if (!meetingTimeDetected.found) {
      console.log('📅 [CALENDAR] No confirmed meeting time detected, skipping event creation');
      return { eventCreated: false, reason: 'No confirmed meeting time found' };
    }
    
    console.log('📅 [CALENDAR] Confirmed meeting detected:', meetingTimeDetected);
    
    // Extract lead information
    const leadInfo = extractLeadInfo(emailData);
    
    // Create the calendar event
    const eventDetails = {
      title: `Sales Discussion - ${leadInfo.name || 'Prospect'}`,
      description: `Automatic meeting scheduled via AI email responder\n\nLead: ${leadInfo.name}\nEmail: ${emailData.from}\nCompany: ${leadInfo.company}\n\nOriginal message:\n${emailBody.substring(0, 300)}...`,
      startTime: meetingTimeDetected.startTime,
      endTime: meetingTimeDetected.endTime,
      timeZone: meetingTimeDetected.timeZone || 'America/New_York',
      attendees: [
        { email: emailData.from, displayName: leadInfo.name }
      ]
    };
    
    // Import and use calendar manager
    const { calendarManager } = await import('../../utils/calendarIntegrationManager.js');
    
    if (!calendarManager.initialized) {
      await calendarManager.initialize();
    }
    
    const result = await calendarManager.createGoogleCalendarEvent(eventDetails);
    
    if (result.success) {
      console.log('✅ [CALENDAR] Calendar event created successfully');
      
      // Store the event creation in Zilliz for tracking
      await storeCalendarEventInZilliz(trackingId, result, meetingTimeDetected, leadInfo);
      
      return {
        eventCreated: true,
        eventDetails: result,
        meetingTime: meetingTimeDetected,
        leadInfo: leadInfo
      };
    } else {
      console.error('❌ [CALENDAR] Failed to create calendar event:', result.error);
      return {
        eventCreated: false,
        error: result.error,
        reason: 'Google Calendar API error'
      };
    }
    
  } catch (error) {
    console.error('❌ [CALENDAR] Error in calendar event creation:', error);
    return {
      eventCreated: false,
      error: error.message,
      reason: 'Unexpected error during calendar event creation'
    };
  }
}

// Detect confirmed meeting times in email content using AI
async function detectConfirmedMeetingTime(emailBody, intent) {
  try {
    console.log('📅 [CALENDAR] Analyzing email content for meeting times...');
    
    // Quick keyword check first
    const emailLower = emailBody.toLowerCase();
    const timeKeywords = [
      'tomorrow at', 'today at', 'monday at', 'tuesday at', 'wednesday at', 'thursday at', 'friday at',
      'pm on', 'am on', "o'clock", 'meeting at', 'call at', 'scheduled for', 'booked for'
    ];
    
    const hasTimeKeywords = timeKeywords.some(keyword => emailLower.includes(keyword));
    
    if (!hasTimeKeywords && intent !== 'meeting_time_preference') {
      return { found: false, reason: 'No time-related keywords found' };
    }
    
    // Use OpenAI to parse the meeting time if available
    if (process.env.OPENAI_API_KEY) {
      const prompt = `
Analyze this email to extract confirmed meeting times. Only return confirmed meetings, not suggestions.

Email: "${emailBody}"

Task: Extract any confirmed meeting times and return JSON in this exact format:
{
  "found": true/false,
  "dateTime": "2024-01-15T14:00:00.000Z",
  "timeZone": "America/New_York",
  "duration": 30,
  "confidence": "high/medium/low"
}

Only set "found": true if there's a specific date AND time mentioned. Examples of confirmed times:
- "Let's meet tomorrow at 2pm"
- "Tuesday at 10am works"
- "How about Monday the 15th at 3:30pm"

Do NOT set found: true for vague suggestions like:
- "sometime next week"
- "maybe we can chat"
- "when are you available"

Return only the JSON object.`;

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.1
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices[0].message.content.trim();
          
          try {
            const parsed = JSON.parse(content);
            
            if (parsed.found && parsed.dateTime) {
              const startTime = new Date(parsed.dateTime);
              const endTime = new Date(startTime.getTime() + (parsed.duration || 30) * 60000);
              
              return {
                found: true,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                timeZone: parsed.timeZone || 'America/New_York',
                confidence: parsed.confidence || 'medium',
                source: 'AI_parsed'
              };
            }
          } catch (parseError) {
            console.error('📅 [CALENDAR] Failed to parse AI response:', parseError);
          }
        }
      } catch (aiError) {
        console.error('📅 [CALENDAR] AI parsing failed:', aiError);
      }
    }
    
    // Fallback: Basic regex parsing for common patterns
    const patterns = [
      /(?:tomorrow|today)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      /(monday|tuesday|wednesday|thursday|friday)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:on\s+)?(monday|tuesday|wednesday|thursday|friday)/i
    ];
    
    for (const pattern of patterns) {
      const match = emailBody.match(pattern);
      if (match) {
        console.log('📅 [CALENDAR] Found time pattern:', match[0]);
        
        // Basic time parsing (simplified - in production you'd want more robust parsing)
        const now = new Date();
        let meetingDate = new Date(now);
        
        // Set to tomorrow if "tomorrow" detected
        if (match[0].toLowerCase().includes('tomorrow')) {
          meetingDate.setDate(now.getDate() + 1);
        }
        
        // Extract hour and convert to 24-hour format
        let hour = parseInt(match[1] || match[2]);
        const ampm = (match[3] || match[4] || '').toLowerCase();
        
        if (ampm === 'pm' && hour !== 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        
        meetingDate.setHours(hour, 0, 0, 0);
        
        const endTime = new Date(meetingDate.getTime() + 30 * 60000); // 30 minute default
        
        return {
          found: true,
          startTime: meetingDate.toISOString(),
          endTime: endTime.toISOString(),
          timeZone: 'America/New_York',
          confidence: 'medium',
          source: 'regex_parsed'
        };
      }
    }
    
    return { found: false, reason: 'No parseable meeting time found' };
    
  } catch (error) {
    console.error('📅 [CALENDAR] Error detecting meeting time:', error);
    return { found: false, reason: 'Error during meeting time detection' };
  }
}

// Store calendar event information in Zilliz for tracking
async function storeCalendarEventInZilliz(trackingId, calendarResult, meetingTime, leadInfo) {
  try {
    console.log('📅 [CALENDAR] Storing calendar event in Zilliz...');
    
    if (!process.env.ZILLIZ_ENDPOINT || !process.env.ZILLIZ_TOKEN) {
      console.log('⚠️ [CALENDAR] Zilliz not configured, skipping storage');
      return { success: false, reason: 'Zilliz not configured' };
    }
    
    const client = new MilvusClient({
      address: process.env.ZILLIZ_ENDPOINT,
      token: process.env.ZILLIZ_TOKEN
    });
    
    const eventData = {
      tracking_id: trackingId,
      event_type: 'calendar_event_created',
      timestamp: new Date().toISOString(),
      user_agent: `Calendar_Event: ${calendarResult.event_id}`,
      ip_address: '127.0.0.1',
      email_address: leadInfo.email || 'Unknown',
      recipient: 'ExaMark Team',
      processed: true,
      embedding: await createEmbedding(`Calendar event created for ${leadInfo.name} at ${meetingTime.startTime}`)
    };
    
    await client.insert({
      collection_name: 'email_tracking_events',
      data: [eventData]
    });
    
    console.log('✅ [CALENDAR] Calendar event stored in Zilliz successfully');
    return { success: true, stored: true };
    
  } catch (error) {
    console.error('❌ [CALENDAR] Failed to store calendar event in Zilliz:', error);
    return { success: false, error: error.message };
  }
}
