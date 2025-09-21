const crypto = require('crypto');

/**
 * Calendar Integration Manager - Handles automatic meeting scheduling
 * Simplified version for Netlify Functions
 */
class CalendarIntegrationManager {
    constructor() {
        this.googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        this.googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY;
        this.googleCalendarId = process.env.GOOGLE_CALENDAR_ID;
        this.calendlyApiKey = process.env.CALENDLY_API_KEY;
        this.calendlyUserId = process.env.CALENDLY_USER_ID;
        this.initialized = false;
    }

    async initialize() {
        console.log('📅 [CALENDAR] Initializing Calendar Integration Manager...');
        
        if (!this.googleServiceAccountEmail && !this.calendlyApiKey) {
            console.warn('⚠️ [CALENDAR] No calendar API keys found. Calendar features will be limited.');
        }
        
        this.initialized = true;
        console.log('✅ [CALENDAR] Calendar Integration Manager initialized');
    }

    /**
     * Parse and validate calendar link from settings
     */
    parseCalendarLink(calendarLink) {
        if (!calendarLink) return null;
        
        console.log(`📅 [CALENDAR] Parsing calendar link: ${calendarLink}`);
        
        // Calendly link detection
        if (calendarLink.includes('calendly.com')) {
            const match = calendarLink.match(/calendly\.com\/([^\/]+)\/([^\/\?]+)/);
            if (match) {
                return {
                    type: 'calendly',
                    username: match[1],
                    event_type: match[2],
                    full_url: calendarLink
                };
            }
        }
        
        // Acuity Scheduling
        if (calendarLink.includes('acuityscheduling.com')) {
            return {
                type: 'acuity',
                full_url: calendarLink
            };
        }
        
        // Cal.com
        if (calendarLink.includes('cal.com')) {
            return {
                type: 'cal_com',
                full_url: calendarLink
            };
        }
        
        // Google Calendar (meet.google.com or calendar.google.com)
        if (calendarLink.includes('calendar.google.com') || calendarLink.includes('meet.google.com')) {
            return {
                type: 'google_calendar',
                full_url: calendarLink
            };
        }
        
        // Zoom meeting links
        if (calendarLink.includes('zoom.us')) {
            return {
                type: 'zoom',
                full_url: calendarLink
            };
        }
        
        // Generic/unknown link
        return {
            type: 'generic',
            full_url: calendarLink
        };
    }

    /**
     * Generate smart calendar integration text based on link type
     */
    generateCalendarText(calendarLink, meetingContext = {}) {
        const parsed = this.parseCalendarLink(calendarLink);
        if (!parsed) return '';
        
        console.log(`📅 [CALENDAR] Generating calendar text for type: ${parsed.type}`);
        
        const { intent, urgency, duration } = meetingContext;
        
        // Determine meeting duration suggestion
        let suggestedDuration = '15-minute';
        if (intent === 'technical_question' || intent === 'feature_inquiry') {
            suggestedDuration = '30-minute';
        } else if (intent === 'pricing_inquiry' && urgency === 'high') {
            suggestedDuration = '20-minute';
        }
        
        // Generate contextual text based on platform
        switch (parsed.type) {
            case 'calendly':
                return `I'd love to schedule a ${suggestedDuration} call to discuss this further. You can pick a time that works best for you here: ${parsed.full_url}
                
The booking is quick and easy - just select your preferred time slot and you'll receive a calendar invite with all the details.`;

            case 'acuity':
                return `Let's schedule a ${suggestedDuration} call to dive deeper into this. You can book a convenient time through my scheduling system: ${parsed.full_url}
                
Simply choose a time that fits your schedule and we'll get everything set up automatically.`;

            case 'cal_com':
                return `I'd be happy to set up a ${suggestedDuration} call to discuss your specific needs. You can book directly here: ${parsed.full_url}
                
The scheduling system will send you a calendar invite once you've selected your preferred time.`;

            case 'google_calendar':
                return `Let's schedule a ${suggestedDuration} meeting to go over this in detail. You can view my availability and book a time here: ${parsed.full_url}
                
Once you select a time, Google Calendar will automatically send you an invite.`;

            case 'zoom':
                return `I'd like to schedule a ${suggestedDuration} video call to discuss this further. Here's the meeting link: ${parsed.full_url}
                
Please let me know what time works best for you and I'll send over a calendar invite.`;

            default:
                return `I'd love to schedule a ${suggestedDuration} call to discuss this in more detail. You can book a time that works for you here: ${parsed.full_url}
                
Looking forward to our conversation!`;
        }
    }

