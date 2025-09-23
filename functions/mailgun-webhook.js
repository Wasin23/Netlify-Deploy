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
        output_fields: ["timestamp", "event_type", "user_agent", "email_address", "recipient", "event_content"],
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

// Tool 2: Get user settings (comprehensive) - Fixed with ChatGPT's solution
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
      
      // Query for user settings (single JSON column)
      const result = await milvusClient.query({
        collection_name: 'agent_settings',
        expr: `setting_key == "email_response_settings" && user_id == "${userId.replace(/["\\]/g, '\\$&')}"`,
        output_fields: ['setting_value', 'updated_at'],
        limit: 1,
        consistency_level: 'Strong'
      });
      
      const rows = result.data || result || [];
      console.log(`[TOOL] Query result:`, rows);
      
      if (rows.length === 0) {
        console.log(`[TOOL] No settings found for user ${userId} - settings must be configured first`);
        return JSON.stringify({
          error: "No user settings found in Zilliz. Please configure your Email Response Settings first.",
          settings_required: true
        });
      }
      
      // Parse the JSON settings
      const settings = JSON.parse(rows[0].setting_value);
      console.log(`[TOOL] Found settings for user ${userId}:`, settings);
      
      // Return ONLY what's in Zilliz - no fallbacks
      const finalSettings = {
        calendar_id: settings.calendar_id,
        company_name: settings.company_name,
        timezone: settings.timezone,
        response_tone: settings.response_tone,
        ai_assistant_name: settings.ai_assistant_name,
        product_name: settings.product_name,
        value_propositions: settings.value_propositions
      };
      
      console.log(`[TOOL] Final settings (Zilliz only):`, finalSettings);
      return JSON.stringify(finalSettings);
      
    } catch (error) {
      console.error('[TOOL] Error getting user settings:', error);
      return JSON.stringify({
        error: `Failed to retrieve user settings: ${error.message}`,
        settings_required: true
      });
    }
  }
});

