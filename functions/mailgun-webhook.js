// LangChain-powered Email Automation Agent
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "langchain/tools";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { z } from "zod";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import crypto from 'crypto';

// === UTILITY FUNCTIONS ===

function parseMailgunPayload(event) {
  // Check if body is base64 encoded (real Mailgun webhooks)
  if (event.isBase64Encoded) {
    const body = Buffer.from(event.body, 'base64').toString();
    const formData = new URLSearchParams(body);
    return Object.fromEntries(formData);
  } else {
    // Plain text body (curl tests)
    const formData = new URLSearchParams(event.body);
    return Object.fromEntries(formData);
  }
}

function parseMessageHeaders(formData) {
  try {
    const headersArray = JSON.parse(formData['message-headers'] || '[]');
    const headers = {};
    for (const [key, value] of headersArray) {
      headers[key.toLowerCase()] = value;
    }
    return headers;
  } catch (error) {
    console.log('[HEADERS] Failed to parse message headers:', error);
    return {};
  }
}

function extractMessageId(headers, field) {
  const raw = headers[field] || "";
  const match = String(raw).match(/<([^>]+)>/);
  return match ? match[1] : null;
}

function extractUserIdFromTrackingId(trackingId) {
  if (!trackingId) return null;
  // Extract user code from tracking-76e84c79_timestamp_hash format
  const match = trackingId.match(/tracking-([a-f0-9]{8})/);
  return match ? match[1] : null;
}

// === ZILLIZ CLIENT SETUP ===

const milvusClient = new MilvusClient({
  address: process.env.ZILLIZ_ENDPOINT?.trim(),
  ssl: true,
  token: process.env.ZILLIZ_TOKEN?.trim(),
});

// Test Zilliz connection
async function testZillizConnection() {
  try {
    console.log('[ZILLIZ] endpoint ok:', !!process.env.ZILLIZ_ENDPOINT, ' token len:', (process.env.ZILLIZ_TOKEN||'').trim().length);
    console.log('[ZILLIZ] Testing connection...');
    const collections = await milvusClient.listCollections();
    console.log('[ZILLIZ] Connection successful, collections:', collections.data);
    return true;
  } catch (error) {
    console.error('[ZILLIZ] Connection failed:', error.message);
    return false;
  }
}

// === DEDUPLICATION SYSTEM ===

const processedMessages = new Map(); // In-memory store for this function instance

async function isMessageProcessed(messageId) {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

function markMessageProcessed(messageId) {
  if (messageId) {
    processedMessages.set(messageId, Date.now());
    // Clean up old entries (keep last 1000)
    if (processedMessages.size > 1000) {
      const entries = Array.from(processedMessages.entries());
      entries.sort((a, b) => b[1] - a[1]);
      processedMessages.clear();
      entries.slice(0, 500).forEach(([id, time]) => processedMessages.set(id, time));
    }
  }
}

// === LANGCHAIN TOOLS ===

// Tool 1: Get conversation history
const getConversationTool = new DynamicStructuredTool({
  name: "get_conversation",
  description: "Fetch conversation history for a tracking_id to maintain context and understand the email thread",
  schema: z.object({
    tracking_id: z.string().describe("The tracking ID to fetch conversation for"),
    limit: z.number().default(25).describe("Maximum number of messages to retrieve")
  }),
  func: async ({ tracking_id, limit }) => {
    try {
      console.log(`[TOOL] Getting conversation for tracking_id: ${tracking_id}`);
      
      // Test connection first
      const connectionOk = await testZillizConnection();
      if (!connectionOk) {
        console.log('[TOOL] Zilliz connection failed, returning empty conversation');
        return JSON.stringify([]);
      }
      
      await milvusClient.loadCollection({ collection_name: 'email_tracking_events' });
      
      const result = await milvusClient.query({
        collection_name: 'email_tracking_events',
        expr: `tracking_id == "${tracking_id.replace(/(["\\])/g, '\\$1')}"`,
        output_fields: ["timestamp", "event_type", "user_agent", "email_address", "recipient"],
        limit,
        consistency_level: "Strong"
      });
      
      const conversations = (result.data || []).sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      console.log(`[TOOL] Found ${conversations.length} conversation entries`);
      return JSON.stringify(conversations);
      
    } catch (error) {
      console.error('[TOOL] Error getting conversation:', error);
      return JSON.stringify([]);
    }
  }
});

// Tool 2: Get user settings (comprehensive)
const getUserSettingsTool = new DynamicStructuredTool({
  name: "get_user_settings",
  description: "Get comprehensive user settings including calendar, company info, response style, and knowledge base",
  schema: z.object({
    tracking_id: z.string().describe("The tracking ID to extract user code from")
  }),
  func: async ({ tracking_id }) => {
    try {
      const userId = extractUserIdFromTrackingId(tracking_id);
      if (!userId) {
        return JSON.stringify({ error: "Could not extract user ID from tracking_id" });
      }
      
      console.log(`[TOOL] Getting comprehensive settings for user: ${userId}`);
      
      // Test connection first
      const connectionOk = await testZillizConnection();
      if (!connectionOk) {
        console.log('[TOOL] Zilliz connection failed, using default settings');
        return JSON.stringify({
          calendar_id: 'primary',
          company_name: 'Exabits',
          timezone: 'America/Los_Angeles',
          response_tone: 'professional_friendly'
        });
      }
      
      await milvusClient.loadCollection({ collection_name: 'agent_settings' });
      
      // Get all settings for this user
      const allSettings = await milvusClient.query({
        collection_name: 'agent_settings',
        expr: `field_name like "%%_user_${userId}"`,
        output_fields: ["field_name", "field_value", "field_type"],
        limit: 50,
        consistency_level: "Strong"
      });
      
      // Parse settings into a usable object
      const settings = {
        calendar_id: 'primary',
        company_name: 'Exabits', 
        timezone: 'America/Los_Angeles',
        response_tone: 'professional_friendly'
      };
      
      for (const item of allSettings.data || []) {
        const fieldName = item.field_name.replace(`_user_${userId}`, '');
        let value = item.field_value;
        
        // Parse JSON values
        if (item.field_type === 'json' || (typeof value === 'string' && value.startsWith('{'))) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            // Keep as string if JSON parse fails
          }
        }
        
        settings[fieldName] = value;
      }
      
      console.log(`[TOOL] Retrieved ${Object.keys(settings).length} settings for user ${userId}`);
      return JSON.stringify(settings);
      
    } catch (error) {
      console.error('[TOOL] Error getting user settings:', error);
      return JSON.stringify({
        calendar_id: 'primary',
        signature: 'ExaMark AI Assistant',
        company_name: 'Our Company',
        user_name: '[Your Name]'
      });
    }
  }
});