    /**
     * Create a Google Calendar event (if API configured)
     */
    async createGoogleCalendarEvent(eventDetails) {
        if (!this.googleServiceAccountEmail || !this.googlePrivateKey || !this.googleCalendarId) {
            console.warn('⚠️ [CALENDAR] Google Calendar Service Account not configured');
            return { success: false, error: 'Google Calendar Service Account not configured' };
        }

        console.log('📅 [CALENDAR] Creating Google Calendar event...');
        
        try {
            // Create JWT token for service account authentication
            const jwt = await this.createJWT();
            
            const event = {
                summary: eventDetails.title || 'Sales Discussion',
                description: `${eventDetails.description || 'Scheduled through AI email responder'}\n\nProspect Details:\n${eventDetails.attendees?.map(a => `${a.displayName || 'Prospect'}: ${a.email}`).join('\n') || 'No attendees specified'}`,
                start: {
                    dateTime: eventDetails.startTime,
                    timeZone: eventDetails.timeZone || 'America/New_York'
                },
                end: {
                    dateTime: eventDetails.endTime,
                    timeZone: eventDetails.timeZone || 'America/New_York'
                },
                attendees: eventDetails.attendees || []
            };

            const response = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/${this.googleCalendarId}/events`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${jwt}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(event)
                }
            );

            if (response.ok) {
                const createdEvent = await response.json();
                console.log('✅ [CALENDAR] Google Calendar event created successfully');
                
                return {
                    success: true,
                    event_id: createdEvent.id,
                    event_link: createdEvent.htmlLink,
                    meeting_link: createdEvent.conferenceData?.entryPoints?.[0]?.uri,
                    event_details: createdEvent
                };
            } else {
                const error = await response.json();
                console.error('❌ [CALENDAR] Failed to create Google Calendar event:', error);
                return { success: false, error: error.error?.message || 'Failed to create event' };
            }

        } catch (error) {
            console.error('❌ [CALENDAR] Error creating Google Calendar event:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create JWT token for service account authentication
     */
    async createJWT() {
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss: this.googleServiceAccountEmail,
            scope: 'https://www.googleapis.com/auth/calendar',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        // Simple JWT creation
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        
        const signatureInput = `${encodedHeader}.${encodedPayload}`;
        
        // Create signature using private key
        const signature = crypto.sign('RSA-SHA256', Buffer.from(signatureInput), this.googlePrivateKey);
        const encodedSignature = signature.toString('base64url');
        
        const jwt = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
        
        // Exchange JWT for access token
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });

        const tokenData = await tokenResponse.json();
        return tokenData.access_token;
    }

    /**
     * Generate meeting scheduling suggestions based on intent and urgency
     */
    generateMeetingStrategy(intent, conversationStage, leadData = {}) {
        console.log(`📅 [CALENDAR] Generating meeting strategy for intent: ${intent}, stage: ${conversationStage}`);
        
        let strategy = {
            should_suggest_meeting: false,
            urgency: 'low',
            suggested_duration: 15,
            meeting_type: 'discovery',
            custom_message: ''
        };

        // High-priority meeting scenarios
        if (intent === 'meeting_request_positive' || intent === 'meeting_time_preference') {
            strategy.should_suggest_meeting = true;
            strategy.urgency = 'high';
            strategy.meeting_type = 'demo';
            strategy.suggested_duration = 30;
        }
        
        // Pricing inquiries usually indicate readiness
        else if (intent === 'pricing_question') {
            strategy.should_suggest_meeting = true;
            strategy.urgency = 'medium';
            strategy.meeting_type = 'pricing_discussion';
            strategy.suggested_duration = 20;
            strategy.custom_message = 'to provide you with accurate pricing based on your specific needs';
        }
        
        // Technical questions may need deeper discussion
        else if (intent === 'technical_question') {
            strategy.should_suggest_meeting = true;
            strategy.urgency = 'medium';
            strategy.meeting_type = 'technical_deep_dive';
            strategy.suggested_duration = 30;
            strategy.custom_message = 'for a technical deep-dive and live demonstration';
        }
        
        // Engaged prospects (multiple questions)
        else if (conversationStage === 'engaged') {
            strategy.should_suggest_meeting = true;
            strategy.urgency = 'medium';
            strategy.meeting_type = 'consultation';
            strategy.suggested_duration = 20;
            strategy.custom_message = 'to address all your questions in detail';
        }

        console.log(`📅 [CALENDAR] Meeting strategy: ${JSON.stringify(strategy)}`);
        return strategy;
    }

    /**
     * Parse proposed meeting time from email text
     */
    parseMeetingTime(emailText, proposedTime, defaultTimezone = 'America/New_York') {
        console.log(`📅 [CALENDAR] Parsing meeting time: "${proposedTime}" from email: "${emailText.substring(0, 100)}..."`);
        
        try {
            const now = new Date();
            let meetingDate = new Date();
            
            // Handle "tomorrow" references
            if (proposedTime.toLowerCase().includes('tomorrow')) {
                meetingDate.setDate(now.getDate() + 1);
            }
            // Handle specific day references (today, next week, etc.)
            else if (proposedTime.toLowerCase().includes('today')) {
                // Keep today's date
            }
            else if (proposedTime.toLowerCase().includes('next week')) {
                meetingDate.setDate(now.getDate() + 7);
            }
            
            // Extract time (6pm, 6 PM, 18:00, etc.)
            const timeMatch = proposedTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/);
            if (timeMatch) {
                let hour = parseInt(timeMatch[1]);
                const minute = parseInt(timeMatch[2]) || 0;
                const ampm = timeMatch[3]?.toLowerCase();
                
                // Convert to 24-hour format
                if (ampm === 'pm' && hour !== 12) hour += 12;
                if (ampm === 'am' && hour === 12) hour = 0;
                
                meetingDate.setHours(hour, minute, 0, 0);
                
                return {
                    found: true,
                    datetime: meetingDate.toISOString(),
                    timezone: defaultTimezone,
                    display_text: meetingDate.toLocaleString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short'
                    }),
                    needs_timezone_confirmation: true
                };
            }
            
            return { found: false, reason: 'Could not parse time from text' };
            
        } catch (error) {
            console.error('❌ [CALENDAR] Error parsing meeting time:', error);
            return { found: false, error: error.message };
        }
    }

    /**
     * Create calendar event from parsed meeting details
     */
    async createMeetingFromDetails(leadEmail, leadName, meetingDetails, userSettings = {}) {
        console.log('📅 [CALENDAR] Creating meeting from parsed details...');
        
        if (!meetingDetails.found) {
            return { success: false, error: 'No valid meeting time found' };
        }
        
        try {
            const startTime = new Date(meetingDetails.datetime);
            const endTime = new Date(startTime);
            endTime.setMinutes(startTime.getMinutes() + 30); // Default 30-minute meeting
            
            const eventDetails = {
                title: `Sales Discussion with ${leadName || 'Prospect'}`,
                description: `Scheduled through AI email responder.\n\nProposed time: ${meetingDetails.display_text}\nTimezone: ${meetingDetails.timezone}`,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                timeZone: meetingDetails.timezone,
                attendees: [
                    {
                        email: leadEmail,
                        displayName: leadName || 'Prospect',
                        responseStatus: 'needsAction'
                    }
                ]
            };
            
            // Create the calendar event
            const result = await this.createGoogleCalendarEvent(eventDetails);
            
            if (result.success) {
                console.log('✅ [CALENDAR] Meeting created successfully');
                return {
                    success: true,
                    event_id: result.event_id,
                    event_link: result.event_link,
                    meeting_details: meetingDetails,
                    event_details: eventDetails
                };
            } else {
                console.error('❌ [CALENDAR] Failed to create meeting:', result.error);
                return { success: false, error: result.error };
            }
            
        } catch (error) {
            console.error('❌ [CALENDAR] Error creating meeting:', error);
            return { success: false, error: error.message };
        }
    }
}

// Export singleton instance
const calendarManager = new CalendarIntegrationManager();

module.exports = { CalendarIntegrationManager, calendarManager };