// Tool 2: Check Calendar Availability and Suggest Alternatives
const checkAvailabilityTool = new DynamicStructuredTool({
  name: "check_availability",
  description: "Check calendar availability for requested time and suggest alternatives if busy. Always use before creating calendar events.",
  schema: z.object({
    calendar_id: z.string().describe("User's calendar ID to check availability"),
    requested_time: z.string().describe("ISO datetime string for requested meeting time"),
    duration_minutes: z.number().default(30).describe("Meeting duration in minutes"),
    timezone: z.string().describe("Timezone for scheduling")
  }),
  func: async ({ calendar_id, requested_time, duration_minutes, timezone }) => {
    try {
      console.log(`[AVAILABILITY] Checking availability for ${requested_time} on calendar ${calendar_id}`);
      
      // Create JWT for Google OAuth (same as calendar creation)
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;
      
      if (!serviceAccountEmail || !privateKey) {
        return JSON.stringify({
          available: false,
          error: "Missing Google service account credentials"
        });
      }
      
      // Clean private key
      privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
      privateKey = privateKey.replace(/^["']|["']$/g, '');
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
      }
      privateKey = privateKey.replace(/\n\n+/g, '\n');
      
      // Create JWT
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
      
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signData);
      const signature = sign.sign(privateKey, 'base64url');
      const jwt = `${signData}.${signature}`;
      
      // Get access token
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
        return JSON.stringify({
          available: false,
          error: "Failed to get access token"
        });
      }
      
      const accessToken = tokenData.access_token;
      
      // Calculate time range to check
      const requestedStart = new Date(requested_time);
      const requestedEnd = new Date(requestedStart.getTime() + duration_minutes * 60 * 1000);
      
      // Check for conflicts in requested time slot
      const timeMin = requestedStart.toISOString();
      const timeMax = requestedEnd.toISOString();
      
      console.log(`[AVAILABILITY] Checking conflicts between ${timeMin} and ${timeMax}`);
      
      const eventsResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendar_id}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );
      
      const eventsData = await eventsResponse.json();
      
      if (!eventsResponse.ok) {
        return JSON.stringify({
          available: false,
          error: `Calendar check failed: ${eventsData.error?.message || 'Unknown error'}`
        });
      }
      
      const conflicts = eventsData.items || [];
      console.log(`[AVAILABILITY] Found ${conflicts.length} conflicting events`);
      
      // If no conflicts, requested time is available
      if (conflicts.length === 0) {
        return JSON.stringify({
          available: true,
          suggested_time: requested_time,
          message: "Requested time is available"
        });
      }
      
      // Find alternative times
      console.log(`[AVAILABILITY] Finding alternatives for busy slot`);
      
      // Helper function to check if time is within business hours (8am-8pm) in USER'S timezone
      const isBusinessHours = (date, userTimezone) => {
        // Convert to user's timezone for business hours check
        const userTime = new Date(date.toLocaleString("en-US", {timeZone: userTimezone}));
        const hour = userTime.getHours();
        return hour >= 8 && hour < 20; // 8am to 8pm in USER'S timezone
      };
      
      // Check if requested time is within user's business hours
      const requestedInUserTz = new Date(requestedStart.toLocaleString("en-US", {timeZone: timezone}));
      const requestedEndInUserTz = new Date(requestedEnd.toLocaleString("en-US", {timeZone: timezone}));
      
      if (!isBusinessHours(requestedInUserTz, timezone) || !isBusinessHours(requestedEndInUserTz, timezone)) {
        const requestedHour = requestedInUserTz.getHours();
        const requestedMinute = requestedInUserTz.getMinutes();
        const timeString = `${requestedHour}:${requestedMinute.toString().padStart(2, '0')}`;
        
        return JSON.stringify({
          available: false,
          business_hours_violation: true,
          message: `Requested time (${timeString} in your timezone) is outside business hours (8:00 AM - 8:00 PM). Please suggest a time between 8am-8pm in your timezone.`,
          user_timezone: timezone,
          requested_time_in_user_tz: requestedInUserTz.toISOString()
        });
      }
      
      // Priority 1: Same day, within ±4 hours
      const sameDayAlternatives = [];
      const requestedDate = new Date(requestedStart);
      requestedDate.setHours(8, 0, 0, 0); // Start at 8am same day
      
      for (let i = 0; i < 12 * 4; i++) { // Check every 15 minutes for 12 hours (8am-8pm)
        const testStart = new Date(requestedDate.getTime() + i * 15 * 60 * 1000);
        const testEnd = new Date(testStart.getTime() + duration_minutes * 60 * 1000);
        
        // Skip if outside business hours in USER'S timezone
        if (!isBusinessHours(testStart, timezone) || !isBusinessHours(testEnd, timezone)) continue;
        
        // Skip if too far from original request (>4 hours)
        const hoursDiff = Math.abs(testStart.getTime() - requestedStart.getTime()) / (1000 * 60 * 60);
        if (hoursDiff > 4) continue;
        
        // Check if this slot is free
        const testTimeMin = testStart.toISOString();
        const testTimeMax = testEnd.toISOString();
        
        const testEventsResponse = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendar_id}/events?timeMin=${encodeURIComponent(testTimeMin)}&timeMax=${encodeURIComponent(testTimeMax)}&singleEvents=true`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        
        const testEventsData = await testEventsResponse.json();
        if (testEventsResponse.ok && (!testEventsData.items || testEventsData.items.length === 0)) {
          sameDayAlternatives.push({
            start_time: testStart.toISOString().replace('Z', requested_time.slice(-6)),
            end_time: testEnd.toISOString().replace('Z', requested_time.slice(-6)),
            distance: hoursDiff
          });
          
          // Found a good alternative, use it
          if (sameDayAlternatives.length >= 1) break;
        }
      }
      
      // If same day alternative found, use it
      if (sameDayAlternatives.length > 0) {
        const best = sameDayAlternatives.sort((a, b) => a.distance - b.distance)[0];
        const suggestedTime = new Date(best.start_time);
        const timeString = suggestedTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          timeZone: timezone 
        });
        
        return JSON.stringify({
          available: false,
          suggested_time: best.start_time,
          suggested_end_time: best.end_time,
          message: `Requested time is busy, but ${timeString} the same day is available`,
          alternative_type: "same_day"
        });
      }
      
      // Priority 2: Same time next day
      const nextDayStart = new Date(requestedStart);
      nextDayStart.setDate(nextDayStart.getDate() + 1);
      const nextDayEnd = new Date(nextDayStart.getTime() + duration_minutes * 60 * 1000);
      
      if (isBusinessHours(nextDayStart, timezone) && isBusinessHours(nextDayEnd, timezone)) {
        const nextDayTimeMin = nextDayStart.toISOString();
        const nextDayTimeMax = nextDayEnd.toISOString();
        
        const nextDayEventsResponse = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendar_id}/events?timeMin=${encodeURIComponent(nextDayTimeMin)}&timeMax=${encodeURIComponent(nextDayTimeMax)}&singleEvents=true`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        
        const nextDayEventsData = await nextDayEventsResponse.json();
        if (nextDayEventsResponse.ok && (!nextDayEventsData.items || nextDayEventsData.items.length === 0)) {
          const dayName = nextDayStart.toLocaleDateString('en-US', { 
            weekday: 'long',
            timeZone: timezone 
          });
          const timeString = nextDayStart.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: timezone 
          });
          
          return JSON.stringify({
            available: false,
            suggested_time: nextDayStart.toISOString().replace('Z', requested_time.slice(-6)),
            suggested_end_time: nextDayEnd.toISOString().replace('Z', requested_time.slice(-6)),
            message: `Requested time is busy, but the same time on ${dayName} (${timeString}) is available`,
            alternative_type: "next_day"
          });
        }
      }
      
      // If no good alternatives found
      return JSON.stringify({
        available: false,
        message: "Requested time is busy and no suitable alternatives found within 4 hours or next day. Please suggest a different time.",
        alternative_type: "manual_suggestion_needed"
      });
      
    } catch (error) {
      console.error('[AVAILABILITY] Error checking availability:', error);
      return JSON.stringify({
        available: false,
        error: error.message
      });
    }
  }
});