// Tool 3: Create calendar event (with proper OAuth flow)
const createCalendarEventTool = new DynamicStructuredTool({
  name: "create_calendar_event",
  description: "Create a Google Calendar event when meeting time is confirmed. Always use this when user agrees to a specific time.",
  schema: z.object({
    calendar_id: z.string().default('primary').describe("Calendar ID to create event in"),
    start_time: z.string().describe("ISO datetime string for event start (e.g., 2025-09-23T17:00:00-07:00)"),
    end_time: z.string().describe("ISO datetime string for event end"),
    title: z.string().default("Sales Discussion").describe("Event title"),
    attendees: z.array(z.string()).describe("Array of email addresses to invite"),
    timezone: z.string().default("America/Los_Angeles").describe("Timezone for the event")
  }),
  func: async ({ calendar_id, start_time, end_time, title, attendees, timezone }) => {
    try {
      console.log(`[TOOL] Creating calendar event: ${title} at ${start_time}`);
      
      // Create JWT for Google OAuth
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;
      
      // Clean and format the private key properly
      if (privateKey) {
        privateKey = privateKey.replace(/\\n/g, '\n');
        // Ensure proper PEM format
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
        }
      }
      
      console.log('[TOOL] Service account email:', serviceAccountEmail);
      console.log('[TOOL] Private key length:', privateKey ? privateKey.length : 'undefined');
      
      const now = Math.floor(Date.now() / 1000);
      const jwtPayload = {
        iss: serviceAccountEmail,
        scope: 'https://www.googleapis.com/auth/calendar',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };
      
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
      const signData = `${header}.${payload}`;
      
      // Create signature with better error handling
      let signature;
      try {
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signData);
        signature = sign.sign(privateKey, 'base64url');
      } catch (signError) {
        console.error('[TOOL] Crypto signing error:', signError.message);
        return JSON.stringify({ 
          success: false, 
          error: `Signing failed: ${signError.message}`,
          details: 'Check private key format'
        });
      }
      
      const jwt = `${signData}.${signature}`;
      
      // Exchange JWT for access token
      console.log('[TOOL] Exchanging JWT for access token...');
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        })
      });
      
      const tokenData = await tokenResponse.json();
      
      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenData.error || 'Unknown error'}`);
      }
      
      const accessToken = tokenData.access_token;
      console.log('[TOOL] Got access token successfully');
      
      // Create calendar event (no attendees - service account lacks permission)
      const event = {
        summary: title,
        start: { dateTime: start_time, timeZone: timezone },
        end: { dateTime: end_time, timeZone: timezone },
        description: `Meeting scheduled through ExaMark AI Assistant\n\nContact: ${attendees.join(', ')}`
      };
      
      const calendarResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendar_id}/events`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(event)
        }
      );
      
      const eventData = await calendarResponse.json();
      
      if (!calendarResponse.ok) {
        throw new Error(`Calendar creation failed: ${eventData.error?.message || 'Unknown error'}`);
      }
      
      console.log(`[TOOL] Calendar event created successfully: ${eventData.id}`);
      
      return JSON.stringify({
        success: true,
        event_id: eventData.id,
        html_link: eventData.htmlLink,
        meeting_link: eventData.hangoutLink,
        attendees: attendees
      });
      
    } catch (error) {
      console.error('[TOOL] Error creating calendar event:', error);
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  }
});

