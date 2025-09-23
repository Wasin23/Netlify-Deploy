// Test endpoint to check date calculations
export const handler = async (event, context) => {
  try {
    const now = new Date();
    
    // Current calculations (what the AI sees)
    const currentDateCalc = {
      today_display: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' }),
      today_iso: now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' }).replace(/\//g, '-'),
      tomorrow_iso: new Date(now.getTime() + 24*60*60*1000).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' }).replace(/\//g, '-'),
      
      // Raw values for debugging
      raw_now: now.toISOString(),
      raw_today_est: now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      raw_tomorrow_utc: new Date(now.getTime() + 24*60*60*1000).toISOString(),
      raw_tomorrow_est: new Date(now.getTime() + 24*60*60*1000).toLocaleString('en-US', { timeZone: 'America/New_York' })
    };
    
    // Test specific scenarios
    const testScenarios = {
      "tomorrow_5pm_est": `${currentDateCalc.tomorrow_iso}T17:00:00-05:00`,
      "tomorrow_4pm_est": `${currentDateCalc.tomorrow_iso}T16:00:00-05:00`,
      "today_3pm_est": `${currentDateCalc.today_iso}T15:00:00-05:00`
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "Date calculation test results",
        current_system_time: now.toISOString(),
        what_ai_sees: currentDateCalc,
        test_scenarios: testScenarios,
        expected_behavior: {
          "if_user_says": "tomorrow at 5pm EST",
          "should_schedule_for": testScenarios.tomorrow_5pm_est,
          "actual_date": currentDateCalc.tomorrow_iso
        }
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
