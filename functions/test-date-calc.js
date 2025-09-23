// Test endpoint to check date calculations with user timezone settings
export const handler = async (event, context) => {
  try {
    // Mock user settings (your actual settings)
    const mockSettings = {
      company_name: "Exabits",
      product_name: "AI-Powered High-Performance Computing Solutions", 
      value_propositions: ["30% cost reduction"],
      ai_assistant_name: "ExaCole",
      timezone: "America/Los_Angeles", // PST timezone
      response_tone: "professional_friendly",
      calendar_id: "COLTON.FIDD@GMAIL.COM"
    };

    const userTimezone = mockSettings.timezone;
    const now = new Date();
    
    // Calculate dates in user's timezone (PST)
    const today = now.toLocaleDateString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      timeZone: userTimezone 
    }).replace(/\//g, '-');
    
    const tomorrow = new Date(now.getTime() + 24*60*60*1000).toLocaleDateString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      timeZone: userTimezone 
    }).replace(/\//g, '-');

    const todayLong = now.toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: userTimezone 
    });

    const userCurrentTime = now.toLocaleString('en-US', { 
      timeZone: userTimezone,
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    // Test calendar event scenarios  
    const testScenarios = {
      "tomorrow_5pm_pst": `${tomorrow}T17:00:00-08:00`,
      "tomorrow_4pm_pst": `${tomorrow}T16:00:00-08:00`, 
      "today_2pm_pst": `${today}T14:00:00-08:00`
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userSettings: mockSettings,
        timezone_info: {
          user_timezone: userTimezone,
          user_current_time: userCurrentTime,
          utc_time: now.toISOString()
        },
        date_calculations: {
          today: today,
          tomorrow: tomorrow, 
          today_long: todayLong
        },
        calendar_examples: testScenarios,
        expected_behavior: {
          "if_user_says": "tomorrow at 5pm",
          "ai_should_assume": "PST (user's timezone)",
          "should_schedule_for": testScenarios.tomorrow_5pm_pst,
          "calendar_date": tomorrow
        },
        ai_prompt_preview: `Today is: ${todayLong} (in ${userTimezone})\nTomorrow: ${tomorrow}\nAI Name: ${mockSettings.ai_assistant_name}\nCompany: ${mockSettings.company_name}`
      }, null, 2)
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