// Tool 4: Send email reply
const sendEmailTool = new DynamicStructuredTool({
  name: "send_email",
  description: "Send an email reply via Mailgun with proper threading headers",
  schema: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body content"),
    in_reply_to: z.string().optional().describe("Message-ID this is replying to"),
    references: z.string().optional().describe("References header for threading"),
    tracking_id: z.string().describe("Tracking ID for this conversation")
  }),
  func: async ({ to, subject, body, in_reply_to, references, tracking_id }) => {
    try {
      console.log(`[TOOL] Sending email to: ${to}`);
      
      const auth = Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64');
      
      // Generate new message ID for this reply
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const messageId = `ai-response-${tracking_id}-${timestamp}-${hash}@mg.examarkchat.com`;
      
      const formData = new URLSearchParams({
        from: 'ExaMark <replies@mg.examarkchat.com>',
        to: to,
        subject: subject,
        text: body,
        'h:Message-ID': `<${messageId}>`,
        'h:In-Reply-To': in_reply_to ? `<${in_reply_to}>` : '',
        'h:References': references ? `<${references}>` : ''
      });
      
      const response = await fetch(`https://api.mailgun.net/v3/mg.examarkchat.com/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}` },
        body: formData
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Mailgun send failed: ${result.message || 'Unknown error'}`);
      }
      
      console.log(`[TOOL] Email sent successfully: ${messageId}`);
      
      return JSON.stringify({
        success: true,
        message_id: messageId,
        mailgun_id: result.id
      });
      
    } catch (error) {
      console.error('[TOOL] Error sending email:', error);
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  }
});

// Tool 5: Store event in Zilliz
const storeEventTool = new DynamicStructuredTool({
  name: "store_event",
  description: "Store an event in Zilliz for tracking and audit purposes",
  schema: z.object({
    tracking_id: z.string().describe("Tracking ID for this conversation"),
    event_type: z.string().describe("Type of event (e.g., 'ai_reply', 'lead_message', 'calendar_created')"),
    user_agent: z.string().describe("Event content or user agent string"),
    email_address: z.string().optional().describe("Email address involved"),
    recipient: z.string().optional().describe("Recipient email address"),
    additional_data: z.record(z.any()).optional().describe("Additional event data")
  }),
  func: async ({ tracking_id, event_type, user_agent, email_address, recipient, additional_data }) => {
    try {
      console.log(`[TOOL] Storing event: ${event_type} for ${tracking_id}`);
      
      const eventData = {
        tracking_id,
        event_type,
        timestamp: new Date().toISOString(),
        user_agent: user_agent.substring(0, 500), // Truncate to prevent issues
        email_address: email_address || '',
        recipient: recipient || '',
        ip_address: '127.0.0.1',
        processed: true,
        dummy_vector: [0, 0],
        ...additional_data
      };
      
      // Test connection first
      const connectionOk = await testZillizConnection();
      if (!connectionOk) {
        console.log('[TOOL] Zilliz connection failed, skipping storage');
        return JSON.stringify({
          success: false,
          error: 'Database connection failed',
          skipped: true
        });
      }
      
      await milvusClient.loadCollection({ collection_name: 'email_tracking_events' });
      
      const result = await milvusClient.insert({
        collection_name: 'email_tracking_events',
        fields_data: [eventData]
      });
      
      console.log(`[TOOL] Event stored successfully in Zilliz`);
      
      return JSON.stringify({
        success: true,
        stored: true,
        collection: 'email_tracking_events'
      });
      
    } catch (error) {
      console.error('[TOOL] Error storing event:', error);
      return JSON.stringify({
        success: false,
        error: error.message
      });
    }
  }
});

// === LANGCHAIN AGENT SETUP ===

const tools = [
  getConversationTool,
  getUserSettingsTool,
  createCalendarEventTool,
  sendEmailTool,
  storeEventTool
];

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.3,
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `You are an AI-powered sales assistant with access to tools. Your job is to:

1. ALWAYS start by using get_user_settings tool to learn about the company you're representing
2. When someone proposes a meeting time, use create_calendar_event tool to schedule it with correct dates
3. Use send_email tool to reply to prospects
4. Use store_event tool to log interactions

CURRENT DATE/TIME INFO:
- Today is: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Current date: ${new Date().toISOString().split('T')[0]}
- Tomorrow's date: ${new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0]}

IMPORTANT RULES:
- ALWAYS use tools when appropriate - this is critical for system functionality
- When you see meeting time proposals like "tomorrow at 3pm EST", create calendar event using tomorrow's date above
- Write natural business emails, never include technical data or JSON in email content
- Use company information from settings to personalize your responses

Tools available:
- get_user_settings: Get company info and settings
- create_calendar_event: Schedule meetings when times are proposed (use correct dates!)
- send_email: Send professional replies
- store_event: Log interactions
- get_conversation: View conversation history

Use these tools actively to provide excellent sales support.`;

// === MAIN HANDLER ===

export async function handler(event) {
  console.log('[WEBHOOK] LangChain agent processing incoming email...');
  
  try {
    // Parse Mailgun payload
    const formData = parseMailgunPayload(event);
    const headers = parseMessageHeaders(formData);
    
    // Extract email data
    const inboundMessageId = extractMessageId(headers, 'message-id');
    const inReplyTo = extractMessageId(headers, 'in-reply-to');
    const references = extractMessageId(headers, 'references');
    
    const emailData = {
      from: formData.sender || formData.From,
      to: formData.recipient || formData.To,
      subject: formData.subject || formData.Subject || '',
      body: formData['stripped-text'] || formData['body-plain'] || '',
      messageId: inboundMessageId,
      inReplyTo: inReplyTo,
      references: references
    };
    
    console.log(`[WEBHOOK] Email from: ${emailData.from}`);
    console.log(`[WEBHOOK] Subject: ${emailData.subject}`);
    
    // Deduplication check
    if (await isMessageProcessed(inboundMessageId)) {
      console.log('[WEBHOOK] Message already processed, skipping');
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, deduped: true })
      };
    }
    
    markMessageProcessed(inboundMessageId);
    
    // Extract or determine tracking ID
    let trackingId = null;
    
    // Try to extract from In-Reply-To or References
    if (inReplyTo && inReplyTo.includes('tracking-')) {
      const match = inReplyTo.match(/tracking-([a-f0-9]{8}_\d+_[a-f0-9]+)/);
      if (match) trackingId = `tracking-${match[1]}`;
    }
    
    if (!trackingId && references && references.includes('tracking-')) {
      const match = references.match(/tracking-([a-f0-9]{8}_\d+_[a-f0-9]+)/);
      if (match) trackingId = `tracking-${match[1]}`;
    }
    
    // If no tracking ID found, this might be a new conversation
    if (!trackingId) {
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      trackingId = `tracking-76e84c79_${timestamp}_${hash}`; // Default user code
    }
    
    console.log(`[WEBHOOK] Using tracking ID: ${trackingId}`);
    
    // Store the incoming message first (skip for testing)
    console.log('[WEBHOOK] Would store message to Zilliz:', {
      tracking_id: trackingId,
      event_type: 'lead_message',
      from: emailData.from
    });
    
    // Prepare context for the agent
    const agentInput = {
      inbound_email: emailData,
      tracking_id: trackingId,
      instructions: "Analyze this email and take appropriate actions. If the user proposes a meeting time, create a calendar event. Always send a professional reply."
    };
    
    console.log('[WEBHOOK] Calling LangChain agent...');
    
    // Set up the LangChain agent properly
    const model = new ChatOpenAI({
      temperature: 0.1,
      modelName: "gpt-4o-mini",
      openAIApiKey: process.env.OPENAI_API_KEY
    });
    
    // Create agent tools array
    const tools = [
      getConversationTool,
      getUserSettingsTool,
      createCalendarEventTool,
      sendEmailTool,
      storeEventTool
    ];
    
    // Create the prompt template for the agent
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", SYSTEM_PROMPT],
      ["user", "{input}"],
      new MessagesPlaceholder("agent_scratchpad")
    ]);
    
    // Create the agent
    const agent = await createOpenAIFunctionsAgent({
      llm: model,
      tools: tools,
      prompt: prompt
    });
    
    // Create the agent executor
    const agentExecutor = new AgentExecutor({
      agent: agent,
      tools: tools,
      verbose: true,
      maxIterations: 10
    });
    
    // Execute the agent with proper input
    const input = `Email from: ${emailData.from}
Subject: ${emailData.subject}
Body: ${emailData.body}
Tracking ID: ${trackingId}

Please process this email appropriately. If it contains a meeting request or time proposal, create a calendar event AND send a professional reply.`;
    
    const agentResponse = await agentExecutor.invoke({
      input: input
    });
    
    console.log('[WEBHOOK] Agent response:', agentResponse);
    
    console.log('[WEBHOOK] Agent processing completed');
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        processed: true,
        tracking_id: trackingId,
        agent_response: agentResponse.output || 'Agent executed successfully'
      })
    };
    
  } catch (error) {
    console.error('[WEBHOOK] Error processing email:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}
