// Test Google Calendar integration specifically
require('dotenv').config({ path: '../.env' });

const { calendarManager } = require('./functions/calendarIntegrationManager');

async function testCalendar() {
  console.log('📅 Testing Google Calendar Integration...\n');
  
  // Check environment variables
  console.log('🔑 Google Calendar Environment Variables:');
  console.log('   GOOGLE_SERVICE_ACCOUNT_EMAIL:', !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'SET' : 'MISSING');
  console.log('   GOOGLE_PRIVATE_KEY:', !!process.env.GOOGLE_PRIVATE_KEY ? 'SET' : 'MISSING');
  console.log('   GOOGLE_CALENDAR_ID:', !!process.env.GOOGLE_CALENDAR_ID ? 'SET' : 'MISSING');
  console.log('');
  
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    console.log('📧 Service Account Email:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  }
  if (process.env.GOOGLE_CALENDAR_ID) {
    console.log('📅 Calendar ID:', process.env.GOOGLE_CALENDAR_ID);
  }
  if (process.env.GOOGLE_PRIVATE_KEY) {
    console.log('🔐 Private Key Length:', process.env.GOOGLE_PRIVATE_KEY.length, 'characters');
    console.log('🔐 Private Key Preview:', process.env.GOOGLE_PRIVATE_KEY.substring(0, 50) + '...');
  }
  console.log('');
  
  // Initialize calendar manager
  await calendarManager.initialize();
  
  // Test meeting time parsing
  console.log('🧪 Testing meeting time parsing...');
  const testEmail = 'hmmm, I guess i could set up a meeting. how about 6pm tomorrow?';
  const parsedTime = calendarManager.parseMeetingTime(testEmail, testEmail);
  console.log('📅 Parsed meeting time:', parsedTime);
  console.log('');
  
  // Test calendar event creation (if credentials are available)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID) {
    console.log('🧪 Testing calendar event creation...');
    
    const testEventDetails = {
      title: 'Test Meeting - ExaMark Calendar Integration',
      description: 'This is a test meeting created by the ExaMark calendar integration system.',
      startTime: '2025-09-22T22:00:00.000Z', // 6pm tomorrow in UTC
      endTime: '2025-09-22T22:30:00.000Z',   // 30 minutes later
      timeZone: 'America/New_York',
      attendees: [
        {
          email: 'colton.fidd@gmail.com',
          displayName: 'Colton Fidd (Test Lead)',
          responseStatus: 'needsAction'
        }
      ]
    };
    
    console.log('📅 Creating test event:', {
      title: testEventDetails.title,
      startTime: testEventDetails.startTime,
      attendees: testEventDetails.attendees.map(a => a.email)
    });
    
    try {
      const result = await calendarManager.createGoogleCalendarEvent(testEventDetails);
      
      if (result.success) {
        console.log('✅ Calendar event created successfully!');
        console.log('🔗 Event ID:', result.event_id);
        console.log('🔗 Event Link:', result.event_link);
        if (result.meeting_link) {
          console.log('📹 Meeting Link:', result.meeting_link);
        }
      } else {
        console.log('❌ Calendar event creation failed:');
        console.log('   Error:', result.error);
      }
    } catch (error) {
      console.log('❌ Calendar test failed:');
      console.log('   Error:', error.message);
      console.log('   Stack:', error.stack);
    }
  } else {
    console.log('⚠️  Cannot test calendar event creation - missing credentials');
    console.log('   Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID');
  }
}

testCalendar().catch(console.error);
