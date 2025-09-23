// Simple calendar test to debug Google Calendar API issues
import crypto from 'crypto';

export const handler = async (event, context) => {
  try {
    console.log('[CALENDAR-TEST] Starting calendar creation test...');
    
    // Test calendar event creation directly
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;
    
    if (!serviceAccountEmail || !privateKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing Google service account credentials",
          has_email: !!serviceAccountEmail,
          has_key: !!privateKey
        })
      };
    }
    
    // Clean and format the private key properly
    privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
    privateKey = privateKey.replace(/^["']|["']$/g, '');
    
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }
    
    privateKey = privateKey.replace(/\n\n+/g, '\n');
    
    console.log('[CALENDAR-TEST] Service account email:', serviceAccountEmail);
    console.log('[CALENDAR-TEST] Private key length:', privateKey.length);
    
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
    
    let signature;
    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signData);
      signature = sign.sign(privateKey, 'base64url');
      console.log('[CALENDAR-TEST] JWT signature created successfully');
    } catch (signError) {
      console.error('[CALENDAR-TEST] Crypto signing error:', signError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "JWT signing failed",
          details: signError.message
        })
      };
    }
    
    const jwt = `${signData}.${signature}`;
    
    // Exchange JWT for access token
    console.log('[CALENDAR-TEST] Exchanging JWT for access token...');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    
    const tokenData = await tokenResponse.json();
    console.log('[CALENDAR-TEST] Token response status:', tokenResponse.status);
    console.log('[CALENDAR-TEST] Token response:', tokenData);
    
    if (!tokenResponse.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Token exchange failed",
          status: tokenResponse.status,
          details: tokenData
        })
      };
    }
    
    const accessToken = tokenData.access_token;
    console.log('[CALENDAR-TEST] Got access token successfully');
    
    // Test calendar event creation
    const testEvent = {
      summary: "Calendar API Test",
      start: { 
        dateTime: "2025-09-23T15:00:00-07:00", // 3pm PDT (September is daylight saving)
        timeZone: "America/Los_Angeles" 
      },
      end: { 
        dateTime: "2025-09-23T15:30:00-07:00", // 3:30pm PDT
        timeZone: "America/Los_Angeles" 
      },
      description: "Test event to debug calendar creation issues"
    };
    
    console.log('[CALENDAR-TEST] Creating test event:', JSON.stringify(testEvent, null, 2));
    
    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/COLTON.FIDD@GMAIL.COM/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testEvent)
      }
    );
    
    const eventData = await calendarResponse.json();
    console.log('[CALENDAR-TEST] Calendar response status:', calendarResponse.status);
    console.log('[CALENDAR-TEST] Calendar response:', eventData);
    
    if (!calendarResponse.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Calendar creation failed",
          status: calendarResponse.status,
          details: eventData
        })
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Calendar event created successfully",
        event_id: eventData.id,
        html_link: eventData.htmlLink,
        actual_start_time: eventData.start,
        actual_end_time: eventData.end,
        created_at: eventData.created
      })
    };
    
  } catch (error) {
    console.error('[CALENDAR-TEST] Unexpected error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Unexpected error",
        message: error.message,
        stack: error.stack
      })
    };
  }
};
