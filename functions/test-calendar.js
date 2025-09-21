const { CalendarIntegrationManager } = require('./calendarIntegrationManager');

exports.handler = async (event, context) => {
  console.log('🧪 [TEST-CALENDAR] Starting calendar test');
  
  try {
    // Initialize the calendar manager
    const calendarManager = new CalendarIntegrationManager();
    await calendarManager.initialize();
    
    console.log('✅ [TEST-CALENDAR] Calendar manager initialized');
    
    // Use the actual calendar ID from settings instead of 'primary'
    const calendarId = 'colton.fidd@gmail.com';
    
    // Create a test event
    const testEvent = {
      summary: 'Test Calendar Event from Webhook',
      description: 'This is a test event created by the calendar integration test function to verify functionality.',
      startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      endTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(), // 3 hours from now
      attendees: ['colton.fidd@gmail.com'],
      location: 'Virtual Meeting',
      timeZone: 'America/Los_Angeles'
    };
    
    console.log('📅 [TEST-CALENDAR] Creating event with details:', testEvent);
    console.log('📅 [TEST-CALENDAR] Using calendar ID:', calendarId);
    
    // Create the calendar event
    const result = await calendarManager.createGoogleCalendarEvent(testEvent, calendarId);
    
    console.log('📊 [TEST-CALENDAR] Calendar creation result:', result);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Calendar test completed',
        calendarId: calendarId,
        eventDetails: testEvent,
        result: result,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ [TEST-CALENDAR] Error during calendar test:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      })
    };
  }
};