// Tool 3: Create calendar event (enhanced with availability checking)
const createCalendarEventTool = new DynamicStructuredTool({
  name: "create_calendar_event",
  description: "Create a Google Calendar event. ALWAYS check availability first using check_availability tool. If time is busy, use the suggested alternative time.",
  schema: z.object({
    calendar_id: z.string().default('primary').describe("Calendar ID to create event in"),
    start_time: z.string().describe("ISO datetime string for event start (e.g., 2025-09-23T15:00:00-07:00 for 3pm PDT)"),
    end_time: z.string().optional().describe("ISO datetime string for event end - if not provided, will add 30 minutes to start_time"),
    title: z.string().default("Sales Discussion").describe("Event title"),
    attendees: z.array(z.string()).describe("Array of email addresses to invite"),
    timezone: z.string().default("America/Los_Angeles").describe("Timezone for the event"),
    availability_checked: z.boolean().default(false).describe("Whether availability was already checked - should be true if using suggested time from check_availability")
  }),
  func: async ({ calendar_id, start_time, end_time, title, attendees, timezone, availability_checked }) => {
    try {
      // Auto-calculate end_time if not provided (30 minutes default)
      if (!end_time) {
        const startDate = new Date(start_time);
        const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // Add 30 minutes
        end_time = endDate.toISOString().replace('Z', start_time.slice(-6)); // Preserve timezone offset
      }
      
      console.log(`[TOOL] Creating calendar event: ${title} from ${start_time} to ${end_time}`);
      console.log(`[TOOL] Availability pre-checked: ${availability_checked}`);
      
      // If availability wasn't checked, return error - force use of check_availability first
      if (!availability_checked) {
        return JSON.stringify({
          success: false,
          error: "Must check availability first using check_availability tool before creating calendar events",
          suggestion: "Use check_availability tool first, then create event with suggested time"
        });
      }
      console.log(`[TOOL] Timezone being used: ${timezone}`);
      console.log(`[TOOL] Calendar ID: ${calendar_id}`);
      
      // Log the exact event object being sent to Google
      const eventToCreate = {
        summary: title,
        start: { dateTime: start_time, timeZone: timezone },
        end: { dateTime: end_time, timeZone: timezone },
        description: `Meeting scheduled through ExaMark AI Assistant\n\nContact: ${attendees.join(', ')}`
      };
      
      console.log(`[TOOL] Event object being sent to Google Calendar:`, JSON.stringify(eventToCreate, null, 2));
      
      // Create JWT for Google OAuth
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;
      
      // Clean and format the private key properly
      if (privateKey) {
        // Handle multiple levels of escaping
        privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
        
        // Remove any extra quotes that might have been added
        privateKey = privateKey.replace(/^["']|["']$/g, '');
        
        // Ensure proper PEM format
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
        }
        
        // Clean up any double newlines
        privateKey = privateKey.replace(/\n\n+/g, '\n');
      }
      
      console.log('[TOOL] Service account email:', serviceAccountEmail);
      console.log('[TOOL] Private key length:', privateKey ? privateKey.length : 'undefined');
      console.log('[TOOL] Private key starts with:', privateKey ? privateKey.substring(0, 50) : 'undefined');
      console.log('[TOOL] Private key ends with:', privateKey ? privateKey.substring(privateKey.length - 50) : 'undefined');
      
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
      const event = eventToCreate;
      
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
      console.log(`[TOOL] Mailgun API key available: ${!!process.env.MAILGUN_API_KEY}`);
      
      if (!process.env.MAILGUN_API_KEY) {
        throw new Error('MAILGUN_API_KEY environment variable not set');
      }
      
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
        headers: { 
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });
      
      const result = await response.json();
      console.log(`[TOOL] Mailgun response status: ${response.status}`);
      console.log(`[TOOL] Mailgun response:`, result);
      
      if (!response.ok) {
        throw new Error(`Mailgun send failed: ${result.message || JSON.stringify(result)}`);
      }
      
      console.log(`[TOOL] Email sent successfully: ${messageId}`);
      
      // Log the actual email content that was sent (not internal AI thoughts)
      try {
        await storeEventTool.func({
          tracking_id: tracking_id,
          event_type: 'ai_reply',
          event_content: `Subject: ${subject}\n\nTo: ${to}\n\n${body}`,
          email_address: 'replies@mg.examarkchat.com',
          recipient: to
        });
        console.log('[TOOL] Logged sent email content');
      } catch (error) {
        console.error('[TOOL] Failed to log email content:', error);
      }
      
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
    event_content: z.string().describe("The actual email content, reply text, or event description"),
    email_address: z.string().optional().describe("Email address involved"),
    recipient: z.string().optional().describe("Recipient email address"),
    additional_data: z.record(z.any()).optional().describe("Additional event data")
  }),
  func: async ({ tracking_id, event_type, event_content, email_address, recipient, additional_data }) => {
    try {
      console.log(`[TOOL] Storing event: ${event_type} for ${tracking_id}`);
      
      const eventData = {
        tracking_id,
        event_type,
        timestamp: new Date().toISOString(),
        user_agent: event_content.substring(0, 500), // Store actual content, not user agent
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
        data: [eventData] // Fix: use 'data' not 'fields_data'
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
  checkAvailabilityTool,
  createCalendarEventTool,
  sendEmailTool,
  storeEventTool
];

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.3,
  apiKey: process.env.OPENAI_API_KEY
});

// Dynamic system prompt that uses user settings
function createSystemPrompt(userSettings) {
  if (!userSettings || userSettings.error) {
    return `You are an AI assistant that cannot properly function because user settings are not configured. 

Please inform the user: "I need you to configure your Email Response Settings first before I can assist you properly. Please set up your settings in the ExaMark interface."

Do not attempt to create calendar events or send detailed responses without proper configuration.`;
  }

  // Calculate dates in user's timezone
  const userTimezone = userSettings.timezone;
  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: '2-digit', day: '2-digit', 
    timeZone: userTimezone 
  }).replace(/\//g, '-');
  
  const tomorrow = new Date(Date.now() + 24*60*60*1000).toLocaleDateString('en-US', { 
    year: 'numeric', month: '2-digit', day: '2-digit', 
    timeZone: userTimezone 
  }).replace(/\//g, '-');

  const todayLong = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: userTimezone 
  });

  return `You are ${userSettings.ai_assistant_name}, the AI sales assistant for ${userSettings.company_name}.

COMPANY INFO:
- Company: ${userSettings.company_name}
- Product: ${userSettings.product_name}
- Value Props: ${userSettings.value_propositions?.join(', ')}
- Your Name: ${userSettings.ai_assistant_name}
- Response Tone: ${userSettings.response_tone}
- Calendar ID: ${userSettings.calendar_id}

USER TIMEZONE SETTINGS:
- User Timezone: ${userTimezone}
- Today is: ${todayLong} (in ${userTimezone})
- Current date: ${today}
- Tomorrow's date: ${tomorrow}

DATE CONSTRUCTION (using user's ${userTimezone} timezone):
- For "tomorrow at 3pm": use "${tomorrow}T15:00:00${userTimezone === 'America/Los_Angeles' ? '-07:00' : userTimezone === 'America/New_York' ? '-04:00' : '-05:00'}"
- For "tomorrow at 5pm": use "${tomorrow}T17:00:00${userTimezone === 'America/Los_Angeles' ? '-07:00' : userTimezone === 'America/New_York' ? '-04:00' : '-05:00'}"
- For "today at 2pm": use "${today}T14:00:00${userTimezone === 'America/Los_Angeles' ? '-07:00' : userTimezone === 'America/New_York' ? '-04:00' : '-05:00'}"

BEHAVIOR SETTINGS:
- Meeting Pushiness: ${userSettings.meeting_pushiness}
- Technical Depth: ${userSettings.technical_depth}
- Show AI Disclaimer: ${userSettings.show_ai_disclaimer}

YOUR JOB:
1. ALWAYS start by using get_user_settings tool to get current user configuration
2. ALWAYS use get_conversation tool to understand the email thread history and context
3. When someone proposes a meeting time:
   a) FIRST use check_availability tool to verify the time is free
   b) If busy, use the suggested alternative time from check_availability
   c) Create calendar event with availability_checked=true
4. Use send_email tool to reply with proper threading
5. Use store_event tool ONLY for significant events (not internal thoughts)

CALENDAR EVENT RULES:
- MANDATORY: Always check availability before scheduling
- DEFAULT DURATION: 30 minutes for all meetings
- BUSINESS HOURS: Only schedule between 8:00 AM - 8:00 PM in USER'S timezone (${userTimezone})
- TIMEZONE AWARENESS: If lead suggests 8pm PST but user is EST, that's 11pm user time = outside business hours
- CONFLICT RESOLUTION: If requested time is busy, suggest alternatives:
  * Priority 1: Same day within ±4 hours of original request (8am-8pm user timezone only)
  * Priority 2: Same time next day (if within user's business hours)
  * Always inform user about the change and why
- TIME PARSING: Parse the EXACT time mentioned by user (3pm = 15:00, NOT 16:00)
- TIMEZONE: Always use user's timezone (${userTimezone}) for business hours enforcement

IMPORTANT RULES:
- Use EXACTLY the dates shown above for ${userTimezone} timezone
- If timezone not specified in meeting request, assume user's timezone (${userTimezone})
- Use company name "${userSettings.company_name}" and your assistant name "${userSettings.ai_assistant_name}"
- Match response tone: ${userSettings.response_tone}
- For calendar events, use timezone: ${userTimezone}
- ALWAYS use provided In-Reply-To and References headers for email threading
- Subject lines: prefix with "Re:" for replies
- CONVERSATION CONTEXT: Reference previous exchanges when relevant (e.g., "As we discussed..." or "Following up on your interest in...")
- Maintain conversational continuity throughout the email thread

Tools available:
- get_user_settings: Get current user configuration
- get_conversation: View conversation history for context
- check_availability: Check calendar conflicts and suggest alternatives (8am-8pm only)
- create_calendar_event: Schedule meetings ONLY after checking availability
- send_email: Send professional replies with threading
- store_event: Log significant events only

Provide excellent sales support using the user's personalized settings!`;
}

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
      checkAvailabilityTool,
      createCalendarEventTool,
      sendEmailTool,
      storeEventTool
    ];
    
    // Get user settings first to create personalized system prompt
    let userSettings = null;
    try {
      const userId = extractUserIdFromTrackingId(trackingId);
      console.log('[WEBHOOK] Extracted userId:', userId);
      if (userId) {
        console.log('[WEBHOOK] Calling getUserSettings tool...');
        const settingsResult = await getUserSettingsTool.func({ tracking_id: trackingId });
        console.log('[WEBHOOK] getUserSettings raw result:', settingsResult);
        userSettings = JSON.parse(settingsResult);
        console.log('[WEBHOOK] Parsed userSettings:', userSettings);
        console.log('[WEBHOOK] Using personalized settings for', userId);
      } else {
        console.log('[WEBHOOK] No userId extracted from trackingId:', trackingId);
      }
    } catch (error) {
      console.error('[WEBHOOK] Failed to get user settings:', error);
    }

    // Create personalized system prompt based on user settings
    const systemPrompt = createSystemPrompt(userSettings);
    console.log('[WEBHOOK] Generated personalized system prompt');

    // Create the prompt template for the agent
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
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
Original Message-ID: ${emailData.messageId || 'unknown'}

THREADING INFO FOR REPLIES:
- Use In-Reply-To: ${emailData.messageId || ''}
- Use References: ${emailData.references ? emailData.references + ' ' + emailData.messageId : emailData.messageId || ''}

Please process this email appropriately. If it contains a meeting request or time proposal, create a calendar event AND send a professional reply with proper threading headers.`;

    // First, automatically log the incoming lead message
    try {
      await storeEventTool.func({
        tracking_id: trackingId,
        event_type: 'lead_message',
        event_content: `Subject: ${emailData.subject}\n\nFrom: ${emailData.from}\n\n${emailData.body}`,
        email_address: emailData.from,
        recipient: emailData.to
      });
      console.log('[WEBHOOK] Logged incoming lead message');
    } catch (error) {
      console.error('[WEBHOOK] Failed to log lead message:', error);
    }
    
    const agentResponse = await agentExecutor.invoke({
      input: input
    });
    
    // Note: Removed automatic AI response logging to avoid cluttering tracking with internal thoughts
    // AI will manually log significant events like calendar_created using store_event tool
    
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
